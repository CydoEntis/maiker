//! Reading history: hydration from the provider and replies to a read.

use super::*;

fn history_source(provider: Provider) -> Option<crate::daemon::providers::HistorySource> {
    crate::daemon::providers::adapter(provider)
        .structured
        .as_ref()
        .map(|structured| structured.history)
}

/// Marks the last turn stopped when its transcript ends before the turn did, as a turn the daemon
/// or the agent went away in does: read back, it would otherwise show as still running.
fn stop_open_turn(history: &mut History) -> Result<()> {
    let Some(turn) = history.entries.last().map(|entry| entry.source.turn.clone()) else {
        return Ok(());
    };
    let ended = history.entries.iter().any(|entry| {
        entry.source.turn == turn
            && entry.content == history::Content::TurnStatus
            && entry.state != history::ItemState::Running
    });
    if ended {
        return Ok(());
    }
    history
        .apply(history::Update::SetTurnStatus {
            turn,
            state: history::ItemState::Interrupted,
            started_at_ms: None,
            completed_at_ms: None,
        })
        .map_err(|reason| anyhow::anyhow!("Could not mark the cut turn stopped: {reason:?}"))
}

/// Whether the provider is never asked for its saved history: what the daemon holds is used.
fn reads_transcript(provider: Provider) -> bool {
    history_source(provider).is_some_and(|source| source != crate::daemon::providers::HistorySource::Provider)
}

impl Daemon {
    pub(in crate::daemon) fn begin_hydration(
        &mut self,
        id: ConversationId,
        generation: u64,
        read: Option<ReadRequest>,
        started: Option<ClientId>,
    ) -> Result<()> {
        let c = self
            .conversations
            .iter()
            .find(|c| c.id == id && c.generation == generation)
            .ok_or_else(|| anyhow::anyhow!("No current conversation"))?;
        if reads_transcript(c.binding.provider) {
            return self.begin_claude_history_hydration(id, generation, read, started);
        }
        let session = c.binding.session_id.clone();
        let mut history = History::new(id);
        history.revision = self
            .conversation_states
            .get(&id)
            .map_or(1, |s| s.history_revision.max(1));
        history.set_completeness(Completeness::Loading)?;
        let token = self.conversation_token(Pending::Hydration {
            id,
            generation,
            history,
            cursors: BTreeSet::new(),
            read,
            started,
            changed: false,
            bytes: 0,
        })?;
        let asked = self.conversation_runtimes.request(
            id,
            generation,
            token,
            Rpc::ReadHistory { session, cursor: None, limit: history::MAX_READ_ENTRIES },
        );
        // A read that never reached a runtime (none runs) must not stay pending: it would hold off
        // the start that brings the runtime back.
        if asked.is_err() {
            self.conversation_requests.remove(&token);
        }
        asked
    }

