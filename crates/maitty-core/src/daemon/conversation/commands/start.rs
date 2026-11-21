//! Starting a conversation: admission, identity, validation and the first save.

use super::*;

impl Daemon {
    pub(in crate::daemon) fn conversation_start(
        &mut self,
        client: ClientId,
        target: StartTarget,
    ) -> Result<()> {
        if client == DAEMON_REQUESTER && !matches!(target, StartTarget::Conversation { .. }) {
            bail!("The daemon may only resume an existing conversation");
        }
        self.may(client, Grant::Start, None)?;
        self.durable_conversation()?;
        let by = self.starting(client, "a structured Codex conversation")?;
        let identity = match target {
            StartTarget::Create(settings)
            | StartTarget::Session {
                settings,
                thread_id: _,
            } if !settings.cwd.is_absolute()
                || !settings.config_root.is_absolute()
                || !settings.executable.is_absolute() =>
            {
                bail!("Conversation paths must be absolute")
            }
            StartTarget::Create(settings) => {
                validate_settings(&settings)
                    .map_err(|_| anyhow::anyhow!("Invalid structured launch settings"))?;
                let id = self.next_conversation_id()?;
                let pending = PendingStart {
                    id,
                    generation: 1,
                    settings,
                    thread_id: None,
                };
                self.pending_starts.push(pending.clone());
                LaunchIdentity::Pending(pending)
            }
            StartTarget::Session {
                settings,
                thread_id,
            } => {
                validate_settings(&settings)
                    .map_err(|_| anyhow::anyhow!("Invalid structured launch settings"))?;
                if thread_id.trim().is_empty() || thread_id.chars().any(char::is_control) {
                    bail!("An exact nonempty thread ID is required");
                }
                if self.conversations.iter().any(|c| {
                    c.binding.provider == settings.provider
                        && c.binding.session_id == thread_id
                        && c.binding.config_root == settings.config_root
                }) || self.pending_starts.iter().any(|p| {
                    p.settings.provider == settings.provider
                        && p.thread_id.as_ref() == Some(&thread_id)
                        && p.settings.config_root == settings.config_root
                }) {
                    bail!(concat!(
                        "Exact thread is already owned by ",
                        env!("APP_COMMAND"),
                        "; use --conversation"
                    ));
                }
                let pending = PendingStart {
                    id: self.next_conversation_id()?,
                    generation: 1,
                    settings,
                    thread_id: Some(thread_id),
                };
                self.pending_starts.push(pending.clone());
                LaunchIdentity::Pending(pending)
            }
            StartTarget::Conversation { id, generation } => {
                if self.conversation_runtimes.owns(id)
                    || self
                        .conversation_requests
                        .values()
                        .any(|p| p.conversation() == id)
                {
                    bail!("Conversation already owns a runtime or pending operation");
                }
                if self.terms.values().any(|t| t.conversation_id == Some(id)) {
                    bail!("A native terminal still owns this conversation");
                }
                let c = self.conversations.iter_mut().find(|c| c.id == id).ok_or_else(|| anyhow::anyhow!("No complete conversation with that ID; unresolved creation requires investigation"))?;
                if c.generation != generation {
                    bail!("Stale conversation generation");
                }
                if c.execution != ExecutionKind::Structured {
                    bail!("Native conversation history must be reconciled before chat takeover");
                }
                if c.settings.is_none() {
                    bail!("Conversation has no verified structured launch settings");
                }
                c.generation = c
                    .generation
                    .checked_add(1)
                    .ok_or_else(|| anyhow::anyhow!("Conversation generation exhausted"))?;
                c.state = RecoveryState::Stopped;
                LaunchIdentity::Existing(Box::new(c.clone()))
            }
        };
        let launch = Launch {
            identity,
            environment: std::env::vars_os()
                .filter(|(key, value)| {
                    let valid_entry = valid_provider_environment_entry(key, value);
                    let key = key.to_string_lossy();
                    valid_entry
                        && !crate::ipc::is_identity_env(&key)
                        && ![
                            "CODEX_HOME",
                            "CLAUDE_CONFIG_DIR",
                        ]
                        .iter()
                        .any(|excluded| key.eq_ignore_ascii_case(excluded))
                })
                .map(|(key, value)| match crate::login_path::resolved() {
                    Some(path) if key.eq_ignore_ascii_case("PATH") => (key, path.to_os_string()),
                    _ => (key, value),
                })
                .collect(),
            #[cfg(test)]
            failure_point: None,
        };
        let id = launch.id();
        let state = self.conversation_states.entry(id).or_default();
        state.status = Status::Working;
        state.started_by = by.or(state.started_by);
        state.started_at = Some(std::time::Instant::now());
        let token = self.conversation_token(Pending::Validating { client, id })?;
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let result = launch.validate().await.map_err(|e| e.to_string());
            // A closed daemon has no consumer for the completed admission.
            let _ = tx
                .send(crate::daemon::Ev::ConversationValidated { token, result })
                .await;
        });
        self.dirty = true;
        Ok(())
    }

    pub(super) fn next_conversation_id(&self) -> Result<ConversationId> {
        let last = self
            .conversations
            .iter()
            .map(|c| c.id.0)
            .chain(self.pending_starts.iter().map(|p| p.id.0))
            .chain(self.followed.iter().map(|f| f.id.0))
            .chain(std::iter::once(self.followed_high_water))
            .max()
            .unwrap_or(0);
        last.checked_add(1)
            .map(ConversationId)
            .ok_or_else(|| anyhow::anyhow!("Conversation identity exhausted"))
    }

    pub(in crate::daemon) fn conversation_validated(
        &mut self,
        token: u64,
        result: std::result::Result<Launch, String>,
    ) {
        let Some(pending) = self.conversation_requests.remove(&token) else {
            return;
        };
        let Pending::Validating { client, id } = &pending else {
            self.conversation_fail(pending, "Unexpected admission stage".into());
            return;
        };
        let (client, id) = (*client, *id);
        let launch = match result {
            Ok(launch) => launch,
            Err(error) => {
                self.conversation_fail(pending, error);
                return;
            }
        };
        let valid = match &launch.identity {
            LaunchIdentity::Pending(p) => {
                let duplicate = p.thread_id.as_ref().is_some_and(|thread| {
                    self.conversations.iter().any(|c| {
                        c.binding.provider == p.settings.provider
                            && c.binding.session_id == *thread
                            && c.binding.config_root == p.settings.config_root
                    }) || self.pending_starts.iter().any(|other| {
                        other.id != id
                            && other.settings.provider == p.settings.provider
                            && other.thread_id.as_ref() == Some(thread)
                            && other.settings.config_root == p.settings.config_root
                    })
                });
                if let Some(record) = self
                    .pending_starts
                    .iter_mut()
                    .find(|record| record.id == id)
                {
                    *record = p.clone();
                }
                !duplicate
            }
            LaunchIdentity::Existing(c) => {
                if let Some(record) = self
                    .conversations
                    .iter_mut()
                    .find(|record| record.id == id && record.generation == c.generation)
                {
                    *record = (**c).clone();
                    true
                } else {
                    false
                }
            }
        };
        if !valid {
            self.conversation_fail(
                pending,
                "Conversation identity is duplicate or stale after path resolution".into(),
            );
            return;
        }
        self.conversation_requests.insert(
            token,
            Pending::Launch {
                client,
                launch: Box::new(launch),
            },
        );
        if let Err(error) = self.conversation_persist(token) {
            self.send(client, ServerMsg::Error(error.to_string()));
        }
    }

    pub(super) fn conversation_persist(&mut self, token: u64) -> Result<()> {
        if let Err(error) = self.persist_barrier(token) {
            if let Some(pending) = self.conversation_requests.remove(&token) {
                self.conversation_fail(pending, error.to_string());
            }
            return Err(error);
        }
        Ok(())
    }
}
