//! One-shot commands: scripting the multiplexer from a shell (or from an agent inside it).

use crate::brand::{APP_COMMAND, APP_VERSION};
use crate::ipc;
pub(crate) mod agents;
pub(crate) mod conversation;
pub(crate) mod doctor_machines;
pub(crate) mod handoff;
pub(crate) mod integrations;
mod jsonc;
pub(crate) mod machine_get;
pub(crate) mod machine_put;
pub(crate) mod machine_update;
pub(crate) mod machines_ls;
pub(crate) mod mcp;
mod mcp_config;
pub(crate) mod restart;
pub(crate) mod reload;
pub(crate) mod reveal;
pub(crate) mod secret_run;
pub(crate) mod target;
pub(crate) mod uninstall;
pub(crate) mod update;
use crate::layout::Dir;
use crate::protocol::*;
use anyhow::{Context, Result, anyhow, bail};
use maitty_machines::RestartWhen;
use jsonc_parser::cst::{CstInputValue, CstObjectProp};
use mcp_config::McpChange;
use serde_json::{Value, json};
use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;
pub use reload::reload_agents;
use target::Target;

pub(crate) fn block_on<T>(f: impl std::future::Future<Output = Result<T>>) -> Result<T> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let out = rt.block_on(f);
    // Don't wait on reads still blocked on a pipe (ssh's, over --remote).
    rt.shutdown_background();
    out
}

/// A one-shot command's connection to `t`'s machine, saying which when it can't be reached.
async fn open_cli(t: &Target) -> Result<(ipc::Reader, ipc::Writer)> {
    ipc::open_to(t.machine(), false)
        .await
        .map_err(|e| t.connect_error(e))
}

/// Send one message to the machine `--remote` names (else this one) and wait for the reply.
pub(crate) async fn request(msg: ClientMsg) -> Result<Reply> {
    request_to(&Target::current(), msg).await
}

/// Send one message to `t`'s machine and wait for the reply. What another machine says is
/// untrusted: its snapshot is cleaned and its words lose their control characters.
pub(crate) async fn request_to(t: &Target, msg: ClientMsg) -> Result<Reply> {
    let (mut r, mut w) = open_cli(t).await?;
    ipc::send(&mut w, &msg).await?;
    loop {
        match ipc::recv_server(&mut r).await? {
            Some(ServerMsg::Reply(reply)) => return t.safe_reply(reply),
            Some(ServerMsg::Error(e)) => bail!(t.plain(&e)),
            // kill-server: the goodbye can overtake the reply.
            Some(ServerMsg::Bye) => return Ok(Reply::Ok),
            Some(ServerMsg::Notice(n)) => eprintln!("{}", t.plain(&n)),
            Some(_) => continue,
            None => bail!("server closed the connection"),
        }
    }
}

pub(crate) fn snapshot() -> Result<Snapshot> {
    snapshot_to(&Target::current())
}

fn snapshot_to(t: &Target) -> Result<Snapshot> {
    match block_on(request_to(t, ClientMsg::Query(Query::List)))? {
        Reply::List(s) => Ok(s),
        _ => bail!("unexpected reply"),
    }
}

fn command(c: Command) -> Result<()> {
    command_to(&Target::current(), c)
}

fn command_to(t: &Target, c: Command) -> Result<()> {
    block_on(request_to(t, ClientMsg::Command(c))).map(|_| ())
}

pub fn pr_link(pane: Option<TermId>, url: Option<String>) -> Result<()> {
    let term = resolve_pane(&Target::current(), pane)?;
    command(Command::LinkPr {
        term,
        url: url.clone(),
    })?;
    match url {
        Some(url) => println!("pane {term} follows {url} now"),
        None => println!("pane {term} follows the pull request on its branch again"),
    }
    Ok(())
}

/// An explicit pane, else the pane this command runs in, else the focused one. The pane a
/// command runs in is on this computer, so another machine's pane is always named.
fn resolve_pane(t: &Target, pane: Option<TermId>) -> Result<TermId> {
    if let Some(p) = pane {
        return Ok(p);
    }
    if !t.owns_env_pane() {
        return Err(t.needs_pane().into());
    }
    if let Some(p) = maitty_shared::brand::env_var("TERM_ID")
        .ok()
        .and_then(|s| s.parse().ok())
    {
        return Ok(p);
    }
    let snap = snapshot_to(t)?;
    snap.active()
        .and_then(|w| w.tab())
        .map(|t| t.focus)
        .ok_or_else(|| anyhow!("no pane to target"))
}

/// Arguments that mean the agent isn't starting a new piece of work: help, version, a
/// one-shot print, picking up an earlier conversation (which lives in the folder it was in),
/// or one of its subcommands.
const NOT_NEW_WORK: [&str; 13] = [
    "-h",
    "--help",
    "-v",
    "-V",
    "--version",
    "-p",
    "--print",
    "-c",
    "--continue",
    "-r",
    "--resume",
    "-w",
    "--worktree",
];
const SUBCOMMANDS: [&str; 22] = [
    "resume",
    "exec",
    "e",
    "login",
    "logout",
    "mcp",
    "mcp-server",
    "config",
    "update",
    "upgrade",
    "doctor",
    "install",
    "plugin",
    "setup-token",
    "migrate-installer",
    "completion",
    "apply",
    "sandbox",
    "debug",
    "app-server",
    "secret",
    "pr",
];

/// Whether `agent args…` starts new work (which gets its own worktree).
pub(crate) fn starts_new_work(agent: &str, args: &[String]) -> bool {
    if agent == "codex" {
        return codex_starts_new_work(args);
    }
    let sub = args
        .first()
        .is_some_and(|a| SUBCOMMANDS.contains(&a.as_str()));
    !sub && !args.iter().any(|a| {
        NOT_NEW_WORK.contains(&a.as_str())
            || a.starts_with("--resume=")
            || a.starts_with("--worktree=")
    })
}

const CODEX_SUBCOMMANDS: &[&str] = &[
    "agents",
    "exec",
    "e",
    "review",
    "login",
    "logout",
    "mcp",
    "mcp-server",
    "plugin",
    "app-server",
    "remote-control",
    "app",
    "completion",
    "update",
    "doctor",
    "sandbox",
    "debug",
    "apply",
    "a",
    "resume",
    "queue",
    "archive",
    "delete",
    "migrate-rollouts",
    "unarchive",
    "fork",
    "cloud",
    "exec-server",
    "features",
    "help",
];
const CODEX_VALUE_OPTIONS: &[&str] = &[
    "-c",
    "--config",
    "-p",
    "--profile",
    "-m",
    "--model",
    "-i",
    "--image",
    "-s",
    "--sandbox",
    "-a",
    "--ask-for-approval",
    "--remote",
    "--remote-auth-token-env",
    "--local-provider",
    "--add-dir",
    "--enable",
    "--disable",
];

fn codex_starts_new_work(args: &[String]) -> bool {
    let mut args = args.iter();
    let mut has_prompt = false;
    while let Some(arg) = args.next() {
        if arg == "--" {
            return true;
        }
        if matches!(
            arg.as_str(),
            "-h" | "--help" | "-v" | "-V" | "--version" | "-w" | "--worktree" | "-C" | "--cd"
        ) || arg.starts_with("--worktree=")
            || arg.starts_with("--cd=")
            || arg.starts_with("-C")
        {
            return false;
        }
        // Codex uses -c/-p for configuration/profile, unlike Claude's continue/print.
        // Their values can also be command names, so consume them before looking for one.
        if CODEX_VALUE_OPTIONS.contains(&arg.as_str()) {
            args.next();
        } else if !arg.starts_with('-') && !has_prompt {
            if CODEX_SUBCOMMANDS.contains(&arg.as_str()) {
                return false;
            }
            has_prompt = true;
        }
    }
    true
}

/// `<app> agent-dir <agent> [args…]`, run by a pane's shell just before it starts an agent:
/// prints the folder to start in (a new worktree), or nothing to start where it is. Never
/// fails: the agent starts either way.
pub fn agent_dir(cmd: &[String]) {
    if let Some(path) = agent_worktree(cmd) {
        println!("{}", path.display());
    }
}

/// The folder `agent_dir` names, if the agent should start somewhere else than here. The
/// daemon decides, from the pane's own id and secret (`ipc::open`); this only says who is
/// asking and what for.
fn agent_worktree(cmd: &[String]) -> Option<PathBuf> {
    let agent = cmd.first().map(String::as_str).unwrap_or_default();
    if maitty_shared::brand::env_var_os("TERM_ID").is_none()
        || !starts_new_work(agent, cmd.get(1..).unwrap_or_default())
    {
        return None;
    }
    let dir = std::env::current_dir().ok()?;
    match block_on(request(ClientMsg::Command(Command::AgentWorktree { dir }))) {
        Ok(Reply::Text(path)) if !path.is_empty() => {
            eprintln!("{APP_COMMAND}: {agent} gets its own worktree: {path}");
            Some(PathBuf::from(path))
        }
        Ok(_) => None,
        Err(e) => {
            eprintln!("{APP_COMMAND}: no worktree for it ({e:#}), so it starts here");
            None
        }
    }
}

/// `<app> agent-launch <agent> [args…]`, what the Windows launchers (`shim.rs`) run: the
/// work of the PATH launcher on Unix. Starts the next `<agent>` on PATH after the launchers'
/// folder, in the folder `agent-dir` names, and returns its exit code.
pub fn agent_launch(cmd: &[String]) -> i32 {
    const NOT_FOUND: i32 = 9009;
    let Some(agent) = cmd.first() else { return 1 };
    let shim = crate::shim::dir();
    let path = std::env::var_os("PATH").unwrap_or_default();
    let extensions: Vec<String> = std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(str::to_string)
        .collect();
    let Some(real) = crate::shim::find_on_path(agent, &path, &shim, &extensions) else {
        eprintln!(
            "'{agent}' is not recognized as an internal or external command, operable program or batch file."
        );
        return NOT_FOUND;
    };
    let mut run = std::process::Command::new(real);
    run.args(&cmd[1..])
        .env("PATH", crate::shim::path_without(&shim, &path));
    for name in crate::shim::done_vars() {
        run.env_remove(name);
    }
    if !crate::shim::is_done()
        && let Some(dir) = agent_worktree(cmd)
    {
        run.current_dir(dir);
    }
    let mut child = match run.spawn() {
        Ok(child) => child,
        Err(e) => {
            eprintln!("{APP_COMMAND}: could not start {agent}: {e}");
            return 1;
        }
    };
    // Ctrl+C on the console reaches every process on it. The agent handles its own; this
    // launcher must outlive it, or the shell gets its prompt back ("Terminate batch job?")
    // while the agent still runs and both read the keys.
    #[cfg(windows)]
    ignore_console_interrupts();
    match child.wait() {
        Ok(status) => status.code().unwrap_or(1),
        Err(e) => {
            eprintln!("{APP_COMMAND}: lost {agent}: {e}");
            1
        }
    }
}

/// Take Ctrl+C and Ctrl+Break as handled in this process only. A handler of our own, unlike
/// ignoring them outright, is not inherited, so the agent started before it keeps its own.
#[cfg(windows)]
fn ignore_console_interrupts() {
    use windows_sys::Win32::System::Console::{CTRL_BREAK_EVENT, CTRL_C_EVENT, SetConsoleCtrlHandler};
    unsafe extern "system" fn handled(event: u32) -> windows_sys::core::BOOL {
        i32::from(event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT)
    }
    // SAFETY: registers a plain function that touches nothing; it lives for the whole process.
    if unsafe { SetConsoleCtrlHandler(Some(handled), 1) } == 0 {
        tracing::debug!("could not take Ctrl+C in the launcher: {}", std::io::Error::last_os_error());
    }
}

pub fn ls(t: &Target, as_json: bool) -> Result<()> {
    let snap = snapshot_to(t)?;
    if as_json {
        println!(
            "{}",
            serde_json::to_string_pretty(&workspaces_json(&snap, t.name()))?
        );
        return Ok(());
    }
    for line in workspace_lines(&snap, t) {
        println!("{line}");
    }
    Ok(())
}

