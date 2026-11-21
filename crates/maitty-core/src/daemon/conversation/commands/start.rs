//! Starting a conversation: admission, identity, validation and the first save.

use super::*;
use std::path::{Path, PathBuf};

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
        // Only a pane's agent starts a chat as its helper: a chat's own runtime is refused this
        // command before it gets here.
        let by = self
            .starting(client, "a structured Codex conversation")?
            .and_then(crate::daemon::helpers::Starter::pane);
        let (target, program) = self.acp_target(target)?;
        let identity = match target {
            // `acp_target` turned it into a start with the config's own program.
            StartTarget::Acp { .. } | StartTarget::Agent { .. } => bail!("A start by name was not resolved"),
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
                // Claude Code is not asked whether it knows the session, so a wrong name would only
                // fail at the first message; its transcript says now.
                if settings.provider == Provider::Claude
                    && !super::super::claude::transcript_path(&settings.config_root, &settings.cwd, &thread_id)
                        .is_some_and(|transcript| transcript.is_file())
                {
                    bail!("Claude Code has no saved conversation `{thread_id}` for this folder");
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
        let (executable, arguments, agent_environment) = match program {
            Some(program) => (Some(program.executable), program.arguments, program.environment),
            None => (None, Vec::new(), Vec::new()),
        };
        let mut identity = identity;
        // A saved ACP conversation runs the program the config names today.
        if let (Some(executable), LaunchIdentity::Existing(conversation)) = (executable, &mut identity) {
            conversation.binding.executable.clone_from(&executable);
            if let Some(settings) = &mut conversation.settings {
                settings.executable = executable;
            }
        }
        let launch = Launch {
            identity,
            arguments,
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
                // What the config sets for the agent wins over what the daemon inherited.
                .filter(|(key, _)| !agent_environment.iter().any(|(set, _)| same_variable(set, key)))
                .chain(agent_environment.iter().cloned())
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

    /// Resolves a start that runs an agent over ACP: the program, its arguments and its
    /// variables come from the daemon's config, never from the client that asked.
    fn acp_target(&self, target: StartTarget) -> Result<(StartTarget, Option<AcpProgram>)> {
        match target {
            StartTarget::Acp { agent, cwd } => {
                let program = self.acp_program(&agent)?;
                let settings = LaunchSettings {
                    provider: Provider::Acp,
                    executable: program.executable.clone(),
                    // An ACP agent is not pointed at a configuration; the folder stands in.
                    config_root: cwd.clone(),
                    cwd,
                    model: None,
                    model_provider: None,
                    // The agent asks before it acts and keeps its own limits; the daemon sets neither.
                    approval_policy: crate::conversation::ApprovalPolicy::OnRequest,
                    sandbox: crate::conversation::Sandbox::WorkspaceWrite,
                    agent: Some(agent),
                };
                Ok((StartTarget::Create(settings), Some(program)))
            }
            StartTarget::Agent { provider, cwd, sandbox, approval_policy } => {
                let (executable, config_root) = own_agent(provider)?;
                let settings = LaunchSettings {
                    agent: None,
                    provider,
                    executable,
                    config_root,
                    cwd,
                    model: None,
                    model_provider: None,
                    approval_policy,
                    sandbox,
                };
                Ok((StartTarget::Create(settings), None))
            }
            StartTarget::Create(settings) | StartTarget::Session { settings, .. }
                if settings.provider == Provider::Acp =>
            {
                bail!("An agent run over ACP is started by its name, not by a program")
            }
            StartTarget::Conversation { id, .. } => {
                let agent = self
                    .conversations
                    .iter()
                    .find(|conversation| conversation.id == id && conversation.binding.provider == Provider::Acp)
                    .map(|conversation| conversation.binding.agent.clone().unwrap_or_default());
                let program = agent.map(|agent| self.acp_program(&agent)).transpose()?;
                Ok((target, program))
            }
            other => Ok((other, None)),
        }
    }

}

const CODEX_PROGRAM: &str = if cfg!(windows) { "codex.exe" } else { "codex" };

/// The program and the settings folder of `provider`'s agent on this machine, for a start that
/// names neither (`StartTarget::Agent`): what a terminal pane here would run and read.
fn own_agent(provider: Provider) -> Result<(PathBuf, PathBuf)> {
    let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
    match provider {
        Provider::Claude => {
            let program = crate::daemon::conversation::side::claude_on_path()
                .ok_or_else(|| anyhow::anyhow!("Claude Code is not installed on this machine: no `claude` on its PATH"))?;
            let folder = std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .or_else(|| home.map(|home| home.join(".claude")))
                .ok_or_else(|| anyhow::anyhow!("This machine has no home folder to keep Claude Code's settings in"))?;
            Ok((program, folder))
        }
        Provider::Codex => {
            let search = crate::login_path::effective_path().or_else(|| std::env::var_os("PATH")).unwrap_or_default();
            let program = codex_from(&search)
                .ok_or_else(|| anyhow::anyhow!("Codex is not installed on this machine: no `codex` on its PATH"))?;
            Ok((program, crate::config::codex_config_dir()))
        }
        Provider::Gemini => bail!("Gemini has no structured chat; start it in a terminal"),
        Provider::Acp => bail!("An agent run over ACP is started by its name, not by a provider"),
    }
}

/// `codex` on `search`, the PATH a terminal pane's shell starts with.
fn codex_from(search: &std::ffi::OsStr) -> Option<PathBuf> {
    crate::shim::find_on_path(CODEX_PROGRAM, search, Path::new(""), &[])
}

impl Daemon {
    /// The program of the agent `name`: the config's entry, else the one installed from the ACP
    /// registry (ADR 0019). The installed list is one small file, read when a chat starts.
    fn acp_program(&self, name: &str) -> Result<AcpProgram> {
        let agent = self
            .cfg
            .acp_agent(name)
            .or_else(|| installed_agent(name, crate::acp_registry::installed(&crate::config::data_dir())))
            .ok_or_else(|| {
                anyhow::anyhow!("No agent named `{name}` runs over ACP here: it is not installed (`agents install {name}`) and the config has no entry for it (`acp = true`)")
            })?;
        let executable = crate::proc::resolve_executable_path(Path::new(&agent.command))
            .ok()
            .filter(|path| path.is_file())
            .ok_or_else(|| anyhow::anyhow!("The program `{}` of agent `{name}` was not found", agent.command))?;
        Ok(AcpProgram {
            executable,
            arguments: agent.args.iter().map(Into::into).collect(),
            environment: agent.env.iter().map(|(key, value)| (key.into(), value.into())).collect(),
        })
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

/// What the daemon's config says to run for an agent over ACP. `environment` can hold
/// credentials, so it is never logged.
struct AcpProgram {
    executable: PathBuf,
    arguments: Vec<std::ffi::OsString>,
    environment: Vec<(std::ffi::OsString, std::ffi::OsString)>,
}

/// Whether two names are the same environment variable: Windows ignores their case.
fn same_variable(one: &std::ffi::OsStr, other: &std::ffi::OsStr) -> bool {
    if cfg!(windows) {
        one.to_string_lossy().eq_ignore_ascii_case(&other.to_string_lossy())
    } else {
        one == other
    }
}

/// The agent `name` as the ACP registry's install recorded it, if it was installed.
fn installed_agent(
    name: &str,
    mut installed: std::collections::BTreeMap<String, crate::acp_registry::Installed>,
) -> Option<crate::config::AcpAgent> {
    let kept = installed.remove(name)?;
    Some(crate::config::AcpAgent {
        name: name.to_owned(),
        command: kept.command.to_string_lossy().into_owned(),
        args: kept.args,
        env: kept.env,
    })
}

#[cfg(test)]
mod own_agent_tests {
    use super::{CODEX_PROGRAM, codex_from, own_agent};
    use crate::conversation::Provider;

    #[test]
    fn codex_is_the_one_on_the_path_a_pane_would_run_and_none_when_it_is_not_there() {
        let root = std::env::temp_dir().join(format!("maiker-own-agent-{}", std::process::id()));
        let (folder, elsewhere) = (root.join("has"), root.join("has-not"));
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::create_dir_all(&elsewhere).unwrap();
        let program = folder.join(CODEX_PROGRAM);
        std::fs::write(&program, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        let found = codex_from(folder.as_os_str());
        let missing = codex_from(elsewhere.as_os_str());
        std::fs::remove_dir_all(&root).unwrap();

        assert_eq!(found, Some(program));
        assert_eq!(missing, None);
    }

    #[test]
    fn an_agent_with_no_structured_chat_of_its_own_is_refused_in_words() {
        let gemini = own_agent(Provider::Gemini).unwrap_err().to_string();
        let acp = own_agent(Provider::Acp).unwrap_err().to_string();

        assert!(gemini.contains("start it in a terminal"), "{gemini}");
        assert!(acp.contains("started by its name"), "{acp}");
    }
}

#[cfg(test)]
mod installed_agent_tests {
    use super::installed_agent;
    use crate::acp_registry::Installed;
    use std::collections::BTreeMap;

    #[test]
    fn an_installed_agent_runs_the_program_and_arguments_its_install_recorded() {
        let kept = Installed {
            name: "Demo".into(),
            version: "1.0.0".into(),
            command: "/data/acp-agents/demo/1.0.0/demo".into(),
            args: vec!["acp".into()],
            env: BTreeMap::from([("MODE".into(), "acp".into())]),
        };
        let installed = BTreeMap::from([("demo".to_owned(), kept)]);

        let agent = installed_agent("demo", installed.clone()).unwrap();

        assert_eq!(agent.name, "demo");
        assert_eq!(agent.command, "/data/acp-agents/demo/1.0.0/demo");
        assert_eq!(agent.args, ["acp"]);
        assert_eq!(agent.env.get("MODE").map(String::as_str), Some("acp"));
        assert!(installed_agent("other", installed).is_none());
    }
}
