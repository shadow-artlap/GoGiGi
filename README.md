# GoGiGi

A minimal **Electron** desktop app (Windows) with **auto-update via GitHub Releases**
(using `electron-builder` + `electron-updater`). Use it as a starting skeleton and
grow your features on top.

## Features

- Clean Electron setup with a secure renderer (`contextIsolation`, `sandbox`, no `nodeIntegration`).
- In-app **Check / Download / Install** update flow with live progress.
- One-command release via GitHub Actions on a version tag.

## Project layout

```
src/
  main.js              Electron main process + auto-updater wiring
  preload.js           Safe contextBridge API (window.gogigi)
  renderer/            UI (index.html, renderer.js)
electron-builder.yml   Packaging + GitHub publish config
dev-app-update.yml     Updater config for local testing
.github/workflows/release.yml   CI that builds & publishes on tag push
```

## Develop

```bash
npm install
npm run dev
```

> Auto-update only runs in a **packaged/installed** build. In `npm run dev` the
> update check reports "dev-mode" by design.

## First-time GitHub setup

Repo: https://github.com/shadow-artlap/GoGiGi

1. Push the code:

```bash
git add .
git commit -m "Initial GoGiGi skeleton"
git push -u origin main
```

## Cut a release (auto-update)

1. Bump the version in `package.json` (e.g. `0.1.0` → `0.1.1`).
2. Commit, then tag and push the tag:

```bash
git commit -am "Release v0.1.1"
git tag v0.1.1
git push origin v0.1.1
```

3. GitHub Actions builds the Windows installer and publishes a Release with
   `latest.yml` + the installer attached.
4. Installed GoGiGi apps detect the new version (on launch and via the
   **ตรวจหาอัปเดต** button), download it, and install on restart.

### Build locally instead

```bash
npm run dist          # build installer into release/ (no publish)
# to publish from your machine you need a GitHub token:
#   setx GH_TOKEN <your_token>   (then reopen the shell)
npm run release
```

## Fingerprint

Each profile runs on the bundled/installed browser with a per-profile fingerprint
applied over CDP before any page script runs: timezone, locale, geolocation,
user-agent, screen metrics, hardware, WebGL vendor/renderer, canvas/audio noise,
and WebRTC policy. The patched functions report `[native code]`, so the overrides
are not visible to `toString`/descriptor inspection. Set a proxy and use
**ทดสอบ proxy** to auto-match timezone/locale/geo to the exit IP.

> This is JS/CDP-level hardening — strong against the JS fingerprinting most sites
> use. A fully patched Chromium build (C++-level spoofing) is a separate, large
> project (hours-long source build on your own infrastructure) and is out of scope
> for this repo's CI.

## Code signing (remove the SmartScreen warning)

Unsigned installers trigger a Windows SmartScreen warning on first run. The
release workflow signs automatically once you provide a certificate — no code
change needed:

1. Get a **code signing certificate** (`.pfx`) from a CA (SSL.com, Sectigo,
   DigiCert…). An **EV** certificate clears SmartScreen immediately; an **OV**
   one builds reputation over downloads. A cheaper token-free option is
   **Azure Trusted Signing**.
2. Base64-encode the `.pfx`:
   ```bash
   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard
   ```
3. In the GitHub repo → **Settings → Secrets and variables → Actions**, add:
   - `CSC_LINK` — the base64 string from step 2
   - `CSC_KEY_PASSWORD` — the certificate's password
4. Cut the next release as usual. electron-builder detects the secrets and signs
   the installer; with no secrets it builds unsigned (no error).

## Notes

- App icon lives at `build/icon.ico`.

## License

MIT
