use super::{
    history::{self, Completeness, History},
    runtime::Rpc,
    transport::{Launch, LaunchIdentity},
};
use crate::conversation::*;
use crate::daemon::{ClientId, Daemon, Grant, ServerMsg, persist};
use crate::protocol::{ConversationSummary, Reply, Status};
use anyhow::{Result, bail};

const MAX_NATIVE_TERMINAL_INPUT_BYTES: usize = 16 * 1024;
const MIN_NATIVE_TERMINAL_DIMENSION: u16 = 2;
const MAX_NATIVE_TERMINAL_COLS: u16 = 500;
const MAX_NATIVE_TERMINAL_ROWS: u16 = 300;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::ffi::OsStr;

const MAX_PROMPT_BYTES: usize = 256 * 1024;
/// Messages the daemon holds for one busy conversation, and their total text.
const MAX_QUEUED_MESSAGES: usize = 32;
const MAX_QUEUED_BYTES: usize = 1024 * 1024;
/// Acknowledged messages a conversation remembers, for answering a retry.
const RECENT_OPERATIONS: usize = 64;
/// A queued message was sent by a request that is long over; its replies have nowhere to go.
const NO_CLIENT: ClientId = ClientId::MAX;

/// What a message carries on its way to the runtime: its text, the digest that tells a retry from a
/// new message, and the model and effort picked for it.
struct Outgoing {
    text: String,
    digest: String,
    choice: TurnChoice,
}

/// A message waiting for the running turn to end.
pub(in crate::daemon) struct QueuedSend {
    generation: u64,
    operation: u64,
    text: String,
    digest: String,
    choice: TurnChoice,
}

use maitty_provider_codex::requests::identifier;

const MAX_HYDRATION_ENTRIES: usize = 100_000;
const MAX_HYDRATION_BYTES: usize = 32 * 1024 * 1024;
const MAX_USER_INPUT_ANSWER_CHARS: usize = 10_000;

fn valid_provider_environment_entry(key: &OsStr, value: &OsStr) -> bool {
    let key = key.to_string_lossy();
    !key.is_empty() && !key.contains(['=', '\0']) && !value.to_string_lossy().contains('\0')
}

fn cached_claude_history(
    id: ConversationId,
    cached: Option<&History>,
    is_currently_reconciled: bool,
) -> Result<(History, bool)> {
    let mut history = cached.cloned().unwrap_or_else(|| History::new(id));
    if !is_currently_reconciled || cached.is_none() {
        history.reconnect().map_err(|reason| {
            anyhow::anyhow!("Cannot mark Claude history incomplete: {reason:?}")
        })?;
    }
    let is_complete = is_currently_reconciled && cached.is_some();
    Ok((history, is_complete))
}

/// The history of a conversation whose provider is never asked for it and writes no file the
/// daemon reads: what the daemon kept is the whole of it, less whatever was still being written
/// when the agent went away. Not complete only when nothing was kept.
fn recorded_history(id: ConversationId, cached: Option<&History>) -> Result<(History, bool)> {
    let Some(cached) = cached else {
        let mut history = History::new(id);
        history
            .reconnect()
            .map_err(|reason| anyhow::anyhow!("Cannot mark the history incomplete: {reason:?}"))?;
        return Ok((history, false));
    };
    let mut history = cached.clone();
    if history.completeness != Completeness::Complete {
        history
            .reconnect()
            .and_then(|()| history.set_completeness(Completeness::Complete))
            .map_err(|reason| anyhow::anyhow!("Cannot take up the kept history: {reason:?}"))?;
    }
    Ok((history, true))
}

/// The requester of a start the daemon makes itself. No client has this id, so a reply to it is
/// dropped and a failure is only recorded on the conversation and logged.
pub(in crate::daemon) const DAEMON_REQUESTER: ClientId = ClientId::MAX;

