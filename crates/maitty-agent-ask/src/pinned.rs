//! Checking the window's hand-pinned command lists against the agent installed on this computer.
//! Claude Code and Codex list the commands that work without a screen, but not the ones that open a
//! menu or a page of their own, so the window pins those by hand
//! (`apps/gui/src/features/chat/terminalCommands.ts`, `codexCommands.ts`). A pinned list drifts when
//! an agent drops or adds a command. This reads the pinned lists from those files and judges them
//! against the installed agent; the runs that need one installed are `#[ignore]`d tests (see
//! `docs/TESTING.md`, *Agent command lists*).

/// The names a pinned list defines: the first string of each `helper('name', ...)` call.
pub fn pinned_names(source: &str, helpers: &[&str]) -> Vec<String> {
    let mut names = Vec::new();
    for line in source.lines() {
        let line = line.trim_start();
        for helper in helpers {
            let Some(rest) = line.strip_prefix(helper).and_then(|rest| rest.strip_prefix('(')) else { continue };
            if let Some(name) = first_string(rest) {
                names.push(name);
            }
        }
    }
    names
}

/// The text of the string literal (single or double quoted) that opens `text`.
fn first_string(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let quote = chars.next().filter(|c| matches!(c, '\'' | '"'))?;
    let mut out = String::new();
    let mut escaped = false;
    for c in chars {
        match (escaped, c) {
            (true, c) => {
                out.push(c);
                escaped = false;
            }
            (false, '\\') => escaped = true,
            (false, c) if c == quote => return Some(out),
            (false, c) => out.push(c),
        }
    }
    None
}

/// The version a source file pins: `export const <constant> = '2.1.325'`.
pub fn pinned_version(source: &str, constant: &str) -> Option<String> {
    let line = source.lines().find(|line| line.contains(&format!("const {constant}")))?;
    first_string(line.split_once('=')?.1.trim())
}

/// The first `x.y.z` in what an agent prints for `--version`.
pub fn version_in(printed: &str) -> Option<String> {
    printed
        .split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|word| word.split('.').count() == 3 && word.split('.').all(|part| !part.is_empty() && part.parse::<u32>().is_ok()))
        .map(str::to_string)
}

/// Whether version `installed` is later than `pinned`; false when either is not `x.y.z`.
pub fn is_newer(installed: &str, pinned: &str) -> bool {
    let parts = |version: &str| version.split('.').map(str::parse::<u32>).collect::<Result<Vec<_>, _>>().ok();
    matches!((parts(installed), parts(pinned)), (Some(installed), Some(pinned)) if installed > pinned)
}

/// The words Claude Code answers a command it knows but only its terminal runs, in `-p` mode, with
/// no model asked. A command it does not know is sent to the model as a message instead.
const KNOWN_BUT_TERMINAL_ONLY: &str = "isn't available in this environment";

/// Whether the `result` of `claude -p "/<name>"` says Claude Code knows the command as one only its
/// terminal runs.
pub fn claude_knows(result: &str) -> bool {
    result.contains(KNOWN_BUT_TERMINAL_ONLY)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = r#"
const only = (name: string) => ({ name })
export const CLAUDE_COMMANDS_PINNED_FOR = '2.1.325'
export const LIST = [
  only('add-dir', 'Add a new working directory', '<path>'),
  only('copy', "Copy Claude's last response"),
  only("quoted", 'x'),
  said('clear', 'Clear'),
]
"#;

    #[test]
    fn the_pinned_names_are_read_from_the_helper_calls() {
        assert_eq!(pinned_names(SOURCE, &["only"]), ["add-dir", "copy", "quoted"]);
        assert_eq!(pinned_names(SOURCE, &["only", "said"]), ["add-dir", "copy", "quoted", "clear"]);
        assert!(pinned_names("nothing here", &["only"]).is_empty());
    }

    #[test]
    fn the_pinned_version_is_the_one_constant_names() {
        assert_eq!(pinned_version(SOURCE, "CLAUDE_COMMANDS_PINNED_FOR"), Some("2.1.325".into()));
        assert_eq!(pinned_version(SOURCE, "CODEX_COMMANDS_PINNED_FOR"), None);
    }

    #[test]
    fn a_version_is_found_in_what_the_agent_prints_and_compared_by_number() {
        assert_eq!(version_in("2.1.326 (Claude Code)"), Some("2.1.326".into()));
        assert_eq!(version_in("codex-cli 0.166.0"), Some("0.166.0".into()));
        assert_eq!(version_in("no version"), None);
        assert!(is_newer("2.1.326", "2.1.325") && is_newer("0.170.0", "0.99.0"));
        assert!(!is_newer("2.1.325", "2.1.325") && !is_newer("0.166.0", "0.167.0") && !is_newer("x", "1.0.0"));
    }

    #[test]
    fn only_the_terminal_only_answer_means_the_command_still_exists() {
        assert!(claude_knows("/release-notes isn't available in this environment."));
        assert!(!claude_knows("Not logged in · Please run /login"));
        assert!(!claude_knows("Unknown command: /gone"));
    }
}

