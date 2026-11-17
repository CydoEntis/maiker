//! A machine's details (`i` on a machine in Machines, or Details… on its sidebar heading): what
//! runs there, who is signed in to GitHub (`Query::GitHubAccounts`), which commit identity git
//! uses and the folders where a rule gives another (`Query::GitIdentities`), with the way to
//! sign in (GitHub's own `gh auth login` in a new session there) and to add or remove a folder's
//! rule (`Query::GitIdentityRule`: previewed, then written only on Enter). For this computer it
//! also names the service's socket and log.
//!
//! Nothing here holds a credential: the daemon reports logins, names and emails only, and the
//! sign-in runs in a session of its own, where its prompts are the person's to answer.

use super::machines::MachineNotice;
use super::*;
use crate::hidden::sanitize;
use crate::protocol::{
    ClientMsg, GITHUB_SIGN_IN_COMMAND, GitConfigWrite, GitHubReport, GitIdentity,
    GitIdentityReport, GitRuleChange, Query, Reply,
};
use std::sync::atomic::{AtomicU64, Ordering};

const WIDTH: u16 = 96;
const HEIGHT: u16 = 28;
/// The name a sign-in session gets in the sidebar.
const SIGN_IN_SESSION: &str = "GitHub sign-in";

/// Tags for this view's questions, unique for the run, so an answer to a view since closed is
/// never taken for the open one's.
static NEXT_TAG: AtomicU64 = AtomicU64::new(1);

fn next_tag() -> u64 {
    NEXT_TAG.fetch_add(1, Ordering::Relaxed)
}

/// One question's answer as the view holds it.
#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) enum Answer<T> {
    Waiting(u64),
    Got(T),
    /// Not asked: the reason in its place.
    NotAsked(String),
}

/// A folder's rule being typed: the folder, who commits there and the GitHub account it signs in as.
#[derive(Debug, Clone, PartialEq, Default)]
pub(in crate::client) struct RuleForm {
    pub(in crate::client) folder: String,
    pub(in crate::client) name: String,
    pub(in crate::client) email: String,
    /// Which signed-in account, by its place in the report.
    pub(in crate::client) login: usize,
    /// The field with the keys: folder, name, email, account.
    pub(in crate::client) field: usize,
    pub(in crate::client) error: Option<String>,
}

