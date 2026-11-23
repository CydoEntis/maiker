//! A provider's answers to the daemon's requests.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_ready(&mut self, id: ConversationId) -> Result<()> {
        let token = self.conversation_requests.iter().find_map(|(token, p)| {
            matches!(p, Pending::Opening { id: candidate, .. } if *candidate == id)
                .then_some(*token)
        });
        let Some(token) = token else { return Ok(()) };
        let Some(Pending::Opening {
            generation,
            settings,
            expected,
            ..
        }) = self.conversation_requests.get(&token)
        else {
            return Ok(());
        };
        let rpc = Rpc::Open { settings: Box::new(settings.clone()), session: expected.clone() };
        self.conversation_runtimes
            .request(id, *generation, token, rpc)
    }

    pub(in crate::daemon) fn conversation_response(
        &mut self,
        token: u64,
        result: std::result::Result<Value, super::super::transport::RpcError>,
    ) -> Result<()> {
        let Some(pending) = self.conversation_requests.remove(&token) else {
            bail!("Provider response has no daemon operation");
        };
        let result = match result {
            Err(error)
                if error.is_thread_not_materialized()
                    && matches!(&pending, Pending::Hydration { .. })
                    && self.conversations.iter().any(|conversation| {
                        conversation.id == pending.conversation()
                            && conversation.awaiting_first_user_message
                    })
                    && !self.conversation_operations.iter().any(|operation| {
                        operation.receipt.conversation == pending.conversation()
                    }) =>
            {
                Ok(json!({"data":[],"nextCursor":null}))
            }
            result => result,
        };
        let value = match result {
            Ok(value) => value,
            // A steer Codex will not take (the turn ended a moment ago, or another one runs) is
            // not a fault of the conversation: the message is still waiting and goes out as the
            // next turn like any queued one. Only the person who asked hears why.
            Err(error) if matches!(pending, Pending::Steering { .. }) => {
                if let Pending::Steering { client, id, operation, .. } = pending {
                    let reason = format!(
                        "Codex did not take message {operation} into the running turn (RPC error {}); it is still waiting and goes out when the turn ends",
                        error.code
                    );
                    tracing::info!(conversation = id.0, "{reason}");
                    self.send(client, ServerMsg::Error(reason));
                }
                return Ok(());
            }
            // The same for an interrupt that only served to send a message now: the turn ended
            // before the provider heard it. Nothing is stopped, the message keeps its place at
            // the front, and the ordinary delivery sends it once the turn is over.
            Err(error)
                if matches!(pending, Pending::Cancelling { for_send_now: true, .. }) =>
            {
                if let Pending::Cancelling { client, id, turn_id, .. } = pending {
                    if let Some(state) = self.conversation_states.get_mut(&id)
                        && state.cancelling.as_deref() == Some(turn_id.as_str())
                    {
                        state.cancelling = None;
                    }
                    let reason = format!(
                        "Codex did not take the interrupt (RPC error {}); the turn may have just ended, and the message goes out next",
                        error.code
                    );
                    tracing::info!(conversation = id.0, "{reason}");
                    self.send(client, ServerMsg::Error(reason));
                }
                self.dirty = true;
                return Ok(());
            }
            Err(error) => {
                let stage = match &pending {
                    Pending::Opening { expected: None, .. } => "thread/start",
                    Pending::Opening { .. } => "thread/resume",
                    Pending::Hydration { .. } => "thread/turns/list",
                    Pending::Sending { .. } => "turn/start",
                    Pending::Cancelling { .. } => "turn/interrupt",
                    _ => "unknown",
                };
                let id = pending.conversation();
                let provider = self.conversations.iter().map(|c| (c.id, c.binding.provider))
                    .chain(self.pending_starts.iter().map(|p| (p.id, p.settings.provider)))
                    .find_map(|(other, provider)| (other == id).then_some(provider));
                let over_acp = provider == Some(Provider::Acp);
                // The person reads this line under their chat: it names the agent they are talking to.
                let who = match provider {
                    Some(Provider::Claude) => "Claude",
                    Some(Provider::Gemini) => "Gemini",
                    Some(Provider::Acp) => "The agent",
                    Some(Provider::Codex) | None => "Codex",
                };
                let reason = match (&pending, over_acp) {
                    (Pending::Opening { expected: Some(_), .. }, true) => format!(
                        "The agent did not continue the saved conversation (error {}); it can only when the agent says it loads sessions",
                        error.code
                    ),
                    (Pending::Opening { .. }, true) => {
                        format!("The agent did not open a conversation (error {}); nothing was sent again", error.code)
                    }
                    _ => format!("{who} rejected {stage} (RPC error {}); no fallback or automatic resend was attempted", error.code),
                };
                self.conversation_fail(pending, reason);
                return Ok(());
            }
        };
        let id = pending.conversation();
        match pending {
            Pending::Opening {
                client,
                id,
                generation,
                mut settings,
                expected,
            } => {
                let created_thread = expected.is_none();
                let thread = match validate_response(&value, &mut settings, expected.as_deref()) {
                    Ok(thread) => thread,
                    Err(error) => {
                        self.conversation_fail(
                            Pending::Opening {
                                client,
                                id,
                                generation,
                                settings,
                                expected,
                            },
                            error.to_string(),
                        );
                        return Ok(());
                    }
                };
                let origin = worktree_origin_of(&settings.cwd);
                let c = Conversation {
                    id,
                    generation,
                    binding: NativeBinding {
                        agent: settings.agent.clone(),
                        provider: settings.provider,
                        session_id: thread,
                        account: None,
                        profile: None,
                        config_root: settings.config_root.clone(),
                        executable: settings.executable.clone(),
                        cwd: settings.cwd.clone(),
                        worktree: None,
                    },
                    execution: ExecutionKind::Structured,
                    state: RecoveryState::Running,
                    settings: Some(settings),
                    awaiting_first_user_message: created_thread
                        || self
                            .conversations
                            .iter()
                            .find(|conversation| conversation.id == id)
                            .is_some_and(|conversation| {
                                conversation.awaiting_first_user_message
                            }),
                    title: self
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                        .and_then(|conversation| conversation.title.clone()),
                    archived: self
                        .conversations
                        .iter()
                        .find(|conversation| conversation.id == id)
                        .is_some_and(|conversation| conversation.archived),
                    // What the folder says now wins (the branch may have been switched in it);
                    // the saved one stays when the folder says nothing (detached, or gone).
                    worktree_origin: origin.or_else(|| {
                        self.conversations
                            .iter()
                            .find(|conversation| conversation.id == id)
                            .and_then(|conversation| conversation.worktree_origin.clone())
                    }),
                };
                let adopted = !created_thread && !self.conversations.iter().any(|known| known.id == id);
                let mut proposed = self.conversations.clone();
                proposed.retain(|c| c.id != id);
                proposed.push(c);
                validate_registry(&proposed).map_err(|e| {
                    anyhow::anyhow!("Provider identity conflicts with registry: {e:?}")
                })?;
                self.conversations = proposed;
                self.pending_starts.retain(|p| p.id != id);
                self.conversation_requests.insert(
                    token,
                    Pending::Identity {
                        client,
                        id,
                        generation,
                        created_thread,
                        adopted,
                    },
                );
                self.conversation_persist(token)?;
            }
            Pending::Sending {
                client,
                mut receipt,
            } => {
                let turn_id = maitty_provider_codex::requests::started_turn(&value)?;
                if let Some(conversation) = self
                    .conversations
                    .iter_mut()
                    .find(|conversation| conversation.id == receipt.conversation)
                {
                    conversation.awaiting_first_user_message = false;
                }
                receipt.delivery = Delivery::Acknowledged { turn_id };
                let operation = self
                    .conversation_operations
                    .iter_mut()
                    .find(|o| {
                        o.receipt.conversation == id
                            && o.receipt.generation == receipt.generation
                            && o.receipt.operation == receipt.operation
                    })
                    .ok_or_else(|| {
                        anyhow::anyhow!("Submission generation changed before acknowledgement")
                    })?;
                operation.receipt = receipt.clone();
                self.conversation_requests
                    .insert(token, Pending::Receipt { client, receipt });
                self.conversation_persist(token)?;
            }
            Pending::Steering {
                client,
                id,
                generation,
                operation,
                turn_id,
            } => {
                // Codex answered without an error, so the message is in its turn: it must leave
                // the queue even if the answer is oddly shaped, or it would be sent twice.
                let acknowledged = maitty_provider_codex::parse_turn_steer_ack(
                    &json!({"id":0,"result":value}),
                )
                .unwrap_or_else(|problem| {
                    tracing::warn!(conversation = id.0, "{problem}");
                    turn_id
                });
                self.steered(client, id, generation, operation, acknowledged);
            }
            Pending::Cancelling {
                id,
                generation,
                turn_id,
                ..
            } => {
                if !value.is_object()
                    || !self.conversations.iter().any(|conversation| {
                        conversation.id == id
                            && conversation.generation == generation
                            && conversation.state == RecoveryState::Running
                    })
                    || !self.conversation_operations.iter().any(|operation| {
                        operation.receipt.conversation == id
                            && operation.receipt.generation == generation
                            && matches!(&operation.receipt.delivery, Delivery::Acknowledged { turn_id: acknowledged } if acknowledged == &turn_id)
                    })
                {
                    bail!("Codex interrupt acknowledgement is stale or invalid");
                }
            }
            Pending::Hydration {
                id,
                generation,
                mut history,
                mut cursors,
                read,
                started,
                changed,
                bytes,
            } => {
                let bytes = bytes
                    .checked_add(serde_json::to_vec(&value)?.len())
                    .filter(|bytes| *bytes <= MAX_HYDRATION_BYTES)
                    .ok_or_else(|| {
                        anyhow::anyhow!("Codex history exceeds bounded hydration size")
                    })?;
                let thread = self
                    .conversations
                    .iter()
                    .find(|c| c.id == id && c.generation == generation)
                    .ok_or_else(|| anyhow::anyhow!("History generation changed"))?
                    .binding
                    .session_id
                    .clone();
                let turns = value
                    .get("data")
                    .and_then(Value::as_array)
                    .ok_or_else(|| anyhow::anyhow!("Codex history page lacks turns"))?;
                if !turns.is_empty()
                    && let Some(conversation) = self
                        .conversations
                        .iter_mut()
                        .find(|conversation| conversation.id == id)
                {
                    conversation.awaiting_first_user_message = false;
                }
                for turn in turns {
                    if turn.get("itemsView").is_some_and(|v| v != "full") {
                        bail!("Codex history returned a partial item view");
                    }
                    let turn_id = identifier(turn, "id")?;
                    if let Some(update) = super::super::history_provider::notification(
                        id,
                        &thread,
                        "turn/completed",
                        &json!({"threadId":thread,"turn":turn}),
                    )? {
                        history.apply(update)?;
                    }
                    for item in turn
                        .get("items")
                        .and_then(Value::as_array)
                        .ok_or_else(|| anyhow::anyhow!("Codex history turn lacks items"))?
                    {
                        if let Some(update) = super::super::history_provider::notification(
                            id,
                            &thread,
                            "item/completed",
                            &json!({"threadId":thread,"turnId":turn_id,"item":item}),
                        )? {
                            history.apply(update)?;
                        }
                    }
                    if history.entries.len() > MAX_HYDRATION_ENTRIES {
                        bail!("Codex history exceeds bounded hydration limit");
                    }
                }
                match value.get("nextCursor") {
                    Some(Value::String(cursor))
                        if !cursor.is_empty() && cursors.insert(cursor.clone()) =>
                    {
                        self.conversation_requests.insert(
                            token,
                            Pending::Hydration {
                                id,
                                generation,
                                history,
                                cursors,
                                read,
                                started,
                                changed,
                                bytes,
                            },
                        );
                        self.conversation_runtimes.request(
                            id,
                            generation,
                            token,
                            Rpc::ReadHistory {
                                session: thread,
                                cursor: Some(cursor.clone()),
                                limit: history::MAX_READ_ENTRIES,
                            },
                        )?;
                    }
                    None | Some(Value::Null) => {
                        if matches!(
                            history.completeness,
                            Completeness::Unknown | Completeness::Loading
                        ) {
                            history.set_completeness(if changed {
                                Completeness::Incomplete(history::IncompleteReason::Disconnected)
                            } else {
                                Completeness::Complete
                            })?;
                        }
                        let history_ready = {
                            let state = self.conversation_states.entry(id).or_default();
                            state.history_revision = state
                                .history_revision
                                .max(history.revision)
                                .checked_add(1)
                                .ok_or_else(|| anyhow::anyhow!("History revision exhausted"))?;
                            history.revision = state.history_revision;
                            state.history_ready = history.completeness == Completeness::Complete;
                            if !state.blocked
                                && state.status == Status::Working
                                && !history.entries.iter().any(|e| {
                                    e.content == history::Content::TurnStatus
                                        && e.state == history::ItemState::Running
                                })
                            {
                                state.status = Status::Idle;
                            }
                            if started.is_some() && !state.history_ready {
                                state.status = Status::Blocked;
                                state.error = Some(
                                    "Codex history is incomplete; chat takeover is disabled".into(),
                                );
                            }
                            state.history_ready
                        };
                        if self.cfg.restore.output && self.cfg.restore.enabled {
                            self.conversation_histories.insert(id, history.clone());
                            self.cache_conversation(id);
                        }
                        if let Some(read) = read {
                            self.conversation_history
                                .hydrate_native(read.client, history.clone())?;
                            self.reply_history(id, read)?;
                        }
                        if let Some(client) = started {
                            if history_ready {
                                self.send(
                                    client,
                                    ServerMsg::Reply(Reply::ConversationStarted {
                                        id,
                                        generation,
                                    }),
                                );
                                self.continue_cut_turn(client, id, generation);
                            } else {
                                let message = "Codex history is incomplete; chat takeover is disabled";
                                self.send(client, ServerMsg::Error(message.into()));
                            }
                        }
                    }
                    _ => bail!("Codex history cursor is invalid or repeated"),
                }
            }
            other => {
                self.conversation_fail(other, "Unexpected provider response stage".into());
            }
        }
        self.dirty = true;
        Ok(())
    }
}