/// The workspaces as `ls --json` prints them; `machine` tags each when a machine was named.
pub(crate) fn workspaces_json(snap: &Snapshot, machine: Option<&str>) -> Vec<Value> {
    snap.workspaces
        .iter()
        .map(|w| {
            let mut ws = json!({
                "id": w.id, "name": w.name, "cwd": w.cwd, "active": Some(w.id) == snap.active_ws,
                "git": w.git, "worktree": w.worktree, "color": w.color,
                "tabs": w.tabs.iter().map(|t| json!({
                    "id": t.id, "name": t.name, "active": t.id == w.active_tab, "focus": t.focus,
                    "panes": t.layout.leaves().iter().filter_map(|id| snap.terms.get(id)).map(pane_json).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            });
            if let Some(machine) = machine {
                ws["machine"] = json!(machine);
            }
            ws
        })
        .collect()
}

/// The workspaces as `ls` prints them. A machine that was named heads the list and its panes
/// are written as addresses (`build/4`), so a line can be pasted into `--pane`.
pub(crate) fn workspace_lines(snap: &Snapshot, target: &Target) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(name) = target.name() {
        lines.push(format!("machine {name}"));
    }
    for w in &snap.workspaces {
        let mark = if Some(w.id) == snap.active_ws {
            "*"
        } else {
            " "
        };
        let git = w
            .git
            .as_ref()
            .map(|g| {
                format!(
                    "  [{}{}]",
                    g.branch,
                    if g.dirty > 0 {
                        format!(" ±{}", g.dirty)
                    } else {
                        String::new()
                    }
                )
            })
            .unwrap_or_default();
        lines.push(format!(
            "{mark} {} {}{git}  ({})",
            w.id,
            w.name,
            w.cwd.display()
        ));
        for (i, t) in w.tabs.iter().enumerate() {
            let mark = if t.id == w.active_tab { "*" } else { " " };
            lines.push(format!("  {mark} tab {} {}", i + 1, t.name));
            for id in t.layout.leaves() {
                let Some(p) = snap.terms.get(&id) else {
                    continue;
                };
                let focus = if id == t.focus { ">" } else { " " };
                let agent = agent_tag(p)
                    .map(|tag| format!("  [{tag}]"))
                    .unwrap_or_default();
                lines.push(format!(
                    "    {focus} pane {}  {}{agent}",
                    target.address(id),
                    p.process
                ));
            }
        }
    }
    lines
}

/// `--raw` leaves another machine's screen as it sent it, escape sequences and all.
pub fn read(t: &Target, pane: Option<TermId>, raw: bool) -> Result<()> {
    let term = resolve_pane(t, pane)?;
    match block_on(request_to(t, ClientMsg::Query(Query::Read { term })))? {
        Reply::Text(screen) => {
            let screen = if raw { screen } else { t.plain(&screen) };
            println!("{}", screen.trim_end());
            Ok(())
        }
        _ => bail!("unexpected reply"),
    }
}

/// The model the agent last answered with and the name given to the conversation, from the
/// end of a Claude transcript (JSON lines).
pub fn transcript_facts(path: &std::path::Path) -> (Option<String>, Option<String>) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return (None, None);
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(512 * 1024)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    transcript_facts_in(&String::from_utf8_lossy(&buf))
}

/// The name: what you called it (/rename) wins over the title Claude made up.
pub fn transcript_facts_in(text: &str) -> (Option<String>, Option<String>) {
    let (mut model, mut name, mut ai) = (None, None, None);
    for line in text.lines().rev() {
        if model.is_some() && name.is_some() {
            break;
        }
        let maybe_model = model.is_none() && line.contains("\"model\"");
        let maybe_name = name.is_none() && line.contains("\"customTitle\"");
        let maybe_ai = ai.is_none() && line.contains("\"aiTitle\"");
        if !maybe_model && !maybe_name && !maybe_ai {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let title = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .filter(|t| !t.trim().is_empty())
                .map(|t| one_line(t, 80))
        };
        if maybe_name {
            name = title("customTitle");
        }
        if maybe_ai {
            ai = title("aiTitle");
        }
        if maybe_model
            && v.get("type").and_then(Value::as_str) == Some("assistant")
            && let Some(m) = v
                .pointer("/message/model")
                .and_then(Value::as_str)
                .filter(|m| !m.starts_with('<'))
        {
            model = Some(short_model(m));
        }
    }
    (model, name.or(ai))
}

/// "claude-opus-4-5-20251101" → "opus 4.5"; other names as they are.
pub fn short_model(m: &str) -> String {
    let Some(rest) = m.strip_prefix("claude-") else {
        return m.to_string();
    };
    let parts: Vec<&str> = rest.split('-').filter(|p| p.len() < 8).collect();
    let family: Vec<&str> = parts
        .iter()
        .copied()
        .filter(|p| !p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let version: Vec<&str> = parts
        .iter()
        .copied()
        .filter(|p| p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let mut out = family.join(" ");
    if !version.is_empty() {
        out.push(' ');
        out.push_str(&version.join("."));
    }
    if out.is_empty() { m.to_string() } else { out }
}

/// What a wait ended on.
#[derive(Debug, Clone, PartialEq)]
pub enum Waited {
    /// The turn ended: its status then, its last message (if hooks said) and, when the
    /// project has a check, how that came out.
    Turn(Status, String, Option<Box<CheckInfo>>),
    /// The regex matched this line.
    Matched(String),
    /// Out of time; `quiet` when the session was working but silent, since then (unix seconds);
    /// `repeats` when it was working and repeating itself, how many calls the repeat had reached.
    TimedOut {
        quiet: Option<u64>,
        repeats: Option<u32>,
    },
}

/// `<app> wait` exits with this when the turn ended but its check failed (2: timed out;
/// 3: needs you).
const EXIT_CHECK_FAILED: i32 = 4;

/// How long a session may show no status before the wait calls its quiet the end of a turn.
const QUIET_TURN_AFTER: Duration = Duration::from_secs(8);

/// Whether a turn is over given what the pane shows: it was working (`seen_working`), or
/// the wait has run past `QUIET_TURN_AFTER` (`quiet`). A turn with checkpoints is not over
/// until none is running or waiting its turn; it ends on the headline one.
fn turn_over(
    status: Status,
    said: &str,
    checks: &[CheckInfo],
    seen_working: bool,
    quiet: bool,
) -> Option<Waited> {
    let ended = match status {
        Status::Blocked | Status::Done | Status::Idle => seen_working || quiet,
        Status::None => quiet,
        Status::Working => false,
    };
    if !ended
        || checks
            .iter()
            .any(|c| matches!(c.state, CheckState::Checking | CheckState::Pending))
    {
        return None;
    }
    let said = if status == Status::None {
        String::new()
    } else {
        said.to_string()
    };
    Some(Waited::Turn(
        status,
        said,
        headline(checks).cloned().map(Box::new),
    ))
}

/// How `<app> wait` exits once the turn is over, when not 0: 3 when the agent needs you, 4
/// when a checkpoint failed (`headline` is the worst). Every other result, a stale pass or a
/// check that did not run included, says nothing against the work.
fn turn_exit(status: Status, headline: Option<&CheckInfo>) -> Option<i32> {
    if status == Status::Blocked {
        return Some(3);
    }
    headline
        .is_some_and(|c| c.state == CheckState::Failed)
        .then_some(EXIT_CHECK_FAILED)
}

/// The check's result in one line, for a waiter to read beside the reply.
pub fn check_line(c: &CheckInfo) -> String {
    let exit = c
        .exit_code
        .map(|code| format!(" (exit {code})"))
        .unwrap_or_default();
    let line = if c.first_failing_line.is_empty() {
        String::new()
    } else {
        format!(": {}", c.first_failing_line)
    };
    match c.state {
        CheckState::Checking => format!("checking: {}", c.command),
        CheckState::Passed => format!("check passed: {}", c.command),
        CheckState::Failed => format!("check failed: {}{exit}{line}", c.command),
        CheckState::Overridden => format!("check failed, accepted: {}{exit}{line}", c.command),
        CheckState::CouldNotRun => format!("check could not run: {}", c.command),
        CheckState::Pending => format!("pending: {}", c.command),
        CheckState::NeedsApproval | CheckState::Stale | CheckState::Never => check_note(c),
    }
}

/// What a check adds beside the status in `<app> ls` and `<app>_list`: `check failed (exit 1)`.
pub fn check_note(c: &CheckInfo) -> String {
    match (c.state, c.exit_code) {
        (CheckState::Checking, _) => "checking".into(),
        (CheckState::Passed, _) => "check passed".into(),
        (CheckState::Failed, Some(code)) => format!("check failed (exit {code})"),
        (CheckState::Failed, None) => "check failed".into(),
        (CheckState::Overridden, _) => "check overridden".into(),
        (CheckState::CouldNotRun, _) => "check could not run".into(),
        (CheckState::Pending, _) => "pending".into(),
        (CheckState::NeedsApproval, _) => format!("approve check: {}", c.command),
        (CheckState::Stale, _) => format!(
            "stale pass: {} · {}",
            checkpoint_name(c),
            files_changed(c.changed_files.len())
        ),
        (CheckState::Never, _) => "not checked: never for this repo".into(),
    }
}

/// A checkpoint's name, or `check` for one that has none.
fn checkpoint_name(c: &CheckInfo) -> &str {
    if c.name.is_empty() { "check" } else { &c.name }
}

fn files_changed(n: usize) -> String {
    if n == 1 {
        "1 file changed".into()
    } else {
        format!("{n} files changed")
    }
}

/// The headline checkpoint's note, and how many there are when there are several:
/// `check failed (exit 1) · 2 checkpoints`.
pub fn checks_note(p: &TermInfo) -> Option<String> {
    let note = check_note(p.reported_check()?);
    Some(if p.checks.len() > 1 {
        format!("{note} · {} checkpoints", p.checks.len())
    } else {
        note
    })
}

/// `claude: done · check failed (exit 1)`, for an agent pane.
fn agent_tag(p: &TermInfo) -> Option<String> {
    let agent = p.agent.as_deref()?;
    let quiet = quiet_note(p).map(|n| format!(" · {n}")).unwrap_or_default();
    let repeating = repeat_note(p).map(|n| format!(" · {n}")).unwrap_or_default();
    let note = checks_note(p)
        .map(|n| format!(" · {n}"))
        .unwrap_or_default();
    Some(format!("{agent}: {}{quiet}{repeating}{note}", p.status.label()))
}

/// `quiet 12m` for a working agent that has gone silent: it may be stuck.
pub fn quiet_note(p: &TermInfo) -> Option<String> {
    p.quiet_since
        .filter(|_| p.status == Status::Working)
        .map(|at| format!("quiet {}", quiet_for(at)))
}

/// `repeating 6x` for a working agent whose last tool calls are one call over and over, or two
/// taking turns: it may be going nowhere. Its status stays working.
pub fn repeat_note(p: &TermInfo) -> Option<String> {
    p.repeats
        .filter(|_| p.status == Status::Working)
        .map(|n| format!("repeating {n}x"))
}

/// What a wait that ran out of time says about an agent still working, when something looks
/// wrong with it. Silence is the stronger sign, so a quiet agent says that first.
pub fn still_working_note(quiet: Option<u64>, repeats: Option<u32>) -> Option<String> {
    match (quiet, repeats) {
        (Some(at), _) => Some(format!("still working, but quiet for {}", quiet_for(at))),
        (None, Some(n)) => Some(format!("still working, but repeating itself ({n}x)")),
        (None, None) => None,
    }
}

/// How long since `at` (unix seconds), shortest unit: `45s`, `12m`, `3h`, `2d`.
pub fn quiet_for(at: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let s = now.saturating_sub(at);
    match s {
        0..=59 => format!("{s}s"),
        60..=3599 => format!("{}m", s / 60),
        3600..=86_399 => format!("{}h", s / 3600),
        _ => format!("{}d", s / 86_400),
    }
}

/// One pane in `<app> ls --json`.
fn pane_json(p: &TermInfo) -> Value {
    let mut v = json!({
        "id": p.id, "process": p.process, "title": p.title, "agent": p.agent, "asleep": p.asleep, "status_why": p.status_why, "win32_input": p.win32_input, "model": p.model, "name": p.name, "mem_mb": p.mem >> 20, "bell": p.bell,
        "status": p.status.label(), "cols": p.cols, "rows": p.rows, "cwd": p.cwd,
    });
    if let Some(at) = p.quiet_since.filter(|_| p.status == Status::Working) {
        v["quiet_since"] = json!(at);
    }
    if let Some(n) = p.repeats.filter(|_| p.status == Status::Working) {
        v["repeats"] = json!(n);
    }
    if let Some(pr) = &p.pr {
        v["pr"] = pr_json(pr);
    }
    if let Some(c) = p.reported_check() {
        v["check"] = json!({
            "state": c.state.label(), "command": c.command, "exit_code": c.exit_code, "duration_ms": c.duration_ms,
            "first_failing_line": c.first_failing_line, "rerun_queued": c.rerun_queued, "overridden_at": c.overridden_at,
        });
        v["checks"] = p.checks.iter().map(checkpoint_json).collect();
    }
    v
}

pub(crate) fn pr_json(pr: &crate::protocol::PrInfo) -> Value {
    json!({
        "number": pr.number, "url": pr.url, "title": pr.title,
        "state": format!("{:?}", pr.state).to_lowercase(), "draft": pr.draft,
        "checks": { "passed": pr.checks.passed, "pending": pr.checks.pending, "failed": pr.checks.failed },
        "review": format!("{:?}", pr.review).to_lowercase(), "conflicting": pr.conflicting, "summary": pr.headline(),
    })
}

/// One checkpoint in `<app> ls --json`'s `checks`.
fn checkpoint_json(c: &CheckInfo) -> Value {
    json!({
        "name": c.name, "state": c.state.label(), "command": c.command, "exit_code": c.exit_code, "duration_ms": c.duration_ms,
        "first_failing_line": c.first_failing_line, "line_count": c.line_count, "turn": c.turn, "rerun_queued": c.rerun_queued,
        "overridden_at": c.overridden_at, "overridden_by": c.overridden_by, "stale_since": c.stale_since,
        "changed_files": c.changed_files.iter().map(|f| json!({ "kind": f.kind.to_string(), "path": f.path })).collect::<Vec<_>>(),
    })
}

/// Wait on pane `term`: for its turn to end (it was working, now it isn't; a prompt that
/// never starts a turn counts as ended after a few seconds), or for `regex` on its screen.
/// `just_sent`: the turn hasn't started yet, so wait for it to start first. A session with a
/// check is waited on until the check has answered, within `timeout`.
pub fn wait_on(
    t: &Target,
    term: TermId,
    regex: Option<&str>,
    timeout: Duration,
    just_sent: bool,
) -> Result<Waited> {
    let re = regex
        .map(|r| regex::RegexBuilder::new(r).case_insensitive(true).build())
        .transpose()
        .context("bad --regex")?;
    let start = std::time::Instant::now();
    let mut seen_working = !just_sent;
    let mut quiet = None;
    let mut repeats = None;
    loop {
        if let Some(re) = &re {
            if let Reply::Text(screen) =
                block_on(request_to(t, ClientMsg::Query(Query::Read { term })))?
                && let Some(l) = screen.lines().find(|l| re.is_match(l))
            {
                return Ok(Waited::Matched(t.plain(l.trim())));
            }
        } else {
            let snap = snapshot_to(t)?;
            let t = snap
                .terms
                .get(&term)
                .ok_or_else(|| anyhow!("pane {term} is gone"))?;
            seen_working |= t.status == Status::Working;
            quiet = t.quiet_since.filter(|_| t.status == Status::Working);
            repeats = t.repeats.filter(|_| t.status == Status::Working);
            if let Some(done) = turn_over(
                t.status,
                &t.said,
                &t.checks,
                seen_working,
                start.elapsed() > QUIET_TURN_AFTER,
            ) {
                return Ok(done);
            }
        }
        if start.elapsed() >= timeout {
            return Ok(Waited::TimedOut { quiet, repeats });
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

pub fn send_wait(
    t: &Target,
    pane: Option<TermId>,
    text: String,
    enter: bool,
    timeout: u64,
) -> Result<()> {
    let term = resolve_pane(t, pane)?;
    send(t, Some(term), text, enter)?;
    wait_print(t, term, None, timeout, true)
}

pub fn wait(t: &Target, pane: Option<TermId>, regex: Option<String>, timeout: u64) -> Result<()> {
    wait_print(t, resolve_pane(t, pane)?, regex, timeout, false)
}

/// `<app> wait` / `<app> send --wait`: wait, then print the reply (or the screen's end).
fn wait_print(
    t: &Target,
    term: TermId,
    regex: Option<String>,
    timeout: u64,
    just_sent: bool,
) -> Result<()> {
    match wait_on(
        t,
        term,
        regex.as_deref(),
        Duration::from_secs(timeout),
        just_sent,
    )? {
        Waited::Matched(l) => println!("{l}"),
        Waited::Turn(s, said, check) => {
            if s == Status::Blocked {
                eprintln!("(pane {term} needs you)");
            }
            if let Some(c) = &check {
                eprintln!("({})", check_line(c));
            }
            if said.trim().is_empty() {
                if let Reply::Text(screen) =
                    block_on(request_to(t, ClientMsg::Query(Query::Read { term })))?
                {
                    let screen = t.plain(&screen);
                    let lines: Vec<&str> = screen.trim_end().lines().collect();
                    println!("{}", lines[lines.len().saturating_sub(30)..].join("\n"));
                }
            } else {
                println!("{}", said.trim_end());
            }
            if let Some(code) = turn_exit(s, check.as_deref()) {
                std::process::exit(code);
            }
        }
        Waited::TimedOut { quiet, repeats } => {
            match still_working_note(quiet, repeats) {
                Some(note) => eprintln!("timed out waiting on pane {term}: {note}"),
                None => eprintln!("timed out waiting on pane {term}"),
            }
            std::process::exit(2);
        }
    }
    Ok(())
}

pub fn send(t: &Target, pane: Option<TermId>, text: String, enter: bool) -> Result<()> {
    crate::hidden::check(&text).map_err(|e| anyhow!(e))?;
    let term = resolve_pane(t, pane)?;
    block_on(async move {
        let (_r, mut w) = open_cli(t).await?;
        let data = if text.contains('\n') {
            format!("\x1b[200~{text}\x1b[201~")
        } else {
            text
        };
        ipc::send(
            &mut w,
            &ClientMsg::Input {
                term,
                data: data.into_bytes(),
            },
        )
        .await?;
        if enter {
            // A separate write so the program reads the text before the Enter.
            tokio::time::sleep(Duration::from_millis(30)).await;
            ipc::send(
                &mut w,
                &ClientMsg::Input {
                    term,
                    data: b"\r".to_vec(),
                },
            )
            .await?;
        }
        tokio::time::sleep(Duration::from_millis(30)).await;
        Ok(())
    })
}

/// Send key presses (`ctrl+space`, `%`, `enter`), encoded the way a terminal would.
pub fn send_keys(t: &Target, pane: Option<TermId>, keys: Vec<String>) -> Result<()> {
    let term = resolve_pane(t, pane)?;
    let mut chunks = Vec::new();
    for k in &keys {
        let spec: crate::keys::KeySpec = k.parse()?;
        let ev = ratatui::crossterm::event::KeyEvent::new(spec.code, spec.mods);
        chunks.push(crate::keys::encode(&ev, false));
    }
    block_on(async move {
        let (_r, mut w) = open_cli(t).await?;
        for data in chunks {
            ipc::send(&mut w, &ClientMsg::Input { term, data }).await?;
            // One key per beat, like a person typing; lets modes change between keys.
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
        Ok(())
    })
}

fn join_command(parts: Vec<String>) -> Option<String> {
    (!parts.is_empty()).then(|| parts.join(" "))
}

pub fn split(t: &Target, pane: Option<TermId>, down: bool, command: Vec<String>) -> Result<()> {
    let term = resolve_pane(t, pane)?;
    let dir = if down { Dir::Down } else { Dir::Right };
    command_to(
        t,
        Command::Split {
            term,
            dir,
            cmd: join_command(command),
            cwd: None,
        },
    )
}

/// `<app> handoff <pane> --to <agent>`: start `to` beside `pane`, in its checkout, with a
/// text brief of what the pane was doing as its first prompt. The old pane is left alone.
pub fn handoff(target: &Target, pane: TermId, to: String) -> Result<()> {
    let (cfg, _) = crate::config::Config::load_or_default();
    let before = snapshot_to(target)?;
    let from = handoff::check(&cfg, pane, before.terms.get(&pane), &to).map_err(|e| anyhow!(e))?;
    let t = &before.terms[&pane];
    let screen = match block_on(request_to(
        target,
        ClientMsg::Query(Query::Read { term: pane }),
    ))? {
        Reply::Text(s) => target.plain(&s),
        _ => bail!("unexpected reply"),
    };
    let checkout = t.top.clone().unwrap_or_else(|| t.cwd.clone());
    let changed = if target.is_remote() {
        Err("git isn't run on the remote machine".into())
    } else {
        handoff::changed_files(&checkout, t.root.as_deref())
    };
    let facts = handoff::Facts {
        pane,
        agent: from,
        task: t.name.clone(),
        last_prompt: t.summary.clone(),
        branch: t.branch.clone(),
        checkout: checkout.clone(),
        changed,
        screen,
    };
    let cmd = cfg
        .agent_command(Some(&to), None, &handoff::brief(&facts))
        .map_err(|e| anyhow!(e))?;
    let had: Vec<TermId> = before.terms.keys().copied().collect();
    command_to(
        target,
        Command::Split {
            term: pane,
            dir: Dir::Right,
            cmd: Some(cmd),
            cwd: Some(checkout),
        },
    )?;
    for _ in 0..60 {
        std::thread::sleep(Duration::from_millis(250));
        let Ok(now) = snapshot_to(target) else {
            continue;
        };
        if let Some(new) = handoff::new_pane(&had, now.terms.keys().copied()) {
            let t = &now.terms[&new];
            println!(
                "handed pane {} to {to}: pane {} in {}",
                target.address(pane),
                target.address(new),
                t.top.as_ref().unwrap_or(&t.cwd).display()
            );
            return Ok(());
        }
    }
    println!("asked {APP_COMMAND} to start {to}; it hasn't appeared yet");
    Ok(())
}

/// The folder a command starts in. This computer's folders mean nothing on another machine,
/// so there it is the daemon's default unless `path` is given (as it is spelled there).
fn start_dir(t: &Target, path: Option<PathBuf>) -> Option<PathBuf> {
    if t.is_remote() {
        return path;
    }
    path.or_else(|| std::env::current_dir().ok())
        .map(|p| p.canonicalize().unwrap_or(p))
}

pub fn new_workspace(
    t: &Target,
    path: Option<PathBuf>,
    name: Option<String>,
    cmd: Vec<String>,
) -> Result<()> {
    command_to(
        t,
        Command::NewWorkspace {
            cwd: start_dir(t, path),
            name,
            cmd: join_command(cmd),
        },
    )
}

pub fn focus(t: &Target, pane: TermId) -> Result<()> {
    command_to(t, Command::FocusPane { term: pane })
}

/// The session you're on, if a server is running.
pub fn focused_pane() -> Option<TermId> {
    let s = snapshot().ok()?;
    s.workspaces
        .iter()
        .find(|w| Some(w.id) == s.active_ws)?
        .tab()
        .map(|t| t.focus)
}

/// `<app> popup -- <command>`: a floating pane in the folder you're in.
pub fn popup(t: &Target, cmd: Vec<String>) -> Result<()> {
    let cmd = join_command(cmd).ok_or_else(|| {
        anyhow!(concat!(
            "what to run: ",
            env!("APP_COMMAND"),
            " popup -- fzf"
        ))
    })?;
    command_to(
        t,
        Command::Popup {
            cmd,
            cwd: start_dir(t, None),
        },
    )
}

/// `<app> grant <pane> read,write,…|default`.
pub fn grant(t: &Target, term: TermId, grants: &str) -> Result<()> {
    let list = (grants.trim() != "default").then(|| {
        grants
            .split(',')
            .map(|g| g.trim().to_lowercase())
            .filter(|g| !g.is_empty())
            .collect::<Vec<_>>()
    });
    command_to(
        t,
        Command::Grant {
            term,
            grants: list.clone(),
        },
    )?;
    let pane = t.address(term);
    match list {
        Some(l) if l.is_empty() => {
            println!("pane {pane} may do nothing through {APP_COMMAND} but its own work")
        }
        Some(l) => println!("pane {pane} may: {}", l.join(", ")),
        None => println!("pane {pane} is back to the default grants ([mcp] grants in config)"),
    }
    Ok(())
}

/// `<app> ask-human "…?" -o Yes -o No`: ask the person, wait, print the answer.
pub fn ask_human(text: String, options: Vec<String>) -> Result<()> {
    let term = resolve_pane(&Target::current(), None).context(concat!(
        "run it in a ",
        env!("APP_COMMAND"),
        " pane (the question shows there)"
    ))?;
    match block_on(request(ClientMsg::Command(Command::AskHuman {
        term,
        text,
        options,
    })))? {
        Reply::Text(answer) => {
            println!("{answer}");
            Ok(())
        }
        _ => bail!("no answer"),
    }
}

/// `<app> teach [pane]`: the program running there is an agent.
pub fn teach(t: &Target, pane: Option<TermId>) -> Result<()> {
    let term = resolve_pane(t, pane)?;
    command_to(t, Command::TeachAgent { term })?;
    println!(
        concat!(
            env!("APP_COMMAND"),
            " knows it as an agent now (see [[agents]] in {})"
        ),
        crate::config::config_path().display()
    );
    Ok(())
}

/// Focus a pane and bring the app's window forward (what clicking a notification does).
pub fn reveal(pane: TermId) -> Result<()> {
    command(Command::Reveal { term: pane })
}

pub fn close(t: &Target, pane: Option<TermId>) -> Result<()> {
    command_to(
        t,
        Command::ClosePane {
            term: resolve_pane(t, pane)?,
        },
    )
}

/// Whether the app's server is running (for this socket).
pub(crate) fn server_running() -> bool {
    block_on(async { ipc::connect().await.map(|_| ()) }).is_ok()
}

pub fn kill_server(t: &Target, forget: bool) -> Result<()> {
    let remote = t.is_remote();
    if !remote && !server_running() {
        if forget {
            maitty_core::forget_session();
        }
        println!(concat!(
            "no ",
            env!("APP_COMMAND"),
            " server is running; nothing to stop"
        ));
        return Ok(());
    }
    match command_to(t, Command::KillServer { forget }) {
        // Another version can't be asked to stop: stop its process instead.
        Err(e) if !remote && ipc::other_version(&e).is_some() => {
            let pid = stop_server_process()?;
            if forget {
                maitty_core::forget_session();
            }
            println!("stopped the server (another {APP_COMMAND} version, process {pid})");
            Ok(())
        }
        // It answers, then lets go of its socket a moment later: a server started right
        // after would find it.
        Ok(()) if !remote => restart::wait_until_server_gone(),
        r => r,
    }
}

/// The word `restart-if-idle` leads with when it leaves the server alone; `machine update` reads it
/// from the far side's reply, so the two must agree.
pub(crate) const LEFT_RUNNING: &str = "left running";

/// What `machine update` asks of the server it leaves running (it runs this over ssh): stop
/// it so the next start is the new version. Without `now` only when no session is open; with
/// `now` also when sessions are open but saved, because the next server restores them and
/// resumes their agents (a turn in progress is lost). A server whose sessions are not saved is
/// always left alone, and so is one that already runs this version.
pub fn restart_if_idle(when: RestartWhen) -> Result<()> {
    if !server_running() {
        println!("no server is running");
        return Ok(());
    }
    let published = crate::restart::read();
    if crate::restart::is_running(published.as_ref(), APP_VERSION) {
        println!("current: the server already runs {APP_VERSION}");
        return Ok(());
    }
    let saved = || crate::restart::session_is_saved();
    let may_restart = match when {
        RestartWhen::Now => crate::restart::may_restart_now(published.as_ref(), saved()),
        RestartWhen::AgentsIdle => {
            crate::restart::may_restart_with_agents_idle(published.as_ref(), saved())
        }
        RestartWhen::NoSession => crate::restart::idle_enough_to_restart(published.as_ref()),
    };
    if !may_restart {
        match published {
            Some(a) if when == RestartWhen::AgentsIdle && a.busy() > 0 => println!(
                "{LEFT_RUNNING}: {} agent(s) working or waiting",
                a.busy()
            ),
            Some(a) => println!(
                "{LEFT_RUNNING}: {} open session(s); it keeps them",
                a.sessions
            ),
            None => println!("{LEFT_RUNNING}: it did not say whether sessions are open"),
        }
        return Ok(());
    }
    kill_server(&Target::current(), false)?;
    println!(
        "{}",
        match published {
            Some(a) if a.sessions > 0 =>
                "restarted: sessions were saved and come back with the new version",
            _ => "restarted: no session was open",
        }
    );
    Ok(())
}

/// What `machine update` asks over ssh before it restarts anything: one line with the sessions
/// open on this machine and how many are mid-turn. It only reads what the server published.
pub fn activity() -> Result<()> {
    if !server_running() {
        println!("activity: sessions=0 busy=0");
        return Ok(());
    }
    match crate::restart::read() {
        Some(a) => println!("activity: sessions={} busy={}", a.sessions, a.busy()),
        None => println!("activity: unknown"),
    }
    Ok(())
}

/// Stop this socket's server by its process, for when it's a version that can't be talked
/// to. Its saved session stays, as with `kill-server`.
fn stop_server_process() -> Result<u32> {
    let pid = server_pid()
        .filter(|pid| is_app_daemon(*pid))
        .ok_or_else(|| {
            anyhow!(concat!(
                "couldn't find the server's process; stop it yourself (on Linux/macOS: pkill -f \"",
                env!("APP_COMMAND"),
                " daemon\"; on Windows: end ",
                env!("APP_COMMAND"),
                ".exe in Task Manager)"
            ))
        })?;
    let killed = if cfg!(windows) {
        crate::proc::run(std::process::Command::new("taskkill").args([
            "/PID",
            &pid.to_string(),
            "/F",
        ]))
    } else {
        crate::proc::run(std::process::Command::new("kill").arg(pid.to_string()))
    };
    killed.map_err(|e| anyhow!("couldn't stop the server (process {pid}): {e}"))?;
    // Wait for it to let go of its socket, so the next start doesn't find it.
    for _ in 0..40 {
        if block_on(ipc::connect()).is_err() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let _ = std::fs::remove_file(ipc::pid_file());
    Ok(pid)
}

/// Whether `pid` is a `<app> daemon` process, so a stale pid file can't point a stop at
/// something else that took the number.
fn is_app_daemon(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
            return false;
        };
        let args: Vec<&[u8]> = cmdline.split(|b| *b == 0).collect();
        args.first()
            .is_some_and(|a| a.ends_with(crate::brand::APP_COMMAND.as_bytes()))
            && args.get(1) == Some(&b"daemon".as_slice())
    }
    #[cfg(not(target_os = "linux"))]
    {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let pid = Pid::from_u32(pid);
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[pid]),
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        system.process(pid).is_some_and(|process| {
            let command = process.cmd();
            let program = command.first().map(std::path::Path::new).and_then(|p| p.file_stem());
            program.is_some_and(|stem| stem.eq_ignore_ascii_case(crate::brand::APP_COMMAND))
                && command.get(1).is_some_and(|argument| argument == "daemon")
        })
    }
}

/// This socket's server process: from the id it noted, or (servers too old to note it) the
/// one running `<app> daemon` for this socket.
fn server_pid() -> Option<u32> {
    if let Some(pid) = std::fs::read_to_string(ipc::pid_file())
        .ok()
        .and_then(|s| s.trim().parse().ok())
    {
        return Some(pid);
    }
    #[cfg(target_os = "linux")]
    {
        let label =
            maitty_shared::brand::env_var("SOCKET").unwrap_or_else(|_| "default".into());
        let me = std::process::id();
        for entry in std::fs::read_dir("/proc").ok()?.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            if pid == me {
                continue;
            }
            let Ok(cmdline) = std::fs::read(entry.path().join("cmdline")) else {
                continue;
            };
            let args: Vec<&[u8]> = cmdline.split(|b| *b == 0).collect();
            let is_daemon = args
                .first()
                .is_some_and(|a| a.ends_with(crate::brand::APP_COMMAND.as_bytes()))
                && args.get(1) == Some(&b"daemon".as_slice());
            if !is_daemon {
                continue;
            }
            // Its socket: `SOCKET` in its environment under the current name or an old one (a
            // daemon started before a prefix change), else the default one.
            let env = std::fs::read(entry.path().join("environ")).unwrap_or_default();
            let names: Vec<String> = maitty_shared::brand::env_names("SOCKET")
                .into_iter()
                .map(|name| format!("{name}="))
                .collect();
            let theirs = names
                .iter()
                .find_map(|name| {
                    env.split(|b| *b == 0)
                        .find_map(|kv| kv.strip_prefix(name.as_bytes()))
                })
                .map(|v| String::from_utf8_lossy(v).into_owned())
                .unwrap_or_else(|| "default".into());
            if theirs == label {
                return Some(pid);
            }
        }
    }
    // Elsewhere a server's socket can't be read off its process: only when there's exactly
    // one, and it's the default server you mean.
    #[cfg(not(target_os = "linux"))]
    if maitty_shared::brand::env_var("SOCKET").is_err() {
        let list = if cfg!(windows) {
            crate::proc::run(std::process::Command::new("powershell").args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                concat!("Get-CimInstance Win32_Process -Filter \"Name='", env!("APP_COMMAND"), ".exe'\" | Where-Object { $_.CommandLine -match '\\sdaemon\\s*$' } | ForEach-Object { $_.ProcessId }"),
            ]))
        } else {
            crate::proc::run(
                std::process::Command::new("pgrep")
                    .args(["-f", concat!(env!("APP_COMMAND"), " daemon$")]),
            )
        };
        let pids: Vec<u32> = list
            .unwrap_or_default()
            .split_whitespace()
            .filter_map(|p| p.parse().ok())
            .filter(|p| *p != std::process::id())
            .collect();
        if let [pid] = pids[..] {
            return Some(pid);
        }
    }
    None
}

/// The workspace this command runs in (via its pane), else the active one.
fn resolve_ws(ws: Option<WsId>) -> Result<WsId> {
    if let Some(ws) = ws {
        return Ok(ws);
    }
    let snap = snapshot()?;
    let here = maitty_shared::brand::env_var("TERM_ID")
        .ok()
        .and_then(|s| s.parse().ok());
    here.and_then(|t| snap.locate(t).map(|(w, _)| w.id))
        .or(snap.active_ws)
        .ok_or_else(|| anyhow!("no workspace to target"))
}

pub fn worktree(
    branch: String,
    base: Option<String>,
    ws: Option<WsId>,
    cmd: Vec<String>,
) -> Result<()> {
    let ws = resolve_ws(ws)?;
    command(Command::NewWorktree {
        ws,
        branch,
        base,
        cmd: join_command(cmd),
        split: None,
        from: None,
        agent: None,
        prompt: None,
    })
}

fn codex_status_hooks_installed(text: &str, windows: bool) -> bool {
    let Ok(config) = text.parse::<toml_edit::DocumentMut>() else {
        return false;
    };
    [
        ("SessionStart", true),
        ("SubagentStart", false),
        ("SubagentStop", false),
    ]
    .into_iter()
    .all(|(event, same_status)| {
        config
            .get("hooks")
            .and_then(toml_edit::Item::as_table)
            .and_then(|hooks| hooks.get(event))
            .and_then(toml_edit::Item::as_array_of_tables)
            .is_some_and(|entries| {
                entries.iter().any(|entry| {
                    entry
                        .get("hooks")
                        .and_then(toml_edit::Item::as_array_of_tables)
                        .is_some_and(|handlers| {
                            handlers.iter().any(|handler| {
                                if handler.get("type").and_then(toml_edit::Item::as_str)
                                    != Some("command")
                                {
                                    return false;
                                }
                                let command_ok = handler
                                    .get("command")
                                    .and_then(toml_edit::Item::as_str)
                                    .is_some_and(|command| {
                                        if same_status {
                                            command.ends_with(" hook codex --status same")
                                        } else {
                                            command.ends_with(" hook codex")
                                        }
                                    });
                                let windows_ok = !windows
                                    || handler
                                        .get("commandWindows")
                                        .and_then(toml_edit::Item::as_str)
                                        .is_some_and(|command| {
                                            command.starts_with("& ")
                                                && if same_status {
                                                    command.ends_with(" hook codex --status same")
                                                } else {
                                                    command.ends_with(" hook codex")
                                                }
                                        });
                                command_ok && windows_ok
                            })
                        })
                })
            })
    })
}

/// `<app> doctor`: each thing the app relies on, ✓ or what to do about it.
pub fn doctor() -> Result<()> {
    let mut bad = 0;
    let mut line = |ok: Option<bool>, what: &str, detail: String| {
        let mark = match ok {
            Some(true) => "\x1b[32m✓\x1b[0m",
            Some(false) => {
                bad += 1;
                "\x1b[31m✕\x1b[0m"
            }
            None => "\x1b[33m·\x1b[0m",
        };
        println!(" {mark} {what:<22} {detail}");
    };
    let run = |cmd: &str, args: &[&str]| -> Option<String> {
        let mut c = std::process::Command::new(cmd);
        c.args(args);
        let out = c.output().ok().filter(|o| o.status.success())?;
        Some(
            String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string(),
        )
    };
    let on_path = |name: &str| -> Option<String> {
        let names = if cfg!(windows) {
            vec![
                format!("{name}.exe"),
                format!("{name}.cmd"),
                format!("{name}.ps1"),
                name.to_string(),
            ]
        } else {
            vec![name.to_string()]
        };
        std::env::var_os("PATH").and_then(|p| {
            std::env::split_paths(&p).find_map(|d| {
                names
                    .iter()
                    .map(|n| d.join(n))
                    .find(|f| f.is_file())
                    .map(|f| f.display().to_string())
            })
        })
    };

    println!(
        concat!(env!("APP_COMMAND"), " {}  (protocol {})\n"),
        env!("APP_VERSION"),
        PROTOCOL_VERSION
    );

    // Config
    let path = crate::config::config_path();
    match crate::config::Config::load() {
        Ok(_) if path.exists() => line(Some(true), "config", path.display().to_string()),
        Ok(_) => line(
            None,
            "config",
            format!(
                concat!(
                    "none yet (defaults); `",
                    env!("APP_COMMAND"),
                    " config init` writes one at {}"
                ),
                path.display()
            ),
        ),
        Err(e) => line(
            Some(false),
            "config",
            format!("{e:#}  ({})", path.display()),
        ),
    }
    let (cfg, _) = crate::config::Config::load_or_default();

    // Server
    let server = block_on(async { ipc::open(false).await });
    match server {
        Ok(_) => line(
            Some(true),
            "server",
            format!("running ({})", ipc::socket_id()),
        ),
        Err(e) if format!("{e:#}").contains("protocol") => {
            line(Some(false), "server", format!("{e:#}"));
            println!(
                concat!(
                    "{:27}fix: run ",
                    env!("APP_COMMAND"),
                    "; it restarts the server itself (or `",
                    env!("APP_COMMAND"),
                    " kill-server`)"
                ),
                ""
            );
        }
        Err(_) => line(
            None,
            "server",
            concat!("not running (it starts with `", env!("APP_COMMAND"), "`)").into(),
        ),
    }

    // Tools
    match run("git", &["--version"]) {
        Some(v) => line(Some(true), "git", v),
        None => line(
            Some(false),
            "git",
            "not found; worktrees, Changes and branches need it".into(),
        ),
    }
    match run("gh", &["--version"]) {
        Some(v) => line(Some(true), "gh (GitHub CLI)", v),
        None => line(
            None,
            "gh (GitHub CLI)",
            "not found; PRs and GitHub issues use it (optional)".into(),
        ),
    }
    let shell = cfg.shell_command();
    let shell_ok = on_path(&shell[0]).is_some() || std::path::Path::new(&shell[0]).is_file();
    line(Some(shell_ok), "shell", shell.join(" "));

    // Agents
    let mut found = Vec::new();
    for a in [
        "claude",
        "codex",
        "gemini",
        "opencode",
        "cursor-agent",
        "copilot",
        "amp",
        "qwen",
        "aider",
        "grok",
        "auggie",
        "kimi",
        "pi",
        "omp",
        "kilo",
        "mastracode",
    ] {
        if on_path(a).is_some() {
            found.push(a);
        }
    }
    line(
        Some(!found.is_empty()),
        "agents on PATH",
        if found.is_empty() {
            "none found (claude, codex, gemini, …)".into()
        } else {
            found.join(", ")
        },
    );

    // Codex child sessions are only attached to their parent pane after these machine-local hooks run.
    if found.contains(&"codex") {
        let path = codex_config();
        match std::fs::read_to_string(&path) {
            Ok(text) if codex_status_hooks_installed(&text, cfg!(windows)) => {
                line(Some(true), "codex subagent hooks", "installed".into());
            }
            Ok(text) if text.parse::<toml_edit::DocumentMut>().is_err() => {
                line(
                    Some(false),
                    "codex subagent hooks",
                    format!(
                        concat!(
                            "{} is invalid TOML; repair it before `",
                            env!("APP_COMMAND"),
                            " integrate codex`"
                        ),
                        path.display()
                    ),
                );
            }
            Ok(_) => line(
                Some(false),
                "codex subagent hooks",
                concat!(
                    "missing: run `",
                    env!("APP_COMMAND"),
                    " integrate` (restart Codex to load them)"
                )
                .into(),
            ),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                line(
                    Some(false),
                    "codex subagent hooks",
                    concat!(
                        "missing: run `",
                        env!("APP_COMMAND"),
                        " integrate` (restart Codex to load them)"
                    )
                    .into(),
                );
            }
            Err(error) => line(
                Some(false),
                "codex subagent hooks",
                format!("couldn't read {}: {error}", path.display()),
            ),
        }
    }

    // File presence means setup is installed, not that a running host has reloaded it.
    // Until a native event arrives, the normal process and screen detectors remain active.
    for agent in ["pi", "opencode", "omp", "kilo", "mastracode", "kimi"] {
        if !found.contains(&agent) {
            continue;
        }
        let path = match integrations::status_adapter_path(agent) {
            Ok(path) => path,
            Err(error) => {
                line(
                    None,
                    &format!("{agent} status adapter"),
                    format!("couldn't locate config: {error:#}"),
                );
                continue;
            }
        };
        if integrations::status_adapter_installed(agent, &path) {
            line(
                None,
                &format!("{agent} status adapter"),
                format!(
                    "configured at {}; restart/reload {agent} to load; native status is confirmed when its first event arrives",
                    path.display()
                ),
            );
        } else {
            line(
                None,
                &format!("{agent} status adapter"),
                format!(
                    "not installed; fallback detection remains active; run `{APP_COMMAND} integrate`"
                ),
            );
        }
    }

    // Claude: hooks and MCP
    if found.contains(&"claude") {
        let settings = std::fs::read_to_string(claude_settings()).unwrap_or_default();
        let hooked = settings.contains("hook claude");
        let stale = stale_claude_hooks();
        match (hooked, stale.first()) {
            (false, _) => line(
                Some(false),
                "claude status hooks",
                concat!(
                    "missing: run `",
                    env!("APP_COMMAND"),
                    " integrate` (exact working / needs-you / done)"
                )
                .into(),
            ),
            // Another the app can't talk to this one's server: every agent would look idle.
            (true, Some(other)) => line(
                Some(false),
                "claude status hooks",
                format!(
                    "they run another {APP_COMMAND} ({other}); `{APP_COMMAND} integrate claude` (or restart the server) fixes it"
                ),
            ),
            (true, None) => line(Some(true), "claude status hooks", "installed".into()),
        }
        // Any hook whose program is gone (often an old hydra's): Claude shows "hook error" on
        // every turn it runs in, and only removing or repointing it stops that.
        let mut broken = Vec::new();
        for file in claude_settings_files() {
            let Some(root) = std::fs::read_to_string(&file)
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            else {
                continue;
            };
            for cmd in broken_hooks_in(&root, |p| p.exists(), |n| on_path(n).is_some()) {
                broken.push(format!("{} in {}", program_of(&cmd), file.display()));
            }
        }
        match broken.first() {
            None => line(
                Some(true),
                "claude hooks run",
                "every hook's program is there".into(),
            ),
            Some(first) => line(
                Some(false),
                "claude hooks run",
                format!(
                    "{} missing ({first}{}); `{APP_COMMAND} integrate claude` fixes {APP_COMMAND}'s own, remove the rest",
                    broken.len(),
                    if broken.len() > 1 { ", …" } else { "" }
                ),
            ),
        }
        let claude_json = std::fs::read_to_string(claude_json()).unwrap_or_default();
        let mcp = claude_json.contains(concat!("\"", env!("APP_COMMAND"), "\""))
            && claude_json.contains("\"mcp\"");
        let old = serde_json::from_str::<Value>(&claude_json)
            .map(|root| old_mcp_names(&root))
            .unwrap_or_default();
        match old.first() {
            // Claude names the server in every call it shows ("Called hydra"), and may run an old program.
            Some(name) => line(
                Some(false),
                concat!(env!("APP_COMMAND"), " MCP for claude"),
                format!("still registered as `{name}`: `{APP_COMMAND} integrate mcp` renames it"),
            ),
            None => line(
                if mcp { Some(true) } else { None },
                concat!(env!("APP_COMMAND"), " MCP for claude"),
                if mcp {
                    "registered".into()
                } else {
                    concat!(
                        "not set up: `",
                        env!("APP_COMMAND"),
                        " integrate mcp` lets agents see each other (optional)"
                    )
                    .into()
                },
            ),
        }
    }
    let exe = this_exe().unwrap_or_default();
    for agent in mcp_config::agents()
        .into_iter()
        .filter(mcp_config::McpAgent::installed)
    {
        let label = format!("{APP_COMMAND} MCP for {}", agent.id);
        match mcp_config::registered_command(&agent) {
            Some(cmd) if cmd == exe => line(Some(true), &label, "registered".into()),
            Some(cmd) => line(
                Some(false),
                &label,
                format!("runs {cmd}; `{APP_COMMAND} integrate mcp` points it at this one"),
            ),
            None => line(
                None,
                &label,
                concat!(
                    "not set up: `",
                    env!("APP_COMMAND"),
                    " integrate mcp` lets agents see each other (optional)"
                )
                .into(),
            ),
        }
    }

    // Terminal
    let term = std::env::var("TERM_PROGRAM")
        .or_else(|_| std::env::var("TERM"))
        .unwrap_or_else(|_| {
            if std::env::var("WT_SESSION").is_ok() {
                "Windows Terminal".into()
            } else {
                "unknown".into()
            }
        });
    let truecolor = std::env::var("COLORTERM")
        .is_ok_and(|c| c.contains("truecolor") || c.contains("24bit"))
        || std::env::var("WT_SESSION").is_ok();
    line(
        if truecolor { Some(true) } else { None },
        "terminal",
        format!(
            "{term}{}",
            if truecolor {
                ", true colour"
            } else {
                " (colours may look off without true colour)"
            }
        ),
    );
    if let Ok((w, h)) = crossterm::terminal::size() {
        line(
            Some(w >= 100 && h >= 30),
            "window size",
            format!(
                "{w}×{h}{}",
                if w < 100 || h < 30 {
                    concat!(" (", env!("APP_COMMAND"), " wants at least 100×30)")
                } else {
                    ""
                }
            ),
        );
    }

    // Data and sync
    let data = crate::config::data_dir();
    let writable = std::fs::create_dir_all(&data).is_ok()
        && std::fs::write(data.join(".doctor"), b"ok").is_ok();
    let _ = std::fs::remove_file(data.join(".doctor"));
    line(Some(writable), "data folder", data.display().to_string());
    line(
        None,
        "sync",
        if crate::sync::enabled() {
            format!("on ({})", crate::sync::dir().display())
        } else {
            concat!(
                "off (`",
                env!("APP_COMMAND"),
                " sync setup` shares config and ideas)"
            )
            .into()
        },
    );
    if let Some(ed) = Some(cfg.editor.clone())
        .filter(|e| !e.is_empty())
        .or_else(|| std::env::var("VISUAL").ok())
        .or_else(|| std::env::var("EDITOR").ok())
    {
        line(Some(true), "editor", ed);
    } else {
        line(
            None,
            "editor",
            "none set (editor = \"code\" in config, or $EDITOR)".into(),
        );
    }

    if !cfg.machines.is_empty() {
        let reports = doctor_machines::check_all(
            &cfg.machines,
            ipc::SSH_PROGRAM,
            crate::brand::APP_VERSION,
            doctor_machines::MACHINE_BUDGET,
        );
        for row in doctor_machines::rows(&reports) {
            match row {
                doctor_machines::Row::Machine(name) => println!("\n machine {name}"),
                doctor_machines::Row::Check(c) => line(c.ok, c.what, c.detail),
            }
        }
    }

    println!();
    if bad == 0 {
        println!("All good.");
    } else {
        println!("{bad} thing(s) to fix above.");
    }
    Ok(())
}

/// Run by an agent inside a pane: make a worktree and move this agent into it.
pub fn move_to_worktree(branch: String) -> Result<()> {
    let term: TermId = maitty_shared::brand::env_var("TERM_ID")
        .ok()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| {
            anyhow!(concat!(
                "run this from inside a ",
                env!("APP_COMMAND"),
                " pane (an agent running in ",
                env!("APP_COMMAND"),
                ")"
            ))
        })?;
    let branch = Some(branch.trim().to_string()).filter(|b| !b.is_empty());
    block_on(async move {
        let (mut r, mut w) = open_cli(&Target::current()).await?;
        ipc::send(
            &mut w,
            &ClientMsg::Command(Command::MoveToWorktree { term, branch }),
        )
        .await?;
        loop {
            match ipc::recv_server(&mut r).await? {
                Some(ServerMsg::Notice(n)) => println!("{n}"),
                Some(ServerMsg::Reply(_)) => return Ok(()),
                Some(ServerMsg::Error(e)) => bail!(e),
                Some(_) => continue,
                None => bail!("server closed the connection"),
            }
        }
    })
}

