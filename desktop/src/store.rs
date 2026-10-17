//! ~/.vibeoffice: what the desktop app keeps for itself (todos/DESKTOP_REAL_SAVE.md, Storage). So far Recent
//! Files: each entry with its preview and its unsaved version (the draft).
//!
//! ```text
//! recent_files/<yyyy-mm>/<key>.recent           the entry (JSON); the month (UTC) it was made, it never moves
//!                        <key>.recent.preview   its preview: a JPEG, at most MAX_PREVIEW
//!                        <key>.recent.draft     its unsaved changes in the app's own format, at most MAX_DRAFT
//! ```
//!
//! A user's file name never comes into a path made here: a file's key is the sha256 of its path, a never-saved
//! document's of random bytes, 64 hex digits either way. Only names of that form are read; anything else in the
//! folder is left alone, and links are never followed. Every file is written whole or not at all (`write_atomic`).

use std::{
    collections::HashSet,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Entries without a draft beyond this many (the newest kept) are dropped, as on the web (common/suite.js).
pub const MAX_RECENT: usize = 30;
pub const MAX_PREVIEW: usize = 512 << 10;
pub const MAX_DRAFT: usize = 50 << 20;
/// An entry file (its draft's loss state included).
const MAX_ENTRY: u64 = 2 << 20;

/// A Recent Files entry. `size` and `mtime` are the file's when the entry was last opened or saved, so a draft
/// saved over a file changed since can say so.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub v: u32,
    pub app: String,
    /// the file; none for a document never saved, which is in the list for its draft alone
    pub path: Option<PathBuf>,
    /// the file's name, or the never-saved document's
    pub name: String,
    pub size: u64,
    pub mtime: u64,
    /// when it was last opened, saved or changed (ms since 1970)
    pub time: u64,
    pub draft: Option<Draft>,
    /// macOS: a security-scoped bookmark of the file (hex), which opens it again after the app has quit (doc.rs)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// the name the unsaved version is opened as (Ledger: a CSV's draft is an .xlsx)
    pub name: String,
    pub time: u64,
    /// what the page had to leave out or convert so far (L.opc.lossState), given back when the draft opens
    pub loss_state: Option<serde_json::Value>,
}

impl Entry {
    pub fn new(app: &str, path: Option<PathBuf>, name: &str) -> Entry {
        Entry {
            v: 1,
            app: app.into(),
            path,
            name: name.into(),
            size: 0,
            mtime: 0,
            time: now_ms(),
            draft: None,
            bookmark: None,
        }
    }
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> Store {
        Store { root }
    }

    /// `VIBEOFFICE_HOME`, for tests, else `.vibeoffice` in the user's home folder.
    pub fn at(home: Option<PathBuf>) -> Store {
        let root = std::env::var_os("VIBEOFFICE_HOME")
            .map(PathBuf::from)
            .or_else(|| home.map(|h| h.join(".vibeoffice")))
            .unwrap_or_else(|| PathBuf::from(".vibeoffice"));
        Store::new(root)
    }

    fn recent(&self) -> PathBuf {
        self.root.join("recent_files")
    }

    /// The month folders, as they are named.
    fn months(&self) -> Vec<PathBuf> {
        let Ok(dir) = fs::read_dir(self.recent()) else {
            return Vec::new();
        };
        dir.flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .filter(|e| e.file_name().to_str().is_some_and(is_month))
            .map(|e| e.path())
            .collect()
    }

    /// The month folder holding `key`'s entry.
    fn folder_of(&self, key: &str) -> Option<PathBuf> {
        if !is_key(key) {
            return None;
        }
        self.months().into_iter().find(|m| {
            m.join(format!("{key}.recent"))
                .symlink_metadata()
                .is_ok_and(|m| m.is_file())
        })
    }

    pub fn get(&self, key: &str) -> Option<Entry> {
        read_entry(&self.folder_of(key)?.join(format!("{key}.recent")))
    }

