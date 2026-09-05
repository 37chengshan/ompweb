//! A process working directory has stricter Windows limits than file I/O.
//! Keep the authorized destination through a short, private junction when
//! CreateProcess cannot accept the original local path. Never run a user's
//! command in a fallback directory. UNC is entered by CMD's pushd bootstrap.
use std::path::PathBuf;

pub struct ShellCwd {
    pub path: PathBuf,
    pub unc: Option<String>,
    #[cfg(windows)]
    alias_parent: Option<PathBuf>,
}

impl ShellCwd {
    pub fn prepare(cwd: &str) -> std::io::Result<Self> {
        #[cfg(not(windows))]
        { Ok(Self { path: cwd.into(), unc: None }) }
        #[cfg(windows)]
        {
            use std::process::{Command, Stdio};
            use std::time::{Duration, Instant};
            let real = std::fs::canonicalize(cwd)?;
            let text = real.to_string_lossy();
            let plain = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{rest}")
            } else { text.strip_prefix(r"\\?\").unwrap_or(&text).to_string() };
            if plain.starts_with(r"\\") {
                return Ok(Self { path: system_directory(), unc: Some(plain), alias_parent: None });
            }
            if plain.encode_utf16().count() < 240 {
                return Ok(Self { path: plain.into(), unc: None, alias_parent: None });
            }
            let mut random = [0u8; 16];
            getrandom::getrandom(&mut random).map_err(|error| std::io::Error::other(error.to_string()))?;
            let suffix: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
            let parent = std::env::temp_dir().join(format!("ompweb-cwd-{suffix}"));
            std::fs::create_dir(&parent)?;
            let guard = Self { path: parent.join("cwd"), unc: None, alias_parent: Some(parent) };
            // Environment expansion avoids quoting a user path into shell
            // source. Delayed expansion is off so ! in filenames is literal.
            let mut command = Command::new("cmd.exe");
            command.args(["/d", "/v:off", "/s", "/c", "mklink /J \"%OMPWEB_CWD_ALIAS%\" \"%OMPWEB_CWD_TARGET%\""])
                .env("OMPWEB_CWD_ALIAS", &guard.path).env("OMPWEB_CWD_TARGET", &real)
                .current_dir(system_directory()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            crate::process_visibility::hide_console_window(&mut command);
            let mut child = command.spawn()?;
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(status) = child.try_wait()? {
                    if !status.success() { return Err(std::io::Error::other("Cannot create a temporary junction for this long workspace path. Choose a shorter writable workspace or temporary directory.")); }
                    break;
                }
                if Instant::now() >= deadline {
                    let _ = child.kill(); let _ = child.wait();
                    return Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Creating the workspace junction timed out"));
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            if std::fs::canonicalize(&guard.path)? != real {
                return Err(std::io::Error::other("Temporary workspace junction points to a different directory"));
            }
            Ok(guard)
        }
    }
}

#[cfg(windows)]
fn system_directory() -> PathBuf {
    std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
}

#[cfg(windows)]
impl Drop for ShellCwd {
    fn drop(&mut self) {
        if let Some(parent) = &self.alias_parent {
            // Remove the junction itself, never recursively visit its target.
            let _ = std::fs::remove_dir(&self.path);
            let _ = std::fs::remove_dir(parent);
        }
    }
}