    pub(super) fn begin_claude_history_hydration(
        &mut self,
        id: ConversationId,
        generation: u64,
        read: Option<ReadRequest>,
        started: Option<ClientId>,
    ) -> Result<()> {
        let Some(conversation) = self.conversations.iter().find(|conversation| {
            conversation.id == id
                && conversation.generation == generation
                && reads_transcript(conversation.binding.provider)
        }) else {
            bail!("Claude conversation identity changed during history hydration");
        };
        let recorded = history_source(conversation.binding.provider)
            == Some(crate::daemon::providers::HistorySource::Recorded);
        if conversation.awaiting_first_user_message {
            self.complete_empty_thread(id)?;
            if let Some(client) = started {
                self.send(
                    client,
                    ServerMsg::Reply(Reply::ConversationStarted { id, generation }),
                );
            }
            if let Some(read) = read {
                if self.conversation_history.get(read.client).is_none() {
                    self.conversation_history.attach(read.client, id);
                    let history = self
                        .conversation_histories
                        .get(&id)
                        .cloned()
                        .unwrap_or_else(|| History::new(id));
                    self.conversation_history
                        .hydrate_native(read.client, history)
                        .map_err(|reason| {
                            anyhow::anyhow!("Claude empty history hydration failed: {reason:?}")
                        })?;
                }
                self.reply_history(id, read)?;
            }
            return Ok(());
        }

        let is_currently_reconciled = self
            .conversation_states
            .get(&id)
            .is_some_and(|state| state.history_ready)
            && self.conversation_runtimes.owns(id);
        // Claude's transcript is the chat's whole past, so a chat the daemon no longer holds in step
        // with it (a restart, a stop, an agent gone mid-turn or between turns) is read again from it
        // instead of refused. It is what the agent itself resumes from.
        if let (Some(client), None) = (started, &read)
            && !recorded
            && !is_currently_reconciled
        {
            return self.begin_saved_history(id, generation, client);
        }
        let (history, is_complete) = if recorded {
            recorded_history(id, self.conversation_histories.get(&id))?
        } else {
            cached_claude_history(id, self.conversation_histories.get(&id), is_currently_reconciled)?
        };
        let attachment = read.as_ref().map(|read| read.client).or(started);
        if let Some(client) = attachment {
            if self.conversation_history.get(client).is_none() {
                self.conversation_history.attach(client, id);
            }
            self.conversation_history
                .hydrate_native(client, history.clone())
                .map_err(|reason| {
                    anyhow::anyhow!("Claude history attachment failed: {reason:?}")
                })?;
        }
        let state = self.conversation_states.entry(id).or_default();
        state.history_ready = is_complete && history.completeness == Completeness::Complete;
        if !state.history_ready {
            state.status = Status::Blocked;
            // A reason already kept (why a saved history could not be read) is the real one.
            state.error.get_or_insert_with(|| if recorded {
                "No history was kept for this conversation, so it cannot be continued; chat resume is disabled".into()
            } else {
                "Claude history could not be reconciled with the provider transcript; chat resume is disabled".into()
            });
        }
        if let Some(read) = read {
            self.reply_history(id, read)?;
        }
        if let Some(client) = started {
            if self
                .conversation_states
                .get(&id)
                .is_some_and(|state| state.history_ready)
            {
                self.send(
                    client,
                    ServerMsg::Reply(Reply::ConversationStarted { id, generation }),
                );
                self.continue_cut_turn(client, id, generation);
            } else {
                self.send(
                    client,
                    ServerMsg::Error(
                        "Claude history is incomplete; chat resume is disabled".into(),
                    ),
                );
            }
        }
        Ok(())
    }

    /// Whether the conversation's saved history is the transcript file its agent writes.
    pub(super) fn keeps_its_history_in_a_transcript(&self, id: ConversationId) -> bool {
        self.conversations.iter().any(|conversation| {
            conversation.id == id
                && history_source(conversation.binding.provider)
                    == Some(crate::daemon::providers::HistorySource::Transcript)
        })
    }

