//! Reading history: hydration from the provider and replies to a read.

use super::*;

fn history_source(provider: Provider) -> Option<crate::daemon::providers::HistorySource> {
    crate::daemon::providers::adapter(provider)
        .structured
        .as_ref()
        .map(|structured| structured.history)
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
        self.conversation_runtimes
            .request(
                id,
                generation,
                token,
                Rpc::ReadHistory { session, cursor: None, limit: history::MAX_READ_ENTRIES },
            )
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
            state.error = Some(if recorded {
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
        state.error = None;
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

    pub(in crate::daemon) fn conversation_read(
        &mut self,
        client: ClientId,
        id: ConversationId,
        cursor: Option<history::Cursor>,
        limit: usize,
    ) -> Result<()> {
        self.may(client, Grant::Read, None)?;
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
                status: state.map_or(Status::Blocked, |s| s.effective_status()),
                receipt: self.visible_receipt(id),
                history: page,
                error: state.and_then(|s| s.error.clone()),
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
