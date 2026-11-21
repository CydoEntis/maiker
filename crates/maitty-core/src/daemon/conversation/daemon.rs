use super::{
    Event, Payload,
    commands::Pending,
    history::{Completeness, History},
};
#[cfg(test)]
use super::{Launch, transport::LaunchIdentity};
use crate::conversation::{ConversationId, RecoveryState};
use crate::daemon::{Daemon, Ev, ServerMsg};
use crate::protocol::Status;
use anyhow::{Result, bail};

const FILE_CHANGE_DIFF_ERROR: &str =
    "Codex sent an incomplete file-change diff; approval remains disabled";

fn cache_write_result(result: Result<bool>) -> Result<()> {
    // A false commit means a newer snapshot or a policy change already won.
    result.map(|_| ())
}

fn reset_state_after_provider_ready(state: &mut super::State) {
    state.status = Status::Idle;
    state.blocked = false;
    state.error = None;
    state.approvals.clear();
    state.file_change_previews.clear();
    state.unsupported_requests.clear();
    state.cancelling = None;
}

/// What the daemon needs to know about a reported event beside its history update.
struct Reported {
    /// The event ends the turn a person asked to stop.
    cancellation_finished: bool,
    /// The event is a turn's end, whatever state it ended in.
    completed: bool,
}

impl Daemon {
    pub(in crate::daemon) async fn initialize_conversation_cache(&mut self) -> Result<()> {
        let path = self.session_path.clone();
        let enabled = self.cfg.restore.enabled;
        let output = self.cfg.restore.output;
        let records = self.conversations.clone();
        let (cache, histories) = tokio::task::spawn_blocking(move || -> Result<_> {
            let cache = super::history_storage::Cache::for_session(&path, enabled, output)?;
            let mut histories = std::collections::BTreeMap::new();
            for c in records {
                if let Some(mut history) = cache.load_or_rebuild(c.id, &c.binding)? {
                    // A cache written before redaction existed may still hold secrets.
                    history.redact_stored();
                    history.reconnect()?;
                    histories.insert(c.id, history);
                }
            }
            Ok((cache, histories))
        })
        .await
        .map_err(|_| anyhow::anyhow!("Conversation cache initialization task failed"))??;
        self.conversation_cache = Some(cache);
        for (id, history) in &histories {
            self.conversation_states
                .entry(*id)
                .or_default()
                .history_revision = history.revision;
        }
        self.conversation_histories = histories;
        Ok(())
    }

    pub(in crate::daemon) fn configure_conversation_cache(&mut self) -> Result<()> {
        if !self.cfg.restore.enabled || !self.cfg.restore.output {
            self.conversation_histories.clear();
            self.conversation_cache_dirty.clear();
        }
        let Some(cache) = self.conversation_cache.as_ref() else {
            return Ok(());
        };
        let policy = cache.fence_policy(self.cfg.restore.enabled, self.cfg.restore.output)?;
        let cache = cache.clone();
        let tx = self.tx.clone();
        tokio::task::spawn_blocking(move || {
            let result = cache.apply_policy(policy).map_err(|e| e.to_string());
            // Policy failures remain visible while the daemon has a reader.
            let _ = tx.blocking_send(Ev::ConversationStorage {
                id: ConversationId(0),
                revision: None,
                result,
            });
        });
        Ok(())
    }
    #[cfg(test)]
    pub(in crate::daemon) fn start_conversation(&mut self, launch: Launch) -> Result<()> {
        let LaunchIdentity::Existing(record) = &launch.identity else {
            bail!("Foundation launch requires complete identity");
        };
        if !self.conversations.iter().any(|c| c == &**record) {
            bail!("Structured launch does not match the daemon conversation registry");
        }
        if self
            .terms
            .values()
            .any(|t| t.conversation_id == Some(record.id))
        {
            bail!("A terminal still owns this conversation");
        }
        self.conversation_runtimes.start(launch, self.tx.clone())
    }

