//! A diagram copied as a picture, kept on the clipboard after the window closes.
//!
//! On Wayland the clipboard does not hold a copy of anything. It holds a
//! promise from the program that copied, which is asked for the bytes when
//! someone pastes. A program that has exited cannot answer, so a diagram the
//! page copied and the reader pasted after Ctrl Q was simply gone -- unless a
//! clipboard manager had taken a copy, and the desktop mark is written for runs
//! none. WebKit copying on the page's behalf gave mark no way to know whether
//! its picture was still the one on the clipboard, and so no way to know
//! whether it was safe to leave.
//!
//! So on GTK the picture comes to Rust and goes on the clipboard from here, and
//! GTK says when another program takes the clipboard over, by dropping the
//! closure it was handed. `main.rs` asks `holding` on the way out, and while
//! the answer is yes it hides the window and stays -- the model wl-copy uses,
//! for the same reason. A separate, lighter process holding the picture would
//! be the obvious alternative and does not work: a Wayland compositor lets a
//! program take the clipboard only in answer to input it has just received, and
//! a process with no window receives none. mark has the click.
//!
//! Windows keeps whatever is put on its clipboard after the program that put it
//! there has gone, so there the page copies the picture itself, and `put` is
//! never called.

use std::cell::Cell;
use std::rc::Rc;

/// What the page reads off the shell to know who puts a copied diagram on the
/// clipboard: `mark`, through here, or the `webview`, through the page's own
/// clipboard API.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub const COPIED_BY: &str = "mark";

#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
pub const COPIED_BY: &str = "webview";

/// Which copy is on the clipboard, told apart from the ones before it.
///
/// Every copy replaces the one before, and GTK lets go of the old one while it
/// takes the new -- so "released" has to mean that the newest copy has gone,
/// not that some copy has. Kept apart from GTK so the rule can be tested with
/// no display to test it on.
#[derive(Default)]
struct Ownership {
    /// The copy on the clipboard now, or 0 for none.
    held: Cell<u64>,
    /// The last number given out.
    issued: Cell<u64>,
}

// Off GTK nothing claims, so only the tests would.
#[cfg_attr(
    not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )),
    allow(dead_code)
)]
impl Ownership {
    /// A number for a new copy, counted as the one on the clipboard from now.
    fn claim(&self) -> u64 {
        let copy = self.issued.get() + 1;
        self.issued.set(copy);
        self.held.set(copy);
        copy
    }

    /// The copy numbered `copy` has left the clipboard. True only when it was
    /// the newest, since only then is the clipboard no longer mark's.
    fn release(&self, copy: u64) -> bool {
        if self.held.get() != copy {
            return false;
        }
        self.held.set(0);
        true
    }

    fn holding(&self) -> bool {
        self.held.get() != 0
    }
}

pub struct Pictures {
    ownership: Rc<Ownership>,
}

impl Pictures {
    pub fn new() -> Self {
        Self {
            ownership: Rc::default(),
        }
    }

    /// Whether a picture copied from here is still the one on the clipboard.
    pub fn holding(&self) -> bool {
        self.ownership.holding()
    }

    /// Put a PNG on the clipboard. `released` runs when another program takes
    /// the clipboard over from it -- not when a later copy from here replaces
    /// it, which the numbering in `Ownership` tells apart.
    ///
    /// `image/png` is the one type offered. It is what every program that
    /// takes a picture from the clipboard asks for, and offering more would
    /// mean converting this one into each of them up front.
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    pub fn put(&self, png: Vec<u8>, released: impl Fn() + 'static) -> bool {
        use gtk::gdk;

        const PNG: &str = "image/png";

        // Claimed before GTK is asked, so that the copy this replaces finds
        // itself no longer the newest when GTK lets go of it inside the call.
        let copy = self.ownership.claim();
        let guard = Release {
            ownership: self.ownership.clone(),
            copy,
            released: Box::new(released),
        };

        let clipboard = gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD);
        let target = gtk::TargetEntry::new(PNG, gtk::TargetFlags::empty(), 0);
        clipboard.set_with_data(&[target], move |_, selection, _| {
            // Held here only to be dropped along with the closure. GTK frees it
            // when the clipboard stops being mark's, which is the one moment
            // worth hearing about, and it has no other way of saying so.
            let _ = &guard;
            selection.set(&gdk::Atom::intern(PNG), 8, &png);
        })
    }

    /// Never called off GTK: the page copies there, and says so to nobody.
    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    pub fn put(&self, _png: Vec<u8>, _released: impl Fn() + 'static) -> bool {
        false
    }
}

/// Dropped by GTK, along with the closure that holds it, when a copy leaves the
/// clipboard.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
struct Release {
    ownership: Rc<Ownership>,
    copy: u64,
    released: Box<dyn Fn()>,
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
impl Drop for Release {
    fn drop(&mut self) {
        if self.ownership.release(self.copy) {
            (self.released)();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A second copy replaces the first, and GTK lets go of the first while it
    /// does. Counting that as the clipboard being given up would end a mark
    /// that had closed its window while it still held the newest picture --
    /// the very thing the window was kept for.
    #[test]
    fn only_the_newest_copy_leaving_counts_as_release() {
        let ownership = Ownership::default();
        assert!(!ownership.holding());

        let first = ownership.claim();
        let second = ownership.claim();

        assert!(!ownership.release(first), "a replaced copy counted as release");
        assert!(ownership.holding(), "replacing a copy gave the clipboard up");

        assert!(ownership.release(second));
        assert!(!ownership.holding());
        assert!(!ownership.release(second), "the same copy released twice");
    }
}