const FORM_FIELDS: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) enum InfoStep {
    List,
    Form(RuleForm),
    /// The lines the rule would write, asked of the daemon (`tag`), and the answer once in.
    Preview {
        form: RuleForm,
        tag: u64,
        lines: Option<Result<Vec<GitConfigWrite>, String>>,
    },
    /// Enter on the preview: being written.
    Applying {
        form: RuleForm,
        tag: u64,
    },
    /// Asking before a rule is taken away.
    Remove {
        folder: String,
    },
    Removing {
        folder: String,
        tag: u64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct MachineInfoView {
    pub(in crate::client) machine: MachineId,
    pub(in crate::client) github: Answer<GitHubReport>,
    pub(in crate::client) git: Answer<GitIdentityReport>,
    /// The chosen folder rule.
    pub(in crate::client) sel: usize,
    pub(in crate::client) step: InfoStep,
    pub(in crate::client) notice: Option<MachineNotice>,
}

impl MachineInfoView {
    fn accounts(&self) -> Vec<String> {
        match &self.github {
            Answer::Got(r) => r.accounts.iter().map(|a| a.login.clone()).collect(),
            _ => Vec::new(),
        }
    }

    fn rules(&self) -> &[crate::protocol::GitIdentityRule] {
        match &self.git {
            Answer::Got(r) => &r.rules,
            _ => &[],
        }
    }
}

fn say(text: impl Into<String>, error: bool) -> MachineNotice {
    MachineNotice {
        text: text.into(),
        error,
    }
}

impl App {
    /// The machine's name as people read it here.
    fn info_name(&self, machine: MachineId) -> String {
        if machine == MachineId::LOCAL {
            "this computer".to_string()
        } else {
            sanitize(self.machine_name(machine), false)
        }
    }

    /// Open a machine's details and ask its daemon who is signed in and which identity git uses.
    pub(in crate::client) fn open_machine_info(&mut self, machine: MachineId) {
        let mut v = MachineInfoView {
            machine,
            github: Answer::NotAsked(String::new()),
            git: Answer::NotAsked(String::new()),
            sel: 0,
            step: InfoStep::List,
            notice: None,
        };
        self.ask_github(&mut v);
        self.ask_identities(&mut v);
        self.mode = Mode::MachineInfo(Box::new(v));
    }

    /// Send `ask` to the view's machine, unless this computer's daemon is known to be too old for
    /// it (another machine's version is not known here: it simply does not answer).
    fn info_ask(&self, machine: MachineId, ask: ClientMsg) -> Result<(), String> {
        if machine == MachineId::LOCAL && ask.introduced_in() > self.local_protocol {
            return Err("Restart the service to see this.".to_string());
        }
        if self.machine_down(machine) {
            return Err(format!("{} is not connected.", self.info_name(machine)));
        }
        self.send(machine, ask);
        Ok(())
    }

    fn ask_github(&mut self, v: &mut MachineInfoView) {
        let tag = next_tag();
        v.github = match self.info_ask(v.machine, ClientMsg::Query(Query::GitHubAccounts { tag })) {
            Ok(()) => Answer::Waiting(tag),
            Err(why) => Answer::NotAsked(why),
        };
    }

    fn ask_identities(&mut self, v: &mut MachineInfoView) {
        let tag = next_tag();
        v.git = match self.info_ask(v.machine, ClientMsg::Query(Query::GitIdentities { tag })) {
            Ok(()) => Answer::Waiting(tag),
            Err(why) => Answer::NotAsked(why),
        };
    }

    /// The settings views' answers from any machine: usage and approvals are this computer's,
    /// the rest belong to the machine whose details are open.
    pub(in crate::client) fn machine_info_reply(&mut self, machine: MachineId, reply: Reply) {
        let Mode::MachineInfo(v) = &mut self.mode else {
            return;
        };
        if v.machine != machine {
            return;
        }
        match reply {
            Reply::GitHubAccounts { tag, report } if v.github == Answer::Waiting(tag) => {
                v.github = Answer::Got(report)
            }
            Reply::GitIdentities { tag, report } if v.git == Answer::Waiting(tag) => {
                v.sel = v.sel.min(report.rules.len().saturating_sub(1));
                v.git = Answer::Got(report);
            }
            Reply::GitIdentityRuleDone { tag, outcome } => {
                let mut v = (**v).clone();
                self.rule_done(&mut v, tag, outcome);
                self.mode = Mode::MachineInfo(Box::new(v));
            }
            _ => return,
        }
        self.dirty = true;
    }

    fn rule_done(&mut self, v: &mut MachineInfoView, tag: u64, outcome: Result<Vec<GitConfigWrite>, String>) {
        match v.step.clone() {
            InfoStep::Preview { form, tag: asked, .. } if asked == tag => {
                v.step = InfoStep::Preview { form, tag, lines: Some(outcome) };
            }
            InfoStep::Applying { form, tag: asked } if asked == tag => match outcome {
                Ok(_) => {
                    v.notice = Some(say(format!("Rule written: {} commits as {}.", form.folder, form.email), false));
                    v.step = InfoStep::List;
                    self.ask_identities(v);
                }
                Err(why) => v.step = InfoStep::Preview { form, tag, lines: Some(Err(why)) },
            },
            InfoStep::Removing { folder, tag: asked } if asked == tag => {
                v.step = InfoStep::List;
                v.notice = Some(match outcome {
                    Ok(_) => say(format!("Rule for {} removed.", sanitize(&folder, false)), false),
                    Err(why) => say(format!("Not removed: {}", sanitize(&why, false)), true),
                });
                self.ask_identities(v);
            }
            _ => {}
        }
    }

    pub(in crate::client) fn on_machine_info_key(&mut self, mut v: MachineInfoView, k: &KeyEvent) {
        match v.step.clone() {
            InfoStep::List => {
                if !self.info_list_key(&mut v, k) {
                    return;
                }
            }
            InfoStep::Form(form) => self.info_form_key(&mut v, form, k),
            InfoStep::Preview { form, lines, .. } => match k.code {
                KeyCode::Esc => v.step = InfoStep::Form(form),
                // Only a preview that came back clean can be written, and only with Enter.
                KeyCode::Enter if matches!(lines, Some(Ok(_))) => self.apply_rule(&mut v, form),
                _ => {}
            },
            InfoStep::Applying { .. } | InfoStep::Removing { .. } => {}
            InfoStep::Remove { folder } => {
                v.step = InfoStep::List;
                if k.code == KeyCode::Enter {
                    let tag = next_tag();
                    let ask = ClientMsg::Query(Query::GitIdentityRule {
                        change: GitRuleChange::Remove { folder: folder.clone() },
                        tag,
                    });
                    match self.info_ask(v.machine, ask) {
                        Ok(()) => v.step = InfoStep::Removing { folder, tag },
                        Err(why) => v.notice = Some(say(why, true)),
                    }
                }
            }
        }
        if matches!(self.mode, Mode::MachineInfo(_)) {
            self.mode = Mode::MachineInfo(Box::new(v));
        }
    }

    /// The keys on the details themselves. False when the view closed.
    fn info_list_key(&mut self, v: &mut MachineInfoView, k: &KeyEvent) -> bool {
        let rules = v.rules().len();
        match k.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.mode = Mode::Normal;
                return false;
            }
            KeyCode::Char('r') => {
                v.notice = None;
                self.ask_github(v);
                self.ask_identities(v);
            }
            KeyCode::Char('g') => return self.github_sign_in(v),
            KeyCode::Char('a') => self.start_rule(v),
            KeyCode::Char('x') | KeyCode::Delete => {
                match v.rules().get(v.sel).cloned() {
                    Some(rule) if rule.identity.is_some() => {
                        v.notice = None;
                        v.step = InfoStep::Remove { folder: rule.folder };
                    }
                    Some(_) => {
                        v.notice = Some(say(concat!("That rule was set outside ", env!("APP_NAME"), ": change it in your git config."), true))
                    }
                    None => {}
                }
            }
            KeyCode::Char('o') if v.machine == MachineId::LOCAL => {
                let log = service_log();
                self.open_outside(log, "the service log".to_string());
            }
            KeyCode::Char('y') if v.machine == MachineId::LOCAL => {
                let log = service_log().display().to_string();
                crate::client::copy::to_clipboard(&log);
                v.notice = Some(say(format!("Copied {log}"), false));
            }
            _ => {
                Self::list_move(&mut v.sel, rules, k);
            }
        }
        true
    }

    /// GitHub's own sign-in in a new session on the machine. False: the view closed for it.
    fn github_sign_in(&mut self, v: &mut MachineInfoView) -> bool {
        let name = self.info_name(v.machine);
        if let Answer::Got(r) = &v.github
            && !r.installed
        {
            v.notice = Some(say(format!("GitHub's command line (gh) is not installed on {name}."), true));
            return true;
        }
        if self.machine_down(v.machine) {
            v.notice = Some(say(format!("{name} is not connected."), true));
            return true;
        }
        self.leave_shortcut_mode();
        self.cmd_on(
            v.machine,
            Command::NewWorkspace {
                cwd: None,
                name: Some(SIGN_IN_SESSION.into()),
                cmd: Some(GITHUB_SIGN_IN_COMMAND.into()),
            },
        );
        self.mode = Mode::Normal;
        self.notify(
            format!("GitHub sign-in started in a new session on {name}: finish it there"),
            false,
        );
        false
    }

    /// `a`: a rule's form, with who commits now filled in.
    fn start_rule(&mut self, v: &mut MachineInfoView) {
        let accounts = v.accounts();
        if accounts.is_empty() {
            let name = self.info_name(v.machine);
            v.notice = Some(say(format!("A rule signs in as a GitHub account: sign in on {name} first (g)."), true));
            return;
        }
        let (name, email) = match &v.git {
            Answer::Got(r) => (r.name.clone().unwrap_or_default(), r.email.clone().unwrap_or_default()),
            _ => Default::default(),
        };
        v.notice = None;
        v.step = InfoStep::Form(RuleForm { name, email, ..RuleForm::default() });
    }

    fn info_form_key(&mut self, v: &mut MachineInfoView, mut form: RuleForm, k: &KeyEvent) {
        let accounts = v.accounts().len().max(1);
        form.error = None;
        match k.code {
            KeyCode::Esc => return v.step = InfoStep::List,
            KeyCode::Tab | KeyCode::Down => form.field = (form.field + 1) % FORM_FIELDS,
            KeyCode::BackTab | KeyCode::Up => form.field = (form.field + FORM_FIELDS - 1) % FORM_FIELDS,
            KeyCode::Left | KeyCode::Right if form.field == 3 => {
                let step = if k.code == KeyCode::Right { 1 } else { accounts - 1 };
                form.login = (form.login + step) % accounts;
            }
            KeyCode::Enter => return self.preview_rule(v, form),
            KeyCode::Backspace => {
                if let Some(text) = form_text(&mut form) {
                    text.pop();
                }
            }
            KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                if let Some(text) = form_text(&mut form) {
                    text.push(c);
                }
            }
            _ => {}
        }
        v.step = InfoStep::Form(form);
    }

    fn rule_identity(v: &MachineInfoView, form: &RuleForm) -> Option<GitIdentity> {
        let login = v.accounts().get(form.login)?.clone();
        Some(GitIdentity {
            name: form.name.trim().to_string(),
            email: form.email.trim().to_string(),
            login,
        })
    }

    /// Enter on the form: ask what the rule would write; nothing is written yet.
    fn preview_rule(&mut self, v: &mut MachineInfoView, mut form: RuleForm) {
        let identity = Self::rule_identity(v, &form);
        let missing = if form.folder.trim().is_empty() {
            Some("Type the folder the rule is for.")
        } else if identity.as_ref().is_none_or(|i| i.name.is_empty() || i.email.is_empty()) {
            Some("Type the name and email commits there carry.")
        } else {
            None
        };
        if let (None, Some(identity)) = (missing, identity) {
            let tag = next_tag();
            let folder = form.folder.trim().to_string();
            let ask = ClientMsg::Query(Query::GitIdentityRule {
                change: GitRuleChange::Preview { folder, identity },
                tag,
            });
            match self.info_ask(v.machine, ask) {
                Ok(()) => return v.step = InfoStep::Preview { form, tag, lines: None },
                Err(why) => form.error = Some(why),
            }
        } else {
            form.error = missing.map(str::to_string);
        }
        v.step = InfoStep::Form(form);
    }

    fn apply_rule(&mut self, v: &mut MachineInfoView, form: RuleForm) {
        let Some(identity) = Self::rule_identity(v, &form) else {
            return v.step = InfoStep::Form(form);
        };
        let tag = next_tag();
        let folder = form.folder.trim().to_string();
        let ask = ClientMsg::Query(Query::GitIdentityRule {
            change: GitRuleChange::Apply { folder, identity },
            tag,
        });
        v.step = match self.info_ask(v.machine, ask) {
            Ok(()) => InfoStep::Applying { form, tag },
            Err(why) => InfoStep::Preview { form, tag, lines: Some(Err(why)) },
        };
    }
}

