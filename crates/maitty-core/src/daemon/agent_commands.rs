//! Which slash commands and skills an agent takes on this machine (`Query::AgentCommands`). The
//! agent's own program is asked, so the answer is what this computer's installation, account,
//! plugins and the project's own files offer, not another computer's. Claude Code is asked for its
//! commands and skills, Codex for its skills. No message is sent, so no allowance is used.

use maitty_agent_ask::{claude, codex};
use maitty_shared::agent_commands::AgentCommand;
use maitty_shared::conversation::Provider;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// The agents that can be asked, by the name of their program. Gemini has no list to ask for.
fn program(agent: Provider) -> Option<&'static str> {
    match agent {
        Provider::Claude => Some("claude"),
        Provider::Codex => Some("codex"),
        Provider::Gemini => None,
    }
}

/// The folder the agent is started in: the one named when it is an absolute path to a folder that
/// exists, so the project's commands and skills are among those listed, and the home folder
/// otherwise. A client names only a folder an agent of the person's already runs in.
fn start_folder(typed: &str, home: Option<&Path>) -> Option<PathBuf> {
    let named = PathBuf::from(typed);
    if named.is_absolute() && named.is_dir() {
        return Some(named);
    }
    home.map(Path::to_path_buf)
}

/// The agent's program on `search`, the login PATH of this machine, or why there is none.
fn find_program(name: &str, search: Option<&OsStr>) -> Result<PathBuf, String> {
    let executable = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    search
        .and_then(|search| crate::shim::find_on_path(&executable, search, Path::new(""), &[]))
        .ok_or_else(|| format!("{name} is not installed on this machine"))
}

/// What `agent` takes in `folder` here. An agent that is not installed, or does not answer, is an
/// error that says so; nothing is guessed in its place.
pub(super) async fn answer(agent: Provider, folder: String) -> Result<Vec<AgentCommand>, String> {
    let search = crate::login_path::effective_path().or_else(|| std::env::var_os("PATH"));
    let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
    let start = tokio::task::spawn_blocking(move || start_folder(&folder, home.as_deref()))
        .await
        .map_err(|error| format!("the search for the folder stopped: {error}"))?
        .ok_or_else(|| "this machine has no home folder to start in".to_string())?;
    ask(agent, &start, search.as_deref()).await
}

async fn ask(agent: Provider, start: &Path, search: Option<&OsStr>) -> Result<Vec<AgentCommand>, String> {
    let Some(name) = program(agent) else {
        return Ok(Vec::new());
    };
    let executable = find_program(name, search)?;
    match agent {
        Provider::Claude => claude::ask_commands(&executable, start).await,
        _ => codex::ask_skills(&executable, start).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_starts_in_the_folder_named_when_it_exists_and_in_home_when_it_does_not() {
        let root = std::env::temp_dir();
        let home = Path::new(if cfg!(windows) { r"C:\Users\me" } else { "/home/me" });
        assert_eq!(start_folder(root.to_str().unwrap(), Some(home)), Some(root.clone()));
        assert_eq!(start_folder("relative/folder", Some(home)), Some(home.to_path_buf()));
        assert_eq!(start_folder(root.join("no-such-folder-here").to_str().unwrap(), Some(home)), Some(home.to_path_buf()));
        assert_eq!(start_folder("relative/folder", None), None);
    }

    #[test]
    fn a_missing_agent_is_said_not_guessed() {
        let nowhere = std::env::temp_dir().join("maitty-no-such-bin");
        let why = find_program("claude", Some(nowhere.as_os_str())).unwrap_err();
        assert_eq!(why, "claude is not installed on this machine");
        assert!(find_program("codex", None).is_err());
    }

    #[tokio::test]
    async fn gemini_has_no_list_and_a_machine_without_the_agent_says_so() {
        let nowhere = std::env::temp_dir().join("maitty-no-such-bin");
        assert_eq!(ask(Provider::Gemini, &std::env::temp_dir(), Some(nowhere.as_os_str())).await, Ok(Vec::new()));
        let why = ask(Provider::Codex, &std::env::temp_dir(), Some(nowhere.as_os_str())).await.unwrap_err();
        assert!(why.contains("codex is not installed"), "{why}");
    }

    /// A stand-in `claude` that answers the one `initialize` request the way Claude Code does.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_commands_are_the_ones_the_agent_on_this_machine_lists() {
        use std::os::unix::fs::PermissionsExt;
        let bin = std::env::temp_dir().join(format!("maitty-ask-commands-{}", std::process::id()));
        std::fs::create_dir_all(&bin).unwrap();
        let script = bin.join("claude");
        std::fs::write(
            &script,
            concat!(
                "#!/bin/sh\nread line\n",
                r#"printf '%s\n' '{"type":"control_response","response":{"request_id":"maitty-models","subtype":"success","response":{"commands":[{"name":"compact","description":"Summarize"},{"name":"pdf","description":"Reads PDFs","argumentHint":"<file>"}]}}}'"#,
                "\nsleep 5\n"
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let listed = ask(Provider::Claude, &std::env::temp_dir(), Some(bin.as_os_str())).await.unwrap();
        std::fs::remove_dir_all(&bin).unwrap();
        assert_eq!(listed.iter().map(|command| command.name.as_str()).collect::<Vec<_>>(), ["compact", "pdf"]);
        assert_eq!(listed[1].hint, "<file>");
    }
}
