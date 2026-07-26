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

## Packaging and code signing

The agent ships as a signed Windows installer, built with electron-builder and
signed with a **self-signed** certificate.

Self-signed is the deliberate choice, not a shortcut. The agent is never
distributed publicly — it is installed by IT, in person, on machines at two
centralised locations (the main floor and the Himachal office). There is no
Windows domain and no Active Directory to push policy through, so a purchased CA
certificate or a signing service (Azure Trusted Signing and similar) would be
paying for public trust this application never needs. What signing buys here is
integrity and a stable publisher identity: once a site's machines trust the
certificate, every current and future installer runs without a publisher prompt,
and a tampered installer fails to verify.

### One-time: create the signing certificate

Run **once**, on the build machine:

```bash
npm run make-cert
```

That runs `tools/make-cert.ps1`, which does the equivalent of:

```powershell
$cert = New-SelfSignedCertificate `
  -Subject "CN=Simplen SESS Idle Agent, O=Simplen, C=IN" `
  -Type CodeSigningCert `
  -KeyUsage DigitalSignature `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

Export-PfxCertificate -Cert $cert -FilePath certs\sess-agent-signing.pfx -Password $pwd
Export-Certificate    -Cert $cert -FilePath certs\sess-agent-signing.cer -Type CERT
```

`-Type CodeSigningCert` is the part that matters — a plain self-signed
certificate cannot sign an executable.

It writes three files into `agent/certs/`, which is **gitignored**:

| File | What it is |
|---|---|
| `sess-agent-signing.pfx` | Private key + certificate. **Build machine only. Never distribute.** Anyone holding this can sign software as Simplen. |
| `sess-agent-signing.cer` | Public half. This is the file IT copies to each machine. |
| `cert-password.txt` | The `.pfx` password, so the build can read it unattended. |

Back the `.pfx` up somewhere safe. If it is lost, a new certificate must be
generated and **every machine re-trusted**, because the identity changes.

### Build the installer

```bash
npm install     # first time only
npm run dist
```

Produces `dist/SESS Idle Agent Setup <version>.exe` (~78 MB, x64, NSIS,
per-machine install) and signs it. The build prints the artefact it actually
produced and its size — "the command exited 0" is not the same as "an installer
exists".

Signing is skipped with a clear notice if `certs/` is absent, so the project
still builds for anyone who has not generated a certificate.

Two implementation notes, both deliberate:

- **Signing runs as a separate step** (`tools/sign.ps1`, using Windows'
  built-in `Set-AuthenticodeSignature`) rather than through electron-builder's
  own signing. electron-builder signs via a bundled `winCodeSign` toolchain
  whose archive contains macOS symlinks; extracting it on Windows fails with
  *"Cannot create symbolic link: A required privilege is not held by the
  client"* unless the build runs elevated or with Developer Mode enabled.
  Signing with a tool that ships with Windows removes that requirement — no
  SDK, no elevation, no extra install.
- The signature is **timestamped** against DigiCert's public timestamp server,
  so it stays verifiable after the certificate's 5-year expiry. If the build
  machine is offline it signs without a timestamp and says so.

### Per-machine trust (one time, per site)

Until a machine trusts the certificate, Windows shows an *"Unknown publisher"*
prompt on install. Do this **once per machine**, during rollout at each site.
After that, every future install and update on that machine is silent.

Copy `certs/sess-agent-signing.cer` to the machine (USB stick or a share), then
in an **Administrator** PowerShell:

```powershell
# 1. Trust the certificate as a publisher of software
Import-Certificate -FilePath .\sess-agent-signing.cer `
  -CertStoreLocation Cert:\LocalMachine\TrustedPublisher

# 2. Trust it as a root authority (needed because it is self-signed —
#    it is its own issuer, so there is no CA above it to vouch for it)
Import-Certificate -FilePath .\sess-agent-signing.cer `
  -CertStoreLocation Cert:\LocalMachine\Root
```

Both stores are required: `TrustedPublisher` is what suppresses the publisher
prompt, `Root` is what makes the self-signed chain validate at all.

Prefer clicking? Double-click `sess-agent-signing.cer` → **Install
Certificate** → **Local Machine** → **Place all certificates in the following
store** → **Browse** → **Trusted Publishers**. Then repeat, choosing **Trusted
Root Certification Authorities**.

Verify it took, on that machine:

```powershell
Get-AuthenticodeSignature ".\SESS Idle Agent Setup 1.0.0.exe" | Format-List Status, SignerCertificate
```

`Status` should read **`Valid`**. Before the import it reads
`UnknownError` / `NotTrusted` — the signature is present and correct, but the
machine does not yet trust who signed it. That is the whole point of this step.

To undo on a machine, delete the certificate from both stores via `certlm.msc`.

### Rollout checklist per site

1. Build once, centrally: `npm run dist`.
2. Copy the installer **and** `sess-agent-signing.cer` to the site.
3. On each machine: import the `.cer` into both stores (above) — once, ever.
4. Run the installer. It is per-machine, so it needs administrator rights.
5. Enter the server URL and the employee's agent token, issued by HR from
   **Compliance & Consent**. Ship the config alongside the installer rather than
   having each employee type a token by hand where possible.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Tray shows *Stopped — consent not active* | HR must record `IDLE_TRACKING` consent in SESS → Compliance & Consent |
| Tray shows *Last error: … not valid* | Token was revoked or replaced — ask HR to issue a new one |
| Nothing appears in SESS | Confirm the server URL, and that `lastSeenAt` updates on HR's Idle Tracking page |
| `getSystemIdleTime` unavailable | The agent assumes **active** rather than inventing idle time |
