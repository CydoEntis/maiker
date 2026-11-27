//! Helpers past the limit wait for a free slot instead of being refused.
//!
//! `[sessions] helpers_at_once` bounds how many of one session's helpers work at once. A start
//! past it is answered as a success: the helper's pane and row are made at once, as a plain
//! shell in its folder, and the daemon holds the command that starts its agent. The daemon alone
//! reports that row working (ADR 0003: its own hold is a source of working, before any agent
//! runs), and marks it `TermInfo.waiting_for_slot`. When one of the starter's helpers stops
//! working or closes, or the limit is raised, the oldest waiting one is started: its command is
//! typed into its shell, the same line the shell would have been started with, so the session
//! keeps the number its starter was told.
//!
//! Consent comes first (ADR 0016): a start that is refused or still being asked about never
//! gets here. A waiting helper whose starter is gone is cancelled, since nothing ran and nobody
//! would read its result. A chat started as a helper is not held: it is refused at the limit.

use super::helpers::Starter;
use super::term::{HeldMessage, Term};
use super::{ClientId, Daemon, RemovalReason, status::queued_as_typed};
use crate::protocol::{Status, TermId};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

/// Most helpers one session has waiting. Each has a pane, and a worktree made up front, before
/// any work starts: past this a start is refused, so an agent cannot fill the machine.
pub(super) const MOST_WAITING: usize = 12;
/// How long a held pane's shell is given to reach its prompt before a command is typed into it.
/// Typed sooner, a long line is cut short by the terminal's own line buffer.
const HELD_SHELL_SETTLES: Duration = Duration::from_secs(2);
/// Most text kept for a waiting helper's agent: what one write to a pane may carry, a few times.
const HELD_TEXT_MAX_BYTES: usize = 64 * 1024;
/// What a pasted block starts and ends with (bracketed paste).
const PASTE_MARKS: [&str; 2] = ["\x1b[200~", "\x1b[201~"];

/// A helper's start, held until its starter has a free slot. Saved with the session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Waiting {
    /// The command that starts it, as it was asked for; none for a plain shell.
    pub cmd: Option<String>,
    /// Its place in line among every waiting helper: lower started waiting earlier.
    pub order: u64,
}

/// Whether the daemon holds this pane's start for a free slot: the one answer the wire's
/// `TermInfo.waiting_for_slot` is made from.
pub(super) fn waiting_for_slot(t: &Term) -> bool {
    t.waiting.is_some()
}

/// Whether `cmd` can be typed into a shell as it stands. A control character other than a line
/// break would be read as a key (a tab completes, an escape starts a sequence) and change the
/// line, so such a command is never held.
fn types_as_written(cmd: &str) -> bool {
    !cmd.chars().any(|c| c.is_control() && c != '\n')
}

fn starter_of(t: &Term) -> Option<Starter> {
    t.started_by
        .map(Starter::Pane)
        .or(t.started_by_chat.map(Starter::Chat))
}

/// What a waiting helper's row says of itself, to its starter's agent (`<app>_list`) and in the
/// why popover.
fn waiting_line(place: usize, waiting: usize, most: usize) -> String {
    format!(
        "waiting for a free slot: {place} of {waiting} in line, {most} helpers at once is the limit"
    )
}

impl Daemon {
    /// `by`'s waiting helpers, the one that waited longest first.
    fn waiting_helpers(&self, by: Starter) -> Vec<TermId> {
        let mut waiting: Vec<(u64, TermId)> = self
            .terms
            .values()
            .filter(|t| starter_of(t) == Some(by))
            .filter_map(|t| t.waiting.as_ref().map(|w| (w.order, t.id)))
            .collect();
        waiting.sort_unstable();
        waiting.into_iter().map(|(_, term)| term).collect()
    }

    fn starter_is_here(&self, by: Starter) -> bool {
        match by {
            Starter::Pane(term) => self.terms.contains_key(&term),
            Starter::Chat(id) => self.conversations.iter().any(|record| record.id == id),
        }
    }

