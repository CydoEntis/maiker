//! Sending a message: admission, the queue, receipts and sending into a running turn.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_send(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
        text: String,
        choice: TurnChoice,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        self.may(client, Grant::Write, None)?;
        self.durable_conversation()?;
        choice.validate().map_err(anyhow::Error::msg)?;
        crate::hidden::check(&text).map_err(anyhow::Error::msg)?;
        if text.trim().is_empty() || text.len() > MAX_PROMPT_BYTES || operation == 0 {
            bail!("A bounded nonempty prompt and nonzero monotonic operation ID are required");
        }
        let c = self
            .conversations
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if c.generation != generation {
            bail!("Stale conversation generation");
        }
        let digest = format!("{:x}", Sha256::digest(text.as_bytes()));
        // A message already waiting is the same send again (a retry), or a reused number. Looked
        // at first: a message sent now out of turn leaves a receipt with a higher number than one
        // still waiting, which must not make that one's retry look stale.
        if let Some(waiting) = self
            .conversation_queues
            .get(&id)
            .and_then(|queue| queue.iter().find(|m| m.operation == operation))
        {
            if waiting.generation == generation && waiting.digest == digest {
                self.send(
                    client,
                    ServerMsg::Reply(Reply::ConversationQueued(QueuedReceipt {
                        conversation: id,
                        generation,
                        operation,
                    })),
                );
                return Ok(());
            }
            bail!("Operation ID is stale or reused with changed content");
        }
        // Acknowledged before, whatever the conversation's single receipt says now.
        if let Some(done) = self.acknowledged(id, generation, operation) {
            if done.digest == digest {
                let receipt = done.receipt.clone();
                self.send(client, ServerMsg::Reply(Reply::ConversationSent(receipt)));
                return Ok(());
            }
            bail!("Operation ID is stale or reused with changed content");
        }
        if let Some(old) = self
            .conversation_operations
            .iter()
            .find(|o| o.receipt.conversation == id)
        {
            if old.receipt.operation == operation
                && old.receipt.generation == generation
                && old.digest == digest
            {
                if matches!(old.receipt.delivery, Delivery::Acknowledged { .. })
                    && !self
                        .conversation_requests
                        .values()
                        .any(|p| matches!(p,Pending::Receipt {receipt,..} if receipt==&old.receipt))
                {
                    self.send(
                        client,
                        ServerMsg::Reply(Reply::ConversationSent(old.receipt.clone())),
                    );
                    return Ok(());
                }
                bail!("Submission delivery is uncertain; automatic resend is refused");
            }
            if operation <= old.receipt.operation {
                bail!("Operation ID is stale or reused with changed content");
            }
            if old.receipt.delivery == Delivery::SubmissionUncertain {
                bail!("Previous submission delivery remains uncertain");
            }
        }
        if self
            .conversation_queues
            .get(&id)
            .and_then(|queue| queue.last())
            .is_some_and(|last| operation <= last.operation)
        {
            bail!("Operation ID is stale or reused with changed content");
        }
        let state = self
            .conversation_states
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Conversation runtime is not ready"))?;
        if c.state != RecoveryState::Running || state.blocked {
            bail!("Conversation is busy, blocked or not ready");
        }
        if !state.history_ready {
            bail!("Native history is incomplete; read it before submitting");
        }
        // The agent is mid-turn (or a send is in flight, or earlier messages are waiting): the
        // daemon holds the message, so it survives the window and goes out in order.
        let busy = state.status == Status::Working
            || self
                .conversation_requests
                .values()
                .any(|p| p.conversation() == id)
            || self
                .conversation_queues
                .get(&id)
                .is_some_and(|queue| !queue.is_empty());
        let message = Outgoing {
            text,
            digest,
            choice,
        };
        if busy {
            return self.conversation_enqueue(client, id, generation, operation, message);
        }
        self.conversation_submit(client, id, generation, operation, message)
    }

    /// Hands a message to the runtime now: records its receipt, then submits once that is durable.
    pub(super) fn conversation_submit(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
        message: Outgoing,
    ) -> Result<()> {
        let Outgoing {
            text,
            digest,
            choice,
        } = message;
        let receipt = Receipt {
            conversation: id,
            generation,
            operation,
            delivery: Delivery::SubmissionUncertain,
        };
        self.conversation_operations
            .retain(|o| o.receipt.conversation != id);
        self.conversation_operations.push(Operation {
            receipt: receipt.clone(),
            digest,
        });
        let token = self.conversation_token(Pending::Submit {
            client,
            receipt,
            text,
            choice,
        })?;
        self.conversation_persist(token)?;
        Ok(())
    }

    /// Keep the checkout's files as they are `when` ("before", "after") a turn. Before: once
    /// a message was handed to the provider, which happens once a turn. After: once the
    /// provider said the turn completed, failed or was interrupted.
    pub(in crate::daemon::conversation) fn snapshot_conversation_turn(&self, id: ConversationId, when: &str) {
        if !self.cfg.snapshots.enabled {
            return;
        }
        let Some(c) = self.conversations.iter().find(|c| c.id == id) else {
            return;
        };
        // Named as a terminal agent's snapshots are, so the list reads the same for both.
        let agent = c.binding.provider.agent_name();
        let dir = c.binding.worktree.as_ref().unwrap_or(&c.binding.cwd);
        self.snapshot_off_loop(format!("{when} {agent}'s turn"), dir.clone());
    }

    pub(super) fn conversation_enqueue(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
        message: Outgoing,
    ) -> Result<()> {
        let Outgoing {
            text,
            digest,
            choice,
        } = message;
        let queue = self.conversation_queues.entry(id).or_default();
        if queue.len() >= MAX_QUEUED_MESSAGES
            || queue.iter().map(|m| m.text.len()).sum::<usize>() + text.len() > MAX_QUEUED_BYTES
        {
            bail!("Too many messages are waiting; wait for the agent to catch up");
        }
        queue.push(QueuedSend {
            generation,
            operation,
            text,
            digest,
            choice,
        });
        self.send(
            client,
            ServerMsg::Reply(Reply::ConversationQueued(QueuedReceipt {
                conversation: id,
                generation,
                operation,
            })),
        );
        self.dirty = true;
        Ok(())
    }

    /// Takes a waiting message back out of the queue.
    pub(in crate::daemon) fn conversation_dequeue(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        self.may(client, Grant::Write, None)?;
        if self.steering(id, operation) {
            bail!("That message is being sent now");
        }
        let found = self.conversation_queues.get_mut(&id).and_then(|queue| {
            let position = queue
                .iter()
                .position(|m| m.operation == operation && m.generation == generation)?;
            queue.remove(position);
            Some(())
        });
        if found.is_none() {
            bail!("That message is no longer waiting; it may already have been sent");
        }
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }

    /// Remembers an acknowledged message, the oldest forgotten past `RECENT_OPERATIONS`.
    pub(super) fn remember_acknowledged(&mut self, operation: Operation) {
        let recent = self
            .conversation_recent
            .entry(operation.receipt.conversation)
            .or_default();
        recent.retain(|o| {
            !(o.receipt.generation == operation.receipt.generation
                && o.receipt.operation == operation.receipt.operation)
        });
        if recent.len() >= RECENT_OPERATIONS {
            recent.pop_front();
        }
        recent.push_back(operation);
    }

    /// The remembered acknowledged message with this number in this generation.
    pub(super) fn acknowledged(&self, id: ConversationId, generation: u64, operation: u64) -> Option<&Operation> {
        self.conversation_recent.get(&id)?.iter().find(|o| {
            o.receipt.generation == generation && o.receipt.operation == operation
        })
    }

    /// Whether a queued message is on its way into the running turn right now.
    pub(super) fn steering(&self, id: ConversationId, operation: u64) -> bool {
        self.conversation_requests.values().any(|pending| {
            matches!(pending, Pending::Steering { id: steering, operation: steered, .. }
                if *steering == id && *steered == operation)
        })
    }

    /// Sends a waiting message now rather than when the turn ends: steered into the running turn
    /// when the provider can take it there, otherwise by stopping the turn and sending the message
    /// as the next one. A message is only ever taken out of the queue once the provider has it, so
    /// every refusal leaves it waiting, and the ordinary delivery then sends it.
    pub(in crate::daemon) fn conversation_send_now(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        self.may(client, Grant::Write, None)?;
        let record = self
            .conversations
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if record.generation != generation {
            bail!("Stale conversation generation");
        }
        let running = record.state == RecoveryState::Running;
        let thread = record.binding.session_id.clone();
        // A retry while the steer is on its way is the same ask, not a second one.
        if self.steering(id, operation) {
            self.send(client, ServerMsg::Reply(Reply::Ok));
            return Ok(());
        }
        let position = self
            .conversation_queues
            .get(&id)
            .and_then(|queue| {
                queue
                    .iter()
                    .position(|m| m.operation == operation && m.generation == generation)
            })
            .map_or_else(
                || {
                    // Sent already, by a steer or a delivery whose reply was lost: the same ask
                    // again is answered, not refused, and nothing is sent.
                    if self.acknowledged(id, generation, operation).is_some() {
                        Ok(None)
                    } else {
                        Err(anyhow::anyhow!(
                            "That message is no longer waiting; it may already have been sent or taken back"
                        ))
                    }
                },
                |position| Ok(Some(position)),
            )?;
        let Some(position) = position else {
            self.send(client, ServerMsg::Reply(Reply::Ok));
            return Ok(());
        };
        let state = self
            .conversation_states
            .get(&id)
            .filter(|_| running)
            .ok_or_else(|| anyhow::anyhow!("Conversation runtime is not ready"))?;
        if state.blocked
            || !state.approvals.is_empty()
            || !state.unsupported_requests.is_empty()
        {
            bail!("Answer the pending approval or question before sending a message now");
        }
        let working = state.status == Status::Working;
        let stopping = state.cancelling.is_some();
        let can_steer = self.conversation_runtimes.can_steer(id, generation);
        // Next in line, ahead of what was queued before it: it is the one the person chose.
        let to_front = |daemon: &mut Self| {
            if let Some(queue) = daemon.conversation_queues.get_mut(&id) {
                let message = queue.remove(position);
                queue.insert(0, message);
            }
        };
        if !working || stopping {
            // The turn is over, or already being stopped: the ordinary delivery is what is
            // wanted, and it goes first.
            to_front(self);
            self.send(client, ServerMsg::Reply(Reply::Ok));
            self.deliver_queued();
            self.dirty = true;
            return Ok(());
        }
        let in_flight = self
            .conversation_requests
            .values()
            .any(|pending| pending.conversation() == id);
        if in_flight {
            bail!("The agent is taking a message already; try again in a moment");
        }
        if can_steer {
            let turn_id = self
                .conversation_operations
                .iter()
                .find(|o| o.receipt.conversation == id && o.receipt.generation == generation)
                .and_then(|o| match &o.receipt.delivery {
                    Delivery::Acknowledged { turn_id } => Some(turn_id.clone()),
                    Delivery::SubmissionUncertain => None,
                })
                .ok_or_else(|| {
                    anyhow::anyhow!("The running turn is not identified yet; try again in a moment")
                })?;
            let text = self.conversation_queues[&id][position].text.clone();
            let steered_turn = turn_id.clone();
            let token = self.conversation_token(Pending::Steering {
                client,
                id,
                generation,
                operation,
                turn_id,
            })?;
            if let Err(error) =
                self.conversation_runtimes
                    .request(
                        id,
                        generation,
                        token,
                        Rpc::Steer { session: thread, turn: steered_turn, text },
                    )
            {
                self.conversation_requests.remove(&token);
                return Err(error);
            }
            self.dirty = true;
            return Ok(());
        }
        // No way to add to a running turn: stop it, and the message goes out as the next one.
        self.interrupt_turn(client, id, generation, true)?;
        to_front(self);
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }

    /// The provider took a steered message into the running turn: it leaves the queue, and its
    /// number is answered as sent from then on.
    pub(super) fn steered(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
        turn_id: String,
    ) {
        let taken = self.conversation_queues.get_mut(&id).and_then(|queue| {
            let position = queue
                .iter()
                .position(|m| m.operation == operation && m.generation == generation)?;
            Some(queue.remove(position))
        });
        let current = self
            .conversations
            .iter()
            .any(|c| c.id == id && c.generation == generation);
        if let (Some(message), true) = (taken, current) {
            let steered = Operation {
                receipt: Receipt {
                    conversation: id,
                    generation,
                    operation,
                    delivery: Delivery::Acknowledged { turn_id },
                },
                digest: message.digest,
            };
            self.conversation_operations
                .retain(|o| o.receipt.conversation != id);
            self.conversation_operations.push(steered.clone());
            self.remember_acknowledged(steered);
        }
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
    }

    /// Delivers the oldest waiting message of every conversation whose turn has ended: once, in
    /// order, and never into a turn that is running, an unanswered request or a send in flight.
    /// Called on the daemon's tick, so the window need not be open.
    pub(in crate::daemon) fn deliver_queued(&mut self) {
        let waiting: Vec<ConversationId> = self
            .conversation_queues
            .iter()
            .filter(|(_, queue)| !queue.is_empty())
            .map(|(id, _)| *id)
            .collect();
        for id in waiting {
            let current = self
                .conversations
                .iter()
                .find(|c| c.id == id)
                .map(|c| (c.generation, c.state));
            let Some((generation, record_state)) = current else {
                self.conversation_queues.remove(&id);
                continue;
            };
            // A message belongs to the runtime it was sent to; after a restart of the
            // conversation it is not delivered into the new one.
            if let Some(queue) = self.conversation_queues.get_mut(&id) {
                let before = queue.len();
                queue.retain(|m| m.generation == generation);
                if queue.len() != before {
                    tracing::info!("dropped queued messages of a conversation that started over");
                    self.dirty = true;
                }
            }
            let Some(state) = self.conversation_states.get(&id) else {
                continue;
            };
            let ready = record_state == RecoveryState::Running
                && !state.blocked
                && state.history_ready
                && state.status != Status::Working
                && state.approvals.is_empty()
                && state.unsupported_requests.is_empty()
                && state.cancelling.is_none()
                && !self
                    .conversation_requests
                    .values()
                    .any(|p| p.conversation() == id)
                && !self.conversation_operations.iter().any(|o| {
                    o.receipt.conversation == id
                        && o.receipt.delivery == Delivery::SubmissionUncertain
                });
            if !ready {
                continue;
            }
            let Some(queue) = self.conversation_queues.get_mut(&id) else {
                continue;
            };
            if queue.is_empty() {
                continue;
            }
            // Out of the queue first: a message is handed over once, never twice.
            let next = queue.remove(0);
            self.dirty = true;
            if let Err(error) = self.conversation_submit(
                NO_CLIENT,
                id,
                next.generation,
                next.operation,
                Outgoing {
                    text: next.text,
                    digest: next.digest,
                    choice: next.choice,
                },
            ) {
                let state = self.conversation_states.entry(id).or_default();
                state.error = Some(format!("A queued message could not be sent: {error}"));
            }
        }
    }
}