/// The text field the keys are in; None on the account chooser.
fn form_text(form: &mut RuleForm) -> Option<&mut String> {
    match form.field {
        0 => Some(&mut form.folder),
        1 => Some(&mut form.name),
        2 => Some(&mut form.email),
        _ => None,
    }
}

/// This computer's service log, beside its other files.
fn service_log() -> PathBuf {
    crate::config::data_dir().join("daemon.log")
}

/// The socket this window and its service share: `MAIKER_SOCKET`, else the default one.
fn socket_label() -> String {
    std::env::var(concat!(env!("APP_ENV"), "_SOCKET")).unwrap_or_else(|_| "default".into())
}

pub(in crate::client) fn machine_info_keys(v: &MachineInfoView) -> Vec<(&'static str, &'static str)> {
    match &v.step {
        InfoStep::List => {
            let mut keys = vec![("g", "sign in to GitHub"), ("a", "add rule")];
            if !v.rules().is_empty() {
                keys.extend([("x", "remove rule"), ("↑↓", "move")]);
            }
            if v.machine == MachineId::LOCAL {
                keys.extend([("o", "open log"), ("y", "copy log path")]);
            }
            keys.extend([("r", "refresh"), ("Esc", "close")]);
            keys
        }
        InfoStep::Form(_) => vec![("Tab", "next"), ("←→", "account"), ("Enter", "preview"), ("Esc", "back")],
        InfoStep::Preview { lines: Some(Ok(_)), .. } => vec![("Enter", "write it"), ("Esc", "back")],
        InfoStep::Preview { .. } => vec![("Esc", "back")],
        InfoStep::Applying { .. } | InfoStep::Removing { .. } => vec![("", "working…")],
        InfoStep::Remove { .. } => vec![("Enter", "remove"), ("Esc", "keep it")],
    }
}

