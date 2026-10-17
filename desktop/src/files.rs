//! Writing a user's file (todos/DESKTOP_REAL_SAVE.md, Phase 2, The write): one function for every write, a
//! window's own file (Save) or the one its Save dialog just picked (Save As, exports). The checks first; the version
//! on disk kept (store.rs, previous versions); the bytes into a temp file beside it, synced; then the replace, which
//! keeps the file's permissions, attributes and streams. A failed save leaves the file as it was, byte for byte.

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::{store, types::Kind};

/// The largest file a window saves (and opens).
pub const MAX_FILE: u64 = 512 << 20;

/// A name Windows keeps for a device, whatever follows its first dot (`CON.docx`, `com1.backup.xlsx`), so the
/// file couldn't be opened there, even when saved elsewhere.
pub fn reserved(stem: &str) -> bool {
    let base = stem
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_ascii_uppercase();
    let digit = |s: &str| {
        let mut c = s.chars();
        matches!(
            (c.next(), c.next()),
            (Some('0'..='9' | '¹' | '²' | '³'), None)
        )
    };
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"]
            .iter()
            .any(|d| base.strip_prefix(d).is_some_and(digit))
}

/// Why a save failed, for the page to act on (`code`), with a message that names the file but holds no path.
#[derive(Serialize, Debug, PartialEq)]
pub struct SaveError {
    pub code: &'static str,
    pub message: String,
    /// the file's name, for the page's own words (`open-elsewhere`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<String>,
}

pub fn fail(code: &'static str, message: impl Into<String>) -> SaveError {
    SaveError {
        code,
        message: message.into(),
        file: None,
    }
}

/// The version of a file a window read or last wrote: a Save over a file changed since asks first (`changed`).
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct Base {
    size: u64,
    mtime: u64,
    /// the file's inode (Unix); Windows' file index isn't in stable Rust
    id: u64,
}

pub fn base_of(meta: &fs::Metadata) -> Base {
    #[cfg(unix)]
    let id = std::os::unix::fs::MetadataExt::ino(meta);
    #[cfg(not(unix))]
    let id = 0;
    Base {
        size: meta.len(),
        mtime: meta.modified().map(store::ms).unwrap_or(0),
        id,
    }
}

impl Base {
    /// What a Recent Files entry says of its file (no inode).
    pub fn of_entry(size: u64, mtime: u64) -> Base {
        Base { size, mtime, id: 0 }
    }