pub fn worktree_remove(ws: Option<WsId>, force: bool) -> Result<()> {
    command(Command::RemoveWorktree {
        ws: resolve_ws(ws)?,
        force,
        delete_branch: false,
    })
}

pub fn config_init() -> Result<()> {
    let path = crate::config::config_path();
    if path.exists() {
        bail!("{} already exists", path.display());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, crate::config::EXAMPLE)?;
    println!("wrote {}", path.display());
    Ok(())
}

// ---- hooks -------------------------------------------------------------------------

/// Map a Claude Code (or Codex, same dialect) hook payload to a status.
pub fn status_from_hook(payload: &Value) -> Option<HookStatus> {
    if let Some(status) = maitty_provider_codex::status_from_hook(payload) {
        return Some(status);
    }
    if let Some(status) = maitty_provider_claude::status_from_hook(payload) {
        return Some(status);
    }
    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    Some(match event {
        // Gemini CLI.
        "BeforeAgent" | "BeforeTool" | "AfterTool" => HookStatus::Working,
        "AfterAgent" => HookStatus::Done,
        "SubagentEnd" => HookStatus::Same,
        "pi.agent_start" | "pi.ui_prompt_end" => HookStatus::Working,
        "pi.ui_prompt_start" => HookStatus::Blocked,
        "pi.agent_settled" => HookStatus::Done,
        "pi.session_start" => HookStatus::Idle,
        "pi.session_shutdown" => HookStatus::Gone,
        // opencode (its plugin passes the event).
        "" if payload
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|t| t.contains('.')) =>
        {
            let ty = payload.get("type").and_then(Value::as_str).unwrap_or("");
            let state = payload
                .pointer("/properties/status/type")
                .and_then(Value::as_str)
                .unwrap_or("");
            match ty {
                "session.status" if state == "busy" || state == "retry" => HookStatus::Working,
                "session.status" if state == "idle" => HookStatus::Done,
                "session.idle" | "session.error" => HookStatus::Done,
                "permission.asked" | "permission.updated" | "question.asked" => HookStatus::Blocked,
                "permission.replied" | "question.replied" | "question.rejected" => {
                    HookStatus::Working
                }
                "session.created" => HookStatus::Idle,
                "session.deleted" => HookStatus::Gone,
                _ => return None,
            }
        }
        _ => return None,
    })
}

/// The last thing the assistant wrote, from a Claude Code transcript (JSON lines).
fn last_assistant_text(path: &std::path::Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    // Only the tail matters; transcripts can be large.
    let start = len.saturating_sub(512 * 1024);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buf = String::new();
    f.read_to_string(&mut buf).ok()?;
    buf.lines().rev().find_map(|line| {
        let v: Value = serde_json::from_str(line).ok()?;
        if v.get("type").and_then(Value::as_str) != Some("assistant") {
            return None;
        }
        let content = v.pointer("/message/content")?.as_array()?;
        let text: Vec<&str> = content
            .iter()
            .filter(|c| c.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|c| c.get("text").and_then(Value::as_str))
            .collect();
        (!text.is_empty()).then(|| text.join("\n"))
    })
}

/// Collapse whitespace and cut to `max` characters.
fn one_line(s: &str, max: usize) -> String {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

fn parse_status(s: &str) -> Option<HookStatus> {
    Some(match s {
        "working" | "busy" | "running" => HookStatus::Working,
        "blocked" | "waiting" | "input" => HookStatus::Blocked,
        "done" | "finished" => HookStatus::Done,
        "idle" => HookStatus::Idle,
        "same" => HookStatus::Same,
        "gone" | "exit" | "end" => HookStatus::Gone,
        _ => return None,
    })
}

pub fn hook(agent: &str, status: Option<&str>, payload: Option<&str>) -> Result<()> {
    // Inert outside the app, so global hooks don't bother other terminals.
    let Some(term) = maitty_shared::brand::env_var("TERM_ID")
        .ok()
        .and_then(|s| s.parse::<TermId>().ok())
    else {
        return Ok(());
    };
    let mut payload_json = payload
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    let status = match status {
        Some(s) => parse_status(s).ok_or_else(|| anyhow!("unknown status {s}"))?,
        None => {
            payload_json = match payload {
                Some(p) => serde_json::from_str(p).unwrap_or(Value::Null),
                None => read_hook_payload(std::io::stdin().lock(), HOOK_PAYLOAD_MAX)?,
            };
            match status_from_hook(&payload_json) {
                Some(s) => s,
                None => return Ok(()),
            }
        }
    };
    // The agent that ran this hook (still alive, unlike this short process) vouches for it.
    let pid = {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
        let me = Pid::from_u32(std::process::id());
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[me]),
            true,
            ProcessRefreshKind::nothing(),
        );
        sys.process(me)
            .and_then(|p| p.parent())
            .map(|p| p.as_u32())
            .unwrap_or(0)
    };
    let token = maitty_shared::brand::env_var("PANE_TOKEN").unwrap_or_default();
    let message = hook_message(
        HookOrigin {
            term,
            agent: agent.to_string(),
            pid,
            token,
        },
        &payload_json,
        status,
    );
    block_on(async move {
        tokio::time::timeout(Duration::from_secs(2), async {
            let (_r, mut w) = ipc::open_for_report().await?;
            ipc::send(&mut w, &message).await?;
            Ok::<_, anyhow::Error>(())
        })
        .await?
    })
}

struct HookOrigin {
    term: TermId,
    agent: String,
    pid: u32,
    token: String,
}

/// Claude's hook payloads carry no task for a subagent, but it writes the description the parent
/// gave it next to the subagent's transcript. It may not exist yet at SubagentStart; a later
/// hook from inside the subagent finds it.
fn subagent_description(
    agent: &str,
    transcript: Option<&std::path::Path>,
    agent_id: Option<&str>,
) -> Option<String> {
    if agent != "claude" {
        return None;
    }
    let transcript = transcript?;
    let meta = if transcript
        .file_stem()?
        .to_string_lossy()
        .starts_with("agent-")
    {
        transcript.with_extension("meta.json")
    } else {
        let id = agent_id?.trim_start_matches("agent-");
        transcript
            .with_extension("")
            .join("subagents")
            .join(format!("agent-{id}.meta.json"))
    };
    let meta: Value = serde_json::from_str(&std::fs::read_to_string(meta).ok()?).ok()?;
    meta.get("description")?
        .as_str()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string)
}