/// A line of the view: text in a style, `indent` cells in.
type Line = (u16, Vec<Seg>);

pub(in crate::client) fn draw_machine_info(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, v: &MachineInfoView) {
    let name = app.info_name(v.machine);
    let lines = match &v.step {
        InfoStep::List => list_lines(app, v, t),
        InfoStep::Form(form) => form_lines(v, form, t),
        InfoStep::Preview { form, lines, .. } => preview_lines(&name, form, lines.as_ref(), t),
        InfoStep::Applying { form, .. } => vec![(0, vec![seg(format!("Writing the rule for {}…", sanitize(&form.folder, false)), Style::default().fg(t.muted))])],
        InfoStep::Remove { folder } => remove_lines(folder, t),
        InfoStep::Removing { folder, .. } => vec![(0, vec![seg(format!("Removing the rule for {}…", sanitize(folder, false)), Style::default().fg(t.muted))])],
    };
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let title = if v.machine == MachineId::LOCAL { "this computer".to_string() } else { format!("machine · {name}") };
    let r = panel(app, buf, area, WIDTH, HEIGHT, &title, &[], t);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    // A line of one piece of text wraps; a row of parts (a rule, a field) is cut at the edge.
    let lines: Vec<Line> = lines
        .into_iter()
        .flat_map(|(indent, segs)| match segs.as_slice() {
            [(text, style)] if text.width() > usize::from(end.saturating_sub(x + indent)) => {
                popover::wrap(text, usize::from(end.saturating_sub(x + indent)))
                    .into_iter()
                    .map(|line| (indent, vec![seg(line, *style)]))
                    .collect::<Vec<_>>()
            }
            _ => vec![(indent, segs)],
        })
        .collect();
    let bar_y = r.bottom().saturating_sub(2);
    let notice_y = bar_y.saturating_sub(1);
    let room = usize::from(notice_y.saturating_sub(r.y + 2));
    // The details follow the chosen rule past the rows they have room for.
    let chosen = lines.iter().position(|(_, segs)| segs.first().is_some_and(|(s, _)| s == "▎"));
    let skip = chosen.map_or(0, |at| (at + 2).saturating_sub(room));
    let ground = t.card;
    for (i, (indent, segs)) in lines.into_iter().skip(skip).take(room).enumerate() {
        let y = r.y + 2 + i as u16;
        let segs: Vec<Seg> = segs.into_iter().map(|(s, st)| (s, st.bg(st.bg.unwrap_or(ground)))).collect();
        if segs.first().is_some_and(|(s, _)| s == "▎") {
            fill(buf, Rect { x: x - 1, y, width: end - x + 2, height: 1 }, t.hov);
            put(buf, x - 1, y, &segs, end);
        } else {
            put(buf, x + indent, y, &segs, end);
        }
    }
    if let Some(n) = &v.notice {
        let color = if n.error { t.err } else { t.done };
        put(buf, x, notice_y, &[seg(sanitize(&n.text, false), Style::default().bg(ground).fg(color))], end);
    }
    panel_bar(buf, r, t, &machine_info_keys(v));
}

