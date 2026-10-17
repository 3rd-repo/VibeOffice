//! The native side of `VO.host` (public/common/suite.js; contract in docs/desktop.md, Host interface).
//!
//! Pages reach the system only through VO.host. Here it is a set of `host_*` commands over Tauri's IPC and
//! `window.__VO_HOST__`, set before every page's scripts. A page never names a file: the documents in the windows
//! and Recent Files are doc.rs's.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow};

/// Version of the interface; raise it when a command changes shape (VO.host.version in the pages).
pub const VERSION: u32 = 4;

#[derive(Default)]
pub struct Host {
    settings: Mutex<Settings>,
    /// window label -> the page it may load (`may_load`)
    pages: Mutex<HashMap<String, Page>>,
}

/// What the native side keeps for itself, in settings.json in the app's config folder: what has to apply
/// before a page loads. The pages' own settings stay in their localStorage.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// the web view's zoom: the whole UI, as the browser's Ctrl + does (1 = 100 %)
    ui_scale: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { ui_scale: 1.0 }
    }
}

const UI_SCALE: std::ops::RangeInclusive<f64> = 0.5..=4.0;

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("settings.json"))
}

impl Host {
    /// Reads settings.json (missing or unreadable: the defaults).
    pub fn load_settings(&self, app: &AppHandle) {
        let read = settings_path(app)
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|b| serde_json::from_slice::<Settings>(&b).ok());
        let mut settings = self.settings.lock().unwrap();
        if let Some(s) = read {
            if UI_SCALE.contains(&s.ui_scale) {
                *settings = s;
            }
        }
    }

    pub fn ui_scale(&self) -> f64 {
        self.settings.lock().unwrap().ui_scale
    }
}

/// Every frame of every window, before its scripts: no File System Access pickers (WebView2 has them), so a page
/// writes files only through the host (doc.rs), never one a page picker chose.
pub const NO_FILE_PICKERS: &str =
    "for (const k of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) delete window[k];";

/// The script that runs before each page's own: what the pages see as the host, and the desktop app's
/// default look (Paper) until the user picks one (the pages' head scripts read it). `edition`: 'appstore' for the
/// Mac App Store's, which the store updates (the pages never check), else 'direct'. The values go in as JSON, and
/// `__VO_HOST__` can't be replaced or changed by the page.
pub fn init_script() -> String {
    let host = serde_json::json!({
        "platform": std::env::consts::OS, // windows, linux, macos
        "version": VERSION,
        "appVersion": option_env!("VO_VERSION").unwrap_or("dev"), // tools/current-tree-version.sh, from build.sh
        "edition": if app_store() { "appstore" } else { "direct" },
    });
    format!(
        "Object.defineProperty(window, '__VO_HOST__', {{ value: Object.freeze({host}), writable: false, configurable: false }});\n\
         try {{ if (!localStorage.getItem('vibeoffice.look')) localStorage.setItem('vibeoffice.look', 'paper'); }} catch (e) {{}}"
    )
}

/// Whether this is the Mac App Store edition: `VODistribution` in the bundle's Info.plist (desktop/macos/),
/// sealed by its signature, so one binary serves the App Store and the DMG.
#[cfg(target_os = "macos")]
fn app_store() -> bool {
    use objc2_foundation::{NSBundle, NSString};
    NSBundle::mainBundle()
        .objectForInfoDictionaryKey(&NSString::from_str("VODistribution"))
        .and_then(|v| v.downcast::<NSString>().ok())
        .is_some_and(|v| v.to_string() == "appstore")
}

#[cfg(not(target_os = "macos"))]
fn app_store() -> bool {
    false
}

/// The UI scale (1 = 100 %).
#[tauri::command]
pub fn host_ui_scale(host: State<Host>) -> f64 {
    host.ui_scale()
}

