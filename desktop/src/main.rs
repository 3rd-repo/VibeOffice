// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host;
#[cfg(any(windows, test))]
mod installation;
#[cfg(windows)]
mod installed;
mod net;

use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

/// A window of the suite: the Start Center ("main") or an app (host_new_window). Every window gets the
/// host script, title, link, drop and UI size handling, and the network rules (net.rs): on Windows and macOS
/// it starts on about:blank and goes to its page once they are on (`net::guard`).
pub fn open_window(app: &AppHandle, label: &str, url: WebviewUrl) -> tauri::Result<WebviewWindow> {
    #[cfg(any(windows, target_os = "macos"))]
    let (url, page) = (
        WebviewUrl::External(net::BLANK.parse().expect("about:blank")),
        net::page_url(app, url),
    );
    let window = WebviewWindowBuilder::new(app, label, url)
        .title("VibeOffice")
        .inner_size(1280.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .initialization_script(host::init_script())
        // The pages take dropped files themselves (Start Center, each app).
        .disable_drag_drop_handler()
        // Links out of the app (the Start Center's GitHub button, the licences page's) open in the default
        // browser if they are ones it may open (host::leave), never in this window or a bare popup. The
        // suite's own windows come from VO.host.newWindow (host_new_window), with the network rules.
        .on_navigation({
            let (app, label) = (app.clone(), label.to_string());
            move |url| {
                if !host::is_external(url) {
                    return true;
                }
                host::leave(&app, &label, url);
                false
            }
        })
        .on_new_window({
            let (app, label) = (app.clone(), label.to_string());
            move |url, _| {
                if host::is_external(&url) {
                    host::leave(&app, &label, &url);
                } else {
                    eprintln!("not opened: a bare window for {url}");
                }
                NewWindowResponse::Deny
            }
        })
        // Saving, for now: every save is a download into the Downloads folder (host::download_destination
        // decides what may be written where); the window is then told the name the file got.
        .on_download(|webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let Ok(dir) = webview.path().download_dir() else {
                    return false;
                };
                match host::download_destination(&url, destination, &dir) {
                    Some(path) => {
                        *destination = path;
                        true
                    }
                    None => false,
                }
            }
            DownloadEvent::Finished { path, success, .. } => {
                let js = webview
                    .state::<host::Host>()
                    .downloaded(webview.label(), path, success);
                let _ = webview.eval(js);
                true
            }
            _ => true,
        })
        // The system title bar shows the page's title, as in the installed PWA (not about:blank's, nor
        // the network probe's).
        .on_document_title_changed(|window, title| {
            #[cfg(any(windows, target_os = "macos"))]
            if title == net::BLANK || net::probe::reported(&window, &title) {
                return;
            }
            let _ = window.set_title(&title);
        })
        // The UI size (Settings), as each page starts: WebKitGTK resets the zoom on the first load.
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Started {
                window
                    .state::<host::Host>()
                    .page_started(window.label(), payload.url());
                let scale = window.state::<host::Host>().ui_scale();
                let _ = window.set_zoom(scale);
            }
            // The first start after installing: what the user chose in the installer
            #[cfg(windows)]
            if payload.event() == PageLoadEvent::Finished
                && window.label() == "main"
                && matches!(payload.url().scheme(), "http" | "https")
            {
                installed::after_install(&window);
            }
        })
        .build()?;
    #[cfg(any(windows, target_os = "macos"))]
    net::guard(&window, page)?;
    Ok(window)
}

/// The Start Center's window has been made once (setup): until then, files that arrive wait for it.
static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Files the system handed over while the app runs (another start on Windows; Finder or the Dock on macOS),
/// already among the launch files: the Start Center opens them (`vo-files`, then `host_launch_files`).
/// Without files it comes to the front, opened again if it was closed.
#[cfg(any(windows, target_os = "macos"))]
fn files_arrived(app: &AppHandle, files: bool) {
    // Windows' other process waits for its handler: windows are made in a task, after it has returned
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match app.get_webview_window("main") {
            Some(main) => {
                if files {
                    let _ = main.eval("window.dispatchEvent(new Event('vo-files'));");
                } else {
                    let _ = main.unminimize();
                    let _ = main.set_focus();
                }
                #[cfg(windows)]
                installed::after_install(&main);
            }
            // takes the files (and on Windows does what the installer asked) as it loads
            None if STARTED.load(std::sync::atomic::Ordering::SeqCst) => {
                let _ = open_window(&app, "main", WebviewUrl::default());
            }
            // a file opened from Finder starts the app: setup is about to make the Start Center
            None => {}
        }
    });
}

