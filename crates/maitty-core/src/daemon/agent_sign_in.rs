//! Signing an agent in from a window (`Query::AgentSignIn`): the daemon runs the agent's own login
//! command in the background, keeps only the link and the one-time code it prints, and says it
//! worked only when the agent's own status command says so. The daemon owns the process (ADR 0001),
//! so a window that closes does not leave a login behind: it ends at its limit.
//!
//! Nothing here reads, keeps or sends a credential. The login's output is scanned for one
//! `https://` address and one code and then dropped; the credentials the agent obtains go to its
//! own files, as they do when it is run in a terminal (ADR 0006). Nothing the output says is ever
//! run, and no window supplies a word of the command line.

use crate::proc::{Ran, run_within};
use crate::protocol::{SIGN_IN_CODE_MAX_CHARS, SIGN_IN_LINK_MAX_BYTES, SignInAgent, SignInFailure, SignInState};
use maitty_shared::hidden::sanitize;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot};

/// How long a person has to finish a sign-in. Codex's device code lives for 15 minutes.
const LOGIN_LIMIT: Duration = Duration::from_secs(15 * 60);
/// How long the agent's status command has to answer.
const STATUS_LIMIT: Duration = Duration::from_secs(15);
/// The most of a login's output that is looked at; the rest is read and thrown away so the
/// command never stalls on a full pipe.
const OUTPUT_CAP_BYTES: usize = 16 * 1024;
/// How long output still in flight is waited for once the command has ended.
const FLUSH_LIMIT: Duration = Duration::from_secs(1);
/// The words around a code, not part of it: the line that names it.
const CODE_MARKER: &str = "one-time code";

/// How an agent's status command answers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatusStyle {
    /// `auth status --json`: `{"loggedIn": true}`, and a failing exit when signed out.
    Json,
    /// `login status`: a line starting "Logged in", and a failing exit when signed out.
    Line,
    /// `auth status`: only the exit says, success when signed in. Its text is never read, for it
    /// names accounts and the way the token is kept.
    Exit,
}

/// An agent's command line: what runs the login, and what asks whether it worked.
#[derive(Debug, Clone)]
pub(super) struct Cli {
    program: PathBuf,
    login: &'static [&'static str],
    status: &'static [&'static str],
    style: StatusStyle,
}

/// The agent's command line on this computer, or why there is none to run. Every word of it is a
/// constant; the program is the one found on the login PATH (with Windows' `.exe`, `.cmd` and
/// `.bat`).
pub(super) fn cli_for(agent: SignInAgent) -> Result<Cli, SignInFailure> {
    let (name, login, status, style): (&str, &'static [&'static str], &'static [&'static str], StatusStyle) = match agent {
        SignInAgent::Claude => ("claude", &["auth", "login"], &["auth", "status", "--json"], StatusStyle::Json),
        // The device-code flow: the browser flow needs a callback server on this computer's port 1455.
        SignInAgent::Codex => ("codex", &["login", "--device-auth"], &["login", "status"], StatusStyle::Line),
        // Gemini CLI has no sign-in command; it asks on its first run, inside its terminal.
        SignInAgent::Gemini => return Err(SignInFailure::Unsupported),
        // Not interactive (nothing is typed to it), so `gh` prints the one-time code and the address
        // instead of waiting for Enter and opening a browser itself. The host is named because
        // `gh` would ask for it otherwise. `gh` keeps the token; this module never reads it.
        SignInAgent::Github => ("gh", &["auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"], &["auth", "status", "--hostname", "github.com"], StatusStyle::Exit),
    };
    let extensions: Vec<String> = if cfg!(windows) { vec![".exe".into(), ".cmd".into(), ".bat".into()] } else { Vec::new() };
    let path = crate::login_path::effective_path().ok_or(SignInFailure::NotInstalled)?;
    let program = crate::shim::find_on_path(name, &path, std::path::Path::new(""), &extensions).ok_or(SignInFailure::NotInstalled)?;
    Ok(Cli { program, login, status, style })
}

/// One agent's sign-in as it stands. `run` counts the logins started, so a task that outlives its
/// login (cancelled, replaced) cannot write over what came after.
struct Entry {
    state: SignInState,
    run: u64,
    cancel: Option<oneshot::Sender<()>>,
}

#[derive(Clone)]
struct Slot(Arc<Mutex<Entry>>);

