//! Toasts: news about a chat you are not looking at, or about an update. One box at a time, bottom right above the
//! status bar, 50 columns, with a 2-column edge in the status colour. The newest shows and `+N` in its title counts the
//! ones waiting. Plain notices (`App::notify`) keep their own look in `draw_toast`. Docs: UI.md, "Toasts".

use super::service::wrap;
use super::*;
use std::time::Duration;

const DONE_FOR: Duration = Duration::from_secs(6);
const UPDATE_FOR: Duration = Duration::from_secs(12);
const TOAST_W: u16 = 50;
const EDGE_W: u16 = 2;
/// Where the text starts, from the box's left edge: past the colour edge and one column of room.
const TEXT_X: u16 = EDGE_W + 1;
/// The most body lines; a longer question is cut so the box never covers the pane.
const BODY_LINES: usize = 4;
/// A question the agent did not put into words.
const NO_QUESTION: &str = "Waiting for your answer.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum ToastKind {
    /// An agent asks you something; stays until it is answered.
    Needs,
    /// An agent stopped or its machine stopped answering; stays until dismissed.
    Failed,
    /// An agent finished; goes after six seconds.
    Done,
    /// A newer release is ready; goes after twelve seconds.
    Update,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct Toast {
    pub kind: ToastKind,
    pub term: Option<ClientTerm>,
    pub title: String,
    pub body: String,
    pub at: Instant,
}

impl Toast {
    pub fn for_chat(kind: ToastKind, term: ClientTerm, title: String, body: String) -> Toast {
        Toast { kind, term: Some(term), title, body, at: Instant::now() }
    }

    fn expired(&self) -> bool {
        match self.kind {
            ToastKind::Done => self.at.elapsed() >= DONE_FOR,
            ToastKind::Update => self.at.elapsed() >= UPDATE_FOR,
            ToastKind::Needs | ToastKind::Failed => false,
        }
    }

    /// A chat has one toast at a time, and there is one update toast.
    fn replaces(&self, other: &Toast) -> bool {
        match (self.term, other.term) {
            (Some(a), Some(b)) => a == b,
            (None, None) => self.kind == other.kind,
            _ => false,
        }
    }

    fn colour(&self, t: &Theme) -> Color {
        match self.kind {
            ToastKind::Needs => t.blocked,
            ToastKind::Failed => t.err,
            ToastKind::Done => t.done,
            ToastKind::Update => t.accent,
        }
    }

    fn glyph(&self) -> &'static str {
        match self.kind {
            ToastKind::Needs => "!",
            ToastKind::Failed => "×",
            ToastKind::Done => "✓",
            ToastKind::Update => "↓",
        }
    }
}

impl App {
    /// Show `toast` next, in place of an older one about the same chat.
    pub(in crate::client) fn push_toast(&mut self, toast: Toast) {
        self.toasts.retain(|old| !toast.replaces(old));
        self.toasts.push(toast);
        self.dirty = true;
    }

    /// The name of a chat as the sidebar says it, and the question it asks.
    fn toast_chat(&self, term: ClientTerm) -> (String, Option<String>) {
        let model = self.screen_model();
        match super::draw::find(&model, term) {
            Some((_, _, s)) => (s.name.clone(), s.question.clone()),
            None => (self.session_name(term), None),
        }
    }

    /// An agent needs you. A machine's own words never reach the screen: a remote agent's question stays in its pane.
    pub(in crate::client) fn toast_needs(&mut self, term: ClientTerm) {
        let (name, question) = self.toast_chat(term);
        let body = question.filter(|_| term.machine == MachineId::LOCAL).unwrap_or_else(|| NO_QUESTION.into());
        let title = self.toast_title(term, format!("{name} needs you"));
        self.push_toast(Toast::for_chat(ToastKind::Needs, term, title, body));
    }

    pub(in crate::client) fn toast_done(&mut self, term: ClientTerm) {
        let (name, _) = self.toast_chat(term);
        let title = self.toast_title(term, format!("{name} finished"));
        self.push_toast(Toast::for_chat(ToastKind::Done, term, title, "Ready for you to review.".into()));
    }

    fn toast_title(&self, term: ClientTerm, title: String) -> String {
        if term.machine == MachineId::LOCAL {
            title
        } else {
            maitty_machines::remote_policy::tagged(self.machine_name(term.machine), &title)
        }
    }

    /// Chats that stopped since the last look get a toast, once each, unless you are on them.
    pub(in crate::client) fn fire_failed_toasts(&mut self) {
        let stopped: Vec<_> = self
            .all_terms()
            .into_iter()
            .filter_map(|(term, _)| self.stopped(term).map(|s| (term, s)))
            .collect();
        self.failed_told.retain(|t| stopped.iter().any(|(s, _)| s == t));
        for (term, s) in stopped {
            if !self.failed_told.insert(term) || self.focused() == Some(term) || !self.machine_opts(term.machine).notices {
                continue;
            }
            let (name, _) = self.toast_chat(term);
            let body = format!("{name} is paused there. Nothing is lost.");
            self.push_toast(Toast::for_chat(ToastKind::Failed, term, s.title(), body));
        }
    }

