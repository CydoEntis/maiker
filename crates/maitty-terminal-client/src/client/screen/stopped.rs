//! A chat that stopped: its agent exited, or its machine stopped answering. The client derives it from what the daemon
//! already reports (a failed last command in an agent's pane, a machine whose line is unreachable) and invents no
//! status. The pane dims, one box says what happened and what is kept, and after "Not now" a red bar stays at the foot
//! of the pane. Docs: UI.md, "A chat stopped".

use super::card::dim_inside;
use super::service::wrap;
use super::*;
use crate::client::ids::MachineId;
use crate::client::link::ConnectionState;
use crate::protocol::{ClientMsg, ClosedSession, Query};
use std::time::Duration;

/// How far a stopped pane's last screen fades toward its ground: it keeps about 35% of its brightness.
const STOPPED_DIM: f32 = 0.65;
/// Columns of the box.
const BOX_W: u16 = 58;
/// How long "Restarting" shows before the box comes back to say the restart did not take.
const RESTART_FOR: Duration = Duration::from_secs(12);
/// The room the box needs: its border, a title, a blank, the words and the keys.
const BOX_ROWS_BESIDE_BODY: u16 = 6;

/// Why the chat counts as stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::client) enum Cause {
    /// The agent's process ended in failure; the code, when the shell reported one.
    Exited { code: Option<i32> },
    /// The machine it runs on is unreachable.
    Silent { machine: MachineId },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::client) struct Stopped {
    pub cause: Cause,
    /// `Claude`, as the sidebar says it.
    pub agent: String,
    /// The machine's name, empty for this computer.
    pub machine: String,
}

impl Stopped {
    /// The title of the box and the words after `×` on the bar.
    pub(super) fn title(&self) -> String {
        match self.cause {
            Cause::Exited { .. } => format!("{} stopped", self.agent),
            Cause::Silent { .. } => format!("{} stopped answering", self.machine),
        }
    }

    fn body(&self, down_for: Duration) -> String {
        match &self.cause {
            Cause::Exited { code } => {
                let code = code.map(|c| format!(" with code {c}")).unwrap_or_default();
                format!("It exited{code}. Your messages and changes are safe. Restart to carry on from the last message.")
            }
            Cause::Silent { .. } => format!(
                "Maiker has kept trying for {}. The chat is paused there and nothing is lost. Check that {} is on and online, then try again.",
                super::side::span(down_for.as_secs()),
                self.machine
            ),
        }
    }

    /// The primary key's word, and the same word in the bar's hint.
    fn retry_word(&self) -> &'static str {
        match self.cause {
            Cause::Exited { .. } => "Restart",
            Cause::Silent { .. } => "Try again",
        }
    }

    /// What the box says while the restart runs.
    fn restarting(&self) -> &'static str {
        match self.cause {
            Cause::Exited { .. } => "Restarting",
            Cause::Silent { .. } => "Reconnecting to",
        }
    }
}

/// What was done about one pane's box: put away with "Not now", or a restart asked for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(in crate::client) struct StoppedUi {
    pub dismissed: bool,
    pub restarting: Option<Instant>,
}

impl StoppedUi {
    /// The restart still being waited on.
    fn restart_running(&self) -> bool {
        self.restarting.is_some_and(|at| at.elapsed() < RESTART_FOR)
    }
}

impl App {
    /// Whether the chat in `term` stopped, and why. Never true for a shell, or for an agent that is working or asking.
    pub(in crate::client) fn stopped(&self, term: ClientTerm) -> Option<Stopped> {
        let info = self.term_info(term)?;
        if info.agent.is_none() && !info.began_as_agent {
            return None;
        }
        let agent = info.agent.as_deref().map_or_else(|| "Agent".to_string(), super::side::capitalised);
        let machine = self.machine_label_of(term.machine);
        let silent = self
            .remotes
            .get(&term.machine)
            .is_some_and(|r| matches!(r.state, ConnectionState::Unreachable { .. }));
        if silent {
            return Some(Stopped { cause: Cause::Silent { machine: term.machine }, agent, machine });
        }
        let exit = info.exit?;
        let busy = matches!(info.status, Status::Working | Status::Blocked);
        (!busy).then_some(Stopped { cause: Cause::Exited { code: exit.code }, agent, machine })
    }

    fn stopped_ui(&self, term: ClientTerm) -> StoppedUi {
        self.screen.stopped_ui.get(&term).copied().unwrap_or_default()
    }

    fn set_stopped_ui(&mut self, term: ClientTerm, change: impl FnOnce(&mut StoppedUi)) {
        change(self.screen.stopped_ui.entry(term).or_default());
        self.dirty = true;
    }

