//! Watching the open document so the window refreshes when it is saved.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use notify::event::{EventKind, ModifyKind};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// A single save can arrive as several filesystem events. Collapse anything that
/// lands within this window into one refresh.
const DEBOUNCE: Duration = Duration::from_millis(120);

/// Stops watching when dropped.
pub struct FileWatcher {
    _inner: RecommendedWatcher,
}

/// Call `on_change` whenever `file` is written.
///
/// The watch is registered on the containing directory, not on the file. Most
/// editors save by writing a temporary file and renaming it over the original,
/// which replaces the inode -- a watch on the file itself would follow the old
/// one and go quiet after the first save.
pub fn watch<F>(file: &Path, on_change: F) -> notify::Result<FileWatcher>
where
    F: Fn() + Send + 'static,
{
    let file = file.to_path_buf();
    let dir = file
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));

    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if changes_content(&event.kind) && event.paths.iter().any(|path| path == &file) {
                let _ = tx.send(());
            }
        }
    })?;
    watcher.watch(&dir, RecursiveMode::NonRecursive)?;

    thread::spawn(move || debounce_loop(rx, on_change));

    Ok(FileWatcher { _inner: watcher })
}

/// Did this event change what the file contains?
///
/// Reads have to be excluded or the watcher feeds itself: rendering opens the
/// file, inotify reports the access, and the refresh that follows opens it
/// again. Metadata is out for the same reason -- a permission bit is not a save.
fn changes_content(kind: &EventKind) -> bool {
    match kind {
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Any => true,
        EventKind::Modify(modify) => !matches!(modify, ModifyKind::Metadata(_)),
        EventKind::Access(_) | EventKind::Other => false,
    }
}

/// Wait for an event, swallow the rest of the burst, then fire once.
///
/// Ends when the sender is dropped, which happens when the watcher is.
fn debounce_loop<F: Fn()>(rx: Receiver<()>, on_change: F) {
    while rx.recv().is_ok() {
        loop {
            match rx.recv_timeout(DEBOUNCE) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
        on_change();
    }
}
