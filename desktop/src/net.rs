//! The network the pages may use: https://vibeoffice.work/ alone, for the update check (updater/current.json
//! and whatsnew.json). The app itself makes no connections. Each window's web view refuses every other
//! http(s) and ws(s) request, whatever makes it (a page, a picture or frame in a document, a worker):
//! WKWebView through a content rule list (macOS), WebView2 by answering the request itself (Windows).
//! Links still open in the default browser (host::open_external), which is not the app.

/// The one site the pages may reach.
const SITE_HOST: &str = "vibeoffice.work";

/// Whether a web view may load `url`: the site over https, the app's own pages and IPC (Tauri's
/// http://tauri.localhost and http://ipc.localhost on Windows; the dev server in a dev build), and
/// anything that isn't the network (data:, blob:, about:, tauri:, ipc:). Windows asks this for every
/// request; macOS says the same in `rules`.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn allowed(url: &str) -> bool {
    let Ok(url) = tauri::Url::parse(url) else {
        return false;
    };
    match url.scheme() {
        "https" if url.host_str() == Some(SITE_HOST) && url.port().is_none() => true,
        "http" | "https" => {
            matches!(url.host_str(), Some("tauri.localhost" | "ipc.localhost"))
                || (!cfg!(feature = "custom-protocol") && url.host_str() == Some("127.0.0.1"))
        }
        "ws" | "wss" => false,
        _ => true,
    }
}

/// WebKit's content rules (the format of Safari's content blockers): block every http(s) and ws(s)
/// request, then let the site's through (and the dev server's in a dev build). WebKit's url-filter is a
/// small subset of regular expressions: no alternation, so one rule per scheme.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn rules() -> String {
    let block = |filter: &str| {
        format!(r#"{{"trigger":{{"url-filter":"{filter}"}},"action":{{"type":"block"}}}}"#)
    };
    let allow = |filter: &str| {
        format!(
            r#"{{"trigger":{{"url-filter":"{filter}"}},"action":{{"type":"ignore-previous-rules"}}}}"#
        )
    };
    let mut rules = vec![
        block("^https?://"),
        block("^wss?://"),
        allow(&format!("^https://{}/", SITE_HOST.replace('.', "\\\\."))),
    ];
    if !cfg!(feature = "custom-protocol") {
        rules.push(allow("^http://127\\\\.0\\\\.0\\\\.1[:/]"));
    }
    format!("[{}]", rules.join(","))
}

/// A new window's web view, as it is made (open_window): from now on it loads only what `allowed` lets.
#[cfg(any(windows, target_os = "macos"))]
pub fn apply(webview: tauri::webview::PlatformWebview) {
    #[cfg(target_os = "macos")]
    mac::apply(webview.controller());
    #[cfg(windows)]
    if let Err(e) = win::apply(&webview.controller(), webview.environment()) {
        eprintln!("network rules: {e}");
    }
}

#[cfg(target_os = "macos")]
pub use mac::prepare;

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2::{rc::Retained, MainThreadMarker};
    use objc2_foundation::{NSError, NSString};
    use objc2_web_kit::{WKContentRuleList, WKContentRuleListStore, WKUserContentController};
    use std::cell::RefCell;

    /// The compiled rules once WebKit has them, and the web views made before that, waiting for them
    /// (main thread only, as WebKit is).
    #[derive(Default)]
    struct Rules {
        list: Option<Retained<WKContentRuleList>>,
        waiting: Vec<Retained<WKUserContentController>>,
    }
    thread_local! {
        static RULES: RefCell<Rules> = RefCell::default();
    }

    /// Compiles the rules (WebKit keeps them, compiled, in the app's container), then calls `ready` on the
    /// main thread: setup opens the Start Center only then, so no page runs without them. If WebKit
    /// refuses them, the app still starts and says so on stderr.
    pub fn prepare(ready: impl FnOnce() + 'static) {
        let mtm = MainThreadMarker::new().expect("network rules: not on the main thread");
        let Some(store) = (unsafe { WKContentRuleListStore::defaultStore(mtm) }) else {
            eprintln!("network rules: no content rule list store");
            return ready();
        };
        let ready = RefCell::new(Some(ready));
        let done = RcBlock::new(move |list: *mut WKContentRuleList, error: *mut NSError| {
            match unsafe { Retained::retain(list) } {
                Some(list) => {
                    eprintln!("network rules: only https://{}/", super::SITE_HOST);
                    RULES.with_borrow_mut(|rules| {
                        for controller in rules.waiting.drain(..) {
                            unsafe { controller.addContentRuleList(&list) };
                        }
                        rules.list = Some(list);
                    });
                }
                None => {
                    let why =
                        unsafe { error.as_ref() }.map(|e| e.localizedDescription().to_string());
                    eprintln!(
                        "network rules: WebKit refused them: {}",
                        why.unwrap_or_default()
                    );
                }
            }
            if let Some(ready) = ready.borrow_mut().take() {
                ready();
            }
        });
        unsafe {
            store.compileContentRuleListForIdentifier_encodedContentRuleList_completionHandler(
                Some(&NSString::from_str("vibeoffice-network")),
                Some(&NSString::from_str(&super::rules())),
                Some(&done),
            );
        }
    }

    /// The rules on a web view's user content controller (wry's WKUserContentController), now or as soon
    /// as they are compiled.
    pub fn apply(controller: *mut std::ffi::c_void) {
        let Some(controller) =
            (unsafe { Retained::retain(controller.cast::<WKUserContentController>()) })
        else {
            return;
        };
        RULES.with_borrow_mut(|rules| match &rules.list {
            Some(list) => unsafe { controller.addContentRuleList(list) },
            None => rules.waiting.push(controller),
        });
    }
}

