//! A session asks to start helpers. Its row turns "needs you" with the line "wants to start N
//! helpers"; Enter on the row (or a click on the line) opens this popover beside it, the
//! screen dimmed except that row. 1 allows, 2 allows in this project for good, 3 says do it
//! alone, Esc decides later and the row stays as it is. Enter, y and Space do nothing, so a
//! stray key cannot hand an agent helpers. The daemon holds the request and takes the answer
//! only from here (`Command::AnswerHelpers`).
//!
//! A chat with no terminal asks the same way (ADR 0016): its row opens the same popover, and the
//! answer is `Command::AnswerChatHelpers`.

use super::*;
use crate::protocol::{ClientMsg, HelperChoice};

const POP_W: u16 = 64;
/// The most tasks listed; the rest are counted.
const TASKS_LISTED: usize = 5;
const NO_REFLEX: &str = "Enter does nothing here. Choose 1, 2 or 3.";

/// Who asks to start helpers: a terminal session, or a chat that has no terminal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum Asker {
    Pane(ClientTerm),
    Chat(ClientSession),
}

/// A row's second line while its session asks for helpers.
pub(in crate::client) fn helpers_line(n: usize) -> String {
    format!("wants to start {n} helper{}", if n == 1 { "" } else { "s" })
}

impl App {
    /// Whether session `term` has asked to start helpers and waits for you.
    pub(in crate::client) fn helpers_asked(&self, term: ClientTerm) -> bool {
        self.term_info(term)
            .is_some_and(|t| !t.helper_ask.is_empty())
    }

    fn chat_summary(&self, chat: ClientSession) -> Option<&crate::protocol::ConversationSummary> {
        let SessionKey::Conversation(id) = chat.key else {
            return None;
        };
        self.snap_of(chat.machine)?.conversations.iter().find(|c| c.id == id)
    }

    /// Whether chat `chat` has asked to start helpers and waits for you.
    pub(in crate::client) fn chat_helpers_asked(&self, chat: ClientSession) -> bool {
        self.chat_summary(chat).is_some_and(|c| !c.helper_ask.is_empty())
    }

    /// Open the question beside the chat's row; `side`: back to the sidebar after.
    pub(in crate::client) fn open_chat_helpers(&mut self, chat: ClientSession, side: bool) {
        if self.chat_helpers_asked(chat) {
            self.screen.inbox_return = None;
            self.mode = Mode::ChatHelpers { chat, side };
        }
    }

    /// Send your answer for a chat, say what it did, and close the question.
    pub(in crate::client) fn answer_chat_helpers(&mut self, chat: ClientSession, choice: HelperChoice) {
        let Mode::ChatHelpers { side, .. } = self.mode else {
            return;
        };
        let (SessionKey::Conversation(conversation), true) = (chat.key, self.chat_helpers_asked(chat)) else {
            self.helpers_back(side);
            return;
        };
        let ask = ClientMsg::Command(Command::AnswerChatHelpers { conversation, choice });
        // This computer's service may be older than this window. Another machine's listed the
        // request, so it reads the answer.
        if chat.machine == MachineId::LOCAL && ask.introduced_in() > self.local_protocol {
            self.helpers_back(side);
            self.notify(
                concat!("the ", env!("APP_NAME"), " service is older than this window: restart it to answer").into(),
                true,
            );
            return;
        }
        let who = self.asker_name(Asker::Chat(chat));
        self.send(chat.machine, ask);
        self.helpers_back(side);
        self.notify(helpers_said(&who, choice), false);
    }

    pub(in crate::client) fn on_chat_helpers_key(&mut self, chat: ClientSession, side: bool, k: &KeyEvent) {
        let plain = !k
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
        match k.code {
            KeyCode::Esc => self.helpers_back(side),
            KeyCode::Char('1') if plain => self.answer_chat_helpers(chat, HelperChoice::Allow),
            KeyCode::Char('2') if plain => self.answer_chat_helpers(chat, HelperChoice::Always),
            KeyCode::Char('3') if plain => self.answer_chat_helpers(chat, HelperChoice::No),
            KeyCode::Enter | KeyCode::Char('y' | ' ') => self.notify(NO_REFLEX.into(), false),
            _ => {}
        }
    }

