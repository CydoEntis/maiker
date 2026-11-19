//! Recent sessions: the agent sessions that closed or crashed on this computer, as its daemon keeps
//! them (`Query::ClosedSessions`), newest first. Picking one asks the daemon to start it again with
//! its conversation (`Command::ReopenClosedSession`); the daemon makes a removed worktree again
//! from what it recorded, so nothing typed here names a path or a branch.

use super::*;
use crate::protocol::ClosedSession;

/// The menu's title; a reply fills only a menu with this title still waiting for it.
const TITLE: &str = "recent sessions";

/// How many closed sessions the menu offers.
const LISTED: usize = 12;

/// The widest a row's label is drawn.
const LABEL_MAX: usize = 46;

/// The agents whose conversations the daemon resumes.
const RESUMABLE: [(&str, &str); 2] = [("claude", "Claude"), ("codex", "Codex")];

impl App {
    /// Ask this computer's daemon for the sessions that closed lately.
    pub(super) fn ask_closed_sessions(&mut self) {
        let ask = ClientMsg::Query(Query::ClosedSessions);
        // An older daemon passes over a request it cannot read and never answers.
        if ask.introduced_in() > self.local_protocol {
            return self.notify("restart the daemon to list recent sessions".into(), true);
        }
        self.send(MachineId::LOCAL, ask);
        let at = self.menu_at_focus();
        self.menu(TITLE.into(), vec![("looking for closed sessions…".into(), menu::Act::Waiting)], at);
    }

    /// Where a menu about the focused pane opens: its top-left corner, else the screen's.
    fn menu_at_focus(&self) -> (u16, u16) {
        let focus = self.focused();
        self.pane_frames
            .iter()
            .find(|(t, _)| Some(*t) == focus)
            .map_or((2, 2), |(_, r)| (r.x + 2, r.y))
    }

    /// The daemon's list: it opens the menu that waits for it, and is dropped once that menu closed.
    pub(super) fn closed_sessions_arrived(&mut self, mut list: Vec<ClosedSession>) {
        let Mode::ScreenMenu(m) = &self.mode else {
            if let Some(term) = self.screen.restart_asked.take() {
                self.restart_from_closed(term, &list);
            }
            return;
        };
        if m.title != TITLE || !matches!(m.items.as_slice(), [(_, menu::Act::Waiting)]) {
            return;
        }
        let at = m.at;
        if list.is_empty() {
            self.mode = Mode::Normal;
            return self.notify("no closed sessions to reopen".into(), false);
        }
        list.sort_by_key(|c| std::cmp::Reverse(c.at));
        let items = list
            .into_iter()
            .take(LISTED)
            .map(|c| {
                let act = if agent_name(&c.agent).is_some() {
                    menu::Act::Reopen(c.agent.clone(), c.session.clone())
                } else {
                    menu::Act::Waiting
                };
                (row_label(&c), act)
            })
            .collect();
        self.menu(TITLE.into(), items, at);
    }

    /// Start a closed session again with its conversation; the daemon answers with the new pane.
    pub(super) fn reopen_closed(&mut self, agent: String, session: String) {
        let ask = ClientMsg::Command(Command::ReopenClosedSession { agent, session });
        if ask.introduced_in() > self.local_protocol {
            return self.notify("restart the daemon to reopen a closed session".into(), true);
        }
        self.send(MachineId::LOCAL, ask);
        self.notify("reopening the session…".into(), false);
    }
}

fn agent_name(agent: &str) -> Option<&'static str> {
    RESUMABLE.iter().find(|(id, _)| *id == agent).map(|(_, name)| *name)
}

/// `Claude · 3h ago · add export · dsa-tool ⑂ feat/export`, or `… · can't be reopened` for an
/// agent whose conversation the daemon does not resume.
pub(super) fn row_label(c: &ClosedSession) -> String {
    let who = agent_name(&c.agent).map_or_else(|| crate::hidden::sanitize(&c.agent, false), str::to_string);
    let folder = super::screen::folder_name(c.repo.as_deref().unwrap_or(&c.cwd));
    let mut label = format!("{who} · {} ago", super::screen::age(c.at));
    if agent_name(&c.agent).is_none() {
        label.push_str(" · can't be reopened");
    }
    if let Some(title) = c.title.as_ref().map(|t| crate::hidden::sanitize(t, false)).filter(|t| !t.is_empty()) {
        label.push_str(&format!(" · {title}"));
    }
    label.push_str(&format!(" · {folder}"));
    if let Some(branch) = c.branch.as_ref().filter(|b| !b.is_empty()) {
        label.push_str(&format!(" ⑂ {}", crate::hidden::sanitize(branch, false)));
    }
    super::render::truncate(&label, LABEL_MAX)
}
