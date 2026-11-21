# Ark Outreach AI

A Chrome Extension for LinkedIn profile extraction, Deep Mode hook discovery, floating in-page outreach generation, and Gemini-powered personalized message drafting.

## Key Features
- **LinkedIn Profile Extraction (`content_script.js`):** Scrapes visible profile context from active LinkedIn profile pages and communicates with the extension background worker and floating widget.
- **Deep Mode & Hook Extraction:** Expands context and identifies relevant hooks for tailored outreach.
- **Floating In-Page Widget & Popup UI (`popup.html`, `popup.css`, `popup.js`):** Allows switching outreach goals, message formats (such as connection notes within character limits), regenerating messages, copying to clipboard, and managing settings.
- **Gemini API Integration (`background.js`):** Handles background API calls, key validation, and token/budget configuration for complete, non-truncated message generation.
- **Caching & Recent History (`utils/cache.js`):** Caches generated results and supports reviewing recent outreach items.

## Project Structure
```text
ark_abroad_extension/
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── utils/
│   └── cache.js
├── .gitignore
├── background.js
├── content_script.js
├── manifest.json
├── popup.css
├── popup.html
└── popup.js

Clone or download this repository:

1. git clone [https://github.com/abilashini593/ark-outreach-ai.git]
2. Open Chrome and navigate to chrome://extensions/
3. Enable Developer mode (top right).
4. Click Load unpacked and select the ark_abroad_extension folder.
5. Open the extension's Settings tab, enter your Gemini API key, and configure your sender/candidate profile details.

Usage
1.Open a LinkedIn profile (linkedin.com/in/...) in Chrome.
2.Launch Ark Outreach AI from the extension popup or the floating in-page widget.
3.Choose your outreach context and message format, generate or regenerate the draft, and copy it to your clipboard.