/// Scales the whole UI of every window (the web view's zoom) and keeps it for the next start.
#[tauri::command]
pub fn host_set_ui_scale(app: AppHandle, host: State<Host>, scale: f64) -> Result<(), String> {
    if !UI_SCALE.contains(&scale) {
        return Err(format!(
            "UI scale {scale} is outside {}..{}",
            UI_SCALE.start(),
            UI_SCALE.end()
        ));
    }
    for window in app.webview_windows().values() {
        window.set_zoom(scale).map_err(|e| e.to_string())?;
    }
    let settings = {
        let mut s = host.settings.lock().unwrap();
        s.ui_scale = scale;
        s.clone()
    };
    let path = settings_path(&app).ok_or("no settings folder")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| describe(dir, e))?;
    }
    let json = serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| describe(&path, e))
}

/// At most this many windows are open at once (host_new_window).
const MAX_WINDOWS: usize = 64;

/// How an app's window starts: its address's query, which the page reads as `VO.launch` (public/common/suite.js).
/// Nothing: the app's sample; `new`: blank; `template`: a template's id. A window with a document is made by
/// doc.rs (`<app>/?doc`).
#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct Start {
    #[serde(default)]
    new: bool,
    template: Option<String>,
}

/// A label for a new window of `page`: the page and a number never used before (`quire-3`), which the capabilities
/// go by; refused when MAX_WINDOWS are open.
pub fn new_label(app: &AppHandle, page: &str) -> Result<String, String> {
    static NEXT: AtomicUsize = AtomicUsize::new(1);
    if app.webview_windows().len() >= MAX_WINDOWS {
        return Err(format!("{MAX_WINDOWS} windows are open: close one first"));
    }
    Ok(format!("{page}-{}", NEXT.fetch_add(1, Ordering::Relaxed)))
}