fn hook_message(origin: HookOrigin, payload_json: &Value, status: HookStatus) -> ClientMsg {
    let field = |names: &[&str]| {
        names
            .iter()
            .find_map(|n| payload_json.get(*n)?.as_str().map(str::to_string))
    };
    let session = field(&["session_id", "thread-id", "thread_id", "conversation_id"]);
    let cwd = field(&["cwd"]).map(PathBuf::from);
    let mut event = field(&["hook_event_name", "type"]).unwrap_or_default();
    let transcript = field(&["transcript_path"]).map(PathBuf::from);
    // A hook fired inside a subagent (it has an agent id, or its own agent-… transcript) is
    // news about that subagent, not about the session: it keeps the subagent listed as
    // running, and only a question it asks changes the session's state. Its transcript's
    // name, model and last words aren't the session's.
    let tracks_helpers = matches!(
        origin.agent.as_str(),
        "claude" | "codex" | "qwen" | "kimi" | "mastracode" | "opencode"
    );
    let lifecycle = tracks_helpers
        && matches!(
            event.as_str(),
            "SubagentStart" | "SubagentStop" | "SubagentEnd"
        );
    let inner_id = tracks_helpers
        .then(|| {
            field(&["agent_id"]).or_else(|| {
                transcript
                    .as_deref()
                    .and_then(|p| p.file_stem())
                    .map(|s| s.to_string_lossy().into_owned())
                    .filter(|s| s.starts_with("agent-"))
            })
        })
        .flatten();
    let inner = !lifecycle && inner_id.is_some();
    let status = if inner && status != HookStatus::Blocked {
        HookStatus::Same
    } else {
        status
    };
    let subagent = (lifecycle || inner).then(|| Subagent {
        id: field(&["agent_id", "subagent_id", "tool_use_id"])
            .or(inner_id)
            .unwrap_or_default(),
        kind: field(&["agent_type", "subagent_type", "agent_name"])
            .unwrap_or_else(|| "subagent".into()),
        start: !matches!(event.as_str(), "SubagentStop" | "SubagentEnd"),
        reported_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        task: field(&["task", "description", "prompt"])
            .or_else(|| {
                subagent_description(
                    &origin.agent,
                    transcript.as_deref(),
                    field(&["agent_id"]).as_deref(),
                )
            })
            .map(|task| one_line(&task, 240)),
        model: field(&["model", "model_id"]),
        effort: field(&["effort", "reasoning_effort"]),
        activity: field(&["tool_name"])
            .map(|tool| format!("{event}: {tool}"))
            .or_else(|| Some(event.clone())),
    });
    let parent_facts = !inner;
    let turn_facts = parent_facts && !lifecycle;
    let prompt = field(&["prompt"])
        .filter(|_| turn_facts)
        .map(|p| one_line(&p, 160));
    let transcript = transcript.filter(|_| turn_facts);
    let (model, name) = transcript
        .as_deref()
        .map(transcript_facts)
        .unwrap_or_default();
    if event == "Notification"
        && let Some(kind) = field(&["notification_type"])
    {
        event = format!("Notification:{kind}");
    }
    // A helper's own stop lists what still runs too: a helper that ends its turn while a shell it
    // started runs is waiting on that shell, and wakes when it ends.
    let stopped = matches!(event.as_str(), "Stop" | "SubagentStop");
    let (background, background_agents) = if stopped {
        (
            running_background_tasks(payload_json, false),
            running_background_tasks(payload_json, true),
        )
    } else if inner && event == "PostToolUse" {
        // What a helper just put in the background is its own work: the daemon pairs the two.
        (background_work_started(payload_json).into_iter().collect(), Vec::new())
    } else {
        (Vec::new(), Vec::new())
    };
    let background_reported = stopped
        && payload_json
            .get("background_tasks")
            .is_some_and(Value::is_array);
    let call = call_fingerprint(&origin.agent, &event, payload_json).filter(|_| parent_facts);
    let ask = (event == "PermissionRequest" && parent_facts)
        .then(|| permission_ask(payload_json))
        .flatten();
    let said = field(&["last_assistant_message", "last-assistant-message"])
        .or_else(|| transcript.as_deref().and_then(last_assistant_text))
        .map(|s| s.trim().chars().take(2000).collect::<String>())
        .filter(|s| !s.is_empty() && turn_facts);
    let session = session.filter(|_| parent_facts);
    let cwd = cwd.filter(|_| parent_facts);
    let HookOrigin {
        term,
        agent,
        pid,
        token,
    } = origin;
    ClientMsg::Hook {
        term,
        agent,
        status,
        session,
        cwd,
        prompt,
        said,
        subagent,
        event,
        pid,
        token,
        transcript,
        model,
        name,
        background,
        background_agents,
        background_reported,
        ask,
        call,
    }
}

/// The agents whose tool hooks pass the tool's name and input, and the event each fires as a tool starts.
fn tool_start_event(agent: &str) -> Option<&'static str> {
    match agent {
        "claude" | "qwen" | "codex" => Some("PreToolUse"),
        "gemini" => Some("BeforeTool"),
        _ => None,
    }
}

/// How many bytes of the digest make a call's fingerprint: enough that two different calls in a
/// turn never share one, short enough to be a field and not a record.
const CALL_FINGERPRINT_BYTES: usize = 8;

/// A fingerprint of the tool call a hook reports starting, from the tool's name and its input; `None`
/// for anything else. The input is needed, not just the name: without it two different calls of one
/// tool would look the same. The tool's name and input are never sent on (they can hold secrets).
fn call_fingerprint(agent: &str, event: &str, payload: &Value) -> Option<String> {
    use sha2::{Digest, Sha256};
    if tool_start_event(agent) != Some(event) {
        return None;
    }
    let tool = payload.get("tool_name")?.as_str()?;
    let input = payload.get("tool_input")?;
    let mut digest = Sha256::new();
    digest.update(tool.as_bytes());
    // A name and an input can never run into each other: a tool name holds no NUL.
    digest.update([0]);
    digest.update(serde_json::to_string(input).ok()?.as_bytes());
    let hash = digest.finalize();
    Some(hash.iter().take(CALL_FINGERPRINT_BYTES).map(|byte| format!("{byte:02x}")).collect())
}

/// The payload fields that name what a tool would run or touch, in the order they are tried. The
/// content a tool would write is never among them: it can hold secrets.
const ASK_SUBJECT_FIELDS: &[&str] = &["command", "file_path", "path", "url", "pattern", "query"];

/// The tool Claude uses to put a multiple-choice question to the person, not to ask leave to act.
const QUESTION_TOOL: &str = "AskUserQuestion";

/// The most choices a prompt offers as buttons. Claude's menu holds four, and the number keys that
/// pick them stop at nine, so this stays well inside what one key can name.
const MAX_QUESTION_CHOICES: usize = 4;

/// The most questions one prompt asks at once: Claude's own limit.
const MAX_QUESTIONS: usize = 4;

/// One question and its choices: the labels, in the order the menu numbers them, and whether it
/// takes several of them (`multiSelect`). None for a question with no text or more choices than a
/// key can name, and for one with a label that is empty (the numbers would no longer match the menu).
fn asked_question(entry: &Value) -> Option<AskQuestion> {
    let question = one_line(entry.get("question")?.as_str()?, 2000);
    let labels: Vec<String> = entry
        .get("options")?
        .as_array()?
        .iter()
        .map(|option| option.get("label").and_then(Value::as_str).map(|label| one_line(label, 200)))
        .collect::<Option<_>>()?;
    let multi = entry.get("multiSelect").and_then(Value::as_bool) == Some(true);
    (!question.is_empty()
        && (2..=MAX_QUESTION_CHOICES).contains(&labels.len())
        && labels.iter().all(|label| !label.is_empty()))
    .then_some(AskQuestion { question, choices: labels, multi })
}

/// Every question a prompt asks, in the order it shows them. All of them or none: one that cannot
/// be answered with keys leaves the whole prompt to the terminal.
fn asked_questions(input: Option<&Value>) -> Vec<AskQuestion> {
    let Some(questions) = input.and_then(|input| input.get("questions")).and_then(Value::as_array) else {
        return Vec::new();
    };
    if !(1..=MAX_QUESTIONS).contains(&questions.len()) {
        return Vec::new();
    }
    questions.iter().map(asked_question).collect::<Option<Vec<_>>>().unwrap_or_default()
}

/// How a question prompt is put to the chat: one question with one answer as its choices, several
/// with one answer each as `questions`, and any with a question that takes several answers as
/// `form` (which a peer from before it does not read, and so leaves to the terminal).
struct AskedQuestions {
    single: Option<AskQuestion>,
    questions: Vec<AskQuestion>,
    form: Vec<AskQuestion>,
}

fn sort_questions(asked: Vec<AskQuestion>) -> AskedQuestions {
    if asked.iter().any(|question| question.multi) {
        return AskedQuestions { single: None, questions: Vec::new(), form: asked };
    }
    match <[AskQuestion; 1]>::try_from(asked) {
        Ok([only]) => AskedQuestions { single: Some(only), questions: Vec::new(), form: Vec::new() },
        Err(several) => AskedQuestions { single: None, questions: several, form: Vec::new() },
    }
}

/// A question Claude asks with its choices, on one line: `Which? 1 Fast · 2 Safe`. A tool input
/// without a question gives an empty subject, like any tool with no subject field.
fn question_subject(input: Option<&Value>) -> String {
    let questions = input.and_then(|input| input.get("questions")).and_then(Value::as_array);
    let parts: Vec<String> = questions
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let question = entry.get("question")?.as_str()?.trim();
            let choices: Vec<String> = entry
                .get("options")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
                .filter_map(|(index, option)| Some(format!("{} {}", index + 1, option.get("label")?.as_str()?.trim())))
                .collect();
            Some(if choices.is_empty() { question.to_string() } else { format!("{question} {}", choices.join(" · ")) })
        })
        .collect();
    one_line(&parts.join(" / "), 2000)
}

/// What a `PermissionRequest` hook says is being asked: the tool and a one-line subject.
fn permission_ask(payload: &Value) -> Option<PermissionAsk> {
    let tool = payload.get("tool_name")?.as_str()?.trim();
    if tool.is_empty() {
        return None;
    }
    let input = payload.get("tool_input");
    let asked = sort_questions(if tool == QUESTION_TOOL { asked_questions(input) } else { Vec::new() });
    let choices = asked.single.as_ref().map(|only| only.choices.clone()).unwrap_or_default();
    let detail = if let Some(only) = asked.single {
        only.question
    } else if tool == QUESTION_TOOL {
        question_subject(input)
    } else {
        ASK_SUBJECT_FIELDS
            .iter()
            .find_map(|key| input?.get(*key)?.as_str().filter(|text| !text.trim().is_empty()))
            .map(|text| one_line(text, 2000))
            .unwrap_or_default()
    };
    Some(PermissionAsk {
        tool: tool.to_string(),
        detail,
        answerable: false,
        choices,
        questions: asked.questions,
        form: asked.form,
    })
}

/// Task states Claude might report for background work that is over. Its docs don't list the
/// values, so anything else (or none) counts as still running.
const BACKGROUND_TASK_OVER: &[&str] = &[
    "completed",
    "complete",
    "done",
    "finished",
    "failed",
    "error",
    "killed",
    "stopped",
    "cancelled",
    "canceled",
];

/// The background task a tool call just started: a shell run in the background
/// (`backgroundTaskId`) or a helper agent launched without waiting (`isAsync` with its
/// `agentId`). Its id is the one the agent's later `background_tasks` lists.
fn background_work_started(payload: &Value) -> Option<String> {
    let response = payload.get("tool_response")?;
    let id = response
        .get("backgroundTaskId")
        .or_else(|| {
            response
                .get("isAsync")
                .and_then(Value::as_bool)
                .filter(|launched_async| *launched_async)
                .and_then(|_| response.get("agentId"))
        })?
        .as_str()?;
    (!id.is_empty()).then(|| id.to_string())
}

/// The ids of the background tasks Claude's Stop says are still in flight; it wakes itself when
/// one ends. With `agents_only`, just the helper agents among them (`"type": "subagent"`).
fn running_background_tasks(payload: &Value, agents_only: bool) -> Vec<String> {
    let tasks = payload
        .get("background_tasks")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    tasks
        .iter()
        .filter(|task| {
            task.get("status")
                .and_then(Value::as_str)
                .is_none_or(|s| !BACKGROUND_TASK_OVER.contains(&s.to_ascii_lowercase().as_str()))
        })
        .filter(|task| {
            !agents_only
                || task
                    .get("type")
                    .and_then(Value::as_str)
                    .is_some_and(|kind| kind.to_ascii_lowercase().contains("agent"))
        })
        .filter_map(|task| {
            ["id", "command", "description"]
                .iter()
                .find_map(|k| task.get(*k)?.as_str().filter(|v| !v.is_empty()))
                .map(str::to_string)
        })
        .collect()
}

/// Gemini CLI's hook events (its settings.json takes Claude's shape, with its own names).
const GEMINI_EVENTS: &[(&str, Option<&str>)] = &[
    ("BeforeAgent", None),
    ("BeforeTool", None),
    ("AfterTool", None),
    ("Notification", None),
    ("AfterAgent", None),
    ("SessionStart", None),
    ("SessionEnd", None),
];

/// Qwen Code's settings.json. `$QWEN_HOME` names Qwen's config folder itself (qwen-code
/// `Storage.getGlobalQwenDir`), unlike `GEMINI_CLI_HOME`, which stands in for the home folder.
fn qwen_settings() -> PathBuf {
    let home = directories::BaseDirs::new()
        .map(|d| d.home_dir().to_path_buf())
        .unwrap_or_default();
    qwen_settings_in(std::env::var_os("QWEN_HOME").map(PathBuf::from), &home)
}

fn qwen_settings_in(qwen_home: Option<PathBuf>, home: &std::path::Path) -> PathBuf {
    let dir = match qwen_home.filter(|dir| !dir.as_os_str().is_empty()) {
        // Qwen's resolvePath expands a leading `~`, as a shell would have.
        Some(dir) => dir
            .strip_prefix("~")
            .map(|rest| home.join(rest))
            .unwrap_or(dir),
        None => home.join(".qwen"),
    };
    dir.join("settings.json")
}

/// A tool's settings.json under the home folder (`.gemini`), or `$<env>/…`.
fn home_settings(env: &str, dir: &str) -> PathBuf {
    std::env::var_os(env)
        .map(|h| PathBuf::from(h).join(dir))
        .unwrap_or_else(|| {
            directories::BaseDirs::new()
                .map(|d| d.home_dir().join(dir))
                .unwrap_or_default()
        })
        .join("settings.json")
}

/// A hook group the app put there: tagged, or (from installs before the tag) one that runs
/// The app's command, or one it had before.
fn is_our_name(program: &str) -> bool {
    maitty_provider_claude::is_our_name(program, &app_hook_names())
}

/// `<app> hook …` under any of the app's names.
fn is_ours(group: &Value) -> bool {
    maitty_provider_claude::is_our_hook_group(group, &app_hook_names())
}

fn app_hook_names() -> Vec<&'static str> {
    [crate::brand::APP_COMMAND, BUNDLED_DAEMON]
        .into_iter()
        .chain(crate::brand::previous_daemon_names())
        .chain(crate::brand::previous())
        .collect()
}

/// A hook command split into the program it starts (its first word, or the quoted path)
/// and its arguments.
fn split_command(cmd: &str) -> (&str, &str) {
    let c = cmd.trim_start();
    let (prog, args) = match c.strip_prefix('"') {
        Some(rest) => rest.split_once('"').unwrap_or((rest, "")),
        None => c.split_once(char::is_whitespace).unwrap_or((c, "")),
    };
    (prog, args.trim_start())
}

fn program_of(cmd: &str) -> &str {
    split_command(cmd).0
}

/// `"<…/<app>>" hook claude`, or the same from a seshi, hydra or drover install.
#[cfg(test)]
fn runs_our_hook(cmd: &str) -> bool {
    maitty_provider_claude::runs_our_hook(cmd, &app_hook_names())
}

/// Hook commands in Claude settings `root` whose program isn't there (a removed install, a
/// moved file): Claude reports "hook error" on every turn they run in. Paths are checked
/// with `exists`; a bare name only when it's one of the app's old names (`on_path`).
fn broken_hooks_in(
    root: &Value,
    exists: impl Fn(&std::path::Path) -> bool,
    on_path: impl Fn(&str) -> bool,
) -> Vec<String> {
    let mut out: Vec<String> = root
        .get("hooks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|h| h.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|g| g.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter_map(|h| h.get("command").and_then(Value::as_str))
        .filter(|cmd| {
            let prog = program_of(cmd);
            if prog.contains('$') || prog.starts_with('~') {
                return false;
            }
            if prog.contains('/') || prog.contains('\\') {
                !exists(std::path::Path::new(prog))
            } else {
                is_our_name(prog) && !on_path(prog)
            }
        })
        .map(String::from)
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Where Claude Code keeps its MCP servers (yours, for every project).
fn claude_json() -> PathBuf {
    claude_json_in(None)
}

/// Claude Code's own file (its MCP servers among others): inside its config folder when it runs
/// with `CLAUDE_CONFIG_DIR` (named, or `None` for this process's own), else in the home folder.
fn claude_json_in(config_dir: Option<&std::path::Path>) -> PathBuf {
    match config_dir {
        Some(dir) => dir.join(".claude.json"),
        None => match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()) {
            Some(dir) => PathBuf::from(dir).join(".claude.json"),
            None => directories::BaseDirs::new()
                .map(|d| d.home_dir().join(".claude.json"))
                .unwrap_or_default(),
        },
    }
}

/// The MCP servers in Claude's `root` that are this app under an old name: Claude shows the
/// name on every call, and the program behind it is an install that no longer updates.
fn old_mcp_names(root: &Value) -> Vec<String> {
    let Some(servers) = root.get("mcpServers").and_then(Value::as_object) else {
        return Vec::new();
    };
    servers
        .iter()
        .filter(|(_, server)| {
            let prog = server
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let stem = std::path::Path::new(prog)
                .file_stem()
                .map(|s| s.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default();
            let serves = server
                .get("args")
                .and_then(Value::as_array)
                .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("mcp")));
            crate::brand::previous().any(|p| p == stem) && serves
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// Runs Claude Code's own CLI (a `.cmd` shim on Windows).
fn run_claude(args: &[&str], config_dir: Option<&std::path::Path>) -> std::io::Result<std::process::ExitStatus> {
    let run = |program: &str| {
        let mut command = std::process::Command::new(program);
        command.args(args);
        if let Some(dir) = config_dir {
            command.env("CLAUDE_CONFIG_DIR", dir);
        }
        command.status()
    };
    run(if cfg!(windows) { "claude.cmd" } else { "claude" }).or_else(|_| run("claude"))
}

/// The Claude settings files whose hooks run here: yours, and this folder's project ones.
fn claude_settings_files() -> Vec<PathBuf> {
    let user = claude_settings();
    let mut files = vec![user.with_file_name("settings.local.json"), user];
    if let Ok(here) = std::env::current_dir() {
        files.push(here.join(".claude").join("settings.json"));
        files.push(here.join(".claude").join("settings.local.json"));
    }
    files
}

/// Claude Code's settings file, where its hooks live.
fn claude_settings() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            directories::BaseDirs::new()
                .map(|d| d.home_dir().join(".claude"))
                .unwrap_or_default()
        })
        .join("settings.json")
}

/// Copies an agent's config file to `<file>.<ext>.<app>-bak` before the app changes it. An
/// existing copy is kept: it is the file as it was before the app first touched it.
fn back_up_once(path: &std::path::Path, ext: &str) -> std::io::Result<()> {
    let backup = path.with_extension(format!("{ext}.{APP_COMMAND}-bak"));
    if path.exists() && !backup.exists() {
        std::fs::copy(path, backup)?;
    }
    Ok(())
}

/// The most of a hook's input kept. A tool's whole output comes with it, and can be far larger.
const HOOK_PAYLOAD_MAX: usize = 4 << 20;

/// The top-level text fields a hook's report is made of, read off the start of an input too large
/// to keep whole: the agent writes them before the tool's input and output.
const HOOK_HEAD_FIELDS: [&str; 8] = [
    "session_id", "transcript_path", "cwd", "hook_event_name", "tool_name", "notification_type", "agent_id", "agent_type",
];