pub(in crate::daemon) enum Pending {
    Validating {
        client: ClientId,
        id: ConversationId,
    },
    Launch {
        client: ClientId,
        launch: Box<Launch>,
    },
    Opening {
        client: ClientId,
        id: ConversationId,
        generation: u64,
        settings: LaunchSettings,
        expected: Option<String>,
    },
    Identity {
        client: ClientId,
        id: ConversationId,
        generation: u64,
        created_thread: bool,
        /// The conversation is new here but its session is not: it began outside this app.
        adopted: bool,
    },
    Hydration {
        id: ConversationId,
        generation: u64,
        history: History,
        cursors: BTreeSet<String>,
        read: Option<ReadRequest>,
        started: Option<ClientId>,
        changed: bool,
        bytes: usize,
    },
    Submit {
        client: ClientId,
        receipt: Receipt,
        text: String,
        choice: TurnChoice,
    },
    Sending {
        client: ClientId,
        receipt: Receipt,
    },
    Cancelling {
        client: ClientId,
        id: ConversationId,
        generation: u64,
        turn_id: String,
        /// Started to send a queued message now, not by a person's cancel: if the turn ended
        /// first and the provider refuses, nothing is wrong with the conversation.
        for_send_now: bool,
    },
    Receipt {
        client: ClientId,
        receipt: Receipt,
    },
    /// A queued message steered into the running turn, waiting for the provider's answer. The
    /// message stays in the queue until that answer, so a refusal loses nothing.
    Steering {
        client: ClientId,
        id: ConversationId,
        generation: u64,
        operation: u64,
        turn_id: String,
    },
}

pub(in crate::daemon) struct ReadRequest {
    client: ClientId,
    cursor: Option<history::Cursor>,
    limit: usize,
}

impl Pending {
    pub(super) fn client(&self) -> Option<ClientId> {
        match self {
            Self::Validating { client, .. }
            | Self::Launch { client, .. }
            | Self::Opening { client, .. }
            | Self::Identity { client, .. }
            | Self::Submit { client, .. }
            | Self::Sending { client, .. }
            | Self::Cancelling { client, .. }
            | Self::Steering { client, .. }
            | Self::Receipt { client, .. } => Some(*client),
            Self::Hydration { read, started, .. } => {
                read.as_ref().map(|read| read.client).or(*started)
            }
        }
    }
    pub(in crate::daemon) fn conversation(&self) -> ConversationId {
        match self {
            Self::Launch { launch, .. } => launch.id(),
            Self::Validating { id, .. }
            | Self::Opening { id, .. }
            | Self::Identity { id, .. }
            | Self::Hydration { id, .. } => *id,
            Self::Cancelling { id, .. } | Self::Steering { id, .. } => *id,
            Self::Submit { receipt, .. }
            | Self::Sending { receipt, .. }
            | Self::Receipt { receipt, .. } => receipt.conversation,
        }
    }
}

/// Checks the reply to opening a thread and returns the provider's own name for it.
fn validate_response(
    value: &Value,
    settings: &mut LaunchSettings,
    expected: Option<&str>,
) -> Result<String> {
    let structured = crate::daemon::providers::adapter(settings.provider)
        .structured
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("{} has no structured chat runtime", settings.provider.agent_name()))?;
    (structured.opened)(value, settings, expected)
}

mod approvals;
mod barrier;
mod ending;
mod listing;
mod reading;
mod response;
mod sending;
mod start;
mod terminal;

