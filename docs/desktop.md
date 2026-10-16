# VibeOffice desktop app (Tauri): Windows and macOS, Linux too

`desktop/` wraps the suite in `public/` in a native window with [Tauri 2](https://tauri.app). The pages are the same files as the web version, embedded in the binary (brotli) and served from `http://tauri.localhost/` (Windows) or `tauri://localhost/` (macOS, Linux). They draw in the system's web view: WebView2 (Edge) on Windows, which every supported Windows 10 and 11 already has; WKWebView (WebKit, Safari's engine) on macOS; WebKitGTK 4.1 on Linux. The pages reach the system only through `VO.host` (Host interface below).

| File | What |
|---|---|
| `desktop/Cargo.toml` | the crate (on macOS also `objc2-foundation` and `objc2-app-kit`, which Tauri builds anyway, with only the classes used); size-tuned release profile (`opt-level = "z"`, LTO, one codegen unit, `panic = "abort"`, stripped); Tauri without `dynamic-acl` |
| `desktop/.cargo/config.toml` | builds for `x86_64-pc-windows-gnu` with mingw-w64 by default |
| `desktop/tauri.conf.json` | app name and identifier, `frontendDist: ../public`, `devUrl` (tools/serve.py), `removeUnusedCommands`; Tauri's bundler is off (the installer is `setup/`) |
| `desktop/src/main.rs` | one instance on Windows (`second_start`); files handed over later (`files_arrived`: another start on Windows, Finder on macOS); the main window: system title bar follows `document.title`, file drops go to the page, links out of the app go to the default browser, the UI size on each page load, `__VO_HOST__` before each page; on macOS the menu bar (`mac_menu`), Finder's files (`RunEvent::Opened`), the Dock (`Reopen`) and staying open with no window (macOS, below) |
| `desktop/src/host.rs` | the native side of `VO.host`: the `host_*` commands, file handles, `settings.json` |
| `desktop/src/net.rs` | the network rules: each window's web view reaches `https://vibeoffice.work/` alone, or the window never loads its page; `VO_NET_PROBE` (Network, below) |
| `desktop/src/installation.rs` | what the installer writes and `-uninstall` removes, in one list: files, shortcuts, HKCU registrations (shared with `setup/`) |
| `desktop/src/installed.rs` | Windows: `vibeoffice.exe -uninstall`, and the first start after installing (taskbar pin request, Default apps) |
| `desktop/app.manifest` | common controls v6 and `asInvoker` (never asks for administrator rights) |
| `desktop/macos/` | `Info.plist` (the bundle's, filled in by `build.sh`), `direct.entitlements` and `appstore.entitlements`, `build.sh` (the macOS release, on a Mac: macOS, below) |
| `desktop/release-notes.md` | the GitHub release's notes, both downloads (either workflow may create the release) |
| `desktop/setup/` | the installer, `VibeOfficeSetup.exe`: carries the app; its dialog, manifest and version in `setup.rc` |
| `desktop/capabilities/default.json` | `core:default` for the main window |
| `desktop/icons/` | `icon.icns` (macOS: the app icon on Apple's grid, 16–1024 px, from `public/icons/icon.svg` by `tools/desktop-icons.py`), `icon.ico` (16–256 px; the exe and the installer), `quire.ico`, `ledger.ico`, `lectern.ico` (document icons, resources 40101–40103 in the exe, numbered after the app icon's 32512 so that stays the exe's first, generated from each app's SVG by `tools/desktop-icons.py`), and `icon.png` (128 px, Linux window icon; Tauri embeds it as raw RGBA, so keep it small) |
| `desktop/licenses/` | license texts of what ships with the app but is not a crate (`WebView2Loader.txt`, from the WebView2 SDK package), and in `crates/` those of the crates whose package has none (taken from their repositories), for `public/oss-licenses.html` |
| `desktop/patches/option-ext/` | our own stand-in for the `option-ext` crate (MPL-2.0), which `dirs-sys` uses through Tauri: the one method it needs, Apache-2.0, put in its place by `[patch.crates-io]` in `Cargo.toml` (AGENTS.md, Code from other projects) |
| `desktop/build.sh` | release build: the exe, the installer and the zip in `desktop/target/dist/` |
| `.github/workflows/windows.yml` | CI, run by hand: `build.sh` on Ubuntu; the zip as the run's artifact and a GitHub release |
| `.github/workflows/macos.yml` | CI, run by hand: `macos/build.sh` on a macOS runner, a smoke run with screenshots; the DMG in the version's GitHub release; the App Store package to App Store Connect when asked (macOS, below) |
| `tests/desktop/` | `host.test.mjs` and `host-stub.js` (Host interface, below); `setup-wine.py`, the installer end to end in Wine (The installer, below) |

## Host interface

One interface between the pages and what runs them, so a page never asks which: `VO.host` in `public/common/suite.js`. In a browser (tab or installed PWA) it is built on the browser's APIs; in the desktop app on the commands in `desktop/src/host.rs`, called over Tauri's IPC (`window.__TAURI_INTERNALS__.invoke`). The desktop app announces itself before each page's scripts with `window.__VO_HOST__ = { platform, version, appVersion, edition }` (`edition`: `'appstore'` for the Mac App Store's, else `'direct'`); the same script makes Paper the desktop app's look until the user picks one (`vibeoffice.look`).

| `VO.host` | Web | Desktop |
|---|---|---|
| `kind` | `'web'` | `'desktop'` |
| `platform` | `'web'` | `'windows'`, `'macos'`, `'linux'` (Rust's `std::env::consts::OS`) |
| `updates` | `true` (the page never checks) | `true`; `false` in the Mac App Store edition, which the store updates (the Start Center never checks) |
| `version` | `0` | `host::VERSION`, raised when a command changes shape |
| `onFiles(fn)` | `launchQueue` (the PWA's file handlers) | `host_launch_files`, then `host_read` for each; again on `vo-files`, when another start of the app hands over its files (Windows) or Finder does (macOS) |
| `openUrl(url)` | a new tab | `host_open_url`: VibeOffice's own addresses only (`host::is_ours`: https://vibeoffice.work/, the GitHub repository), to the system (`ShellExecuteW`, `NSWorkspace openURL:`, `xdg-open`) |
| `newWindow(url)` | `window.open` (false if blocked) | `host_new_window`: one of the app's own pages (same scheme, host and port) in a full window (`doc-N`) with the host script and handlers |
| `closeWindow()` | `false` | `host_close_window`: closes an app window (true); the Start Center's (`main`) stays (false) |
| `uiScale()`, `setUiScale(n)` | `null` (the browser's own zoom does it) | `host_ui_scale`, `host_set_ui_scale`: the web view's zoom, 0.5–4, every window, kept in `settings.json` |

`VO.VERSION` is `appVersion` in the desktop app (the build's version, below).

`fn(files)` gets `File` objects; the Start Center calls `onFiles` and opens the first file in its app (`VO.handoff`). The service worker is registered only on the web.

Links: besides `openUrl`, a navigation or new window that leaves the app (http(s) to another host, mailto; `on_navigation`, `on_new_window` in `main.rs`) goes to the default browser only if `host::may_open` lets it: VibeOffice's own addresses from any page (the Start Center's GitHub button), and any web address from the licences page, whose links credit other projects; anything else opens nothing (a line on stderr). A document's hyperlinks never navigate: the apps show them to copy (docs/suite.md, Hyperlinks). The app's own pages (`tauri://localhost`, `http://tauri.localhost`; devUrl in a dev build), `blob:`, `data:` and `about:` stay in the app, and a page can't open a bare window of its own: the suite's windows come from `VO.host.newWindow`, with the network rules.

UI size (Settings on the Start Center): the web view's zoom, as Ctrl + in a browser, so canvases stay sharp and clicks land where they should. CSS `zoom` on the page was measured and does not work: at 200 % every click on Ledger's grid landed on B4 and menus opened at twice their place. `settings.json` (the app's config folder: `%APPDATA%\work.vibeoffice.desktop\`, `~/.config/work.vibeoffice.desktop/`) keeps it, and it is applied as each page starts loading (WebKitGTK resets the zoom on the first load).

Rules for growing it:

- Pages call `VO.host`, never Tauri, `launchQueue` or the File System Access API directly; both sides get each new method, the web side doing what the browser can (or reporting that it cannot).
- Files cross as handles: numbers the native side gives out for paths the user or the system chose (command line now; Open and Save dialogs next), never paths from the page, so a page reads and writes only what it was given.
- Commands are named `host_<verb>`, take named arguments and return JSON or raw bytes (`tauri::ipc::Response`, an `ArrayBuffer` in the page) for file contents.
- App commands are allowed only for the app's own pages: Tauri refuses them from any other origin while the app has no ACL manifest.

Windows: as when the PWA is installed, the Start Center stays in its window and each app opens in one of its own (`VO.go` → `newWindow`); a file the app was started with opens beside the Start Center. One VibeOffice runs per user session (`tauri-plugin-single-instance`, Tauri's own, registered first in `main.rs`): a second start (the Start menu, a double-click on a file, Open with) hands its arguments to the running one and exits. Its files open there, as launch files do (`second_start` queues them and sends the Start Center `vo-files`); with none, the Start Center comes to the front, or opens again if it was closed. What the installer asked for (`-pin-taskbar`, `-choose-defaults`) is done by the running one too. File ▸ Exit in an app window closes it (`VO.exit` → `closeWindow`). A page cannot simply `window.open`: WebView2 would make a bare popup without the host script or IPC, so the app's own new windows are made natively (`open_window` in `main.rs`, from an async command: a sync one deadlocks on Windows).

Planned: `open({ accept })` (the system's Open dialog), `save(handle, blob)` and `saveAs(name, blob)` (in place, as File ▸ Save does in Office) and one instance on Linux (today each start there is a process of its own).

`node --test tests/desktop/host.test.mjs` checks the page side in Chromium: `tests/desktop/host-stub.js` plays the desktop host (run before each page with `tools/shot.mjs --pre`; `?nolaunch` and `?update=button|dialog` set the scene): a launch file opens in its app once, with no service worker and the build's version; `openUrl` refuses anything but VibeOffice's own addresses; Settings sets the UI size (the web points to the browser's zoom); the update policies; versions compare by date.

## Saving (for now)

Until the app writes real files (todos/DESKTOP_REAL_SAVE.md), a save is a download into the system's Downloads
folder, decided natively (`on_download` in `main.rs`, `host::download_destination`): only the pages' own `blob:` and
`data:` files, only the types the apps save (`SAVE_TYPES`: documents, workbooks, presentations, PDF, PNG, CSV, text,
web pages), always straight in Downloads under the bare file name, never over an existing file (`Budget (1).csv`).
When it is written, the native side tells that window the name the file got (`vo-download`; never a path), and the
app shows *Saved to Downloads folder: <name>* with **Browse** (`ui.toast` with an action). Browse is
`host_show_downloads()`: no arguments; it opens the Downloads folder and, on Windows and macOS, selects the file
this window last saved (`explorer /select`; Finder, `activateFileViewerSelectingURLs:`), the one the native side wrote.

## Versions and updates

A version is `v<yyyy>.<mm>.<dd>-<6 hex>`, the date (UTC) and commit of the tree it was built from, e.g. `v2026.10.11-d2134d`: `tools/current-tree-version.sh [commit]` prints it. `build.sh` stamps it into the app and the installer (`VO_VERSION`, shown as `VO.VERSION` on the Start Center and in About); the release is tagged with it, and the zip keeps one name. Windows wants numbers: the exes' file version is `2026.10.11`. A plain `cargo build` says `dev`.

`public/updater/current.json`, edited by hand (nothing updates it): per policy, per platform (`web`, `macos`, `windows`, `linux`), the version an edition must be at least. The Mac App Store edition never reads it (`VO.host.updates`): the store updates it.

    { "show-update-button": { "windows": "v2026.10.11-000000", … },
      "show-update-dialog": { "windows": "v2026.10.11-000000", … } }

`public/updater/whatsnew.json`, also by hand: one list for every platform, version → plain text (line breaks kept).

    { "v2026.10.11-000000": "VibeOffice for Windows and Linux: …" }

When the Start Center opens, the desktop app reads `https://vibeoffice.work/updater/current.json` (the site sends `Access-Control-Allow-Origin: *`; nothing about the user or their files is sent). Older than `show-update-dialog`: the Update dialog, at most once a day (`vibeoffice.updateAsked`), listing the `whatsnew.json` entries newer than this version, newest first (by date; the dialog shows without them if that file cannot be read); older than `show-update-button`: the Update VibeOffice button in the Start Center. `whatsnew.json` is read only when an update is due. Update opens `https://vibeoffice.work/updater/?from_version=<version>&current_platform=<platform>` in the default browser: the update page (`public/updater/index.html`, in English), which sends people to the latest GitHub release (`releases/latest`: not a pre-release or a draft) and says how to install it on Windows and macOS. So a release is published (both workflows) before `current.json` asks for it. Offline, or a file that is not this JSON: nothing is shown from it. Apart from `current.json`, a version over two months old (`VO.isOutdated`: two calendar months after its day) shows Check for updates ("This version is over two months old."), which opens the same page; it waits up to 5 s for the check and gives way to the Update button when `current.json` asks, so the two never show together. The site and the installed PWA show it too (docs/suite.md). A `dev` build is newer than any dated version and never asks. To try both against the published file without asking anyone else: keep `show-update-dialog` older than `show-update-button` (`v2026.10.05` and `v2026.10.11`) and build exes stamped in between and before (`VO_VERSION=v2026.10.08-000000` → the button only; `v2026.10.01-000000` → the dialog), e.g. `VO_VERSION=… TAURI_CONFIG='{"version":"2026.10.8"}' cargo build --release`; the dialog shows once a day per profile (`vibeoffice.updateAsked`). `tests/desktop/host.test.mjs` checks the repo's `current.json` the same way.

## Network

The pages may reach `https://vibeoffice.work/` alone, for the update check (`updater/current.json` and `whatsnew.json`);
the app itself makes no connections (`desktop/src/net.rs`). Every other http, https, ws and wss request a window makes,
whatever makes it (a page, a picture or frame in a document, a worker), is refused before it leaves the machine:

- macOS: a WebKit content rule list (the format of Safari's content blockers): block `^https?://` and `^wss?://`, then
  let `^https://vibeoffice\.work/` through. WebKit compiles it at start (and keeps it compiled in the app's container);
  the Start Center opens only then.
- Windows: WebView2 hands every request of a window to `net::allowed` first (`AddWebResourceRequestedFilter` for `*`,
  workers included where WebView2 has `ICoreWebView2_22`); a refused one gets a 403 instead. WebSocket connections
  may not pass through that event (WebView2 documents it for HTTP requests), but no page opens one.
- Linux: no rules (no release).

It fails closed (`net::guard`). Each window starts on `about:blank` and goes to its page only once the rules are on
its web view, so no page of the app runs without them. If they can't be set, the window closes without loading its
page and a system alert says why; when it was the only window, the app quits (exit code 1). On macOS, if WebKit
refuses to compile the rules, no window opens at all.

The rules are checked from a page: with `VO_NET_PROBE=1`, the Start Center's window first loads a probe page of its
own (a `data:` URL with no policy of its own, so only the rules can refuse anything). It tries a picture from
github.com, a fetch of api.github.com and a WebSocket to echo.websocket.org, with a picture from vibeoffice.work as the
control, and prints `network probe: blocked` on stderr, or `REACHED` and what got through. Then the window goes on to
the Start Center. The macOS smoke run sets it and fails without `blocked`. On Windows a WebSocket may get through
WebView2's filter; the pages' own Content-Security-Policy refuses it there (todos/HARDENING.md, phase 1).

The app's own pages and IPC (`tauri://`, `ipc://`; `http://tauri.localhost` and `http://ipc.localhost` on Windows) and
`data:` and `blob:` are not the network; a dev build also reaches its dev server (127.0.0.1). Our own links still open
in the default browser, which is not the app. The pages' Content-Security-Policy (docs/suite.md, Security) is the
same limit from the other side: `connect-src` names the site and the IPC sources (`ipc:`, `http://ipc.localhost`). The sandbox can't name a host: the DMG has the network entitlement
(`network.client`) for the update check, which is why the rules live in the web view; the App Store edition has none.
What the system and WebView2 do on their own (Edge's updates, certificate checks) is theirs.

## Building

Windows (below); macOS: `desktop/macos/build.sh`, on a Mac (macOS, below).

Needs Rust with the `x86_64-pc-windows-gnu` target, mingw-w64 (`x86_64-w64-mingw32-gcc`, `windres`) and `zip`; builds on Linux, no Windows SDK.

    desktop/build.sh        # desktop/target/dist/: VibeOffice-Windows-x64.zip, holding VibeOfficeSetup.exe

`cd desktop && cargo build --release` builds the exe alone (`target/x86_64-pc-windows-gnu/release/`); `cargo build --release -p vibeoffice-setup` then builds the installer around it (`VO_PAYLOAD`: another folder holding `vibeoffice.exe` and `WebView2Loader.dll`). `cargo build --no-default-features` leaves out the embedded pages and loads `devUrl` (http://127.0.0.1:8760/, `tools/serve.py`), so page edits show on reload without rebuilding.

CI runs only by hand: Actions ▸ Windows ▸ Run workflow (pick the branch; tick *pre-release* if it is one). It runs `build.sh` on Ubuntu, keeps the installer as the run's artifact (`VibeOffice-Windows-x64`: GitHub zips it, so it downloads as the same zip) and publishes `VibeOffice-Windows-x64.zip` as a GitHub release tagged with the version (`v2026.10.11-d2134d`, at the commit built); running it again on the same commit replaces the release's file. The zip's name is the same in every release, so `releases/latest/download/VibeOffice-Windows-x64.zip` is always the newest. `public/updater/current.json` is not touched: raising the versions there is what makes installed copies offer the update.

## The installer

`VibeOfficeSetup.exe` (`desktop/setup/`), alone in the release zip, installs VibeOffice for the user who runs it, without administrator rights, as Chrome does. It carries the app (`vibeoffice.exe`, `WebView2Loader.dll`, `LICENSE.txt`) and writes it into `%LOCALAPPDATA%\VibeOffice`. What it writes is listed once, in `desktop/src/installation.rs`, which `vibeoffice.exe -uninstall` removes again:

- desktop and Start menu shortcuts (`VibeOffice.lnk`, with the AppUserModelID `work.vibeoffice.desktop`, which the app sets on its process too);
- under HKCU: Apps & features (`Uninstall\VibeOffice`: version, size, icon, `UninstallString` = `"…\vibeoffice.exe" -uninstall`), `App Paths`, `Applications\vibeoffice.exe`, and the file types `.docx` (Quire Document), `.xlsx` (Ledger Worksheet) and `.pptx` (Lectern Presentation): a ProgID each (`VibeOffice.docx`, … with `"…\vibeoffice.exe" "%1"` and the app's document icon), listed under the extension's `OpenWithProgids` and in the app's Default apps capabilities (`RegisteredApplications`). The extension's own default and `UserChoice` are Windows' and the user's: never written (UCPD protects UserChoice anyway);
- Explorer is told the file types changed (`SHChangeNotify`).

It writes the files first, then the registry (so Apps & features can always uninstall), then the shortcuts (one that can't be made is a warning, not a failed install), and starts the app outside any job object Windows may run installers in. Each step, and the app's first start (the pin request, Default apps), goes to `%TEMP%\VibeOfficeSetup.log`.

The dialog (`setup.rc`) says where it installs and offers two choices:

- **Pin VibeOffice to the taskbar** (ticked for a new install): the app, at its first start, asks Windows (`TaskbarManager.RequestPinCurrentAppAsync`), and Windows asks the user. Windows lets only the app itself ask, in front and with a Start menu entry, never an installer. The box shows only where Windows lets desktop apps ask: `TaskbarManager` with desktop app support, and no Limited Access Feature token needed (from KB5074105, builds 26100/26200.7705); elsewhere (Windows 10, older Windows 11) the dialog says how to pin it from the Start menu;
- **Open default app settings, in which you can set VibeOffice as default app by yourself.** Ticked unless the user has already chosen VibeOffice for `.docx`, `.xlsx` and `.pptx` (their `UserChoice`, or `UserChoiceLatest` on newer Windows 11; only read). Ticked, the app opens `ms-settings:defaultapps?registeredAppUser=VibeOffice`, VibeOffice's page in Default apps, after the pin question; if the app can't be started, the installer opens it. The file types are registered either way; which app opens them is the user's choice, made there.

The installer starts the app with the choices (`-pin-taskbar`, `-choose-defaults`); the app acts on them once its Start Center has loaded (`installed.rs`). Run again with this very app installed (its `vibeoffice.exe` byte for byte, whatever the version says), it offers **Reinstall**, which also repairs what is missing; another build gets **Update**. Files dropped on the installer open in the app. A running VibeOffice keeps running during an update: its files, which Windows won't let anyone replace, are renamed `*.old` and the app removes them at its next start. Until it has been closed entirely, a start goes to the running (old) one, which opens Default apps as asked. A DLL in the folder that is not the app's is deleted.

Uninstall (Apps & features, or `vibeoffice.exe -uninstall`) asks first; **Also delete VibeOffice's settings, Recent Files list and drafts** (unticked) also removes `%LOCALAPPDATA%\work.vibeoffice.desktop` (the WebView2 profile) and `%APPDATA%\work.vibeoffice.desktop`. With VibeOffice open, it asks the user to close it (Retry). It removes the shortcuts (and the taskbar pin's) that point to the app, VibeOffice's own keys, and only its own values in shared ones (`OpenWithProgids`, `RegisteredApplications`); the folder goes once the uninstaller has ended (a hidden `cmd.exe` from System32 waits for it).

The installer runs from Downloads, so it loads nothing from its own folder: it imports only Known DLLs and API sets (`build.sh` fails otherwise), calls `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32)` before anything else, and gets comctl32 v6 from side-by-side (its manifest). Per user, the folder is writable by the user, as Chrome's per-user install is; integrity levels keep low-integrity and sandboxed processes out.

`python3 tests/desktop/setup-wine.py desktop/target/dist/VibeOfficeSetup.exe` runs it end to end in Wine (needs wine, Xvfb, xdotool, ImageMagick), in its own prefix in `./tmp/setup-wine` with screenshots of both dialogs: install from a folder holding only the installer (files, shortcuts, registry, no extension default), again with that version (no dialog), uninstall (all gone, another program's `OpenWithProgids` entry kept). Regenerate the document icons after changing an app's SVG with `python3 tools/desktop-icons.py` (`rsvg-convert` from librsvg2-bin, and ImageMagick).

## macOS: the DMG and the Mac App Store

One universal binary (Apple silicon and Intel, macOS 13 or later), bundled twice, the two editions told apart by
`VODistribution` in the bundle's `Info.plist`, which the signature seals (`host::app_store`):

- **direct**: `VibeOffice-macOS.dmg` in the GitHub release, signed with Developer ID, notarized and stapled. It checks
  for updates as Windows does (`updater/current.json`, `macos`).
- **appstore**: `VibeOffice-macOS-AppStore.pkg` for App Store Connect (TestFlight, then review), signed for the store
  with its provisioning profile. `edition: 'appstore'`: the Start Center never checks for updates, the store updates it
  (App Review guideline 2.4.5), so it has no network entitlement either.

Both run in the App Sandbox, so trying the DMG tries the store's edition too (`desktop/macos/*.entitlements`): the
files the user picks in an Open dialog or opens from Finder, the Downloads folder (where saves go for now: Saving,
above), printing, and in the DMG the network for the update check. Links go to the browser and Browse to Finder through
NSWorkspace, which the sandbox allows; no program is started.

The Mac's ways (`main.rs`):

- Files from Finder (a double-click, Open With, a drop on the Dock icon) arrive as `RunEvent::Opened`, at start or
  while the app runs, and open as launch files do; the sandbox lets the app read them. `Info.plist` lists .docx, .xlsx
  and .pptx (Quire Document, Ledger Worksheet, Lectern Presentation), as the Windows installer does: in Open With, never
  taking the default (`LSHandlerRank` Alternate); the system draws their icons from the app's.
- The app stays open, with its menu bar, after its last window closes; a click on the Dock icon brings the Start
  Center back; Quit (⌘Q) ends it.
- The menu bar (`mac_menu`): the app menu (About, Services, Hide, Quit), File ▸ Close Window, Edit with Cut, Copy, Paste
  and Select All (WKWebView gets ⌘X, ⌘C, ⌘V and ⌘A through them), View ▸ Full Screen, Window, Help. No Undo or Redo
  there: they would run WebKit's own undo, not the document's; ⌘Z reaches the page, as in Safari.
- ⌘ does what Ctrl does in every app, and on a Mac shortcuts show as ⌘, ⌥ and ⇧ (`ui.keyText`; Safari too).

**Building**, on a Mac with Xcode's command line tools and Rust's `aarch64-apple-darwin` and `x86_64-apple-darwin`:

    desktop/macos/build.sh        # desktop/target/dist/: VibeOffice.app, and the DMG and package it can sign

It builds both binaries, joins them (`lipo`) and bundles `VibeOffice.app`; then, by the identities in the keychain
(found by name; `MACOS_DEVELOPER_ID`, `MACOS_APPSTORE_ID`, `MACOS_INSTALLER_ID` choose others):

- none: the app signed ad hoc, to try on that Mac (and the CI smoke run);
- Developer ID Application: the DMG (the app and an Applications link), notarized with an App Store Connect API key
  (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, the .p8 file) and stapled;
- Apple Distribution and Mac Installer Distribution, with `MACOS_PROVISION_PROFILE` (the profile's path): the App Store
  package.

The bundle's version is the date (`2026.10.15`), its build number the commit's UTC time (`2026.1015.641`), which rises
with every commit, as App Store Connect requires.

From Linux the crate only type-checks for macOS: linking needs Apple's SDK, which its licence allows on Apple hardware
only, so nothing here links, bundles or runs. After `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
(clang compiles the one Objective-C file of `objc2` for the check):

    cd desktop && CC_aarch64_apple_darwin=clang CFLAGS_aarch64_apple_darwin=--target=arm64-apple-macos11 \
      cargo check --release --target aarch64-apple-darwin

**CI**, run by hand: Actions ▸ macOS ▸ Run workflow (`.github/workflows/macos.yml`, on `macos-15`). It builds, then
opens the app alone and with a .docx, a .csv and a .md (`open -a`, as Finder does) and keeps a screenshot after each
(artifact `VibeOffice-macOS-smoke`, with the app's log). With the signing secrets it adds the DMG to the version's
GitHub release (the tag Windows uses, so one release holds both; `desktop/release-notes.md`) and, with *app_store*
ticked, uploads the package to App Store Connect (`altool`). Without them the app is signed ad hoc and nothing is
released: artifact `VibeOffice-macOS-unsigned`, which starts after `xattr -dr com.apple.quarantine VibeOffice.app`.

The signing material is in the secrets of the `release` environment (Settings ▸ Environments; limit it to `main`, so
runs from other branches and from forks never see them):

| Secret | What |
|---|---|
| `MACOS_DEVELOPER_ID_P12`, `MACOS_DEVELOPER_ID_PASSWORD` | the Developer ID Application certificate and key, a .p12 in base64 (only the team's Account Holder can create it) |
| `MACOS_APPSTORE_P12`, `MACOS_APPSTORE_PASSWORD` | the Apple Distribution and Mac Installer Distribution certificates and keys, one .p12 in base64 |
| `MACOS_PROVISION_PROFILE` | the Mac App Store Connect provisioning profile for `work.vibeoffice.desktop`, in base64 |
| `APPLE_TEAM_ID` | the team ID (otherwise read from the identity's name) |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | an App Store Connect API team key (the .p8 file's text) with the lowest role that works (Developer; App Manager if the upload is refused): notarizing and uploading |

Before the first upload: the app's record in App Store Connect (bundle ID `work.vibeoffice.desktop`) and the answers to
its export compliance questions (`crypto.js` encrypts and opens password-protected Office files with standard AES and
SHA), after which `ITSAppUsesNonExemptEncryption` goes into `Info.plist`. Submitting for review waits for real saving
(todos/DESKTOP_REAL_SAVE.md, Phase 2): until then every save lands in Downloads.

## Linux

Not supported for now (2026-10-13): no Linux release is made; Windows and macOS are the desktop app. The build below still works for development. The binary links the system's GTK 3 (LGPL-2.1-or-later), WebKitGTK (LGPL and BSD) and libsoup dynamically, which the LGPL allows (AGENTS.md, Code from other projects); the licence check below covers only the Rust crates, not these native libraries, so before a Linux release they are listed too, and what a package bundles is told apart from what it requires of the system.

The same crate builds for Linux against WebKitGTK 4.1, GTK 3 and libsoup 3 (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`):

    cd desktop && cargo build --release --target x86_64-unknown-linux-gnu

Run it with a file to open: `target/x86_64-unknown-linux-gnu/release/vibeoffice ~/Budget.csv`. No package yet (`.deb`, AppImage, a `.desktop` file with the MIME types).

## Size

| Build (2026-10-11, Tauri 2.12.3, rustc 1.95) | Size |
|---|---|
| `vibeoffice.exe`, release | 7.4 MB (7.39) |
| of which `public/` (11 MB, brotli quality 9) | about 4.1 MB |
| of which the three document icons | 315 KB |
| `WebView2Loader.dll`, installed beside the exe (GNU target) | 160 KB |
| `VibeOfficeSetup.exe`: the above, `LICENSE.txt` and its own 425 KB (code 283 KB, icon and dialog 57 KB) | 8.0 MB |
| `VibeOffice-Windows-x64.zip` | 5.8 MB |
| `vibeoffice`, Linux release | 7.2 MB |

Licenses: `tools/oss-licenses.py` lists every crate compiled into the app and its installer, on Windows, macOS and Linux (Linux's native GTK and WebKitGTK libraries are not crates and are not covered: Linux above; 168 today: the workspace's members and their normal dependencies all the way down, with features as the build resolves them, from `cargo tree`; not what only build scripts or Tauri's procedural macros use, such as `cssparser`, `selectors` and `dtoa-short`, MPL-2.0, which never reach the binary), with the license files from each package, and the DLL installed beside the exe (`WebView2Loader.dll`), in `public/oss-licenses.html`; run it after changing a dependency. It stops if a shipped crate's licence needs copyleft; `--check` (also in `node --test tests/licenses.test.mjs`) checks the page against the crates that ship.

No exe packers (UPX): antivirus flags packed exes. The largest pages are the thesaurus (`common/dict/en.thes`, 2 MB) and the two word lists (650 KB each).

## Results

- Linux (Debian 13, WebKitGTK 2.52.6, Xfce): Start Center, all three apps; `vibeoffice Budget.csv` opens it in Ledger and `Notes.md` in Quire, the title bar follows the document; Recent Files and the look are kept between runs. With no network at all (`unshare -rn`), a fresh profile: everything loads, in Paper; the GitHub button goes to `xdg-open`; UI size 150 % and 200 % scale the whole UI, sharp, and are back after a restart; the Start Center keeps Settings reachable in its narrow layout. Started with `Budget.csv`, the Start Center stays and Ledger opens in a window of its own; Quire from the Start Center opens a third window, and its File ▸ Exit closes only that one.
- macOS (2026-10-15, the CI's first run, macos-15): builds universal (arm64 and x86_64, 15.3 MB), signed ad hoc; the smoke run opens the Start Center, then `linecases.docx` in Quire, `Budget.csv` in Ledger and `Notes.md` in Quire, each in a window of its own in the one running process, under the App Sandbox with no denials, and quits cleanly. Not yet used by a person on a Mac (menus, ⌘ keys, saving, Browse, links, the Dock). The network rules (2026-10-16; failing closed, with the probe, the same day) type-check for both and pass `cargo test`; not yet run.
- Not yet run against the published site: the update check (the site has no `updater/current.json` yet).
- Installer (2026-10-11), Wine 10.0, `tests/desktop/setup-wine.py`: passes. The dialog shows the pinning hint (Wine has no TaskbarManager); install writes the three files, both shortcuts and the HKCU values; the same version again shows no dialog; uninstall (Enter) leaves no folder, shortcut or value of VibeOffice's and keeps another program's. `cargo test` (Windows target, under Wine): 5 passed. Wine cannot show the app itself (no WebView2), the pin prompt or Default apps.
- Windows: built, not yet run. To check, as a user without administrator rights: install (the dialog at 100 % and 200 %), the pin prompt on an up-to-date Windows 11 and the hint on Windows 10, Default apps opening at VibeOffice's page, a double-clicked .docx afterwards; Open with lists VibeOffice for .docx, .xlsx and .pptx with their document icons; an update while the app runs; Uninstall from Apps & features; all three apps, saving, drops.

## Known limits / to do

- GNU builds import `WebView2Loader.dll`, installed beside the exe (Microsoft's static loader is MSVC-only).
- Saving goes to the Downloads folder (Saving, above); writing the real file is planned in todos/DESKTOP_REAL_SAVE.md.
- macOS: the menu bar is in English whatever the UI's language; the system draws the document icons (the app's icon on a page) rather than Quire's, Ledger's and Lectern's.
- Linux: opening a file while the app runs starts a second process with its own Start Center, and closing the Start Center's window leaves no way back to it but starting the app again (Windows has one instance, which brings it back).
- The Start Center's wording is the web's ("Office suite in your browser", "Recent files are kept in this browser only").
- Code signing (SmartScreen warns about unsigned installers).
- Installing for all users (UAC, Program Files, HKLM), where only administrators can change the app's folder; today it installs per user only.