    /// `r`: restart the agent, or try its machine again. Restarting an agent is the daemon's own resume, never ours.
    pub(in crate::client) fn stopped_restart(&mut self, term: ClientTerm) {
        let Some(stopped) = self.stopped(term) else {
            return;
        };
        self.set_stopped_ui(term, |ui| *ui = StoppedUi { dismissed: false, restarting: Some(Instant::now()) });
        match stopped.cause {
            Cause::Silent { machine } => self.menu_do(crate::client::menu::Act::MachineReconnect(machine)),
            Cause::Exited { .. } if self.resume_stopped_agent(term) => {}
            Cause::Exited { .. } => self.ask_restart_list(term),
        }
    }

    /// An agent that exited on its own has no resume command here: the daemon's list of closed sessions has its conversation.
    fn ask_restart_list(&mut self, term: ClientTerm) {
        let ask = ClientMsg::Query(Query::ClosedSessions);
        if term.machine != MachineId::LOCAL || ask.introduced_in() > self.local_protocol {
            self.set_stopped_ui(term, |ui| ui.restarting = None);
            return self.notify("Restart this chat from the machine it runs on: its closed sessions list has it.".into(), true);
        }
        self.screen.restart_asked = Some(term);
        self.send(MachineId::LOCAL, ask);
    }

    /// The daemon's closed sessions came while a restart waited for them: reopen the newest of this chat's agent in its folder.
    pub(in crate::client) fn restart_from_closed(&mut self, term: ClientTerm, list: &[ClosedSession]) {
        let wanted = self.term_info(term).map(|t| (t.agent.clone(), t.top.clone().unwrap_or_else(|| t.cwd.clone())));
        let found = wanted.and_then(|(agent, dir)| {
            list.iter()
                .filter(|c| agent.as_deref().is_none_or(|a| a == c.agent) && (c.cwd == dir || c.worktree.as_ref() == Some(&dir)))
                .max_by_key(|c| c.at)
        });
        match found {
            Some(c) => self.reopen_closed(c.agent.clone(), c.session.clone()),
            None => {
                self.set_stopped_ui(term, |ui| ui.restarting = None);
                self.notify("No saved conversation to restart from.".into(), true);
            }
        }
    }

    /// `esc`: put the box away and leave the bar.
    pub(in crate::client) fn stopped_not_now(&mut self, term: ClientTerm) {
        self.set_stopped_ui(term, |ui| ui.dismissed = true);
    }

    /// `enter` on the bar: the box again.
    pub(in crate::client) fn stopped_reopen(&mut self, term: ClientTerm) {
        self.set_stopped_ui(term, |ui| ui.dismissed = false);
    }

    /// `c`: what to paste into a bug report.
    pub(in crate::client) fn stopped_copy(&mut self, term: ClientTerm) {
        let Some(stopped) = self.stopped(term) else {
            return;
        };
        let what = match stopped.cause {
            Cause::Exited { code } => format!("{} exited{}.", stopped.agent, code.map(|c| format!(" with code {c}")).unwrap_or_default()),
            Cause::Silent { .. } => format!("{} stopped answering.", stopped.machine),
        };
        let details = format!("{what} Maiker {} (protocol {}).", env!("APP_VERSION"), crate::protocol::PROTOCOL_VERSION);
        let ok = crate::client::copy::to_clipboard(&details);
        self.notify(if ok { "Copied the details" } else { "Could not copy the details" }.into(), !ok);
    }

    /// Keys while the focused pane's chat is stopped: nothing runs there to take them. True when the key was ours.
    pub(in crate::client) fn on_stopped_key(&mut self, k: &KeyEvent) -> bool {
        let Some(term) = self.focused().filter(|t| self.stopped(*t).is_some()) else {
            return false;
        };
        if !k.modifiers.is_empty() {
            return false;
        }
        let away = self.stopped_ui(term).dismissed;
        match k.code {
            KeyCode::Char('r') => self.stopped_restart(term),
            KeyCode::Char('c') => self.stopped_copy(term),
            KeyCode::Esc if !away => self.stopped_not_now(term),
            KeyCode::Enter if away => self.stopped_reopen(term),
            _ => return false,
        }
        true
    }
}