    /// Writes `key`'s entry: where it is, or in this month's folder for a new one.
    pub fn put(&self, key: &str, entry: &Entry) -> io::Result<()> {
        let folder = self.folder_for(key)?;
        let json = serde_json::to_vec(entry).map_err(io::Error::other)?;
        if json.len() as u64 > MAX_ENTRY {
            return Err(io::Error::other("the entry is too large"));
        }
        write_atomic(&folder.join(format!("{key}.recent")), &json)
    }

    fn folder_for(&self, key: &str) -> io::Result<PathBuf> {
        if !is_key(key) {
            return Err(io::Error::other(format!("not a key: {key}")));
        }
        if let Some(f) = self.folder_of(key) {
            return Ok(f);
        }
        let folder = self.recent().join(month(now_ms()));
        make_dir(&self.root)?;
        make_dir(&self.recent())?;
        make_dir(&folder)?;
        Ok(folder)
    }

    /// Every entry, newest first, with whether it has a preview.
    pub fn list(&self) -> Vec<(String, Entry, bool)> {
        let mut all = Vec::new();
        for month in self.months() {
            let Ok(dir) = fs::read_dir(&month) else {
                continue;
            };
            for f in dir.flatten() {
                let name = f.file_name();
                let Some(key) = name.to_str().and_then(|n| n.strip_suffix(".recent")) else {
                    continue;
                };
                if !is_key(key) || !f.file_type().is_ok_and(|t| t.is_file()) {
                    continue;
                }
                if let Some(entry) = read_entry(&f.path()) {
                    let preview = month
                        .join(format!("{key}.recent.preview"))
                        .symlink_metadata()
                        .is_ok_and(|m| m.is_file());
                    all.push((key.to_string(), entry, preview));
                }
            }
        }
        all.sort_by_key(|e| std::cmp::Reverse(e.1.time));
        all
    }

    /// Stores the preview of an entry that exists.
    pub fn set_preview(&self, key: &str, jpeg: &[u8]) -> io::Result<()> {
        if jpeg.len() > MAX_PREVIEW || !jpeg.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Err(io::Error::other("not a preview: a JPEG up to 512 KB"));
        }
        let folder = self
            .folder_of(key)
            .ok_or_else(|| io::Error::other("no such entry"))?;
        write_atomic(&folder.join(format!("{key}.recent.preview")), jpeg)
    }

    pub fn preview(&self, key: &str) -> Option<Vec<u8>> {
        read_file(
            &self.folder_of(key)?.join(format!("{key}.recent.preview")),
            MAX_PREVIEW as u64,
        )
        .ok()
    }

    /// Stores an unsaved version: the draft first, then the entry that names it.
    pub fn set_draft(&self, key: &str, entry: &Entry, bytes: &[u8]) -> io::Result<()> {
        if bytes.len() > MAX_DRAFT {
            return Err(io::Error::other("the unsaved version is over 50 MB"));
        }
        let folder = self.folder_for(key)?;
        write_atomic(&folder.join(format!("{key}.recent.draft")), bytes)?;
        self.put(key, entry)
    }

    pub fn draft(&self, key: &str) -> io::Result<Vec<u8>> {
        let folder = self
            .folder_of(key)
            .ok_or_else(|| io::Error::other("no such entry"))?;
        read_file(
            &folder.join(format!("{key}.recent.draft")),
            MAX_DRAFT as u64,
        )
    }

    /// Throws an entry's unsaved version away; an entry of a document never saved goes with it.
    pub fn drop_draft(&self, key: &str) -> io::Result<()> {
        let Some(mut entry) = self.get(key) else {
            return Ok(());
        };
        if entry.path.is_none() {
            return self.remove(key);
        }
        entry.draft = None;
        self.put(key, &entry)?;
        let folder = self.folder_for(key)?;
        remove_if_there(&folder.join(format!("{key}.recent.draft")))
    }

    /// Forgets an entry, its preview and its draft.
    pub fn remove(&self, key: &str) -> io::Result<()> {
        let Some(folder) = self.folder_of(key) else {
            return Ok(());
        };
        for end in ["recent", "recent.preview", "recent.draft"] {
            remove_if_there(&folder.join(format!("{key}.{end}")))?;
        }
        let _ = fs::remove_dir(&folder); // only when emptied
        Ok(())
    }

    /// Keeps the list as the web keeps it: the MAX_RECENT newest entries without a draft, every entry with one,
    /// and those in `keep` (open in a window).
    pub fn prune(&self, keep: &HashSet<String>) {
        let plain = self
            .list()
            .into_iter()
            .filter(|(key, e, _)| e.draft.is_none() && !keep.contains(key));
        for (key, _, _) in plain.skip(MAX_RECENT) {
            let _ = self.remove(&key);
        }
    }

    /// Settings ▸ Clear: every entry without a draft, but those in `keep`.
    pub fn clear(&self, keep: &HashSet<String>) {
        for (key, e, _) in self.list() {
            if e.draft.is_none() && !keep.contains(&key) {
                let _ = self.remove(&key);
            }
        }
    }
}

