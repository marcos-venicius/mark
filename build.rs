//! Compiles the icon into `mark.exe` as a Win32 resource.
//!
//! Cargo has no notion of resources, so without this the binary carries no icon
//! at all: Explorer, the taskbar and the Start Menu shortcut all fall back to
//! the generic one, and a file association would point at a blank page.
//!
//! `strip = true` in the release profile does not reach this -- it strips
//! symbols, and the resource section is not one.

fn main() {
    // Building for anything but Windows, this is a no-op: a resource section
    // means nothing to ELF, and `winresource` is not compiled at all on Linux
    // because Cargo.toml declares it only under `cfg(windows)`.
    //
    // The subtlety worth knowing: for a build dependency that `cfg` is matched
    // against the *host*, not the target. Cross-compiling to Windows from this
    // machine would therefore skip the crate and silently produce an .exe with
    // no icon. The Windows binary is built on a Windows runner, which is why
    // that never happens -- and the CI step that extracts the icon back out of
    // the .exe is there in case it ever does.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    println!("cargo:rerun-if-changed=assets/mark.ico");

    #[cfg(windows)]
    {
        let mut resource = winresource::WindowsResource::new();
        resource.set_icon("assets/mark.ico");
        // ProductName, FileDescription and the version come from Cargo.toml on
        // their own; these two have nowhere else to come from. They are what
        // the file's Properties dialog and the installer's publisher line show.
        resource.set("CompanyName", "Marcos Venicius");
        resource.set("LegalCopyright", "MIT licence");

        if let Err(error) = resource.compile() {
            // Failing the build would be the wrong trade: an .exe without an
            // icon still runs, and on a machine with no resource compiler this
            // is the difference between building and not.
            println!("cargo:warning=could not embed the icon: {error}");
        }
    }
}