    /// Whether `toast` is still news: not timed out, its chat not open, its question not answered.
    fn toast_alive(&self, toast: &Toast) -> bool {
        if toast.expired() {
            return false;
        }
        let Some(term) = toast.term else {
            return self.update_available.is_some() && !self.updating;
        };
        let Some(info) = self.term_info(term) else {
            return false;
        };
        self.focused() != Some(term) && (toast.kind != ToastKind::Needs || info.status == Status::Blocked)
    }

    /// Drop what is no longer news. True when something went.
    pub(in crate::client) fn prune_toasts(&mut self) -> bool {
        let before = self.toasts.len();
        let alive: Vec<bool> = self.toasts.iter().map(|t| self.toast_alive(t)).collect();
        let mut keep = alive.into_iter();
        self.toasts.retain(|_| keep.next().unwrap_or(false));
        self.toasts.len() != before
    }

    /// Toasts stay away while the service is down and while a dialog, menu or settings screen is open.
    fn toast_visible(&self) -> bool {
        self.service == Service::Up && !self.splash && matches!(self.mode, Mode::Normal | Mode::Side | Mode::Prefix { .. })
    }

    /// The toast on show and how many wait behind it.
    pub(in crate::client) fn head_toast(&self) -> Option<(Toast, usize)> {
        let live: Vec<&Toast> = self.toasts.iter().filter(|t| self.toast_alive(t)).collect();
        live.last().map(|t| ((*t).clone(), live.len() - 1))
    }

    /// `alt+j` or a click on its title: go to its chat, or for an update open the menu where it waits.
    pub(in crate::client) fn toast_go(&mut self) -> bool {
        if !self.toast_visible() {
            return false;
        }
        let Some((toast, _)) = self.head_toast() else {
            return false;
        };
        match toast.term {
            Some(term) => self.screen_focus(term),
            None => self.mode = Mode::Actions { sel: 0 },
        }
        self.toasts.retain(|t| *t != toast);
        self.dirty = true;
        true
    }

    /// `esc` or `×`.
    pub(in crate::client) fn toast_dismiss(&mut self) -> bool {
        if !self.toast_visible() {
            return false;
        }
        let Some((toast, _)) = self.head_toast() else {
            return false;
        };
        self.toasts.retain(|t| *t != toast);
        self.dirty = true;
        true
    }

    /// `i` on the update toast: install now.
    pub(in crate::client) fn toast_install(&mut self) -> bool {
        let on_update = self.toast_visible() && self.head_toast().is_some_and(|(t, _)| t.kind == ToastKind::Update);
        if on_update {
            self.toasts.retain(|t| t.kind != ToastKind::Update);
            self.start_update();
        }
        on_update
    }
}

/// The key that goes to the chat, as the bar spells it.
fn go_key(app: &App) -> String {
    super::mode_bar::bound_global(app, &Action::Jump).map_or_else(|| "alt+j".to_string(), |k| short_key(&k))
}