    fn same(&self, now: &Base) -> bool {
        self.size == now.size && self.mtime == now.mtime && (self.id == 0 || self.id == now.id)
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn mtime(&self) -> u64 {
        self.mtime
    }
}

/// Whether a file is read-only for this app: its read-only attribute (Windows), or no write access (elsewhere).
pub fn read_only(path: &Path) -> bool {
    #[cfg(windows)]
    {
        fs::metadata(path).is_ok_and(|m| m.permissions().readonly())
    }
    #[cfg(not(windows))]
    {
        matches!(
            fs::OpenOptions::new().write(true).open(path),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied
        )
    }
}

fn name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// What an IO error means for the user, as a code.
fn coded(path: &Path, e: io::Error) -> SaveError {
    let n = name(path);
    #[cfg(windows)]
    if matches!(e.raw_os_error(), Some(32 | 33 | 1224)) {
        return fail("busy", format!("“{n}” is open in another program."));
    }
    match e.kind() {
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => {
            fail("denied", format!("VibeOffice can't save “{n}”: {e}"))
        }
        io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded => {
            fail("full", format!("There isn't enough space to save “{n}”."))
        }
        io::ErrorKind::ResourceBusy => fail("busy", format!("“{n}” is open in another program.")),
        io::ErrorKind::NotFound => fail("missing", format!("“{n}” is no longer where it was.")),
        _ => fail("io", format!("“{n}” couldn't be saved: {e}")),
    }
}

/// How a write treats what is on disk.
pub enum Over {
    /// the window's own file, as it was when read or last written (`changed` otherwise; `missing` if gone)
    Unchanged(Base),
    /// the window's own file, whatever it is now (the user answered `changed` with Replace It)
    Anything,
    /// what the Save dialog picked: it asked before replacing an existing file
    Chosen,
}

/// Writes `bytes` to `path` as `kind`, keeping the version on disk first (`keep`). The new version's `Base`.
pub fn write(
    path: &Path,
    kind: &Kind,
    bytes: &[u8],
    over: Over,
    keep: impl FnOnce(&Path),
) -> Result<Base, SaveError> {
    let n = name(path);
    if bytes.len() as u64 > MAX_FILE {
        return Err(fail("too-large", format!("“{n}” would be over 512 MB.")));
    }
    let ext = crate::types::ext(path).unwrap_or_default();
    if !kind.exts.contains(&ext.as_str()) || !kind.magic.matches(bytes) {
        return Err(fail(
            "type",
            format!("“{n}” isn't a {} file.", kind.exts[0]),
        ));
    }
    let existing = match fs::symlink_metadata(path) {
        Ok(m) if !m.is_file() => {
            return Err(fail(
                "denied",
                format!("“{n}” isn't a file VibeOffice can save over."),
            ))
        }
        Ok(m) => Some(m),
        Err(e) if e.kind() == io::ErrorKind::NotFound => None,
        Err(e) => return Err(coded(path, e)),
    };
    match (&over, &existing) {
        (Over::Unchanged(_) | Over::Anything, None) => {
            return Err(fail(
                "missing",
                format!("“{n}” is no longer where it was: it was moved, renamed or deleted."),
            ))
        }
        (Over::Unchanged(base), Some(m)) if !base.same(&base_of(m)) => {
            return Err(fail(
                "changed",
                format!("“{n}” was changed by another program after you opened it."),
            ))
        }
        _ => {}
    }
    if existing
        .as_ref()
        .is_some_and(|m| m.permissions().readonly())
    {
        return Err(fail(
            "denied",
            format!("VibeOffice can't save “{n}”: it is read-only."),
        ));
    }
    if existing.is_some() {
        keep(path);
    }
    replace(path, bytes, existing.as_ref()).map_err(|e| coded(path, e))?;
    fs::metadata(path)
        .map(|m| base_of(&m))
        .map_err(|e| coded(path, e))
}

/// A temp file's name beside the user's: no part of the user's name, hidden on Unix by its dot.
#[cfg(not(target_os = "macos"))]
fn temp_beside(path: &Path) -> io::Result<PathBuf> {
    let dir = path.parent().ok_or_else(|| io::Error::other("no folder"))?;
    Ok(dir.join(format!(".~vibeoffice-{}.tmp", &store::random_key()[..16])))
}

fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    f.write_all(bytes)?;
    f.sync_all()
}

/// Puts `bytes` at `path`: a temp file beside it, renamed over it (Unix), or replaced into it (Windows). Where a
/// rename would lose something (a folder this user can't write, another owner, other hard links) the file is
/// written in place, its old bytes put back if that fails.
#[cfg(all(unix, not(target_os = "macos")))]
fn replace(path: &Path, bytes: &[u8], existing: Option<&fs::Metadata>) -> io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let tmp = temp_beside(path)?;
    let made = write_new(&tmp, bytes);
    let in_place = match (&made, existing) {
        (Err(e), Some(_)) if e.kind() == io::ErrorKind::PermissionDenied => true,
        (Err(_), _) => {
            let _ = fs::remove_file(&tmp);
            return made;
        }
        (Ok(()), Some(old)) => {
            let ours = fs::metadata(&tmp)?;
            old.nlink() > 1 || old.uid() != ours.uid()
        }
        (Ok(()), None) => false,
    };
    if in_place {
        let _ = fs::remove_file(&tmp);
        return write_in_place(path, bytes);
    }
    let done = (|| {
        if let Some(old) = existing {
            fs::set_permissions(&tmp, fs::Permissions::from_mode(old.permissions().mode()))?;
        }
        fs::rename(&tmp, path)?;
        if let Some(dir) = path.parent() {
            let _ = fs::File::open(dir).and_then(|d| d.sync_all());
        }
        Ok(())
    })();
    if done.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    done
}

#[cfg(all(unix, not(target_os = "macos")))]
fn write_in_place(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let old = store::read_file(path, MAX_FILE)?;
    let put = |b: &[u8]| -> io::Result<()> {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(path)?;
        f.write_all(b)?;
        f.sync_all()
    };
    put(bytes).inspect_err(|_| {
        let _ = put(&old);
    })
}

