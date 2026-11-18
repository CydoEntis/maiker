//! When the window loses its own daemon: for the first three seconds only a chip on the status bar says so, then
//! one box that says the service is not answering and offers to start it, and after "Not now" a red chip that opens
//! the box again. The daemon owns every session, so nothing here stops one; the window only keeps asking. Docs:
//! UI.md, "Service and update states".

use super::closing::Banner;
use super::*;
use crate::client::connections::Connections;
use crate::ipc;
use std::time::Duration;

/// The wait before each try, in order; the last holds from then on.
const BACKOFF: [Duration; 4] = [
    Duration::from_secs(2),
    Duration::from_secs(4),
    Duration::from_secs(8),
    Duration::from_secs(15),
];
/// How long a lost service shows only the chip, before the box comes up.
const BLIP: Duration = Duration::from_secs(3);
/// How long "Back online" stays on the bar.
pub(in crate::client) const BACK_ONLINE_FOR: Duration = Duration::from_secs(4);
/// Columns of the box that says the service is down.
const DOWN_W: u16 = 62;

/// What the service is called on screen.
fn daemon_name() -> String {
    maitty_shared::brand::DAEMON_NAME.to_string()
}

/// Whether the window has its daemon.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(in crate::client) enum Service {
    #[default]
    Up,
    Away(Away),
}

/// A daemon that is not answering: since when, which try is next and when, and what was done about the box.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::client) struct Away {
    pub since: Instant,
    pub try_n: u8,
    pub next_at: Instant,
    /// "Not now" was pressed: the box is down and a red chip stands in its place.
    pub dismissed: bool,
    /// Start service was pressed: the box is green until the service answers.
    pub starting: bool,
}

/// The state of the box and chip while the service is away.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum Phase {
    /// The first seconds: only the chip.
    Blip,
    Dialog,
    Dismissed,
}

impl Service {
    /// The service went away just now.
    pub(in crate::client) fn lost(now: Instant) -> Self {
        Service::Away(Away { since: now, try_n: 1, next_at: now + BACKOFF[0], dismissed: false, starting: false })
    }

    /// Away for long enough that the box is (or was) up.
    pub(in crate::client) fn is_down(&self) -> bool {
        matches!(self.phase(Instant::now()), Some(Phase::Dialog | Phase::Dismissed))
    }

    pub(in crate::client) fn phase(&self, now: Instant) -> Option<Phase> {
        match self {
            Service::Up => None,
            Service::Away(a) if now.duration_since(a.since) < BLIP => Some(Phase::Blip),
            Service::Away(a) if a.dismissed => Some(Phase::Dismissed),
            Service::Away(_) => Some(Phase::Dialog),
        }
    }

    /// The try this is on and whether it is due at `now`. None while the window has its daemon.
    fn try_at(&self, now: Instant) -> Option<(u8, bool)> {
        match self {
            Service::Up => None,
            Service::Away(a) => Some((a.try_n, now >= a.next_at)),
        }
    }

    fn away_mut(&mut self) -> Option<&mut Away> {
        match self {
            Service::Up => None,
            Service::Away(a) => Some(a),
        }
    }
}

/// What the service box does with a key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum ServiceKey {
    Retry,
    Start,
    /// `esc`: put the box away and leave the red chip.
    NotNow,
    /// `enter`: bring the box back from the chip.
    Reopen,
    Copy,
    Leave,
    Nothing,
}

pub(in crate::client) fn service_key(k: &KeyEvent) -> ServiceKey {
    match k.code {
        KeyCode::Char('c') if k.modifiers.contains(KeyModifiers::CONTROL) => ServiceKey::Leave,
        KeyCode::Char('r') => ServiceKey::Retry,
        KeyCode::Char('s') => ServiceKey::Start,
        KeyCode::Char('c') => ServiceKey::Copy,
        KeyCode::Esc => ServiceKey::NotNow,
        KeyCode::Enter => ServiceKey::Reopen,
        _ => ServiceKey::Nothing,
    }
}

/// Seconds until the next try, rounded up.
fn retry_in(next_at: Instant) -> u64 {
    next_at.saturating_duration_since(Instant::now()).as_secs_f64().ceil() as u64
}

