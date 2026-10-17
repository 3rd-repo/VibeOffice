# Desktop app: hardening, native storage, one document per window, real saving

Status: planned 2026-10-11; refreshed 2026-10-17 at 97c1e06; Phase 0 built 2026-10-17 (not committed; Linux run);
2026-10-17, the user: focus on getting Phase 2 done, so Phase 1's parts real saving needs came first, then Phase 2
(both built 2026-10-17, not committed; Linux run), and the rest of Phase 1 waits (marked below). Read
docs/desktop.md (Host interface, Network, the deadlock rules) first. Four phases, in order: 0 harden the host as it is
(from the audit below), 1 native storage and one document per window (saves still go to Downloads), 2 saving to real
files, 3 folder access in sandboxed builds. Mark each task when it is done and verified.

Since the plan was written:
- **The macOS port** (2026-10-15; docs/desktop.md, macOS). Both Mac editions run in the App Sandbox, so the sandbox is
  part of Phases 1 and 2 from the start, not only Phase 3: Recent Files need security-scoped bookmarks, and a save
  can't put a temp file beside the user's file (see each phase). `~/.vibeoffice` is inside the app's container there.
  The Mac App Store submission waits for Phase 2.
- **The hardening plan** (todos/HARDENING.md) did part of Phase 0 its own way: the network rules (net.rs: WebKit
  content rules on macOS, WebView2's request filter on Windows; each window starts on about:blank and goes to its page
  only once they are on), a Content-Security-Policy meta tag in every page (`tools/csp.mjs`, web and desktop alike;
  `csp` in tauri.conf.json stays null), the link allow-list (`host::may_open`), `ui.linkDialog` for document links,
  and `on_new_window` always Deny. Marked below; what is left of each item says so.
- **The deadlock rules** (docs/desktop.md, Host interface; 97c1e06): a command that makes a window is `async`, and a
  `with_webview` closure calls no Tauri method of its window. Phase 0's WebView2 settings go inside net::guard's
  closure, which already obeys it.
- **Before Phase 2 can be verified**, Windows needs its first real run (nobody has run the app there yet; Wine has no
  WebView2), and the macOS run of 97c1e06 should pass (the network probe).

## Tasks

Phase 0: harden the host as it is
- [x] Capabilities: no `core:default`; the `host_*` commands in permissions/host.toml, granted per window kind in
      capabilities/ (start, apps; the licences page none); window labels `<page>-<n>` (2026-10-17: Linux run; Windows
      and macOS type-checked, not yet run)
- [x] Links: only the Start Center sends an address to the browser, and only the update page or our GitHub
      (`host::is_ours`, `may_open`; no user name); the licences page shows its addresses with Copy in the desktop app
      (oss-licenses.js) (2026-10-17: Linux run)
- [x] Links in documents (Quire, Ledger, Lectern): `ui.linkDialog` shows the address with Copy, on the desktop and the
      web alike (7189436, HARDENING 3.1)
- [x] `on_new_window`: always Deny (d7a32ef)
- [x] Navigation: a window loads only its own page, once (`host::Page`: after about:blank, and the probe's data:
      page when `VO_NET_PROBE` is set; then reloads, fragments and its own blob:, which a save on Linux starts as); `VO.go`
      reports a window it couldn't open (2026-10-17: Linux run)
- [x] CSP: a meta tag in every page (d7a32ef, `tools/csp.mjs`) and the network rules (7189436, ee82eb7, 97c1e06)
- [x] No WebRTC: `net::NO_WEBRTC` in every frame (`initialization_script_for_all_frames`) (2026-10-17; check on
      Windows and macOS that it also reaches an `about:blank` iframe the page makes)
- [x] `host_new_window`: page ids instead of URLs (`{ page, start }`, `host::page_path`); app windows open only the
      licences page; at most 64 windows (2026-10-17, with the capabilities)
- [x] Launch files: `host_launch_files` and `host_read` for the Start Center only; reads capped at 512 MiB
      (`read_capped`) (2026-10-17)
- [x] Downloads (interim): refuse Windows reserved names and characters Windows can't hold (a trailing dot or space
      can't happen: the name ends with its type's extension); at most one per window per second (2026-10-17)
- [x] Web permission requests denied natively, except Local Font Access and the clipboard (Tauri's
      `on_permission_request`, all three systems) (2026-10-17; to check on Windows: Settings ▸ Fonts on this
      computer, Paste)
- [x] WebView2 browser shortcuts off (`net::win::browser_keys_off`, in guard's closure) (2026-10-17; type-checked,
      to check on Windows)
- [x] Init script built with serde_json; `__VO_HOST__` read-only (2026-10-17)
- [x] DLL planting (audit item 15): the installer (`VibeOfficeSetup.exe`) loads only Known DLLs; no loose app zip
- [x] Tests (cargo, host stub, live link checks) and docs/desktop.md (2026-10-17: 15 cargo tests; the stub refuses
      what the capabilities refuse, and a test compares them; on Linux a build without one grant showed the page
      refused, so the capabilities hold without `dynamic-acl`)