impl Daemon {
    fn visible_receipt(&self, id: ConversationId) -> Option<Receipt> {
        let mut receipt = self
            .conversation_operations
            .iter()
            .find(|operation| operation.receipt.conversation == id)?
            .receipt
            .clone();
        if self.conversation_requests.values().any(
            |pending| matches!(pending,Pending::Receipt {receipt:staged,..} if *staged==receipt),
        ) {
            receipt.delivery = Delivery::SubmissionUncertain;
        }
        Some(receipt)
    }
    fn conversation_token(&mut self, pending: Pending) -> Result<u64> {
        self.conversation_request_id = self
            .conversation_request_id
            .checked_add(1)
            .ok_or_else(|| anyhow::anyhow!("Conversation operation identity exhausted"))?;
        let token = self.conversation_request_id;
        self.conversation_requests.insert(token, pending);
        Ok(token)
    }
    fn durable_conversation(&self) -> Result<()> {
        if !self.cfg.restore.enabled {
            bail!("Structured mutations require restore.enabled for durable delivery metadata");
        }
        if !self.session_path.is_absolute() {
            bail!("Structured persistence requires an explicit absolute session path");
        }
        Ok(())
    }
    pub(in crate::daemon) fn conversation_fail(&mut self, pending: Pending, error: String) {
        let id = pending.conversation();
        if let Pending::Cancelling { turn_id, .. } = &pending
            && let Some(state) = self.conversation_states.get_mut(&id)
            && state.cancelling.as_deref() == Some(turn_id)
        {
            state.cancelling = None;
        }
        if let Pending::Receipt { receipt, .. } = &pending
            && let Some(operation) = self
                .conversation_operations
                .iter_mut()
                .find(|o| o.receipt == *receipt)
        {
            operation.receipt.delivery = Delivery::SubmissionUncertain;
        }
        // A start that never got an identity is a draft: the person is told, and nothing stays.
        let draft = matches!(
            pending,
            Pending::Validating { .. } | Pending::Launch { .. } | Pending::Opening { .. }
        ) && !self.conversations.iter().any(|c| c.id == id);
        let client = match pending {
            Pending::Validating { client, .. }
            | Pending::Launch { client, .. }
            | Pending::Opening { client, .. }
            | Pending::Identity { client, .. }
            | Pending::Submit { client, .. }
            | Pending::Sending { client, .. }
            | Pending::Cancelling { client, .. }
            | Pending::Steering { client, .. }
            | Pending::Receipt { client, .. } => Some(client),
            Pending::Hydration { read, started, .. } => read.map(|r| r.client).or(started),
        };
        let state = self.conversation_states.entry(id).or_default();
        state.status = Status::Blocked;
        state.error = Some(error.clone());
        state.history_ready = false;
        if client == Some(DAEMON_REQUESTER) {
            tracing::warn!("conversation {} was not resumed: {error}", id.0);
        }
        if let Some(client) = client {
            self.send(client, ServerMsg::Error(error));
        }
        if draft {
            self.forget_pending_start(id);
        }
        self.dirty = true;
    }
}

/// Where the linked worktree holding `cwd` came from, if it is in one and on a branch (a
/// detached HEAD has no branch to make the folder again from). Reads the checkout's `.git`
/// files only; no git process runs.
fn worktree_origin_of(cwd: &std::path::Path) -> Option<crate::conversation::WorktreeOrigin> {
    let head = crate::gitfs::head(cwd).filter(|h| h.linked && !h.detached)?;
    Some(crate::conversation::WorktreeOrigin {
        main: head.main_root,
        folder: head.top,
        branch: head.branch,
    })
}

