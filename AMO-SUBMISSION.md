# AMO submission kit (maintainer notes)

Upload: contents of `extension-firefox/` (manifest.json at the zip root),
e.g. `cd extension-firefox && npx web-ext build`.
Add-on ID (permanent): `browser-v2ray-runner@hamedcode.github.io`
- must match `allowed_extensions` in `installer/install.bat`.
Uncheck "Firefox for Android" under compatibility (Windows-only extension).
License to select on AMO: Apache License 2.0. Privacy policy: paste PRIVACY.md.

## Summary (max 250 chars)
Run vless, vmess, trojan, shadowsocks and socks5 proxy configs inside Firefox only - no system-wide VPN. Subscriptions, parallel speed tests, live traffic and exit-IP display. Needs a small free Windows helper (native host).

## Description (paste into the listing)
Browser v2ray Runner lets you use v2ray-family proxy configs (vless, vmess, trojan, shadowsocks, socks5) only inside Firefox, without touching the rest of your system.

Features: subscription links, parallel real-delay testing, sorting, live traffic stats, exit IP + country display, English/Persian UI.

IMPORTANT - a companion program is required (Windows only). Browsers cannot run a proxy core from an extension, so the extension talks via native messaging to a small helper that runs sing-box locally. The first-run page in the extension guides you through the one-file installer (install.bat), which asks for confirmation before downloading anything. Source code of the extension, helper and installer: https://github.com/hamedcode/Browser-v2ray-runner

No data is sent to the developer. See the privacy policy.

## Notes to reviewer (paste into "Notes to Reviewer")
What it does: routes Firefox traffic through a local proxy via proxy.onRequest. Because browsers cannot spawn a proxy core, the extension uses nativeMessaging to talk to a small Go helper ("native-host/", source in the repo) which starts and stops a local sing-box process.

Source / build: extension code is plain JavaScript, not minified or bundled. common/browser-polyfill.js is the unmodified webextension-polyfill 0.12.0. Native host source: native-host/main.go (Go); the release binary used by the installer is attached to the GitHub release tag pinned in installer/install.bat. Installer: installer/install.bat (batch + embedded PowerShell) downloads v2ray-ext-host.exe from that release and sing-box from github.com/SagerNet/sing-box, asks for confirmation first, and registers the native messaging manifest (allowed_extensions is this add-on's ID).

Permissions: proxy (route traffic), nativeMessaging (talk to the local helper), storage (configs), host_permissions http(s)://*/* (required by proxy.onRequest to intercept all URLs, plus fetching subscription URLs the user adds and IP-lookup services).

Remote content: subscriptions are plain-text config lists (data only). There is no eval / new Function / remote code. Network calls are listed in PRIVACY.md (subscription URLs, api.ip.sb / ipwho.is / ipapi.co for exit IP, flagcdn.com for flag images).

How to test: the helper is required, so without it the popup shows the setup screen. To test: install the helper with installer/install.bat (Windows), restart Firefox, open the popup, add any vless/trojan/ss/socks5 link or use the pre-added default subscription, and press Connect. The exit IP/country appears when connected.

Data collection: declared "none" - nothing is sent to the developer or any server the developer controls.