fn heading(text: &str, t: &Theme) -> Line {
    (0, vec![seg(text.to_string(), Style::default().fg(t.accent).add_modifier(Modifier::BOLD))])
}

fn muted(text: impl Into<String>, t: &Theme) -> Line {
    (2, vec![seg(text.into(), Style::default().fg(t.muted))])
}

fn list_lines(app: &App, v: &MachineInfoView, t: &Theme) -> Vec<Line> {
    let name = app.info_name(v.machine);
    let text = Style::default().fg(t.text);
    let strong = Style::default().fg(t.strong).add_modifier(Modifier::BOLD);
    let mut out = vec![heading(env!("APP_ENV"), t)];
    let sessions = app.all_terms().into_iter().filter(|(term, _)| term.machine == v.machine).count();
    let plural = if sessions == 1 { "" } else { "s" };
    match app.snap_of(v.machine) {
        Some(snap) if v.machine == MachineId::LOCAL => {
            let version = if snap.daemon_version.is_empty() { "unknown".to_string() } else { sanitize(&snap.daemon_version, false) };
            out.push((2, vec![seg(format!("service {version} · {sessions} session{plural} · socket {}", sanitize(&socket_label(), false)), text)]));
            out.push((2, vec![seg("service log  ", Style::default().fg(t.muted)), seg(crate::client::design::tilde(&service_log()), text)]));
        }
        snap => {
            let target = app.cfg.machines.iter().find(|m| m.name.eq_ignore_ascii_case(app.machine_name(v.machine))).map(|m| sanitize(&m.target, false)).unwrap_or_default();
            let version = snap.map(|s| s.daemon_version.as_str()).filter(|s| !s.is_empty()).map_or_else(|| "version unknown".to_string(), |s| format!("version {}", sanitize(s, false)));
            let state = if app.machine_down(v.machine) { "not connected" } else { "connected" };
            out.push((2, vec![seg(format!("{target} · {version} · {sessions} session{plural} · {state}"), text)]));
        }
    }
    out.push((0, Vec::new()));
    out.push(heading("GITHUB", t));
    match &v.github {
        Answer::Waiting(_) => out.push(muted(format!("asking {name}…"), t)),
        Answer::NotAsked(why) => out.push(muted(why.clone(), t)),
        Answer::Got(r) if !r.installed => out.push(muted(format!("GitHub's command line (gh) is not installed on {name}."), t)),
        Answer::Got(r) => {
            if let Some(problem) = &r.problem {
                out.push((2, vec![seg(sanitize(problem, false), Style::default().fg(t.err))]));
            }
            if r.accounts.is_empty() && r.problem.is_none() {
                out.push(muted(format!("Nobody is signed in on {name}. g signs in with gh, in a new session there."), t));
            }
            for a in &r.accounts {
                let mut segs = vec![seg("● ", Style::default().fg(t.done)), seg(sanitize(&a.login, false), strong)];
                if a.active {
                    segs.push(seg("  active", Style::default().fg(t.muted)));
                }
                out.push((2, segs));
            }
        }
    }
    out.push((0, Vec::new()));
    out.push(heading("GIT IDENTITY", t));
    match &v.git {
        Answer::Waiting(_) => out.push(muted(format!("asking {name}…"), t)),
        Answer::NotAsked(why) => out.push(muted(why.clone(), t)),
        Answer::Got(r) if !r.installed => out.push(muted(format!("git is not installed on {name}."), t)),
        Answer::Got(r) => {
            if let Some(problem) = &r.problem {
                out.push((2, vec![seg(sanitize(problem, false), Style::default().fg(t.err))]));
            }
            let who = match (&r.name, &r.email) {
                (None, None) => "no name or email set".to_string(),
                (n, e) => format!("{} <{}>", n.as_deref().unwrap_or("no name"), e.as_deref().unwrap_or("no email")),
            };
            out.push((2, vec![seg("commits as  ", Style::default().fg(t.muted)), seg(sanitize(&who, false), text)]));
            out.push((0, Vec::new()));
            out.push(muted("FOLDERS THAT COMMIT AS SOMEONE ELSE", t));
            if r.rules.is_empty() {
                out.push(muted("None. a adds one.", t));
            }
            let folder_w = r.rules.iter().map(|x| x.folder.width()).max().unwrap_or(0).clamp(8, 36);
            for (i, rule) in r.rules.iter().enumerate() {
                let says = match &rule.identity {
                    Some(id) => format!("{} <{}> · GitHub {}", id.name, id.email, id.login),
                    None => concat!("set outside ", env!("APP_NAME")).to_string(),
                };
                let folder = format!("{:<folder_w$}", truncate(&sanitize(&rule.folder, false), folder_w));
                let on = i == v.sel;
                let ground = if on { Style::default().bg(t.hov) } else { Style::default() };
                let mut segs = Vec::new();
                if on {
                    segs.push(seg("▎", ground.fg(t.accent)));
                    segs.push(seg("    ", ground));
                }
                segs.push(seg(folder, ground.fg(t.strong)));
                segs.push(seg(format!("  {}", sanitize(&says, false)), ground.fg(if rule.identity.is_some() { t.text } else { t.muted })));
                out.push((4, segs));
            }
        }
    }
    out
}