/// Previous versions (todos/DESKTOP_REAL_SAVE.md, Previous versions): the version on disk before a window first
/// wrote over it, `previous_versions/<yyyy-mm>/<file's key>.<ms>.previous`. Kept 30 days, 5 a file and 1 GB in all,
/// the oldest going first; a file over 200 MB isn't kept.
const KEEP_MS: u64 = 30 * 86_400_000;
const VERSIONS_PER_FILE: usize = 5;
const VERSIONS_IN_ALL: u64 = 1 << 30;
const VERSION_LARGEST: u64 = 200 << 20;

impl Store {
    fn versions_dir(&self) -> PathBuf {
        self.root.join("previous_versions")
    }

    /// Every kept version: (id `<key>.<ms>`, its file, size), oldest first.
    fn all_versions(&self) -> Vec<(String, PathBuf, u64)> {
        let Ok(months) = fs::read_dir(self.versions_dir()) else {
            return Vec::new();
        };
        let mut all = Vec::new();
        for m in months.flatten() {
            if !m.file_type().is_ok_and(|t| t.is_dir())
                || !m.file_name().to_str().is_some_and(is_month)
            {
                continue;
            }
            for f in fs::read_dir(m.path()).into_iter().flatten().flatten() {
                let name = f.file_name();
                let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".previous")) else {
                    continue;
                };
                if version_time(id).is_some() && f.file_type().is_ok_and(|t| t.is_file()) {
                    let size = f.metadata().map_or(0, |m| m.len());
                    all.push((id.to_string(), f.path(), size));
                }
            }
        }
        all.sort_by_key(|(id, _, _)| version_time(id));
        all
    }

    /// Keeps the file `key` names as it is now, before a save replaces it.
    pub fn keep_previous(&self, key: &str, file: &Path) {
        if !is_key(key) || fs::metadata(file).map_or(true, |m| m.len() > VERSION_LARGEST) {
            return;
        }
        let folder = self.versions_dir().join(month(now_ms()));
        let kept = make_dir(&self.root)
            .and_then(|()| make_dir(&self.versions_dir()))
            .and_then(|()| make_dir(&folder))
            .and_then(|()| {
                let tmp = folder.join(format!(".~vibeoffice-{}.tmp", hex(&random::<8>())));
                let done = fs::copy(file, &tmp)
                    .and_then(|_| fs::File::open(&tmp)?.sync_all())
                    .and_then(|()| {
                        fs::rename(&tmp, folder.join(format!("{key}.{}.previous", now_ms())))
                    });
                if done.is_err() {
                    let _ = fs::remove_file(&tmp);
                }
                done
            });
        if let Err(e) = kept {
            eprintln!("previous version: {e}");
        }
        self.prune_versions(now_ms());
    }

    /// The kept versions of the file `key` names, newest first: (id, when, size).
    pub fn versions(&self, key: &str) -> Vec<(String, u64, u64)> {
        let mut list: Vec<_> = self
            .all_versions()
            .into_iter()
            .filter(|(id, _, _)| id.split('.').next() == Some(key))
            .map(|(id, _, size)| {
                let t = version_time(&id).unwrap_or(0);
                (id, t, size)
            })
            .collect();
        list.reverse();
        list
    }

    pub fn version(&self, id: &str) -> io::Result<Vec<u8>> {
        let (_, path, _) = self
            .all_versions()
            .into_iter()
            .find(|(v, _, _)| v == id)
            .ok_or_else(|| io::Error::other("no such version"))?;
        read_file(&path, VERSION_LARGEST)
    }

    fn prune_versions(&self, now: u64) {
        let all = self.all_versions();
        let mut total: u64 = all.iter().map(|(_, _, s)| s).sum();
        let mut per_file: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for (id, _, _) in &all {
            *per_file
                .entry(id.split('.').next().unwrap_or(""))
                .or_default() += 1;
        }
        for (id, path, size) in &all {
            let key = id.split('.').next().unwrap_or("");
            let old = version_time(id).is_none_or(|t| now.saturating_sub(t) > KEEP_MS);
            let many = per_file.get(key).is_some_and(|n| *n > VERSIONS_PER_FILE);
            if (old || many || total > VERSIONS_IN_ALL) && fs::remove_file(path).is_ok() {
                total -= size;
                *per_file.entry(key).or_default() -= 1;
                if let Some(dir) = path.parent() {
                    let _ = fs::remove_dir(dir); // only when emptied
                }
            }
        }
    }
}