    /// Stop every provider process tree; see `Registry::stop_all`.
    pub(in crate::daemon) fn stop_conversations(&mut self) -> Vec<tokio::task::AbortHandle> {
        self.conversation_runtimes.stop_all()
    }

    #[cfg(test)]
    pub(in crate::daemon) fn dispose_conversation(&mut self, id: ConversationId) -> Result<()> {
        self.conversation_runtimes.dispose(id)
    }

    pub(in crate::daemon) fn conversation_event(&mut self, event: Event) {
        let id = event.owner.conversation;
        let generation = self
            .conversations
            .iter()
            .find(|c| c.id == id)
            .map(|c| c.generation)
            .or_else(|| {
                self.pending_starts
                    .iter()
                    .find(|p| p.id == id)
                    .map(|p| p.generation)
            });
        let Some(generation) = generation else { return };
        if !self.conversation_runtimes.accept(&event, generation) {
            return;
        }
        let result = self.apply_conversation_event(id, generation, event.payload);
        if let Err(error) = result {
            let state = self.conversation_states.entry(id).or_default();
            state.status = Status::Blocked;
            state.history_ready = false;
            state.error = Some(error.to_string());
            self.broadcast(
                |client| client.attach,
                ServerMsg::Error(format!("Codex conversation {}: {error}", id.0)),
            );
            if let Err(error) = self.conversation_runtimes.dispose(id) {
                tracing::warn!(%error,"Cannot dispose failed conversation runtime");
            }
        }
        self.dirty = true;
    }