impl Default for Slot {
    fn default() -> Slot {
        Slot(Arc::new(Mutex::new(Entry { state: SignInState::Idle, run: 0, cancel: None })))
    }
}

impl Slot {
    fn lock(&self) -> MutexGuard<'_, Entry> {
        // A task that panicked while holding it left a state that is still one of the four.
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// Every agent's sign-in; one login at a time per agent.
#[derive(Default)]
pub(super) struct SignIns {
    claude: Slot,
    codex: Slot,
    github: Slot,
}

impl SignIns {
    fn slot(&self, agent: SignInAgent) -> Option<&Slot> {
        match agent {
            SignInAgent::Claude => Some(&self.claude),
            SignInAgent::Codex => Some(&self.codex),
            SignInAgent::Github => Some(&self.github),
            SignInAgent::Gemini => None,
        }
    }

    pub(super) fn read(&self, agent: SignInAgent) -> SignInState {
        self.slot(agent).map_or(SignInState::Failed(SignInFailure::Unsupported), |slot| slot.lock().state.clone())
    }

    /// Stop the login that is running, and forget how the last one ended.
    pub(super) fn cancel(&self, agent: SignInAgent) -> SignInState {
        let Some(slot) = self.slot(agent) else {
            return SignInState::Failed(SignInFailure::Unsupported);
        };
        let mut entry = slot.lock();
        entry.run += 1;
        entry.state = SignInState::Idle;
        if let Some(stop) = entry.cancel.take() {
            // The task has already ended when this fails, which is what is wanted.
            let _ = stop.send(());
        }
        SignInState::Idle
    }

    /// Run the agent's login, unless one is already running: then that one is what is answered.
    /// Must be called inside the runtime.
    pub(super) fn start(&self, agent: SignInAgent, cli: Result<Cli, SignInFailure>) -> SignInState {
        self.start_within(agent, cli, LOGIN_LIMIT)
    }

    fn start_within(&self, agent: SignInAgent, cli: Result<Cli, SignInFailure>, limit: Duration) -> SignInState {
        let Some(slot) = self.slot(agent) else {
            return SignInState::Failed(SignInFailure::Unsupported);
        };
        let mut entry = slot.lock();
        if matches!(entry.state, SignInState::Waiting { .. }) {
            return entry.state.clone();
        }
        entry.run += 1;
        let run = entry.run;
        let cli = match cli {
            Ok(cli) => cli,
            Err(why) => {
                entry.state = SignInState::Failed(why);
                return entry.state.clone();
            }
        };
        let (stop, stopped) = oneshot::channel();
        entry.cancel = Some(stop);
        entry.state = SignInState::Waiting { link: None, code: None };
        let answer = entry.state.clone();
        drop(entry);
        tokio::spawn(drive(slot.clone(), run, cli, limit, stopped));
        answer
    }
}

/// How a login command came to its end.
enum End {
    Exited(bool),
    TimedOut,
    Cancelled,
    CouldNotStart(SignInFailure),
}

/// The login command's environment: the PATH a login shell has (where the agent's own helpers
/// are), no colour, and no mark of an enclosing Claude Code session, which would refuse to run.
fn base(cli: &Cli, words: &[&str]) -> std::process::Command {
    let mut command = std::process::Command::new(&cli.program);
    // `GH_PROMPT_DISABLED` is `gh`'s own switch for never asking a question; the others ignore it.
    command.args(words).env_remove("CLAUDECODE").env("NO_COLOR", "1").env("GH_PROMPT_DISABLED", "1");
    if let Some(path) = crate::login_path::resolved() {
        command.env("PATH", path);
    }
    command
}

/// Run the login to its end, keep the link and code it prints, then ask the agent whether it is
/// signed in.
async fn drive(slot: Slot, run: u64, cli: Cli, limit: Duration, mut stopped: oneshot::Receiver<()>) {
    let mut command = tokio::process::Command::from(base(&cli, cli.login));
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(crate::proc::CREATE_NO_WINDOW);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let why = if error.kind() == std::io::ErrorKind::NotFound { SignInFailure::NotInstalled } else { SignInFailure::CouldNotStart };
            return finish(&slot, run, &cli, End::CouldNotStart(why)).await;
        }
    };
    let (chunks, mut output) = mpsc::channel::<Vec<u8>>(16);
    if let Some(pipe) = child.stdout.take() {
        tokio::spawn(read_pipe(pipe, chunks.clone()));
    }
    if let Some(pipe) = child.stderr.take() {
        tokio::spawn(read_pipe(pipe, chunks.clone()));
    }
    drop(chunks);
    let mut seen = Seen::default();
    let deadline = tokio::time::sleep(limit);
    tokio::pin!(deadline);
    let mut open = true;
    let end = loop {
        tokio::select! {
            chunk = output.recv(), if open => match chunk {
                Some(chunk) => seen.take(&chunk, &slot, run),
                None => open = false,
            },
            status = child.wait() => break End::Exited(status.is_ok_and(|status| status.success())),
            () = &mut deadline => break End::TimedOut,
            _ = &mut stopped => break End::Cancelled,
        }
    };
    if !matches!(end, End::Exited(_)) {
        // Both can fail only when the command has just ended by itself, which is what is wanted.
        let _ = child.start_kill();
        let _ = child.wait().await;
    }
    // What the command printed last is still in the pipe when it ends.
    while let Ok(Some(chunk)) = tokio::time::timeout(FLUSH_LIMIT, output.recv()).await {
        seen.take(&chunk, &slot, run);
    }
    finish(&slot, run, &cli, end).await;
}