/// When a version was kept, from its id (`<64 hex>.<ms>`); none for anything else.
fn version_time(id: &str) -> Option<u64> {
    let (key, ms) = id.split_once('.')?;
    (is_key(key) && !ms.is_empty() && ms.bytes().all(|b| b.is_ascii_digit()))
        .then(|| ms.parse().ok())
        .flatten()
}

fn read_entry(path: &Path) -> Option<Entry> {
    let bytes = read_file(path, MAX_ENTRY).ok()?;
    let entry: Entry = serde_json::from_slice(&bytes).ok()?;
    (entry.v == 1 && crate::types::is_app(&entry.app)).then_some(entry)
}

/// A file's bytes, refused past `max` (it stops reading there).
pub fn read_file(path: &Path, max: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(max + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > max {
        return Err(io::Error::other(format!(
            "larger than {} MB",
            max.div_ceil(1 << 20)
        )));
    }
    Ok(bytes)
}

fn remove_if_there(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// A folder only this user can open (Unix), made if missing.
fn make_dir(path: &Path) -> io::Result<()> {
    let mut b = fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut b, 0o700);
    #[cfg(not(unix))]
    let b = &mut b;
    match b.create(path) {
        Err(e) if e.kind() != io::ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

/// Writes a file whole or not at all: a temp file beside it, synced, renamed over it.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| io::Error::other("no folder"))?;
    let tmp = dir.join(format!(".~vibeoffice-{}.tmp", hex(&random::<8>())));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// A file's key, from its path as the system resolves it (links, `..`, and on Windows the case, which names
/// there ignore), with that path.
pub fn key_of(path: &Path) -> io::Result<(String, PathBuf)> {
    let real = fs::canonicalize(path)?;
    let text = real.to_string_lossy();
    let text = if cfg!(windows) {
        text.to_lowercase()
    } else {
        text.into_owned()
    };
    Ok((hex(&Sha256::digest(text.as_bytes())), real))
}

/// A never-saved document's key.
pub fn random_key() -> String {
    hex(&Sha256::digest(random::<32>()))
}

pub fn is_key(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_month(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7
        && b[4] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || c.is_ascii_digit())
}

fn random<const N: usize>() -> [u8; N] {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).expect("the system's random numbers");
    b
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The bytes `hex` wrote; none for anything else.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

pub fn now_ms() -> u64 {
    ms(SystemTime::now())
}

pub fn ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// `yyyy-mm` (UTC) of a time in ms since 1970: the civil calendar from a day count (proleptic Gregorian, in
/// 400-year eras of 146097 days, the year taken to start in March so the leap day comes last).
fn month(ms: u64) -> String {
    let z = (ms / 86_400_000) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> Store {
        let root = std::env::temp_dir().join(format!("vo-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        Store::new(root)
    }

    #[test]
    fn months_are_utc_calendar_months() {
        for (secs, want) in [
            (0, "1970-01"),
            (951_782_400, "2000-02"),
            (1_798_761_599, "2026-12"),
            (4_102_444_800, "2100-01"),
        ] {
            assert_eq!(month(secs * 1000), want, "{secs}");
        }
    }

    #[test]
    fn a_file_is_one_entry_whatever_the_path_says_and_no_name_reaches_a_path() {
        let s = scratch("keys");
        let dir = s.root.join("docs");
        fs::create_dir_all(dir.join("sub")).unwrap();
        let file = dir.join("Report ..\u{e9}t\u{e9}.docx");
        fs::write(&file, b"x").unwrap();
        let (key, real) = key_of(&file).unwrap();
        assert!(is_key(&key));
        assert_eq!(
            key_of(&dir.join("sub").join("..").join(file.file_name().unwrap()))
                .unwrap()
                .0,
            key
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&file, dir.join("link.docx")).unwrap();
            assert_eq!(key_of(&dir.join("link.docx")).unwrap().0, key, "a link");
        }
        let entry = Entry::new("quire", Some(real), "Report ..\u{e9}t\u{e9}.docx");
        s.put(&key, &entry).unwrap();
        s.set_preview(&key, &[0xFF, 0xD8, 0xFF, 0xE0]).unwrap();
        s.set_draft(&key, &entry, b"draft").unwrap();
        assert_ne!(random_key(), random_key());
        let mut names = Vec::new();
        for m in s.months() {
            names.push(m.file_name().unwrap().to_string_lossy().into_owned());
            for f in fs::read_dir(m).unwrap().flatten() {
                names.push(f.file_name().to_string_lossy().into_owned());
            }
        }
        assert_eq!(names.len(), 4, "{names:?}");
        for n in names {
            assert!(
                is_month(&n) || is_key(n.split('.').next().unwrap()),
                "{n}: only hex digits and the month"
            );
        }
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn entries_keep_their_drafts_and_previews_and_the_list_keeps_thirty_without() {
        let s = scratch("prune");
        let mut keys = Vec::new();
        for i in 0..35u64 {
            let key = random_key();
            let mut e = Entry::new("ledger", Some(PathBuf::from(format!("/x/{i}.xlsx"))), "b");
            e.time = 1000 + i;
            s.put(&key, &e).unwrap();
            keys.push(key);
        }
        // the oldest has unsaved changes; the second oldest is open in a window
        let mut old = s.get(&keys[0]).unwrap();
        old.draft = Some(Draft {
            name: "0.xlsx".into(),
            time: 1,
            loss_state: None,
        });
        s.set_draft(&keys[0], &old, b"PK").unwrap();
        let open: HashSet<String> = [keys[1].clone()].into();
        s.prune(&open);
        let left: HashSet<String> = s.list().into_iter().map(|(k, _, _)| k).collect();
        assert_eq!(left.len(), 32);
        assert!(left.contains(&keys[0]) && left.contains(&keys[1]));
        assert!(!left.contains(&keys[2]) && left.contains(&keys[34]));
        assert_eq!(s.draft(&keys[0]).unwrap(), b"PK");
        // the newest first
        assert_eq!(s.list()[0].0, keys[34]);
        // a saved file's draft goes alone; a never-saved document goes whole
        s.drop_draft(&keys[0]).unwrap();
        assert!(s.get(&keys[0]).unwrap().draft.is_none());
        assert!(s.draft(&keys[0]).is_err());
        let never = random_key();
        let e = Entry::new("quire", None, "Document2.docx");
        s.set_draft(&never, &e, b"PK").unwrap();
        s.drop_draft(&never).unwrap();
        assert!(s.get(&never).is_none());
        // Clear keeps drafts and open documents
        s.set_draft(&keys[0], &old, b"PK").unwrap();
        s.clear(&open);
        let left: Vec<String> = s.list().into_iter().map(|(k, _, _)| k).collect();
        assert_eq!(left.len(), 2, "{left:?}");
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn foreign_and_broken_files_are_left_alone() {
        let s = scratch("foreign");
        let key = random_key();
        s.put(&key, &Entry::new("lectern", None, "Deck.pptx"))
            .unwrap();
        let month = s.months().pop().unwrap();
        fs::write(month.join(format!("{}.recent", random_key())), b"{not json").unwrap();
        fs::write(month.join("notes.recent"), b"{}").unwrap();
        fs::write(month.join(format!("{}.recent", "A".repeat(64))), b"{}").unwrap();
        fs::create_dir_all(s.recent().join("misc")).unwrap();
        fs::write(
            s.recent()
                .join("misc")
                .join(format!("{}.recent", random_key())),
            serde_json::to_vec(&Entry::new("quire", None, "x")).unwrap(),
        )
        .unwrap();
        let mut e = Entry::new("notepad", None, "x.txt");
        e.v = 1;
        fs::write(
            month.join(format!("{}.recent", random_key())),
            serde_json::to_vec(&e).unwrap(),
        )
        .unwrap();
        let list = s.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].0, key);
        assert!(s.set_preview(&key, b"<svg/>").is_err(), "not a JPEG");
        assert!(
            s.set_preview(&random_key(), &[0xFF, 0xD8, 0xFF]).is_err(),
            "no entry"
        );
        assert!(s.put("../x", &Entry::new("quire", None, "x")).is_err());
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn previous_versions_are_kept_as_hex_and_digits_and_pruned_by_count_age_and_size() {
        let s = scratch("versions");
        fs::create_dir_all(&s.root).unwrap();
        let file = s.root.join("Report (final).docx");
        let key = random_key();
        for i in 0..7u8 {
            fs::write(&file, [b'v', b'0' + i]).unwrap();
            s.keep_previous(&key, &file);
            std::thread::sleep(std::time::Duration::from_millis(3));
        }
        let list = s.versions(&key);
        assert_eq!(list.len(), VERSIONS_PER_FILE, "five a file");
        assert_eq!(s.version(&list[0].0).unwrap(), b"v6", "newest first");
        assert_eq!(s.version(&list[4].0).unwrap(), b"v2");
        for (id, _, _) in &list {
            assert!(version_time(id).is_some(), "{id}");
        }
        assert!(s.version("../x.1").is_err());
        // a month later they go
        s.prune_versions(now_ms() + KEEP_MS + 1000);
        assert!(s.versions(&key).is_empty());
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn a_failed_write_leaves_the_old_file() {
        let s = scratch("atomic");
        fs::create_dir_all(&s.root).unwrap();
        let file = s.root.join("config.json");
        write_atomic(&file, b"old").unwrap();
        // a folder in the way of the rename
        let blocked = s.root.join("blocked");
        fs::create_dir_all(blocked.join("x")).unwrap();
        assert!(write_atomic(&blocked, b"new").is_err());
        assert_eq!(fs::read(&file).unwrap(), b"old");
        assert_eq!(
            fs::read_dir(&s.root).unwrap().count(),
            2,
            "no temp file left"
        );
        let _ = fs::remove_dir_all(&s.root);
    }
}