/// The runs against the agents installed on this computer: `cargo test -p maitty-agent-ask --
/// --ignored`. Each is skipped, saying so, when the agent is not installed, and fails naming the
/// command when the installed agent no longer matches the pinned list.
#[cfg(test)]
mod installed {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    const CLAUDE_LIST: &str = "../../apps/gui/src/features/chat/terminalCommands.ts";
    const CODEX_LIST: &str = "../../apps/gui/src/features/chat/codexCommands.ts";
    const PROBE_LIMIT: Duration = Duration::from_secs(60);

    fn source(relative: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("cannot read {}: {error}", path.display()))
    }

    fn on_path(program: &str) -> Option<PathBuf> {
        let name = if cfg!(windows) { format!("{program}.exe") } else { program.to_string() };
        std::env::split_paths(&std::env::var_os("PATH")?).map(|directory| directory.join(&name)).find(|file| file.is_file())
    }

    /// Runs `command` and returns what it printed, or why it did not finish in `PROBE_LIMIT`.
    fn printed(mut command: Command) -> Result<String, String> {
        let child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|error| error.to_string())?;
        let (tell, wait) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tell.send(child.wait_with_output());
        });
        match wait.recv_timeout(PROBE_LIMIT) {
            Ok(Ok(output)) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => Err(format!("no answer in {} seconds", PROBE_LIMIT.as_secs())),
        }
    }

    fn installed_version(executable: &Path) -> Option<String> {
        let mut command = Command::new(executable);
        command.arg("--version");
        version_in(&printed(command).ok()?)
    }

    /// Claude Code's `result` for `/<name>` typed as a one-off prompt, in an empty folder and an
    /// empty config folder of its own, so neither this person's files nor account is touched. A
    /// command it knows only the terminal runs is answered at once, without the model.
    fn claude_result(executable: &Path, name: &str, folder: &Path) -> Result<String, String> {
        let mut command = Command::new(executable);
        command
            .args(["-p", &format!("/{name}"), "--output-format", "json"])
            .current_dir(folder)
            .env("CLAUDE_CONFIG_DIR", folder.join("config"))
            .env_remove("CLAUDECODE");
        let reply: serde_json::Value = serde_json::from_str(&printed(command)?).map_err(|error| error.to_string())?;
        Ok(reply.get("result").and_then(serde_json::Value::as_str).unwrap_or_default().to_string())
    }

    #[test]
    #[ignore = "needs Claude Code installed; run with --ignored"]
    fn installed_claude_still_takes_every_pinned_command() {
        let Some(executable) = on_path("claude") else {
            eprintln!("skipped: Claude Code is not installed here");
            return;
        };
        let list = source(CLAUDE_LIST);
        let names = pinned_names(&list, &["only"]);
        assert!(names.len() > 10, "found only {} pinned commands in {CLAUDE_LIST}: has its format changed?", names.len());
        let pinned = pinned_version(&list, "CLAUDE_COMMANDS_PINNED_FOR").expect("terminalCommands.ts must pin CLAUDE_COMMANDS_PINNED_FOR");
        let installed = installed_version(&executable).expect("claude --version printed no version");
        let folder = std::env::temp_dir().join(format!("maitty-pinned-claude-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let gone: Vec<String> = names
            .iter()
            .filter(|name| !claude_knows(&claude_result(&executable, name, &folder).unwrap_or_else(|error| panic!("could not ask Claude Code about /{name}: {error}"))))
            .cloned()
            .collect();
        let _ = std::fs::remove_dir_all(&folder);
        if is_newer(&installed, &pinned) {
            eprintln!("note: the pinned list is for Claude Code {pinned}; {installed} is installed. Commands it added since are not found by this check.");
        }
        assert!(
            gone.is_empty(),
            "Claude Code {installed} no longer takes these pinned commands (pinned for {pinned}): /{}. Remove them from {CLAUDE_LIST} or find what replaced them.",
            gone.join(", /")
        );
    }

    #[test]
    #[ignore = "needs Codex installed; run with --ignored"]
    fn installed_codex_is_not_newer_than_the_list_pinned_for_it() {
        let Some(executable) = on_path("codex") else {
            eprintln!("skipped: Codex is not installed here");
            return;
        };
        let list = source(CODEX_LIST);
        let pinned = pinned_version(&list, "CODEX_COMMANDS_PINNED_FOR").expect("codexCommands.ts must pin CODEX_COMMANDS_PINNED_FOR");
        let installed = installed_version(&executable).expect("codex --version printed no version");
        // Codex lists its commands only inside its terminal, so there is nothing to ask for them by name; a newer
        // build is the one signal that the list may have drifted.
        assert!(
            !is_newer(&installed, &pinned),
            "Codex {installed} is newer than the {pinned} that {CODEX_LIST} was written from. Open its terminal, compare / with the {} pinned commands, and update CODEX_COMMANDS_PINNED_FOR.",
            pinned_names(&list, &["said", "shown"]).len()
        );
    }
}