async fn read_pipe(mut pipe: impl tokio::io::AsyncRead + Unpin, chunks: mpsc::Sender<Vec<u8>>) {
    let mut buffer = [0u8; 1024];
    // A pipe that fails to read ends the same as one that closed: nothing more to keep.
    while let Ok(read) = pipe.read(&mut buffer).await {
        if read == 0 || chunks.send(buffer[..read].to_vec()).await.is_err() {
            break;
        }
    }
}

async fn finish(slot: &Slot, run: u64, cli: &Cli, end: End) {
    let state = match end {
        // The cancel already set the state.
        End::Cancelled => return,
        End::CouldNotStart(why) => SignInState::Failed(why),
        End::TimedOut => SignInState::Failed(SignInFailure::TimedOut),
        End::Exited(false) => SignInState::Failed(SignInFailure::Ended),
        End::Exited(true) => {
            let mut ask = base(cli, cli.status);
            let style = cli.style;
            let asked = tokio::task::spawn_blocking(move || run_within(&mut ask, STATUS_LIMIT)).await;
            match asked {
                Ok(Ok(ran)) if signed_in(style, &ran) => SignInState::SignedIn,
                _ => SignInState::Failed(SignInFailure::Ended),
            }
        }
    };
    let mut entry = slot.lock();
    if entry.run == run {
        entry.state = state;
        entry.cancel = None;
    }
}

/// Whether the agent's status command says it is signed in.
fn signed_in(style: StatusStyle, ran: &Ran) -> bool {
    let printed = if ran.stdout.trim().is_empty() { &ran.stderr } else { &ran.stdout };
    match style {
        StatusStyle::Exit => ran.success,
        StatusStyle::Json => serde_json::from_str::<serde_json::Value>(printed.trim()).ok().and_then(|reply| reply.get("loggedIn")?.as_bool()).unwrap_or(false),
        StatusStyle::Line => ran.success && printed.lines().find(|line| !line.trim().is_empty()).is_some_and(|line| line.trim().to_lowercase().starts_with("logged in")),
    }
}

/// The start of a login's output, up to the cap, as text.
#[derive(Default)]
struct Seen {
    bytes: Vec<u8>,
}

impl Seen {
    /// Take more output and, when it changed what is shown, publish it.
    fn take(&mut self, chunk: &[u8], slot: &Slot, run: u64) {
        let room = OUTPUT_CAP_BYTES.saturating_sub(self.bytes.len());
        if room == 0 {
            return;
        }
        self.bytes.extend_from_slice(&chunk[..chunk.len().min(room)]);
        let (link, code) = scan(&String::from_utf8_lossy(&self.bytes));
        let next = SignInState::Waiting { link, code };
        let mut entry = slot.lock();
        if entry.run == run && matches!(entry.state, SignInState::Waiting { .. }) && entry.state != next {
            entry.state = next;
        }
    }
}

/// `text` without terminal escape sequences (colour and cursor codes), which the agents draw
/// even into a pipe.
fn without_escapes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            // CSI: parameters, then one final byte in `@`..=`~`.
            Some('[') => {
                chars.next();
                for next in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&next) {
                        break;
                    }
                }
            }
            // OSC: up to the bell or the string terminator.
            Some(']') => {
                chars.next();
                while let Some(next) = chars.next() {
                    if next == '\u{7}' || (next == '\u{1b}' && chars.next_if_eq(&'\\').is_some()) {
                        break;
                    }
                }
            }
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

