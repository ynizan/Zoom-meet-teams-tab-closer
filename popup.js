// Popup script for displaying counter and handling interactions
class PopupController {
  constructor() {
    this.closedCountElement = document.getElementById('closedCount');
    this.resetButton = document.getElementById('resetButton');
    this.statusElement = document.getElementById('status');
    this.saveConfigButton = document.getElementById('saveConfigButton');

    // Timer input elements
    this.zoomTimerInput = document.getElementById('zoomTimer');
    this.teamsTimerInput = document.getElementById('teamsTimer');
    this.meetTimerInput = document.getElementById('meetTimer');

    this.init();
  }

  async init() {
    // Load and display current counter
    await this.updateCounter();

    // Load current configuration
    await this.loadConfiguration();

    // Set up event listeners
    this.resetButton.addEventListener('click', () => this.resetCounter());
    this.saveConfigButton.addEventListener('click', () => this.saveConfiguration());

    // Update counter every few seconds while popup is open
    this.intervalId = setInterval(() => this.updateCounter(), 2000);

    // Clean up interval when popup closes
    window.addEventListener('beforeunload', () => {
      if (this.intervalId) {
        clearInterval(this.intervalId);
      }
    });
  }

  async updateCounter() {
    try {
      console.log('Popup: Requesting closed count...');
      const response = await chrome.runtime.sendMessage({action: 'getClosedCount'});
      console.log('Popup: Received response:', response);
      if (response && typeof response.count === 'number') {
        this.closedCountElement.textContent = response.count;
        this.updateStatus(true);
        console.log('Popup: Updated counter to:', response.count);
      } else {
        console.log('Popup: Invalid response, showing ?');
        this.closedCountElement.textContent = '?';
        this.updateStatus(false);
      }
    } catch (error) {
      console.error('Popup: Error getting closed count:', error);
      this.closedCountElement.textContent = '?';
      this.updateStatus(false);
    }
  }

  async resetCounter() {
    try {
      // Disable button temporarily
      this.resetButton.disabled = true;
      this.resetButton.textContent = 'Resetting...';

      const response = await chrome.runtime.sendMessage({action: 'resetCounter'});
      if (response && response.success) {
        this.closedCountElement.textContent = '0';
        this.showResetAnimation();
      }
    } catch (error) {
      console.error('Error resetting counter:', error);
    } finally {
      // Re-enable button
      setTimeout(() => {
        this.resetButton.disabled = false;
        this.resetButton.textContent = 'Reset Counter';
      }, 1000);
    }
  }

  updateStatus(isActive) {
    const indicator = this.statusElement.querySelector('.status-indicator');
    const statusText = this.statusElement.querySelector('span');

    if (isActive) {
      indicator.classList.add('active');
      indicator.style.background = '#4CAF50';
      statusText.textContent = 'Extension Active';
    } else {
      indicator.classList.remove('active');
      indicator.style.background = '#f44336';
      statusText.textContent = 'Extension Error';
    }
  }

  showResetAnimation() {
    // Add a brief animation to show reset was successful
    this.closedCountElement.style.transform = 'scale(1.2)';
    this.closedCountElement.style.color = '#4CAF50';

    setTimeout(() => {
      this.closedCountElement.style.transform = 'scale(1)';
      this.closedCountElement.style.color = '#FFE066';
    }, 300);
  }

  async loadConfiguration() {
    try {
      console.log('Popup: Loading configuration...');
      const response = await chrome.runtime.sendMessage({action: 'getConfiguration'});
      console.log('Popup: Configuration loaded:', response);

      if (response && response.config) {
        this.zoomTimerInput.value = response.config.zoomTimer || 600;
        this.teamsTimerInput.value = response.config.teamsTimer || 600;
        this.meetTimerInput.value = response.config.meetTimer || 0;
      }
    } catch (error) {
      console.error('Popup: Error loading configuration:', error);
      // Use default values if loading fails
      this.zoomTimerInput.value = 600;
      this.teamsTimerInput.value = 600;
      this.meetTimerInput.value = 0;
    }
  }

  async saveConfiguration() {
    try {
      // Disable button temporarily
      this.saveConfigButton.disabled = true;
      this.saveConfigButton.textContent = 'Saving...';
      this.saveConfigButton.classList.remove('success');

      const config = {
        zoomTimer: parseInt(this.zoomTimerInput.value) || 0,
        teamsTimer: parseInt(this.teamsTimerInput.value) || 0,
        meetTimer: parseInt(this.meetTimerInput.value) || 0
      };

      console.log('Popup: Saving configuration:', config);
      const response = await chrome.runtime.sendMessage({
        action: 'saveConfiguration',
        config: config
      });

      if (response && response.success) {
        this.showSaveSuccess();
        console.log('Popup: Configuration saved successfully');
      } else {
        throw new Error('Failed to save configuration');
      }
    } catch (error) {
      console.error('Popup: Error saving configuration:', error);
      this.showSaveError();
    } finally {
      // Re-enable button after delay
      setTimeout(() => {
        this.saveConfigButton.disabled = false;
        this.saveConfigButton.textContent = 'Save Settings';
        this.saveConfigButton.classList.remove('success');
      }, 2000);
    }
  }

  showSaveSuccess() {
    this.saveConfigButton.textContent = 'Saved!';
    this.saveConfigButton.classList.add('success');
  }

  showSaveError() {
    this.saveConfigButton.textContent = 'Error!';
    this.saveConfigButton.style.background = 'rgba(244, 67, 54, 0.3)';
    this.saveConfigButton.style.borderColor = 'rgba(244, 67, 54, 0.7)';
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});