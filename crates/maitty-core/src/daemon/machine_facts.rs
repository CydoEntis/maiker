//! What this daemon's computer is (`Query::MachineFacts`), for a window that has just added the
//! machine and wants to say what it found there: the system, the cores, the name it gives itself,
//! and which agent programs are installed and at what version.
//!
//! Nothing secret is read or sent: no paths, no environment, no logins. Each agent program is run
//! once with `--version` and stopped at a short limit, so a program that hangs cannot hold the
//! answer up; the programs are asked side by side.

use crate::proc::run_within;
use crate::protocol::{AgentFact, MACHINE_FACTS_AGENTS_MAX, MachineFacts};
use maitty_shared::hidden::sanitize;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

/// The agent programs looked for on the PATH, by their command names.
const AGENTS: [&str; 5] = ["claude", "codex", "gemini", "opencode", "cursor-agent"];
/// How long one program has to print its version.
const VERSION_LIMIT: Duration = Duration::from_secs(5);
/// The longest host name or system version shown, in characters.
const TEXT_MAX_CHARS: usize = 100;
/// The longest version shown, in characters.
const VERSION_MAX_CHARS: usize = 40;

/// What this computer is. Blocks while the agent programs print their versions.
pub(super) fn collect() -> MachineFacts {
    let mut agents: Vec<AgentFact> = std::thread::scope(|scope| {
        let asked: Vec<_> = AGENTS.iter().map(|name| scope.spawn(|| agent_fact(name))).collect();
        // A thread that panicked is a bug to surface, not a program to leave out.
        asked.into_iter().filter_map(|asked| asked.join().unwrap_or_else(|panic| std::panic::resume_unwind(panic))).collect()
    });
    agents.truncate(MACHINE_FACTS_AGENTS_MAX);
    MachineFacts {
        host_name: sysinfo::System::host_name().map(|name| shown(&name)),
        os: std::env::consts::OS.to_owned(),
        os_version: sysinfo::System::long_os_version().or_else(sysinfo::System::os_version).map(|version| shown(&version)),
        arch: std::env::consts::ARCH.to_owned(),
        cpu_cores: std::thread::available_parallelism().map_or(1, |cores| u32::try_from(cores.get()).unwrap_or(u32::MAX)),
        agents,
    }
}

fn shown(text: &str) -> String {
    sanitize(text, false).trim().chars().take(TEXT_MAX_CHARS).collect()
}

/// The program on the login PATH (with Windows' `.exe`, `.cmd` and `.bat`), and what it says its version is.
fn agent_fact(name: &str) -> Option<AgentFact> {
    let program = program_on_path(name)?;
    let mut command = Command::new(program);
    command.arg("--version").env_remove("CLAUDECODE").env("NO_COLOR", "1");
    if let Some(path) = crate::login_path::resolved() {
        command.env("PATH", path);
    }
    // A program that would not print, or not in time, is still installed: it only has no version to show.
    let version = run_within(&mut command, VERSION_LIMIT).ok().filter(|ran| ran.success).and_then(|ran| version_in(&ran.stdout));
    Some(AgentFact { name: name.to_owned(), version })
}

fn program_on_path(name: &str) -> Option<PathBuf> {
    let extensions: Vec<String> = if cfg!(windows) { vec![".exe".into(), ".cmd".into(), ".bat".into()] } else { Vec::new() };
    let path = crate::login_path::effective_path()?;
    crate::shim::find_on_path(name, &path, std::path::Path::new(""), &extensions)
}

/// The version number a program printed on its first line: the first word that starts with a digit
/// (after a `v`), such as `2.1.0` in `2.1.0 (Claude Code)` and `0.170.0` in `codex-cli 0.170.0`.
fn version_in(output: &str) -> Option<String> {
    let line = sanitize(output.lines().find(|line| !line.trim().is_empty())?, false);
    line.split_whitespace()
        .map(|word| word.strip_prefix('v').filter(|rest| rest.starts_with(|c: char| c.is_ascii_digit())).unwrap_or(word))
        .find(|word| word.starts_with(|c: char| c.is_ascii_digit()))
        .map(|word| word.chars().take(VERSION_MAX_CHARS).collect::<String>())
        .filter(|version| version.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_')))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_version_is_the_first_number_on_the_first_line() {
        assert_eq!(version_in("2.1.0 (Claude Code)\n").as_deref(), Some("2.1.0"));
        assert_eq!(version_in("codex-cli 0.170.0\n").as_deref(), Some("0.170.0"));
        assert_eq!(version_in("\n\nv1.2.3\nsecond line 9.9.9").as_deref(), Some("1.2.3"));
        assert_eq!(version_in("opencode 0.1.0-beta.1").as_deref(), Some("0.1.0-beta.1"));
    }

    #[test]
    fn a_line_without_a_version_number_gives_none() {
        for none in ["", "   \n", "usage: agent [options]", "error: unknown flag"] {
            assert_eq!(version_in(none), None, "{none:?}");
        }
    }

    #[test]
    fn a_version_with_markup_is_not_shown() {
        assert_eq!(version_in("1.0.0<script>"), None);
    }

    #[test]
    fn the_facts_name_this_system_and_hold_no_more_than_the_limits() {
        let facts = collect();

        assert_eq!(facts.os, std::env::consts::OS);
        assert_eq!(facts.arch, std::env::consts::ARCH);
        assert!(facts.cpu_cores >= 1);
        assert!(facts.agents.len() <= MACHINE_FACTS_AGENTS_MAX);
        assert!(facts.host_name.is_none_or(|name| name.chars().count() <= TEXT_MAX_CHARS));
    }
}