fn form_lines(v: &MachineInfoView, form: &RuleForm, t: &Theme) -> Vec<Line> {
    let mut out = vec![
        heading("NEW RULE", t),
        muted("Commits in this folder, and every checkout under it, carry this name and email and sign in to GitHub as this account.", t),
        (0, Vec::new()),
    ];
    let accounts = v.accounts();
    let account = accounts.get(form.login).cloned().unwrap_or_default();
    let fields = [("Folder", form.folder.as_str(), "~/work"), ("Name", form.name.as_str(), ""), ("Email", form.email.as_str(), "")];
    for (i, (label, value, hint)) in fields.into_iter().enumerate() {
        let on = form.field == i;
        let field = Style::default().bg(t.card2);
        let mut segs = vec![
            seg(format!("{label:<8}"), Style::default().fg(if on { t.strong } else { t.muted })),
            seg(" › ", field.fg(t.accent)),
            seg(sanitize(value, false), field.fg(t.strong)),
        ];
        if on {
            segs.push(seg("█", field.fg(t.accent)));
        }
        if value.is_empty() && !hint.is_empty() {
            segs.push(seg(hint, field.fg(t.muted)));
        }
        out.push((2, segs));
    }
    let on = form.field == 3;
    let mut segs = vec![seg(format!("{:<8}", "GitHub"), Style::default().fg(if on { t.strong } else { t.muted }))];
    segs.push(seg(" ‹ ", Style::default().fg(t.accent)));
    segs.push(seg(sanitize(&account, false), Style::default().fg(t.strong).add_modifier(Modifier::BOLD)));
    segs.push(seg(format!(" ›  {}/{}", form.login + 1, accounts.len().max(1)), Style::default().fg(t.accent)));
    out.push((2, segs));
    if let Some(error) = &form.error {
        out.push((0, Vec::new()));
        out.push((2, vec![seg(sanitize(error, false), Style::default().fg(t.err))]));
    }
    out
}

