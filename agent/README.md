# SESS Idle Agent

A small, **deliberately visible** desktop agent that reports whether a
company-owned machine was in use. It is a standalone application — it is not
part of the SESS Next.js app and shares no code with it.

---

## What it records

Two numbers, every 15 minutes:

- **active minutes** — the machine received keyboard or mouse input
- **idle minutes** — no input for at least the idle threshold (default **210
  seconds / 3.5 minutes**)

## What it does NOT record

This is a permanent design constraint, not a first version to be extended:

- ❌ no screenshots
- ❌ no application, process or window names
- ❌ no websites or URLs
- ❌ no keystrokes or anything you type
- ❌ no productivity score, and no "productive vs unproductive" classification

It answers exactly one question — *was this machine in use?* — and nothing else.

## Visible by design

The tray icon is **always shown** while the agent runs, and **Pause tracking**
is one click away in its menu. There is no hidden mode and no way to run it
invisibly. An employee who wants to stop tracking can do so themselves without
involving IT. A covert agent would contradict the informed-consent gate the
server enforces, so this app does not offer one.

The server refuses data for any employee without an active `IDLE_TRACKING`
consent record — if consent lapses, the agent is told to stop and does.

---

## Setup

1. **HR issues you a token** from SESS → *Employee Master* → *Idle Tracking*.
   The token is shown once and should be treated like a password.
2. Launch the agent. On first run it opens a setup window.
3. Enter your **SESS server URL** (e.g. `https://sess.example.com`) and the
   **agent token**, then *Save & start*.

Config is written to your user profile, never inside the app bundle:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\sess-idle-agent\config.json` |
| macOS | `~/Library/Application Support/sess-idle-agent/config.json` |
| Linux | `~/.config/sess-idle-agent/config.json` |

The file is written `0600` where the platform supports it.

---

## Running from source

```bash
cd agent
npm install
npm start          # launches the Electron tray app
```

Verify the tracking logic without launching a GUI:

```bash
npm run selfcheck  # 26 assertions: threshold, batching, retry, consent-stop
```

`src/tracker.js` is plain Node with injected dependencies (clock, idle reader,
HTTP), so the self-check exercises the **real** logic rather than a copy.
`src/main.js` is only the Electron wiring.

---

## How it behaves

| Situation | Behaviour |
|---|---|
| Normal | Polls idle state every 15s; sends one summary every 15 min |
| Network down | Buffers locally, retries with backoff (1→2→4→8 min, capped at 30) |
| Server 5xx | Same — the batch is kept, never dropped |
| Server 4xx (bad batch) | That one batch is discarded so it can't block the queue forever |
| **Consent revoked** | Server replies `shouldPause`; agent **stops** and discards the pending batch — that data has no lawful basis to be stored |
| Paused from tray | Accumulates nothing until resumed |
| Buffer full (~24h unsent) | Oldest windows drop first |

The heartbeat response carries the current threshold, so a Super Admin changing
it in SESS reaches every agent on its next beat — no reinstall.

---

## Packaging for distribution

Not built in this phase. The app runs from source on any machine with Node and
Electron, which is sufficient for a pilot. To produce installers later:

```bash
npm install --save-dev electron-builder
```

then add to `package.json`:

```json
"build": {
  "appId": "com.simplen.sess.idleagent",
  "win": { "target": "nsis" },
  "mac": { "target": "dmg" },
  "linux": { "target": "AppImage" }
},
"scripts": { "dist": "electron-builder" }
```

and run `npm run dist`. Signing certificates (Windows Authenticode, Apple
notarisation) are required before wide distribution — unsigned builds will
trigger SmartScreen/Gatekeeper warnings.

For fleet deployment, ship the config file alongside the installer rather than
having each employee type a token by hand.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Tray shows *Stopped — consent not active* | HR must record `IDLE_TRACKING` consent in SESS → Compliance & Consent |
| Tray shows *Last error: … not valid* | Token was revoked or replaced — ask HR to issue a new one |
| Nothing appears in SESS | Confirm the server URL, and that `lastSeenAt` updates on HR's Idle Tracking page |
| `getSystemIdleTime` unavailable | The agent assumes **active** rather than inventing idle time |
