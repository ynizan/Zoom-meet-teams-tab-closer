// Content script for meeting tab management and auto-admit
console.log('Content script loaded on:', window.location.href);

// Auto-admit configuration
const AUTO_ADMIT_CONFIGS = [
  { key: 'fathomAutoAdmit', patterns: [{ mustContain: ['yaniv', 'fathom'] }] },
  { key: 'shaulAutoAdmit', patterns: [{ mustContain: ['shaul'] }] }
];

// Track enabled state per config
let autoAdmitEnabled = { fathomAutoAdmit: true, shaulAutoAdmit: true };

// Check if a name matches any enabled auto-admit pattern
function shouldAutoAdmit(name) {
  const nameLower = name.toLowerCase();

  for (const config of AUTO_ADMIT_CONFIGS) {
    if (!autoAdmitEnabled[config.key]) continue;
    for (const pattern of config.patterns) {
      if (pattern.mustContain) {
        const allMatch = pattern.mustContain.every(term => nameLower.includes(term));
        if (allMatch) {
          console.log(`[AutoAdmit] Name "${name}" matches pattern (${config.key}):`, pattern);
          return true;
        }
      }
    }
  }
  return false;
}

// Load auto-admit enabled states
async function loadAutoAdmitSettings() {
  try {
    const keys = AUTO_ADMIT_CONFIGS.map(c => c.key);
    const result = await chrome.storage.local.get(keys);
    for (const config of AUTO_ADMIT_CONFIGS) {
      autoAdmitEnabled[config.key] = result[config.key] !== false;
    }
  } catch (error) {
    for (const config of AUTO_ADMIT_CONFIGS) {
      autoAdmitEnabled[config.key] = true;
    }
  }
}

// Listen for storage changes to react immediately to toggles
chrome.storage.onChanged.addListener((changes) => {
  for (const config of AUTO_ADMIT_CONFIGS) {
    if (changes[config.key]) {
      autoAdmitEnabled[config.key] = changes[config.key].newValue !== false;
      console.log(`[AutoAdmit] ${config.key} changed to:`, autoAdmitEnabled[config.key]);
    }
  }
});

// Google Meet auto-admit functionality
function setupGoogleMeetAutoAdmit() {
  if (!window.location.href.includes('meet.google.com')) return;

  console.log('[AutoAdmit] Setting up Google Meet auto-admit observer');

  // Load initial settings
  loadAutoAdmitSettings();

  // Check if any auto-admit is enabled
  function isAnyAutoAdmitEnabled() {
    return Object.values(autoAdmitEnabled).some(v => v);
  }

  // Observer to watch for DOM changes (waiting room notifications)
  const observer = new MutationObserver((mutations) => {
    if (!isAnyAutoAdmitEnabled()) return;
    checkForWaitingNotification();
    checkForWaitingParticipants();
  });

  // Start observing the document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also check periodically in case we miss mutations
  let checkCount = 0;
  setInterval(() => {
    if (!isAnyAutoAdmitEnabled()) return;
    checkCount++;
    if (checkCount % 5 === 1) { // Log every 10 seconds (5 * 2s interval)
      console.log(`[AutoAdmit] Periodic check #${checkCount}`);
    }
    checkForWaitingNotification();
    checkForWaitingParticipants();
  }, 2000);
}

// Check if Fathom is already in the meeting
function isFathomAlreadyInMeeting() {
  // Check all text on page for participant names
  const pageText = document.body.innerText?.toLowerCase() || '';

  // Look for Fathom in participant-related areas
  const participantContainers = document.querySelectorAll(
    '[role="listitem"], [data-participant-id], [data-self-name]'
  );

  for (const container of participantContainers) {
    const text = container.textContent?.toLowerCase() || '';
    // Check if this participant matches our pattern and is NOT in a waiting/admit context
    if (text.includes('yaniv') && text.includes('fathom')) {
      // Make sure it's not in a "waiting to join" context
      const parentText = container.closest('[role="list"]')?.textContent?.toLowerCase() || '';
      if (!parentText.includes('waiting') && !parentText.includes('admit')) {
        console.log('[AutoAdmit] Fathom is already in the meeting, skipping auto-admit');
        return true;
      }
    }
  }

  // Also check if "Yaniv's Fathom" appears in the main meeting area (not admit area)
  // by looking for it outside of any admit-related UI
  const meetingParticipants = document.querySelectorAll('[data-self-name]');
  for (const el of meetingParticipants) {
    const name = el.getAttribute('data-self-name')?.toLowerCase() || el.textContent?.toLowerCase() || '';
    if (name.includes('yaniv') && name.includes('fathom')) {
      console.log('[AutoAdmit] Fathom found in meeting participants, skipping auto-admit');
      return true;
    }
  }

  return false;
}