fn preview_lines(name: &str, form: &RuleForm, lines: Option<&Result<Vec<GitConfigWrite>, String>>, t: &Theme) -> Vec<Line> {
    let folder = sanitize(&form.folder, false);
    let mut out = vec![heading("NEW RULE", t)];
    match lines {
        None => out.push(muted(format!("asking {name} what the rule for {folder} writes…"), t)),
        Some(Err(why)) => {
            out.push((2, vec![seg(format!("Not written: {}", sanitize(why, false)), Style::default().fg(t.err))]));
            out.push(muted("Esc goes back to the form.", t));
        }
        Some(Ok(writes)) => {
            out.push((2, vec![seg(format!("Enter writes these lines on {name}, for {folder}:"), Style::default().fg(t.strong))]));
            for w in writes {
                out.push((0, Vec::new()));
                out.push(muted(sanitize(&w.file, false), t));
                for line in &w.lines {
                    out.push((4, vec![seg(sanitize(line, false), Style::default().fg(t.text))]));
                }
            }
        }
    }
    out
}

fn remove_lines(folder: &str, t: &Theme) -> Vec<Line> {
    vec![
        (0, vec![seg(format!("Remove the rule for {}?", sanitize(folder, false)), Style::default().fg(t.strong).add_modifier(Modifier::BOLD))]),
        (0, Vec::new()),
        muted(concat!(env!("APP_NAME"), " takes away the lines it wrote. Commits there carry your usual name and email again."), t),
    ]
}
