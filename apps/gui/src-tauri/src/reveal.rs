//! Showing a file or folder of this computer in its file manager (Explorer, Finder, or the
//! default file manager on Linux). The path comes from the window, so it is checked first: it must
//! be an absolute path to something that exists. It is passed to the program as an argument,
//! never through a shell.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The file manager's program and its arguments.
#[derive(Debug, PartialEq, Eq)]
struct Launch {
    program: &'static str,
    args: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum System {
    Windows,
    Mac,
    Other,
}

const THIS_OS: System = if cfg!(windows) {
    System::Windows
} else if cfg!(target_os = "macos") {
    System::Mac
} else {
    System::Other
};

/// The path the window named, when it can be revealed: absolute, free of control characters (and
/// of `"` on Windows, where it cannot occur in a name and would break out of Explorer's quoting),
/// and present.
fn checked_path(text: &str, os: System) -> Result<PathBuf, String> {
    if text.is_empty() || text.chars().any(char::is_control) {
        return Err("That is not a path.".to_string());
    }
    if os == System::Windows && text.contains('"') {
        return Err("That is not a path.".to_string());
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err("Give the full path.".to_string());
    }
    if !path.exists() {
        return Err(format!("{text} is no longer there."));
    }
    Ok(path)
}

fn launch_for(os: System, path: &Path) -> Launch {
    match os {
        System::Windows => Launch {
            program: "explorer.exe",
            args: vec![format!("/select,\"{}\"", path.to_string_lossy().replace('/', "\\"))],
        },
        System::Mac => Launch {
            program: "open",
            args: vec!["-R".to_string(), path.to_string_lossy().into_owned()],
        },
        System::Other => Launch {
            program: "xdg-open",
            args: vec![path.parent().unwrap_or(path).to_string_lossy().into_owned()],
        },
    }
}

fn spawn(launch: &Launch) -> Result<(), String> {
    let mut command = Command::new(launch.program);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Explorer parses `/select,"path"` itself, so the argument is passed as written, not
        // quoted again by the runtime; the path was checked to hold no `"`.
        for arg in &launch.args {
            command.raw_arg(arg);
        }
    }
    #[cfg(not(windows))]
    command.args(&launch.args);
    command
        .spawn()
        .map(|mut child| {
            // Reaped so no zombie is left; the status is not read because explorer.exe exits 1
            // even when it showed the file.
            std::thread::spawn(move || child.wait().map(drop));
        })
        .map_err(|error| format!("Could not open the file manager ({}): {error}", launch.program))
}

/// Show `path` in the file manager. Local paths only. Rejects with the reason.
#[tauri::command]
pub async fn reveal_in_explorer(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = checked_path(&path, THIS_OS)?;
        spawn(&launch_for(THIS_OS, &path))
    })
    .await
    .map_err(|error| format!("Could not open the file manager: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blank_relative_control_or_missing_path_is_refused() {
        for bad in ["", "relative/file", "/a\nb", "\u{7}"] {
            assert!(checked_path(bad, System::Other).is_err(), "{bad:?}");
        }
        let gone = std::env::temp_dir().join("reveal-no-such-file-here");
        assert!(checked_path(&gone.to_string_lossy(), System::Other).unwrap_err().contains("no longer there"));
    }

    #[test]
    fn a_path_that_exists_is_accepted() {
        let here = std::env::temp_dir();
        assert_eq!(checked_path(&here.to_string_lossy(), System::Other), Ok(here));
    }

    #[test]
    fn a_quote_in_a_windows_path_is_refused_because_it_could_end_explorers_quoting() {
        assert!(checked_path("C:\\a\"b", System::Windows).is_err());
    }

    #[test]
    fn each_system_gets_its_own_program_with_the_path_as_an_argument() {
        let path = Path::new("/home/me/my project/file.txt");
        let mac = launch_for(System::Mac, path);
        assert_eq!((mac.program, mac.args.as_slice()), ("open", ["-R".to_string(), path.to_string_lossy().into_owned()].as_slice()));
        let linux = launch_for(System::Other, path);
        assert_eq!(linux.program, "xdg-open");
        assert_eq!(linux.args, [path.parent().unwrap().to_string_lossy().into_owned()]);
        let windows = launch_for(System::Windows, Path::new("C:/Users/me/my project"));
        assert_eq!(windows.program, "explorer.exe");
        assert_eq!(windows.args, ["/select,\"C:\\Users\\me\\my project\""]);
    }
}