    /// Whether a helper `by` starts now waits for a slot: its starter is at the limit, or has
    /// others waiting that go first. An error is what the agent reads when no more may wait, or
    /// when `cmd` cannot be held. A start whose worktree is already made was let through when it
    /// was asked for and is never refused now, which would strand that worktree: past the cap it
    /// still waits, and a command that cannot be held starts at once.
    pub(super) fn must_wait(&self, by: Starter, cmd: Option<&str>) -> Result<bool> {
        let most = self.cfg.helpers_at_once();
        let waiting = self.waiting_helpers(by).len();
        let busy = self.busy_helpers(by, None);
        if busy < most && waiting == 0 {
            return Ok(false);
        }
        if self.starting_in_made_worktree {
            return Ok(cmd.is_none_or(types_as_written));
        }
        if waiting >= MOST_WAITING {
            anyhow::bail!(
                "{waiting} helpers are already waiting for a free slot, and {most} at once is the limit (Settings, Sessions). Wait for some to finish, then start this one."
            );
        }
        if cmd.is_some_and(|cmd| !types_as_written(cmd)) {
            anyhow::bail!(
                "{busy} helpers are already working, and {most} at once is the limit (Settings, Sessions). Wait for one to finish, then start this one."
            );
        }
        Ok(true)
    }

    /// Hold the start of `term`, a pane just made as a plain shell: `cmd` is what would have
    /// started it.
    pub(super) fn hold_start(&mut self, term: TermId, cmd: Option<&str>) {
        let order = self
            .terms
            .values()
            .filter_map(|t| t.waiting.as_ref().map(|w| w.order + 1))
            .max()
            .unwrap_or(0);
        let cmd = cmd
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(str::to_string);
        self.hold(term, Waiting { cmd, order });
    }

    /// Mark `term` as waiting. Its status is the daemon's from here until it starts: the row
    /// reads as the agent it will be, working, though only a shell runs in it.
    pub(super) fn hold(&mut self, term: TermId, waiting: Waiting) {
        let agent = waiting
            .cmd
            .as_deref()
            .and_then(|cmd| self.agent_in_cmd(cmd));
        // Named as it will be once it starts (`Daemon::name_after_task`); its summary is its
        // place in line meanwhile.
        let task = waiting
            .cmd
            .as_deref()
            .filter(|_| agent.is_some())
            .and_then(super::helpers::task_title);
        let Some(t) = self.terms.get_mut(&term) else {
            return;
        };
        tracing::info!("pane {term}: its start is held for a free slot");
        t.began_as_agent = agent.is_some();
        t.agent = agent;
        if let Some(task) = task {
            t.first_prompt = task;
        }
        t.waiting = Some(waiting);
        // Not through `set_status`: no turn starts here, so there is nothing to snapshot,
        // count or announce.
        let why = t.status_why.clone();
        t.write_status(Status::Working, &why);
        self.dirty = true;
        self.say_places_in_line();
    }

    /// Keep each waiting helper's own line true as the line moves.
    fn say_places_in_line(&mut self) {
        let most = self.cfg.helpers_at_once();
        let mut starters: Vec<Starter> = Vec::new();
        for by in self
            .terms
            .values()
            .filter(|t| t.waiting.is_some())
            .filter_map(starter_of)
        {
            if !starters.contains(&by) {
                starters.push(by);
            }
        }
        for by in starters {
            let line = self.waiting_helpers(by);
            for (at, term) in line.iter().enumerate() {
                let says = waiting_line(at + 1, line.len(), most);
                if let Some(t) = self.terms.get_mut(term)
                    && t.status_why != says
                {
                    t.summary = says.clone();
                    t.status_why = says;
                    self.dirty = true;
                }
            }
        }
    }

    /// On the tick, and when the limit changes: cancel the waiting helpers whose starter is
    /// gone, then start as many of each starter's as it has room for, in the order they came.
    /// Lowering the limit stops nothing; it only keeps the next one waiting.
    pub(super) fn start_waiting_helpers(&mut self) {
        let waiting: Vec<(TermId, Option<Starter>)> = self
            .terms
            .values()
            .filter(|t| t.waiting.is_some())
            .map(|t| (t.id, starter_of(t)))
            .collect();
        if waiting.is_empty() {
            return;
        }
        let mut starters: Vec<Starter> = Vec::new();
        for (term, by) in waiting {
            match by.filter(|by| self.starter_is_here(*by)) {
                Some(by) if !starters.contains(&by) => starters.push(by),
                Some(_) => {}
                None => self.cancel_waiting(term),
            }
        }
        let most = self.cfg.helpers_at_once();
        for by in starters {
            for term in self.waiting_helpers(by) {
                let settled = self
                    .terms
                    .get(&term)
                    .is_some_and(|t| t.born.elapsed() >= HELD_SHELL_SETTLES);
                // In order: one that is not ready keeps the ones behind it waiting too.
                if self.busy_helpers(by, None) >= most || !settled {
                    break;
                }
                self.start_held(term);
            }
        }
        self.say_places_in_line();
    }

