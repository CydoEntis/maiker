//! Starting `claude` and `codex` for one command. Always an argument list, never a shell string,
//! so a folder with a space or a `&` needs no quoting and nothing a person typed can become a
//! second command. A command gets 60 seconds and 1 MiB of each stream; a program that runs over
//! is killed. Nothing is read from a terminal: a program that would ask a question gets none and
//! fails.

use super::Homes;
use maitty_shared::extensions::{ExtAgent, ExtError};
use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long one command may run.
pub(super) const TIME_LIMIT: Duration = Duration::from_secs(60);
/// The most of each stream kept; the rest is read and thrown away so the program never stalls.
pub(super) const OUTPUT_MAX_BYTES: usize = 1024 * 1024;
/// The most characters of what a program said that is passed on.
const SAID_MAX_CHARS: usize = 160;

/// What a command left behind.
#[derive(Debug)]
pub(super) struct Said {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// The programs to start, and where they keep their files.
pub(super) struct Programs {
    pub claude: PathBuf,
    pub codex: PathBuf,
}

impl Programs {
    /// `claude` and `codex` as the login PATH finds them (`.cmd` shims and `.exe` on Windows), else
    /// their bare names, which fail as `CliMissing` when started.
    pub(super) fn real() -> Programs {
        let find = |name: &str| {
            let extensions: Vec<String> = if cfg!(windows) { vec![".exe".into(), ".cmd".into(), ".bat".into()] } else { Vec::new() };
            crate::login_path::effective_path()
                .and_then(|path| crate::shim::find_on_path(name, &path, Path::new(""), &extensions))
                .unwrap_or_else(|| PathBuf::from(name))
        };
        Programs { claude: find(ExtAgent::Claude.program()), codex: find(ExtAgent::Codex.program()) }
    }

    fn of(&self, agent: ExtAgent) -> &Path {
        match agent {
            ExtAgent::Claude => &self.claude,
            ExtAgent::Codex => &self.codex,
        }
    }
}

/// Everything a command needs to start.
pub(super) struct Cli<'a> {
    pub programs: &'a Programs,
    pub homes: &'a Homes,
}

impl Cli<'_> {
    /// `agent` with `args` in `cwd` (the daemon's own folder when none), to its end or the limit.
    pub(super) fn run(&self, agent: ExtAgent, args: &[OsString], cwd: Option<&Path>) -> Result<Said, ExtError> {
        run_program(self.of(agent), agent, args, cwd, self.pinned(agent), TIME_LIMIT)
    }

    fn of(&self, agent: ExtAgent) -> &Path {
        self.programs.of(agent)
    }

    /// The folder variable to set when the agent's files are not where it would look by itself.
    fn pinned(&self, agent: ExtAgent) -> Option<(&'static str, &Path)> {
        self.homes.pin_env.then_some(match agent {
            ExtAgent::Claude => ("CLAUDE_CONFIG_DIR", self.homes.claude_dir.as_path()),
            ExtAgent::Codex => ("CODEX_HOME", self.homes.codex_dir.as_path()),
        })
    }
}

fn run_program(
    program: &Path,
    agent: ExtAgent,
    args: &[OsString],
    cwd: Option<&Path>,
    pinned: Option<(&'static str, &Path)>,
    limit: Duration,
) -> Result<Said, ExtError> {
    let mut command = Command::new(program);
    command.args(args).env("NO_COLOR", "1").env_remove("CLAUDECODE");
    if let Some(path) = crate::login_path::resolved() {
        command.env("PATH", path);
    }
    if let Some((name, folder)) = pinned {
        command.env(name, folder);
    }
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    crate::proc::quiet(&mut command);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => ExtError::CliMissing(agent),
            _ => ExtError::Failed(format!("{} could not be started", agent.program())),
        })?;
    let out = capped(child.stdout.take());
    let err = capped(child.stderr.take());
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() >= limit => {
                // Both fail only when the program has just ended by itself, which is what is wanted.
                let _ = child.kill();
                let _ = child.wait();
                return Err(ExtError::Failed(format!("{} did not answer in time", agent.program())));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(25)),
            Err(_) => return Err(ExtError::Failed(format!("{} could not be waited for", agent.program()))),
        }
    };
    Ok(Said { success: status.success(), stdout: out.join().unwrap_or_default(), stderr: err.join().unwrap_or_default() })
}