    /// The asker's name as its row says it.
    fn asker_name(&self, asker: Asker) -> String {
        match asker {
            Asker::Pane(term) => self.session_name(term),
            Asker::Chat(chat) => self
                .screen_model()
                .iter()
                .flat_map(|p| p.sessions())
                .find(|s| s.key == chat)
                .map(|s| s.name.clone())
                .unwrap_or_default(),
        }
    }

    /// The agent that asks and the tasks it wants helpers for; none when it is not asking.
    fn asker_request(&self, asker: Asker) -> Option<(String, Vec<String>)> {
        let (agent, tasks) = match asker {
            Asker::Pane(term) => {
                let info = self.term_info(term)?;
                (info.agent.clone().unwrap_or_else(|| "agent".into()), info.helper_ask.clone())
            }
            Asker::Chat(chat) => {
                let summary = self.chat_summary(chat)?;
                (format!("{:?}", summary.provider).to_lowercase(), summary.helper_ask.clone())
            }
        };
        (!tasks.is_empty()).then_some((agent, tasks))
    }

    /// Open the question beside `term`'s row; `side`: back to the sidebar after.
    pub(in crate::client) fn open_helpers(&mut self, term: ClientTerm, side: bool) {
        if self.helpers_asked(term) {
            self.screen.inbox_return = None;
            self.mode = Mode::Helpers { term, side };
        }
    }

    /// Open the question from the Inbox's row `sel` (typed `query`): closing it, or answering,
    /// goes back to the Inbox on that row.
    pub(in crate::client) fn open_helpers_from_inbox(
        &mut self,
        term: ClientTerm,
        query: String,
        sel: usize,
    ) {
        self.open_helpers(term, false);
        if matches!(self.mode, Mode::Helpers { .. }) {
            self.screen.inbox_return = Some((query, sel));
        }
    }

    fn helpers_back(&mut self, side: bool) {
        self.mode = match self.screen.inbox_return.take() {
            Some((query, sel)) => Mode::GoTo { query, sel },
            None if side => Mode::Side,
            None => Mode::Normal,
        };
    }

    /// Send your answer, say what it did, and close the question.
    pub(in crate::client) fn answer_helpers(&mut self, term: ClientTerm, choice: HelperChoice) {
        let Mode::Helpers { side, .. } = self.mode else {
            return;
        };
        if !self.helpers_asked(term) {
            self.helpers_back(side);
            return;
        }
        let who = self.session_name(term);
        self.send(
            term.machine,
            ClientMsg::Command(Command::AnswerHelpers {
                term: term.term,
                choice,
            }),
        );
        self.helpers_back(side);
        self.notify(helpers_said(&who, choice), false);
    }

    pub(in crate::client) fn on_helpers_key(&mut self, term: ClientTerm, side: bool, k: &KeyEvent) {
        let plain = !k
            .modifiers
            .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
        match k.code {
            KeyCode::Esc => self.helpers_back(side),
            KeyCode::Char('1') if plain => self.answer_helpers(term, HelperChoice::Allow),
            KeyCode::Char('2') if plain => self.answer_helpers(term, HelperChoice::Always),
            KeyCode::Char('3') if plain => self.answer_helpers(term, HelperChoice::No),
            KeyCode::Enter | KeyCode::Char('y' | ' ') => self.notify(NO_REFLEX.into(), false),
            _ => {}
        }
    }
}

/// What the toast says once you answered.
fn helpers_said(who: &str, choice: HelperChoice) -> String {
    match choice {
        HelperChoice::Allow => format!("{who} may start helpers"),
        HelperChoice::Always => format!("helpers may always start here · {who} is starting them"),
        HelperChoice::No => format!("{who} will do it alone"),
    }
}

