# Zoom/Teams/Meet Tab Closer Chrome Extension

A silent Chrome extension that automatically closes Zoom, Teams, and Google Meet tabs when they're no longer needed, helping you keep your browser clean and organized.

## Features

- **Automatic Tab Closing** (configured for testing):
  - Zoom tabs: Closed after 10 seconds of being open
  - Teams tabs: Closed after 10 seconds of being open
  - Google Meet tabs: Closed when returning to the Meet home page after being in a meeting
- **Tab Counter**: Track how many tabs the extension has closed for you
- **Silent Operation**: Works in the background without interrupting your workflow
- **Clean Interface**: Simple popup to view statistics and reset counter

## Installation

### From Source (Developer Mode)

1. **Download or Clone** this repository to your computer
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right corner
4. **Click "Load Unpacked"** and select the extension folder
5. **Pin the Extension** (optional) by clicking the puzzle piece icon and pinning the extension

### File Structure
```
Zoom-meet-teams-tab-closer/
├── manifest.json          # Extension configuration
├── background.js          # Main logic for tab monitoring
├── content.js            # Script for detecting meeting states
├── popup.html           # Extension popup interface
├── popup.css           # Popup styling
├── popup.js            # Popup functionality
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md          # This file
```

## How It Works

### Detection Logic

- **Zoom**: Monitors tabs with URLs containing `zoom.us/j/` or `zoom.us/s/` and closes them after 10 seconds (testing mode)
- **Teams**: Monitors tabs with URLs containing `teams.microsoft.com/dl/launcher/` and closes them after 10 seconds (testing mode)
- **Google Meet**: Monitors Meet tabs and closes them when the user returns to the Meet home page (`meet.google.com/landing`) after being in a meeting

### Privacy

This extension:
- ✅ Only monitors tabs on meeting platforms (Zoom, Teams, Meet)
- ✅ Stores only a counter of closed tabs locally
- ✅ Does not collect or transmit any personal data
- ✅ Works entirely offline after installation

## Usage

1. **Install the extension** following the instructions above
2. **Use meeting platforms normally** - the extension works silently in the background
3. **Click the extension icon** to view how many tabs have been closed
4. **Reset the counter** anytime using the "Reset Counter" button in the popup

## Permissions Explained

- `tabs`: Required to monitor and close tabs
- `storage`: Required to store the closed tabs counter
- `activeTab`: Required for content script injection
- Host permissions for meeting domains: Required to monitor meeting platforms

## Troubleshooting

**Extension not working?**
- Make sure Developer Mode is enabled in Chrome Extensions
- Check that the extension is enabled and not in error state
- Try reloading the extension from `chrome://extensions/`

**Tabs not closing?**
- The extension waits 10 seconds before closing Zoom/Teams tabs (testing mode)
- For Google Meet, tabs only close when returning to the home page after a meeting
- Check that the URLs match the expected patterns

**Counter not updating?**
- Click the extension icon to refresh the counter
- The counter updates every 30 seconds while monitoring tabs

## Technical Details

- **Manifest Version**: 3 (latest Chrome extension standard)
- **Background Script**: Service worker for efficient resource usage
- **Content Scripts**: Lightweight scripts for meeting state detection
- **Storage**: Local storage only, no cloud sync

## Contributing

This extension was built to solve a specific workflow problem. If you encounter issues or have suggestions:

1. Check the browser console for any errors
2. Verify the tab URLs match the detection patterns
3. Test with a fresh browser profile to isolate conflicts

## License

This project is provided as-is for personal use. Feel free to modify and adapt to your needs.