/// Opens one of the suite's pages in a window of its own: an app from the Start Center (as when the PWA is
/// installed), the licences page from About. The page names it (`quire`, `ledger`, `lectern`, `licenses`) and how
/// it starts; the address is made here, so a page picks no other file and no query of its own. The Start Center opens
/// the apps, an app window a blank document or a template of its own app, and any window the licences page
/// (`new_label`). Async: creating a window from a sync command deadlocks on Windows.
#[tauri::command]
pub async fn host_new_window(
    app: AppHandle,
    window: WebviewWindow,
    page: String,
    start: Option<Start>,
) -> Result<(), String> {
    let path = page_path(&page, &start.unwrap_or_default())?;
    let caller = window.label().rsplit_once('-').map_or("main", |(p, _)| p);
    if !(caller == "main" || caller == page || page == "licenses") {
        return Err(format!("{caller} doesn't open {page}"));
    }
    let label = new_label(&app, &page)?;
    crate::open_window(&app, &label, WebviewUrl::App(PathBuf::from(path)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// The address of `page` (from the app's root) started as `start`, or why there is none.
fn page_path(page: &str, start: &Start) -> Result<String, String> {
    let ways = usize::from(start.new) + usize::from(start.template.is_some());
    if ways > 1 {
        return Err(format!("{page}: more than one way to start"));
    }
    match page {
        "quire" | "ledger" | "lectern" => {}
        "licenses" if ways == 0 => return Ok("oss-licenses.html".into()),
        _ => return Err(format!("not one of the suite's pages: {page}")),
    }
    // a template's id (templates.json)
    let id = |v: &str| {
        (1..=40).contains(&v.len())
            && v.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    };
    let mut url = Url::parse("tauri://localhost/").expect("a URL");
    url.set_path(&format!("{page}/"));
    let mut query = url.query_pairs_mut();
    if start.new {
        query.append_key_only("new");
    }
    if let Some(t) = &start.template {
        if !id(t) {
            return Err(format!("not a template: {t}"));
        }
        query.append_pair("template", t);
    }
    drop(query);
    Ok(match url.query() {
        Some(q) if !q.is_empty() => format!("{page}/?{q}"),
        _ => format!("{page}/"),
    })
}

/// File ▸ Exit in an app window, or its page's answer to the close button (`vo-close`), once its document is
/// saved or given up: closes it (true). The Start Center's window ("main") stays (false).
#[tauri::command]
pub fn host_close_window(window: WebviewWindow) -> Result<bool, String> {
    if window.label() == "main" {
        return Ok(false);
    }
    crate::doc::allow_close(&window);
    Ok(true)
}

/// Opens the update page in the system's browser (the Start Center's Update: VO.host.openUrl).
#[tauri::command]
pub fn host_open_url(window: WebviewWindow, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|e| format!("{url}: {e}"))?;
    if !may_open(window.label(), &parsed) {
        return Err(format!("not opened: {url}"));
    }
    open_external(&parsed)
}

/// The addresses the app sends to the browser, the whole list: the update page and our GitHub. Https on the
/// default port, no user name or password; a path ends at a `/` (so `/updaterx/` isn't the update page).
pub fn is_ours(url: &Url) -> bool {
    let under = |path: &str| url.path() == path || url.path().starts_with(&format!("{path}/"));
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && match url.host_str() {
            Some("vibeoffice.work") => url.path().starts_with("/updater/"),
            Some("github.com") => under("/tcchen2026/VibeOffice"),
            _ => false,
        }
}

/// Whether a window may send `url` to the browser: the Start Center, an address on the list (`is_ours`). The
/// other pages show an address instead, to copy: a document's hyperlinks (ui.linkDialog), the licences page's
/// links (oss-licenses.js).
pub fn may_open(label: &str, url: &Url) -> bool {
    label == "main" && is_ours(url)
}

/// A window wants to leave the app for `url` (a link, a new window): it goes to the browser if `may_open`
/// lets it, otherwise nowhere.
pub fn leave(label: &str, url: &Url) {
    if may_open(label, url) {
        let _ = open_external(url);
    } else {
        eprintln!("not opened: {url} (from {label})");
    }
}

/// What a window may load (on_navigation, `Host::may_load`): one page, the one Rust opened it with. Before it,
/// about:blank (where Windows and macOS windows start: `net::guard`) and, with `probe`, the network probe's
/// `data:` page; then the page itself, again when it reloads (the Start Center's language), with any fragment (its
/// `#create`), and its own `blob:` addresses (on Linux a save starts as one). Other pages, the page with another
/// query and every other scheme are refused.
pub struct Page {
    url: Url,
    probe: bool,
    arrived: bool,
}

impl Page {
    pub fn new(url: Url, probe: bool) -> Self {
        Page {
            url,
            probe,
            arrived: false,
        }
    }

    /// Whether the window may go to `url` now; the page's first load marks it arrived.
    fn admits(&mut self, url: &Url) -> bool {
        // scheme, host and port (Url::origin() is opaque for tauri://, and opaque origins never match), and
        // the path, an empty one being "/" (tauri://localhost)
        let site = |u: &Url| {
            (
                u.scheme().to_string(),
                u.host_str().map(str::to_string),
                u.port(),
            )
        };
        let path = |u: &Url| {
            if u.path().is_empty() {
                "/".to_string()
            } else {
                u.path().to_string()
            }
        };
        match url.scheme() {
            "about" => !self.arrived && url.as_str() == "about:blank",
            "data" => !self.arrived && self.probe,
            "blob" => Url::parse(url.path()).is_ok_and(|inner| site(&inner) == site(&self.url)),
            _ => {
                let here = site(url) == site(&self.url)
                    && path(url) == path(&self.url)
                    && url.query() == self.url.query();
                self.arrived |= here;
                here
            }
        }
    }
}

impl Host {
    /// A window is made for `page` (open_window): from now on it loads only that (`Page`).
    pub fn expect(&self, label: &str, page: Page) {
        self.pages.lock().unwrap().insert(label.into(), page);
    }

    /// Whether the window `label` may go to `url` (an address inside the app; on_navigation).
    pub fn may_load(&self, label: &str, url: &Url) -> bool {
        let ok = self
            .pages
            .lock()
            .unwrap()
            .get_mut(label)
            .is_some_and(|page| page.admits(url));
        if !ok {
            eprintln!("not loaded: {url} (in {label})");
        }
        ok
    }
}

/// Whether a page wants to leave the app: http(s) to another host, or mailto. The app's own pages
/// (tauri://localhost, http://tauri.localhost; devUrl in a dev build), blob:, data: and about: stay.
pub fn is_external(url: &Url) -> bool {
    match url.scheme() {
        "mailto" => true,
        "http" | "https" => {
            let own = url.host_str() == Some("tauri.localhost")
                || (!cfg!(feature = "custom-protocol") && url.host_str() == Some("127.0.0.1"));
            !own
        }
        _ => false,
    }
}

/// Hands an address to the system (the default browser), never to a program or a file.
pub fn open_external(url: &Url) -> Result<(), String> {
    system_open(url.as_str())
}

#[cfg(windows)]
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    use windows::{
        core::{w, HSTRING, PCWSTR},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let r = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(url),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // above 32 is success
    if r.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "could not open {url} (ShellExecute {})",
            r.0 as isize
        ))
    }
}

