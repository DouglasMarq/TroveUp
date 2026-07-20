# TroveUp

A desktop mod manager for [Trove](https://www.trionworlds.com/trove/) that installs, updates, and organizes modifications directly from the [Trovesaurus](https://trovesaurus.com/) mod repository.

![TroveUp demo](assets/demo.gif)

## Features

- **My Mods** — add local `.zip`/`.tmod` files, enable/disable mods, check for updates, update from Trovesaurus or from file, and remove override folders.
- **Get More Mods** — browse, search, sort, and one-click install any mod from the Trovesaurus repository.
- **Mod Packs** — install community mod packs from Trovesaurus, or create and share your own packs from your installed mods.
- **Trovesaurus integration** — news feed, event calendar, live streams, and mail notifications (with an account link key).
- **Modder Tools** — build `.tmod` files (title, author, notes, tags, preview), extract `.tmod` files, extract game archives, and run the Trove dev tool.
- **`trove://` deep links** — install mods and mod packs straight from links on Trovesaurus.
- **Desktop conveniences** — system tray icon, minimize to tray, start minimized, single-instance handling, and automatic app updates.

## How it works

TroveUp is a [Tauri 2](https://tauri.app/) application:

- **Back-end (Rust, `src-tauri/`)** — exposes Tauri commands for mod management. It downloads mods from the Trovesaurus API (`trovesaurus.rs`), unpacks `.zip`/`.tmod` archives into Trove `override` folders (`mods.rs`, `tmod.rs`), keeps an `index.tfi` so mods survive Glyph client updates, persists settings and mod state as YAML/JSON (`settings.rs`), and registers the `trove://` protocol handler with deep-link, single-instance, updater, and tray plugins.
- **Front-end (`ui/`)** — a dependency-free vanilla HTML/CSS/JS single-page UI (`index.html`, `app.js`, `styles.css`) that talks to the Rust back-end through `window.__TAURI__` invocations and events.

## Building from source

Prerequisites: [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run dev     # run in development mode
npm run build   # produce an installer in src-tauri/target/release/bundle
```

## Promo video

The demo GIF above is generated with [Remotion](https://remotion.dev/) (10 s, 1080p @ 30 fps):

```bash
cd remotion
npm install
npx remotion render TroveUpPromo ../assets/demo.gif --codec=gif
```

## License

[GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)
