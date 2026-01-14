// Background service worker for tab monitoring and closing
class TabCloser {
  constructor() {
    this.monitoredTabs = new Map(); // Store tab info: {id: {url, startTime, type, inMeeting}}
    this.closedTabsCount = 0;
    this.CHECK_INTERVAL = 5000; // Check every 5 seconds (for testing)

    // Default timer configuration (in seconds)
    this.config = {
      zoomTimer: 600,   // 10 minutes
      teamsTimer: 600,  // 10 minutes
      meetTimer: 0,     // 0 = immediate closure when returning to home page
      fallbackZoomTimer: 10800  // 3 hours (for other zoom.us pages)
    };

    this.init();
  }

  async init() {
    // Load saved counter and configuration from storage
    const result = await chrome.storage.local.get(['closedTabsCount', 'timerConfig']);
    this.closedTabsCount = result.closedTabsCount || 0;

    // Load configuration or use defaults
    if (result.timerConfig) {
      this.config = {...this.config, ...result.timerConfig};
    }

    console.log('TabCloser initialized. Current count:', this.closedTabsCount);
    console.log('Timer configuration:', this.config);

    // Set up periodic check
    setInterval(() => this.checkTabsForClosure(), this.CHECK_INTERVAL);

    // Scan existing tabs on startup
    this.scanExistingTabs();

    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.monitoredTabs.delete(tabId);
    });

    // Listen for messages from content scripts and popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      return this.handleMessage(request, sender, sendResponse);
    });
  }

  async scanExistingTabs() {
    console.log('=== SCANNING EXISTING TABS ===');
    try {
      const tabs = await chrome.tabs.query({});
      console.log(`Found ${tabs.length} total tabs`);

      for (const tab of tabs) {
        if (tab.url) {
          const tabType = this.getTabType(tab.url);
          if (tabType) {
            console.log(`Found existing ${tabType} tab (ID: ${tab.id}): ${tab.url}`);
            if (!this.monitoredTabs.has(tab.id)) {
              const isInMeetingRoom = tabType === 'meet' && this.isGoogleMeetMeetingRoom(tab.url);
              const tabInfo = {
                url: tab.url,
                startTime: Date.now(),
                type: tabType,
                homePageReturnTime: null,
                wasInMeeting: isInMeetingRoom  // If currently in meeting room, track it
              };
              this.monitoredTabs.set(tab.id, tabInfo);
              console.log(`Added existing tab ${tab.id} to monitoring (wasInMeeting: ${isInMeetingRoom})`);

              // For existing Meet tabs on home page, check RECENT browser history
              // to see if this is likely a post-meeting tab
              if (tabType === 'meet' && this.isGoogleMeetHomePage(tab.url)) {
                console.log(`Existing Meet tab ${tab.id} is on home page - checking recent history`);
                await this.checkRecentMeetingHistory(tab.id, tabInfo);
              }
            }
          }
        }
      }
      console.log(`=== SCAN COMPLETE: Now monitoring ${this.monitoredTabs.size} tabs ===`);
    } catch (error) {
      console.error('Error scanning existing tabs:', error);
    }
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    console.log(`=== handleTabUpdate START ===`);
    console.log(`TabID: ${tabId}, ChangeInfo:`, changeInfo, `Tab URL: ${tab.url}`);

    // For Zoom tabs, also check on 'loading' status since they may launch external handler
    // before reaching 'complete' status
    const shouldProcess = (changeInfo.status === 'complete' && tab.url) ||
                          (changeInfo.status === 'loading' && tab.url && tab.url.includes('.zoom.us'));

    if (shouldProcess) {
      console.log(`Tab ${tabId} processing (status: ${changeInfo.status}): ${tab.url}`);
      const tabType = this.getTabType(tab.url);
      console.log(`getTabType result for ${tab.url}: ${tabType}`);

      if (tabType) {
        console.log(`Tab ${tabId} is a ${tabType} meeting tab`);
        // This is a meeting tab we should monitor
        if (!this.monitoredTabs.has(tabId)) {
          console.log(`Tab ${tabId} is NEW - creating monitoring entry`);
          const isInMeetingRoom = tabType === 'meet' && this.isGoogleMeetMeetingRoom(tab.url);
          this.monitoredTabs.set(tabId, {
            url: tab.url,
            startTime: Date.now(),
            type: tabType,
            homePageReturnTime: null,
            wasInMeeting: isInMeetingRoom  // Track if THIS tab visited a meeting room
          });
          console.log(`Now monitoring ${tabType} tab (ID: ${tabId}): ${tab.url}`);
          console.log(`Tab ${tabId} monitoring data:`, this.monitoredTabs.get(tabId));

          // For Google Meet, if new tab opens directly on home page, don't close (user typed URL directly)
          if (tabType === 'meet') {
            const isHomePage = this.isGoogleMeetHomePage(tab.url);
            console.log(`Tab ${tabId} NEW Meet tab - isHomePage: ${isHomePage}, wasInMeeting: ${isInMeetingRoom}`);
            // New tab on home page = user typed URL directly, don't close
            // New tab on meeting room = will be tracked, close when they return to home page
          }
        } else {
          console.log(`Tab ${tabId} is EXISTING - updating monitoring entry`);
          // Update existing tab info
          const tabInfo = this.monitoredTabs.get(tabId);
          console.log(`Tab ${tabId} OLD data:`, JSON.stringify(tabInfo));
          tabInfo.url = tab.url;
          console.log(`Tab ${tabId} NEW URL: ${tab.url}`);

          // For Google Meet, track meeting room visits and handle home page returns
          if (tabType === 'meet') {
            console.log(`=== GOOGLE MEET LOGIC START for tab ${tabId} ===`);

            const isHomePage = this.isGoogleMeetHomePage(tab.url);
            const isInMeetingRoom = this.isGoogleMeetMeetingRoom(tab.url);

            console.log(`Tab ${tabId} isHomePage: ${isHomePage}, isInMeetingRoom: ${isInMeetingRoom}, wasInMeeting: ${tabInfo.wasInMeeting}`);

            // Track if this tab visits a meeting room
            if (isInMeetingRoom && !tabInfo.wasInMeeting) {
              tabInfo.wasInMeeting = true;
              console.log(`Tab ${tabId} ENTERED MEETING ROOM - wasInMeeting set to true`);
            }

            // If returned to home page after being in a meeting, trigger close logic
            if (isHomePage && tabInfo.wasInMeeting) {
              console.log(`Tab ${tabId} RETURNED TO HOME PAGE after meeting`);
              if (this.config.meetTimer === 0) {
                console.log(`Tab ${tabId} IMMEDIATE CLOSURE (meetTimer = 0)`);
                this.closeTab(tabId, 'meet-post-meeting-immediate-close');
              } else {
                if (!tabInfo.homePageReturnTime) {
                  tabInfo.homePageReturnTime = Date.now();
                  console.log(`Tab ${tabId} TIMER STARTED at ${new Date().toISOString()}`);
                }
              }
            } else if (isHomePage) {
              console.log(`Tab ${tabId} on home page but wasInMeeting=false - not closing`);
            }

            console.log(`=== GOOGLE MEET LOGIC END for tab ${tabId} ===`);
          }
          console.log(`Tab ${tabId} FINAL data:`, JSON.stringify(this.monitoredTabs.get(tabId)));
        }
      } else {
        console.log(`Tab ${tabId} is NOT a meeting tab`);
        if (this.monitoredTabs.has(tabId)) {
          console.log(`Tab ${tabId} navigated away from meeting site - removing from monitoring`);
          // Tab navigated away from meeting site
          this.monitoredTabs.delete(tabId);
        }
      }
    } else {
      console.log(`Tab ${tabId} update ignored - status: ${changeInfo.status}, hasURL: ${!!tab.url}, isZoom: ${tab.url ? tab.url.includes('.zoom.us') : false}`);
    }
    console.log(`=== handleTabUpdate END ===`);
  }

  handleMessage(request, sender, sendResponse) {
    console.log(`=== handleMessage START ===`);
    console.log(`Request:`, request, `Sender:`, sender);

    // Handle popup messages
    if (request.action === 'getClosedCount') {
      console.log('Getting closed count:', this.closedTabsCount);
      this.getClosedTabsCount().then(count => {
        console.log('Sending count to popup:', count);
        sendResponse({count: count});
      });
      return true; // Keep message channel open for async response
    } else if (request.action === 'resetCounter') {
      console.log('Resetting counter');
      this.resetCounter().then(() => {
        sendResponse({success: true});
      });
      return true;
    } else if (request.action === 'getConfiguration') {
      console.log('Getting configuration:', this.config);
      sendResponse({config: this.config});
      return false;
    } else if (request.action === 'saveConfiguration') {
      console.log('Saving configuration:', request.config);
      this.config = {...this.config, ...request.config};
      chrome.storage.local.set({timerConfig: this.config}).then(() => {
        sendResponse({success: true});
      });
      return true;
    }

    sendResponse({success: true});
    return false;
  }

  // Check recent browser history (last 15 minutes) for meeting URLs
  // Used for scanned tabs where we don't have in-memory state
  async checkRecentMeetingHistory(tabId, tabInfo) {
    console.log(`=== CHECKING RECENT MEETING HISTORY for tab ${tabId} ===`);

    try {
      // Check last 15 minutes to catch meetings that just ended
      // Extension may have just been installed/updated after a meeting
      const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000);

      const historyItems = await chrome.history.search({
        text: 'meet.google.com/',
        startTime: fifteenMinutesAgo,
        maxResults: 100
      });

      console.log(`Tab ${tabId} found ${historyItems.length} Meet URLs in last 15 minutes`);

      // Look for meeting room URLs (not home pages)
      const meetingUrls = historyItems.filter(item => {
        const hasMeetingCode = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(item.url);
        if (hasMeetingCode) {
          console.log(`Tab ${tabId} recent meeting URL: ${item.url} at ${new Date(item.lastVisitTime).toISOString()}`);
        }
        return hasMeetingCode;
      });

      console.log(`Tab ${tabId} found ${meetingUrls.length} recent meeting room URLs`);

      if (meetingUrls.length > 0) {
        console.log(`Tab ${tabId} RECENT MEETING DETECTED - marking as post-meeting tab`);
        tabInfo.wasInMeeting = true;

        // Trigger closure logic
        if (this.config.meetTimer === 0) {
          console.log(`Tab ${tabId} IMMEDIATE CLOSURE (meetTimer = 0, recent meeting detected)`);
          this.closeTab(tabId, 'meet-recent-history-immediate-close');
        } else {
          tabInfo.homePageReturnTime = Date.now();
          console.log(`Tab ${tabId} TIMER STARTED based on recent history`);
        }
      } else {
        console.log(`Tab ${tabId} NO recent meeting history found`);

        // If meetTimer is 0, assume this is a post-meeting tab and close after brief grace period
        // This handles cases where:
        // 1. Extension was just installed/reloaded
        // 2. History is unavailable
        // 3. Meeting was >15 minutes ago
        if (this.config.meetTimer === 0) {
          console.log(`Tab ${tabId} meetTimer=0, assuming post-meeting tab - will close after 30s grace period`);
          tabInfo.wasInMeeting = true;
          tabInfo.homePageReturnTime = Date.now();
          // Set a 30-second grace period timer instead of immediate closure
          // This prevents closing tabs that users intentionally opened
          tabInfo.gracePeriodTimer = 30; // seconds
        } else {
          console.log(`Tab ${tabId} NO recent meeting history - treating as directly opened tab (won't close)`);
        }
      }
    } catch (error) {
      console.error(`Tab ${tabId} Error checking recent history:`, error);
    }

    console.log(`=== RECENT MEETING HISTORY CHECK END ===`);
  }

  getTabType(url) {
    // More comprehensive Zoom detection for all domains and paths
    if (url.includes('.zoom.us')) {
      // Exclude specific non-meeting Zoom pages that should never be closed
      const excludedPages = [
        'zoom.us/',
        'zoom.us/profile',
        'zoom.us/settings'
      ];

      // Check if URL exactly matches any excluded page (with or without https://)
      const isExcludedPage = excludedPages.some(page => {
        return url === 'https://' + page ||
               url === 'http://' + page ||
               url.endsWith('/' + page) ||
               url.includes('/' + page + '?') ||
               url.includes('/' + page + '#');
      });

      if (isExcludedPage) {
        return null; // Don't monitor these pages
      }

      // Check for specific meeting-related paths (use primary zoom timer)
      if (url.includes('/j/') ||       // Join URLs
          url.includes('/s/') ||       // Start URLs
          url.includes('/w/') ||       // Webinar URLs
          url.includes('/my/') ||      // Personal meeting room URLs
          url.includes('/postattendee')) {  // Post-meeting attendee page
        return 'zoom';
      }

      // Any other zoom.us subdomain URL (use fallback timer)
      return 'zoom-fallback';
    } else if (url.includes('teams.microsoft.com/dl/launcher/')) {
      return 'teams';
    } else if (url.includes('meet.google.com/')) {
      return 'meet';
    }
    return null;
  }

  isGoogleMeetHomePage(url) {
    // Check for various Google Meet home page patterns
    const isHomePage = url.includes('meet.google.com/landing') ||
           url.includes('meet.google.com/?') ||
           url === 'https://meet.google.com/' ||
           url === 'https://meet.google.com' ||
           (url.includes('meet.google.com') && !url.match(/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/) && !url.includes('/lookup/'));

    console.log(`isGoogleMeetHomePage check: ${url} -> ${isHomePage}`);
    return isHomePage;
  }

  isGoogleMeetMeetingRoom(url) {
    // Check if URL is a meeting room (has the abc-defg-hij pattern)
    const isMeetingRoom = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(url);
    console.log(`isGoogleMeetMeetingRoom check: ${url} -> ${isMeetingRoom}`);
    return isMeetingRoom;
  }

  async checkTabsForClosure() {
    const now = Date.now();
    console.log(`Checking ${this.monitoredTabs.size} monitored tabs for closure...`);

    for (const [tabId, tabInfo] of this.monitoredTabs.entries()) {
      const timeElapsed = now - tabInfo.startTime;
      const secondsElapsed = Math.floor(timeElapsed / 1000);

      console.log(`Tab ${tabId} (${tabInfo.type}): ${secondsElapsed}s elapsed`);

      // Check if tab should be closed based on type and timing
      if (this.shouldCloseTab(tabInfo, timeElapsed)) {
        console.log(`Closing tab ${tabId} after ${secondsElapsed}s`);
        await this.closeTab(tabId, `${tabInfo.type}-timeout`);
      }
    }
  }

  shouldCloseTab(tabInfo, timeElapsed) {
    switch (tabInfo.type) {
      case 'zoom':
        // Use configured zoom timer (convert seconds to milliseconds)
        return timeElapsed >= (this.config.zoomTimer * 1000);
      case 'zoom-fallback':
        // Use fallback zoom timer for other zoom.us pages (convert seconds to milliseconds)
        return timeElapsed >= (this.config.fallbackZoomTimer * 1000);
      case 'teams':
        // Use configured teams timer (convert seconds to milliseconds)
        return timeElapsed >= (this.config.teamsTimer * 1000);
      case 'meet':
        // For Meet, only close after timer if user has returned to home page
        if (tabInfo.homePageReturnTime) {
          const timeSinceHomeReturn = Date.now() - tabInfo.homePageReturnTime;

          // If there's a grace period timer (e.g., for tabs without clear meeting history)
          const effectiveTimer = tabInfo.gracePeriodTimer || this.config.meetTimer;

          // meetTimer = 0 with grace period means close after grace period
          // meetTimer = 0 without grace period is handled immediately in handleTabUpdate
          if (effectiveTimer > 0) {
            const shouldClose = timeSinceHomeReturn >= (effectiveTimer * 1000);
            console.log(`Meet tab should close check: timeSinceReturn=${Math.floor(timeSinceHomeReturn/1000)}s, effectiveTimer=${effectiveTimer}s (grace=${tabInfo.gracePeriodTimer}, config=${this.config.meetTimer}), shouldClose=${shouldClose}`);
            return shouldClose;
          }
        }
        // Don't close via periodic check if meetTimer is 0 without grace period (handled immediately) or if timer hasn't started
        return false;
      default:
        return false;
    }
  }

  async closeTab(tabId, reason) {
    try {
      await chrome.tabs.remove(tabId);
      this.monitoredTabs.delete(tabId);
      this.closedTabsCount++;

      // Save counter to storage
      await chrome.storage.local.set({closedTabsCount: this.closedTabsCount});

      console.log(`Closed tab ${tabId} - Reason: ${reason} - Total closed: ${this.closedTabsCount}`);
    } catch (error) {
      console.error('Error closing tab:', error);
      // Tab might have been manually closed, just remove from monitoring
      this.monitoredTabs.delete(tabId);
    }
  }

  async getClosedTabsCount() {
    return this.closedTabsCount;
  }

  async resetCounter() {
    this.closedTabsCount = 0;
    await chrome.storage.local.set({closedTabsCount: 0});
  }
}

// Initialize the tab closer
const tabCloser = new TabCloser();

// TabCloser instance is initialized and handles all messages through its handleMessage method