#[cfg(test)]
mod worktree_origin_tests {
    use super::worktree_origin_of;
    use std::path::Path;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let mut command = Command::new("git");
        command.arg("-C").arg(dir).args(args);
        let output = crate::proc::quiet(&mut command).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    }

    #[test]
    fn only_a_linked_worktree_on_a_branch_has_an_origin() {
        let root = std::env::temp_dir().join(format!("maitty-origin-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let main = root.join("main");
        std::fs::create_dir_all(&main).unwrap();
        git(&main, &["init", "-q", "-b", "main"]);
        git(&main, &["config", "user.email", "test@example.invalid"]);
        git(&main, &["config", "user.name", "Test"]);
        git(&main, &["config", "commit.gpgsign", "false"]);
        std::fs::write(main.join("a.txt"), "one\n").unwrap();
        git(&main, &["add", "a.txt"]);
        git(&main, &["commit", "-q", "-m", "first"]);
        let task = root.join("task");
        git(&main, &["worktree", "add", "-q", "-b", "task", task.to_str().unwrap()]);
        let loose = root.join("loose");
        git(&main, &["worktree", "add", "-q", "--detach", loose.to_str().unwrap()]);

        assert_eq!(worktree_origin_of(&main), None, "the main checkout is not a worktree");
        assert_eq!(worktree_origin_of(&loose), None, "a detached HEAD has no branch");
        let origin = worktree_origin_of(&task)
            .expect("a linked worktree on a branch");
        assert_eq!(origin.branch, "task");
        // The temp dir may be spelled with 8.3 short names; compare what each names on disk.
        let named = |p: &Path| crate::daemon::clean_path(std::fs::canonicalize(p).unwrap());
        assert_eq!(named(&origin.folder), named(&task));
        assert_eq!(named(&origin.main), named(&main));
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod native_resume_tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn inherited_provider_environment_skips_windows_drive_pseudo_variables() {
        assert!(!valid_provider_environment_entry(
            OsStr::new("=C:"),
            OsStr::new("C:\\project")
        ));
        assert!(valid_provider_environment_entry(
            OsStr::new("PATH"),
            OsStr::new("C:\\tools")
        ));
    }

    #[test]
    fn claude_identity_accepts_only_the_exact_provider_session() {
        let mut settings = LaunchSettings {
            agent: None,
            provider: Provider::Claude,
            executable: PathBuf::from("claude"),
            config_root: PathBuf::from("claude-config"),
            cwd: PathBuf::from("project"),
            model: None,
            model_provider: None,
            approval_policy: ApprovalPolicy::OnRequest,
            sandbox: Sandbox::ReadOnly,
        };
        assert_eq!(
            validate_response(
                &json!({"thread":{"id":"exact-claude-session"}}),
                &mut settings,
                Some("exact-claude-session")
            )
            .unwrap(),
            "exact-claude-session"
        );
        assert!(
            validate_response(
                &json!({"thread":{"id":"different-session"}}),
                &mut settings,
                Some("exact-claude-session")
            )
            .is_err()
        );
    }

    #[test]
    fn a_claude_cache_is_complete_only_while_live_and_keeps_its_saved_messages() {
        // No cache at all is explicitly incomplete.
        let (history, is_complete) = cached_claude_history(ConversationId(9), None, false).unwrap();
        assert!(!is_complete);
        assert_eq!(history.conversation, ConversationId(9));
        assert!(history.entries.is_empty());
        assert_eq!(
            history.completeness,
            Completeness::Incomplete(history::IncompleteReason::Disconnected)
        );

        let id = ConversationId(10);
        let mut cached = History::new(id);
        cached.set_completeness(Completeness::Complete).unwrap();
        cached.entries.push(history::Entry {
            source: history::SourceId {
                conversation: id,
                turn: "turn-1".into(),
                item: "item-1".into(),
            },
            content: history::Content::Message {
                role: history::Role::User,
                text: "keep this message".into(),
            },
            state: history::ItemState::Completed,
            started_at_ms: None,
            completed_at_ms: None,
        });

        // Disconnected: the saved messages stay visible, but the history is incomplete.
        let (history, is_complete) = cached_claude_history(id, Some(&cached), false).unwrap();
        assert!(!is_complete);
        assert_eq!(history.entries, cached.entries);
        assert_eq!(
            history.completeness,
            Completeness::Incomplete(history::IncompleteReason::Disconnected)
        );

        // Live: complete, with the entries as they were.
        let (history, is_complete) = cached_claude_history(id, Some(&cached), true).unwrap();
        assert!(is_complete);
        assert_eq!(history.completeness, Completeness::Complete);
        assert_eq!(history.entries, cached.entries);
    }
}