impl App {
    /// The daemon went away without being asked to: keep the window and start counting.
    pub(in crate::client) fn service_lost(&mut self) {
        self.service = Service::lost(Instant::now());
        self.back_online = None;
        self.dirty = true;
    }

    /// What the box says when asked to copy: enough to paste into a bug report.
    fn service_details(&self) -> String {
        let (tries, secs) = match &self.service {
            Service::Away(a) => (a.try_n, a.since.elapsed().as_secs()),
            Service::Up => (0, 0),
        };
        format!(
            "{} is not answering. Maiker {} (protocol {}) has tried {tries} time{} over {secs}s.",
            daemon_name(),
            env!("APP_VERSION"),
            crate::protocol::PROTOCOL_VERSION,
            if tries == 1 { "" } else { "s" },
        )
    }

    /// Keys while the daemon is away: only the box's own, and the way out.
    pub(in crate::client) fn on_service_key(&mut self, k: &KeyEvent) {
        let phase = self.service.phase(Instant::now());
        match service_key(k) {
            ServiceKey::Retry => self.service_retry_now = true,
            ServiceKey::Start if phase.is_some_and(|p| p != Phase::Blip) => {
                if let Some(a) = self.service.away_mut() {
                    a.starting = true;
                    a.dismissed = false;
                }
                self.service_start_now = true;
            }
            ServiceKey::NotNow if phase == Some(Phase::Dialog) => {
                if let Some(a) = self.service.away_mut() {
                    a.dismissed = true;
                }
            }
            ServiceKey::Reopen if phase == Some(Phase::Dismissed) => self.service_reopen(),
            ServiceKey::Copy if phase.is_some_and(|p| p != Phase::Blip) => {
                let ok = crate::client::copy::to_clipboard(&self.service_details());
                self.notify(if ok { "Copied the details" } else { "Could not copy the details" }.into(), !ok);
            }
            ServiceKey::Leave => self.quit = Some(format!("left while {} was away", daemon_name())),
            _ => {}
        }
        self.dirty = true;
    }

    /// The red chip was clicked, or `enter` pressed: the box again.
    pub(in crate::client) fn service_reopen(&mut self) {
        if let Some(a) = self.service.away_mut() {
            a.dismissed = false;
        }
        self.dirty = true;
    }

    /// The service is back as a version this window cannot talk to (another copy of the app
    /// updated and restarted it): no try will ever work, so stop asking. A newer app installed
    /// here opens in this window's place; otherwise the start-up screen for a version mismatch
    /// takes over and offers the update.
    pub(in crate::client) fn service_changed_version(&mut self, daemon: u32) {
        if self.window_stale() {
            return self.relaunch_window();
        }
        self.service_version = Some(daemon);
        self.quit = Some(format!("{} was updated", daemon_name()));
        self.dirty = true;
    }

    /// Once a tick: make the try that is due, and start the service when it was asked for.
    pub(in crate::client) async fn service_tick(&mut self, connections: &mut Connections) {
        let Some((try_n, timed)) = self.service.try_at(Instant::now()) else {
            return;
        };
        let asked = std::mem::take(&mut self.service_retry_now);
        let start = std::mem::take(&mut self.service_start_now);
        if !(timed || asked || start) {
            // The countdown on the chip and the box changes every second.
            self.dirty = true;
            return;
        }
        let attempt = if start {
            ipc::open_or_spawn_installed_knowing_version(true).await
        } else {
            ipc::open_knowing_version(true).await
        };
        match attempt {
            Ok((connection, version)) => {
                connections.add(MachineId::LOCAL, connection);
                self.note_local_protocol(version);
                self.service = Service::Up;
                self.reattached = Some(Instant::now());
                self.back_online = Some(Instant::now());
            }
            Err(e) if ipc::other_version(&e).is_some() => {
                self.service_changed_version(ipc::other_version(&e).unwrap_or_default());
            }
            Err(_) => {
                let next = usize::from(try_n).min(BACKOFF.len() - 1);
                if let Some(a) = self.service.away_mut() {
                    a.try_n = try_n.saturating_add(1);
                    a.next_at = Instant::now() + BACKOFF[next];
                    a.starting = false;
                }
            }
        }
        self.dirty = true;
    }
}

