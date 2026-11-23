//! Stopping work: cancelling a turn, ending an agent, closing a chat and undoing that.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_cancel(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can cancel a structured turn");
        }
        self.may(client, Grant::Write, None)?;
        self.interrupt_turn(client, id, generation, false)?;
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }

    /// Asks the provider to interrupt the conversation's running turn, which must be the
    /// acknowledged one. It answers nothing to `client`; asking again while an interrupt is
    /// pending changes nothing.
    pub(super) fn interrupt_turn(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        for_send_now: bool,
    ) -> Result<()> {
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if conversation.generation != generation || conversation.state != RecoveryState::Running {
            bail!("Turn belongs to a stale or stopped conversation");
        }
        let thread_id = conversation.binding.session_id.clone();
        let state = self
            .conversation_states
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Conversation runtime is not ready"))?;
        if !matches!(state.status, Status::Working | Status::Blocked) {
            bail!("Conversation has no active turn to cancel");
        }
        let operation = self
            .conversation_operations
            .iter()
            .find(|operation| operation.receipt.conversation == id)
            .ok_or_else(|| anyhow::anyhow!("Conversation has no acknowledged turn"))?;
        if operation.receipt.generation != generation {
            bail!("Active turn belongs to a stale conversation generation");
        }
        let Delivery::Acknowledged { turn_id } = &operation.receipt.delivery else {
            bail!(
                "Turn delivery is uncertain; {} cannot safely identify it to cancel",
                crate::brand::APP_NAME
            );
        };
        let turn_id = turn_id.clone();
        let cancellation_pending = state.cancelling.as_deref() == Some(turn_id.as_str())
            || self.conversation_requests.values().any(|pending| {
                matches!(pending, Pending::Cancelling { id: pending_id, generation: pending_generation, turn_id: pending_turn, .. }
                    if *pending_id == id && *pending_generation == generation && pending_turn == &turn_id)
            });
        if cancellation_pending {
            return Ok(());
        }
        let token = self.conversation_token(Pending::Cancelling {
            client,
            id,
            generation,
            turn_id: turn_id.clone(),
            for_send_now,
        })?;
        let request = self.conversation_runtimes.request(
            id,
            generation,
            token,
            Rpc::Interrupt { session: thread_id, turn: turn_id.clone() },
        );
        if let Err(error) = request {
            self.conversation_requests.remove(&token);
            return Err(error);
        }
        self.conversation_states
            .get_mut(&id)
            .expect("validated conversation state")
            .cancelling = Some(turn_id);
        self.dirty = true;
        Ok(())
    }

    /// Stop a chat conversation's agent on purpose. The record stays, stopped and
    /// idle, so its history is kept; the client then hides it.
    pub(in crate::daemon) fn conversation_end(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can end a conversation");
        }
        self.may(client, Grant::Write, None)?;
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if conversation.generation != generation {
            bail!("Conversation generation is stale");
        }
        if conversation.execution != ExecutionKind::Structured {
            bail!("A native terminal conversation ends with its terminal");
        }
        if self
            .conversation_requests
            .values()
            .any(|pending| pending.conversation() == id)
        {
            bail!("Conversation has a pending operation; try again in a moment");
        }
        self.stop_structured(id)?;
        self.send(client, ServerMsg::Reply(Reply::Ok));
        Ok(())
    }

    /// Stops a chat's agent for good and drops what was waiting for it. Its record stays, stopped.
    pub(super) fn stop_structured(&mut self, id: ConversationId) -> Result<()> {
        if self.conversation_runtimes.owns(id) {
            self.conversation_ending.insert(id);
            if let Err(error) = self.conversation_runtimes.dispose(id) {
                self.conversation_ending.remove(&id);
                return Err(error);
            }
        }
        // Ending the agent is the person's answer to what was waiting for it.
        self.conversation_queues.remove(&id);
        self.dirty = true;
        Ok(())
    }

    /// Closes a chat with an undo window: it is archived (hidden) at once and its agent keeps running
    /// until `UNDO_WINDOW` passes, when `finish_chat_closes` ends it. A second close keeps the first clock.
    pub(in crate::daemon) fn conversation_close(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can close a conversation");
        }
        self.may(client, Grant::Write, None)?;
        let conversation = self
            .conversations
            .iter_mut()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if conversation.generation != generation {
            bail!("Conversation generation is stale");
        }
        if conversation.execution != ExecutionKind::Structured {
            bail!("A native terminal conversation closes with its terminal");
        }
        conversation.archived = true;
        self.conversation_closing
            .entry(id)
            .or_insert_with(std::time::Instant::now);
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }

    /// Brings back a chat closed with `conversation_close` while its window is open.
    pub(in crate::daemon) fn conversation_undo_close(
        &mut self,
        client: ClientId,
        id: ConversationId,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can bring back a conversation");
        }
        self.may(client, Grant::Write, None)?;
        if self.conversation_closing.remove(&id).is_none() {
            bail!("The undo window has passed");
        }
        if let Some(conversation) = self.conversations.iter_mut().find(|c| c.id == id) {
            conversation.archived = false;
        }
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }

    /// Ends the chats whose undo window has passed. One with an operation still pending is tried
    /// again on the next tick.
    pub(in crate::daemon) fn finish_chat_closes(&mut self) {
        let due: Vec<ConversationId> = self
            .conversation_closing
            .iter()
            .filter(|(_, at)| at.elapsed() >= crate::daemon::UNDO_WINDOW)
            .map(|(id, _)| *id)
            .collect();
        for id in due {
            if self
                .conversation_requests
                .values()
                .any(|pending| pending.conversation() == id)
            {
                continue;
            }
            self.conversation_closing.remove(&id);
            self.remember_closed_chat(id);
            let tops = self.worktrees_of_chat(id);
            match self.stop_structured(id) {
                // No client is waiting on a close whose window passed, so an unmerged
                // worktree stays and only the daemon log says why.
                Ok(()) => self.cleanup_worktrees(NO_CLIENT, tops),
                Err(error) => tracing::warn!("ending a closed chat: {error:#}"),
            }
        }
    }
}