    /// Opens a chat on a session that began outside this app, or takes up again one the daemon no
    /// longer holds in step with its agent: the transcript is read into the history before the
    /// start is answered. The read is off the daemon's thread; `saved_history_read` takes what it
    /// found.
    pub(super) fn begin_saved_history(
        &mut self,
        id: ConversationId,
        generation: u64,
        client: ClientId,
    ) -> Result<()> {
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id && conversation.generation == generation)
            .ok_or_else(|| anyhow::anyhow!("No current conversation"))?;
        let binding = &conversation.binding;
        let (provider, session) = (binding.provider, binding.session_id.clone());
        let path = super::super::claude::transcript_path(&binding.config_root, &binding.cwd, &session)
            .ok_or_else(|| anyhow::anyhow!("The saved conversation's name is not one a transcript has"))?;
        #[cfg(test)]
        let home = self.followed_home.clone().or_else(super::super::follow::user_home);
        #[cfg(not(test))]
        let home = super::super::follow::user_home();
        let tx = self.tx.clone();
        self.saved_reads.insert(id);
        tokio::task::spawn_blocking(move || {
            let result = match home {
                Some(home) => super::super::follow::saved_history(id, provider, &session, &path, &home)
                    .map_err(|failure| failure.words().to_owned()),
                None => Err("The home folder is unknown".to_owned()),
            };
            // A closed daemon has no consumer for the read.
            let saved = super::super::follow::Saved { id, generation, client, result };
            let _ = tx.blocking_send(crate::daemon::Ev::SavedHistory(Box::new(saved)));
        });
        Ok(())
    }

    /// Takes the history read from a saved session's transcript and answers the start. A history
    /// that is not whole is refused: a chat is never continued over a past it cannot show.
    pub(in crate::daemon) fn saved_history_read(&mut self, saved: super::super::follow::Saved) {
        let super::super::follow::Saved { id, generation, client, result } = saved;
        self.saved_reads.remove(&id);
        if !self.conversations.iter().any(|c| c.id == id && c.generation == generation) {
            self.send(client, ServerMsg::Error("Conversation identity changed while its saved history was read".into()));
            return;
        }
        let kept = result
            .map_err(|why| format!("The saved conversation could not be read: {why}"))
            .and_then(|history| match history.completeness {
                Completeness::Complete => Ok(history),
                Completeness::Incomplete(reason) => Err(refusal_for(&reason).to_owned()),
                _ => Err(NOT_WHOLE.to_owned()),
            })
            .and_then(|history| self.keep_saved_history(id, history).map_err(|error| error.to_string()));
        match kept {
            Ok(()) => {
                self.send(client, ServerMsg::Reply(Reply::ConversationStarted { id, generation }));
                self.continue_cut_turn(client, id, generation);
            }
            Err(error) => {
                // The agent is up but the chat cannot use it: stopped, with the real reason kept,
                // so Reconnect starts it again and a later read can retry the wake.
                self.abandon_structured(id);
                let state = self.conversation_states.entry(id).or_default();
                state.status = Status::Blocked;
                state.error = Some(error.clone());
                state.history_ready = false;
                if client == DAEMON_REQUESTER && self.wake_retried.insert(id) {
                    self.resumable_conversations.push((id, generation));
                }
                self.dirty = true;
                self.send(client, ServerMsg::Error(error));
            }
        }
    }

    fn keep_saved_history(&mut self, id: ConversationId, mut history: History) -> Result<()> {
        if !self.cfg.restore.enabled || !self.cfg.restore.output {
            bail!("Opening a saved conversation as a chat needs `restore.output` on, so its history is kept");
        }
        if self.cut_conversations.remove(&id) {
            stop_open_turn(&mut history)?;
        }
        let state = self.conversation_states.entry(id).or_default();
        state.history_revision = state
            .history_revision
            .max(history.revision)
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("History revision exhausted"))?;
        history.revision = state.history_revision;
        state.history_ready = true;
        state.blocked = false;
        state.clear_errors();
        // The whole past is read and nothing runs yet: neither working nor waiting on the person,
        // whatever an earlier refusal or a stopped agent left.
        if matches!(state.status, Status::Working | Status::Blocked) {
            state.status = Status::Idle;
        }
        self.conversation_histories.insert(id, history);
        self.cache_conversation(id);
        self.dirty = true;
        Ok(())
    }

    pub(super) fn complete_empty_thread(&mut self, id: ConversationId) -> Result<()> {
        let mut history = History::new(id);
        history.set_completeness(Completeness::Complete)?;
        let state = self.conversation_states.entry(id).or_default();
        state.history_revision = state
            .history_revision
            .max(history.revision)
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("History revision exhausted"))?;
        history.revision = state.history_revision;
        state.history_ready = true;
        state.blocked = false;
        state.clear_errors();
        if state.status == Status::Working {
            state.status = Status::Idle;
        }
        if self.cfg.restore.enabled && self.cfg.restore.output {
            self.conversation_histories.insert(id, history);
            self.cache_conversation(id);
        }
        self.dirty = true;
        Ok(())
    }

    /// Answers a read of a conversation's history, then starts the chat if a restart left it
    /// asleep: a first read is a client opening it. The start comes after the answer, so the read
    /// is answered from what the daemon kept and not refused while the agent starts.
    pub(in crate::daemon) fn conversation_read(
        &mut self,
        client: ClientId,
        id: ConversationId,
        cursor: Option<history::Cursor>,
        limit: usize,
    ) -> Result<()> {
        self.may(client, Grant::Read, None)?;
        let read = self.read_conversation_history(client, id, cursor, limit);
        self.wake_conversation(id);
        read
    }

    fn read_conversation_history(
        &mut self,
        client: ClientId,
        id: ConversationId,
        cursor: Option<history::Cursor>,
        limit: usize,
    ) -> Result<()> {
        if limit == 0 || limit > history::MAX_READ_ENTRIES {
            bail!(
                "History limit must be between 1 and {}",
                history::MAX_READ_ENTRIES
            );
        }
        if self.is_followed(id) {
            return self.followed_read(client, id, cursor, limit);
        }
        let c = self
            .conversations
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| {
                anyhow::anyhow!("No complete conversation; creation may be uncertain")
            })?;
        let generation = c.generation;
        let known_empty = c.execution == ExecutionKind::Structured
            && c.awaiting_first_user_message
            && self
                .conversation_states
                .get(&id)
                .is_some_and(|state| state.history_ready)
            && !self
                .conversation_operations
                .iter()
                .any(|operation| operation.receipt.conversation == id);
        let read = ReadRequest {
            client,
            cursor,
            limit,
        };
        if self
            .conversation_history
            .get(client)
            .is_some_and(|h| h.conversation == id)
        {
            return self.reply_history(id, read);
        }
        self.conversation_history.attach(client, id);
        if known_empty {
            let mut history = History::new(id);
            history.set_completeness(Completeness::Complete)?;
            self.conversation_history.hydrate_native(client, history)?;
            return self.reply_history(id, read);
        }
        if let Some(history) = self.conversation_histories.get(&id).filter(|h| {
            h.completeness == Completeness::Complete || !self.conversation_runtimes.owns(id)
        }) {
            if self
                .conversation_states
                .get(&id)
                .is_some_and(|s| s.history_ready)
            {
                self.conversation_history
                    .hydrate_native(client, history.clone())?;
            } else {
                self.conversation_history
                    .hydrate_cached(client, history.clone())?;
            }
            return self.reply_history(id, read);
        }
        // A chat a restart left asleep has no runtime to read from until this read starts it
        // (`conversation_read`), and a refusal would show as a failure: it reads as still loading,
        // and the start's own read of its past follows.
        if self.is_asleep(id) {
            let mut history = History::new(id);
            history.set_completeness(Completeness::Loading)?;
            self.conversation_history.hydrate_cached(client, history)?;
            return self.reply_history(id, read);
        }
        self.begin_hydration(id, generation, Some(read), None)
    }

    pub(super) fn reply_history(&self, id: ConversationId, read: ReadRequest) -> Result<()> {
        let c = self
            .conversations
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        let history = self
            .conversation_history
            .get(read.client)
            .ok_or_else(|| anyhow::anyhow!("History attachment closed"))?;
        let page = history
            .read_generation(
                c.generation,
                read.cursor.as_ref(),
                read.limit,
                history::MAX_READ_BYTES,
            )
            .map_err(|e| anyhow::anyhow!("History read refused: {e:?}"))?;
        let state = self.conversation_states.get(&id);
        self.send(
            read.client,
            ServerMsg::Reply(Reply::ConversationRead(ReadResult {
                conversation: id,
                generation: c.generation,
                // A chat a restart left asleep has no state until this read starts it.
                status: state.map_or(
                    if self.is_asleep(id) { Status::Idle } else { Status::Blocked },
                    |s| s.effective_status(),
                ),
                receipt: self.visible_receipt(id),
                history: page,
                error: state.and_then(|s| s.shown_error().map(str::to_owned)),
                checks: state.map_or_else(Vec::new, |s| s.checks.infos()),
                // A structured conversation chose its own mode and model; only a followed pane reads them from a file.
                meta: None,
                approvals: state.map_or_else(Vec::new, |s| s.approvals.values().cloned().collect()),
                answered_approvals: state.map_or_else(Vec::new, |s| {
                    s.answered_approvals.iter().cloned().collect()
                }),
                queued: self.conversation_queues.get(&id).map_or_else(Vec::new, |queue| {
                    queue
                        .iter()
                        .map(|m| QueuedMessage {
                            operation: m.operation,
                            text: m.text.clone(),
                        })
                        .collect()
                }),
                cancelling: state.is_some_and(|s| s.cancelling.is_some())
                    || self.conversation_requests.values().any(
                        |pending| matches!(pending, Pending::Cancelling { id: pending_id, .. } if *pending_id == id),
                    ),
            })),
        );
        Ok(())
    }
}