    fn apply_conversation_event(
        &mut self,
        id: ConversationId,
        generation: u64,
        payload: Payload,
    ) -> Result<()> {
        match payload {
            Payload::Ready => {
                if let Some(record) = self.conversations.iter_mut().find(|c| c.id == id) {
                    record.state = RecoveryState::Running;
                }
                if let Some(state) = self.conversation_states.get_mut(&id) {
                    reset_state_after_provider_ready(state);
                }
                self.conversation_history.reconnect(id)?;
                self.conversation_ready(id)
            }
            Payload::Response { token, result } => {
                let client = self
                    .conversation_requests
                    .get(&token)
                    .and_then(Pending::client);
                let response = self.conversation_response(token, result);
                if let (Some(client), Err(error)) = (client, &response) {
                    self.send(client, ServerMsg::Error(error.to_string()));
                }
                response
            }
            Payload::Terminated { failure, reaped } => {
                self.conversation_states
                    .entry(id)
                    .or_default()
                    .approvals
                    .clear();
                self.conversation_states
                    .entry(id)
                    .or_default()
                    .file_change_previews
                    .clear();
                self.conversation_states
                    .entry(id)
                    .or_default()
                    .unsupported_requests
                    .clear();
                if let Some(record) = self.conversations.iter_mut().find(|c| c.id == id) {
                    record.state = if failure.is_none() && reaped {
                        RecoveryState::Stopped
                    } else {
                        RecoveryState::RecoveryRequired
                    };
                }
                // An agent stopped on purpose is not a failure: leave it stopped and idle.
                if failure.is_none() && reaped && self.conversation_ending.remove(&id) {
                    let state = self.conversation_states.entry(id).or_default();
                    state.cancelling = None;
                    state.blocked = false;
                    state.status = Status::Idle;
                    state.error = None;
                    state.history_ready = false;
                    self.conversation_history.reconnect(id)?;
                    return Ok(());
                }
                let failed = failure.is_some();
                let reason = failure.unwrap_or_else(|| "Provider runtime disconnected".into());
                if failed {
                    self.broadcast(
                        |client| client.attach,
                        ServerMsg::Error(format!("Codex conversation {}: {reason}", id.0)),
                    );
                }
                let tokens: Vec<_> = self
                    .conversation_requests
                    .iter()
                    .filter(|(_, p)| p.conversation() == id)
                    .map(|(token, _)| *token)
                    .collect();
                for token in tokens {
                    if let Some(p) = self.conversation_requests.remove(&token) {
                        self.conversation_fail(p, reason.clone());
                    }
                }
                let state = self.conversation_states.entry(id).or_default();
                state.approvals.clear();
                state.file_change_previews.clear();
                state.unsupported_requests.clear();
                state.cancelling = None;
                state.status = Status::Blocked;
                state.error = Some(reason);
                state.history_ready = false;
                self.conversation_history.reconnect(id)?;
                Ok(())
            }
            Payload::Request {
                id: request,
                method,
                params,
            } => {
                use maitty_provider_codex::approvals;
                if approvals::is_turn_request(&method) {
                    let thread = self
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                        .map(|conversation| conversation.binding.session_id.as_str());
                    let active_turn = self.conversation_active_turn(id);
                    anyhow::ensure!(
                        approvals::names(&params, thread, active_turn),
                        "Codex approval request does not belong to the acknowledged active turn"
                    );
                }
                let request_id: crate::conversation::ProviderRequestId = request.into();
                let known_changes = approvals::subject(&params).and_then(|subject| {
                    self.conversation_states
                        .get(&id)
                        .and_then(|state| state.file_change_previews.get(&subject))
                        .cloned()
                });
                let asked = approvals::approval_request(request_id.clone(), &method, &params, known_changes)
                    .map(|asked| (asked.request, asked.command_hash))
                    .ok_or((request_id, method));
                self.conversation_asked(id, asked)
            }
            Payload::Event(event) => self.conversation_provider_event(id, generation, event),
            Payload::Notification { method, params } => {
                let thread = self
                    .conversations
                    .iter()
                    .find(|c| c.id == id)
                    .map(|c| c.binding.session_id.clone());
                let Some(thread) = thread else { return Ok(()) };
                if self.conversation_helper_event(id, generation, &thread, &method, &params) {
                    return Ok(());
                }
                if method == "item/fileChange/patchUpdated"
                    && params.get("threadId").and_then(serde_json::Value::as_str)
                        == Some(thread.as_str())
                    && let (Some(item_id), Some(turn_id), Some(changes)) = (
                        params.get("itemId").and_then(serde_json::Value::as_str),
                        params.get("turnId").and_then(serde_json::Value::as_str),
                        params.get("changes").and_then(serde_json::Value::as_array),
                    )
                {
                    let active_turn = self.conversation_active_turn(id);
                    if active_turn != Some(turn_id) {
                        return Ok(());
                    }
                    let key = (turn_id.to_owned(), item_id.to_owned());
                    let state = self.conversation_states.entry(id).or_default();
                    let changes = if let Some(changes) = maitty_provider::approval::file_change_previews(changes) {
                        state.file_change_previews.insert(key, changes.clone());
                        changes
                    } else {
                        state.file_change_previews.remove(&key);
                        state.error = Some(FILE_CHANGE_DIFF_ERROR.into());
                        Vec::new()
                    };
                    for approval in state.approvals.values_mut().filter(|approval| {
                        approval.kind == crate::conversation::ApprovalRequestKind::FileChange
                            && approval.item_id.as_deref() == Some(item_id)
                            && approval.turn_id.as_deref() == Some(turn_id)
                    }) {
                        approval.changes = changes.clone();
                        if !changes.is_empty() && approval.choices.is_empty() {
                            approval.choices = vec![
                                crate::conversation::ApprovalDecision::Accept,
                                crate::conversation::ApprovalDecision::Decline,
                            ];
                        } else if changes.is_empty() {
                            approval.choices.clear();
                        }
                    }
                }
                let cancellation_finished = method == "turn/completed"
                    && params.get("threadId").and_then(serde_json::Value::as_str)
                        == Some(thread.as_str())
                    && params
                        .get("turn")
                        .and_then(|turn| turn.get("id"))
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|turn_id| {
                            self.conversation_states
                                .get(&id)
                                .is_some_and(|state| state.cancelling.as_deref() == Some(turn_id))
                        });
                if cancellation_finished {
                    self.conversation_cancellation_finished(id);
                }
                let update = super::history_provider::notification(id, &thread, &method, &params);
                let turn_error = || {
                    params
                        .get("turn")
                        .and_then(|turn| turn.get("error"))
                        .filter(|error| !error.is_null())
                        .map(super::history_provider::error_message)
                        .transpose()
                };
                self.conversation_reported(
                    id,
                    generation,
                    update,
                    Reported { cancellation_finished, completed: method == "turn/completed" },
                    turn_error,
                )
            }
        }
    }

    /// Takes in what a provider reported about a turn: the conversation's status and error
    /// follow it, and its history keeps it. `turn_error` reads the reason a turn gave for ending,
    /// and is asked only when a turn's status changed.
    fn conversation_reported(
        &mut self,
        id: ConversationId,
        generation: u64,
        update: Result<Option<super::history::Update>, super::history::IncompleteReason>,
        reported: Reported,
        turn_error: impl Fn() -> Result<Option<String>, super::history::IncompleteReason>,
    ) -> Result<()> {
        if !matches!(&update, Ok(None)) {
            for pending in self.conversation_requests.values_mut() {
                if let Pending::Hydration {
                    id: owner, changed, ..
                } = pending
                    && *owner == id
                {
                    *changed = true;
                }
            }
        }
        let state = self.conversation_states.entry(id).or_default();
        if let Ok(Some(super::history::Update::ProviderError {
            message,
            will_retry,
        })) = &update
        {
            state.error = Some(message.clone());
            state.status = if *will_retry {
                Status::Working
            } else {
                Status::Blocked
            };
        }
        if matches!(
            &update,
            Err(_)
                | Ok(Some(super::history::Update::UpsertItem(
                    super::history::Entry {
                        content: super::history::Content::Unsupported { .. },
                        ..
                    }
                )))
        ) {
            state.history_ready = false;
            state.error =
                Some("Native history is incomplete or contains unsupported content".into());
        }
        if let Ok(Some(super::history::Update::SetTurnStatus {
            turn,
            state: turn_state,
            ..
        })) = &update
        {
            let cancelled_turn = reported.cancellation_finished
                && *turn_state == super::history::ItemState::Interrupted;
            let failure = match turn_state {
                super::history::ItemState::Failed => Some("Codex turn failed"),
                super::history::ItemState::Interrupted => {
                    Some("Codex turn was interrupted")
                }
                _ => None,
            };
            if cancelled_turn {
                state.error = None;
                state.status = Status::Idle;
            } else {
                if let Some(failure) = failure {
                    state.error = Some(turn_error()?.unwrap_or_else(|| failure.into()));
                } else if let Some(error) = turn_error()? {
                    state.error = Some(error);
                }
                state.status =
                    if state.blocked || failure.is_some() || state.error.is_some() {
                        Status::Blocked
                    } else if *turn_state == super::history::ItemState::Running {
                        Status::Working
                    } else {
                        Status::Done
                    };
            }
            if reported.completed {
                self.conversation_turn_ended(id, generation, turn.clone());
            }
        }
        self.conversation_history.apply(id, &update)?;
        if self.cfg.restore.enabled && self.cfg.restore.output {
            let history = self
                .conversation_histories
                .entry(id)
                .or_insert_with(|| History::new(id));
            let revision = history.revision;
            match update {
                Ok(Some(update)) => history.apply(update)?,
                Ok(None) => (),
                Err(reason) => {
                    history.set_completeness(Completeness::Incomplete(reason))?
                }
            }
            if history.revision != revision {
                self.cache_conversation(id);
            }
        }
        Ok(())
    }

    /// Takes in a request a provider made of a person, or one this project cannot answer, named
    /// by its request and method. The conversation waits either way.
    fn conversation_asked(
        &mut self,
        id: ConversationId,
        asked: Result<
            (crate::conversation::ApprovalRequest, Option<String>),
            (crate::conversation::ProviderRequestId, String),
        >,
    ) -> Result<()> {
        let state = self.conversation_states.entry(id).or_default();
        state.blocked = true;
        state.status = Status::Blocked;
        let arrived = match asked {
            Ok((request, command_hash)) => {
                let request_id = request.request_id.clone();
                if let Some(hash) = command_hash {
                    state.command_hashes.insert(request_id.clone(), hash);
                }
                if state.approvals.insert(request_id.clone(), request).is_some() {
                    bail!("Codex reused a pending approval request ID");
                }
                if state.unsupported_requests.is_empty()
                    && state.error.as_deref() != Some(FILE_CHANGE_DIFF_ERROR)
                {
                    state.error = None;
                }
                Some(request_id)
            }
            Err((request_id, method)) => {
                let message = format!(
                    "Provider request {method} is unsupported; {} left it unanswered",
                    crate::brand::APP_NAME
                );
                state
                    .unsupported_requests
                    .insert(request_id, message.clone());
                state.error = Some(message);
                None
            }
        };
        if let Some(arrived) = arrived {
            self.auto_approve_remembered(id, &arrived);
        }
        Ok(())
    }

    /// The turn a conversation's provider has acknowledged and not yet ended.
    fn conversation_active_turn(&self, id: ConversationId) -> Option<&str> {
        self.conversation_operations
            .iter()
            .find(|operation| operation.receipt.conversation == id)
            .and_then(|operation| match &operation.receipt.delivery {
                crate::conversation::Delivery::Acknowledged { turn_id } => Some(turn_id.as_str()),
                crate::conversation::Delivery::SubmissionUncertain => None,
            })
    }

    /// Takes in what an adapter that speaks the provider contract reported.
    fn conversation_provider_event(
        &mut self,
        id: ConversationId,
        generation: u64,
        event: maitty_provider::ProviderEvent,
    ) -> Result<()> {
        use maitty_provider::ProviderEvent;
        // The helpers listed belong to one run of the provider.
        let state = self.conversation_states.entry(id).or_default();
        if state.helpers_generation != generation {
            state.helpers.clear();
            state.helpers_generation = generation;
        }
        match event {
            ProviderEvent::ApprovalRequested { request, command_hash } => {
                anyhow::ensure!(
                    request.turn_id.is_some()
                        && request.turn_id.as_deref() == self.conversation_active_turn(id),
                    "Codex approval request does not belong to the acknowledged active turn"
                );
                self.conversation_asked(id, Ok((request, command_hash)))
            }
            ProviderEvent::UnsupportedRequest { request, method } => {
                self.conversation_asked(id, Err((request, method)))
            }
            event @ (ProviderEvent::Problem { .. }
            | ProviderEvent::Item(_)
            | ProviderEvent::TextDelta { .. }
            | ProviderEvent::TurnStarted { .. }
            | ProviderEvent::TurnCompleted { .. }
            | ProviderEvent::Unreadable { .. }) => {
                let (ended, error) = match &event {
                    ProviderEvent::TurnCompleted { turn, error, .. } => {
                        (Some(turn.clone()), error.clone())
                    }
                    _ => (None, None),
                };
                let cancellation_finished = ended.as_deref().is_some_and(|turn| {
                    self.conversation_states
                        .get(&id)
                        .is_some_and(|state| state.cancelling.as_deref() == Some(turn))
                });
                if cancellation_finished {
                    self.conversation_cancellation_finished(id);
                }
                let update = super::history_provider::provider_event(id, event);
                self.conversation_reported(
                    id,
                    generation,
                    update,
                    Reported { cancellation_finished, completed: ended.is_some() },
                    || Ok(error.clone()),
                )
            }
            other => bail!("Provider event reached the daemon outside its command: {other:?}"),
        }
    }

    /// A person's stop of a turn went through: nothing it asked is open any more.
    fn conversation_cancellation_finished(&mut self, id: ConversationId) {
        let Some(state) = self.conversation_states.get_mut(&id) else {
            return;
        };
        state.cancelling = None;
        state.approvals.clear();
        state.file_change_previews.clear();
        state.unsupported_requests.clear();
        state.blocked = false;
        state.error = None;
    }

    /// Keeps the conversation's helpers (ADR 0010) from what its provider reports, and takes a
    /// helper's own events off the conversation: they are the helper's turns, not the
    /// conversation's, so they never reach its history or status. Returns whether the event was a
    /// helper's own. Helpers from an earlier generation are dropped.
    fn conversation_helper_event(
        &mut self,
        id: crate::conversation::ConversationId,
        generation: u64,
        thread: &str,
        method: &str,
        params: &serde_json::Value,
    ) -> bool {
        let now = crate::daemon::term::unix_now();
        let state = self.conversation_states.entry(id).or_default();
        if state.helpers_generation != generation {
            state.helpers.clear();
            state.helpers_generation = generation;
        }
        match params.get("threadId").and_then(serde_json::Value::as_str) {
            Some(other) if other != thread && super::codex_helpers::is_helper(&state.helpers, other) => {
                super::codex_helpers::helper_event(&mut state.helpers, other, method, params, now);
                true
            }
            Some(own) if own == thread && matches!(method, "item/started" | "item/completed") => {
                if let Some(item) = params.get("item") {
                    super::codex_helpers::activity(&mut state.helpers, item, None, now);
                }
                false
            }
            _ => false,
        }
    }

    pub(in crate::daemon) fn save_conversation_caches(&mut self) {
        let dirty: Vec<_> = self.conversation_cache_dirty.iter().copied().collect();
        for id in dirty {
            self.cache_conversation(id);
        }
    }

    pub(in crate::daemon) fn cache_conversation(&mut self, id: ConversationId) {
        if !self.cfg.restore.enabled || !self.cfg.restore.output {
            return;
        }
        self.conversation_cache_dirty.insert(id);
        if self.conversation_cache_writes.contains_key(&id) {
            return;
        }
        let Some(cache) = self.conversation_cache.as_ref() else {
            return;
        };
        let Some(c) = self.conversations.iter().find(|c| c.id == id) else {
            return;
        };
        let Some(history) = self.conversation_histories.get(&id) else {
            return;
        };
        let revision = history.revision;
        let ticket = match cache.prepare(&c.binding, history) {
            Ok(ticket) => ticket,
            Err(error) => {
                self.broadcast(
                    |client| client.attach,
                    ServerMsg::Error(format!("Conversation cache preparation failed: {error}")),
                );
                return;
            }
        };
        let cache = cache.clone();
        let tx = self.tx.clone();
        self.conversation_cache_writes.insert(id, revision);
        tokio::task::spawn_blocking(move || {
            let result = cache_write_result(cache.commit(ticket)).map_err(|e| e.to_string());
            // A closed daemon has no reader for a best-effort storage notification.
            let _ = tx.blocking_send(Ev::ConversationStorage {
                id,
                revision: Some(revision),
                result,
            });
        });
    }
}

#[cfg(test)]
mod cache_write_tests {
    use super::cache_write_result;
    use crate::protocol::Status;

    #[test]
    fn a_superseded_or_disabled_cache_write_is_not_reported_as_a_conversation_error() {
        assert!(cache_write_result(Ok(false)).is_ok());
    }

    #[test]
    fn a_cache_io_error_is_still_reported() {
        let result = cache_write_result(Err(anyhow::anyhow!("disk failed")));

        assert_eq!(result.unwrap_err().to_string(), "disk failed");
    }

    #[test]
    fn reconnect_clears_the_old_provider_error_before_hydrating_history() {
        let mut state = super::super::State {
            status: Status::Blocked,
            blocked: true,
            error: Some("Codex stdout closed".into()),
            ..Default::default()
        };

        super::reset_state_after_provider_ready(&mut state);

        assert_eq!(state.status, Status::Idle);
        assert!(!state.blocked);
        assert!(state.error.is_none());
        assert!(!state.history_ready);
    }
}