/// A stream read to its end on its own thread, keeping the first `OUTPUT_MAX_BYTES`.
fn capped(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut kept = Vec::new();
        if let Some(mut pipe) = pipe {
            let mut chunk = [0u8; 8192];
            // A read that fails ends the stream; the exit status still decides the outcome.
            while let Ok(read) = pipe.read(&mut chunk) {
                if read == 0 {
                    break;
                }
                let room = OUTPUT_MAX_BYTES.saturating_sub(kept.len());
                kept.extend_from_slice(&chunk[..read.min(room)]);
            }
        }
        String::from_utf8_lossy(&kept).into_owned()
    })
}

/// The first line a program said that is not a warning, for a person to read: cleaned and cut. A
/// value that could be a secret never reaches it: arguments are not echoed, and the line is only
/// what the program wrote, which is checked for the words a secret is introduced with.
pub(super) fn first_line(said: &str) -> String {
    let line = said.lines().map(str::trim).find(|line| !line.is_empty() && !line.to_ascii_uppercase().starts_with("WARNING")).unwrap_or_default();
    let line = maitty_shared::hidden::sanitize(line, false);
    let words: Vec<&str> = line.split_whitespace().map(|word| if looks_secret(word) { "..." } else { word }).collect();
    words.join(" ").chars().take(SAID_MAX_CHARS).collect()
}