/// Dim the stopped chat's pane and draw the box or the bar over it. False when the chat has not stopped, so the pane
/// draws as usual.
pub(in crate::client) fn draw_stopped(app: &mut App, buf: &mut Buffer, (r, inner): (Rect, Rect), term: ClientTerm, ground: Color, t: &Theme) -> bool {
    let Some(stopped) = app.stopped(term) else {
        app.screen.stopped_ui.remove(&term);
        return false;
    };
    let ui = app.stopped_ui(term);
    dim_inside(buf, inner, STOPPED_DIM, t);
    let down_for = app.remotes.get(&term.machine).and_then(|m| m.down_since).map_or(Duration::ZERO, |s| s.elapsed());
    let body = stopped.body(down_for);
    let room = BOX_W.min(inner.width.saturating_sub(2));
    let lines = wrap(&body, room.saturating_sub(6) as usize);
    let tall = lines.len() as u16 + BOX_ROWS_BESIDE_BODY;
    let fits = room >= 30 && inner.height >= tall;
    if ui.dismissed && !ui.restart_running() || !fits {
        draw_bar(app, buf, r, term, &stopped, ground, t);
    } else {
        let centre = Rect { x: inner.x + (inner.width - room) / 2, y: inner.y + (inner.height - tall) / 2, width: room, height: tall };
        draw_box(app, buf, centre, term, (&stopped, &lines), ui.restart_running(), t);
    }
    true
}

fn draw_box(app: &mut App, buf: &mut Buffer, r: Rect, term: ClientTerm, (stopped, lines): (&Stopped, &[String]), restarting: bool, t: &Theme) {
    let edge = if restarting { t.working } else { t.err };
    let mut c = Card::new(t, "").lit(edge);
    c.bg = t.bg;
    app.screen.modal_rects.push(r);
    let inside = card(app, buf, r, &c, t);
    let s = Style::default().bg(t.bg);
    let x = inside.x + 2;
    let bold = Modifier::BOLD;
    let (title, lines) = if restarting {
        let spinner = app.working_frame();
        let who = if matches!(stopped.cause, Cause::Silent { .. }) { &stopped.machine } else { &stopped.agent };
        (format!("{spinner} {} {who}…", stopped.restarting()), vec!["Picking up from your last message.".to_string()])
    } else {
        (stopped.title(), lines.to_vec())
    };
    put(buf, x, inside.y + 1, &[seg(title, s.fg(if restarting { t.working } else { t.strong }).add_modifier(bold))], inside.right());
    for (i, line) in lines.iter().enumerate() {
        put(buf, x, inside.y + 3 + i as u16, &[seg(line.clone(), s.fg(t.text))], inside.right());
    }
    if restarting {
        return;
    }
    let y = inside.y + 4 + lines.len() as u16;
    let primary = Style::default().bg(t.err).fg(t.bg).add_modifier(bold);
    let keys = [
        (vec![seg(format!(" [r] {} ", stopped.retry_word()), primary)], ScreenHit::StoppedRestart(term)),
        (vec![seg("esc", s.fg(t.strong).add_modifier(bold)), seg(" Not now", s.fg(t.muted))], ScreenHit::StoppedNotNow(term)),
        (vec![seg("c", s.fg(t.strong).add_modifier(bold)), seg(" Copy details", s.fg(t.muted))], ScreenHit::StoppedCopy(term)),
    ];
    let mut at = x;
    for (segs, target) in keys {
        let end = put(buf, at, y, &segs, inside.right());
        hit(app, Rect { x: at, y, width: end - at, height: 1 }, target);
        at = end + 2;
    }
}

