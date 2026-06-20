# Qwosid

A desktop **story organiser** for writers. Keep your characters, chapters, outlines, relationships, and notes in one place — with screenplay-style PDF export, local autosave, and easy backups.

Built because Obsidian, Campfire, and the other "story organiser" tools were annoying. This one is simple, fast, and keeps everything on your own machine.

---

## ⬇️ Download & run (Windows)

**[Download the latest Qwosid.exe »](https://github.com/Nicoqwerty/Qwosid/releases/latest/download/Qwosid.exe)**

1. Click the link above (or go to the [Releases page](https://github.com/Nicoqwerty/Qwosid/releases/latest)).
2. Run **Qwosid.exe** — it's portable, so there's **no installer**. Put it anywhere you like.
3. On first launch, Windows SmartScreen may say "Windows protected your PC" (because the app isn't code-signed). Click **More info → Run anyway**.

That's it. Your work is saved automatically.

### Where your data lives
- **Stories** are saved automatically on your PC (in your user app-data folder).
- **Backups** are written to **`Documents\Qwosid Backups`** (auto-backup every 30 min, plus a prompt when you close). You can also export/import a backup file from the sidebar at any time.
- Uninstalling = just delete the exe. Your stories and backups stay until you remove them yourself.

---

## ✨ Features

- Characters (bio, appearance, traits, relationships), chapters, outlines, and notes
- Nestable folders — drag items and folders to organise freely
- Chapter timeline view, relationship map, and full-text search with filters
- Rich text editor: bold/italic, font colours, link chips between entries, scene jump-list
- Chapter snapshots (version history) and a 30-day trash
- Distraction-free focus mode and a split-pane layout
- Import PDFs (screenplays, prose, character sheets) and export chapters/stories as PDF
- Everything is local — no account, no cloud, no tracking

---

## 🛠 Build from source

Requires [Node.js](https://nodejs.org) 18+.

```bash
git clone https://github.com/Nicoqwerty/Qwosid.git
cd Qwosid
npm install
npm run launch     # build + run the desktop app
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the UI in the browser with hot reload (http://localhost:5173) |
| `npm run launch` | Build and open the Electron desktop app |
| `npm run dist` | Build the portable `release/Qwosid.exe` for distribution |
| `npm test` | Run the PDF-parser tests |

**Tech:** React + Vite + Electron. Source lives in [`src/`](src/); the Electron shell is [`main.js`](main.js) / [`preload.js`](preload.js).

---

## Releasing a new version
1. Bump `version` in `package.json`.
2. Run **`npm run release`** — this builds the portable `Qwosid.exe` and publishes it to a GitHub Release (tag `v<version>`) in one step.

It reuses the GitHub token git already cached (from your last `git push`); if that isn't available, set a `GITHUB_TOKEN` env var with `repo` scope. Re-running for the same version just replaces the uploaded exe, so the [latest-download link](https://github.com/Nicoqwerty/Qwosid/releases/latest/download/Qwosid.exe) always points at the newest build.

---

*Made with ❤️ and a bit of slopcode. Still a work in progress — more coming.*
