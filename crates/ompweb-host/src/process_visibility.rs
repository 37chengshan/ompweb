//! Cross-platform child-process visibility rules.
//!
//! OmpWeb's host, supervisor, settings and Git processes are all background
//! implementation details. On Windows console-subsystem binaries otherwise
//! allocate a new CMD window even though their stdio is piped or discarded.

use std::process::Command;

/// Prevent a background child from allocating a visible Windows console.
/// This does not affect the app's PTY-backed terminal: that terminal is
/// intentionally rendered inside the GUI and uses a different spawn path.
pub fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW — Windows SDK process creation flag.
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}