/// The one red line at the foot of the pane once the box is put away: what stopped, and the keys that still work.
fn draw_bar(app: &mut App, buf: &mut Buffer, r: Rect, term: ClientTerm, stopped: &Stopped, ground: Color, t: &Theme) {
    if r.height < 4 || r.width < 20 {
        return;
    }
    let y = r.bottom().saturating_sub(2);
    let (x, end) = (r.x + 2, r.right().saturating_sub(2));
    let bar = Rect { x, y, width: end.saturating_sub(x), height: 1 };
    fill(buf, bar, ground);
    let base = Style::default().bg(ground);
    let bold = Modifier::BOLD;
    let title = format!("× {}", stopped.title());
    put_cut(buf, x, y, vec![seg(title, base.fg(t.err).add_modifier(bold))], end);
    hit(app, bar, ScreenHit::StoppedReopen(term));
    let hints = [
        ("r", stopped.retry_word().to_lowercase(), ScreenHit::StoppedRestart(term)),
        ("c", "details".to_string(), ScreenHit::StoppedCopy(term)),
        ("enter", "more".to_string(), ScreenHit::StoppedReopen(term)),
    ];
    let widths: Vec<u16> = hints.iter().map(|(k, w, _)| (k.width() + 1 + w.width()) as u16).collect();
    let total = widths.iter().sum::<u16>() + 2 * (hints.len() as u16 - 1);
    let lead = (stopped.title().width() + 2) as u16;
    if bar.width < lead + total + 2 {
        return;
    }
    let mut at = end - total;
    for ((key, word, target), w) in hints.into_iter().zip(widths) {
        put(buf, at, y, &[seg(key, base.fg(t.strong).add_modifier(bold)), seg(format!(" {word}"), base.fg(t.muted))], end);
        hit(app, Rect { x: at, y, width: w, height: 1 }, target);
        at += w + 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::reference_fixture::{Stage, focus, world};
    use crate::protocol::ExitInfo;
    use ratatui::{Terminal, backend::TestBackend};

    fn key(c: KeyCode) -> KeyEvent {
        KeyEvent::new(c, KeyModifiers::NONE)
    }

    /// The window's first agent pane, focused, whose agent exited with `code`.
    fn exited(code: i32) -> (App, ClientTerm) {
        let mut app = world(Stage::None);
        let id = *app.snap.terms.iter().find(|(_, t)| t.agent.is_some()).map(|(id, _)| id).expect("an agent");
        let info = app.snap.terms.get_mut(&id).expect("its info");
        info.status = Status::Idle;
        info.exit = Some(ExitInfo { code: Some(code), at: 0 });
        focus(&mut app, id);
        (app, ClientTerm::local(id))
    }

    fn frame(app: &mut App) -> String {
        let mut term = Terminal::new(TestBackend::new(120, 34)).expect("a test terminal");
        term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
        let buf = term.backend().buffer().clone();
        (0..34).map(|y| (0..120).map(|x| buf[(x, y)].symbol()).collect::<String>()).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn a_working_agent_or_a_shell_is_never_called_stopped() {
        let (mut app, term) = exited(1);
        app.snap.terms.get_mut(&term.term).unwrap().status = Status::Working;
        assert_eq!(app.stopped(term), None, "a working agent reports its own status");
        let info = app.snap.terms.get_mut(&term.term).unwrap();
        (info.status, info.agent, info.began_as_agent) = (Status::Idle, None, false);
        assert_eq!(app.stopped(term), None, "a failed command in a plain shell is the shell's own business");
    }

    #[test]
    fn not_now_leaves_a_red_bar_and_enter_brings_the_box_back() {
        let (mut app, _) = exited(1);
        app.on_key(key(KeyCode::Esc));
        let all = frame(&mut app);
        assert!(all.contains("× ") && all.contains("r restart") && all.contains("c details") && all.contains("enter more"), "{all}");
        assert!(!all.contains("esc Not now"), "the box is away\n{all}");
        app.on_key(key(KeyCode::Enter));
        assert!(frame(&mut app).contains("[r] Restart"));
    }

    #[test]
    fn restart_turns_the_box_teal_with_the_spinner_and_types_the_resume_command() {
        let (mut app, term) = exited(1);
        app.snap.terms.get_mut(&term.term).unwrap().interrupted =
            Some(crate::protocol::Interrupted { agent: "claude".into(), resume: "claude --continue".into() });
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        app.on_key(key(KeyCode::Char('r')));
        let all = frame(&mut app);
        assert!(all.contains("Restarting") && all.contains("Picking up from your last message."), "{all}");
        assert!(!all.contains("[r] Restart"), "the keys are gone while it restarts\n{all}");
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(
            sent.iter().any(|o| matches!(&o.msg, ClientMsg::Input { data, .. } if data == b"claude --continue\r")),
            "{sent:?}"
        );
    }

    #[test]
    fn keys_reach_the_pane_again_once_the_chat_is_not_stopped() {
        let (mut app, term) = exited(1);
        app.snap.terms.get_mut(&term.term).unwrap().exit = None;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        app.on_key(key(KeyCode::Char('r')));
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(sent.iter().any(|o| matches!(&o.msg, ClientMsg::Input { data, .. } if data == b"r")), "{sent:?}");
    }

    #[test]
    fn a_machine_that_stopped_answering_says_so_and_offers_try_again() {
        let (mut app, term) = exited(1);
        let info = app.snap.terms.remove(&term.term).expect("the pane");
        let machine = MachineId(1);
        let remote = app.remotes.entry(machine).or_default();
        remote.name = "kingdom".into();
        remote.snap.terms.insert(term.term, info);
        remote.state = ConnectionState::Unreachable {
            since: Instant::now(),
            failure: crate::link_failure::FailureClass::Unreachable("no route".into()),
        };
        remote.down_since = Some(Instant::now());
        let stopped = app.stopped(ClientTerm::on(machine, term.term)).expect("stopped");
        assert_eq!(stopped.title(), "kingdom stopped answering");
        assert_eq!(stopped.retry_word(), "Try again");
        assert!(stopped.body(Duration::from_secs(120)).contains("Check that kingdom is on and online"));
    }
}