/// A hook's JSON input, all of it read so the agent never blocks writing it. Past `max` bytes the
/// rest is dropped and the report is made of the fields at its start (`HOOK_HEAD_FIELDS`); cut JSON
/// does not parse, and a hook that reports nothing left the pane's status stuck.
fn read_hook_payload(mut input: impl std::io::Read, max: usize) -> Result<Value> {
    let mut kept = Vec::new();
    (&mut input).take(max as u64).read_to_end(&mut kept)?;
    let dropped = std::io::copy(&mut input, &mut std::io::sink())?;
    if dropped == 0 {
        return Ok(serde_json::from_slice(&kept).unwrap_or(Value::Null));
    }
    let head = String::from_utf8_lossy(&kept);
    let mut fields = serde_json::Map::new();
    for name in HOOK_HEAD_FIELDS {
        let field = regex::Regex::new(&format!(r#""{name}"\s*:\s*("(?:[^"\\]|\\.)*")"#))?;
        if let Some(text) = field
            .captures(&head)
            .and_then(|found| serde_json::from_str::<String>(&found[1]).ok())
        {
            fields.insert(name.to_string(), Value::String(text));
        }
    }
    Ok(if fields.is_empty() { Value::Null } else { Value::Object(fields) })
}

/// The daemon the desktop app bundles: the same program under another name.
const BUNDLED_DAEMON: &str = crate::brand::DAEMON_NAME;

/// This the app, as hook commands name it. The desktop app's daemon can run from a folder that
/// does not outlive it (an AppImage's temporary mount), and Claude Code's settings are global, so
/// hooks naming that path break every session once the app closes. They name a copy at a fixed
/// path instead.
fn this_exe() -> Result<String> {
    let running = std::env::current_exe()?;
    let program = if is_bundled_daemon(&running) {
        keep_copy(&running, &crate::config::data_dir())?
    } else {
        running
    };
    Ok(program.to_string_lossy().replace('\\', "/"))
}

/// Whether `exe` is the daemon the desktop app bundles, including its development name with the
/// target triple after it.
fn is_bundled_daemon(exe: &std::path::Path) -> bool {
    exe.file_stem().is_some_and(|stem| {
        let stem = stem.to_string_lossy();
        std::iter::once(BUNDLED_DAEMON)
            .chain(crate::brand::previous_daemon_names())
            .any(|name| stem.starts_with(name))
    })
}

/// `running` copied into `folder` under the bundled daemon's plain name, unless the copy there is
/// already this build. The copy is written beside the target and renamed over it, so a hook that
/// starts during the update runs the old file or the new one, never half of one.
fn keep_copy(running: &std::path::Path, folder: &std::path::Path) -> Result<PathBuf> {
    let name = if cfg!(windows) {
        format!("{BUNDLED_DAEMON}.exe")
    } else {
        BUNDLED_DAEMON.to_string()
    };
    let target = folder.join(&name);
    if copy_is_current(running, &target) {
        return Ok(target);
    }
    std::fs::create_dir_all(folder)
        .with_context(|| format!("creating {}", folder.display()))?;
    let partial = folder.join(format!("{name}.partial"));
    std::fs::copy(running, &partial)
        .with_context(|| format!("copying {} to {}", running.display(), partial.display()))?;
    replace_file(&partial, &target).with_context(|| format!("replacing {}", target.display()))?;
    Ok(target)
}

/// `from` renamed over `to`. Windows refuses to replace a program that is running (a hook in
/// flight), but lets it be renamed: the old copy is moved aside first and removed once nothing
/// runs it, at the next replacement if not now.
fn replace_file(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    let Err(refused) = std::fs::rename(from, to) else {
        return Ok(());
    };
    if !cfg!(windows) || !to.exists() {
        return Err(refused);
    }
    let aside = to.with_extension("old");
    if aside.exists() {
        std::fs::remove_file(&aside)?;
    }
    std::fs::rename(to, &aside)?;
    std::fs::rename(from, to)?;
    if let Err(e) = std::fs::remove_file(&aside) {
        tracing::debug!("{} is still running; removed next time: {e}", aside.display());
    }
    Ok(())
}

/// The copy has the running file's size and is not older than it.
fn copy_is_current(running: &std::path::Path, copy: &std::path::Path) -> bool {
    let (Ok(running), Ok(copy)) = (std::fs::metadata(running), std::fs::metadata(copy)) else {
        return false;
    };
    running.len() == copy.len()
        && matches!((running.modified(), copy.modified()), (Ok(made), Ok(kept)) if kept >= made)
}

/// Context, cost and plan limits from the JSON Claude Code hands its status line.
pub(crate) fn statusline_facts(json: &str) -> (Usage, Vec<Limit>) {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return (Usage::default(), Vec::new());
    };
    let tokens_in = v["context_window"]["total_input_tokens"].as_u64();
    let tokens_out = v["context_window"]["total_output_tokens"].as_u64();
    let usage = Usage {
        context: v["context_window"]["used_percentage"]
            .as_f64()
            .map(|p| p as f32),
        cost: v["cost"]["total_cost_usd"].as_f64(),
        tokens: tokens_in
            .zip(tokens_out)
            .map(|(input, output)| input + output),
        tokens_in,
        tokens_out,
    };
    let limits = [("five_hour", "5h"), ("seven_day", "week")]
        .iter()
        .filter_map(|(k, name)| {
            let l = &v["rate_limits"][k];
            Some(Limit {
                name: name.to_string(),
                used: l["used_percentage"].as_f64()? as f32,
                resets_at: l["resets_at"].as_u64()?,
            })
        })
        .collect();
    (usage, limits)
}

/// Where the status line you had before the app's is kept (the app's runs it after its own).
fn statusline_before() -> PathBuf {
    crate::config::data_dir().join("claude-statusline.txt")
}

/// Make Claude's status line the app's (or with `uninstall`, put yours back). Yours keeps
/// showing: the app's runs it with the same input and prints what it prints.
#[cfg(test)]
fn statusline_setting(
    root: &mut Value,
    exe: &str,
    uninstall: bool,
    kept: &std::path::Path,
) -> Result<()> {
    let before = std::fs::read_to_string(kept).unwrap_or_default();
    apply_statusline_setting(root, exe, uninstall, kept, &before)
}

fn apply_statusline_setting(
    root: &mut Value,
    exe: &str,
    uninstall: bool,
    kept: &std::path::Path,
    before: &str,
) -> Result<()> {
    let change = maitty_provider_claude::update_statusline(
        root,
        exe,
        claude_hook_shell(),
        &app_hook_names(),
        uninstall,
        before,
    )?;
    if let Some(previous) = change.previous_command_to_save {
        if let Some(dir) = kept.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(kept, previous)?;
    }
    if change.remove_previous_command {
        let _ = std::fs::remove_file(kept);
    }
    Ok(())
}

/// `<app> statusline`, Claude Code's status line command: hands what the session has used
/// to the app (inside one of its panes), then shows the status line you had before, if any.
pub fn statusline() {
    use std::io::Write;
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let term = maitty_shared::brand::env_var("TERM_ID")
        .ok()
        .and_then(|s| s.parse::<TermId>().ok());
    if let (Some(term), Ok(token)) = (term, maitty_shared::brand::env_var("PANE_TOKEN"))
    {
        let (usage, limits) = statusline_facts(&input);
        let msg = ClientMsg::Usage {
            term,
            token,
            usage,
            limits,
        };
        // Never hold up Claude's screen for it; a report that doesn't get there is skipped.
        let sent = block_on(async {
            tokio::time::timeout(Duration::from_millis(800), async {
                let (_r, mut w) = ipc::open_for_report().await?;
                ipc::send(&mut w, &msg).await
            })
            .await
            .unwrap_or_else(|_| Err(anyhow!("timed out")))
        });
        if let Err(e) = sent {
            tracing::debug!("status line report: {e:#}");
        }
    }
    let before = std::fs::read_to_string(statusline_before()).unwrap_or_default();
    let before = before.trim();
    if before.is_empty() || maitty_provider_claude::is_our_statusline(before, &app_hook_names()) {
        return;
    }
    let mut cmd = shell_line(before);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::null());
    if let Ok(mut child) = crate::proc::quiet(&mut cmd).spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(input.as_bytes());
        }
        let _ = child.wait();
    }
}

/// The Git Bash Claude Code runs command lines through on Windows: the one it is told of, else
/// Git for Windows' own, at its usual places or beside the `git` on PATH.
fn git_bash() -> Option<PathBuf> {
    let beside_git = std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|dir| dir.join("git.exe"))
            .find(|git| git.is_file())
            .and_then(|git| git.parent()?.parent().map(|root| root.join("bin").join("bash.exe")))
    });
    std::env::var_os("CLAUDE_CODE_GIT_BASH_PATH")
        .map(PathBuf::from)
        .into_iter()
        .chain(
            [
                "C:/Program Files/Git/bin/bash.exe",
                "C:/Program Files (x86)/Git/bin/bash.exe",
            ]
            .map(PathBuf::from),
        )
        .chain(beside_git)
        .find(|p| p.is_file())
}

/// The shell Claude Code runs this computer's hooks and status line through.
fn claude_hook_shell() -> maitty_provider_claude::HookShell {
    use maitty_provider_claude::HookShell;
    if !cfg!(windows) {
        HookShell::Posix
    } else if git_bash().is_some() {
        HookShell::GitBash
    } else {
        HookShell::PowerShell
    }
}

/// A command line run the way Claude Code runs its own: by bash (Git Bash on Windows, where
/// PowerShell stands in when there's none).
fn shell_line(line: &str) -> std::process::Command {
    if cfg!(windows) {
        match git_bash() {
            Some(b) => {
                let mut c = std::process::Command::new(b);
                c.args(["-c", line]);
                c
            }
            None => {
                let mut c = std::process::Command::new("powershell");
                c.args(["-NoProfile", "-Command", line]);
                c
            }
        }
    } else {
        let mut c = std::process::Command::new("sh");
        c.args(["-c", line]);
        c
    }
}

/// Add (or with `uninstall`, remove) the app's hooks in Claude Code's settings.
fn claude_hooks(uninstall: bool) -> Result<PathBuf> {
    let path = claude_hooks_at(&claude_settings(), uninstall)?;
    if !uninstall {
        for other in stale_sibling_claude_settings() {
            match claude_hooks_at(&other, false) {
                Ok(p) => tracing::info!("pointed the Claude hooks in {} at this {APP_COMMAND}", p.display()),
                Err(e) => tracing::warn!("couldn't update the Claude hooks in {}: {e:#}", other.display()),
            }
        }
    }
    Ok(path)
}

fn claude_hooks_at(path: &std::path::Path, uninstall: bool) -> Result<PathBuf> {
    json_hooks(path, "claude", maitty_provider_claude::STATUS_EVENTS, 5, uninstall)
}

/// Why the hooks in Claude config folder `folder` do not send to this build: none, running
/// another program (an older install, or the program an older name had), or the file unreadable.
/// `None` when they are right, or when hooks are not this build's to manage (a side server or a
/// source build). Reads a file: call it off the UI thread.
pub fn claude_hook_problem(folder: &std::path::Path) -> Result<Option<String>, String> {
    if !hooks_belong_to_this_build() {
        return Ok(None);
    }
    let file = folder.join("settings.json");
    let text = match std::fs::read_to_string(&file) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(folder.is_dir().then(|| "has no settings file, so no hooks".to_string()));
        }
        Err(e) => return Err(e.to_string()),
    };
    let root = jsonc::parse_value(&text).ok_or("it is not valid JSON")?;
    let exe = this_exe().map_err(|e| e.to_string())?;
    let want = maitty_provider_claude::command_line(&exe, "hook claude", claude_hook_shell());
    Ok(claude_hook_problem_in(&text, &root, &want))
}

fn claude_hook_problem_in(text: &str, root: &Value, want: &str) -> Option<String> {
    if !text.contains("hook claude") {
        return Some("has no Maiker hooks".to_string());
    }
    stale_in(root, want)
        .first()
        .map(|other| format!("its hooks run another program ({other})"))
}

/// Points the hooks in Claude config folder `folder` at this build.
pub fn repair_claude_hooks_in(folder: &std::path::Path) -> Result<(), String> {
    // The check already says nothing for a side server or a source build; this keeps the write itself from ever
    // pointing a real config folder's hooks at a binary inside a checkout, whoever calls it.
    if !hooks_belong_to_this_build() {
        return Ok(());
    }
    write_claude_hooks_in(folder)
}

fn write_claude_hooks_in(folder: &std::path::Path) -> Result<(), String> {
    claude_hooks_at(&folder.join("settings.json"), false)
        .map(drop)
        .map_err(|e| format!("{e:#}"))?;
    rename_old_mcp_in(Some(folder));
    Ok(())
}

/// Registers the MCP server under this app's name where Claude (the one that runs with `config_dir`)
/// still has it under an old name. Quiet when there is nothing to rename; a failure is logged.
fn rename_old_mcp_in(config_dir: Option<&std::path::Path>) {
    let Ok(text) = std::fs::read_to_string(claude_json_in(config_dir)) else {
        return;
    };
    let old = serde_json::from_str::<Value>(&text).map(|root| old_mcp_names(&root)).unwrap_or_default();
    if old.is_empty() {
        return;
    }
    match this_exe().map_err(|e| e.to_string()).and_then(|exe| claude_mcp_in(config_dir, &exe, false).map_err(|e| format!("{e:#}"))) {
        Ok(done) => tracing::info!("renamed the old MCP server entry `{}` in Claude's config: {done}", old.join("`, `")),
        Err(e) => tracing::warn!("could not rename the MCP server entry `{}` in Claude's config: {e}", old.join("`, `")),
    }
}

/// Other Claude config folders (`~/.claude-personal`, `~/.claude-work`, ...) whose settings still
/// run another copy of the app's hook. The server and the desktop app do not run with the
/// `CLAUDE_CONFIG_DIR` the user's shell gives their agents, so an update that only repaired
/// `claude_settings()` left those panes reporting to an older app: no hook ever reached the
/// server, and the pane never counted as hooked.
fn stale_sibling_claude_settings() -> Vec<PathBuf> {
    let (Ok(exe), Some(dirs)) = (this_exe(), directories::BaseDirs::new()) else {
        return Vec::new();
    };
    let want = maitty_provider_claude::command_line(&exe, "hook claude", claude_hook_shell());
    stale_claude_settings_in(dirs.home_dir(), &claude_settings(), &want)
}

fn stale_claude_settings_in(home: &std::path::Path, own: &std::path::Path, want: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(home) else {
        return Vec::new();
    };
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with(".claude"))
        .map(|e| e.path().join("settings.json"))
        .filter(|settings| settings != own)
        .filter(|settings| {
            std::fs::read_to_string(settings)
                .ok()
                .and_then(|text| jsonc::parse_value(&text))
                .is_some_and(|root| !stale_in(&root, want).is_empty())
        })
        .collect();
    found.sort();
    found
}

/// Add (or remove) the app's hooks in a Claude-style settings.json (Claude Code, Gemini CLI,
/// Qwen Code): one tagged group per event running `<app> hook <agent>`, `timeout` in the
/// tool's own unit. The rest of the file (comments and key order included) is kept, with a
/// backup beside it.
fn json_hooks(
    path: &std::path::Path,
    agent: &str,
    events: &[(&str, Option<&str>)],
    timeout: u64,
    uninstall: bool,
) -> Result<PathBuf> {
    let exe = this_exe()?;
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let doc = jsonc::Doc::parse(&text)
        .with_context(|| format!("{} isn't valid JSON; not touching it", path.display()))?;
    let settings = doc
        .object()
        .ok_or_else(|| anyhow!("settings.json is not an object"))?;
    back_up_once(path, "json")?;
    let hooks = match settings.get("hooks") {
        Some(prop) => Some(
            prop.object_value()
                .ok_or_else(|| anyhow!("`hooks` is not an object"))?,
        ),
        None if uninstall => None,
        None => Some(
            settings
                .append("hooks", CstInputValue::Object(Vec::new()))
                .object_value_or_set(),
        ),
    };
    if let Some(hooks) = &hooks {
        for (event, matcher) in events {
            maitty_provider_claude::replace_json_hook_group(
                hooks,
                event,
                (!uninstall).then(|| {
                    jsonc::input(&maitty_provider_claude::json_hook_group(
                        maitty_provider_claude::JsonHookGroupOptions {
                            command_name: APP_COMMAND,
                            executable: &exe,
                            agent,
                            timeout,
                            matcher: *matcher,
                            // Only Claude Code's runs are known; other tools keep the quoted line.
                            shell: if agent == "claude" {
                                claude_hook_shell()
                            } else {
                                maitty_provider_claude::HookShell::Posix
                            },
                        },
                    ))
                }),
                &app_hook_names(),
            );
        }
    }
    if agent == "claude" {
        claude_statusline(&doc, &exe, uninstall)?;
    }
    crate::config::write_atomic(path, doc.text())?;
    Ok(path.to_path_buf())
}

/// Points Claude's status line at the app (or back), changing only the `statusLine` entry.
fn claude_statusline(doc: &jsonc::Doc, exe: &str, uninstall: bool) -> Result<()> {
    let settings = doc
        .object()
        .ok_or_else(|| anyhow!("settings.json is not an object"))?;
    let mut root = doc.to_value().unwrap_or_default();
    let before = root.get("statusLine").cloned();
    let kept = statusline_before();
    let previous = std::fs::read_to_string(&kept).unwrap_or_default();
    apply_statusline_setting(&mut root, exe, uninstall, &kept, &previous)?;
    match root.get("statusLine") {
        Some(line) if before.as_ref() != Some(line) => {
            jsonc::set_prop(&settings, "statusLine", jsonc::input(line))
        }
        Some(_) => {}
        None => settings
            .get("statusLine")
            .into_iter()
            .for_each(CstObjectProp::remove),
    }
    Ok(())
}

/// The commands the app's Claude hooks run that aren't this the app (an older install, a copy
/// that moved). Empty when they're right, or when there are none.
pub fn stale_claude_hooks() -> Vec<String> {
    let (Ok(exe), Ok(text)) = (this_exe(), std::fs::read_to_string(claude_settings())) else {
        return Vec::new();
    };
    // Comments are allowed: the hooks may have been installed into a commented file.
    let Some(root) = jsonc::parse_value(&text) else {
        return Vec::new();
    };
    stale_in(
        &root,
        &maitty_provider_claude::command_line(&exe, "hook claude", claude_hook_shell()),
    )
}

/// The app's Claude hooks are in and run this the app (the check `<app> doctor` makes). Reads a
/// file: call it off the UI thread.
pub fn claude_status_hooks_installed() -> bool {
    std::fs::read_to_string(claude_settings()).is_ok_and(|s| s.contains("hook claude"))
        && stale_claude_hooks().is_empty()
}

/// The app's hook commands in Claude settings `root` other than `want`.
fn stale_in(root: &Value, want: &str) -> Vec<String> {
    maitty_provider_claude::stale_hooks(root, want, &app_hook_names())
}

/// The app's Claude hooks are in, but not its status line (installed before there was one), or
/// its status line is written for a shell this computer's Claude Code does not run it through.
fn needs_statusline() -> bool {
    let Ok(text) = std::fs::read_to_string(claude_settings()) else {
        return false;
    };
    let Some(root) = jsonc::parse_value(&text) else {
        return false;
    };
    let hooked = root
        .get("hooks")
        .and_then(Value::as_object)
        .is_some_and(|h| {
            h.values()
                .filter_map(Value::as_array)
                .flatten()
                .any(is_ours)
        });
    let cmd = root
        .get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let ours = maitty_provider_claude::is_our_statusline(cmd, &app_hook_names());
    let as_written = this_exe().is_ok_and(|exe| {
        cmd == maitty_provider_claude::command_line(&exe, "statusline", claude_hook_shell())
    });
    hooked && (!ours || !as_written)
}

/// False for a side server (<APP>_SOCKET) or a build in a source checkout: neither may take
/// your hooks from the copy of the app you use.
pub fn hooks_belong_to_this_build() -> bool {
    let side = maitty_shared::brand::env_var("SOCKET").is_ok_and(|s| s != "default");
    let dev_build = std::env::current_exe().is_ok_and(|exe| {
        let exe = exe.to_string_lossy().replace('\\', "/");
        exe.contains("/target/debug/") || exe.contains("/target/release/")
    });
    !(side || dev_build)
}

/// Point the app's Claude hooks at this the app if they name another one. A hook from a
/// different version can't talk to this server, and hooks fail silently by design, so
/// every agent would look idle. Run when the server starts.
pub fn refresh_claude_hooks() {
    if !hooks_belong_to_this_build() {
        return;
    }
    rename_old_mcp_in(None);
    if !stale_claude_hooks().is_empty() || needs_statusline() || !stale_sibling_claude_settings().is_empty() {
        match claude_hooks(false) {
            Ok(p) => tracing::info!(
                concat!(
                    "pointed ",
                    env!("APP_COMMAND"),
                    "'s Claude hooks in {} at this ",
                    env!("APP_COMMAND")
                ),
                p.display()
            ),
            Err(e) => tracing::warn!("couldn't update {APP_COMMAND}'s Claude hooks: {e:#}"),
        }
    }
}

/// Codex's config file (`$CODEX_HOME/config.toml`, else `~/.codex/config.toml`).
fn codex_config() -> PathBuf {
    crate::config::codex_config_dir().join("config.toml")
}

/// Where Maiker's Codex lifecycle hooks stand in Codex's config. Reads a file: call it off the
/// UI thread.
pub fn codex_hooks_state() -> maitty_provider_codex::HooksState {
    std::fs::read_to_string(codex_config())
        .map(|text| maitty_provider_codex::hooks_state(&text))
        .unwrap_or(maitty_provider_codex::HooksState::NotInstalled)
}

enum CodexNotify {
    Set,
    Removed,
    /// Someone else's notify is there (shown as written).
    Theirs(String),
}

/// Point Codex's top-level `notify` at the app (or take the app's out), keeping the rest of the
/// file. Another program's notify is left alone.
fn codex_notify(path: &std::path::Path, exe: &str, uninstall: bool) -> Result<CodexNotify> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e.into()),
    };
    let mut doc: toml_edit::DocumentMut = text
        .parse()
        .with_context(|| format!("{} has a syntax error; not touching it", path.display()))?;
    let ours = |v: &toml_edit::Item| {
        v.as_array().is_some_and(|a| {
            a.iter().any(|x| x.as_str() == Some("hook"))
                && a.iter().any(|x| {
                    x.as_str().is_some_and(|s| {
                        s.contains(crate::brand::APP_COMMAND)
                            || crate::brand::previous().any(|p| s.contains(p))
                    })
                })
        })
    };
    if let Some(cur) = doc.get("notify")
        && !ours(cur)
    {
        return Ok(CodexNotify::Theirs(cur.to_string().trim().to_string()));
    }
    if uninstall {
        doc.remove("notify");
    } else {
        let mut a = toml_edit::Array::new();
        for part in [exe, "hook", "codex"] {
            a.push(part);
        }
        // Top-level keys go before the tables.
        doc.insert("notify", toml_edit::value(a));
    }
    back_up_once(path, "toml")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    crate::config::write_atomic(path, doc.to_string())?;
    Ok(if uninstall {
        CodexNotify::Removed
    } else {
        CodexNotify::Set
    })
}

pub(super) fn install_codex_status(exe: &str, uninstall: bool) -> Result<PathBuf> {
    let path = codex_config();
    integrations::codex_hooks_at(&path, exe, uninstall)?;
    match codex_notify(&path, exe, uninstall)? {
        CodexNotify::Theirs(other) => {
            tracing::info!("left Codex's existing notify command untouched: {other}")
        }
        CodexNotify::Set | CodexNotify::Removed => {}
    }
    Ok(path)
}

pub fn integrate(agent: Option<&str>, uninstall: bool) -> Result<()> {
    let exe = this_exe()?;
    match agent {
        None => integrate_every(&exe, uninstall),
        Some("mcp") => integrate_mcp(&exe, uninstall),
        Some(agent) => {
            let path = integrations::set_up_status(agent, &exe, uninstall)?;
            report_integration(agent, &path, uninstall);
            Ok(())
        }
    }
}

/// Status for every installed agent, then the MCP server; fails, after trying them all, when
/// any couldn't be changed.
fn integrate_every(exe: &str, uninstall: bool) -> Result<()> {
    println!("Status:");
    let results = integrations::set_up_every(integrations::agent_installed, |agent| {
        integrations::connect(agent, exe, uninstall)
    });
    for (agent, outcome) in &results {
        println!("{}: {}", agent.name, outcome.describe(uninstall));
    }
    let failed = results
        .iter()
        .filter(|(_, o)| matches!(o, integrations::Outcome::Failed(_)))
        .count();
    println!("\nMCP:");
    let mcp = integrate_mcp(exe, uninstall);
    println!(
        "\nRestart your agents to load the change, or run `{APP_COMMAND} reload-agents` to restart the ones that are not working for you."
    );
    match (failed, mcp) {
        (0, mcp) => mcp,
        (n, Ok(())) => bail!("{n} agent(s) not changed"),
        (n, Err(e)) => bail!("{n} agent(s) not changed; MCP: {e:#}"),
    }
}

/// Registers (or removes) the MCP server with every agent on this machine that takes one, one
/// line per agent. Fails, after trying every agent, when any of them couldn't be changed.
fn integrate_mcp(exe: &str, uninstall: bool) -> Result<()> {
    let mut failed = 0;
    let mut report = |agent: &str, outcome: Result<String>| match outcome {
        Ok(outcome) => println!("{agent}: {outcome}"),
        Err(e) => {
            failed += 1;
            println!("{agent}: not changed: {e:#}");
        }
    };
    report("Claude Code", claude_mcp(exe, uninstall));
    for agent in mcp_config::agents() {
        let outcome = mcp_config::set_up(&agent, exe, uninstall).map(|change| match change {
            McpChange::Registered => format!("registered in {}", agent.config.display()),
            McpChange::AlreadyRegistered => "already registered".into(),
            McpChange::Removed => format!("removed from {}", agent.config.display()),
            McpChange::NotRegistered => "not registered".into(),
            McpChange::NotInstalled => "skipped (not installed)".into(),
        });
        report(agent.name, outcome);
    }
    if failed > 0 {
        bail!("{failed} agent(s) not changed");
    }
    if !uninstall {
        println!(
            "\nAgents can then list, read, message and start sessions; restart running ones to load it."
        );
        println!(concat!(
            "Whether they may approve prompts is up to you: ",
            env!("APP_COMMAND"),
            " Settings → Agents (never, by default)."
        ));
    }
    Ok(())
}

/// Runs `claude <args>`: whether it succeeded, or `None` when Claude Code isn't installed.
fn claude_cli(args: &[&str], config_dir: Option<&std::path::Path>) -> Result<Option<bool>> {
    match run_claude(args, config_dir) {
        Ok(status) => Ok(Some(status.success())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).context("run claude"),
    }
}

