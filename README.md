<div align="center">

# 🪄 AI Form Filler — powered by your *local* Claude

**Fill any web form — Google Forms or plain HTML — from your own profile, using your local Claude Code subscription. No API key. No cost.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](extension/manifest.json)
[![Powered by Claude Code](https://img.shields.io/badge/powered%20by-Claude%20Code-8A2BE2)](https://claude.com/claude-code)
![GitHub stars](https://img.shields.io/github/stars/deepak0x/ai-form-filler?style=social)

</div>

---

Click **Start**, and the extension scans whatever fields are on the page (no pasting questions),
asks your local Claude to match them to your data, fills them in, and — if you want — submits.
Because the "brain" is your **Claude Code subscription** running locally via `claude -p`, there's
**no API key and nothing to pay per use.**

## ✨ Why this exists

Everyone retypes the same details into Google Forms, job applications, and signups. Existing
auto-fillers are dumb (exact-match only) or send your data to a cloud API. This one is different:

- 🔒 **Local-first & private** — your profile never leaves your machine; nothing scans a page until *you* click Start.
- 🔑 **No API key, no bill** — it runs on the Claude Code subscription you already have.
- 🧠 **Actually understands the form** — matches messy, real-world questions to your data, not just `name`/`email`.
- 🌐 **Works everywhere** — Google Forms *and* ordinary HTML forms on any site.

```
Any form tab (you clicked Start)
  └─ content.js  scans fields → fills answers → optional auto-submit
       └─ background.js → POST http://127.0.0.1:8731/fill
            └─ server.js  runs `claude -p` (your local subscription) → returns answers
```

## 🚀 Features

- **Works on any form** — Google Forms *and* ordinary HTML forms. For plain forms it reads native
  `<input>`/`<textarea>`/`<select>`/radios/checkboxes and infers each question from its label,
  `aria-label`, placeholder, fieldset legend, or nearby text.
- **Click to Start** — nothing runs until you open the popup and hit **Start**, so pages never get
  scanned behind your back.
- **Dynamic scanning** — reads whatever fields exist (text, paragraph, radio, checkbox, dropdown).
  No pre-defining questions.
- **AI matching on local Claude** — a local bridge runs `claude -p` on your Claude Code
  subscription, so there's no API key or cost.
- **Progress panel** — a small card shows scanning → asking AI → filling, with a live bar.
- **Verify-and-ask** — after filling, each field is checked to confirm the value actually stuck.
  Anything the AI couldn't decide (or that silently failed) is shown with an editor
  (text box / dropdown / checkboxes), pre-filled with the AI's best guess — you fix it and it's written in.
- **Learns your answers** — anything you fill by hand is saved to your profile (`learned_answers`)
  and reused automatically when the same or a related question appears later.
- **Built-in toggles** — ticks "Record my email" and "Send me a copy of my responses" when present.
- **Optional auto-submit** — fill and submit hands-free once you trust it.

## 📦 Requirements

- [Claude Code](https://claude.com/claude-code) installed and logged in (`claude` works in your terminal)
- [Node.js](https://nodejs.org) (for the local bridge)
- A Chromium browser (Chrome / Edge / Brave)

## 🛠️ One-time setup

1. **Clone & create your data file**
   ```bash
   git clone https://github.com/deepak0x/ai-form-filler.git
   cd ai-form-filler
   cp profile.example.json profile.json   # then fill in your details
   ```
   `profile.json` is gitignored, so your personal data is never committed. The more you fill in, the
   more forms it can answer — it never invents values that aren't in the file.

2. **Make sure Claude is logged in** — run `claude` once in a terminal if unsure.

3. **Load the extension**
   - Open `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked** → select the `extension/` folder
   - (Optional) pin it so the popup is one click away.

## ▶️ Each time you want to fill forms

1. **Start the bridge** (skip if you set up the systemd service below):
   ```bash
   cd bridge
   node server.js
   ```
   You should see `Form-filler bridge running on http://127.0.0.1:8731`.

2. **Open any form**, click the extension icon (should say **Bridge: connected**), and hit
   **▶ Start — scan & fill**. Toggle **Auto-submit after filling** first if you want it hands-free.

## ⚙️ Run the bridge automatically (Linux / systemd)

So you never have to start `server.js` by hand:
```bash
systemctl --user enable --now form-filler-bridge      # start now + on every login
loginctl enable-linger $USER                          # keep it running across reboots
systemctl --user status form-filler-bridge            # check it
journalctl --user -u form-filler-bridge -f            # live logs
```
The unit lives at `~/.config/systemd/user/form-filler-bridge.service`. Because it spawns the
`claude` CLI, your Claude Code login must stay valid — if fills start failing, check the logs for an
auth error and run `claude` once to re-login.

## 🧪 Quick test (no browser)

With the bridge running:
```bash
curl -s -X POST localhost:8731/fill -H 'Content-Type: application/json' \
  -d '{"fields":[{"id":"q0","question":"Your full name","type":"text"},
                 {"id":"q1","question":"Email","type":"text"},
                 {"id":"q2","question":"Languages you know","type":"checkbox",
                  "options":["Python","Rust","JavaScript","Go"]}]}'
```
Expect something like:
`{"answers":{"q0":"Jane Doe","q1":"jane.doe@example.com","q2":["Python","JavaScript"]}}`

## ⚠️ Limits

- The bridge must be running (run it as a systemd user service so it's always on — see above).
- **Multi-page forms**: fills the visible page — go to the next page, then click **Start** again.
- **File uploads** (e.g. resume) can't be automated — file pickers are walled off from extensions;
  the panel reminds you to upload manually. **CAPTCHA / "I'm not a robot"** also can't be automated.
- Each fill calls Claude once, so it takes a few seconds depending on form size.
- **Custom JS widgets**: forms built entirely from styled `<div>`s with no native inputs or ARIA
  roles (some React combobox libraries) may not be detected. Standard inputs, ARIA-role widgets, and
  Google Forms all work.

## 🤝 Contributing

PRs and issues are very welcome — this is a great first open-source project to jump into.

- Check the [open issues](https://github.com/deepak0x/ai-form-filler/issues) (look for `good first issue`).
- Ideas: cross-platform bridge (macOS/Windows launch scripts), better custom-widget detection,
  a Chrome Web Store build, a profile editor UI, more field types.
- Fork → branch → PR. Keep changes focused.

If this saved you some typing, a ⭐ **star** helps other people find it!

## 📝 License

[MIT](./LICENSE) © 2026 Deepak Bhagat
