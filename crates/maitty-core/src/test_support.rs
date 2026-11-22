use crate::conversation::{
    Conversation, ConversationId, ExecutionKind, NativeBinding, Provider, RecoveryState,
};

pub(crate) fn conversation() -> Conversation {
    Conversation {
        id: ConversationId(1),
        binding: NativeBinding {
            agent: None,
            provider: Provider::Codex,
            session_id: "exact-session".into(),
            account: Some("work".into()),
            profile: Some("native-profile".into()),
            config_root: std::env::temp_dir().join("synthetic-config"),
            executable: std::env::temp_dir().join("synthetic-codex.exe"),
            cwd: std::env::temp_dir().join("synthetic-repo"),
            worktree: Some(std::env::temp_dir().join("synthetic-tree")),
        },
        execution: ExecutionKind::Structured,
        generation: 7,
        state: RecoveryState::Stopped,
        settings: None,
        awaiting_first_user_message: false,
        title: None,
        archived: false,
        worktree_origin: None,
    }
}

/// Writes a program a test runs and makes it runnable. On Unix a child process writes it: written by the test's own
/// process, the open file can be inherited by a program another test thread starts at that moment, and running the
/// new one then fails with "text file busy", which made tests fail now and then. Elsewhere it is written directly.
pub(crate) fn write_program(path: &std::path::Path, script: &str) {
    #[cfg(unix)]
    {
        use std::io::Write;
        let mut writer = std::process::Command::new("sh")
            .args(["-c", "cat > \"$1\" && chmod 755 \"$1\"", "sh"])
            .arg(path)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        writer.stdin.take().unwrap().write_all(script.as_bytes()).unwrap();
        assert!(writer.wait().unwrap().success(), "writing {}", path.display());
    }
    #[cfg(not(unix))]
    std::fs::write(path, script).unwrap();
}

/// A copy of the program `from` at `to`, for a test to run. On Unix another process makes it, for the reason
/// `write_program` gives; elsewhere it is copied directly.
pub(crate) fn copy_program(from: &std::path::Path, to: &std::path::Path) {
    #[cfg(unix)]
    {
        let copied = std::process::Command::new("cp").arg(from).arg(to).status().unwrap();
        assert!(copied.success(), "copying {} to {}", from.display(), to.display());
    }
    #[cfg(not(unix))]
    std::fs::copy(from, to).unwrap();
}

/// Points the data folder at a scratch one for this test binary: panes write launchers and
/// startup files there (Linux honours `XDG_DATA_HOME`), and tests leave the real one alone. Every
/// daemon test uses the same one, so two cannot disagree. It lives as long as the process, so it
/// is removed when the process exits.
pub(crate) fn own_data_folder() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        // SAFETY: the first thing a daemon test does, before the panes it starts read the environment.
        unsafe { std::env::set_var("XDG_DATA_HOME", data_folder()) };
        // SAFETY: registers a plain function that takes nothing; libc runs it once at exit.
        #[cfg(unix)]
        unsafe {
            libc::atexit(remove_data_folder);
        }
    });
}

fn data_folder() -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        concat!(env!("APP_COMMAND"), "-test-data-{}"),
        std::process::id()
    ))
}

#[cfg(unix)]
extern "C" fn remove_data_folder() {
    let _ = std::fs::remove_dir_all(data_folder());
}

/// This test binary, for a test that runs it again as a stand-in process. On Linux it is the running
/// image itself, so a build that replaces the file on disk meanwhile cannot change what runs; a
/// replaced test binary had different tests in it and the stand-in failed.
pub(crate) fn this_test_binary() -> std::path::PathBuf {
    if cfg!(target_os = "linux") {
        std::path::PathBuf::from("/proc/self/exe")
    } else {
        std::env::current_exe().unwrap()
    }
}
