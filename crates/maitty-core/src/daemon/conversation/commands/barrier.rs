//! The durable-save barrier: what waits for a session save and what a finished save releases.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_barrier(
        &mut self,
        token: u64,
        result: std::result::Result<persist::SessionCommit, String>,
    ) {
        self.conversation_barriers.remove(&token);
        let Some(pending) = self.conversation_requests.remove(&token) else {
            return;
        };
        let id = pending.conversation();
        let result = result.and_then(|commit| match commit {
            persist::SessionCommit::Committed => Ok(()),
            persist::SessionCommit::Superseded { .. } => Err("Session persistence was superseded; mutation refused before delivery acknowledgement".into()),
        });
        if let Err(error) = result {
            self.conversation_fail(pending, error);
            return;
        }
        if !self.cfg.restore.enabled {
            self.conversation_fail(
                pending,
                "Restore was disabled while the operation was queued".into(),
            );
            return;
        }
        let applied = match pending {
            Pending::Launch { client, launch } => {
                if let Some(by) = self
                    .conversation_states
                    .get(&id)
                    .and_then(|state| state.started_by)
                {
                    let by = crate::daemon::helpers::Starter::Pane(by);
                    let allowed = self
                        .may_start_helper(by, "a structured Codex conversation")
                        .and_then(|()| {
                            let busy = self.busy_helpers(by, Some(id));
                            if busy >= self.cfg.helpers_at_once() {
                                bail!("Structured helper limit reached before launch");
                            }
                            Ok(())
                        });
                    if let Err(error) = allowed {
                        self.conversation_fail(
                            Pending::Launch { client, launch },
                            error.to_string(),
                        );
                        return;
                    }
                }
                let matches = match &launch.identity {
                    LaunchIdentity::Pending(p) => {
                        self.pending_starts.iter().any(|record| record == p)
                    }
                    LaunchIdentity::Existing(c) => {
                        self.conversations.iter().any(|record| record == &**c)
                    }
                };
                if !matches
                    || self.conversation_runtimes.owns(id)
                    || self.terms.values().any(|t| t.conversation_id == Some(id))
                {
                    self.conversation_fail(
                        Pending::Launch { client, launch },
                        "Conversation ownership changed before provider launch".into(),
                    );
                    return;
                }
                let generation = launch.generation();
                let settings = launch.settings().cloned();
                let expected = match &launch.identity {
                    LaunchIdentity::Pending(p) => p.thread_id.clone(),
                    LaunchIdentity::Existing(c) => Some(c.binding.session_id.clone()),
                };
                match settings {
                    Some(settings) => {
                        let opening = Pending::Opening {
                            client,
                            id,
                            generation,
                            settings,
                            expected,
                        };
                        self.conversation_requests.insert(token, opening);
                        self.conversation_runtimes
                            .start(*launch, self.tx.clone())
                            .map_err(|e| (token, e.to_string()))
                    }
                    None => Err((token, "Structured launch settings unavailable".into())),
                }
            }
            Pending::Identity {
                client,
                id,
                generation,
                created_thread,
                adopted,
            } => {
                if !self
                    .conversations
                    .iter()
                    .any(|c| c.id == id && c.generation == generation)
                {
                    self.send(
                        client,
                        ServerMsg::Error("Conversation identity changed during persistence".into()),
                    );
                    return;
                }
                if created_thread {
                    match self.complete_empty_thread(id) {
                        Ok(()) => {
                            self.send(
                                client,
                                ServerMsg::Reply(Reply::ConversationStarted { id, generation }),
                            );
                            Ok(())
                        }
                        Err(error) => Err((token, error.to_string())),
                    }
                } else if adopted && self.keeps_its_history_in_a_transcript(id) {
                    self.begin_saved_history(id, generation, client)
                        .map_err(|error| (token, error.to_string()))
                } else {
                    self.begin_hydration(id, generation, None, Some(client))
                        .map_err(|error| (token, error.to_string()))
                }
            }
            Pending::Submit {
                client,
                receipt,
                text,
                choice,
            } => {
                let valid = self.conversations.iter().any(|c| {
                    c.id == id
                        && c.generation == receipt.generation
                        && c.state == RecoveryState::Running
                }) && self
                    .conversation_operations
                    .iter()
                    .any(|o| o.receipt == receipt)
                    && self.conversation_states.get(&id).is_some_and(|s| {
                        !s.blocked && s.status != Status::Working && s.history_ready
                    });
                if !valid {
                    self.send(
                        client,
                        ServerMsg::Error(
                            "Conversation became stale, busy or blocked before submission".into(),
                        ),
                    );
                    return;
                }
                let thread = self
                    .conversations
                    .iter()
                    .find(|c| c.id == id)
                    .map(|c| c.binding.session_id.clone())
                    .unwrap_or_default();
                let generation = receipt.generation;
                let operation = receipt.operation;
                self.conversation_requests
                    .insert(token, Pending::Sending { client, receipt });
                let state = self.conversation_states.entry(id).or_default();
                state.status = Status::Working;
                state.error = None;
                let sent = self.conversation_runtimes.request(id, generation, token, Rpc::Send { session: thread, text, message: format!("{}-{generation}-{operation}", id.0), choice }).map_err(|e| (token, e.to_string()));
                if sent.is_ok() {
                    self.snapshot_conversation_turn(id, "before");
                }
                sent
            }
            Pending::Receipt { client, receipt } => {
                if self
                    .conversation_operations
                    .iter()
                    .any(|o| o.receipt == receipt)
                    && self
                        .conversations
                        .iter()
                        .any(|c| c.id == id && c.generation == receipt.generation)
                {
                    if let Some(done) = self
                        .conversation_operations
                        .iter()
                        .find(|o| o.receipt == receipt)
                        .cloned()
                    {
                        self.remember_acknowledged(done);
                    }
                    self.send(client, ServerMsg::Reply(Reply::ConversationSent(receipt)));
                } else {
                    self.send(
                        client,
                        ServerMsg::Error("Submission acknowledgement became stale".into()),
                    );
                }
                Ok(())
            }
            other => {
                self.conversation_fail(other, "Unexpected persistence stage".into());
                return;
            }
        };
        if let Err((token, error)) = applied
            && let Some(pending) = self.conversation_requests.remove(&token)
        {
            self.conversation_fail(pending, error);
        }
        self.dirty = true;
    }

    pub(in crate::daemon) fn conversation_save_completed(
        &mut self,
        barrier: Option<u64>,
        result: std::result::Result<persist::SessionCommit, String>,
    ) {
        if let Err(error) = result {
            if let Some(token) = barrier {
                self.conversation_barrier(token, Err(error));
            }
            return;
        }
        let snapshot = match serde_json::from_str::<persist::Saved>(&self.last_saved) {
            Ok(snapshot) => snapshot,
            Err(_) => return,
        };
        let ready: Vec<_> = self
            .conversation_barriers
            .iter()
            .filter(|(_, ticket)| **ticket <= self.session_saved_ticket)
            .map(|(token, _)| *token)
            .collect();
        for token in ready {
            let matches =
                self.conversation_requests
                    .get(&token)
                    .is_some_and(|pending| match pending {
                        Pending::Launch { launch, .. } => match &launch.identity {
                            LaunchIdentity::Pending(p) => {
                                snapshot.pending_starts.iter().any(|saved| saved == p)
                            }
                            LaunchIdentity::Existing(c) => {
                                snapshot.conversations.iter().any(|saved| saved == &**c)
                            }
                        },
                        Pending::Identity { id, generation, .. } => {
                            snapshot.conversations.iter().any(|saved| {
                                saved.id == *id
                                    && saved.generation == *generation
                                    && self.conversations.iter().any(|current| current == saved)
                            })
                        }
                        Pending::Submit { receipt, .. } | Pending::Receipt { receipt, .. } => {
                            snapshot.conversation_operations.iter().any(|saved| {
                                saved.receipt == *receipt
                                    && self
                                        .conversation_operations
                                        .iter()
                                        .any(|current| current == saved)
                            })
                        }
                        _ => false,
                    });
            self.conversation_barrier(
                token,
                if matches {
                    Ok(persist::SessionCommit::Committed)
                } else {
                    Err(
                        "Newer durable snapshot does not contain the matching operation intent"
                            .into(),
                    )
                },
            );
        }
    }
}