/// Claude Code keeps its servers in `~/.claude.json`, which it rewrites itself, so its own CLI
/// makes the change (user scope: every project).
fn claude_mcp(exe: &str, uninstall: bool) -> Result<String> {
    claude_mcp_in(None, exe, uninstall)
}

/// `claude_mcp` for the Claude that runs with config folder `config_dir` (`None`: this process's own).
fn claude_mcp_in(config_dir: Option<&std::path::Path>, exe: &str, uninstall: bool) -> Result<String> {
    const SKIPPED: &str = "skipped (not installed)";
    let path = claude_json_in(config_dir);
    let root = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .with_context(|| format!("{} isn't valid JSON", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Value::Null,
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let ours = root.get("mcpServers").and_then(|s| s.get(APP_COMMAND));
    let current = ours.and_then(|e| e.get("command")).and_then(Value::as_str) == Some(exe);
    let mut remove = old_mcp_names(&root);
    if ours.is_some() && (uninstall || !current) {
        remove.push(APP_COMMAND.into());
    }
    if uninstall && ours.is_none() && remove.is_empty() {
        return Ok("not registered".into());
    }
    for name in &remove {
        match claude_cli(&["mcp", "remove", "--scope", "user", name], config_dir)? {
            Some(true) => {}
            Some(false) => println!("Claude Code: run  claude mcp remove --scope user {name}"),
            None => return Ok(SKIPPED.into()),
        }
    }
    if uninstall {
        return Ok("removed".into());
    }
    if current {
        return Ok("already registered".into());
    }
    match claude_cli(&[
        "mcp",
        "add",
        "--scope",
        "user",
        APP_COMMAND,
        "--",
        exe,
        "mcp",
    ], config_dir)? {
        Some(true) => Ok("registered (all projects)".into()),
        Some(false) => bail!(
            "`claude mcp add` failed; run  claude mcp add --scope user {APP_COMMAND} -- \"{exe}\" mcp"
        ),
        None => Ok(SKIPPED.into()),
    }
}

fn report_integration(agent: &str, path: &std::path::Path, uninstall: bool) {
    match agent {
        "claude" if uninstall => println!(
            concat!("removed ", env!("APP_COMMAND"), " hooks from {}"),
            path.display()
        ),
        "claude" => {
            println!(
                concat!("installed ", env!("APP_COMMAND"), " hooks into {}"),
                path.display()
            );
            println!(concat!(
                "they only act inside ",
                env!("APP_COMMAND"),
                " panes (",
                env!("APP_ENV"),
                "_TERM_ID), so other terminals are unaffected."
            ));
        }
        "gemini" | "qwen" => {
            println!(
                concat!("{} ", env!("APP_COMMAND"), " hooks {} {}"),
                if uninstall { "removed" } else { "installed" },
                if uninstall { "from" } else { "into" },
                path.display()
            );
        }
        "opencode" => println!(
            concat!("{} ", env!("APP_COMMAND"), "'s opencode plugin: {}"),
            if uninstall { "removed" } else { "wrote" },
            path.display()
        ),
        "codex" => {
            println!(
                concat!("{} ", env!("APP_NAME"), "'s Codex status hooks in {}"),
                if uninstall { "removed" } else { "installed" },
                path.display()
            );
            println!(
                "Live subagent events are tracked; any other Codex notify command is preserved."
            );
        }
        _ => {
            println!(
                "{} {APP_COMMAND}'s {agent} status integration: {}",
                if uninstall { "removed" } else { "wrote" },
                path.display()
            );
            println!(
                "Restart {agent} to load it. Status follows the session, including z.ai and DeepSeek models."
            );
        }
    }
}

/// Debugging: the colours a pane's program is drawing (rows with a background colour).
pub fn debug_colors(pane: TermId) -> Result<()> {
    block_on(async move {
        let (mut r, _w) = ipc::open(true).await.context(concat!(
            "couldn't reach the ",
            env!("APP_COMMAND"),
            " server"
        ))?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        while let Ok(Ok(Some(msg))) =
            tokio::time::timeout_at(deadline, ipc::recv_server(&mut r)).await
        {
            if let ServerMsg::Replay {
                term,
                cols,
                rows,
                data,
            } = msg
                && term == pane
            {
                let mut p = vt100::Parser::new(rows, cols, 0);
                p.process(&data);
                let s = p.screen();
                println!(
                    "alternate screen: {}  mouse: {:?} / {:?}",
                    s.alternate_screen(),
                    s.mouse_protocol_mode(),
                    s.mouse_protocol_encoding()
                );
                let mut h = vt100::Parser::new(rows, cols, 100_000);
                h.process(&data);
                h.screen_mut().set_scrollback(usize::MAX);
                println!(
                    "history lines: {} (replay {} bytes)",
                    h.screen().scrollback(),
                    data.len()
                );
                for row in 0..rows {
                    let mut seen: Vec<String> = Vec::new();
                    for col in 0..cols {
                        let Some(c) = s.cell(row, col) else { continue };
                        if c.bgcolor() == vt100::Color::Default && !c.inverse() {
                            continue;
                        }
                        let d = format!(
                            "fg={:?} bg={:?} inv={} dim={}",
                            c.fgcolor(),
                            c.bgcolor(),
                            c.inverse(),
                            c.dim()
                        );
                        if !seen.contains(&d) {
                            seen.push(d);
                        }
                    }
                    if !seen.is_empty() {
                        let text: String = s
                            .rows(0, cols)
                            .nth(row as usize)
                            .unwrap_or_default()
                            .chars()
                            .take(40)
                            .collect();
                        println!("row {row:>3} {text:<40} {}", seen.join(" | "));
                    }
                }
                return Ok(());
            }
        }
        anyhow::bail!("no pane {pane}")
    })
}

/// `<app> allow`: show the repo's hook commands and let them run from now on.
/// A `~` at the start of a value is your home folder.
fn home_in(value: &str) -> String {
    match (value.strip_prefix('~'), directories::BaseDirs::new()) {
        (Some(rest), Some(d)) => d
            .home_dir()
            .join(rest.trim_start_matches(['/', '\\']))
            .to_string_lossy()
            .into_owned(),
        _ => value.to_string(),
    }
}

/// The command line `<app> account` runs for `command`: the program as typed, each argument
/// quoted again for the shell that will run it.
pub fn account_line(cfg: &crate::config::Config, command: &[String]) -> Option<String> {
    let (program, args) = command.split_first()?;
    Some(
        std::iter::once(program.clone())
            .chain(args.iter().map(|a| cfg.quote_for_shell(a)))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

/// `<app> account <name> -- <command>`: run it with that account's environment, in this
/// terminal, and leave with its exit code.
pub fn account(name: &str, command: &[String]) -> Result<()> {
    let (cfg, _) = crate::config::Config::load_or_default();
    let Some(a) = cfg.account(name) else {
        let known: Vec<&str> = cfg
            .quick
            .agents
            .iter()
            .filter(|a| !a.env.is_empty())
            .map(|a| a.name.as_str())
            .collect();
        let known = if known.is_empty() {
            "none yet: give a [[quick.agents]] entry an env".to_string()
        } else {
            known.join(", ")
        };
        anyhow::bail!("no account named \"{name}\" (accounts: {known})");
    };
    let Some(line) = account_line(&cfg, command) else {
        anyhow::bail!("give the command to run: {APP_COMMAND} account \"{name}\" -- claude");
    };
    let status = crate::proc::shell(&cfg.shell_command(), &line, true)
        .envs(a.env.iter().map(|(k, v)| (k.clone(), home_in(v))))
        .status()?;
    std::process::exit(status.code().unwrap_or(1));
}

pub fn allow(dir: Option<std::path::PathBuf>) -> Result<()> {
    let dir = match dir {
        Some(d) => d,
        None => std::env::current_dir()?,
    };
    let p = crate::project::load(&dir);
    let cmds = [p.hooks.on_create.as_str(), p.hooks.on_remove.as_str()];
    if cmds.iter().all(|c| c.trim().is_empty()) {
        println!(
            "no hooks in {} here; nothing to allow",
            crate::project::FILE
        );
        return Ok(());
    }
    crate::project::allow(&dir, &cmds)?;
    for (what, c) in [("on_create", cmds[0]), ("on_remove", cmds[1])] {
        if !c.trim().is_empty() {
            println!("allowed {what}: {c}");
        }
    }
    println!("(if the commands change, they won't run until you allow them again)");
    Ok(())
}

#[cfg(test)]
mod hook_payload_tests {
    use super::read_hook_payload;
    use serde_json::json;

    #[test]
    fn a_hook_input_is_read_whole_when_it_fits() {
        let input = json!({ "hook_event_name": "Stop", "session_id": "s1" }).to_string();
        let read = read_hook_payload(input.as_bytes(), 1 << 10).unwrap();
        assert_eq!(read, json!({ "hook_event_name": "Stop", "session_id": "s1" }));
    }

    /// A tool printed more than is kept: the report still says which event it was, so the
    /// pane's status moves on.
    #[test]
    fn a_hook_input_too_large_to_keep_still_reports_its_event() {
        let input = json!({
            "session_id": "s1",
            "cwd": "C:\\work\\\"quoted\"",
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_input": { "cwd": "elsewhere" },
            "tool_response": "x".repeat(4096),
        })
        .to_string();
        let read = read_hook_payload(input.as_bytes(), 1024).unwrap();
        assert_eq!(read["hook_event_name"], "PostToolUse");
        assert_eq!(read["tool_name"], "Bash");
        assert_eq!(read["session_id"], "s1");
        assert_eq!(read["cwd"], "C:\\work\\\"quoted\"");
        assert!(read.get("tool_response").is_none());
    }
}

#[cfg(test)]
mod bundled_daemon_tests {
    use super::{BUNDLED_DAEMON, app_hook_names, is_bundled_daemon, keep_copy};
    use std::path::Path;

    fn scratch(label: &str) -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "{}-bundled-{label}-{}",
            env!("APP_COMMAND"),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        folder
    }

    #[test]
    fn the_bundled_daemon_is_told_by_its_name_with_or_without_a_target_triple() {
        for name in [
            BUNDLED_DAEMON.to_string(),
            format!("{BUNDLED_DAEMON}.exe"),
            format!("{BUNDLED_DAEMON}-x86_64-unknown-linux-gnu"),
        ] {
            assert!(
                is_bundled_daemon(&Path::new("/tmp/.mount_X/usr/bin").join(&name)),
                "{name}"
            );
        }
        let terminal_app = Path::new("/home/me/.local/bin").join(env!("APP_COMMAND"));
        assert!(!is_bundled_daemon(&terminal_app));
    }

    #[test]
    fn an_old_hook_naming_the_bundled_daemon_is_one_of_ours() {
        assert!(app_hook_names().contains(&BUNDLED_DAEMON));
        // A hook written before the rename names the old bundled copy, still ours to replace.
        for old in crate::brand::previous_daemon_names() {
            let hook = format!("\"/home/me/.local/share/{old}\" hook claude");
            assert!(maitty_provider_claude::runs_our_hook(&hook, &app_hook_names()), "{hook}");
        }
        let dead = format!("\"/tmp/.mount_Gone/usr/bin/{BUNDLED_DAEMON}\" hook claude");
        assert!(maitty_provider_claude::runs_our_hook(&dead, &app_hook_names()));
    }

    #[test]
    fn the_copy_is_made_once_and_replaced_when_the_build_changes() {
        let from = scratch("from");
        let to = scratch("to");
        let running = from.join(format!("{BUNDLED_DAEMON}-x86_64-unknown-linux-gnu"));
        std::fs::write(&running, b"build one").unwrap();

        let first = keep_copy(&running, &to).unwrap();
        assert_eq!(std::fs::read(&first).unwrap(), b"build one");
        assert_eq!(first.file_stem().unwrap().to_string_lossy(), BUNDLED_DAEMON);

        let modified = std::fs::metadata(&first).unwrap().modified().unwrap();
        assert_eq!(keep_copy(&running, &to).unwrap(), first);
        assert_eq!(
            std::fs::metadata(&first).unwrap().modified().unwrap(),
            modified
        );

        std::fs::write(&running, b"build two, longer").unwrap();
        assert_eq!(keep_copy(&running, &to).unwrap(), first);
        assert_eq!(std::fs::read(&first).unwrap(), b"build two, longer");
        assert!(!to.join(format!("{BUNDLED_DAEMON}.partial")).exists());
    }
}

#[cfg(test)]
mod tests {
    fn check(state: CheckState) -> CheckInfo {
        CheckInfo {
            command: "npm test".into(),
            state,
            exit_code: Some(1),
            first_failing_line: "FAIL footer.test.ts".into(),
            ..Default::default()
        }
    }

    #[test]
    fn a_wait_ends_only_once_the_turn_and_every_running_check_are_over() {
        let running = check(CheckState::Checking);
        // (status, said, checks, seen working, quiet, what the wait returns, why)
        type Case<'a> = (Status, &'a str, Vec<CheckInfo>, bool, bool, Option<Waited>, &'a str);
        let mut cases: Vec<Case> = vec![
            (Status::Done, "all done", vec![running.clone()], true, false, None, "blocked while the check runs"),
            (Status::Idle, "", vec![running.clone()], false, true, None, "not even after the quiet-turn grace"),
            (Status::Done, "", vec![], true, false, Some(Waited::Turn(Status::Done, String::new(), None)), "no check: the turn is over"),
            (Status::Working, "", vec![], false, true, None, "still working"),
            (Status::Done, "x", vec![], false, false, None, "the turn never started"),
            (Status::Blocked, "q", vec![], true, false, Some(Waited::Turn(Status::Blocked, "q".into(), None)), "needs you"),
            (Status::None, "", vec![], false, true, Some(Waited::Turn(Status::None, String::new(), None)), "quiet with no status"),
        ];
        for state in [
            CheckState::Passed,
            CheckState::Failed,
            CheckState::CouldNotRun,
            CheckState::Overridden,
        ] {
            let info = check(state);
            cases.push((
                Status::Done,
                "done",
                vec![info.clone()],
                true,
                false,
                Some(Waited::Turn(Status::Done, "done".into(), Some(Box::new(info)))),
                "the check result comes with the reply",
            ));
        }
        for (i, (status, said, checks, seen_working, quiet, want, why)) in cases.into_iter().enumerate() {
            assert_eq!(turn_over(status, said, &checks, seen_working, quiet), want, "case {i}: {why}");
        }
    }

    fn named(name: &str, state: CheckState) -> CheckInfo {
        CheckInfo {
            name: name.into(),
            ..check(state)
        }
    }

    #[test]
    fn a_waiter_waits_until_no_checkpoint_is_running_or_waiting_its_turn() {
        let failed_first = [
            named("build", CheckState::Failed),
            named("test", CheckState::Checking),
        ];
        assert_eq!(
            turn_over(Status::Done, "", &failed_first, true, false),
            None,
            "a failure does not end the wait while another runs"
        );
        let pending = [
            named("build", CheckState::Passed),
            named("test", CheckState::Pending),
        ];
        assert_eq!(turn_over(Status::Done, "", &pending, true, false), None);
        let settled = [
            named("build", CheckState::Failed),
            named("test", CheckState::Passed),
        ];
        let Some(Waited::Turn(_, _, Some(headline))) =
            turn_over(Status::Done, "", &settled, true, false)
        else {
            panic!("the turn is over")
        };
        assert_eq!(headline.name, "build", "it ends on the worst checkpoint");
    }

    #[test]
    fn wait_exits_four_on_any_failed_checkpoint_and_zero_on_the_rest() {
        let exit = |states: &[CheckState]| {
            let checks: Vec<_> = states
                .iter()
                .enumerate()
                .map(|(i, &s)| named(&format!("c{i}"), s))
                .collect();
            let Some(Waited::Turn(s, _, headline)) =
                turn_over(Status::Done, "", &checks, true, false)
            else {
                panic!("over")
            };
            turn_exit(s, headline.as_deref())
        };
        assert_eq!(
            exit(&[CheckState::Passed, CheckState::Failed]),
            Some(EXIT_CHECK_FAILED)
        );
        assert_eq!(
            exit(&[CheckState::Failed, CheckState::NeedsApproval]),
            Some(EXIT_CHECK_FAILED)
        );
        for state in [
            CheckState::NeedsApproval,
            CheckState::Never,
            CheckState::CouldNotRun,
            CheckState::Stale,
            CheckState::Overridden,
            CheckState::Passed,
        ] {
            assert_eq!(exit(&[CheckState::Passed, state]), None, "{state:?}");
        }
        assert_eq!(turn_exit(Status::Blocked, None), Some(3));
    }

    #[test]
    fn every_check_state_reads_the_same_beside_the_status_and_in_a_wait() {
        let with_exit = |state: CheckState, exit_code: Option<i32>| CheckInfo {
            state,
            exit_code,
            ..check(state)
        };
        let stale = |files: &[&str]| CheckInfo {
            name: "test".into(),
            changed_files: files
                .iter()
                .map(|p| ChangedFile {
                    kind: 'M',
                    path: (*p).into(),
                })
                .collect(),
            ..check(CheckState::Stale)
        };
        // (check, the note beside the status in ls, the line a wait prints where it is pinned)
        let cases = [
            (with_exit(CheckState::Failed, Some(1)), "check failed (exit 1)", Some("check failed: npm test (exit 1): FAIL footer.test.ts")),
            (with_exit(CheckState::Failed, None), "check failed", None),
            (with_exit(CheckState::Checking, None), "checking", None),
            (with_exit(CheckState::Passed, Some(0)), "check passed", None),
            (check(CheckState::Passed), "check passed", Some("check passed: npm test")),
            (with_exit(CheckState::CouldNotRun, Some(127)), "check could not run", None),
            (check(CheckState::CouldNotRun), "check could not run", Some("check could not run: npm test")),
            (check(CheckState::Overridden), "check overridden", Some("check failed, accepted: npm test (exit 1): FAIL footer.test.ts")),
            (stale(&["a", "b", "c"]), "stale pass: test · 3 files changed", Some("stale pass: test · 3 files changed")),
            (stale(&["x"]), "stale pass: test · 1 file changed", None),
            (check(CheckState::Never), "not checked: never for this repo", Some("not checked: never for this repo")),
            (check(CheckState::NeedsApproval), "approve check: npm test", Some("approve check: npm test")),
            (check(CheckState::Pending), "pending", Some("pending: npm test")),
        ];
        for (info, note, line) in cases {
            assert_eq!(check_note(&info), note, "{:?} exit {:?}", info.state, info.exit_code);
            if let Some(line) = line {
                assert_eq!(check_line(&info), line, "{:?}", info.state);
            }
        }
    }

    #[test]
    fn ls_shows_the_headline_and_how_many_checkpoints() {
        let mut p = pane("Done", Some("claude"), None);
        p.checks = vec![
            named("build", CheckState::Passed),
            named("test", CheckState::Failed),
        ];
        assert_eq!(
            agent_tag(&p).as_deref(),
            Some("claude: done · check failed (exit 1) · 2 checkpoints")
        );
        let v = pane_json(&p);
        assert_eq!(
            v["check"]["state"], "failed",
            "check stays the headline for scripts"
        );
        let listed: Vec<_> = v["checks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| (c["name"].as_str().unwrap(), c["state"].as_str().unwrap()))
            .collect();
        assert_eq!(listed, [("build", "passed"), ("test", "failed")]);
    }

    fn pane(status: &str, agent: Option<&str>, check: Option<CheckInfo>) -> TermInfo {
        let mut p: TermInfo = serde_json::from_value(json!({
            "id": 3, "cols": 80, "rows": 24, "title": "", "process": "node", "agent": agent,
            "status": status, "cwd": "/code", "summary": "", "name": "", "model": "", "said": "",
            "branch": null, "linked": false, "subagents": [], "root": null, "top": null,
            "since": 0, "asleep": false, "win32_input": false,
        }))
        .unwrap();
        p.checks = check.into_iter().collect();
        p
    }

    #[test]
    fn ls_shows_the_check_in_the_agent_tag_only_when_there_is_one() {
        let failed = pane("Done", Some("claude"), Some(check(CheckState::Failed)));
        assert_eq!(
            agent_tag(&failed).as_deref(),
            Some("claude: done · check failed (exit 1)")
        );
        assert_eq!(
            agent_tag(&pane("Done", Some("claude"), None)).as_deref(),
            Some("claude: done")
        );
        assert_eq!(
            agent_tag(&pane("Done", None, Some(check(CheckState::Failed)))),
            None,
            "a shell has no tag"
        );
        let working = pane("Working", Some("claude"), Some(check(CheckState::Failed)));
        assert_eq!(
            agent_tag(&working).as_deref(),
            Some("claude: working"),
            "the last result is about an older turn"
        );
    }

    #[test]
    fn send_refuses_hidden_characters_before_reaching_any_pane() {
        // Pane 0 is never real, so reaching the server would fail with a different error.
        let err = send(
            &Target::current(),
            Some(0),
            "looks fine\u{200b}".into(),
            true,
        )
        .unwrap_err()
        .to_string();
        assert_eq!(
            err,
            "refused: hidden characters \\u{200b} at 10; remove them and send again"
        );
        assert!(
            crate::hidden::check("\x03").is_ok() && crate::hidden::check("2").is_ok(),
            "Ctrl-C and a digit answer still go"
        );
    }

    #[test]
    fn ls_says_how_long_a_working_agent_has_been_quiet() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut p = pane("Working", Some("claude"), None);
        p.quiet_since = Some(now - 12 * 60);
        assert_eq!(
            agent_tag(&p).as_deref(),
            Some("claude: working · quiet 12m")
        );
        assert_eq!(pane_json(&p)["quiet_since"], json!(now - 12 * 60));
        p.status = Status::Done;
        assert_eq!(
            agent_tag(&p).as_deref(),
            Some("claude: done"),
            "only a working agent is quiet"
        );
        assert!(pane_json(&p).get("quiet_since").is_none());
    }

    #[test]
    fn ls_says_a_working_agent_is_repeating_itself() {
        let mut p = pane("Working", Some("claude"), None);
        p.repeats = Some(6);
        assert_eq!(
            agent_tag(&p).as_deref(),
            Some("claude: working · repeating 6x")
        );
        assert_eq!(pane_json(&p)["repeats"], json!(6));
        p.status = Status::Done;
        assert_eq!(
            agent_tag(&p).as_deref(),
            Some("claude: done"),
            "only a working agent repeats"
        );
        assert!(pane_json(&p).get("repeats").is_none());
        let mut plain = pane("Working", Some("claude"), None);
        assert!(pane_json(&plain).get("repeats").is_none(), "not repeating, no key");
        plain.repeats = None;
        assert_eq!(agent_tag(&plain).as_deref(), Some("claude: working"));
    }

    #[test]
    fn a_wait_that_times_out_on_a_working_agent_says_why_it_looks_stuck() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let twelve_minutes_ago = now - 12 * 60;
        assert_eq!(still_working_note(None, None), None);
        assert_eq!(
            still_working_note(Some(twelve_minutes_ago), None).as_deref(),
            Some("still working, but quiet for 12m")
        );
        assert_eq!(
            still_working_note(None, Some(6)).as_deref(),
            Some("still working, but repeating itself (6x)")
        );
        // Silence is the stronger sign: a quiet agent says so first.
        assert!(
            still_working_note(Some(twelve_minutes_ago), Some(6))
                .unwrap()
                .starts_with("still working, but quiet for")
        );
    }

    #[test]
    fn ls_json_gives_a_pane_with_a_check_a_check_object() {
        let mut info = check(CheckState::Overridden);
        (info.duration_ms, info.rerun_queued, info.overridden_at) = (14_200, true, Some(130));
        let v = pane_json(&pane("Done", Some("claude"), Some(info)));
        assert_eq!(
            v["check"],
            json!({
                "state": "overridden", "command": "npm test", "exit_code": 1, "duration_ms": 14_200,
                "first_failing_line": "FAIL footer.test.ts", "rerun_queued": true, "overridden_at": 130,
            })
        );
        assert_eq!(v["status"], "done", "the status field itself is unchanged");
    }

    #[test]
    fn ls_json_for_a_pane_with_no_check_is_what_it_was() {
        let v = pane_json(&pane("Done", Some("claude"), None));
        assert!(v.get("check").is_none());
        assert_eq!(
            v.to_string(),
            r#"{"agent":"claude","asleep":false,"bell":false,"cols":80,"cwd":"/code","id":3,"mem_mb":0,"model":"","name":"","process":"node","rows":24,"status":"done","status_why":"","title":"","win32_input":false}"#
        );
    }

    #[test]
    fn codex_status_setup_requires_root_thread_and_subagent_hooks_for_each_platform() {
        let linux = concat!(
            r#"
            [[hooks.SessionStart]]
            [[hooks.SessionStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex --status same'
            [[hooks.SubagentStart]]
            [[hooks.SubagentStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex'
            [[hooks.SubagentStop]]
            [[hooks.SubagentStop.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex'
        "#
        );
        let windows = concat!(
            r#"
            [[hooks.SessionStart]]
            [[hooks.SessionStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex --status same'
            commandWindows = '& "C:\\\\"#,
            env!("APP_COMMAND"),
            r#".exe" hook codex --status same'
            [[hooks.SubagentStart]]
            [[hooks.SubagentStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex'
            commandWindows = '& "C:\\\\"#,
            env!("APP_COMMAND"),
            r#".exe" hook codex'
            [[hooks.SubagentStop]]
            [[hooks.SubagentStop.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex'
            commandWindows = '& "C:\\\\"#,
            env!("APP_COMMAND"),
            r#".exe" hook codex'
        "#
        );
        let missing_stop = concat!(
            r#"
            [[hooks.SessionStart]]
            [[hooks.SessionStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex --status same'
            [[hooks.SubagentStart]]
            [[hooks.SubagentStart.hooks]]
            type = "command"
            command = '"/usr/local/bin/"#,
            env!("APP_COMMAND"),
            r#"" hook codex'
        "#
        );

        assert!(super::codex_status_hooks_installed(linux, false));
        assert!(!super::codex_status_hooks_installed(linux, true));
        assert!(super::codex_status_hooks_installed(windows, true));
        assert!(!super::codex_status_hooks_installed(missing_stop, false));
        assert!(!super::codex_status_hooks_installed("[hooks\n", false));
    }

    #[test]
    fn hydras_status_line_keeps_yours() {
        let kept = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-statusline-{}.txt"),
            std::process::id()
        ));
        let mut root = serde_json::json!({ "statusLine": { "type": "command", "command": "chm statusline", "padding": 1 } });
        super::statusline_setting(
            &mut root,
            concat!("C:/x/", env!("APP_COMMAND"), ".exe"),
            false,
            &kept,
        )
        .unwrap();
        // On Windows a path with nothing to quote is left bare, so it runs in Git Bash and in
        // PowerShell alike; elsewhere it is quoted for sh.
        let expected = if cfg!(windows) {
            concat!("C:/x/", env!("APP_COMMAND"), ".exe statusline")
        } else {
            concat!("\"C:/x/", env!("APP_COMMAND"), ".exe\" statusline")
        };
        assert_eq!(root["statusLine"]["command"], expected);
        assert_eq!(
            root["statusLine"]["padding"], 1,
            "your settings for it stay"
        );
        assert_eq!(
            std::fs::read_to_string(&kept).unwrap(),
            "chm statusline",
            concat!("and yours still runs after ", env!("APP_COMMAND"), "'s")
        );
        super::statusline_setting(
            &mut root,
            concat!("C:/y/", env!("APP_COMMAND"), ".exe"),
            false,
            &kept,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(&kept).unwrap(),
            "chm statusline",
            "installing again doesn't lose yours"
        );
        super::statusline_setting(
            &mut root,
            concat!("C:/y/", env!("APP_COMMAND"), ".exe"),
            true,
            &kept,
        )
        .unwrap();
        assert_eq!(
            root["statusLine"]["command"], "chm statusline",
            "uninstalling puts yours back"
        );
        let mut none = serde_json::json!({});
        super::statusline_setting(
            &mut none,
            concat!("C:/x/", env!("APP_COMMAND"), ".exe"),
            false,
            &kept,
        )
        .unwrap();
        super::statusline_setting(
            &mut none,
            concat!("C:/x/", env!("APP_COMMAND"), ".exe"),
            true,
            &kept,
        )
        .unwrap();
        assert!(none.get("statusLine").is_none(), "none before: none after");
    }

    #[test]
    fn claude_says_what_it_used_through_its_status_line() {
        use crate::protocol::Usage;
        let full = r#"{"cost":{"total_cost_usd":1.25},"context_window":{"context_window_size":200000,"used_percentage":42},
            "rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":1738425600},"seven_day":{"used_percentage":41.2,"resets_at":1738857600}}}"#;
        // (status line, what it used, plan limits, why)
        type Case<'a> = (&'a str, Usage, &'a [(&'a str, f32, u64)], &'a str);
        let cases: [Case; 4] = [
            (
                r#"{"context_window":{"total_input_tokens":1200,"total_output_tokens":300}}"#,
                Usage { tokens: Some(1500), tokens_in: Some(1200), tokens_out: Some(300), ..Default::default() },
                &[],
                "input and output tokens apart, and their sum",
            ),
            (
                r#"{"context_window":{"total_input_tokens":7}}"#,
                Usage { tokens_in: Some(7), ..Default::default() },
                &[],
                "no total without both halves",
            ),
            (
                full,
                Usage { context: Some(42.0), cost: Some(1.25), ..Default::default() },
                &[("5h", 23.5, 1738425600), ("week", 41.2, 1738857600)],
                "context, cost and plan limits",
            ),
            (
                r#"{"context_window":{"used_percentage":null}}"#,
                Usage::default(),
                &[],
                "early in a session, or not on a plan: nothing yet",
            ),
        ];
        for (json, usage, limits, why) in cases {
            let (u, l) = super::statusline_facts(json);
            assert_eq!(u, usage, "{why}");
            assert_eq!(
                l.iter()
                    .map(|x| (x.name.as_str(), x.used, x.resets_at))
                    .collect::<Vec<_>>(),
                limits,
                "{why}"
            );
        }
    }

    #[test]
    fn only_new_work_gets_a_worktree_and_an_earlier_conversation_stays_in_its_folder() {
        let cases: &[(&str, &[&str], bool, &str)] = &[
            ("claude", &[], true, "a new session"),
            ("claude", &["fix the login page"], true, "a task"),
            ("claude", &["--model", "opus"], true, "a new session with options"),
            ("claude", &["update the readme"], true, "a task"),
            ("claude", &["--continue"], false, "an earlier conversation"),
            ("claude", &["-r"], false, "an earlier conversation"),
            ("claude", &["resume"], false, "an earlier conversation"),
            ("claude", &["--version"], false, "not work: help"),
            ("claude", &["-p", "what's 2+2"], false, "not work: a one-shot"),
            ("claude", &["mcp", "list"], false, "not work: a subcommand"),
            ("claude", &["update"], false, "not work: a subcommand"),
            ("codex", &[], true, "new Codex work"),
            ("codex", &["-c", "model=\"example\""], true, "new Codex work"),
            ("codex", &["-p", "feature"], true, "new Codex work"),
            ("codex", &["--profile", "resume"], true, "a profile named resume"),
            ("codex", &["--config=model=\"example\"", "build login"], true, "new Codex work"),
            ("codex", &["-pfeature"], true, "new Codex work"),
            ("codex", &["--", "--resume"], true, "after --, a prompt"),
            ("codex", &["resume", "--last"], false, "Codex stays in the requested folder"),
            ("codex", &["-m", "example", "resume", "--last"], false, "Codex stays in the requested folder"),
            ("codex", &["fork", "--last"], false, "Codex stays in the requested folder"),
            ("codex", &["--profile", "feature", "review"], false, "Codex stays in the requested folder"),
            ("codex", &["--version"], false, "Codex stays in the requested folder"),
            ("codex", &["mcp", "list"], false, "Codex stays in the requested folder"),
            ("codex", &["--worktree"], false, "Codex stays in the requested folder"),
            ("codex", &["-C", "somewhere"], false, "Codex stays in the requested folder"),
            ("codex", &["--cd=somewhere"], false, "Codex stays in the requested folder"),
            ("codex", &["-Csomewhere"], false, "Codex stays in the requested folder"),
            ("codex", &["fix login", "--cd", "somewhere"], false, "Codex stays in the requested folder"),
        ];
        for &(agent, args, new_work, why) in cases {
            let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
            assert_eq!(super::starts_new_work(agent, &args), new_work, "{agent} {args:?}: {why}");
        }
    }

    #[test]
    fn a_finished_turn_is_done_even_when_its_transcript_has_background_work() {
        let file = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-background-turn-{}.jsonl"),
            std::process::id()
        ));
        let transcript = [
            json!({"type":"user","message":{"content":"start the game server"}}),
            json!({"type":"user","message":{"content":[{"type":"tool_result","content":"Command running in background with ID: server1. Output is being written to: x"}]}}),
            json!({"type":"assistant","message":{"content":[{"type":"text","text":"The game server is ready."}]}}),
        ];
        std::fs::write(
            &file,
            transcript
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        for event in ["Stop", "Notification"] {
            let payload = json!({"hook_event_name":event,"notification_type":"idle_prompt","transcript_path":file});
            let status = super::status_from_hook(&payload).unwrap();
            let source = super::HookOrigin {
                term: 1,
                agent: "claude".into(),
                pid: 0,
                token: String::new(),
            };
            let ClientMsg::Hook {
                status,
                said,
                transcript,
                ..
            } = super::hook_message(source, &payload, status)
            else {
                panic!("expected hook report")
            };
            assert_eq!(
                status,
                HookStatus::Done,
                "{event} ends the turn while the server remains alive"
            );
            assert_eq!(said.as_deref(), Some("The game server is ready."));
            assert_eq!(transcript.as_ref(), Some(&file));
        }
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn a_claude_stop_with_background_work_in_flight_says_so() {
        let stop_of = |tasks: Value, helpers_only: bool| {
            let payload =
                json!({"hook_event_name":"Stop","background_tasks":tasks,"session_crons":[]});
            let origin = super::HookOrigin {
                term: 1,
                agent: "claude".into(),
                pid: 0,
                token: String::new(),
            };
            let ClientMsg::Hook {
                status,
                background,
                background_agents,
                ..
            } = super::hook_message(origin, &payload, super::status_from_hook(&payload).unwrap())
            else {
                panic!("expected hook report")
            };
            assert_eq!(status, HookStatus::Done);
            assert!(
                background_agents.iter().all(|id| background.contains(id)),
                "helpers are a subset of what is in flight"
            );
            if helpers_only { background_agents } else { background }
        };
        let stop = |tasks: Value| stop_of(tasks, false);
        let shell = json!([{"id":"b1","type":"shell","status":"running","description":"watch CI","command":"gh pr checks 38 --watch"}]);
        assert_eq!(stop(shell), ["b1"], "still in flight");
        assert_eq!(
            stop(json!([])),
            Vec::<String>::new(),
            "nothing in flight: the turn is over"
        );
        let over = json!([{"id":"b2","type":"shell","status":"completed"}, {"id":"a3","type":"subagent","status":"Failed"}, {"id":"b4","type":"shell"}]);
        assert_eq!(
            stop(over),
            ["b4"],
            "finished entries don't count; one with no status might still run"
        );
        let mixed = json!([{"id":"b1","type":"shell","status":"running"}, {"id":"a2","type":"subagent","status":"running"}, {"id":"a3","type":"subagent","status":"completed"}]);
        assert_eq!(
            stop_of(mixed, true),
            ["a2"],
            "only a running helper agent is named as one: a shell may be a server"
        );
    }

    #[test]
    fn a_stop_says_whether_the_agent_listed_its_background_work() {
        let reported = |payload: Value| {
            let origin = super::HookOrigin {
                term: 1,
                agent: "claude".into(),
                pid: 0,
                token: String::new(),
            };
            let ClientMsg::Hook {
                background_reported,
                ..
            } = super::hook_message(origin, &payload, super::status_from_hook(&payload).unwrap())
            else {
                panic!("expected hook report")
            };
            background_reported
        };
        assert!(reported(json!({"hook_event_name":"Stop","background_tasks":[]})), "an empty list is nothing running");
        assert!(!reported(json!({"hook_event_name":"Stop"})), "no list is nothing said");
        assert!(!reported(json!({"hook_event_name":"PostToolUse","background_tasks":[]})), "only a stop is asked");
        assert!(
            reported(json!({"hook_event_name":"SubagentStop","agent_id":"a1","background_tasks":[]})),
            "a helper's stop lists them too"
        );
    }

    /// Claude Code 2.1.325's shapes, as captured from its hooks.
    #[test]
    fn a_helper_says_what_it_put_in_the_background_and_what_still_runs_when_it_stops() {
        let message = |payload: Value| {
            let origin = super::HookOrigin {
                term: 1,
                agent: "claude".into(),
                pid: 0,
                token: String::new(),
            };
            let status = super::status_from_hook(&payload).unwrap_or(HookStatus::Same);
            let ClientMsg::Hook {
                background,
                background_agents,
                background_reported,
                subagent,
                ..
            } = super::hook_message(origin, &payload, status)
            else {
                panic!("expected hook report")
            };
            (background, background_agents, background_reported, subagent.map(|s| s.start))
        };
        let shell = json!({"hook_event_name":"PostToolUse","agent_id":"a1","agent_type":"fork","tool_name":"Bash",
            "tool_input":{"command":"sleep 20","run_in_background":true},
            "tool_response":{"stdout":"","stderr":"","interrupted":false,"isImage":false,"noOutputExpected":false,"backgroundTaskId":"b1"}});
        assert_eq!(message(shell), (vec!["b1".to_string()], vec![], false, Some(true)), "the shell is the helper's own work");
        let helper = json!({"hook_event_name":"PostToolUse","agent_id":"a1","tool_name":"Agent",
            "tool_response":{"isAsync":true,"status":"async_launched","agentId":"a2"}});
        assert_eq!(message(helper).0, ["a2"], "so is a helper it launched without waiting");
        let foreground = json!({"hook_event_name":"PostToolUse","agent_id":"a1","tool_name":"Bash","tool_response":{"stdout":"ok"}});
        assert!(message(foreground).0.is_empty(), "a call that finished started nothing");
        let parents_own = json!({"hook_event_name":"PostToolUse","tool_name":"Bash","tool_response":{"backgroundTaskId":"b9"}});
        assert!(message(parents_own).0.is_empty(), "the session's own shells are listed at its stop");
        let stop = json!({"hook_event_name":"SubagentStop","agent_id":"a1","agent_type":"fork","stop_hook_active":false,
            "background_tasks":[{"id":"a1","type":"subagent","status":"running","agent_type":"fork"},
                                {"id":"b1","type":"shell","status":"running","command":"sleep 20"}]});
        assert_eq!(
            message(stop),
            (vec!["a1".to_string(), "b1".to_string()], vec!["a1".to_string()], true, Some(false)),
            "its stop lists what still runs"
        );
    }

    #[test]
    fn claude_subagent_task_comes_from_its_meta_file() {
        let dir = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-meta-{}"),
            std::process::id()
        ));
        let subagents = dir.join("sess").join("subagents");
        std::fs::create_dir_all(&subagents).unwrap();
        std::fs::write(
            subagents.join("agent-abc.meta.json"),
            r#"{"agentType":"general-purpose","description":"Debugging Go back test failure"}"#,
        )
        .unwrap();
        let parent = dir.join("sess.jsonl");
        let inner = subagents.join("agent-abc.jsonl");
        let want = Some("Debugging Go back test failure".to_string());
        assert_eq!(
            super::subagent_description("claude", Some(&parent), Some("abc")),
            want,
            "from SubagentStart"
        );
        assert_eq!(
            super::subagent_description("claude", Some(&inner), None),
            want,
            "from a hook inside the subagent"
        );
        assert_eq!(
            super::subagent_description("codex", Some(&inner), None),
            None
        );
        assert_eq!(
            super::subagent_description("claude", Some(&parent), Some("missing")),
            None
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn each_agents_hook_events_mean_its_states() {
        use crate::protocol::HookStatus as H;
        let cases = [
            (json!({"hook_event_name": "UserPromptSubmit"}), Some(H::Working), "claude: a turn starts"),
            (json!({"hook_event_name": "Stop"}), Some(H::Done), "claude, and qwen speaks claude's events"),
            (json!({"hook_event_name": "Notification", "notification_type": "permission_prompt"}), Some(H::Blocked), "claude"),
            (json!({"hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion"}), Some(H::Blocked), "claude asks"),
            (json!({"hook_event_name": "Notification", "notification_type": "auth_success"}), None, "claude: not a state"),
            (json!({"hook_event_name": "BeforeAgent"}), Some(H::Working), "gemini: a turn starts"),
            (json!({"hook_event_name": "AfterAgent"}), Some(H::Done), "gemini"),
            (json!({"hook_event_name": "Notification", "notification_type": "ToolPermission"}), Some(H::Blocked), "gemini"),
            (json!({"type": "session.status", "properties": {"status": {"type": "busy"}}}), Some(H::Working), "opencode"),
            (json!({"type": "permission.asked", "properties": {}}), Some(H::Blocked), "opencode"),
            (json!({"type": "session.idle", "properties": {}}), Some(H::Done), "opencode"),
            (json!({"type": "question.replied"}), Some(H::Working), "opencode"),
            (json!({"type": "question.rejected"}), Some(H::Working), "opencode"),
            (json!({"type": "session.error"}), Some(H::Done), "opencode"),
            (json!({"type": "agent-turn-complete"}), Some(H::Done), "codex"),
        ];
        for (payload, want, who) in cases {
            assert_eq!(status_from_hook(&payload), want, "{who}: {payload}");
        }
    }

    #[test]
    fn native_helper_events_from_kimi_and_mastracode_reach_the_parent() {
        use crate::protocol::HookStatus as H;
        let start = json!({"hook_event_name":"SubagentStart","session_id":"root","agent_name":"Explore","task":"Audit account flow","model":"opus","reasoning_effort":"high"});
        let origin = super::HookOrigin {
            term: 9,
            agent: "kimi".into(),
            pid: 10,
            token: String::new(),
        };
        let ClientMsg::Hook {
            subagent, status, ..
        } = super::hook_message(origin, &start, H::Working)
        else {
            panic!("expected hook")
        };
        assert_eq!(status, H::Working);
        assert!(subagent.as_ref().is_some_and(|event| event.id.is_empty()
            && event.kind == "Explore"
            && event.start
            && event.reported_at > 0));
        assert!(
            subagent
                .as_ref()
                .is_some_and(|event| event.task.as_deref() == Some("Audit account flow")
                    && event.model.as_deref() == Some("opus")
                    && event.effort.as_deref() == Some("high"))
        );

        let end = json!({"hook_event_name":"SubagentEnd","session_id":"root","agent_id":"child","agent_type":"review"});
        let origin = super::HookOrigin {
            term: 9,
            agent: "mastracode".into(),
            pid: 10,
            token: String::new(),
        };
        let ClientMsg::Hook {
            subagent, status, ..
        } = super::hook_message(origin, &end, H::Same)
        else {
            panic!("expected hook")
        };
        assert_eq!(status, H::Same);
        assert!(subagent.as_ref().is_some_and(|event| event.id == "child"
            && event.kind == "review"
            && !event.start
            && event.reported_at > 0));
    }

    #[test]
    fn codex_native_helper_events_reach_the_owning_parent_session() {
        use crate::protocol::HookStatus as H;
        let payload = json!({
            "hook_event_name": "SubagentStart",
            "session_id": "parent-thread",
            "agent_id": "child-thread",
            "agent_type": "reviewer",
            "cwd": "/project",
            "last_assistant_message": "child result must not become the parent summary",
        });
        assert_eq!(super::status_from_hook(&payload), Some(H::Working));
        let origin = super::HookOrigin {
            term: 4,
            agent: "codex".into(),
            pid: 12,
            token: "pane-token".into(),
        };
        let ClientMsg::Hook {
            session,
            cwd,
            subagent,
            status,
            said,
            ..
        } = super::hook_message(origin, &payload, H::Working)
        else {
            panic!("expected hook")
        };
        assert_eq!(status, H::Working);
        assert_eq!(session.as_deref(), Some("parent-thread"));
        assert_eq!(cwd.as_deref(), Some(std::path::Path::new("/project")));
        assert!(
            subagent
                .as_ref()
                .is_some_and(|event| event.id == "child-thread"
                    && event.kind == "reviewer"
                    && event.start)
        );
        assert!(
            said.is_none(),
            "helper output is not attributed to the parent conversation"
        );

        let stop = json!({"hook_event_name":"SubagentStop","session_id":"parent-thread","agent_id":"child-thread","agent_type":"reviewer"});
        assert_eq!(super::status_from_hook(&stop), Some(H::Same));
        let origin = super::HookOrigin {
            term: 4,
            agent: "codex".into(),
            pid: 12,
            token: "pane-token".into(),
        };
        let ClientMsg::Hook {
            session, subagent, ..
        } = super::hook_message(origin, &stop, H::Same)
        else {
            panic!("expected hook")
        };
        assert_eq!(session.as_deref(), Some("parent-thread"));
        assert!(
            subagent
                .as_ref()
                .is_some_and(|event| event.id == "child-thread"
                    && event.kind == "reviewer"
                    && !event.start)
        );
    }

    #[test]
    fn codex_session_start_records_thread_without_changing_agent_status() {
        use crate::protocol::HookStatus as H;
        let payload =
            json!({"hook_event_name":"SessionStart","session_id":"root-thread","cwd":"/project"});
        let origin = super::HookOrigin {
            term: 4,
            agent: "codex".into(),
            pid: 12,
            token: "pane-token".into(),
        };
        let ClientMsg::Hook {
            session,
            cwd,
            status,
            event,
            ..
        } = super::hook_message(origin, &payload, H::Same)
        else {
            panic!("expected hook")
        };
        assert_eq!(session.as_deref(), Some("root-thread"));
        assert_eq!(cwd.as_deref(), Some(std::path::Path::new("/project")));
        assert_eq!(
            status,
            H::Same,
            "capturing the root thread must not mark a running Codex turn idle"
        );
        assert_eq!(event, "SessionStart");
    }

    #[test]
    fn pi_native_events_map_to_status_with_evidence_and_no_conversation_payload() {
        use crate::protocol::HookStatus as H;
        for (event, expected) in [
            ("pi.session_start", H::Idle),
            ("pi.agent_start", H::Working),
            ("pi.ui_prompt_start", H::Blocked),
            ("pi.ui_prompt_end", H::Working),
            ("pi.agent_settled", H::Done),
            ("pi.session_shutdown", H::Gone),
        ] {
            let payload = json!({"hook_event_name":event,"cwd":"/project"});
            assert_eq!(super::status_from_hook(&payload), Some(expected));
            let origin = super::HookOrigin {
                term: 7,
                agent: "pi".into(),
                pid: 10,
                token: String::new(),
            };
            let ClientMsg::Hook {
                event: evidence,
                prompt,
                said,
                ..
            } = super::hook_message(origin, &payload, expected)
            else {
                panic!("expected hook")
            };
            assert_eq!(evidence, event);
            assert!(prompt.is_none() && said.is_none());
        }
        let payload = json!({"type":"question.asked"});
        let origin = super::HookOrigin {
            term: 7,
            agent: "opencode".into(),
            pid: 10,
            token: String::new(),
        };
        let ClientMsg::Hook { event, .. } = super::hook_message(origin, &payload, H::Blocked)
        else {
            panic!("expected hook")
        };
        assert_eq!(event, "question.asked");
    }

    /// The `call` a hook reports, for an agent and a payload.
    fn call_of(agent: &str, payload: serde_json::Value) -> Option<String> {
        let origin = super::HookOrigin {
            term: 7,
            agent: agent.into(),
            pid: 10,
            token: String::new(),
        };
        let ClientMsg::Hook { call, .. } = super::hook_message(origin, &payload, HookStatus::Working) else {
            panic!("expected hook")
        };
        call
    }

    fn pre_tool(tool: &str, input: serde_json::Value) -> serde_json::Value {
        json!({ "hook_event_name": "PreToolUse", "tool_name": tool, "tool_input": input })
    }

    #[test]
    fn a_tool_start_reports_a_fingerprint_of_the_call_and_never_the_call() {
        let input = json!({ "command": "echo SECRET-VALUE-123" });
        let call = call_of("claude", pre_tool("Bash", input)).expect("a fingerprint");

        assert_eq!(call.len(), 16);
        assert!(call.chars().all(|c| c.is_ascii_hexdigit()), "{call}");
        assert!(!call.contains("SECRET") && !call.contains("echo"));
    }

    #[test]
    fn the_same_call_has_the_same_fingerprint_and_another_call_has_another() {
        let ls = call_of("claude", pre_tool("Bash", json!({ "command": "ls" })));

        assert_eq!(ls, call_of("claude", pre_tool("Bash", json!({ "command": "ls" }))));
        assert_ne!(ls, call_of("claude", pre_tool("Bash", json!({ "command": "ls -l" }))));
        assert_ne!(ls, call_of("claude", pre_tool("Read", json!({ "command": "ls" }))));
        // Key order in the agent's JSON does not make a different call.
        assert_eq!(
            call_of("claude", pre_tool("Edit", json!({ "a": 1, "b": 2 }))),
            call_of("claude", pre_tool("Edit", json!({ "b": 2, "a": 1 })))
        );
    }

    #[test]
    fn only_a_sessions_own_tool_start_with_its_input_reports_a_call() {
        let input = json!({ "command": "ls" });
        let mut cases: Vec<(&str, serde_json::Value, bool, &str)> = Vec::new();
        for agent in ["claude", "qwen", "codex"] {
            cases.push((agent, pre_tool("Bash", input.clone()), true, "a tool start"));
        }
        cases.push((
            "gemini",
            json!({ "hook_event_name": "BeforeTool", "tool_name": "run_shell_command", "tool_input": input }),
            true,
            "gemini's tool start",
        ));
        for event in ["PostToolUse", "UserPromptSubmit", "Stop", "Notification", "AfterTool"] {
            cases.push((
                "claude",
                json!({ "hook_event_name": event, "tool_name": "Bash", "tool_input": input }),
                false,
                "not a tool start",
            ));
        }
        // Without the tool's input, two different calls would look the same, so there is no fingerprint.
        cases.push(("claude", json!({ "hook_event_name": "PreToolUse", "tool_name": "Bash" }), false, "no input"));
        cases.push(("claude", json!({ "hook_event_name": "PreToolUse", "tool_input": input }), false, "no tool"));
        // An agent that passes no payload, and one whose hooks are not tool hooks.
        cases.push(("kimi", json!({}), false, "no payload"));
        cases.push(("opencode", pre_tool("Bash", input.clone()), false, "not tool hooks"));
        // A call made inside a subagent is not the session's own.
        cases.push((
            "claude",
            json!({ "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": input, "agent_id": "agent-1" }),
            false,
            "inside a subagent",
        ));
        for (agent, payload, reports, why) in cases {
            let shown = payload.to_string();
            assert_eq!(call_of(agent, payload).is_some(), reports, "{agent} {shown}: {why}");
        }
    }

    #[test]
    fn a_permission_request_reports_the_tool_and_its_subject_but_never_what_it_would_write() {
        use crate::protocol::HookStatus as H;
        let report = |payload: serde_json::Value| {
            let origin = super::HookOrigin {
                term: 7,
                agent: "claude".into(),
                pid: 10,
                token: String::new(),
            };
            let ClientMsg::Hook { ask, .. } = super::hook_message(origin, &payload, H::Blocked)
            else {
                panic!("expected hook")
            };
            ask
        };
        let bash = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": {"command": "cargo   test\n  --all", "description": "run the tests"},
        }))
        .expect("a Bash request");
        assert_eq!((bash.tool.as_str(), bash.detail.as_str()), ("Bash", "cargo test --all"));
        assert!(!bash.answerable, "only the daemon says a prompt can be answered");

        // The payload Claude 2.1.319 sent for a Write: the content is not carried.
        let write = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "Write",
            "tool_input": {"file_path": "/work/x.txt", "content": "API_KEY=hunter2"},
            "permission_suggestions": [{"type": "setMode", "mode": "acceptEdits", "destination": "session"}],
        }))
        .expect("a Write request");
        assert_eq!((write.tool.as_str(), write.detail.as_str()), ("Write", "/work/x.txt"));
        assert!(!format!("{write:?}").contains("hunter2"));

        // A question Claude puts to the person shows its text and numbered choices.
        let question = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion",
            "tool_input": {"questions": [{"question": "Which database?", "header": "DB", "multiSelect": false,
                "options": [{"label": "SQLite", "description": "file"}, {"label": "Postgres", "description": "server"}]}]},
        }))
        .expect("a question");
        assert_eq!(question.detail, "Which database?");
        assert_eq!(question.choices, ["SQLite", "Postgres"]);
        // A question with several answers is carried as a form, still numbered in the line for a
        // peer that reads only that.
        let many = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion",
            "tool_input": {"questions": [
                {"question": "Which?", "multiSelect": true, "options": [{"label": "A"}, {"label": "B"}]},
            ]},
        }))
        .expect("a multi-select question");
        assert_eq!((many.detail.as_str(), many.choices.len()), ("Which? 1 A · 2 B", 0));
        assert!(many.questions.is_empty());
        assert_eq!(many.form.iter().map(|q| (q.question.as_str(), q.multi)).collect::<Vec<_>>(), [("Which?", true)]);
        // Several questions with one answer each are carried whole, in order, for the chat to answer.
        let several = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion",
            "tool_input": {"questions": [
                {"question": "Which database?", "header": "DB", "options": [{"label": "SQLite"}, {"label": "Postgres"}, {"label": "MySQL"}]},
                {"question": "Which language?", "header": "Lang", "options": [{"label": "Rust"}, {"label": "Go"}]},
            ]},
        }))
        .expect("two questions");
        assert!(several.choices.is_empty(), "no one key answers it");
        assert_eq!(
            several.questions.iter().map(|q| (q.question.as_str(), q.choices.len())).collect::<Vec<_>>(),
            [("Which database?", 3), ("Which language?", 2)]
        );
        // One of them takes several answers: the whole prompt is a form, and no peer from before
        // forms reads it as questions with one answer each.
        let mixed = report(json!({
            "hook_event_name": "PermissionRequest",
            "tool_name": "AskUserQuestion",
            "tool_input": {"questions": [
                {"question": "Which?", "options": [{"label": "A"}, {"label": "B"}]},
                {"question": "Which ones?", "multiSelect": true, "options": [{"label": "C"}, {"label": "D"}]},
            ]},
        }))
        .expect("a mixed prompt");
        assert!(mixed.questions.is_empty() && mixed.choices.is_empty());
        assert_eq!(
            mixed.form.iter().map(|q| (q.question.as_str(), q.choices.len(), q.multi)).collect::<Vec<_>>(),
            [("Which?", 2, false), ("Which ones?", 2, true)]
        );
        assert!(several.form.is_empty() && question.form.is_empty());

        // A tool with no subject field is still a question; one with no tool is not reported.
        let bare = report(json!({"hook_event_name": "PermissionRequest", "tool_name": "ExitPlanMode"}))
            .expect("a request with no input");
        assert_eq!(bare.detail, "");
        assert!(report(json!({"hook_event_name": "PermissionRequest"})).is_none());
        // Only a permission request carries one.
        assert!(report(json!({"hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "ls"}})).is_none());
    }

    #[test]
    fn codex_notify_is_set_and_others_kept() {
        let file = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-codex-{}.toml"),
            std::process::id()
        ));
        std::fs::write(&file, "model = \"gpt-5\"\n\n[tui]\nnotifications = true\n").unwrap();
        assert!(matches!(
            super::codex_notify(&file, concat!("/bin/", env!("APP_COMMAND")), false).unwrap(),
            super::CodexNotify::Set
        ));
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(
            text.contains(concat!(
                r#"notify = ["/bin/"#,
                env!("APP_COMMAND"),
                r#"", "hook", "codex"]"#
            )) && text.contains("[tui]")
                && text.contains("gpt-5"),
            "{text}"
        );
        assert!(
            text.find("notify") < text.find("[tui]"),
            "a top-level key, before the tables: {text}"
        );
        // Run again with the app elsewhere: replaced (it's ours).
        super::codex_notify(
            &file,
            concat!("/usr/local/bin/", env!("APP_COMMAND")),
            false,
        )
        .unwrap();
        assert!(
            std::fs::read_to_string(&file)
                .unwrap()
                .contains(concat!("/usr/local/bin/", env!("APP_COMMAND")))
        );
        // Someone else's notify stays.
        std::fs::write(&file, "notify = [\"my-notifier\"]\n").unwrap();
        assert!(matches!(
            super::codex_notify(&file, concat!("/bin/", env!("APP_COMMAND")), false).unwrap(),
            super::CodexNotify::Theirs(_)
        ));
        assert!(
            std::fs::read_to_string(&file)
                .unwrap()
                .contains("my-notifier")
        );
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_file(file.with_extension(concat!(
            "toml.",
            env!("APP_COMMAND"),
            "-bak"
        )));
    }

    #[test]
    fn qwen_home_is_the_qwen_config_folder_itself() {
        let home = std::path::Path::new("/home/me");
        assert_eq!(
            super::qwen_settings_in(Some("/opt/qwen-config".into()), home),
            std::path::Path::new("/opt/qwen-config/settings.json")
        );
        assert_eq!(
            super::qwen_settings_in(None, home),
            home.join(".qwen").join("settings.json")
        );
        assert_eq!(
            super::qwen_settings_in(Some("".into()), home),
            home.join(".qwen").join("settings.json"),
            "an empty QWEN_HOME is unset"
        );
        assert_eq!(
            super::qwen_settings_in(Some("~/qwen-config".into()), home),
            home.join("qwen-config").join("settings.json")
        );
        assert_eq!(
            super::qwen_settings_in(Some("~".into()), home),
            home.join("settings.json")
        );
        assert_eq!(
            super::qwen_settings_in(Some("/a/~b".into()), home),
            std::path::Path::new("/a/~b/settings.json"),
            "only a leading ~"
        );
    }

    #[test]
    fn settings_hooks_keep_comments_order_and_other_hooks_and_replace_only_ours() {
        let dir = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-jsonc-hooks-{}"),
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let original = "\u{feff}{\n  // pick a theme\n  \"theme\": \"dark\",\n  \"hooks\": {\n    \"AfterAgent\": [\n      { \"hooks\": [{ \"type\": \"command\", \"command\": \"my-hook\" }] } // mine\n    ]\n  },\n  \"auth\": { \"type\": \"oauth\" }\n}\n";
        std::fs::write(&path, original).unwrap();

        super::json_hooks(&path, "gemini", super::GEMINI_EVENTS, 5000, false).unwrap();
        let once = std::fs::read_to_string(&path).unwrap();
        super::json_hooks(&path, "gemini", super::GEMINI_EVENTS, 5000, false).unwrap();
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            once,
            "a re-run replaces only its own groups"
        );
        assert!(
            once.starts_with('\u{feff}')
                && once.contains("// pick a theme")
                && once.contains("// mine"),
            "{once}"
        );
        assert!(
            once.find("\"theme\"") < once.find("\"hooks\"")
                && once.find("\"hooks\"") < once.find("\"auth\""),
            "key order kept: {once}"
        );
        let root = super::jsonc::parse_value(&once).unwrap();
        let after_agent = root["hooks"]["AfterAgent"].as_array().unwrap();
        assert_eq!(after_agent.len(), 2);
        assert_eq!(after_agent[0]["hooks"][0]["command"], "my-hook");
        assert!(super::is_ours(&after_agent[1]));
        assert_eq!(
            root["hooks"].as_object().unwrap().len(),
            super::GEMINI_EVENTS.len()
        );

        super::json_hooks(&path, "gemini", super::GEMINI_EVENTS, 5000, true).unwrap();
        let removed = std::fs::read_to_string(&path).unwrap();
        let root = super::jsonc::parse_value(&removed).unwrap();
        assert_eq!(
            root["hooks"].as_object().unwrap().len(),
            1,
            "only the user's event is left: {removed}"
        );
        assert_eq!(root["hooks"]["AfterAgent"].as_array().unwrap().len(), 1);
        assert!(removed.contains("// pick a theme") && removed.contains("\"auth\""));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_mcp_server_left_under_an_old_name_is_found() {
        let root = serde_json::json!({ "mcpServers": {
            "hydra": { "command": "C:/Programs/hydra/hydra.exe", "args": ["mcp"] },
            env!("APP_COMMAND"): { "command": concat!("C:/Programs/", env!("APP_COMMAND"), "/", env!("APP_COMMAND"), ".exe"), "args": ["mcp"] },
            "plane": { "command": "npx", "args": ["plane-mcp"] },
        }});
        assert_eq!(
            super::old_mcp_names(&root),
            vec!["hydra".to_string()],
            "only the old install's"
        );
        assert!(
            super::old_mcp_names(&serde_json::json!({})).is_empty(),
            "no servers at all"
        );
    }

    #[test]
    fn hooks_from_another_hydra_are_found() {
        let want = concat!(
            "\"/home/me/.local/bin/",
            env!("APP_COMMAND"),
            "\" hook claude"
        );
        let settings = |cmd: &str| {
            serde_json::json!({ "hooks": {
                "Stop": [
                    { "_hydra": true, "hooks": [{ "type": "command", "command": cmd }] },
                    { "hooks": [{ "type": "command", "command": "someone-elses-hook" }] },
                ],
            }})
        };
        assert!(
            super::stale_in(&settings(want), want).is_empty(),
            concat!(
                "this ",
                env!("APP_COMMAND"),
                "'s hooks are fine; others' aren't ours to judge"
            )
        );
        let old = concat!(
            "\"/home/me/.cargo/bin/",
            env!("APP_COMMAND"),
            "\" hook claude"
        );
        assert_eq!(super::stale_in(&settings(old), want), vec![old.to_string()]);
        // An old install's hook without the tag is still ours (so it gets repointed).
        let untagged = serde_json::json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "/home/me/.local/bin/hydra hook claude" }] }] } });
        assert_eq!(
            super::stale_in(&untagged, want),
            vec!["/home/me/.local/bin/hydra hook claude".to_string()]
        );
        assert!(
            !super::runs_our_hook("hydra-lint check"),
            "only the app's own hook"
        );
    }

    #[test]
    fn another_claude_config_folder_with_an_old_hook_is_found() {
        let home = std::env::temp_dir().join(format!("{}-siblings-{}", env!("APP_COMMAND"), std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let want = concat!("\"/home/me/.local/bin/", env!("APP_COMMAND"), "\" hook claude");
        let old = "\"/home/me/.cargo/bin/".to_string() + env!("APP_COMMAND") + "\" hook claude";
        let write = |dir: &str, cmd: &str| {
            let folder = home.join(dir);
            std::fs::create_dir_all(&folder).unwrap();
            let json = serde_json::json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": cmd }] }] } });
            std::fs::write(folder.join("settings.json"), json.to_string()).unwrap();
        };
        write(".claude", &old);
        write(".claude-personal", &old);
        write(".claude-work", want);
        write(".other", &old);
        let own = home.join(".claude").join("settings.json");
        let found = super::stale_claude_settings_in(&home, &own, want);
        let _ = std::fs::remove_dir_all(&home);
        assert_eq!(found, vec![home.join(".claude-personal").join("settings.json")]);
    }

    #[test]
    fn a_hook_still_running_the_old_maitty_program_is_a_problem() {
        let want = concat!("\"/home/me/.local/bin/", env!("APP_COMMAND"), "\" hook claude");
        let old = concat!("\"/home/me/.local/share/maitty/", env!("APP_DAEMON"), "\" hook claude");
        let settings = |cmd: &str| serde_json::json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": cmd }] }] } });
        let text = settings(old).to_string();
        let why = super::claude_hook_problem_in(&text, &settings(old), want).expect("the old program is stale");
        assert!(why.contains(concat!("maitty/", env!("APP_DAEMON"))), "{why}");
        let right = settings(want);
        assert_eq!(super::claude_hook_problem_in(&right.to_string(), &right, want), None);
        let none = serde_json::json!({});
        assert!(super::claude_hook_problem_in("{}", &none, want).is_some_and(|why| why.contains("no Maiker hooks")));
    }

    #[test]
    fn a_source_build_never_rewrites_a_config_folders_hooks_to_itself() {
        // The test binary runs from target/debug, as a dev daemon does.
        assert!(!super::hooks_belong_to_this_build());
        let folder = std::env::temp_dir().join(format!("{}-guard-{}", env!("APP_COMMAND"), std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let written = concat!("{\"hooks\":{\"Stop\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"/home/me/.local/bin/", env!("APP_COMMAND"), " hook claude\"}]}]}}");
        std::fs::write(folder.join("settings.json"), written).unwrap();
        let problem = super::claude_hook_problem(&folder);
        let repaired = super::repair_claude_hooks_in(&folder);
        let after = std::fs::read_to_string(folder.join("settings.json")).unwrap();
        let _ = std::fs::remove_dir_all(&folder);
        assert_eq!(problem, Ok(None));
        assert_eq!(repaired, Ok(()));
        assert_eq!(after, written);
    }

    #[test]
    fn a_config_folder_outside_dot_claude_is_repaired_by_its_own_path() {
        let folder = std::env::temp_dir().join(format!("{}-custom-{}", env!("APP_COMMAND"), std::process::id())).join("agent-home");
        std::fs::create_dir_all(&folder).unwrap();
        let old = concat!("\"/home/me/.local/share/maitty/", env!("APP_DAEMON"), "\" hook claude");
        let before = serde_json::json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": old }] }] } });
        std::fs::write(folder.join("settings.json"), before.to_string()).unwrap();
        let result = super::write_claude_hooks_in(&folder);
        let after = std::fs::read_to_string(folder.join("settings.json")).unwrap();
        let _ = std::fs::remove_dir_all(folder.parent().unwrap());
        result.expect("repairs the folder it is given");
        assert!(!after.contains(concat!("maitty/", env!("APP_DAEMON"))), "the old program is gone: {after}");
        assert!(after.contains("hook claude"), "this build's hook is there: {after}");
    }

    #[test]
    fn stale_hooks_are_found_in_a_commented_settings_file() {
        let want = concat!(
            "\"/home/me/.local/bin/",
            env!("APP_COMMAND"),
            "\" hook claude"
        );
        let old = concat!(
            "\"/home/me/.cargo/bin/",
            env!("APP_COMMAND"),
            "\" hook claude"
        );
        let text = format!(
            "{{\n  // my settings\n  \"hooks\": {{ \"Stop\": [ {{ \"_{app}\": true, \"hooks\": [{{ \"type\": \"command\", \"command\": {cmd} }}] }} ] }}\n}}\n",
            app = env!("APP_COMMAND"),
            cmd = serde_json::to_string(old).unwrap()
        );
        let root = super::jsonc::parse_value(&text).expect("a commented settings file still reads");
        assert_eq!(
            super::stale_in(&root, want),
            vec![old.to_string()],
            "a moved install is found despite the comment"
        );
    }

    #[test]
    fn hooks_whose_program_is_gone_are_found() {
        let root = serde_json::json!({ "hooks": {
            "Stop": [{ "hooks": [
                { "type": "command", "command": "\"/home/me/.local/bin/hydra\" hook claude" },
                { "type": "command", "command": "/usr/bin/notify-send done" },
                { "type": "command", "command": "hydra hook claude" },
                { "type": "command", "command": "npx something" },
                { "type": "command", "command": "$HOME/bin/x" },
            ] }],
        }});
        let exists = |p: &std::path::Path| p == std::path::Path::new("/usr/bin/notify-send");
        let broken = super::broken_hooks_in(&root, exists, |_| false);
        assert_eq!(
            broken,
            vec![
                "\"/home/me/.local/bin/hydra\" hook claude".to_string(),
                "hydra hook claude".to_string()
            ]
        );
    }

    #[test]
    fn model_and_name_from_a_transcript() {
        assert_eq!(super::short_model("claude-opus-4-5-20251101"), "opus 4.5");
        assert_eq!(super::short_model("claude-fable-5-1"), "fable 5.1");
        assert_eq!(super::short_model("gpt-5.5"), "gpt-5.5");
        let t = [
            r#"{"type":"assistant","message":{"model":"claude-sonnet-5-5","content":[]}}"#,
            r#"{"type":"ai-title","aiTitle":"Fix the login flow","sessionId":"s"}"#,
            r#"{"type":"user","message":{"content":"say \"model\" and \"customTitle\""}}"#,
        ]
        .join("\n");
        assert_eq!(
            super::transcript_facts_in(&t),
            (Some("sonnet 5.5".into()), Some("Fix the login flow".into()))
        );
        let t = format!(
            "{t}\n{}",
            r#"{"type":"custom-title","customTitle":"auth rewrite","sessionId":"s"}"#
        );
        assert_eq!(
            super::transcript_facts_in(&t).1.as_deref(),
            Some("auth rewrite"),
            "your /rename wins"
        );
    }

    use super::*;
}