/// How long the note about agents a restart stopped stays up.
const STOPPED_NOTE_FOR: Duration = Duration::from_secs(30);

impl App {
    /// The agents the daemon's last restart stopped, with the command that brings each back.
    pub(in crate::client) fn stopped_agents(&self) -> Vec<(ClientTerm, String, String)> {
        self.all_terms()
            .into_iter()
            .filter_map(|(term, info)| {
                let i = info.interrupted.as_ref()?;
                Some((term, i.agent.clone(), i.resume.clone()))
            })
            .collect()
    }

    /// The note under the header after a restart: what came back and what did not. Resuming is
    /// never automatic: Enter on the agent's row types its resume command.
    pub(in crate::client) fn restart_banner(&mut self) -> Option<Banner> {
        let stopped = self.stopped_agents().len();
        if stopped == 0 {
            self.stopped_since = None;
            return None;
        }
        let since = *self.stopped_since.get_or_insert_with(Instant::now);
        (since.elapsed() < STOPPED_NOTE_FOR).then(|| Banner {
            text: format!(
                "{} restarted · {stopped} agent{} stopped · Enter on its row resumes",
                daemon_name(),
                if stopped == 1 { "" } else { "s" }
            ),
            warn: false,
        })
    }

    /// Type an interrupted agent's resume command into its session. True when it had one.
    pub(in crate::client) fn resume_stopped_agent(&mut self, term: ClientTerm) -> bool {
        let Some((_, agent, resume)) = self.stopped_agents().into_iter().find(|(t, ..)| *t == term) else {
            return false;
        };
        self.send_input(term, format!("{resume}\r").into_bytes());
        self.notify(format!("Resuming {agent}"), false);
        true
    }
}

/// `text` broken into lines of at most `width` columns, on spaces.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for word in text.split_whitespace() {
        match lines.last_mut() {
            Some(line) if line.width() + 1 + word.width() <= width => {
                line.push(' ');
                line.push_str(word);
            }
            _ => lines.push(word.to_string()),
        }
    }
    lines
}

/// The box that says the service is not answering: the window dimmed behind it, a red edge, what is wrong, what is
/// kept, and the keys. Once Start service was pressed it is green with the spinner until the service answers.
pub(in crate::client) fn draw_service_down(app: &mut App, f: &mut Frame, area: Rect, t: &Theme) {
    let Service::Away(away) = app.service.clone() else {
        return;
    };
    if away.dismissed {
        return;
    }
    let buf = f.buffer_mut();
    super::popups::dim_all(app, buf, area, t);
    let w = DOWN_W.min(area.width.saturating_sub(2));
    let (title, body) = if away.starting {
        (
            format!("{} Reconnecting…", app.working_frame()),
            "Found the service. Picking your chats back up.".to_string(),
        )
    } else {
        (
            "Maiker can't reach its background service".to_string(),
            "Nothing works until it is back, but your chats are safe and will reconnect on their own. If it stays like this, start the service again."
                .to_string(),
        )
    };
    let lines = wrap(&body, w.saturating_sub(6) as usize);
    let h = (lines.len() as u16 + 6).min(area.height.saturating_sub(2));
    let r = Rect { x: area.x + (area.width - w) / 2, y: area.y + (area.height.saturating_sub(h)) / 2, width: w, height: h };
    let edge = if away.starting { t.done } else { t.err };
    let mut c = Card::new(t, "").lit(edge);
    c.bg = t.bg;
    c.close = Some(ScreenHit::Noop);
    app.screen.modal_rects.push(r);
    let inside = card(app, buf, r, &c, t);
    let s = Style::default().bg(t.bg);
    let x = inside.x + 2;
    put(buf, x, inside.y + 1, &[seg(title, s.fg(if away.starting { t.working } else { t.strong }).add_modifier(Modifier::BOLD))], inside.right());
    for (i, line) in lines.iter().enumerate() {
        put(buf, x, inside.y + 3 + i as u16, &[seg(line.clone(), s.fg(t.text))], inside.right());
    }
    if away.starting {
        return;
    }
    let y = inside.y + 4 + lines.len() as u16;
    let primary = Style::default().bg(t.err).fg(t.bg).add_modifier(Modifier::BOLD);
    let keys = [
        vec![seg(" [s] Start service ", primary)],
        vec![seg("esc", s.fg(t.strong).add_modifier(Modifier::BOLD)), seg(" Not now", s.fg(t.muted))],
        vec![seg("c", s.fg(t.strong).add_modifier(Modifier::BOLD)), seg(" Copy details", s.fg(t.muted))],
    ];
    let mut at = x;
    for (i, key) in keys.iter().enumerate() {
        let end = put(buf, at, y, key, inside.right());
        let target = [ScreenHit::ServiceStart, ScreenHit::ServiceNotNow, ScreenHit::ServiceCopy][i].clone();
        hit(app, Rect { x: at, y, width: end - at, height: 1 }, target);
        at = end + 2;
    }
    let retry = format!("retry {}s", retry_in(away.next_at));
    let rw = retry.width() as u16;
    if inside.right().saturating_sub(rw + 2) > at {
        put(buf, inside.right() - rw - 2, y, &[seg(retry, s.fg(t.muted))], inside.right());
    }
}

