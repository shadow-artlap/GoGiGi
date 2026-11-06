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

1. Create a repo named **GoGiGi** on your account (or run `gh repo create`).
2. Replace **`OWNER_PLACEHOLDER`** with your GitHub username in:
   - `package.json` → `repository.url`
   - `electron-builder.yml` → `publish.owner`
   - `dev-app-update.yml` → `owner`
   - `src/renderer/renderer.js` → `REPO_URL`
3. Push the code:

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

## Notes

- Windows installers are unsigned by default; SmartScreen may warn on first run.
  Add code signing later via `electron-builder` if needed.
- Add an app icon at `build/icon.ico` (256×256) and uncomment the `icon:` line in
  `electron-builder.yml`.

## License

MIT
