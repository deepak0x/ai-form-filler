# AI Form Filler (Claude Max)

Auto-fills Google Forms from your saved profile (`profile.json`), using your **local Claude Code
on the Max subscription** as the brain — **no Anthropic API key needed**.

It's dynamic: the extension scans whatever fields are on the page (no pasting questions), Claude
matches them to your data, and the fields get filled. Optionally it auto-submits.

```
Google Form tab (you're logged in)
  └─ content.js  scans fields → fills answers → optional auto-submit
       └─ background.js → POST http://127.0.0.1:8731/fill
            └─ server.js  runs `claude -p` (Max auth) → returns answers
```

## Features

- **Dynamic scanning** — reads whatever fields are on the page (text, paragraph, radio, checkbox,
  dropdown). No need to pre-define questions.
- **AI matching on Claude Max** — a local bridge runs `claude -p`, so there's no API key or cost.
- **Progress panel** — a small card shows scanning → asking AI → filling, with a live bar.
- **Ask-me for unknowns** — any field the AI can't answer from your data is shown in the panel
  with an editor (text box / dropdown / checkboxes); you fill it and it's written into the form.
- **Built-in toggles** — ticks "Record my email" and "Send me a copy of my responses" when present.
- **Optional auto-submit** — fill and submit hands-free once you trust it.

## One-time setup

1. **Create your data file** — copy `profile.example.json` to `profile.json` and fill in your
   details:
   ```bash
   cp profile.example.json profile.json
   ```
   `profile.json` is gitignored, so your personal data is never committed. The more you fill in,
   the more forms it can answer; it never invents values that aren't in the file.

2. **Make sure Claude is logged in** (Max): run `claude` once in a terminal if unsure.

3. **Load the extension**
   - Open `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked** → select the `extension/` folder
   - (Optional) pin the extension so the popup is one click away.

## Each time you want to fill forms

1. **Start the bridge** (keep this terminal open):
   ```bash
   cd ~/Desktop/form-filler/bridge
   node server.js
   ```
   You should see `Form-filler bridge running on http://127.0.0.1:8731`.

2. **Open a Google Form** while signed into Google. It auto-fills on load.
   - Click the extension icon to see **Bridge: connected**, hit **Fill this form now** to re-run,
     or toggle **Auto-submit after filling**.

That's it — per form, you do nothing. The only standing requirement is the bridge running.

## Auto-submit

Off by default so you can eyeball the first fill. Flip it on in the popup once you trust it, and
forms will fill **and** submit hands-free.

## Quick test (no browser)

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

## Limits

- The bridge must be running (one command; can later be made a background service).
- **Multi-page forms**: fills the visible page — click **Next**, then **Fill this form now** again.
- **File uploads** (e.g. resume) can't be automated — Google's Drive picker is a cross-origin
  iframe walled off from extensions. The panel reminds you to click "Add File" and pick it
  (~2 clicks). **CAPTCHA / "I'm not a robot"** also can't be automated.
- Each fill calls Claude once, so it takes a few seconds depending on form size.
- Targets Google Forms' ARIA roles to stay resilient if Google changes its CSS.