#[cfg(windows)]
mod win {
    use webview2_com::{
        take_pwstr,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2_22,
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
            COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
        },
        WebResourceRequestedEventHandler,
    };
    use windows::core::{Interface, HSTRING, PWSTR};

    /// Every request of the web view comes here first (also from workers, where WebView2 is new enough:
    /// ICoreWebView2_22); one `allowed` refuses gets a 403 without reaching the network. wry's own handler
    /// on the same event answers the app's pages (tauri.localhost), which this one lets through.
    pub fn apply(
        controller: &ICoreWebView2Controller,
        env: ICoreWebView2Environment,
    ) -> windows::core::Result<()> {
        unsafe {
            let webview = controller.CoreWebView2()?;
            let every = HSTRING::from("*");
            match webview.cast::<ICoreWebView2_22>() {
                Ok(webview) => webview.AddWebResourceRequestedFilterWithRequestSourceKinds(
                    &every,
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                )?,
                Err(_) => webview
                    .AddWebResourceRequestedFilter(&every, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
            }
            let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                args.Request()?.Uri(&mut uri)?;
                if !super::allowed(&take_pwstr(uri)) {
                    let refused = env.CreateWebResourceResponse(
                        None,
                        403,
                        &HSTRING::from("Forbidden"),
                        &HSTRING::from("Content-Type: text/plain"),
                    )?;
                    args.SetResponse(&refused)?;
                }
                Ok(())
            }));
            let mut token = 0;
            webview.add_WebResourceRequested(&handler, &mut token)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_site_and_the_app_itself() {
        for url in [
            "https://vibeoffice.work/updater/current.json",
            "https://vibeoffice.work/updater/whatsnew.json",
            "http://tauri.localhost/quire/index.html",
            "http://ipc.localhost/host_read",
            "tauri://localhost/index.html",
            "ipc://localhost/host_read",
            "blob:http://tauri.localhost/0b6c",
            "data:image/png;base64,AAAA",
            "about:blank",
        ] {
            assert!(allowed(url), "{url}");
        }
        for url in [
            "http://vibeoffice.work/updater/current.json",
            "https://vibeoffice.work:8443/",
            "https://www.vibeoffice.work/",
            "https://vibeoffice.work.example.com/",
            "https://vibeoffice.work@example.com/",
            "https://example.com/picture.png",
            "http://localhost:8080/",
            "http://192.168.1.1/",
            "wss://vibeoffice.work/",
            "not a url",
        ] {
            assert!(!allowed(url), "{url}");
        }
    }

    #[test]
    fn rules_are_json_webkit_reads() {
        let rules: serde_json::Value = serde_json::from_str(&rules()).expect("valid JSON");
        let filters: Vec<(&str, &str)> = rules
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["trigger"]["url-filter"].as_str().unwrap(),
                    r["action"]["type"].as_str().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            filters[..3],
            [
                ("^https?://", "block"),
                ("^wss?://", "block"),
                ("^https://vibeoffice\\.work/", "ignore-previous-rules")
            ]
        );
        assert!(
            filters.iter().all(|(f, _)| !f.contains('|')),
            "WebKit's url-filter has no alternation"
        );
    }
}
