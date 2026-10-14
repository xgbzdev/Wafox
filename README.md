# WaFox – WhatsApp client for Firefox OS

A packaged (privileged) Firefox OS app plus a small self-hosted bridge.

## Why a bridge?
WhatsApp's protocol (encryption, multi-device, QR login) can't realistically run inside a
Firefox OS browser engine. The app talks to `bridge/server.js` over WebSocket/HTTP, and the
bridge talks to WhatsApp using the open-source Baileys library.
**This is an unofficial client: it is against WhatsApp's Terms of Service and your number could
be restricted. Use a secondary number, and never expose the bridge without the token (use a LAN or VPN).**

## Features
- Chat list, text messages, unread badges
- **Notifications** via `navigator.mozNotification` (permission `desktop-notification`),
  with a Web Notification fallback for desktop testing
- **Voice messages**: play/pause, seek bar, duration (Ogg/Opus)
- **Pictures & videos**: thumbnails in chat + fullscreen viewer; send from the 📎 button
- **Stickers**: shown in chat; **sticker maker** (pick a picture, zoom/pan, square/rounded/circle,
  caption) → 512×512 → sent as a sticker or saved to "My stickers" (☺ button in a chat)

## Run
1. Bridge (on a PC/Raspberry Pi, Node 18+):
   ```
   cd bridge && npm install
   TOKEN=choose-a-secret node server.js     # scan the QR: WhatsApp > Linked devices
   ```
2. App: load the `wafox` folder as a packaged app in WebIDE / Firefox OS Simulator
   (or zip it and install it on a device), then open ⚙ and enter
   `ws://<bridge-ip>:8787` and your token.
3. No bridge yet? Type `demo` as the URL to test the UI and a test notification.

## Notes
- The bridge keeps chat history in memory only (it restarts empty; new messages are captured live).
- Old Gecko can't encode WebP, so the app sends PNG and the bridge converts it to WebP.
- Bridge code is untested against your Baileys version; adjust imports/events if the API changed.