/// Another start of VibeOffice while this one runs: its files open here; what the installer asked for
/// (pin, Default apps) is done here.
#[cfg(windows)]
fn second_start(app: &AppHandle, args: Vec<String>, cwd: String) {
    let args = args.get(1..).unwrap_or_default();
    let files = app
        .state::<host::Host>()
        .add_launch_files(args, std::path::Path::new(&cwd));
    installed::take_args(args);
    files_arrived(app, files);
}

/// The menu bar on macOS: Tauri's default one, without Edit ▸ Undo and Redo, which would run WebKit's own
/// undo rather than the document's (⌘Z and ⌘Y reach the page, whose Edit menu has them). Cut, Copy, Paste
/// and Select All stay: WKWebView gets ⌘X, ⌘C, ⌘V and ⌘A through them.
#[cfg(target_os = "macos")]
fn mac_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{
        AboutMetadata, Menu, PredefinedMenuItem as P, Submenu, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
    };
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                info.name.clone(),
                true,
                &[
                    &P::about(app, None, Some(about))?,
                    &P::separator(app)?,
                    &P::services(app, None)?,
                    &P::separator(app)?,
                    &P::hide(app, None)?,
                    &P::hide_others(app, None)?,
                    &P::show_all(app, None)?,
                    &P::separator(app)?,
                    &P::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "File", true, &[&P::close_window(app, None)?])?,
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &P::cut(app, None)?,
                    &P::copy(app, None)?,
                    &P::paste(app, None)?,
                    &P::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "View", true, &[&P::fullscreen(app, None)?])?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                "Window",
                true,
                &[
                    &P::minimize(app, None)?,
                    &P::maximize(app, None)?,
                    &P::separator(app)?,
                    &P::close_window(app, None)?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?,
        ],
    )
}

fn main() {
    // `-uninstall` ends here
    #[cfg(windows)]
    if !installed::start() {
        return;
    }
    let builder = tauri::Builder::default();
    // One VibeOffice per user session on Windows: a second start (the Start menu, a double-click on a
    // file) hands its arguments to this one and exits. The plugin goes first, before anything is made.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(second_start));
    #[cfg(target_os = "macos")]
    let builder = builder.menu(mac_menu);
    let app = builder
        .manage(host::Host::from_args())
        .invoke_handler(tauri::generate_handler![
            host::host_launch_files,
            host::host_read,
            host::host_open_url,
            host::host_ui_scale,
            host::host_set_ui_scale,
            host::host_new_window,
            host::host_close_window,
            host::host_show_downloads
        ])
        .setup(|app| {
            app.state::<host::Host>().load_settings(app.handle());
            let start = {
                let app = app.handle().clone();
                move || {
                    if let Err(e) = open_window(&app, "main", WebviewUrl::default()) {
                        eprintln!("the Start Center: {e}");
                        app.exit(1);
                    }
                    STARTED.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            };
            // macOS: once WebKit has compiled the network rules (without them, no window opens)
            #[cfg(target_os = "macos")]
            net::prepare(app.handle(), start);
            #[cfg(not(target_os = "macos"))]
            start();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting VibeOffice");
    #[cfg(not(target_os = "macos"))]
    app.run(|_, _| {});
    #[cfg(target_os = "macos")]
    app.run(|app, event| match event {
        // Files from Finder (a double-click, Open With, a drop on the Dock icon), at start or later. The
        // sandbox lets the app read what the user opened this way.
        tauri::RunEvent::Opened { urls } => {
            let paths = urls.iter().filter_map(|u| u.to_file_path().ok());
            let files = app
                .state::<host::Host>()
                .add_launch_files(paths, std::path::Path::new("/"));
            files_arrived(app, files);
        }
        // A click on the Dock icon with no window open brings the Start Center back
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } if app.webview_windows().is_empty() => files_arrived(app, false),
        // The app keeps running, with its menu bar, after its last window closes; Quit (⌘Q) ends it
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        _ => {}
    });
}