Phase 1: native storage and one document per window
The parts real saving needs (2026-10-17: Linux run; Windows and macOS type-checked, not yet run):
- [x] `~/.vibeoffice` store (store.rs): recent_files with previews and drafts, the atomic write, `VIBEOFFICE_HOME`
- [x] Files bound to windows (doc.rs): `host_document`, `host_open` with the Open dialog (dialog.rs: rfd on Windows and
      macOS, GTK's native chooser on Linux), files from the command line, another start and Finder opened by Rust in
      their own windows (no more `host_launch_files`, `host_read`)
- [x] macOS: security-scoped bookmarks for Recent Files (type-checked; entitlement `files.bookmarks.app-scope`). Not
      done: an entry whose file moved keeps its old key (the plan: move it to the new path's key)
- [x] One document per window in Quire, Ledger and Lectern (`VO.oneDocument`, `hooks.pristine`); page-made documents as
      bytes (`VO.made`, Quire's `A.toWindow`); the Window menu (`VO.windowItems`)
- [x] Recent Files, previews and drafts native (`VO.recent`'s desktop side, Document Recovery, `vo-recent`)
- [x] Close flow (`vo-close`, `host_closing`, the native question after 10 s)
- [x] Tests and docs (cargo: store, doc, types; the stub plays the new commands; docs/desktop.md, Documents and windows)
After Phase 2 (2026-10-17: Linux run; Windows and macOS type-checked, not yet run):
- [x] Single instance on Linux (instance.rs: a lock and a Unix socket per user and display, in $XDG_RUNTIME_DIR);
      Windows has it (tauri-plugin-single-instance, `second_start`), macOS by LaunchServices (`RunEvent::Opened`)
- [x] config.json in `~/.vibeoffice` (settings.rs; strings, as localStorage keeps them; settings.json read once)
- [x] Settings: `host_set_setting`, `vo-settings`; `VO.settings` (common/look.js), `L.store`, looks, the head scripts,
      UI size. Not in `__VO_HOST__`: a window's init script stays as it was made, and the Start Center reloads when
      its language changes, so the settings are served at the top of common/look.js (`settings::Served`)
- [x] No browser storage: the init script removes the APIs (`host::NO_STORAGE`), incognito web views on Windows and
      macOS (not on Linux: Tauri 2.12 registers tauri:// once per shared context, and an incognito WebKitGTK view
      gets its own), the stub and the static test; https scheme on Windows (`use_https_scheme`, tools/csp.mjs)
- [x] Scout to `VO.settings`

Phase 2: saving to real files (2026-10-17: built; Linux run; Windows and macOS type-checked, not yet run)
- [x] File type table (types.rs `KINDS`: id, extensions, document type or export, how the bytes start)
- [x] `files::write`: checks, temp file and replace (`ReplaceFileW`; rename, the in-place path), error codes
- [x] `host_save`, `host_choose`, `host_write_chosen`, `host_cancel_choice`; the Save dialog (rfd; GTK's chooser with
      the extension rules)
- [x] macOS: the write through `replaceItemAtURL` (type-checked; verify on a Mac, both editions, another volume,
      iCloud Drive)
- [x] Mark of the Web carried to Save As and exports (Windows, `files::carry_mark`; to check there); macOS's
      quarantine attribute not checked yet
- [x] Previous versions and File ▸ Versions… (menus and ribbons, desktop only)
- [x] `L.file` in common/core.js (choose, write with the error table, `L.saveFile` as an export)
- [x] Quire, Ledger and Lectern on `L.file` (and Ledger's Cancel-while-closing fix, on the web too). Done more simply
      than the `L.file.setup` design: each app's own save code takes `how` ('save', 'chosen') and its type list
      (`L.file.types`) is shared with its web Save As dialog
- [x] Remove the Downloads interim; File System Access API off (`host::NO_FILE_PICKERS`, every frame); the Mac's
      Downloads entitlement dropped
- [x] Tests and docs (cargo: files, types, store versions; the stub's save commands; docs/desktop.md, Saving)
Done since (2026-10-17): the title's "(Read-Only)"; changes made during a save stay unsaved (`VO.changeCount`); new
documents numbered across windows (Rust's `n` in the address). Ledger's password to open was never missing: Tools ▸
Options ▸ Security. Left: `vo-saved` only for document saves (exports tell it too, as on the web); an opened version's
window has the file's name (no "previous version" in its title); an export's toast (Ledger's PDF) names the workbook,
not the file picked.

Phase 3: the Mac sandbox (2026-10-17: built; type-checked, not yet run on a Mac)
- [x] Allow Access… for `denied` in both Mac editions: the folder chooser at the file's folder (`host_allow_access`,
      `__VO_HOST__.sandboxed`), the grant for this run only (no bookmark: the user, 2026-10-17), then the save again. To try on a
      Mac: a file whose folder the sandbox refuses (a file-only grant where the save needs the folder), both editions,
      another volume

### Audit of real open and save — 2026-10-17

Audited `4f9e9fd` plus the working tree's save fixes and in-progress native-settings work. The core real-saving
implementation is committed in `4f9e9fd`; the older "not committed" status above predates that commit. Other work
continued during this audit, so the native executables tested, their SHA-256 hashes, working diffs, source-fixture
hashes, screenshots and raw results are retained in `tmp/real-save-audit-20261017/`. No implementation was changed
by this audit. **Real file I/O works, but the close/open failures below prevent calling the workflow complete.**

Verified with the native Linux executable, real keyboard input and files on disk (isolated display and store):
- Independently authored POI corpus DOCX, XLSX and PPTX: open, edit, Ctrl+S, inspect the written package, then start
  the native app again on the saved file. All three retain the typed marker on reopening. LibreOffice opens both
  originals and saved files; page counts remain **2→2, 1→1, 1→1** respectively, with **zero new package findings**.
  These three samples are a smoke check, not a whole-corpus fidelity or Microsoft Office acceptance result.
- Quire's native Save As Cancel leaves every file unchanged; Save As to another DOCX changes the window's identity,
  and the next Ctrl+S changes only that copy. The first overwritten DOCX is retained byte-identically in Previous
  Versions. Native CSV Ctrl+S also writes the edit to disk, with the dirty-state problem below.
- Latest checks: **29/29 Rust tests**, **35/35 Chromium host-stub tests**. The first browser run was 30/33 while
  settings and its stub were being migrated; that log is retained separately. The native findings below are not
  exercised by those passing tests. SDK validation was not rerun successfully here (the runtime was unavailable);
  package and LibreOffice checks are in `validation-lo.jsonl`. Windows, macOS and Microsoft Office runtime
  acceptance remain pending.

To do from the audit:
- [x] **P1 — An unbound app window can take another Recent Files document into its existing script context.**
  Source-confirmed in `4f9e9fd` and the current tree (2026-10-17): `doc.rs::host_open_recent` accepts the page's
  `here: true` when the caller's app matches and `Doc.file` is `None` (or no `Doc` exists). Dropped documents,
  never-saved documents and their drafts satisfy this even after parsing untrusted content. A compromised page
  can enumerate keys with `host_recent`, choose an entry not open in another window, then call
  `host_open_recent({ key, draft: false, here: true })` and `host_document_bytes` to read its file without a picker.
  `draft: true` likewise exposes a stored draft. `suite.js`'s `pristine()` is only a page-side check; the direct
  host call bypasses it. Open Recent Files in a fresh native window (or use a native authorization boundary that
  cannot trust the caller's blank/dirty claim). Add a native regression covering consumed dropped bytes and a
  never-saved draft; the existing host-stub tests exercise ordinary UI routing, not this forged request. This
  finding is from source review, not a native runtime reproduction. A window already bound to a path fails the
  reuse guard; the target must belong to the same app and not already be open. This contradicts the Threat model's
  claim that a compromised window cannot read another file.
  Fixed (2026-10-17, then as the user designed it, 2026-10-18): no page already running is given another document.
  Recent Files are the Start Center's alone: app windows lost `host_recent`, `host_recent_preview`,
  `host_open_recent` and `host_discard_draft`, and their lists lead to the Start Center (`host_show_recent`). File ▸
  Open in an app window holds the user's pick, asks "Save changes?", then reloads the window (`host_reopen`) to a page
  whose address has a one-time word: only that page is given the document (`Doc::token`); a window otherwise gets
  its document as it is made (`Docs::adopt`). Tests: cargo `a_window_keeps_the_document_it_was_made_with`,
  `a_window_reloaded_for_a_file_gives_it_only_to_the_page_with_its_word`; host.test.mjs "File > Open asks to save"
  (the replaced page asks for the document and gets nothing) and "an app window's Recent Files".
- [x] **P1 — Escape must cancel closing, not discard the document.** `public/common/ui.js` marks both No and Cancel
  as `cancel` buttons (`ui.msg`), and its Escape handler picks the first, No. Native reproduction: edit `Escape.csv`,
  wait for its actual draft, Ctrl+W, Escape. The process exits, the file lacks the edit, and the draft is deleted
  (`escape-entry-before.json`, `escape-entry-after.json`, `native-csv-probe.py`). The same path calls
  `host_clear_draft` and `host_close_window` in all three apps' browser probes (`escape-*-later.log`).
  Fixed (2026-10-17): `ui.msg` flags Cancel for Esc, No only where there is no Cancel. Test: host.test.mjs, "Esc in
  Save changes?", all three apps (fails with the old ui.js); natively, Ctrl+W then Esc on an edited CSV with its
  draft written keeps the window, the edit and the draft.
- [x] **P1 — Opening another native Linux window fails.** File ▸ Open from an existing Ledger window, and clicking
  a Start Center recent-file card, create a window saying "The URL can’t be shown". Opening the same files at
  process startup succeeds. Reproduced again with the later build (`native-open-later.png`, binary hash in
  `binary-later.sha256`). Investigate `desktop/src/main.rs`'s new `.incognito(true)`: Wry 0.57 creates a fresh
  ephemeral WebContext for each such window, while tauri-runtime-wry 2.12.1 skips custom-scheme registration after
  the first window against its cached context. The host stub replaces its one tab when opening a window, so it
  cannot catch this. Native Recent Files/draft/previous-version opening needs a real multiple-window test.
  Fixed before the audit's later binary was replaced (it was copied at 20:48; incognito went off on Linux at 20:52,
  main.rs): natively, a Recent Files card, File ▸ Open from a Ledger window and a draft's card each open a new
  window.
- [x] **P2 — Saving an opened CSV leaves it dirty.** Native `Budget.csv`: edit, Ctrl+S, verify the edit on disk,
  then Ctrl+W still asks to save (`native-csv-close-after-save.png`). `public/ledger/js/app.js` excludes csv/txt/html
  from clearing `b.dirty` even when `how === 'save'` wrote the bound file. Distinguish saving that file from an export.
  Fixed: Save of the window's own text or web page file clears it, but for a workbook of more sheets than a text file
  holds. Natively: edit, Ctrl+S, Ctrl+W closes without asking.
- [x] **P2 — CSV draft recovery keeps the XLSX writer for the bound CSV file.** Ledger snapshots CSV as XLSX, then
  its recovery hook restores the name but not the source format. The focused page/host-stub probe opens a recovery
  descriptor for `Budget.csv` / `Budget.xlsx` and records `b.type === 'xlsx'` and ZIP bytes passed to `host_save`
  for `Budget.csv` (`recovered-csv.log`). The real host chooses CSV by path and its text-byte guard rejects those
  bytes. This routing finding is not a completed native recovery test: the native new-window failure above blocks
  that path. Preserve the original type or explicitly offer Save As; cover XML Spreadsheet/text recovery too.
  Fixed: a recovered draft of a saved file takes its file's type by name (csv; txt, tsv, prn; xml; htm, html). Test:
  host.test.mjs, "Ledger saves the CSV it opened" (the stub hands over Ledger's own XLSX snapshot). Natively: a
  killed app's CSV draft, opened from its card and saved, writes CSV text, clears the draft, closes without asking.

Additional source review (2026-10-17): the findings below are from reading the current native host and its callers.
No tests, builds or runtime reproductions were run for these findings.

- [ ] **P2 — Failed draft metadata validation can leave unlimited orphan draft files.**
  `doc.rs::split_draft` accepts an arbitrary `lossState`; `Store::set_draft` writes the up-to-50-MiB draft before
  `Store::put` checks whether the serialized entry exceeds `MAX_ENTRY` (2 MiB). In a never-saved window with no
  existing entry, oversized metadata therefore leaves `<key>.recent.draft` without `<key>.recent` and returns an
  error. `host_clear_draft` then sees no entry, does not remove those bytes, and clears the window's key. Repeating
  the two commands allocates a new key each time and accumulates files, without opening more windows or obtaining
  a file-picker grant. `folder_of`, `list`, `prune` and `clear` discover entries through `.recent`, so they cannot
  reclaim these orphans. Validate and serialize the complete entry before writing any draft bytes, clean up failed
  new-entry transactions, and enforce a total storage budget. Per-file size limits do not satisfy the Threat model's
  claim that a compromised page cannot fill the disk. Sources: `desktop/src/doc.rs` (`host_set_draft`,
  `split_draft`, `host_clear_draft`), `desktop/src/store.rs` (`put`, `set_draft`, `drop_draft`, `folder_of`).

- [ ] **P2 — Cancelling a new Save dialog leaves an earlier destination authorized.**
  `doc.rs::host_choose` leaves `Doc.choice` intact while showing a new dialog and returns `None` on Cancel or a
  declined final-name overwrite question without revoking it. A previously selected destination, including one
  retained after a failed write, remains writable by `host_write_chosen` after the user cancels the later dialog.
  `common/core.js::L.file.choose` sets its page-side `pending` to null, but that does not revoke the native choice;
  compromised script can call the host directly. Also, an in-flight write's error path restores its old choice with
  `get_or_insert`, even if `host_cancel_choice` ran while that write was in progress. This requires an earlier user
  selection; it is a stale grant, not an arbitrary-path write. Give choices a generation, revoke the prior grant
  when replacing/cancelling a dialog, and prevent old write completions from restoring a revoked grant. Sources:
  `desktop/src/doc.rs` (`host_choose`, `host_write_chosen`, `host_cancel_choice`), `public/common/core.js` (`L.file.choose`).

- [ ] **P2 — Save As and exports do not revalidate the chosen destination before overwriting it.**
  `Choice` stores only path, type and purpose; the planned `existed: base or none` is absent. `host_write_chosen`
  passes `Over::Chosen`, which `files::write` exempts from the change check. If a user chooses a new name and another
  program creates that file while the document is being serialized, the write can replace it without an overwrite
  confirmation; an existing file changed after the dialog is likewise overwritten. The `open-elsewhere` check runs
  only in `host_choose`, so a file opened in another VibeOffice window after selection can also be overwritten and
  then bound to both windows. The write mutex only excludes simultaneous writes, not this stale authorization.
  Capture the approved destination's existence and identity/version, reserve its normalized key, and revalidate
  both the file and its window ownership at the write boundary. Sources: `desktop/src/doc.rs` (`Choice`,
  `host_choose`, `host_write_chosen`, `claim`), `desktop/src/files.rs` (`Over`, `write`).

- [x] **P2 — Concurrent opens can bind the same Recent Files entry to multiple windows.**
  `host_open_recent` and `open_path` check `Docs::window_of` and release its mutex before `open_in_window` calls
  `Docs::set`. Two concurrent opens of the same unopened key can both pass the check and create distinct owners.
  Those windows share the same file and draft entry; clearing a draft from one can remove the other's recovery
  data. This remains possible when every open goes into a new window, so removing `here` does not close it.
  Reserve document ownership atomically by key before opening a window, and release the reservation on failure or
  destruction. Sources: `desktop/src/doc.rs` (`window_of`, `set`, `open_path`, `host_open_recent`, `open_in_window`,
  `host_clear_draft`). This is a source-visible interleaving; its runtime frequency has not been measured.
  Fixed: `Docs::adopt` refuses a key another window holds under the windows lock and the open brings that window
  forward (same cargo test). The store's entry update before it is idempotent (`record`).

- [ ] **P2 — Page-made documents and reopened versions lose Windows source-zone provenance.**
  `host_new_document` and `host_open_version` create `Start::Bytes` with a default `Doc`: no bound source file and
  no separate provenance field. When that window saves to a fresh filename, `host_write_chosen` calls
  `files::carry_mark` only if `own_file` exists, so it does not carry the original document's `Zone.Identifier`.
  This affects a document made from an internet-marked source (for example Quire's mail-merge output) and a previous
  version reopened from one, despite the plan explicitly requiring never-saved derived documents to carry the mark.
  The new file consequently lacks that source's Protected View provenance. Keep source-zone metadata in Rust
  separately from the writable file binding, inherit it when making a document from another window, and preserve
  it through drafts and version recovery. Sources: `desktop/src/doc.rs` (`Doc`, `Start`, `host_new_document`,
  `host_open_version`, `host_write_chosen`), `desktop/src/files.rs` (`carry_mark`). Windows behavior was not exercised.

- [ ] **P2 — A failed previous-version backup is silently treated as successful protection.**
  `Store::keep_previous` returns no result and logs copy/sync/rename failures only to stderr. `files::write` proceeds
  with the replacement, and `host_save` sets `Doc.kept = true` after the successful write even if no previous version
  was retained. For example, an unwritable backup directory with a writable document directory allows the original
  to be overwritten without its promised recovery copy, and subsequent saves in that window never retry retention.
  This is separate from the documented 200-MiB exclusion. Return a retention result, set `kept` only after an actual
  retained copy, and handle failure before replacement according to an explicit user-visible policy. Sources:
  `desktop/src/store.rs` (`keep_previous`), `desktop/src/files.rs` (`write`), `desktop/src/doc.rs` (`host_save`).

## Decisions (the user, 2026-10-11)

- The desktop app never uses the web view's storage: no localStorage, sessionStorage, IndexedDB, Cache Storage or
  BroadcastChannel. The web keeps them.
- Settings: a host settings API, stored in `~/.vibeoffice/config.json`.
- Recent Files: `~/.vibeoffice/recent_files/<yyyy-mm>/<sha256>.recent`, the preview image beside it as
  `<sha256>.recent.preview`. A user's file name never comes into a path the app makes.
- Writing files is the dangerous surface. Save without a prompt (Ctrl+S) writes only the document's own file, which
  the user chose; Save As and every export always ask with the system Save dialog and write only what was picked
  there; no write ever goes to a path that came from a page.
- Only the Start Center opens web addresses, and only those on an allow-list kept in Rust.
- When a write is refused for lack of permission in the Mac sandbox (both editions), offer to grant access to the
  folder. Linux ships only as an AppImage, which isn't sandboxed: no Flatpak or Snap (the user, 2026-10-17).
- Harden first, then native storage; real saving builds on both.
- (2026-10-17) The browser gets only what is on the allow-list, which has two entries for now: the update page
  (`https://vibeoffice.work/updater/`) and our GitHub (`https://github.com/tcchen2026/VibeOffice`). The rest of
  vibeoffice.work leaves the list. Every other address shows with Copy, for the user to paste into their own
  browser, as document links do; the licences page's links included, so `may_open`'s licences exception (d7a32ef)
  goes. Only the Start Center sends addresses to the browser.

## Threat model

The pages are our code, but they parse untrusted documents: assume a document can run script in its window. Every
guarantee lives in Rust, keyed by the calling window, which Tauri hands to a command (`window: WebviewWindow`) from
the web view the call came from; a page can't name or pose as another window. The Start Center parses no documents,
so it is the one window trusted to open web addresses.

A compromised app window can: write its own document's file (its previous version is kept) and, once, a file the user
just picked in its Save dialog; write its own Recent Files entry's draft and preview, and the settings (bounded; Rust
acts on only two of them, validated); open Recent Files entries and page-made documents in new windows; remove Recent
Files entries and discard drafts of documents not open in any window.

It can't: write, read or name any other file; reach another window's document; take its file to another page; open
any address in the browser; send anything to a server other than vibeoffice.work (the pages' policy, and on Windows
and macOS the network rules beneath it, which hold even on a page without the policy); fill the disk (every stored
item has a size cap, and their number is bounded).

Accepted: the policy is one for every page, so an app page may also reach vibeoffice.work, our own static site;
until Phase 1 moves the pages to https on Windows, Chromium may look up the names of links on the page (DNS prefetch),
a few bytes out; the page sets its window's title; Linux has no network rules yet, only the policy
(WebKitGTK's `WebKitUserContentFilterStore` takes the same list as macOS's), and WebKitGTK's WebRTC is off by default.

## Audit of the host as it is (545b9f7; status 2026-10-17, 97c1e06)

| # | Finding | Risk | Fix |
|---|---|---|---|
| 1 | `on_new_window` returns `Allow` for every address that isn't http(s): `file:`, UNC paths, `ftp:`, other apps' protocol handlers, our own pages. The engine then opens its own popup, outside all our handlers (navigation, downloads, the IPC rules), and what it does with those schemes is up to it. Document hyperlinks get there: Quire's Ctrl+click and Open Hyperlink and Lectern's slide show pass the document's address as it is; Ledger lets `ftp:` through | High | **Done** (d7a32ef): always Deny |
| 2 | `on_navigation` allows every address that isn't http(s), and any of our pages, in any window, any number of times | High | Phase 0: one page per window. Still open: any of our pages, `about:`, `blob:` and `data:` load in any window |
| 3 | The capability grants `core:default`: about 70 Tauri commands no page uses, among them `image.fromPath` (reads a file at a path the page gives), `path.resolveDirectory` and friends (the home folder, so the user's name), menus and tray icons, events to other windows, window, monitor and cursor queries | High (surface) | Phase 0: no core commands; ours per window kind. Still open |
| 4 | No CSP (`csp: null`): any page can fetch, post to or load from any server, so limiting links alone wouldn't stop a document's script from sending its text out | High | **Done** another way: the pages' policy (d7a32ef) and the network rules on Windows and macOS (7189436, ee82eb7, 97c1e06), not tauri.conf.json |
| 5 | `host_open_url` and the external-link handlers: any window, any http(s) host, and `mailto:` (some mail programs honour `attach=` and attach local files) | Medium | Allow-list and no mailto **done** (d7a32ef); the Start Center only: still open (any window may send our own addresses) |
| 6 | `host_read(handle)`: handles are process-wide, sequential and never revoked, so any window can read every file launched so far; no size cap | Medium | Phase 0: Start Center only, cap; Phase 1 replaces it. Still open; Finder's files (macOS) take the same path |
| 7 | `host_launch_files`: any window can take the launch files | Low | Phase 0. Still open |
| 8 | `host_new_window(url)`: any of our files, any query string, any number of windows | Medium | Phase 0: page ids, at most 64. Still open (it checks the scheme, host and port only) |
| 9 | Downloads (interim): any page writes files into Downloads without asking, `.html` and macro-enabled `.docm`, `.xlsm`, `.pptm` included; Windows reserved names (`CON.docx`) and names ending in a dot or space aren't refused | Medium | Phase 0 for the names; Phase 2 ends downloads. Still open |
| 10 | A saved copy loses the Mark of the Web: a file from the internet saved under a new name no longer opens in Office's Protected View | Medium | Phase 2: carried over (macOS: check what the sandbox's quarantine attribute already does) |
| 11 | WebRTC can reach any server; CSP doesn't cover it | Medium | Phase 0: removed by the init script (Windows, macOS's direct edition; the App Store edition has no network entitlement, Linux has WebRTC off). Still open |
| 12 | Web permission requests (camera, microphone, location, notifications) get the engine's default handling | Low, to verify | Phase 0: denied natively with Tauri's `on_permission_request` (now in Tauri 2.12; on macOS the sandbox already refuses camera, microphone and location, which no entitlement grants). Still open |
| 13 | WebView2's browser shortcuts are on: F5 and Ctrl+R reload, Ctrl+P, Ctrl+F, Ctrl+S (save the page) | Low | Phase 0: off. Still open |
| 14 | The init script is assembled with `format!`; a page can replace `__VO_HOST__` | Low (hygiene) | Phase 0. Still open (`Object.freeze` keeps the object, not the property) |
| 15 | The exe imports `dwmapi.dll`, which isn't a KnownDLL: the portable zip's exe run from Downloads, with a planted `dwmapi.dll` beside it, loads that DLL. The MSI installs into Program Files, which users can't write, so it is unaffected. GNU ld can't set `DependentLoadFlags` | Medium (zip) | **Done** another way: no zip of the app any more. The release is `VibeOffice-Windows-x64.zip` holding `VibeOfficeSetup.exe`, which imports only Known DLLs and API sets (`build.sh` fails otherwise) and calls `SetDefaultDllDirectories` first; it installs per user into `%LOCALAPPDATA%`, writable by the user as Chrome's per-user install is (docs/desktop.md, Installer) |
| 16 | settings.json is written in place, not atomically | Low | Phase 1 store. Still open |
| 17 | The pages are served as http://tauri.localhost on Windows: not a secure context, and Chromium prefetches DNS for links on http pages | Low | Phase 1: https scheme (the origin change costs nothing once storage has left the web view) |
| 18 | (2026-10-17) Linux reports a page as started at WebKitGTK's load start, before the old page's script stops, and `leave` judges links by the page last started: an app window that goes to the licences page could, for that moment, send any http(s) address to the browser | Low | Phase 0: the licences page sends no address (Decisions, 2026-10-17); the navigation rule as well |
| 19 | (2026-10-17) Linux has no network rules, only the pages' policy: a window moved to a page without it (`data:`, `blob:`) reaches any server | Low (Linux isn't released) | The navigation rule closes the way there; later, the same list through `WebKitUserContentFilterStore` |

Checked and fine: devtools are off in release builds (no `devtools` feature); `withGlobalTauri` is off; IPC is
accepted only from our own origin (no remote URLs in any capability); opening an address hands only http(s) to the
system (`ShellExecuteW` "open", `xdg-open` with the address as one argument), never a path or a program; Browse takes
no arguments and shows only a file this app wrote into Downloads (explorer `/select` with a quoted path; Windows names
can't hold a quote); a download is a bare name of a type the apps save, never over an existing file; the save notice
carries the name only; the exe has NX, ASLR and high-entropy ASLR; the installer's ProgIDs quote `"%1"` (it replaced the MSI);
the updater's notes are shown as text, not HTML.

# Phase 0: harden the host as it is

None of this waits for native storage; it closes the audit's holes in today's build. Items marked done came from the
hardening plan (todos/HARDENING.md); the rest is as planned, brought up to 97c1e06. Each window is still made by
`open_window` (main.rs): on about:blank, then `net::guard` puts the network rules on its web view and sends it to its
page. Per-web-view settings (the WebView2 ones below) go into guard's `with_webview` closure beside the rules, so no
page ever runs without them, and that closure calls only the platform web view, never a Tauri method of its window
(the deadlock rule).

Commits, each with its tests (a regression test seen failing on the code before), type-checked for Windows and macOS
and run on Linux; the macOS CI run and a Windows run after the last:
1. capabilities (permissions/host.toml rather than an app manifest's `commands`: the same refusal, no generated files),
   the labels and `host_new_window` by page id, since the label comes from the page (done 2026-10-17);
2. navigation, the link gate (the Start Center only, the two-entry list, Copy on the licences page), `VO.go`'s
   fallback (done 2026-10-17; Linux: the Start Center arrives as `tauri://localhost`, with no `/`, and `#create`
   comes as a navigation; a save starts as a `blob:` navigation, so the window's own blob: stays allowed);
3. launch files, downloads, permissions, WebView2's keys, WebRTC, the init script; docs/desktop.md (done
   2026-10-17). Found on Linux (not released): WebKitGTK's downloads belong to the web context all windows share, and
   wry connects every window's download handler to it, so each save reaches every window's handler (the label is
   the first window's) and, after one refused download, wry's `failed` flag stays set and every later save reports
   failure though written. Windows and macOS have a handler per web view. Phase 2 ends downloads; until then a Linux
   release would need wry fixed.

Phase 0 is built (2026-10-17, not committed): run the macOS workflow (the probe, the pages) and Windows (the run in
docs/desktop.md, F5 and Ctrl+P doing nothing, a camera request refused, Settings ▸ Fonts on this computer, Paste).

- **Capabilities.** Drop `core:default` (capabilities/default.json grants it to `main` and `doc-*` today): pages call
  only our `host_*` commands, through `__TAURI_INTERNALS__.invoke`. Declare those in an app manifest (build.rs:
  `tauri_build::try_build(Attributes::new().app_manifest(AppManifest::new().commands(&[…])))`, beside build.rs's
  icon resources), so each is refused unless a capability grants it, and grant them per window kind, which the label
  carries (`<page>-<n>`, replacing `doc-N`): `start` (`main`) its commands, `host_open_url` included; `apps`
  (`quire-*`, `ledger-*`, `lectern-*`) theirs, without `host_open_url`; `licenses-*` none. Each command still checks
  its window itself; the ACL is a second wall. Check that `net::probe`'s title messages and the init script need no
  core command.
- **Links.** Done in d7a32ef: one gate, `host::leave(app, label, url)` → `may_open(page, url)`, for `on_navigation` and
  `on_new_window`; `host_open_url` checks `is_ours`. https only, no port, an exact host and a path prefix that ends at
  a `/`, the list in Rust; no mailto; the parsed address goes to the system (`ShellExecuteW` "open", NSWorkspace,
  `xdg-open`). Still to do:
  - only the Start Center sends addresses (today any window may; the only caller of `host_open_url` is
    public/start.js, for Update; the GitHub button is a link that `leave` judges);
  - the list narrows to two entries (Decisions, 2026-10-17; the table below): vibeoffice.work only under `/updater/`
    (today any path);
  - the licences page sends none (Decisions, 2026-10-17): `may_open` loses its licences branch, and on the desktop
    public/oss-licenses.js cancels a click on a link and shows the address with Copy Address (a small box of its own:
    the page loads no common/ui.js), as `ui.linkDialog` does for documents; on the web its links stay links;
  - refuse an address with a user name or password (`is_ours` doesn't look today).

    | Host | Path | For |
    |---|---|---|
    | `vibeoffice.work` | `/updater/` and below (any query) | Update (`VO.updateUrl()`: `/updater/?from_version=…`) |
    | `github.com` | `/tcchen2026/VibeOffice` and below | the Start Center's GitHub button |
- **Links in documents.** Done in 7189436 (HARDENING 3.1), differently from the plan: Quire, Ledger and Lectern call
  `L.ui.linkDialog(url)`, the address with a warning and Copy Address, on the web as well as the desktop; links inside
  the document (bookmarks, references, slide jumps) still go there. No `VO.followLink`.
- **New windows.** Done in d7a32ef: `on_new_window` always returns Deny, after handing an address outside the app to
  `leave`. Pages open windows only through `host_new_window`.
- **Navigation.** A window loads exactly one page, the one Rust opened it with: about:blank first, then (Start Center,
  `VO_NET_PROBE` set) the probe's `data:` page, then its page; fragment changes pass (the Start Center's
  `#create`), and reloads (the Start Center's language setting reloads it); other pages, another query and every other
  scheme (`file:`, `data:`, `blob:`, …) are refused; an address
  outside the app goes to `leave`. Rust keeps the expected page per label (`Host::pages` holds what started; this
  holds what may). Check on all three systems which same-document navigations reach `on_navigation`. This closes
  audit items 2, 18 and 19, and keeps Phase 1's settings snapshot current.
- **CSP.** Done another way (d7a32ef): the policy is a meta tag in every page (`tools/csp.mjs`, `POLICY`), web and
  desktop alike, so tauri.conf.json's `csp` stays null and Tauri adds no hashes; beneath it, the network rules on
  Windows and macOS. Left: WebRTC, which neither covers. The init script removes `RTCPeerConnection`,
  `webkitRTCPeerConnection` and `RTCDataChannel` on Windows and macOS (Linux: WebKitGTK's `enable-webrtc` is off by
  default; check it stays off). Check that the init script also runs in a `data:` page (the probe's page can report it).
- **`host_new_window({ page, new, template })`**: `page` is one of `quire`, `ledger`, `lectern`, `licenses`; `template`
  matches `^[a-z0-9-]{1,40}$`; Rust builds the address. At most 64 windows are open; beyond that it refuses, and the
  page says so. Pages never open the Start Center. Today it takes a URL and checks only the scheme, host and port
  (`VO.host.newWindow(url)`, suite.js: `VO.go`, `VO.showLicenses`). It stays `async` (window creation). `VO.go`
  falls back to `location.href` when it fails, which the navigation rule refuses on the desktop: show the error there
  instead.
- **Launch files**, until Phase 1 replaces them: `host_launch_files` and `host_read` only for the Start Center, which
  is the page that takes them today (`VO.host.onFiles`); `host_read` refuses files over 512 MiB and stops reading
  there. The same handles now also carry Finder's files on macOS (`RunEvent::Opened`).
- **Downloads (interim)**: refuse Windows reserved device names (CON, PRN, AUX, NUL, COM0–9 and LPT0–9, superscript
  digits too, with any extension) and names ending in a dot or a space; at most one download per window per second
  (`host::download_destination`). The larger hole, that any page can drop files into Downloads unasked, closes with
  Phase 2.
- **Web permissions**: every permission request is denied natively except Local Font Access (Settings ▸ Fonts on
  this computer) and the clipboard (the apps' Paste): `WebviewWindowBuilder::on_permission_request` (Tauri 2.12; wry
  maps it to WebView2's `PermissionRequested`, WKUIDelegate's media capture and WebKitGTK's `permission-request`), in
  `open_window`. On macOS the sandbox refuses camera, microphone and location anyway (no entitlement grants them).
  Check what each engine asks for Local Font Access and clipboard reads, so those still work.
- **WebView2 browser shortcuts** off: `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)` in guard's
  closure on Windows (Tauri doesn't expose wry's `with_browser_accelerator_keys`): no F5 or Ctrl+R reload, Ctrl+P
  print preview, Ctrl+F find bar, Ctrl+S page save. Check that editing keys (Ctrl+C, Ctrl+V, Ctrl+Z) and the apps'
  own shortcuts still work. WKWebView and WebKitGTK have no such keys; the Mac menu has no Reload.
- **Init script**: built with `serde_json` (no string pasting; today `format!` with `platform`, `version`,
  `appVersion`, `edition`); `__VO_HOST__` defined with `Object.defineProperty`, read-only and not configurable (today
  a frozen object on a writable property). The localStorage look seed stays until Phase 1.
- **DLL planting** (audit item 15): done another way, by the installer (above).

# Phase 1: native storage and one document per window

## The model

Today pages hold several documents and hand files to each other (Start Center → IndexedDB handoff → app window). On
the desktop:

- **A window is one page and one document.** Rust keeps, per window label: the document's file (if any) and its
  Recent Files key; Phase 2 adds the one destination the user just picked in its Save dialog. Labels are `<page>-<n>`
  from a counter and are never reused; a window's state goes when it is destroyed. A window loads one page only
  (Phase 0).
- **Only Rust gives a window its file.** Open with and double-click, the Start Center's Open File, File ▸ Open, Recent
  Files and Document Recovery all go to Rust, which opens a window with the file bound, or brings forward the window
  that already has it (same key). A page never passes a path; paths come out only for display (the folder of a Recent
  Files entry).
- **Documents a page makes** (mail merge's letters, …) go to a new, unbound window as bytes in the app's own format
  (`hooks.snapshot`). An unbound window has no file: its first Save asks.
- **Quire and Ledger** keep several documents per page on the web (`A.docs`, `A.books`, the Window menu). On the
  desktop the branch that adds a second document (Quire `A.loadDoc` with `newWindow`, Ledger `A.addBook`'s push) is
  never taken: New and templates open `new` / `template` windows (`VO.go`), files go through the native Open,
  page-made documents through the bytes handoff (call sites: Quire app.js `newDocument`, `openFile`, line ~771,
  mailmerge.js ~244; Ledger `newWorkbook`, app.js ~166/217, panes.js ~80/371). If the branch is reached anyway, log a
  console error so the tests catch a missed call site. The Window menu lists the app's windows (`host_windows`,
  `host_focus`). Lectern already has one presentation per page.
- **Closing.** Rust catches the close button (`CloseRequested`, prevent close) and tells the page (`vo-close`); the
  page runs its "Save changes?" flow for its one document and calls `host_close_window`. If the page doesn't answer in
  10 s, ask natively whether to close anyway (its draft is kept). This fixes today's gap: Tauri's close doesn't run
  `beforeunload`.
- **Single instance.** One process owns the windows, settings and Recent Files. A second launch passes its command
  line files to the first and exits; without files it brings up the Start Center (reopened if it was closed).
  - Windows: done with tauri-plugin-single-instance (main.rs `second_start`: a named mutex and a message to the first
    process; no D-Bus there). It hands the files to the Start Center today (`files_arrived`); Phase 1 has Rust open
    each in its own window instead. Keep it.
  - macOS: LaunchServices keeps one instance; files come as `RunEvent::Opened`, a Dock click as `Reopen`. Phase 1
    opens Opened files in their own windows, as on Windows.
  - Linux: own small code, since the plugin brings D-Bus there: a Unix socket in `$XDG_RUNTIME_DIR` (else in
    `~/.vibeoffice`). Only the same user reaches it, who could start the exe with those files anyway; it accepts
    paths of existing files only, treated exactly as the command line.
- The process ends with its last window on Windows and Linux; the Start Center ("main") may close while documents stay
  open. On macOS it keeps running with its menu bar (main.rs, `ExitRequested`), as Mac apps do.
- **https on Windows** (`use_https_scheme`): https://tauri.localhost, a secure context, no DNS prefetch for links.
  The origin changes, which costs nothing once no storage lives in the web view. Update `host::is_external` (it
  matches the host, so it already holds), `net::allowed` (already lets https://tauri.localhost and ipc.localhost
  through) and the pages' policy: IPC moves to `https://ipc.localhost`, which `connect-src` in tools/csp.mjs must
  name.

The app for a file comes from its extension: a Rust table equal to `VO.APPS` in public/common/suite.js (a unit test
reads suite.js and compares). An app's File ▸ Open offers that app's types; the Start Center offers all.

Dropped files: HTML5 drop gives bytes without a path, so a dropped document opens unbound (its first Save asks).
Later, perhaps: WebView2 can tell the path of a `File` the user dropped (`postMessageWithAdditionalObjects`); WebKitGTK
can't. A file dropped on the Dock icon comes as `Opened`, with a path and the sandbox's grant: it opens bound.

## Storage: ~/.vibeoffice

```
~/.vibeoffice/                      %USERPROFILE%\.vibeoffice on Windows; mode 0700 elsewhere
  config.json                       the settings
  recent_files/
    2026-10/                        the month (UTC) the entry was made; an entry never moves
      <sha256>.recent               the entry (JSON)
      <sha256>.recent.preview       its preview: JPEG, at most 320 px (VO.thumbnail) and 512 KB
      <sha256>.recent.draft         its unsaved changes in the app's own format, at most 50 MB; only while it has any
  previous_versions/                Phase 2
    2026-10/
      <sha256>.<unix ms>.previous   a version a save replaced
```

- **Keys.** A file's entry is the sha256 of its canonical path (`std::fs::canonicalize`; lower-cased on Windows, where
  names are case-insensitive), 64 hex digits: one file, one entry, and "is it open already?" is the same lookup. A
  never-saved document's entry is the sha256 of 32 random bytes. Under `recent_files/` only
  `<yyyy>-<mm>/<64 hex>.recent[.preview|.draft]` is read; anything else is ignored, and links are never followed.
- **The entry**: `{ "v": 1, "app": "quire", "path": "…" | null, "name": "Report.docx", "size", "mtime", "time",
  "draft": { "name", "time", "lossState" } | null }`; `size` and `mtime` are those of the version the window opened, so
  saving a recovered draft over a file changed since says so. The file name and path live only inside.
- **Pruning**, as the web's (`MAX_RECENT` 30): the 30 newest entries without a draft stay, entries with a draft are
  never pruned, an emptied month folder is removed. Settings ▸ Clear removes the entries without drafts.
- **config.json**: `{ "<key>": "<string>" }` (strings, as localStorage keeps them, so the web's stored values read the
  same) with the keys localStorage has today (`vibeoffice.look`,
  `vibeoffice.localFonts`, `vibeoffice.updateAsked`, `quire.autoText`, …), plus `vibeoffice.uiScale`, which replaces
  settings.json in the app config folder (read that once if config.json is missing). Keys match
  `^[a-z][a-z0-9]*\.[A-Za-z0-9_.-]{1,64}$`; a value is at most 1 MB, the file 8 MB. Rust acts only on
  `vibeoffice.uiScale` (0.5 to 4: the zoom of every window) and supplies `vibeoffice.look` = `paper` while it is unset;
  every other value is the pages' own data.
- One function writes every file here: a temp file in the same folder, `sync_all`, rename over the old one; a draft or
  preview before the entry that refers to it. config.json writes are coalesced (about 300 ms). Reading tolerates a
  missing or broken file (defaults; a broken entry is skipped).
- `VIBEOFFICE_HOME` overrides the folder, for tests.
- Nothing is migrated from the web view storage of the builds so far.
- **macOS (sandboxed, both editions).** `~/.vibeoffice` is `~/Library/Containers/work.vibeoffice.desktop/Data/
  .vibeoffice` (the sandbox points the home folder there). The sandbox's grant for a user's file (the Open dialog,
  Finder, the Dock) ends when the app quits, so a Recent Files entry of a file also keeps a security-scoped bookmark
  (`bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope`, in the entry as base64): opening it resolves the
  bookmark and calls `startAccessingSecurityScopedResource` for as long as a window has the file; a stale bookmark is
  made again; one that resolves elsewhere (the file moved) opens it there and moves the entry to the new path's key.
  Needs `com.apple.security.files.bookmarks.app-scope` in both entitlements files (desktop/macos/). The default Mac
  volume ignores case, as Windows does, and `canonicalize` keeps the case it was given: key by the case on disk
  (`NSURLCanonicalPathKey`) or lower-case as on Windows.

## Host interface (host::VERSION 3)

`window.__VO_HOST__`, set by the init script before the page's own: `{ platform, version, appVersion, edition,
settings }` (VERSION is 2 since Phase 0's `host_new_window`, without `settings`; `edition` is `appstore` or `direct`, from the Mac bundle),
`settings` being the config as it was when the window was made. Rust keeps every window's copy current
(`vo-settings`), and a window loads one page only, so the copy stays right. Built otherwise (VERSION 5): a page may
reload (the Start Center, for its language), and the init script stays as the window was made, so the settings come
at the top of common/look.js, served as each page loads (`window.__VO_SETTINGS__`, settings.rs).

Bytes cross as raw IPC bodies (Tauri's raw request and `ipc::Response`), small metadata as JSON or headers; never as
JSON arrays or base64. File IO runs off the UI thread. Every new command goes into the app manifest and the window
kinds' capabilities (Phase 0).

| Command | Does |
|---|---|
| `host_set_setting(key, value)` | stores it (null removes it); the other windows get `vo-settings` `{ key, value }` |
| `host_document()` | this window's starting document `{ name, saved, draft, lossState }` and `host_document_bytes()`, or null (blank, template) |
| `host_open({ here })` | system Open dialog; each file opens in a window of its own, or its window comes forward. `here` (the page is an untouched blank): the first file binds to this window and the page calls `host_document()` |
| `host_new_window({ page, start }, bytes?, name?)` | Phase 0's command; with bytes, a page-made document, unbound |
| `host_recent()` | `[{ key, app, name, folder, time, size, preview, draft: { name, time } \| null, open }]`, newest first |
| `host_recent_preview(key)` | the preview's bytes |
| `host_open_recent(key, draft)` | the entry (its unsaved version when `draft`) in a window of its own, or that window forward; a file's draft opens bound to the file |
| `host_recent_remove(key)`, `host_recent_clear()` | forget entries; refused for a document open in a window |
| `host_set_preview(jpeg)`, `host_set_draft(bytes, { name, draftName, lossState })`, `host_clear_draft()` | this window's entry only; an unbound window gets a random key with its first draft |
| `host_discard_draft(key)` | Document Recovery's Discard; refused for a document open in a window |
| `host_windows()`, `host_focus(id)` | the Window menu |
| `host_close_window()` | after `vo-close`, or File ▸ Exit |
| `host_open_url(url)` | Phase 0's rules (the Start Center only) |
| `host_show_downloads()` | as now, until Phase 2 |

Events into the pages, as `vo-download` today (Rust evaluates a `CustomEvent` on `window`): `vo-settings`,
`vo-recent` (the list changed), `vo-close`. Gone: `host_launch_files` and `host_read` with their process-wide
handles, `host_ui_scale` and `host_set_ui_scale` (now a setting).

**The Open dialog** (and Phase 2's Save dialog): Windows `rfd` (`IFileDialog`, `common-controls-v6`); macOS `rfd`
(NSOpenPanel and NSSavePanel as a sheet on the window, `set_parent`; in the sandbox the panel is what grants the file).
On both, rfd's `AsyncFileDialog` from an `async` command: it shows the dialog on the main thread without blocking it,
so no command holds the main thread while the user picks. Linux a small
`GtkFileChooserNative` adapter on Tauri's GTK thread, parented to `window.gtk_window()`, completing on its response
signal. rfd 0.17's GTK backend can't be used: it makes an unparented chooser on its own GTK thread and returns only a
path (its `set_parent` works for the XDG backend, not GTK). So `rfd` becomes a Windows and macOS dependency (today
it is on every target with `gtk3`, and nothing uses it). No tauri-plugin-dialog or -fs: they would hand page script
generic file APIs.

## Pages

- **No browser storage on the desktop**, enforced three ways:
  1. the init script removes `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `BroadcastChannel`,
     `navigator.storage` and `navigator.serviceWorker` (getters that throw), so a use fails at once instead of quietly
     working;
  2. web views are made with `incognito(true)` (WebView2 InPrivate, WebKitGTK ephemeral, WKWebView's non-persistent
     data store; in wry 0.57), so whatever
     slips through is gone at exit;
  3. tests: the host stub removes the same APIs and every page loads and works without console errors; a static test
     allows those names only in the web branches of common/suite.js and common/core.js.
- `VO.settings` (suite.js): `get(key, default)`, `set(key, value)`, `remove(key)`, change events. Web: localStorage and
  its `storage` event; desktop: `__VO_HOST__.settings`, `host_set_setting`, `vo-settings`. Everything goes through it:
  `L.store` (core.js, keys `<APP_ID>.<name>`; its ~100 call sites stay as they are), looks, local fonts,
  `updateAsked` (index.html), the UI size (Settings).
- The head script that sets `data-look` before the first paint reads `__VO_HOST__.settings['vibeoffice.look']` when
  there is one: one file now, public/common/look.js (d7a32ef moved the inline copies out; every page loads it). Remove
  the localStorage seed in `host::init_script`.
- `VO.recent` keeps its shape for the Start Center, File menus, task panes and Document Recovery, with a desktop
  backend: the list from `host_recent`, previews through a new `VO.recent.preview(entry)` → Blob (web: `entry.thumb`),
  changes from `vo-recent` instead of BroadcastChannel. `setDraft`, `setThumb` and `discardDraft` map to the
  window-scoped commands; on the desktop `VO.opened` records only the preview (Rust recorded the opening when it bound
  the window); `VO.saved` clears the draft. `prune` and `keepData` are web only.
- `VO.attach` on the desktop opens what `host_document()` gives instead of `VO.launch` `open`/`recent`. `VO.handoff`
  (the Start Center's drop) → `host_new_window` with the bytes; the Start Center's Open File → `host_open`;
  `VO.host.onFiles` goes (Rust opens launched files itself).
- Until Phase 2, saves go to the Downloads folder as now; a save clears the window's draft (`VO.saved` →
  `host_clear_draft`). Not done, as Phase 2 follows at once: Rust adding each file written there to Recent Files.
- Scout (common/scout/assistant.js) uses localStorage directly: move it to `VO.settings` or `L.store`.

# Phase 2: saving to real files

## What the user gets

- **Save (Ctrl+S)** writes the document's own file in place, without a prompt, as Office does. The title bar shows the
  file's name.
- **Save As and every export** (PDF, PNG, web page, CSV, …) show the system Save dialog, starting in the document's
  folder, with the app's types; the system asks before replacing a file.
- A file that is read-only, or in a format the app can't write (.doc, .xls, .ppt), opens normally; Save goes to Save
  As, the name filled in.
- The file on disk changes only when the user saves. Unsaved work lives in the drafts, never in the file.
- When a save fails, the user is told why in plain words, offered the next step (Replace It, Try Again, Save As…), and
  told their file hasn't changed, which is always true: a failed save leaves the original untouched.
- The version a save replaced is kept for a while, and File ▸ Versions… opens it (proposed; see Previous versions).
- Closing a window with unsaved changes asks first (Phase 1's close flow); the window closes only after a save that
  really happened.

## Rules

1. **Two ways a user's file gets written**, both keyed by the calling window: the window's own bound file, or the one
   destination the user just picked in that window's Save dialog. Nothing else writes a user's file.
2. **A page never passes a path, a folder or an extension pattern.** It says what it wants (save, save as, export), a
   type from a fixed table, a suggested bare name, and the bytes. Rust picks folders, builds the dialog's filters from
   its own table and checks every write against it.
3. **One write function** for every write: the checks, a safe replace, the previous version kept.
4. **Every other way out is closed** on the desktop: web view downloads are refused, and the File System Access API
   (`showSaveFilePicker`, `showOpenFilePicker`, `showDirectoryPicker`; WebView2 has it, the pages don't use it) is
   removed by the init script.
5. **One save at a time per window**, a path bound to at most one window, and writes to one path never overlap.

## Native side

### Per window (adds to Phase 1's state)

- `file`: `{ path, type, base, read_only }`, where `base` is `(size, mtime, file id)` of the version this window read or
  last wrote (file index on Windows, inode elsewhere).
- `choice`: `{ path, type, purpose: saveAs | export, existed: base or none }`: the destination picked in this window's
  Save dialog. Dropped by its successful write, a newer choice, `host_cancel_choice` or the window closing; kept after
  a failed write, so Try Again works.
- `kept`: whether this window already kept the previous version of its file.
- The window's app comes from its label (`quire-*`, `ledger-*`, `lectern-*`); it limits the types.

### File types: one table (desktop/src/types.rs)

Each row: id, extensions, the dialog's label (Office's names), app, whether a Save As to it binds the window (types the
app opens and writes as a document), and how the bytes must start:

| App | Types |
|---|---|
| Quire | docx, docm, dotx, dotm (zip, or OLE when encrypted), rtf (`{\rtf`), htm/html, txt, md (text), mdzip as .zip (zip), pdf (`%PDF-`) |
| Ledger | xlsx, xlsm, xltx, xltm (zip or OLE), csv, tsv, prn, xmlss as .xml, htm/html (text), pdf |
| Lectern | pptx, pptm, ppsx, ppsm, potx, potm (zip or OLE), pdf, png (PNG signature), htm/html |

It replaces `SAVE_TYPES` in host.rs. The byte check guards against a writer mix-up (.md bytes under .zip); it is not
the security boundary. Reading has its own list (`VO.APPS`, Phase 1), so a readable format never becomes writable by
accident. A node test keeps each app's type descriptors (below) and this table in step.

### Commands (host::VERSION 4)

Bytes cross as raw IPC bodies, options in headers; the commands go to the `apps` capability only.

| Command | Does |
|---|---|
| `host_save(bytes, { replace })` | writes this window's `file`; `replace` only after the user answered `changed` with Replace It |
| `host_choose({ purpose, types, type, name })` | system Save dialog: filters from the table (`types` must belong to the window's app), `type` preselected, `name` a bare file name (no separators, `..`, drive or UNC prefix, stream, NUL, reserved name), the folder the file's own (else the last one used in this window, else Documents). Stores the `choice`; returns `{ name, type }`, or null when cancelled |
| `host_write_chosen(bytes)` | writes the `choice`; a Save As to a binding type makes it the window's `file` (and its Recent Files entry: a never-saved document's random entry moves to the file's key, the preview with it). Returns `{ name, type, bound }` |
| `host_cancel_choice()` | the page gave up after choosing (the compatibility check's Cancel) |
| `host_versions()` | the kept previous versions of this window's file: `[{ id, time, size }]` |
| `host_open_version(id)` | one of them in a new, unbound window |

`host_document()` also returns `{ type, readOnly }`.

Errors are codes the page acts on, each with a message that names the file but holds no path:

| Code | When |
|---|---|
| `changed` | the file differs from `base` (another program saved it) |
| `missing` | the bound file is gone (moved, renamed, deleted); never recreated silently |
| `denied` | no permission, or the file is read-only (even when its folder is writable) |
| `busy` | another program holds the file (a sharing violation), after a few quick retries for virus scanners |
| `full` | the disk is full |
| `open-elsewhere` | Save As chose a file that another window has open |
| `too-large` | over 512 MiB |
| `type` | the extension, type or start of the bytes doesn't match the table |
| `io` | anything else, with the system's message |

### The write (desktop/src/files.rs)

1. Check: a target exists for this window (`file` or `choice`); the type is the window's app's and matches the path's
   extension; at most 512 MiB; the bytes start as the type says; the target is a regular file (`symlink_metadata`: a
   link, directory or device in its place is refused), or absent when the dialog picked a new name; for `file`,
   unchanged since `base` unless `replace`.
2. Keep the previous version, if the target exists and this window hasn't kept one yet (below).
3. Write a temp file in the target's folder, `.~vibeoffice-<16 random hex>.tmp` (hidden on Windows; no user file name
   in it), `create_new`, write, `sync_all`.
4. Replace: `ReplaceFileW` on Windows (keeps the file's ACL, attributes and streams, its Mark of the Web among them),
   `MoveFileExW` for a new file; elsewhere copy the mode onto the temp, `rename`, then sync the folder. Verbatim
   (`\\?\`) paths on Windows, so long paths work.
5. When a replace would lose something (Unix: a folder we can't write in, a file with other hard links or another
   owner), write in place instead: truncate, write, sync, and on failure put the kept previous version back.
   **macOS** (both editions are sandboxed): the sandbox grants the file, not its folder, so steps 3 and 4 can't put a
   temp file beside it. Write the temp in the item replacement folder for that file (`NSFileManager
   URLForDirectory:NSItemReplacementDirectory inDomain:appropriateForURL:create:`, on the same volume) and swap it in
   with `replaceItemAtURL:withItemAtURL:backupItemName:options:resultingItemURL:error:`, which is NSDocument's safe
   save and keeps the file's attributes; a new file the Save panel granted is written at its path (`create_new`).
   Verify on a Mac, both editions, including a file on another volume and in iCloud Drive.
6. **Mark of the Web** (Windows): when the window's file came from the internet (it has a `Zone.Identifier` stream),
   a Save As or an export writes the same stream onto the new file, so Office still opens the copy in Protected View.
   A never-saved document made from such a file carries it too. macOS: check what the sandbox already does (it marks
   files a sandboxed app writes with `com.apple.quarantine`) and whether Office for Mac's Protected View reads it.
7. On any failure before the replace: remove the temp; the original is untouched. Once replaced, the save counts as
   done, even if the bookkeeping after it fails.
8. After success: `base` from the file as written; the Recent Files entry's time and size; the window's draft deleted
   (Rust does it, in the same step); `vo-recent` to the windows.

**The Save dialog**: Windows with `FOS_STRICTFILETYPES` and a default extension, the current type first. GTK Save
filters neither add extensions nor reject names, so the adapter reads the selected filter: an extension typed for
another allowed type switches to that type, a missing one gets the filter's, and the chooser confirms replacing the
exact final name before the choice is stored (show the final name if it changed). Never write a path other than the
one the dialog confirmed. A destination open in another window → `open-elsewhere`; the window's own file → a normal
save (the dialog already asked).

### Previous versions (proposed)

`~/.vibeoffice/previous_versions/<yyyy-mm>/<sha256 of the path>.<unix ms>.previous`: the version on disk before the
first write over it from a window (one per editing session, not per save), and before an export replaces an existing
file. Same naming rule as Recent Files: no user file name in the path. Kept 30 days, at most 5 per file and 1 GB in
all, no file's over half of it (the file taking the most gives first, its oldest first; a file's last version goes
last); files over 200 MB aren't kept. Pruned at start and after writes (built 2026-10-18, `Store::sweep`, with the temp
files a crash left). Later, maybe: store only what changed (content-defined chunks, each kept once), after measuring
how much repeats between versions of corpus files. Even a compromised page can't
destroy the one file it may write, and a bad save (a writer bug Office complains about) can be undone. File ▸
Versions… (desktop only; Paper 2016: File ▸ Info) lists them; Open shows one in a new window, from which the user
saves it where they like.

## Page side

### One API for all three apps: `L.file` (common/core.js)

```
L.file.setup({
  types,       // the app's Save As list, in order: [{ id, label, ext: ['docx'], document: true }, …]
  current,     // () => ({ doc, name, type, saved })
  prepare,     // async (doc, type, name) => { blob, losses } | { switchTo: 'mdzip' } | null (the user declined)
  saved,       // (doc, { name, type, blob, losses }) after a document save: the app's name, type, dirty state
  webSaveAs,   // (doc) => Promise<{ name, type } | null>: the app's own Save As dialog, web only
})
L.file.save()          // Ctrl+S, and Save in the "Save changes?" prompt  → 'saved' | 'cancelled'
L.file.saveAs()        // F12
L.file.export(type)    // PDF, PNG, CSV, web page, …
```

- **Desktop.** Save: bound, writable and the same type → `prepare` → `host_save`; otherwise Save As. Save As and export:
  `host_choose` → `prepare(type)` → `host_write_chosen` (`prepare` runs after the dialog because the chosen type picks
  the writer; null → `host_cancel_choice`; `switchTo` → the dialog again with the new type, name kept).
- **Web.** Save: `prepare` → download; Save As: `webSaveAs` → `prepare` → download; export: `prepare` → download. The
  same flow as today, through one place.
- Both: one save at a time per window (a queue); the document captured at the start and passed to every step; `saved`
  only after the write succeeded, and the dirty state cleared only if nothing changed meanwhile; exports never touch
  the document's name, type, entry or dirty state; compatibility losses acknowledged only on success; `vo-saved
  { name }` (Scout's Save act) only for `'saved'`. `L.saveFile` stays for odd callers, as an export.
- Errors become the app's own message box (`ui.msg`), with the file's name and the next step:

| Code | Says | Buttons |
|---|---|---|
| `changed` | “Report.docx” was changed by another program after you opened it. | Replace It, Save As…, Cancel |
| `missing` | “Report.docx” is no longer where it was: it was moved, renamed or deleted. | Save As… (its old folder and name), Cancel |
| `denied` | VibeOffice can't save “Report.docx”: it is read-only, or you don't have permission to change it. | Save As…, Cancel (Phase 3 adds Allow Access…) |
| `busy` | “Report.docx” is open in another program, which is keeping it from being changed. | Try Again, Save As…, Cancel |
| `full` | There isn't enough space on the disk to save “Report.docx”. | Save As…, Cancel |
| `open-elsewhere` | “Report.docx” is open in another VibeOffice window. Close it there, or choose another name. | OK (back to the dialog) |
| others | “Report.docx” couldn't be saved: (the message). | OK |

  Every message for a failure before the replace ends with "Your file hasn't changed."

### What each app does

- Turn the app's `save`, `saveAs` and `exportAs` into `L.file.setup` hooks; the type descriptors are its existing Save
  As list, shared by its web dialog and the desktop's filters (keep the aliases: `htm`/`html`, `xml` → `xmlss`, `zip` →
  `mdzip`). Keep each app's current rule on which types are a document save (Quire today: docx, docm, dotx, dotm, md,
  mdzip; html, rtf and txt are exports). Distinguish saving an opened CSV from exporting a workbook's active sheet.
- **Quire** (app.js `A.save`, `A.saveAs`, `A.exportAs`, dialogs3.js `L.dlg.saveAs`; PDF, print, mail merge): the
  Markdown pictures question returns `{ switchTo: 'mdzip' }` instead of changing `A.fileType` before the save succeeded;
  the compatibility check (`ui.compatibility`) stays inside `prepare`.
- **Ledger** (app.js `A.save`, `A.saveAs`, `closeWorkbook`; dialogs.js `D.saveAs`; commands.js; print.js): tell Save,
  Save As, Save as Web Page and Export CSV apart; await the real outcome (`D.saveAs` isn't awaited, and
  `ui.dialog().done` resolves Cancel as a truthy index, so Cancel while closing an untitled book closes it unsaved; fix
  that on the web too); PDF export reports its outcome; keep passwords and encryption.
- **Lectern** (app.js `A.save`, `A.saveAs`, `A.exportAs`, dialogs.js `L.dlg.saveAs`, `previewPDF`): the same.
- The desktop's title shows "(Read-Only)" for a read-only file; File ▸ Versions… in each app (and the ribbon's File
  tab).
- The refactor changes no writer: on the web, the bytes saved for the same input are identical before and after.

## Removing the interim

Rust refuses every web view download (`on_download` → false); `download_destination`, `Host::downloaded`,
`host_show_downloads`, the `vo-download` notice, Browse, and Phase 1's "add a Downloads save to Recent Files" go.

# Phase 3: the Mac sandbox

Both Mac editions (the DMG and the App Store's) run in the App Sandbox; Linux ships only as an AppImage, which isn't
sandboxed (no Flatpak or Snap). On a Mac `denied` offers Allow Access…: a folder chooser at the file's folder, then
the save again, only if the chosen folder holds the bound file (verify it is the same file).
`__VO_HOST__.sandboxed` (`APP_SANDBOX_CONTAINER_ID`). Unsupported → say so and offer Save As. Unverified until tried
on a Mac. On a Mac, with Phase 1's bookmarks and Phase 2's replace, `denied` should be
rare (a bookmark that no longer resolves, a folder the user can't write); there the folder chooser is NSOpenPanel with
`canChooseDirectories`, and its grant is kept as a bookmark too.

# Files

- Phase 0. desktop/src: main.rs (navigation, labels, permissions, downloads), host.rs (commands, init script, the link
  gate's caller check), net.rs (WebView2's browser keys in guard's closure); build.rs (app manifest), capabilities/
  (per window kind). webview2-com is already a direct Windows dependency (net.rs). public/common/suite.js
  (`newWindow` by page id, `VO.go`'s fallback), public/oss-licenses.js (links with Copy on the desktop).
- Phase 1. desktop/src: main.rs (windows, close flow), host.rs (commands), store.rs (new: ~/.vibeoffice, config,
  Recent Files, drafts, the atomic write; macOS bookmarks), instance.rs (new: single instance on Linux), the Open
  dialog (rfd; the GTK adapter); Cargo.toml and Cargo.lock (sha2, now a direct dependency; rfd Windows and macOS only;
  objc2-foundation's NSURL bookmark calls), desktop/macos/*.entitlements (bookmarks), then tools/oss-licenses.py.
  public/common/suite.js, core.js, look.js, public/start.js (the Start Center's code), the apps' app.js (new document
  paths, Window menu), common/scout/assistant.js; tools/csp.mjs (`https://ipc.localhost` once Windows is on https).
- Phase 2. desktop/src: types.rs and files.rs (new; the macOS replace), host.rs (commands; the interim goes; File
  System Access API off), main.rs (`on_download`), store.rs (previous versions), the Save dialog. public/common/core.js (`L.file`),
  suite.js (the interim notice goes); the three apps' save code and Save As dialogs; menus and ribbons for
  Versions… (`node --test tests/ribbon.test.mjs`).
- Phase 3. The folder access in files.rs.
- Every phase: tests/desktop/host-stub.js, host.test.mjs, Rust unit tests; docs/desktop.md (host interface, the link
  rule, storage, threat model, the one-document rule, saving and its rules), docs/suite.md (Recent Files, settings,
  `L.file`), the app docs where links or saving change.

# Verification

1. `cargo test` (Linux target), each regression test failing on the code before its fix:
   - Phase 0: the link gate refuses every window but the Start Center (the licences page included), an address with
     a user name or password, and vibeoffice.work outside `/updater/` (`/`, `/updaterx/`, `/updater` itself), and
     still lets `VO.updateUrl()` and our GitHub through (d7a32ef's tests already cover http, other ports, lookalike
     hosts and other schemes); the navigation rule (about:blank, the probe's page, first load, fragment, reload, another page,
     `file:`, `data:`, `blob:`, other schemes); `host_new_window` page ids, template ids and the 64-window cap;
     reserved and trailing-dot download names; the init script is valid JS for any version string.
   - Phase 1: keys (the same file by another name, a link or, on Windows, other case → one entry); a user's name never
     in a path (names with `..`, separators, Unicode: only hex under `recent_files/`); size caps; pruning keeps
     drafts; foreign and broken files ignored; the atomic write leaves the old file when it fails; setting keys and
     values validated; the extension table equals `VO.APPS`.
   - Phase 2: only the window's `file` or its one `choice` is written; a choice works once; another window's file is
     out of reach; export never binds; Save As binds and moves the Recent Files entry; another app's type, an
     extension that doesn't match, bytes that don't start right, over 512 MiB; a link, directory or device swapped
     in; a read-only file in a writable folder; missing; changed (and Replace); a destination open in another window;
     failures at create, write, sync and replace leave the original byte for byte and no temp file; the in-place path
     restores the previous version when it fails; permission tests run without privileges that bypass chmod; previous
     versions kept once per window, pruned by count, age and size, names only hex and digits; the Mark of the Web
     copied (Windows).
2. `node --test tests/desktop/host.test.mjs`, the stub speaking the new commands:
   - Phase 0: `VO.newWindow` sends a page id; when it fails, `VO.go` shows the error and doesn't navigate; the Start
     Center's Update button still calls `host_open_url`. (Document links: done, `tests/ui/hyperlinks.test.mjs`.)
   - Phase 1, with the storage APIs removed: every page loads without console errors; looks and settings change and
     reach the other windows; Recent Files, previews, drafts and Document Recovery work from the stub; the static
     storage test; the web path unchanged (tests/looks, ribbon, search).
   - Phase 2: Ctrl+S on a bound file → one `host_save`; unbound, read-only and .doc → Save As; Save As picks the type
     before `prepare`; Cancel at the dialog, at the compatibility check and in the Markdown question; every error
     code's message and buttons; Ledger's Cancel while closing keeps the book open; exports keep the dirty state; the
     web path still downloads the same bytes.
3. Linux live, offline (`unshare -rn`), on display :0 or under `xvfb-run -a` (with `WEBKIT_DISABLE_COMPOSITING_MODE=1`),
   with `VIBEOFFICE_HOME` and scratch documents under ./tmp so the real ~/.vibeoffice is never touched:
   - Phase 0: a test document in each app with links to https, `file:///`, a UNC path, `ftp:`, `mailto:` and another
     protocol handler: Ctrl+click and the slide show open nothing, the address dialog appears; a link on the licences
     page shows its address with Copy and opens nothing; the GitHub button and
     Update open the browser (`xdg-open` logged, the network being off); a page calling `host_open_url` from an app
     window, a Tauri core command (`plugin:path|resolve_directory`) and `window.open` are refused; F5 does nothing;
     every page loads without CSP violations; a fetch to another host and WebRTC fail.
   - Phase 1: launch with a file → its app's window; the same file again → that window comes forward, another file →
     a new window in the same process; a setting changed in one window reaches another; `kill -9` with unsaved changes
     → the next start offers the draft; `find` over the home shows no user file names.
   - Phase 2: open → edit → Ctrl+S (bytes change, no dialog, the file reopens); Save As and PDF export through the GTK
     dialog, with type changes, no extension and an existing file; `chmod a-w` the file → denied; edit it from a
     shell → changed; remove it → missing; Versions… opens the version before the save. Each app's saved files open in
     LibreOffice.
4. Windows exe and installer build (`desktop/build.sh`; clippy for the default target). On Windows (the user), first
   the run docs/desktop.md lists (install, the network probe with `VO_NET_PROBE=1`, all three apps); then Phase 0: the
   link document as on Linux, F5, Ctrl+P and Ctrl+S do nothing the page didn't ask for, editing keys work, camera or
   location requests are denied; Phase 1:
   double-click the same .docx twice (one window), Recent Files, settings, closing with unsaved changes; Phase 2:
   Ctrl+S, Save As, PDF export, a file open in Word (busy), a read-only file, a downloaded file saved as a copy still
   opens in Protected View; the saved files open in Word, Excel and PowerPoint without a repair prompt.
5. macOS: clippy for `aarch64-apple-darwin` here; the CI smoke run (the network probe, screenshots of every page)
   for each phase. On a Mac (the user), both editions: Phase 0: the link document, a camera request; Phase 1: a file
   from Finder, then from Recent Files after quitting and starting again (the bookmark), the same file twice (one
   window), a file moved while the app was closed; Phase 2: Ctrl+S on a file in Documents, on another volume and in
   iCloud Drive, Save As, PDF export, a read-only file, a file open in another app; the saved files open in Office
   for Mac without a repair prompt.
6. Time a 30 MB workbook through `host_save` (IPC and write) and note peak memory.

# Working notes

- The code today (97c1e06): desktop/src/host.rs has `host_launch_files`/`host_read` with process-wide numeric handles
  (any window can take the launch files; on macOS Finder's files too), `host_new_window` (async: creating a window
  from a sync command deadlocks on Windows; label `doc-N`; same scheme, host and port, because `Url::origin()` is
  opaque for tauri://), `host_close_window` (refuses "main"), `host_open_url` (`is_ours`), the link gate (`leave`,
  `may_open`, `Host::pages`), UI scale in settings.json, the Downloads interim (`download_destination`, `downloaded`,
  `host_show_downloads`; docs/desktop.md, Saving (for now)), the edition (Info.plist `VODistribution`).
  desktop/src/main.rs `open_window` builds every window with the same hooks (`on_navigation`, `on_new_window`,
  `on_download`, title, zoom set on each page load because WebKitGTK resets it) on about:blank, then `net::guard`;
  `files_arrived` (Windows' second start, macOS's Opened and Reopen); the Mac menu. desktop/src/net.rs: the network
  rules and the probe. capabilities/default.json grants `core:default` to `main` and `doc-*`. Page side: `VO.host`,
  the IndexedDB section, `VO.recent`, `VO.handoff`, `VO.attach`, `VO.opened`, `VO.saved`, `VO.go` in
  public/common/suite.js; `L.store`, `L.saveFile`, `L.pickFiles` in public/common/core.js; public/start.js (the Start
  Center); public/common/look.js; document links through `L.ui.linkDialog`.
- Commands that need the calling window take `window: WebviewWindow`; Tauri fills it in, the page can't.
- `NewWindowResponse::Allow` means the engine's own popup ("the default implementation"), not one of our windows.
- The exe's DLL imports (`x86_64-w64-mingw32-objdump -p`): advapi32, comctl32 (side by side, v6), dwmapi, gdi32, imm32,
  kernel32, msvcrt, ntdll, ole32, oleaut32, shell32, shlwapi, user32, bcryptprimitives, combase, two api-ms-win sets,
  WebView2Loader. DllCharacteristics 0x160 (NX, ASLR, high-entropy); no load configuration directory.
- desktop/Cargo.toml has `rfd` 0.17 (`gtk3`, `common-controls-v6`) on every target, unused: make it Windows and macOS
  only (Phase 1, Open dialog), or drop it until then.
- Build: `desktop/build.sh` (Windows: vibeoffice.exe and VibeOfficeSetup.exe, zipped; needs mingw-w64 and `zip`).
  macOS type-check from here: `CC_aarch64_apple_darwin=clang CFLAGS_aarch64_apple_darwin=--target=arm64-apple-macos11
  cargo clippy --locked --target aarch64-apple-darwin`; the bundle, signing and the smoke run are CI's
  (desktop/macos/build.sh, .github/workflows/macos.yml). Linux: `cd desktop && cargo build
  --release --target x86_64-unknown-linux-gnu` (needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`; on
  this machine without root they are unpacked in ./tmp/linuxdev/root, used with
  `PKG_CONFIG_SYSROOT_DIR=$PWD/tmp/linuxdev/root` and
  `PKG_CONFIG_PATH=$PWD/tmp/linuxdev/root/usr/lib/x86_64-linux-gnu/pkgconfig:$PWD/tmp/linuxdev/root/usr/share/pkgconfig`
  from the repository root). `cargo test` builds the same way (9 tests at 97c1e06). The installer's own tests run
  under Wine (`tests/desktop/setup-wine.py`); Wine can't show the app (no WebView2).
- Run the Linux build offline on display :0 with a scratch profile: `unshare -rn`, `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/
  `XDG_CACHE_HOME` (and `VIBEOFFICE_HOME`) under ./tmp. `xdotool` and `import` drive and screenshot it; the window
  position `xdotool getwindowgeometry` reports is off, take a root screenshot to find coordinates. Kill test instances
  with `pkill -f "unknown-linux-gnu/releas[e]/vibeoffice"`.
- Page tests: `node --test tests/desktop/host.test.mjs` (Chromium with CDP on 127.0.0.1:9222; `tools/shot.mjs --pre`
  runs `tests/desktop/host-stub.js` before each page; a test cleans up whatever it adds).
- Changes in public/common/ touch all three apps: load each and screenshot what changes. Refresh `git status` before
  starting and commit only this work's hunks.