// Check for "Admit X guest" button and click it to reveal waiting participants
let lastButtonCount = 0;
function checkForWaitingNotification() {
  // Skip if Fathom is already in the meeting
  if (isFathomAlreadyInMeeting()) {
    return;
  }

  // Look for the green "Admit X guest" button
  const allButtons = document.querySelectorAll('button');

  // Only log button count when it changes
  if (allButtons.length !== lastButtonCount) {
    console.log(`[AutoAdmit] Button count changed: ${lastButtonCount} -> ${allButtons.length}`);
    lastButtonCount = allButtons.length;
  }

  for (const button of allButtons) {
    const buttonText = button.textContent?.trim() || '';
    const buttonTextLower = buttonText.toLowerCase();
    const ariaLabel = button.getAttribute('aria-label') || '';
    const ariaLabelLower = ariaLabel.toLowerCase();
    const className = button.className || '';
    const innerHTML = button.innerHTML?.substring(0, 100) || '';

    // Log buttons that contain "admit" anywhere
    if (buttonTextLower.includes('admit') || ariaLabelLower.includes('admit')) {
      console.log(`[AutoAdmit] Found button with "admit":`, {
        text: buttonText,
        ariaLabel: ariaLabel,
        className: className,
        innerHTML: innerHTML
      });
    }

    // Match "Admit 1 guest", "Admit 2 guests", etc.
    if (buttonTextLower.includes('admit') && buttonTextLower.includes('guest')) {
      console.log('[AutoAdmit] ✓ MATCH: Found "Admit guest" button, clicking to reveal waiting participants');
      button.click();
      return;
    }

    // Also check aria-label
    if (ariaLabelLower.includes('admit') && ariaLabelLower.includes('guest')) {
      console.log('[AutoAdmit] ✓ MATCH: Found "Admit guest" button via aria-label, clicking');
      button.click();
      return;
    }
  }

  // Also search for any element (not just buttons) with "Admit" text
  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.children.length === 0) { // Leaf nodes only
      const text = el.textContent?.trim() || '';
      if (text.toLowerCase().includes('admit') && text.toLowerCase().includes('guest')) {
        console.log(`[AutoAdmit] Found non-button element with "Admit guest":`, {
          tag: el.tagName,
          text: text,
          className: el.className,
          parentTag: el.parentElement?.tagName
        });
        // Try clicking the parent if it's clickable
        const clickable = el.closest('button, [role="button"], [onclick], a');
        if (clickable) {
          console.log('[AutoAdmit] ✓ Found clickable parent, clicking');
          clickable.click();
          return;
        }
      }
    }
  }

}

function checkForWaitingParticipants() {
  // Skip if Fathom is already in the meeting
  if (isFathomAlreadyInMeeting()) {
    return;
  }

  // Google Meet uses various UI elements for admit requests
  // Look for the "Someone wants to join" notification or sidebar

  // Method 1: Look for admit buttons with nearby participant names
  // The admit button typically has "Admit" text and is near the participant name
  const allButtons = document.querySelectorAll('button');

  for (const button of allButtons) {
    const buttonText = button.textContent?.toLowerCase() || '';

    // Check if this is an "Admit" button
    if (buttonText.includes('admit') && !buttonText.includes('admit all')) {
      // Find the participant name near this button
      const container = button.closest('[data-participant-id]') ||
                        button.closest('[role="listitem"]') ||
                        button.parentElement?.parentElement?.parentElement;

      if (container) {
        const nameElement = container.querySelector('[data-self-name]') ||
                           container.querySelector('[data-participant-id]') ||
                           findNameInContainer(container);

        const participantName = nameElement?.textContent ||
                               container.textContent?.split('Admit')[0]?.trim() || '';

        if (participantName && shouldAutoAdmit(participantName)) {
          console.log(`[AutoAdmit] Auto-admitting: "${participantName}"`);
          button.click();
          return; // Process one at a time
        }
      }
    }
  }

  // Method 2: Look for the waiting room sidebar/panel
  // Google Meet sometimes shows waiting participants in a panel
  const waitingPanels = document.querySelectorAll('[aria-label*="waiting"]');
  for (const panel of waitingPanels) {
    const names = panel.querySelectorAll('[data-self-name], [role="listitem"]');
    for (const nameEl of names) {
      const name = nameEl.textContent || '';
      if (shouldAutoAdmit(name)) {
        // Find and click the admit button for this participant
        const admitBtn = nameEl.querySelector('button') ||
                        nameEl.parentElement?.querySelector('button');
        if (admitBtn) {
          console.log(`[AutoAdmit] Auto-admitting from panel: "${name}"`);
          admitBtn.click();
          return;
        }
      }
    }
  }
}

function findNameInContainer(container) {
  // Try to find a name element in the container
  // Names are usually in spans or divs without "Admit" or "Deny" text
  const textElements = container.querySelectorAll('span, div');
  for (const el of textElements) {
    const text = el.textContent?.trim() || '';
    if (text &&
        !text.toLowerCase().includes('admit') &&
        !text.toLowerCase().includes('deny') &&
        text.length > 2 &&
        text.length < 100) {
      return el;
    }
  }
  return null;
}

// Initialize based on current page
if (window.location.href.includes('meet.google.com')) {
  // Wait for page to fully load
  if (document.readyState === 'complete') {
    setupGoogleMeetAutoAdmit();
  } else {
    window.addEventListener('load', setupGoogleMeetAutoAdmit);
  }
}