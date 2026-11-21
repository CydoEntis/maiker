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
