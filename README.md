# YTMP3 Desktop

Desktop app for downloading YouTube and YouTube Music tracks as MP3.

**Stack:** Tauri 2 · Rust · React 19 · TypeScript · Tailwind CSS 4 · Vite · yt-dlp · ffmpeg

## Download

Latest release: **[github.com/andrewchuev/youtube-to-mp3-tauri/releases/latest](https://github.com/andrewchuev/youtube-to-mp3-tauri/releases/latest)**

| Platform | Installer |
|---|---|
| Windows 10 / 11 | `.msi` or `.exe` (NSIS) |
| macOS Intel | `.dmg` |
| macOS Apple Silicon | `.dmg` |
| Linux | `.AppImage` or `.deb` |

> **macOS:** if Gatekeeper blocks the app on first launch, right-click the `.app` → Open.

## Features

- Single track or full playlist / album download
- Album tracks saved to a named subfolder automatically
- Configurable output folder
- Recent jobs history with progress tracking
- Light / dark theme

## Development

```bash
npm install
npm run tauri dev
```

Before running, place the platform binaries in `src-tauri/binaries/`:

```
yt-dlp-x86_64-pc-windows-msvc.exe
ffmpeg-x86_64-pc-windows-msvc.exe
```

See [`src-tauri/binaries/README.md`](src-tauri/binaries/README.md) for paths on macOS and Linux.

## Release

Push a version tag to trigger a multi-platform build via GitHub Actions:

```bash
git tag v1.0.3
git push origin v1.0.3
```

Builds are produced for Windows, macOS (Intel + Apple Silicon), and Linux, and published as a draft GitHub Release.

---

> Use only for content you are authorized to download.
