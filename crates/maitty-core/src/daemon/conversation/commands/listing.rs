//! Naming, archiving and listing conversations.

use super::*;

impl Daemon {
    /// Name a conversation (empty: back to automatic), for every client at once.
    pub(in crate::daemon) fn conversation_rename(
        &mut self,
        id: ConversationId,
        title: &str,
    ) -> Result<()> {
        let conversation = self
            .conversations
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        conversation.title = clean_title(title);
        self.dirty = true;
        Ok(())
    }

    /// The window shows a finished chat: its done becomes idle, as a pane's does when the cursor
    /// rests on it. Anything else (working, needs you, a check holding it) is left as it is.
    pub(in crate::daemon) fn conversation_mark_seen(&mut self, id: ConversationId) {
        if let Some(state) = self.conversation_states.get_mut(&id)
            && state.status == Status::Done
        {
            state.status = Status::Idle;
            self.dirty = true;
        }
    }

    /// A person changes a running Claude or Codex chat's permissions (ADR 0005). The saved settings
    /// change at once, so a restart or a resume keeps them; the agent is handed them with the next
    /// message (`State::new_permissions`), since both providers take them per turn.
    pub(in crate::daemon) fn conversation_set_permissions(
        &mut self,
        id: ConversationId,
        generation: u64,
        permissions: crate::conversation::Permissions,
    ) -> Result<()> {
        use crate::conversation::{ExecutionKind, Provider};
        permissions.validate().map_err(anyhow::Error::msg)?;
        let conversation = self
            .conversations
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        anyhow::ensure!(
            conversation.generation == generation,
            "This chat changed since it was shown: look again and pick its permissions there"
        );
        anyhow::ensure!(
            conversation.execution == ExecutionKind::Structured
                && matches!(conversation.binding.provider, Provider::Claude | Provider::Codex),
            "Only a Claude or Codex chat's permissions can be changed here; this agent keeps its own"
        );
        let settings = conversation
            .settings
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("This chat has no launch settings to change"))?;
        let before = (settings.approval_policy, settings.sandbox);
        permissions.apply_to(settings);
        if (permissions.approval_policy, permissions.sandbox) != before {
            self.conversation_states.entry(id).or_default().new_permissions = Some(permissions);
            self.dirty = true;
        }
        Ok(())
    }

    /// Put a conversation away, or bring it back. It keeps running either way.
    pub(in crate::daemon) fn conversation_archive(
        &mut self,
        id: ConversationId,
        archived: bool,
    ) -> Result<()> {
        let conversation = self
            .conversations
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        conversation.archived = archived;
        self.dirty = true;
        Ok(())
    }

    pub(in crate::daemon) fn conversation_summaries(&self) -> Vec<ConversationSummary> {
        let mut summaries: Vec<_> = self
            .conversations
            .iter()
            .map(|c| {
                let state = self.conversation_states.get(&c.id);
                let native_term = self
                    .terms
                    .values()
                    .find(|term| term.conversation_id == Some(c.id));
                // Read for a chat session only: a native record has its pane, which carries this.
                let checkout = (c.execution == ExecutionKind::Structured)
                    .then(|| {
                        crate::gitfs::head(
                            c.binding.worktree.as_deref().unwrap_or(&c.binding.cwd),
                        )
                    })
                    .flatten();
                ConversationSummary {
                    id: c.id,
                    generation: c.generation,
                    provider: c.binding.provider,
                    execution: c.execution,
                    cwd: c.binding.cwd.clone(),
                    worktree: c.binding.worktree.clone(),
                    state: c.state,
                    status: self.listed_status(c, native_term),
                    native_term: native_term
                        .filter(|term| !term.process_exited)
                        .map(|term| term.id),
                    checks: state.map_or_else(Vec::new, |s| s.checks.infos()),
                    title: c.title.clone(),
                    archived: c.archived,
                    root: checkout.as_ref().map(|head| head.main_root.clone()),
                    branch: checkout.map(|head| head.branch),
                    helpers: state
                        .filter(|s| s.helpers_generation == c.generation)
                        .map_or_else(Vec::new, |s| s.helpers.clone()),
                    helper_ask: state.map_or_else(Vec::new, |s| s.helper_consent.asked.clone()),
                    capabilities: (c.execution == ExecutionKind::Structured)
                        .then(|| self.conversation_capabilities(c.binding.provider, c.id, c.generation))
                        .flatten(),
                    agent: c.binding.agent.clone(),
                    status_since: match native_term {
                        Some(term) if c.execution == ExecutionKind::Native => Some(term.status_since),
                        _ => self.conversation_since.get(&c.id).map(|(_, at)| *at),
                    },
                    interrupted: self.waits_after_cut(c.id),
                }
            })
            .collect();
        summaries.extend(self.followed.iter().filter_map(|f| {
            let term = self.terms.get(&f.term)?;
            Some(ConversationSummary {
                id: f.id,
                generation: f.generation,
                provider: f.provider,
                execution: ExecutionKind::Native,
                cwd: term.cwd.clone(),
                worktree: None,
                state: RecoveryState::Running,
                // The pane's own status; reading its transcript never changes it.
                status: term.status,
                native_term: Some(f.term),
                checks: Vec::new(),
                title: None,
                archived: false,
                root: None,
                branch: None,
                helpers: Vec::new(),
                helper_ask: Vec::new(),
                // The daemon only reads this pane's transcript; what the agent can do is the pane's.
                capabilities: None,
                agent: None,
                status_since: Some(term.status_since),
                interrupted: false,
            })
        }));
        summaries.extend(self.pending_starts.iter().map(|p| {
            ConversationSummary {
                id: p.id,
                generation: p.generation,
                provider: p.settings.provider,
                execution: ExecutionKind::Structured,
                cwd: p.settings.cwd.clone(),
                worktree: None,
                state: RecoveryState::RecoveryRequired,
                status: self.pending_status(p),
                native_term: None,
                checks: Vec::new(),
                title: None,
                archived: false,
                root: None,
                branch: None,
                helpers: Vec::new(),
                helper_ask: Vec::new(),
                // Not running yet, so nothing its provider's own run decides is known.
                capabilities: self.conversation_capabilities(p.settings.provider, p.id, p.generation),
                agent: p.settings.agent.clone(),
                status_since: self.conversation_since.get(&p.id).map(|(_, at)| *at),
                interrupted: false,
            }
        }));
        summaries
    }

    /// A conversation's status as the list reports it: its pane's for a native one, else its
    /// chat's, and needs-you for one that must be recovered. A chat a restart left asleep is idle:
    /// opening it starts it, and nothing about it needs the person.
    fn listed_status(
        &self,
        c: &crate::conversation::Conversation,
        native_term: Option<&crate::daemon::term::Term>,
    ) -> Status {
        let unrun = if c.state == RecoveryState::RecoveryRequired && !self.is_asleep(c.id) {
            Status::Blocked
        } else {
            Status::Idle
        };
        if c.execution == ExecutionKind::Native {
            native_term.map_or(unrun, |term| term.status)
        } else {
            self.conversation_states
                .get(&c.id)
                .map_or(unrun, |s| s.effective_status())
        }
    }

    fn pending_status(&self, p: &crate::conversation::PendingStart) -> Status {
        self.conversation_states
            .get(&p.id)
            .map_or(Status::Blocked, |s| s.status)
    }

    /// Stamps the time each chat's listed status changed, and forgets chats that are gone. A
    /// native conversation's pane keeps its own time, so only chats are stamped here.
    pub(in crate::daemon) fn note_conversation_status_times(&mut self) {
        let now = crate::daemon::term::unix_now();
        let listed: Vec<(ConversationId, Status)> = self
            .conversations
            .iter()
            .filter(|c| c.execution == ExecutionKind::Structured)
            .map(|c| (c.id, self.listed_status(c, None)))
            .chain(self.pending_starts.iter().map(|p| (p.id, self.pending_status(p))))
            .collect();
        self.conversation_since
            .retain(|id, _| listed.iter().any(|(listed_id, _)| listed_id == id));
        for (id, status) in listed {
            if self.conversation_since.get(&id).is_none_or(|(was, _)| *was != status) {
                self.conversation_since.insert(id, (status, now));
            }
        }
    }

    /// What a chat's provider can do. Whether it takes a message into a running turn is its
    /// live runtime's to say, so a chat that is not running claims it cannot.
    fn conversation_capabilities(
        &self,
        provider: Provider,
        id: ConversationId,
        generation: u64,
    ) -> Option<crate::conversation::capabilities::Capabilities> {
        let structured = crate::daemon::providers::adapter(provider).structured.as_ref()?;
        let mut capabilities = (structured.capabilities)(self.conversation_runtimes.can_steer(id, generation));
        if self.conversation_untested_cli.contains(&id) {
            capabilities.verified = crate::conversation::capabilities::Verified::Advertised;
        }
        Some(capabilities)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LONG_AGO: u64 = 1_000;

    fn daemon_with_chat() -> (Daemon, ConversationId) {
        let mut c = crate::test_support::conversation();
        c.execution = ExecutionKind::Structured;
        let id = c.id;
        let (tx, _rx) = tokio::sync::mpsc::channel(1);
        let mut d = Daemon::new(crate::config::Config::default(), tx, || {});
        d.conversations.push(c);
        d.conversation_states.entry(id).or_default().status = Status::Working;
        (d, id)
    }

    fn since(d: &Daemon, id: ConversationId) -> Option<u64> {
        d.conversation_summaries().into_iter().find(|s| s.id == id).and_then(|s| s.status_since)
    }

    #[test]
    fn a_chat_keeps_its_status_time_until_the_status_changes() {
        let (mut d, id) = daemon_with_chat();
        assert_eq!(since(&d, id), None, "not stamped before it is first listed");

        d.note_conversation_status_times();
        d.conversation_since.insert(id, (Status::Working, LONG_AGO));
        d.note_conversation_status_times();
        assert_eq!(since(&d, id), Some(LONG_AGO), "the same status keeps its time");

        d.conversation_states.entry(id).or_default().status = Status::Done;
        d.note_conversation_status_times();
        assert!(since(&d, id).is_some_and(|at| at > LONG_AGO), "a new status is stamped now");
    }

    #[test]
    fn a_chat_that_is_gone_is_forgotten() {
        let (mut d, _) = daemon_with_chat();
        d.note_conversation_status_times();
        d.conversations.clear();
        d.note_conversation_status_times();
        assert!(d.conversation_since.is_empty());
    }
}
