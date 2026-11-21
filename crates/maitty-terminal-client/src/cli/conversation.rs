use crate::conversation::{ApprovalPolicy, ConversationId, LaunchSettings, Sandbox, StartTarget};
use crate::protocol::{ClientMsg, Command, Query, Reply};
use anyhow::{Result, bail};
use clap::{Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum Approval {
    Untrusted,
    OnRequest,
    Never,
}
#[derive(Clone, Copy, ValueEnum)]
pub(crate) enum Isolation {
    ReadOnly,
    WorkspaceWrite,
    FullAccess,
}

#[derive(Subcommand)]
pub(crate) enum Cmd {
    /// Create a thread, resume --session exactly, reconnect --conversation, or start the
    /// config's --acp agent in --cwd.
    Start {
        /// An `[[agents]]` entry with `acp = true`, by name. The service picks its program.
        #[arg(long, requires = "cwd", conflicts_with_all = ["conversation", "session", "executable", "config_root", "model", "model_provider", "approval", "sandbox"])]
        acp: Option<String>,
        #[arg(long, conflicts_with = "session")]
        conversation: Option<u64>,
        #[arg(long, requires = "conversation")]
        generation: Option<u64>,
        #[arg(long, conflicts_with = "conversation")]
        session: Option<String>,
        #[arg(long)]
        executable: Option<PathBuf>,
        #[arg(long)]
        config_root: Option<PathBuf>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        model: Option<String>,
        #[arg(long)]
        model_provider: Option<String>,
        /// Approval policy (default: on-request).
        #[arg(long, value_enum)]
        approval: Option<Approval>,
        /// Sandbox (default: read-only).
        #[arg(long, value_enum)]
        sandbox: Option<Isolation>,
    },
    /// Submit one prompt, using an increasing operation ID for this conversation.
    Send {
        #[arg(long)]
        conversation: u64,
        #[arg(long)]
        generation: u64,
        #[arg(long)]
        operation: u64,
        #[arg(required = true)]
        text: Vec<String>,
    },
    /// Read bounded display history. Cursor is the JSON cursor from the last read.
    Read {
        #[arg(long)]
        conversation: u64,
        #[arg(long)]
        cursor: Option<String>,
        #[arg(long, default_value_t = 128)]
        limit: usize,
    },
}

pub(crate) fn run(cmd: Cmd) -> Result<()> {
    let msg = match cmd {
        Cmd::Start { acp: Some(agent), cwd, .. } => {
            let target = acp_target(agent, cwd.unwrap_or_default())?;
            ClientMsg::Command(Command::ConversationStart { target, branch: None })
        }
        Cmd::Start {
            acp: None,
            conversation,
            generation,
            session,
            executable,
            config_root,
            cwd,
            model,
            model_provider,
            approval,
            sandbox,
        } => {
            let target = if let Some(id) = conversation {
                if executable.is_some()
                    || config_root.is_some()
                    || cwd.is_some()
                    || model.is_some()
                    || model_provider.is_some()
                    || approval.is_some()
                    || sandbox.is_some()
                {
                    bail!("--conversation uses its recorded exact launch settings");
                }
                StartTarget::Conversation {
                    id: ConversationId(id),
                    generation: generation
                        .ok_or_else(|| anyhow::anyhow!("--conversation requires --generation"))?,
                }
            } else {
                let settings = LaunchSettings {
                    agent: None,
                    provider: crate::conversation::Provider::Codex,
                    executable: executable.ok_or_else(|| {
                        anyhow::anyhow!("--executable is required for a new binding")
                    })?,
                    config_root: config_root.ok_or_else(|| {
                        anyhow::anyhow!("--config-root is required for a new binding")
                    })?,
                    cwd: cwd
                        .ok_or_else(|| anyhow::anyhow!("--cwd is required for a new binding"))?,
                    model,
                    model_provider,
                    approval_policy: match approval.unwrap_or(Approval::OnRequest) {
                        Approval::Untrusted => ApprovalPolicy::Untrusted,
                        Approval::OnRequest => ApprovalPolicy::OnRequest,
                        Approval::Never => ApprovalPolicy::Never,
                    },
                    sandbox: match sandbox.unwrap_or(Isolation::ReadOnly) {
                        Isolation::ReadOnly => Sandbox::ReadOnly,
                        Isolation::WorkspaceWrite => Sandbox::WorkspaceWrite,
                        Isolation::FullAccess => Sandbox::FullAccess,
                    },
                };
                match session {
                    Some(thread_id) => StartTarget::Session {
                        settings,
                        thread_id,
                    },
                    None => StartTarget::Create(settings),
                }
            };
            ClientMsg::Command(Command::ConversationStart { target, branch: None })
        }
        Cmd::Send {
            conversation,
            generation,
            operation,
            text,
        } => ClientMsg::Command(Command::ConversationSend {
            id: ConversationId(conversation),
            generation,
            operation,
            text: text.join(" "),
            choice: None,
        }),
        Cmd::Read {
            conversation,
            cursor,
            limit,
        } => {
            let cursor = cursor
                .map(|cursor| {
                    serde_json::from_str(&cursor)
                        .map_err(|_| anyhow::anyhow!("Invalid history cursor JSON"))
                })
                .transpose()?;
            ClientMsg::Query(Query::ConversationRead {
                id: ConversationId(conversation),
                cursor,
                limit,
            })
        }
    };
    let reply = super::block_on(super::request(msg))?;
    let text = match reply {
        Reply::ConversationStarted { id, generation } => {
            serde_json::to_string(&serde_json::json!({"conversation":id,"generation":generation}))?
        }
        Reply::ConversationSent(receipt) => serde_json::to_string(&receipt)?,
        Reply::ConversationQueued(queued) => serde_json::to_string(&queued)?,
        Reply::ConversationRead(history) => serde_json::to_string(&history)?,
        _ => bail!("Unexpected structured conversation reply"),
    };
    println!("{text}");
    Ok(())
}

/// A start of the config's ACP agent `agent` in `cwd`. The name and the folder are checked
/// here so a mistake is told before anything is asked of the service.
fn acp_target(agent: String, cwd: PathBuf) -> Result<StartTarget> {
    if !crate::conversation::acp_agent_name(&agent) {
        bail!("--acp takes an agent's name from the config: lowercase letters, digits, `-` or `_`");
    }
    if !cwd.is_absolute() {
        bail!("--cwd must be an absolute path");
    }
    Ok(StartTarget::Acp { agent, cwd })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_acp_start_names_the_agent_and_the_folder_and_nothing_else() {
        let folder = std::env::temp_dir();

        let target = acp_target("opencode".into(), folder.clone()).unwrap();

        assert_eq!(target, StartTarget::Acp { agent: "opencode".into(), cwd: folder });
    }

    #[test]
    fn an_acp_start_refuses_a_name_that_is_no_agents_and_a_relative_folder() {
        let bad_name = acp_target("Open Code".into(), std::env::temp_dir());
        let relative = acp_target("opencode".into(), PathBuf::from("project"));

        assert!(bad_name.unwrap_err().to_string().contains("--acp takes"));
        assert!(relative.unwrap_err().to_string().contains("absolute"));
    }
}