/// Whether a word of a program's message could be a key: `key=value`, a long token, or a bearer.
fn looks_secret(word: &str) -> bool {
    let lower = word.to_ascii_lowercase();
    let named = ["key=", "token=", "secret=", "password=", "authorization=", "bearer"].iter().any(|start| lower.contains(start));
    named || (word.len() >= 32 && word.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')))
}

/// An argument list of plain strings.
pub(super) fn args<const N: usize>(words: [&str; N]) -> Vec<OsString> {
    words.iter().map(OsString::from).collect()
}

/// `extra` after `args`.
pub(super) fn with(mut args: Vec<OsString>, extra: impl IntoIterator<Item = impl AsRef<OsStr>>) -> Vec<OsString> {
    args.extend(extra.into_iter().map(|word| word.as_ref().to_owned()));
    args
}

#[cfg(all(test, unix))]
pub(super) mod fake {
    use std::path::{Path, PathBuf};

    /// A program called `name` in a folder with a space in its name that records each call's
    /// arguments (one per line, calls ending in `---`) to `args.txt` beside it, prints
    /// `reply.txt` if there is one, and exits with the number in `code.txt` (0 when none).
    pub(in crate::daemon::extensions) fn program(root: &Path, name: &str) -> PathBuf {
        let dir = root.join("fake bin");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        crate::test_support::write_program(
            &path,
            "#!/bin/sh\nd=\"$(dirname \"$0\")\"\nfor a in \"$@\"; do printf '%s\\n' \"$a\" >> \"$d/args.txt\"; done\nprintf -- '---\\n' >> \"$d/args.txt\"\nprintf '%s' \"$(pwd)\" > \"$d/cwd.txt\"\n[ -f \"$d/reply.txt\" ] && cat \"$d/reply.txt\"\n[ -f \"$d/err.txt\" ] && cat \"$d/err.txt\" >&2\n[ -f \"$d/code.txt\" ] && exit \"$(cat \"$d/code.txt\")\"\nexit 0\n",
        );
        path
    }

    /// The calls a fake program saw, each as its list of arguments.
    pub(in crate::daemon::extensions) fn calls(program: &Path) -> Vec<Vec<String>> {
        let text = std::fs::read_to_string(program.with_file_name("args.txt")).unwrap_or_default();
        let mut calls = vec![Vec::new()];
        for line in text.lines() {
            if line == "---" {
                calls.push(Vec::new());
            } else {
                calls.last_mut().unwrap().push(line.to_owned());
            }
        }
        calls.pop();
        calls
    }

    pub(in crate::daemon::extensions) fn say(program: &Path, stdout: &str, code: i32) {
        std::fs::write(program.with_file_name("reply.txt"), stdout).unwrap();
        std::fs::write(program.with_file_name("code.txt"), code.to_string()).unwrap();
    }

    pub(in crate::daemon::extensions) fn say_err(program: &Path, stderr: &str) {
        std::fs::write(program.with_file_name("err.txt"), stderr).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_program_said_is_one_cleaned_line_with_no_secret_in_it() {
        assert_eq!(first_line("WARNING: PATH aliases\n\n  Failed \u{1b}[31mto add\n"), "Failed [31mto add");
        assert_eq!(first_line("bad API_KEY=sk-abc123 here"), "bad ... here");
        assert_eq!(first_line("Authorization: Bearer abc"), "Authorization: ... abc");
        assert_eq!(first_line(&format!("token {}", "a".repeat(40))), "token ...");
        assert_eq!(first_line(&"word ".repeat(100)).chars().count(), SAID_MAX_CHARS);
        assert_eq!(first_line(""), "");
    }

    #[test]
    fn a_program_that_is_not_there_is_a_missing_cli() {
        let said = run_program(Path::new("maitty-no-such-agent-program"), ExtAgent::Codex, &[], None, None, TIME_LIMIT);
        assert!(matches!(said, Err(ExtError::CliMissing(ExtAgent::Codex))));
    }

    #[cfg(unix)]
    mod unix {
        use super::super::*;
        use crate::daemon::persist::scratch_dir;

        #[test]
        fn arguments_reach_the_program_one_by_one_in_a_folder_with_a_space() {
            let root = scratch_dir();
            let program = fake::program(root.path(), "claude");
            let tricky = ["a b", "--flag=1 --other", "$(touch pwned)", "&& echo", "quote\"d", "-x"];
            let said = run_program(&program, ExtAgent::Claude, &with(args(["plugin"]), tricky), None, None, TIME_LIMIT).unwrap();
            assert!(said.success);
            let mut expected = vec!["plugin".to_owned()];
            expected.extend(tricky.iter().map(|word| (*word).to_owned()));
            assert_eq!(fake::calls(&program), vec![expected]);
            assert!(!root.path().join("pwned").exists());
        }

        #[test]
        fn the_program_runs_in_the_folder_asked_for_and_with_the_pinned_home() {
            let root = scratch_dir();
            let program = fake::program(root.path(), "codex");
            let cwd = root.path().join("my project");
            std::fs::create_dir_all(&cwd).unwrap();
            run_program(&program, ExtAgent::Codex, &args(["x"]), Some(&cwd), Some(("CODEX_HOME", root.path())), TIME_LIMIT).unwrap();
            let seen = std::fs::read_to_string(program.with_file_name("cwd.txt")).unwrap();
            assert_eq!(std::fs::canonicalize(seen).unwrap(), std::fs::canonicalize(&cwd).unwrap());
        }

        #[test]
        fn what_it_says_and_how_it_ended_come_back_apart() {
            let root = scratch_dir();
            let program = fake::program(root.path(), "claude");
            fake::say(&program, "{\"ok\":1}\n", 1);
            fake::say_err(&program, "boom\n");
            let said = run_program(&program, ExtAgent::Claude, &[], None, None, TIME_LIMIT).unwrap();
            assert_eq!((said.success, said.stdout.as_str(), said.stderr.as_str()), (false, "{\"ok\":1}\n", "boom\n"));
        }

        #[test]
        fn a_program_that_runs_too_long_is_killed() {
            let root = scratch_dir();
            let program = root.path().join("slow");
            std::fs::create_dir_all(root.path()).unwrap();
            crate::test_support::write_program(&program, "#!/bin/sh\nsleep 5\n");
            let started = Instant::now();
            let said = run_program(&program, ExtAgent::Claude, &[], None, None, Duration::from_millis(200));
            assert!(matches!(said, Err(ExtError::Failed(ref why)) if why.contains("in time")), "{said:?}");
            assert!(started.elapsed() < Duration::from_secs(4));
        }

        #[test]
        fn more_output_than_the_cap_is_cut_and_the_program_is_not_stalled() {
            let root = scratch_dir();
            let program = root.path().join("loud");
            std::fs::create_dir_all(root.path()).unwrap();
            crate::test_support::write_program(&program, "#!/bin/sh\nhead -c 3000000 /dev/zero | tr '\\0' 'a'\n");
            let said = run_program(&program, ExtAgent::Claude, &[], None, None, TIME_LIMIT).unwrap();
            assert!(said.success);
            assert_eq!(said.stdout.len(), OUTPUT_MAX_BYTES);
        }
    }
}