/// Windows: `ReplaceFileW` keeps the file's ACL, attributes and streams (its Mark of the Web among them); a new
/// file is moved into place. A file another program holds is tried again a few times (virus scanners let go soon).
#[cfg(windows)]
fn replace(path: &Path, bytes: &[u8], existing: Option<&fs::Metadata>) -> io::Result<()> {
    use windows::{
        core::{HSTRING, PCWSTR},
        Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN,
            MOVEFILE_WRITE_THROUGH, REPLACEFILE_IGNORE_MERGE_ERRORS,
        },
    };
    let tmp = temp_beside(path)?;
    if let Err(e) = write_new(&tmp, bytes) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    let (to, from) = (
        HSTRING::from(path.as_os_str()),
        HSTRING::from(tmp.as_os_str()),
    );
    let _ = unsafe { SetFileAttributesW(&from, FILE_ATTRIBUTE_HIDDEN) };
    let mut tries = 0;
    let done = loop {
        let r = if existing.is_some() {
            unsafe {
                ReplaceFileW(
                    &to,
                    &from,
                    PCWSTR::null(),
                    REPLACEFILE_IGNORE_MERGE_ERRORS,
                    None,
                    None,
                )
            }
        } else {
            unsafe { MoveFileExW(&from, &to, MOVEFILE_WRITE_THROUGH) }
        };
        match r {
            Ok(()) => break Ok(()),
            Err(e) => {
                let e = io::Error::from_raw_os_error(e.code().0 & 0xFFFF);
                tries += 1;
                if tries < 5 && matches!(e.raw_os_error(), Some(32 | 33 | 1224 | 1175 | 1176)) {
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    continue;
                }
                break Err(e);
            }
        }
    };
    if done.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    done
}

/// macOS: the sandbox grants the file, not its folder, so no temp file can go beside it. The bytes go to the item
/// replacement folder for it (same volume) and `replaceItemAtURL:` swaps them in, as NSDocument's safe save does,
/// keeping the file's attributes; a new file the Save panel granted is written where it is.
#[cfg(target_os = "macos")]
fn replace(path: &Path, bytes: &[u8], existing: Option<&fs::Metadata>) -> io::Result<()> {
    use objc2_foundation::{
        NSFileManager, NSFileManagerItemReplacementOptions, NSSearchPathDirectory,
        NSSearchPathDomainMask, NSString, NSURL,
    };
    if existing.is_none() {
        return write_new(path, bytes);
    }
    let err = |e: objc2::rc::Retained<objc2_foundation::NSError>| {
        io::Error::other(e.localizedDescription().to_string())
    };
    let fm = NSFileManager::defaultManager();
    let target = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    let dir = fm
        .URLForDirectory_inDomain_appropriateForURL_create_error(
            NSSearchPathDirectory::ItemReplacementDirectory,
            NSSearchPathDomainMask::UserDomainMask,
            Some(&target),
            true,
        )
        .map_err(err)?;
    let dir_path = PathBuf::from(dir.path().map(|p| p.to_string()).unwrap_or_default());
    let tmp = dir_path.join(path.file_name().unwrap_or_default());
    let done = write_new(&tmp, bytes).and_then(|()| {
        let new = NSURL::fileURLWithPath(&NSString::from_str(&tmp.to_string_lossy()));
        fm.replaceItemAtURL_withItemAtURL_backupItemName_options_resultingItemURL_error(
            &target,
            &new,
            None,
            NSFileManagerItemReplacementOptions::empty(),
            None,
        )
        .map_err(err)
    });
    let _ = fs::remove_dir_all(&dir_path);
    done
}

