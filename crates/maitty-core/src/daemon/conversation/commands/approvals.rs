//! Answering what a provider asks: approvals, remembered commands and user input.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_approve(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        request_id: ProviderRequestId,
        decision: ApprovalDecision,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can answer provider approval requests");
        }
        self.may(client, Grant::Respond, None)?;
        self.answer_approval(id, generation, request_id, decision)?;
        self.send(client, ServerMsg::Reply(Reply::Ok));
        Ok(())
    }

    /// Answers a provider approval request with `decision`, after whoever asks has been checked. The
    /// request must belong to the acknowledged active turn of a running conversation.
    pub(in crate::daemon) fn answer_approval(
        &mut self,
        id: ConversationId,
        generation: u64,
        request_id: ProviderRequestId,
        decision: ApprovalDecision,
    ) -> Result<()> {
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if conversation.generation != generation || conversation.state != RecoveryState::Running {
            bail!("Approval request belongs to a stale or stopped conversation");
        }
        let active_turn = self
            .conversation_operations
            .iter()
            .find(|operation| operation.receipt.conversation == id)
            .and_then(|operation| match &operation.receipt.delivery {
                crate::conversation::Delivery::Acknowledged { turn_id } => Some(turn_id.as_str()),
                crate::conversation::Delivery::SubmissionUncertain => None,
            });
        let state = self
            .conversation_states
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Conversation has no active approval request"))?;
        let approval = state
            .approvals
            .get(&request_id)
            .ok_or_else(|| anyhow::anyhow!("Approval request is stale or already answered"))?;
        if approval.turn_id.as_deref() != active_turn {
            bail!("Approval request does not belong to the acknowledged active turn");
        }
        if !matches!(
            approval.kind,
            crate::conversation::ApprovalRequestKind::Command
                | crate::conversation::ApprovalRequestKind::FileChange
                | crate::conversation::ApprovalRequestKind::Permission
        ) {
            bail!("This provider request kind does not support approval decisions");
        }
        if !approval.choices.contains(&decision) {
            bail!("That decision is not available for this provider request");
        }
        let response = if approval.kind == crate::conversation::ApprovalRequestKind::Permission {
            maitty_provider_codex::requests::permission_response(decision, approval.permissions.as_ref())?
        } else {
            maitty_provider_codex::requests::decision_response(decision)
        };
        self.conversation_runtimes.request(
            id,
            generation,
            0,
            Rpc::Answer {
                request_id: request_id.clone().into(),
                response,
            },
        )?;
        if let Some(state) = self.conversation_states.get_mut(&id) {
            state.command_hashes.remove(&request_id);
            if let Some(answered) = state.approvals.remove(&request_id) {
                state.record_answer(answered, decision);
            }
            state.blocked = !state.approvals.is_empty() || !state.unsupported_requests.is_empty();
            state.status = if state.blocked {
                Status::Blocked
            } else {
                Status::Working
            };
            state.error = state.unsupported_requests.values().next().cloned();
        }
        self.dirty = true;
        Ok(())
    }

    /// A person approves a command request and has it remembered for the conversation's project
    /// (ADR 0005): the same command is then approved without asking. Only a command request can be
    /// remembered, and only by a human.
    pub(in crate::daemon) fn conversation_allow_always(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        request_id: ProviderRequestId,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can answer provider approval requests");
        }
        self.may(client, Grant::Respond, None)?;
        let state = self.conversation_states.get(&id);
        let approval = state
            .and_then(|state| state.approvals.get(&request_id))
            .ok_or_else(|| anyhow::anyhow!("Approval request is stale or already answered"))?;
        let (Some(hash), true) = (
            state.and_then(|state| state.command_hashes.get(&request_id)).cloned(),
            approval.kind == crate::conversation::ApprovalRequestKind::Command
                && approval.can_remember,
        ) else {
            bail!("Only a command request can be approved for the project");
        };
        let shown = approval.command.clone().unwrap_or_default();
        let project = self.conversation_project(id)?;
        // Answer first: a request that cannot be answered now is never remembered.
        self.answer_approval(id, generation, request_id, ApprovalDecision::Accept)?;
        let rule = super::super::allowed::Rule {
            project,
            command_sha256: hash,
            command: shown,
            at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs()),
        };
        self.chat_allowed.add(rule.clone());
        let file = self.chat_allowed_file.clone();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = super::super::allowed::remember(&file, rule) {
                tracing::warn!("saving the commands approved for a project: {e:#}");
            }
        });
        self.send(client, ServerMsg::Reply(Reply::Ok));
        Ok(())
    }

    /// The project a conversation belongs to: its repository's main checkout, else its folder.
    pub(in crate::daemon) fn conversation_project(&self, id: ConversationId) -> Result<std::path::PathBuf> {
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        let folder = conversation
            .binding
            .worktree
            .as_deref()
            .unwrap_or(&conversation.binding.cwd);
        Ok(crate::gitfs::head(folder).map_or_else(|| folder.to_path_buf(), |head| head.main_root))
    }

    /// Answers a command request at once when its project approved exactly that command before.
    /// Called as a request arrives; a request that is not remembered is left for the person.
    pub(in crate::daemon) fn auto_approve_remembered(
        &mut self,
        id: ConversationId,
        request_id: &ProviderRequestId,
    ) {
        let Some(state) = self.conversation_states.get(&id) else {
            return;
        };
        let Some(approval) = state.approvals.get(request_id) else {
            return;
        };
        let (Some(hash), true) = (
            state.command_hashes.get(request_id).cloned(),
            approval.kind == crate::conversation::ApprovalRequestKind::Command
                && approval.choices.contains(&ApprovalDecision::Accept),
        ) else {
            return;
        };
        let (Ok(project), Some(generation)) = (
            self.conversation_project(id),
            self.conversations
                .iter()
                .find(|conversation| conversation.id == id)
                .map(|conversation| conversation.generation),
        ) else {
            return;
        };
        if !self.chat_allowed.allows_hash(&project, &hash) {
            return;
        }
        if let Err(error) = self.answer_approval(id, generation, request_id.clone(), ApprovalDecision::Accept) {
            // Left for the person to answer by hand.
            tracing::warn!("a remembered command approval could not be answered: {error:#}");
        }
    }

    pub(in crate::daemon) fn conversation_answer_input(
        &mut self,
        client: ClientId,
        id: ConversationId,
        generation: u64,
        request_id: ProviderRequestId,
        answers: std::collections::BTreeMap<String, Vec<String>>,
    ) -> Result<()> {
        self.refuse_if_followed(id)?;
        if self
            .clients
            .get(&client)
            .is_some_and(|owner| owner.from.is_some() || owner.structured.is_some())
        {
            bail!("Only a human client can answer provider input requests");
        }
        self.may(client, Grant::Respond, None)?;
        let conversation = self
            .conversations
            .iter()
            .find(|conversation| conversation.id == id)
            .ok_or_else(|| anyhow::anyhow!("No such conversation"))?;
        if conversation.generation != generation || conversation.state != RecoveryState::Running {
            bail!("Input request belongs to a stale or stopped conversation");
        }
        let active_turn = self
            .conversation_operations
            .iter()
            .find(|operation| operation.receipt.conversation == id)
            .and_then(|operation| match &operation.receipt.delivery {
                crate::conversation::Delivery::Acknowledged { turn_id } => Some(turn_id.as_str()),
                crate::conversation::Delivery::SubmissionUncertain => None,
            });
        let state = self
            .conversation_states
            .get(&id)
            .ok_or_else(|| anyhow::anyhow!("Conversation has no active input request"))?;
        let request = state
            .approvals
            .get(&request_id)
            .ok_or_else(|| anyhow::anyhow!("Input request is stale or already answered"))?;
        if request.kind != crate::conversation::ApprovalRequestKind::UserInput
            || request.turn_id.as_deref() != active_turn
        {
            bail!("Input request does not belong to the acknowledged active turn");
        }
        anyhow::ensure!(
            answers.len() == request.questions.len()
                && request
                    .questions
                    .iter()
                    .all(|question| answers.contains_key(&question.id)),
            "Answer every requested question exactly once"
        );
        for question in &request.questions {
            let values = &answers[&question.id];
            anyhow::ensure!(!values.is_empty(), "Each question needs an answer");
            let mut seen = std::collections::BTreeSet::new();
            for value in values {
                anyhow::ensure!(
                    !value.is_empty() && value.chars().count() <= MAX_USER_INPUT_ANSWER_CHARS,
                    "Input answers must be nonempty and no longer than 10,000 characters"
                );
                crate::hidden::check(value).map_err(anyhow::Error::msg)?;
                anyhow::ensure!(seen.insert(value), "An answer was selected more than once");
                if !question.options.is_empty()
                    && !question.options.iter().any(|option| option.label == *value)
                    && !(question.is_other
                        && value
                            .strip_prefix("user_note: ")
                            .is_some_and(|note| !note.trim().is_empty()))
                {
                    bail!(
                        "Answer for '{}' is not one of the available choices",
                        question.header
                    );
                }
            }
        }
        self.conversation_runtimes.request(
            id,
            generation,
            0,
            Rpc::Answer {
                request_id: request_id.clone().into(),
                response: maitty_provider_codex::requests::user_input_response(answers),
            },
        )?;
        if let Some(state) = self.conversation_states.get_mut(&id) {
            state.approvals.remove(&request_id);
            state.blocked = !state.approvals.is_empty() || !state.unsupported_requests.is_empty();
            state.status = if state.blocked {
                Status::Blocked
            } else {
                Status::Working
            };
            state.error = state.unsupported_requests.values().next().cloned();
        }
        self.send(client, ServerMsg::Reply(Reply::Ok));
        self.dirty = true;
        Ok(())
    }
}