pub(in crate::client) fn draw_helpers_pop(
    app: &mut App,
    buf: &mut Buffer,
    screen: Rect,
    side: Rect,
    asker: Asker,
    t: &Theme,
) {
    let Some((agent, tasks)) = app.asker_request(asker) else {
        return;
    };
    let row = match asker {
        Asker::Pane(term) => app.session_key(term),
        Asker::Chat(chat) => chat,
    };
    let answer = |choice: HelperChoice| match asker {
        Asker::Pane(term) => ScreenHit::HelperAnswer(term, choice),
        Asker::Chat(chat) => ScreenHit::ChatHelperAnswer(chat, choice),
    };
    let x0 = side.right() + 1;
    let w = POP_W.min(screen.right().saturating_sub(x0 + 1));
    if w < 30 {
        return;
    }
    let iw = w as usize - 4;
    let n = tasks.len();
    let intro = wrap(
        &format!(
            "{agent} wants to split this into {n} helper{}, each in its own worktree:",
            if n == 1 { "" } else { "s" }
        ),
        iw,
    );
    let listed = n.min(TASKS_LISTED);
    let more = n - listed;
    let note = wrap(
        "Their permission prompts come to your Inbox. Nothing merges.",
        iw,
    );
    let h =
        (1 + 1 + intro.len() + listed + usize::from(more > 0) + 1 + note.len() + 1 + 1 + 1) as u16;

    let (r, _) = frame_beside_row(app, buf, screen, side, row, (x0, w, h), t);
    let card = Style::default().bg(t.card);
    let name = app.asker_name(asker);
    put(
        buf,
        r.x + 2,
        r.y,
        &[
            seg(
                " START HELPERS? ",
                Style::default()
                    .fg(t.acc_ink)
                    .bg(t.accent)
                    .add_modifier(Modifier::BOLD),
            ),
            seg(format!("· {name} "), card.fg(t.muted)),
        ],
        r.right() - 2,
    );
    let later = " Esc later ";
    put(
        buf,
        (r.right() - 2).saturating_sub(later.width() as u16),
        r.y,
        &[seg(later, card.fg(t.muted))],
        r.right() - 2,
    );

    let (x, right) = (r.x + 2, r.right() - 2);
    let mut y = r.y + 2;
    for l in &intro {
        put(buf, x, y, &[seg(l.clone(), card.fg(t.text))], right);
        y += 1;
    }
    for task in tasks.iter().take(listed) {
        put(
            buf,
            x,
            y,
            &[
                seg("  · ", card.fg(t.muted)),
                seg(truncate(task, iw.saturating_sub(4)), card.fg(t.strong)),
            ],
            right,
        );
        y += 1;
    }
    if more > 0 {
        put(
            buf,
            x,
            y,
            &[seg(format!("  + {more} more"), card.fg(t.muted))],
            right,
        );
        y += 1;
    }
    y += 1;
    for l in &note {
        put(buf, x, y, &[seg(l.clone(), card.fg(t.muted))], right);
        y += 1;
    }
    y += 1;
    let project = app
        .screen_model()
        .iter()
        .find(|p| p.sessions().any(|s| s.key == row))
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "this project".into());
    // The full words if the three buttons fit side by side, else shorter ones.
    let named = format!("Always in {}", truncate(&project, 14));
    let tiers = [
        (named.as_str(), "No, do it alone"),
        ("Always here", "No, do it alone"),
        ("Always", "No, alone"),
    ];
    let fits = |(always, no): &(&str, &str)| {
        let width =
            |label: &str, key: &str| segs_width(&button(t, label, key, BtnKind::Normal)) as usize;
        width("Allow", "1") + width(always, "2") + width(no, "3") + 2 <= iw
    };
    let (always, no) = tiers.iter().find(|tier| fits(tier)).unwrap_or(&tiers[2]);
    let mut bx = btn(
        app,
        buf,
        x,
        y,
        "Allow",
        "1",
        BtnKind::Primary,
        answer(HelperChoice::Allow),
        right,
    ) + 1;
    bx = btn(
        app,
        buf,
        bx,
        y,
        always,
        "2",
        BtnKind::Normal,
        answer(HelperChoice::Always),
        right,
    ) + 1;
    btn(
        app,
        buf,
        bx,
        y,
        no,
        "3",
        BtnKind::Normal,
        answer(HelperChoice::No),
        right,
    );
}