/// The status bar's chip for the service, if it has one: the blip's teal spinner, the red `Offline` chip after
/// "Not now", and for a few seconds after it came back, `Back online`. With its hit, which reopens the box.
pub(in crate::client) fn service_chip(app: &App, t: &Theme) -> Option<(Vec<crate::client::design::Seg>, Option<ScreenHit>)> {
    let style = |color: Color| Style::default().bg(t.bg).fg(color).add_modifier(Modifier::BOLD);
    match app.service.phase(Instant::now()) {
        Some(Phase::Blip) => Some((vec![seg(format!("{} Reconnecting…", app.working_frame()), style(t.working))], None)),
        Some(Phase::Dismissed) => {
            let Service::Away(a) = &app.service else { return None };
            Some((
                vec![seg(format!("× Offline · retrying in {}s", retry_in(a.next_at)), style(t.err))],
                Some(ScreenHit::ServiceReopen),
            ))
        }
        Some(Phase::Dialog) => None,
        None => app
            .back_online
            .filter(|at| at.elapsed() < BACK_ONLINE_FOR)
            .map(|_| (vec![seg("✓ Back online · nothing was lost", style(t.done))], None)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::reference_fixture::{Stage, world};
    use crate::protocol::{ClientMsg, Interrupted};

    /// A service lost `ago` ago.
    fn lost_ago(app: &mut App, ago: Duration) {
        app.service_lost();
        if let Service::Away(a) = &mut app.service {
            a.since = Instant::now() - ago;
        }
    }

    #[test]
    fn r_s_c_and_esc_are_the_keys() {
        let k = |c| KeyEvent::new(c, KeyModifiers::NONE);
        assert_eq!(service_key(&k(KeyCode::Char('r'))), ServiceKey::Retry);
        assert_eq!(service_key(&k(KeyCode::Char('s'))), ServiceKey::Start);
        assert_eq!(service_key(&k(KeyCode::Char('c'))), ServiceKey::Copy);
        assert_eq!(service_key(&k(KeyCode::Esc)), ServiceKey::NotNow);
        assert_eq!(service_key(&k(KeyCode::Char('x'))), ServiceKey::Nothing);
    }

    #[test]
    fn a_short_blip_shows_only_a_chip_and_a_long_one_the_box() {
        let mut app = world(Stage::None);
        let t = app.theme.clone();
        app.service_lost();
        assert_eq!(app.service.phase(Instant::now()), Some(Phase::Blip));
        assert!(service_chip(&app, &t).expect("the chip").0[0].0.contains("Reconnecting"));
        assert!(!app.service.is_down(), "no box in the first seconds");
        lost_ago(&mut app, BLIP + Duration::from_secs(1));
        assert_eq!(app.service.phase(Instant::now()), Some(Phase::Dialog));
        assert!(app.service.is_down() && service_chip(&app, &t).is_none());
    }

    #[test]
    fn not_now_puts_the_box_away_and_leaves_a_red_chip_that_brings_it_back() {
        let mut app = world(Stage::None);
        let t = app.theme.clone();
        lost_ago(&mut app, BLIP + Duration::from_secs(1));
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(app.service.phase(Instant::now()), Some(Phase::Dismissed));
        let (chip, hit) = service_chip(&app, &t).expect("the offline chip");
        assert!(chip[0].0.starts_with("× Offline"), "{chip:?}");
        assert!(matches!(hit, Some(ScreenHit::ServiceReopen)));
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.service.phase(Instant::now()), Some(Phase::Dialog));
    }

    #[test]
    fn while_the_daemon_is_away_typing_goes_nowhere() {
        let mut app = world(Stage::None);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        lost_ago(&mut app, BLIP + Duration::from_secs(1));
        app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
        app.on_key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::CONTROL));
        assert!(app.mode == Mode::Normal, "no shortcut mode either");
        assert!(rx.try_recv().is_err(), "nothing was sent to a pane");
        app.on_key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE));
        assert!(app.service_retry_now, "r asks for a try now");
        app.on_key(KeyEvent::new(KeyCode::Char('s'), KeyModifiers::NONE));
        assert!(app.service_start_now, "s asks for the service to start");
    }

    #[test]
    fn the_box_says_what_is_wrong_and_offers_start_not_now_and_copy() {
        use ratatui::{Terminal, backend::TestBackend};
        let mut app = world(Stage::None);
        lost_ago(&mut app, BLIP + Duration::from_secs(1));
        let mut term = Terminal::new(TestBackend::new(100, 30)).expect("a test terminal");
        term.draw(|f| crate::client::render::draw(&mut app, f)).expect("a frame");
        let buf = term.backend().buffer().clone();
        let all: String = (0..30)
            .map(|y| (0..100).map(|x| buf[(x, y)].symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("
");
        for want in ["Maiker can't reach its background service", "[s] Start service", "Not now", "Copy details"] {
            assert!(all.contains(want), "{want}
{all}");
        }
    }

    #[test]
    fn the_retries_back_off_two_four_eight_then_fifteen() {
        let now = Instant::now();
        let away = Service::lost(now);
        assert_eq!(away.try_at(now), Some((1, false)), "not before its wait is over");
        assert_eq!(away.try_at(now + BACKOFF[0]), Some((1, true)));
        assert_eq!(Service::Up.try_at(now), None);
        assert_eq!(BACKOFF.map(|d| d.as_secs()), [2, 4, 8, 15]);
    }

    #[test]
    fn a_service_that_came_back_as_another_version_ends_the_tries() {
        let mut app = world(Stage::None);
        app.service_lost();
        app.installed_version = Some(Ok(env!("APP_VERSION").into()));
        app.service_changed_version(crate::protocol::PROTOCOL_VERSION + 1);
        assert_eq!(app.service_version, Some(crate::protocol::PROTOCOL_VERSION + 1));
        assert!(app.quit.is_some() && !app.relaunch, "the mismatch screen takes over, in this app");
    }

    #[test]
    fn a_newer_app_installed_here_takes_the_window_when_the_service_changed_version() {
        let mut app = world(Stage::None);
        app.service_lost();
        app.installed_version = Some(Ok("999.0.0".into()));
        app.service_changed_version(crate::protocol::PROTOCOL_VERSION + 1);
        assert!(app.relaunch && app.quit.is_some());
        assert_eq!(app.service_version, None, "the installed app talks to that service");
    }

    #[test]
    fn agents_a_restart_stopped_are_named_and_enter_on_one_types_its_resume_command() {
        let mut app = world(Stage::None);
        let id = *app.snap.terms.keys().next().unwrap();
        app.snap.terms.get_mut(&id).unwrap().interrupted =
            Some(Interrupted { agent: "codex".into(), resume: "codex resume --last".into() });
        let note = app.restart_banner().expect("the note").text;
        assert!(note.contains("1 agent stopped") && note.contains("Enter"), "{note}");
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        assert!(app.resume_stopped_agent(ClientTerm::local(id)));
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(
            sent.iter().any(|o| matches!(&o.msg, ClientMsg::Input { term, data } if *term == id && data == b"codex resume --last\r")),
            "{sent:?}"
        );
        assert!(!app.resume_stopped_agent(ClientTerm::local(id + 100)), "only an interrupted one");
    }
}
