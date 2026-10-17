//! Which app opens which file: the same table as `VO.APPS` in public/common/suite.js (a test compares them). Rust
//! picks the app for a file it opens (the command line, Finder, the Open dialog) and the Open dialog's filters
//! from it, so a page never names a file type for the system.

use std::path::Path;

/// The apps and the extensions each opens, lower case.
pub const APPS: &[(&str, &[&str])] = &[
    (
        "quire",
        &[
            "docx", "docm", "dotx", "dotm", "doc", "rtf", "htm", "html", "txt", "md", "markdown",
            "zip",
        ],
    ),
    (
        "ledger",
        &[
            "xlsx", "xlsm", "xltx", "xltm", "xls", "csv", "tsv", "prn", "xml",
        ],
    ),
    (
        "lectern",
        &["pptx", "pptm", "ppsx", "ppsm", "potx", "potm", "ppt"],
    ),
];

/// A file's extension, lower case.
pub fn ext(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
}

/// The app that opens `path`, by its extension.
pub fn app_for(path: &Path) -> Option<&'static str> {
    let ext = ext(path)?;
    APPS.iter()
        .find(|(_, exts)| exts.contains(&ext.as_str()))
        .map(|(app, _)| *app)
}

/// The extensions `app` opens (none for a name that isn't an app).
pub fn opens(app: &str) -> &'static [&'static str] {
    APPS.iter()
        .find(|(a, _)| *a == app)
        .map_or(&[], |(_, exts)| exts)
}

/// Whether `page` is one of the apps (a window label's page).
pub fn is_app(page: &str) -> bool {
    APPS.iter().any(|(a, _)| *a == page)
}

/// How a type's bytes must start: a guard against a writer mix-up (.md bytes under .zip), not a security boundary.
#[derive(Debug, PartialEq)]
pub enum Magic {
    /// a ZIP package
    Zip,
    /// a ZIP package, or an encrypted Office file (OLE)
    Office,
    Rtf,
    Pdf,
    Png,
    /// text: no NUL in its first 8 KB, unless it starts with a UTF-16 byte order mark
    Text,
}

impl Magic {
    pub fn matches(&self, b: &[u8]) -> bool {
        const ZIP: &[u8] = b"PK\x03\x04";
        const OLE: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        match self {
            Magic::Zip => b.starts_with(ZIP),
            Magic::Office => b.starts_with(ZIP) || b.starts_with(OLE),
            Magic::Rtf => b.starts_with(b"{\\rtf"),
            Magic::Pdf => b.starts_with(b"%PDF-"),
            Magic::Png => b.starts_with(b"\x89PNG\r\n\x1a\n"),
            Magic::Text => {
                b.starts_with(&[0xFF, 0xFE])
                    || b.starts_with(&[0xFE, 0xFF])
                    || !b[..b.len().min(8192)].contains(&0)
            }
        }
    }
}

/// A type an app writes: its id (the pages' type ids), extensions (the first is given to a new file), and whether a
/// Save As to it makes it the window's file (a document type; the rest are exports).
pub struct Kind {
    pub app: &'static str,
    pub id: &'static str,
    pub exts: &'static [&'static str],
    pub binds: bool,
    pub magic: Magic,
}

const fn k(
    app: &'static str,
    id: &'static str,
    exts: &'static [&'static str],
    binds: bool,
    magic: Magic,
) -> Kind {
    Kind {
        app,
        id,
        exts,
        binds,
        magic,
    }
}