/// The toast's keys: the first does the main thing, the second puts it away.
fn keys_of(app: &App, toast: &Toast) -> [(String, &'static str, ScreenHit); 2] {
    match toast.kind {
        ToastKind::Update => [
            ("i".into(), "install now", ScreenHit::ToastInstall),
            ("esc".into(), "later", ScreenHit::ToastDismiss),
        ],
        _ => [
            (go_key(app), "go there", ScreenHit::ToastGo),
            ("esc".into(), "dismiss", ScreenHit::ToastDismiss),
        ],
    }
}

/// Draw the toast in `above` (the window over the status bar). Returns the rows it takes, so a plain notice can sit over it.
pub(in crate::client) fn draw_live_toast(app: &mut App, buf: &mut Buffer, above: Rect, t: &Theme) -> u16 {
    app.screen.toast_box = Rect::default();
    if !app.toast_visible() {
        return 0;
    }
    let Some((toast, more)) = app.head_toast() else {
        return 0;
    };
    let w = TOAST_W.min(above.width.saturating_sub(2));
    if w < 24 {
        return 0;
    }
    let text_w = (w - TEXT_X - 2) as usize;
    let body: Vec<String> = wrap(&toast.body, text_w).into_iter().take(BODY_LINES).collect();
    let h = 4 + body.len() as u16;
    if above.height < h {
        return 0;
    }
    let r = Rect { x: above.right().saturating_sub(w + 1), y: above.bottom() - h, width: w, height: h };
    app.screen.toast_box = r;
    let look = Look::of(&app.cfg.ui);
    let colour = toast.colour(t);
    fill(buf, r, t.bg);
    panel_box(buf, r, look, Style::default().fg(t.border).bg(t.bg));
    for y in r.y..r.bottom() {
        for x in r.x..r.x + EDGE_W {
            buf[(x, y)].set_symbol(" ").set_style(Style::default().bg(colour));
        }
    }
    let on = Style::default().bg(t.bg);
    let tx = r.x + TEXT_X;
    let mut title = vec![
        seg(format!("{} ", toast.glyph()), on.fg(colour).add_modifier(Modifier::BOLD)),
        seg(toast.title.clone(), on.fg(t.strong).add_modifier(Modifier::BOLD)),
    ];
    if more > 0 {
        title.push(seg(format!("  +{more}"), on.fg(t.muted)));
    }
    let title_end = put(buf, tx, r.y + 1, &title, r.right().saturating_sub(5));
    let close = Rect { x: r.right().saturating_sub(4), y: r.y + 1, width: 1, height: 1 };
    put(buf, close.x, close.y, &[seg("×", on.fg(t.muted).add_modifier(Modifier::BOLD))], r.right() - 1);
    for (i, line) in body.iter().enumerate() {
        put(buf, tx, r.y + 2 + i as u16, &[seg(line.clone(), on.fg(t.text))], r.right() - 1);
    }
    let ky = r.bottom() - 2;
    let mut x = tx;
    for (key, words, target) in keys_of(app, &toast) {
        let segs = [
            seg(key, on.fg(t.strong).add_modifier(Modifier::BOLD)),
            seg(format!(" {words}"), on.fg(t.muted)),
        ];
        let end = put(buf, x, ky, &segs, r.right() - 1);
        hit(app, Rect { x, y: ky, width: end - x, height: 1 }, target);
        x = end + 2;
    }
    hit(app, Rect { x: tx, y: r.y + 1, width: title_end.saturating_sub(tx).max(1), height: 1 }, ScreenHit::ToastGo);
    hit(app, Rect { x: close.x.saturating_sub(1), y: close.y, width: 3, height: 1 }, ScreenHit::ToastDismiss);
    h
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::reference_fixture::{Stage, world};
    use ratatui::{Terminal, backend::TestBackend};

    const W: u16 = 120;
    const H: u16 = 32;

    fn frame(app: &mut App) -> (Buffer, String) {
        let mut term = Terminal::new(TestBackend::new(W, H)).expect("a test terminal");
        term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
        let buf = term.backend().buffer().clone();
        let text = (0..H)
            .map(|y| (0..W).map(|x| buf[(x, y)].symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        (buf, text)
    }

    /// The fixture's chat that asks a question (not the one open).
    fn asking_chat() -> ClientTerm {
        ClientTerm::local(3)
    }

    /// A chat that is not the one open.
    fn other_chat(app: &App) -> ClientTerm {
        let open = app.focused();
        app.all_terms().into_iter().map(|(t, _)| t).find(|t| Some(*t) != open).expect("a second chat")
    }

    fn toast(kind: ToastKind, term: ClientTerm, title: &str, body: &str) -> Toast {
        Toast::for_chat(kind, term, title.into(), body.into())
    }

    #[test]
    fn a_toast_sits_bottom_right_with_its_title_body_and_keys() {
        let mut app = world(Stage::None);
        let term = asking_chat();
        app.push_toast(toast(ToastKind::Needs, term, "auth needs you", "Overwrite the config?"));
        let (buf, text) = frame(&mut app);
        for want in ["auth needs you", "Overwrite the config?", "go there", "dismiss", "×"] {
            assert!(text.contains(want), "{want}\n{text}");
        }
        let r = app.screen.toast_box;
        assert_eq!(r.width, TOAST_W);
        assert!(r.right() <= W && r.bottom() < H, "inside the screen, above the bar: {r:?}");
        assert_eq!(buf[(r.x, r.y + 1)].bg, app.theme.blocked, "its edge is the status colour");
        assert_eq!(buf[(r.x + 1, r.y + 2)].bg, app.theme.blocked);
    }

    #[test]
    fn the_newest_shows_and_the_title_counts_the_rest() {
        let mut app = world(Stage::None);
        let terms: Vec<_> = app.all_terms().into_iter().map(|(t, _)| t).filter(|t| Some(*t) != app.focused()).collect();
        assert!(terms.len() >= 2, "the fixture has several chats");
        app.push_toast(toast(ToastKind::Done, terms[0], "old finished", "Ready for you to review."));
        app.push_toast(toast(ToastKind::Failed, terms[1], "new stopped", "x is paused there. Nothing is lost."));
        let (_, text) = frame(&mut app);
        assert!(text.contains("new stopped") && text.contains("+1"), "{text}");
        assert!(!text.contains("old finished"), "one at a time");
    }

    #[test]
    fn a_done_toast_goes_after_six_seconds_and_a_needs_toast_stays() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        let mut done = toast(ToastKind::Done, term, "a finished", "Ready for you to review.");
        done.at = Instant::now() - DONE_FOR - Duration::from_secs(1);
        app.toasts.push(done);
        assert!(app.prune_toasts() && app.toasts.is_empty());
        let mut failed = toast(ToastKind::Failed, term, "kingdom stopped answering", "b is paused there. Nothing is lost.");
        failed.at = Instant::now() - Duration::from_secs(600);
        app.toasts.push(failed);
        assert!(!app.prune_toasts(), "a failure stays until dismissed");
    }

    #[test]
    fn opening_the_chat_removes_its_toast() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        app.push_toast(toast(ToastKind::Failed, term, "Claude stopped", "c is paused there. Nothing is lost."));
        app.screen_focus(term);
        assert!(app.toasts.is_empty());
    }

    #[test]
    fn esc_dismisses_it_and_the_key_does_not_reach_the_pane() {
        let mut app = world(Stage::None);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let term = other_chat(&app);
        app.push_toast(toast(ToastKind::Failed, term, "Claude stopped", "d is paused there. Nothing is lost."));
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.toasts.is_empty());
        assert!(rx.try_recv().is_err(), "esc went nowhere else");
    }

    #[test]
    fn go_there_opens_the_chat() {
        let mut app = world(Stage::None);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let term = asking_chat();
        app.push_toast(toast(ToastKind::Needs, term, "e needs you", "Which one?"));
        assert!(app.toast_go() && app.toasts.is_empty());
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(
            sent.iter().any(|o| matches!(&o.msg, crate::protocol::ClientMsg::Command(Command::FocusPane { term: t }) if *t == term.term)),
            "{sent:?}"
        );
    }

    #[test]
    fn a_dialog_or_a_lost_service_hides_the_toast() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        app.push_toast(toast(ToastKind::Failed, term, "Claude stopped", "f is paused there. Nothing is lost."));
        app.mode = Mode::Usage;
        assert!(!frame(&mut app).1.contains("Claude stopped"));
        app.mode = Mode::Normal;
        app.service_lost();
        if let Service::Away(a) = &mut app.service {
            a.since = Instant::now() - Duration::from_secs(10);
        }
        assert!(!frame(&mut app).1.contains("Claude stopped"));
    }

    #[test]
    fn a_toast_for_a_question_already_answered_goes() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        let id = term.term;
        app.snap.terms.get_mut(&id).expect("the chat").status = Status::Working;
        app.push_toast(toast(ToastKind::Needs, term, "g needs you", "Which one?"));
        assert!(app.prune_toasts());
    }

    #[test]
    fn a_chat_that_stopped_gets_one_toast_even_after_it_is_dismissed() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        let info = app.snap.terms.get_mut(&term.term).expect("the chat");
        info.status = Status::Idle;
        info.agent = Some("claude".into());
        info.exit = Some(crate::protocol::ExitInfo { code: Some(1), at: 0 });
        app.fire_failed_toasts();
        let shown = app.toasts.last().cloned().expect("a toast");
        assert_eq!((shown.kind, shown.title.as_str()), (ToastKind::Failed, "Claude stopped"));
        assert!(shown.body.ends_with("is paused there. Nothing is lost."), "{}", shown.body);
        app.toast_dismiss();
        app.fire_failed_toasts();
        assert!(app.toasts.is_empty(), "dismissed means dismissed");
    }

    #[test]
    fn an_agent_that_needs_you_gets_a_toast_with_its_question() {
        let mut app = world(Stage::None);
        let term = asking_chat();
        app.alert_now(term, Status::Blocked);
        let shown = app.toasts.last().cloned().expect("a toast");
        assert!(shown.title.ends_with(" needs you") && shown.kind == ToastKind::Needs, "{shown:?}");
        assert_ne!(shown.body, "", "it says what is asked");
    }

    #[test]
    fn nothing_fires_for_the_chat_you_are_looking_at() {
        let mut app = world(Stage::None);
        let open = app.focused().expect("a chat is open");
        app.alert_now(open, Status::Done);
        assert!(app.toasts.is_empty());
    }

    #[test]
    fn clicking_the_cross_dismisses() {
        let mut app = world(Stage::None);
        let term = other_chat(&app);
        app.push_toast(toast(ToastKind::Failed, term, "Claude stopped", "h is paused there. Nothing is lost."));
        frame(&mut app);
        assert!(
            app.hits.iter().any(|(_, h)| *h == Hit::Screen(ScreenHit::ToastDismiss)),
            "the cross and the esc key are both clickable"
        );
        app.on_hy_hit(ScreenHit::ToastDismiss, false);
        assert!(app.toasts.is_empty());
    }
}
