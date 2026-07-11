# Alert Me

Cross-browser extension (Chrome / Edge / Brave via Manifest V3, Firefox-compatible) that monitors user-selected websites and notifies you when meaningful content changes.

## Install

### Chrome / Edge / Brave (development)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this directory (`alertme/`)

### Firefox (development)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `manifest.json` in this directory

## Store submission checklist

- [x] Privacy policy (`privacy.html`)
- [x] Production icons (`icons/`)
- [x] No auto-added test sites
- [x] Version 1.0.0
- [ ] Chrome Web Store developer account ($5 one-time)
- [ ] Firefox Add-ons (AMO) developer account
- [ ] Store listing screenshots and description
- [ ] Host privacy policy URL publicly (for Chrome review) — e.g. GitHub Pages

## Usage

- **Watch this page** — click the extension icon, then "Watch this page"
- **Watch section** — click "Watch section", then click any element on the page
- **Check now** — forces an immediate check of all watched sites (ignores frequency timer)
- **Dashboard** — click "Dashboard" in the popup footer, or right-click the extension → Options
- **Notifications** — OS notifications appear when significant changes are detected

## Privacy

All data is stored locally on your device. No accounts, no cloud sync, no analytics. See [privacy.html](privacy.html) for the full policy.

## Project structure

```
alertme/
├── manifest.json
├── privacy.html
├── background/service-worker.js
├── content/picker.js, picker.css
├── popup/popup.html, popup.css, popup.js
├── options/options.html, options.css, options.js
├── lib/browser.js, storage.js, diff.js
└── icons/icon16.png, icon48.png, icon128.png
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| Check frequency | 45 min | Per-site, configurable in dashboard |
| Significance threshold | 2% | Ignore changes below this % |
| History cap | 20 entries | Per site |

## Known limitations

- Browser must be running for background checks to fire
- Logged-in / paywalled pages may not monitor correctly
- JavaScript-heavy SPAs may miss dynamic content changes
- Minimum check interval is ~1 minute (browser alarm limit)
# alertme