/// What each app writes, the whole list: a write anywhere else is refused (files.rs).
pub const KINDS: &[Kind] = &[
    k("quire", "docx", &["docx"], true, Magic::Office),
    k("quire", "docm", &["docm"], true, Magic::Office),
    k("quire", "dotx", &["dotx"], true, Magic::Office),
    k("quire", "dotm", &["dotm"], true, Magic::Office),
    k("quire", "md", &["md", "markdown"], true, Magic::Text),
    k("quire", "mdzip", &["zip"], true, Magic::Zip),
    k("quire", "html", &["htm", "html"], false, Magic::Text),
    k("quire", "rtf", &["rtf"], false, Magic::Rtf),
    k("quire", "txt", &["txt"], false, Magic::Text),
    k("quire", "pdf", &["pdf"], false, Magic::Pdf),
    k("ledger", "xlsx", &["xlsx"], true, Magic::Office),
    k("ledger", "xlsm", &["xlsm"], true, Magic::Office),
    k("ledger", "xltx", &["xltx"], true, Magic::Office),
    k("ledger", "xltm", &["xltm"], true, Magic::Office),
    k("ledger", "xmlss", &["xml"], true, Magic::Text),
    k("ledger", "csv", &["csv"], false, Magic::Text),
    k("ledger", "txt", &["txt"], false, Magic::Text),
    // only the files of these types Ledger opened, saved where they are
    k("ledger", "tsv", &["tsv"], false, Magic::Text),
    k("ledger", "prn", &["prn"], false, Magic::Text),
    k("ledger", "html", &["htm", "html"], false, Magic::Text),
    k("ledger", "pdf", &["pdf"], false, Magic::Pdf),
    k("lectern", "pptx", &["pptx"], true, Magic::Office),
    k("lectern", "pptm", &["pptm"], true, Magic::Office),
    k("lectern", "ppsx", &["ppsx"], true, Magic::Office),
    k("lectern", "ppsm", &["ppsm"], true, Magic::Office),
    k("lectern", "potx", &["potx"], true, Magic::Office),
    k("lectern", "potm", &["potm"], true, Magic::Office),
    k("lectern", "pdf", &["pdf"], false, Magic::Pdf),
    k("lectern", "html", &["html", "htm"], false, Magic::Text),
    k("lectern", "png", &["png"], false, Magic::Png),
    k("lectern", "txt", &["txt"], false, Magic::Text),
];

/// `app`'s type `id`.
pub fn kind(app: &str, id: &str) -> Option<&'static Kind> {
    KINDS.iter().find(|k| k.app == app && k.id == id)
}

/// The type of `app` a file is, by its extension.
pub fn kind_of(app: &str, path: &Path) -> Option<&'static Kind> {
    let e = ext(path)?;
    KINDS
        .iter()
        .find(|k| k.app == app && k.exts.contains(&e.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_apps_open_what_vo_apps_says() {
        let suite = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/common/suite.js"),
        )
        .unwrap();
        for (app, exts) in APPS {
            let line = suite
                .lines()
                .find(|l| l.trim_start().starts_with(&format!("{app}: {{ name:")))
                .unwrap_or_else(|| panic!("{app} in VO.APPS"));
            let list = line
                .split("ext: [")
                .nth(1)
                .unwrap()
                .split(']')
                .next()
                .unwrap();
            let theirs: Vec<&str> = list
                .split(',')
                .map(|e| e.trim().trim_matches('\''))
                .collect();
            assert_eq!(theirs, *exts, "{app}");
        }
        assert_eq!(app_for(Path::new("/a/Report.DOCX")), Some("quire"));
        assert_eq!(app_for(Path::new("Budget.csv")), Some("ledger"));
        assert_eq!(app_for(Path::new("Deck.potm")), Some("lectern"));
        assert_eq!(app_for(Path::new("run.exe")), None);
        assert_eq!(app_for(Path::new("docx")), None);
    }

    #[test]
    fn a_type_is_known_by_its_bytes() {
        let zip = b"PK\x03\x04\x14\x00\x00\x00rest";
        let ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0];
        assert!(kind("quire", "docx").unwrap().magic.matches(zip));
        assert!(
            kind("quire", "docx").unwrap().magic.matches(&ole),
            "encrypted"
        );
        assert!(!kind("quire", "mdzip").unwrap().magic.matches(&ole));
        assert!(
            !kind("quire", "md").unwrap().magic.matches(zip),
            "a package isn't Markdown"
        );
        assert!(kind("quire", "md")
            .unwrap()
            .magic
            .matches("# Caf\u{e9}".as_bytes()));
        assert!(
            kind("ledger", "csv")
                .unwrap()
                .magic
                .matches(&[0xFF, 0xFE, b'a', 0]),
            "UTF-16"
        );
        assert!(kind("quire", "rtf")
            .unwrap()
            .magic
            .matches(b"{\\rtf1\\ansi"));
        assert!(!kind("lectern", "pdf").unwrap().magic.matches(b"%PNG"));
        assert_eq!(
            kind_of("ledger", Path::new("/a/B.XML")).map(|k| k.id),
            Some("xmlss")
        );
        assert_eq!(
            kind_of("quire", Path::new("/a/B.zip")).map(|k| k.id),
            Some("mdzip")
        );
        assert!(
            kind_of("quire", Path::new("/a/B.xlsx")).is_none(),
            "another app's type"
        );
        assert!(kind("ledger", "docx").is_none());
    }
}
