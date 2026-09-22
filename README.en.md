# Browser v2ray Runner

🇮🇷 [نسخه‌ی فارسی](README.md)

Run proxy configs (VLESS, VMess, Trojan, Shadowsocks, SOCKS5) inside your browser only — no heavy background app, no system-wide settings changed. Turn the extension off and everything goes right back to normal.

## What is this?

A browser extension (Chrome, Edge, Firefox — on Windows) that takes your proxy links and routes only that browser's traffic through them. Nothing else on your computer (other apps, other browsers) is affected.

## Installation

Setup has two parts: installing the extension, and a one-time setup of a small local helper program the extension needs to work.

### Step 1 — Install the extension

**Firefox:**
If the extension is published on Firefox Add-ons, install it from there. Otherwise:
1. Download this whole repository (green "Code" button at the top of the GitHub page → "Download ZIP") and extract it
2. In Firefox, go to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select the `extension-firefox/manifest.json` file

> Note: this is a *temporary* install — you'll need to repeat this every time Firefox restarts. A permanent install requires the extension to be signed by Mozilla.

**Chrome / Edge:**
1. Download and extract the whole repository
2. Go to `chrome://extensions` (or `edge://extensions`)
3. Turn on "Developer mode" (top-right corner)
4. Click "Load unpacked" and select the `extension` folder (not the whole repo — that specific folder)

### Step 2 — Set up the local helper

The first time you install the extension, a new tab opens automatically and walks you through it:
1. Pick your language (English/Persian)
2. Download a small file (`install.bat`) and double-click it
3. A window opens showing exactly what it's about to download (file names and sizes) and waits for you to confirm
4. Once it's done, go back to that extension tab — it detects everything automatically and you're ready to go

> **This installer only touches your own Windows user account** — no admin rights needed, and nothing changes outside one folder (`%LOCALAPPDATA%\V2rayExtHost`).

> **If Windows shows a SmartScreen warning:** click "More info" then "Run anyway". This warning just means the file isn't digitally signed (which costs money to set up) — not that something is wrong. You can open the file itself and read exactly what it does.

## How to use it

1. Click the extension icon in your browser's toolbar
2. Paste a config link (`vless://...`, `trojan://...`, etc.) or a subscription link into the box and click "Add" — it figures out which kind it is automatically
3. Click "Connect" next to any config — the icon turns green and shows your outgoing IP and country
4. Click the same button again to disconnect

**Other features:**
- **Subs** tab: manage subscription links (auto-refreshes the config list). A default subscription is already included — remove or edit it as you like
- Test the speed of several configs at once (hit the test button)
- Sort configs by recency, speed, or name
- Change language and accent color from the **Settings** tab

## FAQ

**Does this affect my whole system?**
No. Only the browser the extension is installed in has its traffic routed through the proxy. Other apps and other browsers (if you haven't installed it there) are unaffected.

**Why does it need a separate helper program?**
For security reasons, browsers don't let extensions directly run network processes like a proxy. This small program (which is actually the proxy engine itself, [sing-box](https://github.com/SagerNet/sing-box)) does that job and only talks to this extension over a secure local channel.

**Do `ss://` links with plugins (like v2ray-plugin) work?**
Not currently.

**Can I be connected to more than one config at once?**
Only one at a time — connecting to a new config automatically disconnects the previous one.

---

For technical details, architecture, and maintainer/development notes, see [DEVELOPMENT.md](DEVELOPMENT.md).