/// Windows: a copy keeps the Mark of the Web of the file it was saved from (its `Zone.Identifier` stream), so Office
/// still opens it in Protected View. Elsewhere nothing to do: macOS marks what a sandboxed app writes itself.
pub fn carry_mark(from: &Path, to: &Path) {
    #[cfg(windows)]
    {
        let stream = |p: &Path| {
            let mut s = p.as_os_str().to_owned();
            s.push(":Zone.Identifier");
            PathBuf::from(s)
        };
        if let Ok(mark) = store::read_file(&stream(from), 64 << 10) {
            let _ = fs::write(stream(to), mark);
        }
    }
    #[cfg(not(windows))]
    let _ = (from, to);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::kind;

    #[test]
    fn names_windows_keeps_for_devices() {
        for name in [
            "CON",
            "con",
            "Nul",
            "aux ",
            "COM1",
            "lpt9.backup",
            "COM¹",
            "LPT³",
        ] {
            assert!(reserved(name), "{name}");
        }
        for name in ["CONTRACT", "COM10", "Console", "LPT", "nul-and-void"] {
            assert!(!reserved(name), "{name}");
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("vo-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn base(path: &Path) -> Base {
        base_of(&fs::metadata(path).unwrap())
    }

    const DOCX: &[u8] = b"PK\x03\x04 new";

    #[test]
    fn a_save_replaces_the_file_whole_and_keeps_what_was_there() {
        let dir = scratch("save");
        let file = dir.join("Report.docx");
        fs::write(&file, b"PK\x03\x04 old").unwrap();
        let docx = kind("quire", "docx").unwrap();
        let mut kept = None;
        let b = write(&file, docx, DOCX, Over::Unchanged(base(&file)), |p| {
            kept = Some(fs::read(p).unwrap())
        })
        .unwrap();
        assert_eq!(fs::read(&file).unwrap(), DOCX);
        assert_eq!(
            kept.as_deref(),
            Some(&b"PK\x03\x04 old"[..]),
            "the version before, kept first"
        );
        assert_eq!(b, base(&file));
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1, "no temp file left");
        // a new file the dialog picked
        let new = dir.join("Copy.docx");
        write(&new, docx, DOCX, Over::Chosen, |_| {
            panic!("nothing to keep")
        })
        .unwrap();
        assert_eq!(fs::read(&new).unwrap(), DOCX);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_refuses_what_it_shouldnt_write_and_leaves_the_file() {
        let dir = scratch("refuse");
        let file = dir.join("Report.docx");
        fs::write(&file, b"PK\x03\x04 old").unwrap();
        let before = base(&file);
        let docx = kind("quire", "docx").unwrap();
        let code = |r: Result<Base, SaveError>| r.unwrap_err().code;
        assert_eq!(
            code(write(&file, docx, b"# text", Over::Anything, |_| {})),
            "type",
            "bytes of another type"
        );
        assert_eq!(
            code(write(&dir.join("x.md"), docx, DOCX, Over::Chosen, |_| {})),
            "type",
            "another extension"
        );
        assert_eq!(
            code(write(
                &file,
                kind("ledger", "xlsx").unwrap(),
                DOCX,
                Over::Anything,
                |_| {}
            )),
            "type"
        );
        // another program saved it meanwhile
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&file, b"PK\x03\x04 theirs").unwrap();
        assert_eq!(
            code(write(&file, docx, DOCX, Over::Unchanged(before), |_| {})),
            "changed"
        );
        assert_eq!(fs::read(&file).unwrap(), b"PK\x03\x04 theirs");
        write(&file, docx, DOCX, Over::Anything, |_| {}).unwrap();
        // gone
        let gone = dir.join("Gone.docx");
        assert_eq!(
            code(write(&gone, docx, DOCX, Over::Anything, |_| {})),
            "missing"
        );
        assert!(!gone.exists(), "never made again silently");
        // a folder in its place
        fs::create_dir(dir.join("Folder.docx")).unwrap();
        assert_eq!(
            code(write(
                &dir.join("Folder.docx"),
                docx,
                DOCX,
                Over::Chosen,
                |_| {}
            )),
            "denied"
        );
        // read-only, in a folder that is not
        let ro = dir.join("ReadOnly.docx");
        fs::write(&ro, b"PK\x03\x04 ro").unwrap();
        let mut p = fs::metadata(&ro).unwrap().permissions();
        p.set_readonly(true);
        fs::set_permissions(&ro, p).unwrap();
        assert_eq!(
            code(write(&ro, docx, DOCX, Over::Unchanged(base(&ro)), |_| {})),
            "denied"
        );
        assert_eq!(fs::read(&ro).unwrap(), b"PK\x03\x04 ro");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&file, dir.join("Link.docx")).unwrap();
            assert_eq!(
                code(write(
                    &dir.join("Link.docx"),
                    docx,
                    DOCX,
                    Over::Chosen,
                    |_| {}
                )),
                "denied",
                "a link"
            );
        }
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert!(
            !names.iter().any(|n| n.to_string_lossy().ends_with(".tmp")),
            "{names:?}"
        );
        let mut p = fs::metadata(&ro).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        p.set_readonly(false);
        fs::set_permissions(&ro, p).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn a_file_in_a_folder_this_user_cant_write_is_saved_in_place() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("inplace");
        let sub = dir.join("locked");
        fs::create_dir(&sub).unwrap();
        let file = sub.join("Budget.csv");
        fs::write(&file, "a,b\n").unwrap();
        fs::set_permissions(&sub, fs::Permissions::from_mode(0o555)).unwrap();
        let writable = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(sub.join("probe"))
            .is_ok();
        if !writable {
            let csv = kind("ledger", "csv").unwrap();
            write(
                &file,
                csv,
                b"a,b\n1,2\n",
                Over::Unchanged(base(&file)),
                |_| {},
            )
            .unwrap();
            assert_eq!(fs::read(&file).unwrap(), b"a,b\n1,2\n");
        } // else running as root, which writes in any folder: nothing to see
        fs::set_permissions(&sub, fs::Permissions::from_mode(0o755)).unwrap();
        fs::remove_dir_all(&dir).unwrap();
    }
}
