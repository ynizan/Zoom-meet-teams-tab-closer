// Content script for meeting tab management and auto-admit
console.log('Content script loaded on:', window.location.href);

// Auto-admit configuration
const AUTO_ADMIT_CONFIGS = [
  { key: 'fathomAutoAdmit', patterns: [{ mustContain: ['yaniv', 'fathom'] }] },
  { key: 'shaulAutoAdmit', patterns: [{ mustContain: ['shaul'] }] }
];

// Track enabled state per config
let autoAdmitEnabled = { fathomAutoAdmit: true, shaulAutoAdmit: true };

// Cooldown tracking — prevent frantic clicking
let lastClickTime = 0;
const CLICK_COOLDOWN_MS = 5000;

function isOnCooldown() {
  return Date.now() - lastClickTime < CLICK_COOLDOWN_MS;
}

function recordClick() {
  lastClickTime = Date.now();
}

function isAnyAutoAdmitEnabled() {
  return Object.values(autoAdmitEnabled).some(v => v);
}

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

  console.log('[AutoAdmit] Setting up Google Meet auto-admit');

  loadAutoAdmitSettings();

  // Observer to watch for DOM changes (waiting room notifications)
  const observer = new MutationObserver(() => {
    if (!isAnyAutoAdmitEnabled()) return;
    if (isOnCooldown()) return;
    checkForWaitingNotification();
    checkForWaitingParticipants();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Also check periodically in case we miss mutations
  let checkCount = 0;
  setInterval(() => {
    if (!isAnyAutoAdmitEnabled()) return;
    if (isOnCooldown()) return;
    checkCount++;
    if (checkCount % 5 === 1) {
      console.log(`[AutoAdmit] Periodic check #${checkCount}`);
    }
    checkForWaitingNotification();
    checkForWaitingParticipants();
  }, 2000);
}

// Click "Admit X guest" button to reveal waiting participants, and open participants panel
function checkForWaitingNotification() {
  const allButtons = document.querySelectorAll('button');

  for (const button of allButtons) {
    const buttonText = button.textContent?.trim()?.toLowerCase() || '';
    const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();

    // Match "Admit 1 guest", "Admit 2 guests", etc.
    if ((buttonText.includes('admit') && buttonText.includes('guest')) ||
        (ariaLabel.includes('admit') && ariaLabel.includes('guest'))) {
      console.log('[AutoAdmit] Found "Admit guest" button, clicking to reveal waiting participants');
      button.click();
      recordClick();
      return;
    }
  }

  // Fallback: look for notification text and open participants panel
  const notificationTexts = [
    'wants to join',
    'waiting to join',
    'asking to join',
    'wants to be admitted'
  ];

  const allText = document.body.innerText?.toLowerCase() || '';
  const hasWaitingNotification = notificationTexts.some(text => allText.includes(text));

  if (hasWaitingNotification) {
    console.log('[AutoAdmit] Detected waiting notification text, ensuring participants panel is open');
    openParticipantsPanel();
  }
}

// Open the participants panel (and leave it open)
function openParticipantsPanel() {
  // Check if panel is already open
  const panelOpen = document.querySelector('[aria-label*="articipant"]')?.closest('[role="complementary"]') ||
                    document.querySelector('[data-panel-id="2"]');

  if (panelOpen && panelOpen.offsetParent !== null) return;

  const participantsButton =
    document.querySelector('button[aria-label*="articipant"]') ||
    document.querySelector('button[aria-label*="people"]') ||
    document.querySelector('[data-panel-id="2"]') ||
    findParticipantsButtonByIcon();

  if (participantsButton) {
    console.log('[AutoAdmit] Opening participants panel');
    participantsButton.click();
  }
}

function findParticipantsButtonByIcon() {
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    const tooltip = btn.getAttribute('data-tooltip')?.toLowerCase() || '';

    if (ariaLabel.includes('participant') || ariaLabel.includes('people') ||
        tooltip.includes('participant') || tooltip.includes('people') ||
        ariaLabel.includes('show everyone')) {
      return btn;
    }
  }
  return null;
}

// Scan for individual "Admit" buttons next to participant names and click only for matches
function checkForWaitingParticipants() {
  const allButtons = document.querySelectorAll('button');

  for (const button of allButtons) {
    const buttonText = button.textContent?.toLowerCase() || '';

    // Skip "Admit all" and "Admit X guest(s)" buttons — we only want per-participant Admit
    if (buttonText.includes('admit all') || buttonText.includes('guest')) continue;
    if (!buttonText.includes('admit')) continue;

    const container = button.closest('[data-participant-id]') ||
                      button.closest('[role="listitem"]') ||
                      button.parentElement?.parentElement?.parentElement;

    if (!container) continue;

    const participantName = extractParticipantName(container);

    if (participantName) {
      console.log(`[AutoAdmit] Found waiting participant: "${participantName}"`);
      if (shouldAutoAdmit(participantName)) {
        console.log(`[AutoAdmit] Auto-admitting: "${participantName}"`);
        button.click();
        recordClick();
        return;
      }
    }
  }

  // Also check waiting room panel areas
  const waitingPanels = document.querySelectorAll('[aria-label*="waiting"]');
  for (const panel of waitingPanels) {
    const items = panel.querySelectorAll('[data-self-name], [role="listitem"]');
    for (const item of items) {
      const name = item.textContent || '';
      if (shouldAutoAdmit(name)) {
        const admitBtn = item.querySelector('button') ||
                        item.parentElement?.querySelector('button');
        if (admitBtn) {
          console.log(`[AutoAdmit] Auto-admitting from panel: "${name}"`);
          admitBtn.click();
          recordClick();
          return;
        }
      }
    }
  }
}

function extractParticipantName(container) {
  const nameEl = container.querySelector('[data-self-name]') ||
                 container.querySelector('[data-participant-id]');

  if (nameEl) {
    return nameEl.getAttribute('data-self-name') || nameEl.textContent?.trim() || '';
  }

  // Fallback: find text that isn't a button label
  const textElements = container.querySelectorAll('span, div');
  for (const el of textElements) {
    const text = el.textContent?.trim() || '';
    if (text &&
        !text.toLowerCase().includes('admit') &&
        !text.toLowerCase().includes('deny') &&
        text.length > 2 &&
        text.length < 100) {
      return text;
    }
  }

  // Last resort: text before "Admit" in the container
  return container.textContent?.split(/admit/i)[0]?.trim() || '';
}

// Initialize based on current page
if (window.location.href.includes('meet.google.com')) {
  if (document.readyState === 'complete') {
    setupGoogleMeetAutoAdmit();
  } else {
    window.addEventListener('load', setupGoogleMeetAutoAdmit);
  }
}