/// The words the desktop app looks for to show a chat too long to open as a chat without offering
/// Reconnect, which can never succeed for it. Changing them changes `ReadProblemLine.tsx`.
pub(in crate::daemon) const TOO_LONG: &str =
    "This saved conversation is too long to open as a chat (over 16 MB); resume it in a terminal";
const NOT_WHOLE: &str = "This saved conversation's history could not be shown whole, so it cannot open as a chat; resume it in a terminal";

/// Why a saved history that is not whole is refused. Only a missing start (a long file, or more
/// entries than are kept) is the length limit.
fn refusal_for(reason: &crate::daemon::conversation::history::IncompleteReason) -> &'static str {
    use crate::daemon::conversation::history::IncompleteReason;
    match reason {
        IncompleteReason::MissingPages => TOO_LONG,
        _ => NOT_WHOLE,
    }
}

#[cfg(test)]
mod refusal_tests {
    use super::*;
    use crate::daemon::conversation::history::IncompleteReason;

    #[test]
    fn a_history_missing_its_start_is_refused_as_too_long_and_any_other_gap_is_not() {
        assert_eq!(refusal_for(&IncompleteReason::MissingPages), TOO_LONG);
        assert_ne!(refusal_for(&IncompleteReason::InvalidEvent), TOO_LONG);
        assert!(TOO_LONG.contains("too long to open as a chat"));
    }
}