    /// A waiting helper nobody waits for: nothing ran in it, so it and its unused worktree go.
    fn cancel_waiting(&mut self, term: TermId) {
        if let Some(t) = self.terms.get(&term)
            && let Some(held) = &t.held_message
        {
            tracing::warn!(
                "pane {term}: cancelled while waiting for a free slot, so the {} bytes held for its agent are dropped",
                held.text.len()
            );
        }
        tracing::info!("pane {term}: cancelled, the session that started it is gone");
        let tops = self.worktrees_of(&[term]);
        self.end_term(term, RemovalReason::Closed);
        // No client asked for this, so there is none to tell what became of the worktree.
        self.cleanup_worktrees(ClientId::MAX, tops);
    }

    /// A slot is free: start `term`. The hold is let go before anything is typed, and saved
    /// so, so a restart cannot start it a second time.
    fn start_held(&mut self, term: TermId) {
        let Some(waiting) = self.terms.get_mut(&term).and_then(|t| t.waiting.take()) else {
            return;
        };
        // The line the shell would have been started with (`Daemon::spawn`): the account's
        // wrapper around the taught command.
        let start = waiting.cmd.as_deref().map(|cmd| {
            let (account, inner) = self.cfg.split_account(cmd);
            let taught = self.teach(inner);
            let line = match account.as_deref() {
                Some(account) => self.cfg.as_account(account, &taught),
                None => taught,
            };
            (account, self.agent_in_cmd(inner), line)
        });
        let Some(t) = self.terms.get_mut(&term) else {
            return;
        };
        tracing::info!("pane {term}: a slot is free, starting it");
        // From here it is a session just started: it counts as working until its agent
        // reports, and its agent is given the usual time to show.
        t.born = Instant::now();
        t.write_status(Status::None, "");
        t.summary.clear();
        t.first_prompt.clear();
        let mut repair = None;
        if let Some((account, agent, line)) = start {
            let typed = queued_as_typed(&line, t.parser.screen().bracketed_paste());
            t.input(format!("{typed}\r").as_bytes());
            t.cmd = Some(line);
            t.began_as_agent = agent.is_some();
            if agent.as_deref() == Some("claude") {
                repair = Some(account.clone());
            }
            t.account = account;
        }
        if let Some(account) = repair {
            self.repair_hooks_for_spawn(term, account.as_deref());
        }
        self.name_after_task(term, waiting.cmd.as_deref());
        self.dirty = true;
        self.persist(true);
    }

    /// Text an agent sends to a waiting helper is kept for the helper's agent, and typed once
    /// that agent takes input: typed now it would be run by the shell. True when `data` was
    /// taken here; an error when no more can be kept. A person's own keys are theirs to type.
    pub(super) fn keeps_for_waiting(
        &mut self,
        client: ClientId,
        term: TermId,
        data: &[u8],
    ) -> Result<bool> {
        let from_an_agent = self
            .clients
            .get(&client)
            .is_some_and(|c| c.from.is_some() || c.structured.is_some());
        let Some(t) = self
            .terms
            .get_mut(&term)
            .filter(|t| from_an_agent && t.waiting.is_some())
        else {
            return Ok(false);
        };
        let mut text = String::from_utf8_lossy(data).into_owned();
        for mark in PASTE_MARKS {
            text = text.replace(mark, "");
        }
        let text = text.trim();
        // The Enter that follows a message is the send, which the hold already stands for.
        if text.is_empty() {
            return Ok(true);
        }
        let kept = t.held_message.as_ref().map_or(0, |held| held.text.len());
        anyhow::ensure!(
            kept + text.len() < HELD_TEXT_MAX_BYTES,
            "session {term} is waiting for a free slot and has not started; it already holds as much text as it can keep. Send this once it has started."
        );
        let all = match &t.held_message {
            Some(held) => format!("{}\n{text}", held.text),
            None => text.to_string(),
        };
        t.held_message = Some(HeldMessage::new(&all));
        self.dirty = true;
        Ok(true)
    }
}