/// The first `https://` address in a login's output, and the one-time code it names, each only
/// when it passes the checks.
fn scan(output: &str) -> (Option<String>, Option<String>) {
    let clean = sanitize(&without_escapes(output), true);
    let link = clean.split_whitespace().find_map(|word| clean_link(word.trim_matches(|c: char| matches!(c, '<' | '>' | '(' | ')' | '"' | '\'' | ',' | '.'))));
    let mut lines = clean.lines();
    // Codex puts the code on the line after the one that names it; `gh` puts it after a colon on that line.
    let code = lines.by_ref().find(|line| line.to_lowercase().contains(CODE_MARKER)).and_then(|named| {
        match named.rsplit_once(':') {
            Some((_, after)) => clean_code(after.trim()),
            None => lines.find(|line| !line.trim().is_empty()).and_then(|line| clean_code(line.trim())),
        }
    });
    (link, code)
}

/// `word` as a sign-in link: `https` only, a host and no user name in front of it, no longer
/// than a link may be. Everything else is dropped, not repaired.
fn clean_link(word: &str) -> Option<String> {
    let rest = word.strip_prefix("https://")?;
    if word.len() > SIGN_IN_LINK_MAX_BYTES {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let (host, port) = authority.split_once(':').map_or((authority, ""), |(host, port)| (host, port));
    let host_ok = !host.is_empty() && host.split('.').all(|label| !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    let port_ok = port.chars().all(|c| c.is_ascii_digit()) && port.len() <= 5;
    (host_ok && port_ok && word.chars().all(|c| c.is_ascii_graphic())).then(|| word.to_owned())
}

/// `line` as a one-time code: letters, digits and dashes only, with at least one letter or digit.
fn clean_code(line: &str) -> Option<String> {
    let fits = !line.is_empty() && line.chars().count() <= SIGN_IN_CODE_MAX_CHARS && line.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    (fits && line.chars().any(|c| c.is_ascii_alphanumeric())).then(|| line.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `codex login --device-auth` printed when run for this spike (colours kept, the code replaced).
    const CODEX: &str = "\nWelcome to Codex [v\u{1b}[90m0.166.0\u{1b}[0m]\n\u{1b}[90mOpenAI's command-line coding agent\u{1b}[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u{1b}[94mhttps://auth.openai.com/codex/device\u{1b}[0m\n\n2. Enter this one-time code \u{1b}[90m(expires in 15 minutes)\u{1b}[0m\n   \u{1b}[94mABCD-EFGHI\u{1b}[0m\n\n\u{1b}[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\u{1b}[0m\n";
    /// What `claude auth login` printed (the query values replaced).
    const CLAUDE: &str = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y\nPaste code here if prompted > ";

    #[test]
    fn codex_prints_a_link_and_a_code_through_colour_codes() {
        assert_eq!(scan(CODEX), (Some("https://auth.openai.com/codex/device".into()), Some("ABCD-EFGHI".into())));
    }

    /// What `gh auth login --web` prints when nothing can be typed to it: the code on the line that names it.
    const GITHUB: &str = "! First copy your one-time code: 1A2B-3C4D\nOpen this URL to continue in your web browser: https://github.com/login/device\n";

    #[test]
    fn github_prints_its_code_after_a_colon_and_its_address_on_the_next_line() {
        assert_eq!(scan(GITHUB), (Some("https://github.com/login/device".into()), Some("1A2B-3C4D".into())));
        // Before it has printed the address, the code alone is what is known.
        assert_eq!(scan("! First copy your one-time code: 1A2B-3C4D\n"), (None, Some("1A2B-3C4D".into())));
    }

    #[test]
    fn claude_prints_a_link_and_no_code() {
        let (link, code) = scan(CLAUDE);
        assert_eq!(link.as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y"));
        assert_eq!(code, None);
    }

    #[test]
    fn only_a_plain_https_address_is_a_link() {
        for not in [
            "http://auth.example/x",
            "https://user:pw@auth.example/x",
            "https://@evil.example/x",
            "https:///x",
            "https://auth.example:99999999/x",
            "https://auth..example/x",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "https://auth.example/\u{202e}x",
        ] {
            assert_eq!(clean_link(not), None, "{not}");
        }
        assert_eq!(clean_link("https://auth.example:8443/x?a=b#c").as_deref(), Some("https://auth.example:8443/x?a=b#c"));
        assert_eq!(clean_link(&format!("https://a.example/{}", "x".repeat(SIGN_IN_LINK_MAX_BYTES))), None);
    }

    #[test]
    fn a_code_is_letters_digits_and_dashes_only() {
        assert_eq!(clean_code("AB12-CD34").as_deref(), Some("AB12-CD34"));
        for not in ["", "---", "rm -rf /", "AB 12", "$(reboot)", &"A".repeat(SIGN_IN_CODE_MAX_CHARS + 1)] {
            assert_eq!(clean_code(not), None, "{not}");
        }
    }

    #[test]
    fn a_sentence_where_a_code_would_be_is_not_shown_as_one() {
        for printed in [
            "! First copy your one-time code: not a code at all\n",
            "Enter this one-time code\nContinue only if you started this\n",
        ] {
            assert_eq!(scan(printed).1, None, "{printed:?}");
        }
    }

    #[test]
    fn the_status_commands_are_read_as_each_agent_prints_them() {
        let ran = |success, stdout: &str, stderr: &str| Ran { success, stdout: stdout.into(), stderr: stderr.into() };
        // GitHub's status is its exit code, whatever it prints.
        let github = "github.com\n  Logged in to github.com account x (keyring)\n";
        assert!(signed_in(StatusStyle::Exit, &ran(true, github, "")));
        assert!(!signed_in(StatusStyle::Exit, &ran(false, github, "")));
        assert!(signed_in(StatusStyle::Json, &ran(true, "{\"loggedIn\": true}", "")));
        assert!(!signed_in(StatusStyle::Json, &ran(false, "{\"loggedIn\": false}", "")));
        assert!(!signed_in(StatusStyle::Json, &ran(true, "not json", "")));
        assert!(signed_in(StatusStyle::Line, &ran(true, "Logged in using ChatGPT\n", "")));
        assert!(!signed_in(StatusStyle::Line, &ran(false, "", "Not logged in")));
        assert!(!signed_in(StatusStyle::Line, &ran(true, "Not logged in", "")));
    }

    #[test]
    fn gemini_has_no_sign_in_to_run() {
        assert_eq!(cli_for(SignInAgent::Gemini).unwrap_err(), SignInFailure::Unsupported);
        let ins = SignIns::default();
        assert_eq!(ins.read(SignInAgent::Gemini), SignInState::Failed(SignInFailure::Unsupported));
        assert_eq!(ins.cancel(SignInAgent::Gemini), SignInState::Failed(SignInFailure::Unsupported));
    }

    #[cfg(unix)]
    mod fake_cli {
        use super::*;

        /// A fake agent in a folder of its own: `login` prints `printed` then waits (or ends), and `status` says what it says.
        fn fake(dir: &std::path::Path, login_body: &str, status_body: &str) -> Cli {
            let program = dir.join("fake-agent");
            let script = format!("#!/bin/sh\ncase \"$1\" in\n  login) {login_body} ;;\n  status) {status_body} ;;\nesac\n");
            crate::test_support::write_program(&program, &script);
            Cli { program, login: &["login"], status: &["status"], style: StatusStyle::Line }
        }

        fn folder(name: &str) -> PathBuf {
            let dir = std::env::temp_dir().join(format!("maitty-sign-in-{name}-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            dir
        }

        async fn until(ins: &SignIns, agent: SignInAgent, done: impl Fn(&SignInState) -> bool) -> SignInState {
            for _ in 0..200 {
                let state = ins.read(agent);
                if done(&state) {
                    return state;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            panic!("never got there: {:?}", ins.read(agent));
        }

        const PRINT_CODEX: &str = "printf 'Open https://auth.example/device\\nEnter this one-time code\\n  AB12-CD34\\n'";

        #[tokio::test]
        async fn a_login_that_ends_and_is_signed_in_says_so_from_the_status_command() {
            let dir = folder("ok");
            let cli = fake(&dir, &format!("{PRINT_CODEX}; sleep 0.3"), "echo 'Logged in using ChatGPT'");
            let ins = SignIns::default();
            let first = ins.start(SignInAgent::Codex, Ok(cli));
            assert!(matches!(first, SignInState::Waiting { .. }));
            let shown = until(&ins, SignInAgent::Codex, |state| matches!(state, SignInState::Waiting { link: Some(_), code: Some(_) })).await;
            assert_eq!(shown, SignInState::Waiting { link: Some("https://auth.example/device".into()), code: Some("AB12-CD34".into()) });
            assert_eq!(until(&ins, SignInAgent::Codex, |state| *state == SignInState::SignedIn).await, SignInState::SignedIn);
        }

        #[tokio::test]
        async fn a_login_that_fails_or_ends_still_signed_out_is_a_failure() {
            // A clean exit while still signed out, and a failed login whatever the status says.
            for (name, login, status) in [("liar", "true", "echo 'Not logged in'; exit 1"), ("fails", "exit 3", "echo 'Logged in'")] {
                let dir = folder(name);
                let cli = fake(&dir, login, status);
                let ins = SignIns::default();
                ins.start(SignInAgent::Codex, Ok(cli));
                assert_eq!(until(&ins, SignInAgent::Codex, |state| !matches!(state, SignInState::Waiting { .. })).await, SignInState::Failed(SignInFailure::Ended), "{name}");
            }
        }

        #[tokio::test]
        async fn a_second_start_answers_with_the_login_already_running() {
            let dir = folder("one");
            let marker = dir.join("starts");
            let cli = fake(&dir, &format!("echo x >> {}; sleep 30", marker.display()), "exit 1");
            let ins = SignIns::default();
            ins.start(SignInAgent::Codex, Ok(cli.clone()));
            let again = ins.start(SignInAgent::Codex, Ok(cli));
            assert!(matches!(again, SignInState::Waiting { .. }));
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert_eq!(std::fs::read_to_string(&marker).unwrap().lines().count(), 1);
            ins.cancel(SignInAgent::Codex);
        }

        #[tokio::test]
        async fn cancelling_stops_the_command_and_forgets_the_login() {
            let dir = folder("cancel");
            let pid = dir.join("pid");
            let cli = fake(&dir, &format!("echo $$ > {}; sleep 30", pid.display()), "exit 1");
            let ins = SignIns::default();
            ins.start(SignInAgent::Codex, Ok(cli));
            for _ in 0..100 {
                if pid.exists() && !std::fs::read_to_string(&pid).unwrap().trim().is_empty() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            let pid = std::fs::read_to_string(&pid).unwrap().trim().to_owned();
            assert_eq!(ins.cancel(SignInAgent::Codex), SignInState::Idle);
            for _ in 0..100 {
                if !std::path::Path::new(&format!("/proc/{pid}")).exists() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists() || cfg!(not(target_os = "linux")), "the login is still running");
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(ins.read(SignInAgent::Codex), SignInState::Idle, "a cancelled login does not report afterwards");
        }

        #[tokio::test]
        async fn a_login_nobody_finishes_times_out() {
            let dir = folder("timeout");
            let cli = fake(&dir, "sleep 30", "exit 1");
            let ins = SignIns::default();
            ins.start_within(SignInAgent::Codex, Ok(cli), Duration::from_millis(200));
            assert_eq!(until(&ins, SignInAgent::Codex, |state| !matches!(state, SignInState::Waiting { .. })).await, SignInState::Failed(SignInFailure::TimedOut));
        }

        #[tokio::test]
        async fn a_command_that_cannot_start_is_a_typed_failure() {
            let ins = SignIns::default();
            let missing = Cli { program: PathBuf::from("/no/such/agent"), login: &["login"], status: &["status"], style: StatusStyle::Line };
            ins.start(SignInAgent::Claude, Ok(missing));
            assert_eq!(until(&ins, SignInAgent::Claude, |state| !matches!(state, SignInState::Waiting { .. })).await, SignInState::Failed(SignInFailure::NotInstalled));
            assert_eq!(ins.start(SignInAgent::Codex, Err(SignInFailure::NotInstalled)), SignInState::Failed(SignInFailure::NotInstalled));
        }

        #[tokio::test]
        async fn a_flood_of_output_is_read_and_dropped_without_stalling_the_login() {
            let dir = folder("cap");
            let flood = format!("head -c {} /dev/zero | tr '\\0' 'a'; printf '\\nhttps://late.example/x\\n'", OUTPUT_CAP_BYTES * 4);
            let cli = fake(&dir, &flood, "echo 'Logged in'");
            let ins = SignIns::default();
            ins.start(SignInAgent::Codex, Ok(cli));
            assert_eq!(until(&ins, SignInAgent::Codex, |state| *state == SignInState::SignedIn).await, SignInState::SignedIn);
        }
    }
}