/// macOS: NSWorkspace, which the sandbox allows (no program is started)
#[cfg(target_os = "macos")]
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSString, NSURL};
    let ns = NSURL::URLWithString(&NSString::from_str(url))
        .ok_or_else(|| format!("{url}: not an address"))?;
    if NSWorkspace::sharedWorkspace().openURL(&ns) {
        Ok(())
    } else {
        Err(format!("could not open {url}"))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
pub(crate) fn system_open(url: &str) -> Result<(), String> {
    let mut child = std::process::Command::new("xdg-open")
        .arg(url)
        .spawn()
        .map_err(|e| format!("xdg-open: {e}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn describe(path: &Path, e: std::io::Error) -> String {
    format!("{}: {e}", path.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_start_center_sends_the_update_page_and_our_github_to_the_browser() {
        let u = |s: &str| Url::parse(s).unwrap();
        for ours in [
            "https://vibeoffice.work/updater/?from_version=v2026.10.16-abc123&current_platform=windows",
            "https://vibeoffice.work/updater/",
            "https://github.com/tcchen2026/VibeOffice",
            "https://github.com/tcchen2026/VibeOffice/issues",
        ] {
            assert!(may_open("main", &u(ours)), "{ours}");
            for other_window in ["quire-1", "ledger-2", "lectern-3", "licenses-4", "doc-1"] {
                assert!(!may_open(other_window, &u(ours)), "{ours} from {other_window}");
            }
        }
        for other in [
            "https://vibeoffice.work/",
            "https://vibeoffice.work/quire/",
            "https://vibeoffice.work/updater",
            "https://vibeoffice.work/updaterx/",
            "https://user:pass@vibeoffice.work/updater/",
            "https://user@github.com/tcchen2026/VibeOffice",
            "https://example.com/",
            "http://vibeoffice.work/updater/",
            "https://vibeoffice.work:8443/updater/",
            "https://www.vibeoffice.work/updater/",
            "https://vibeoffice.work.example.com/updater/",
            "https://github.com/tcchen2026/VibeOfficeEvil",
            "https://github.com/someone/else",
            "https://github.com/tauri-apps/tauri",
            "mailto:someone@example.com",
            "file:///etc/passwd",
        ] {
            assert!(!may_open("main", &u(other)), "{other}");
        }
    }

    #[test]
    fn a_window_loads_its_own_page_once_and_nothing_else() {
        let u = |s: &str| Url::parse(s).unwrap();
        let quire = || Page::new(u("http://tauri.localhost/quire/?new"), false);
        // Windows and macOS: about:blank, then the page, then a fragment of it or a save's blob
        let mut p = quire();
        for (url, ok) in [
            ("about:blank", true),
            ("http://tauri.localhost/ledger/", false),
            ("http://tauri.localhost/quire/", false),
            ("http://tauri.localhost/quire/?new", true),
            ("about:blank", false),
            ("http://tauri.localhost/quire/?new", true),
            ("http://tauri.localhost/quire/?new#top", true),
            ("http://tauri.localhost/quire/#top", false),
            ("http://tauri.localhost/quire/?recent=x#top", false),
            (
                "blob:http://tauri.localhost/0c5d0d1e-1f0e-4a2b-9c33-5d8f0a6e7b21",
                true,
            ),
            (
                "blob:https://example.com/0c5d0d1e-1f0e-4a2b-9c33-5d8f0a6e7b21",
                false,
            ),
            ("data:text/html,<script>1</script>", false),
            ("http://tauri.localhost/oss-licenses.html", false),
            ("http://tauri.localhost/oss-licenses.html#x", false),
            ("file:///etc/passwd", false),
            ("tauri://localhost/quire/?new", false),
        ] {
            assert_eq!(p.admits(&u(url)), ok, "{url}");
        }
        // the probe's data: page comes before the page, only when probing
        let mut probing = Page::new(u("http://tauri.localhost/"), true);
        assert!(probing.admits(&u("data:text/html,probe")));
        assert!(probing.admits(&u("http://tauri.localhost/")));
        assert!(!probing.admits(&u("data:text/html,probe")));
        assert!(!quire().admits(&u("data:text/html,probe")));
        // Linux: the Start Center at tauri://localhost, with or without its "/"
        assert!(Page::new(u("tauri://localhost/"), false).admits(&u("tauri://localhost")));
        assert!(Page::new(u("tauri://localhost/"), false).admits(&u("tauri://localhost/")));
        // the Start Center reloads when its language changes, with or without its #create
        let mut start = Page::new(u("tauri://localhost/"), false);
        for url in [
            "tauri://localhost",
            "tauri://localhost#create",
            "tauri://localhost/#create",
            "tauri://localhost",
        ] {
            assert!(start.admits(&u(url)), "{url}");
        }
    }

    #[test]
    fn a_new_window_gets_the_address_made_here_from_its_page_and_how_it_starts() {
        let start = |json: &str| serde_json::from_str::<Start>(json);
        let path = |page: &str, json: &str| page_path(page, &start(json).unwrap());
        // what the pages ask for (VO.url): the address VO.launch reads
        for (page, json, want) in [
            ("quire", "{}", "quire/"),
            ("quire", r#"{"new":true}"#, "quire/?new"),
            (
                "ledger",
                r#"{"template":"invoice-2"}"#,
                "ledger/?template=invoice-2",
            ),
            ("licenses", "{}", "oss-licenses.html"),
        ] {
            assert_eq!(path(page, json).as_deref(), Ok(want), "{page} {json}");
        }
        for (page, json) in [
            ("", "{}"),
            ("start", "{}"),
            ("index.html", "{}"),
            ("quire/../ledger", "{}"),
            ("licenses", r#"{"new":true}"#),
            ("quire", r#"{"new":true,"template":"letter"}"#),
            ("quire", r#"{"template":"../x"}"#),
            ("quire", r#"{"template":"Letter"}"#),
            ("quire", r#"{"template":""}"#),
            ("quire", r#"{"template":"a&recent=x"}"#),
        ] {
            assert!(path(page, json).is_err(), "{page} {json}");
        }
        for other in [
            r#"{"lang":"qps"}"#,
            r#"{"recent":"quire:a.docx"}"#,
            r#"{"open":"x"}"#,
            r#"{"doc":true}"#,
        ] {
            assert!(start(other).is_err(), "no other field: {other}");
        }
    }

    #[test]
    fn the_init_script_holds_the_host_as_json() {
        let script = init_script();
        let json = script
            .split_once("value: Object.freeze(")
            .and_then(|(_, rest)| rest.split_once("), writable"))
            .map(|(json, _)| json)
            .unwrap();
        let host: serde_json::Value = serde_json::from_str(json).unwrap();
        assert_eq!(host["version"], VERSION);
        assert_eq!(host["edition"], "direct");
        assert!(script.contains("writable: false, configurable: false"));
    }
}
