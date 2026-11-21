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
                    status: if c.execution == ExecutionKind::Native {
                        native_term.map_or_else(
                            || {
                                if c.state == RecoveryState::RecoveryRequired {
                                    Status::Blocked
                                } else {
                                    Status::Idle
                                }
                            },
                            |term| term.status,
                        )
                    } else {
                        state.map_or(
                            if c.state == RecoveryState::RecoveryRequired {
                                Status::Blocked
                            } else {
                                Status::Idle
                            },
                            |s| s.effective_status(),
                        )
                    },
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
                status: self
                    .conversation_states
                    .get(&p.id)
                    .map_or(Status::Blocked, |s| s.status),
                native_term: None,
                checks: Vec::new(),
                title: None,
                archived: false,
                root: None,
                branch: None,
                helpers: Vec::new(),
            }
        }));
        summaries
    }
}
