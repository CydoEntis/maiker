pub(super) mod allowed;
mod branch_start;
pub(super) mod checks;
mod codex_helpers;
mod claude;
pub(super) mod commands;
pub(super) mod continue_turn;
mod daemon;
mod dialect_runtime;
pub(super) mod follow;
pub(in crate::daemon) mod follow_transcript;
pub(super) mod helper_record;
pub(super) mod history;
mod history_provider;
pub(super) mod news;
pub(super) mod history_storage;
mod process;
pub(super) mod saved;
pub(super) mod side;
mod runtime;
pub(super) mod transport;

/// `text` with token- and key-shaped strings masked, for text that leaves the daemon outside a
/// conversation's history (a permission prompt's subject).
pub(in crate::daemon) fn mask_secrets(text: &str) -> String {
    redact::redact_text(text).into_owned()
}

use maitty_provider::{redact, tool_input};
pub(in crate::daemon) use runtime::Owner;
use runtime::Payload;
pub(super) use runtime::{Event, Registry};
#[cfg(test)]
pub(super) use transport::Launch;

#[derive(Default)]
pub(super) struct State {
    pub(super) status: crate::protocol::Status,
    pub(super) checks: crate::daemon::check::Checks,
    pub(super) completed_turns: std::collections::BTreeSet<String>,
    /// A problem that outlives turns, such as a history that cannot be read or a request left
    /// unanswered: only what fixes it clears it.
    pub(super) error: Option<String>,
    /// Why the latest turn failed or was cut short, or what its provider reported going wrong in
    /// it. Kept apart from `error` so the next turn that starts, or ends well, clears it without
    /// hiding a problem that outlives turns.
    pub(super) turn_error: Option<String>,
    pub(super) blocked: bool,
    pub(super) history_ready: bool,
    pub(super) history_revision: u64,
    pub(super) started_by: Option<crate::protocol::TermId>,
    pub(super) started_at: Option<std::time::Instant>,
    pub(super) approvals: std::collections::BTreeMap<
        crate::conversation::ProviderRequestId,
        crate::conversation::ApprovalRequest,
    >,
    /// The hash of each command request's text exactly as the provider sent it, by request: what a
    /// remembered approval holds to (the text shown has secrets hidden). Never sent to a client.
    pub(super) command_hashes:
        std::collections::BTreeMap<crate::conversation::ProviderRequestId, String>,
    pub(super) file_change_previews:
        std::collections::BTreeMap<(String, String), Vec<crate::conversation::FileChangePreview>>,
    pub(super) unsupported_requests:
        std::collections::BTreeMap<crate::conversation::ProviderRequestId, String>,
    pub(super) cancelling: Option<String>,
    /// Permissions a person changed since the agent last started a turn: handed to it with the
    /// next message, then cleared.
    pub(super) new_permissions: Option<crate::conversation::Permissions>,
    /// Approvals a person already answered, oldest first and capped, so a viewer that restarts
    /// can still show what was decided. Held in memory only: they follow the daemon's life.
    pub(super) answered_approvals: std::collections::VecDeque<crate::conversation::AnsweredApproval>,
    /// The helpers the provider reported starting, at `helpers_generation` (ADR 0010). Display
    /// only: they never set `status`.
    pub(super) helpers: Vec<crate::protocol::SubagentActivity>,
    pub(super) helpers_generation: u64,
    /// Whether this chat's agent may start helper sessions, and what it waits on the person for
    /// (ADR 0016). Not the provider's own `helpers` above.
    pub(in crate::daemon) helper_consent: crate::daemon::helpers::HelperState,
}

/// How many answered approvals a conversation keeps; the oldest are dropped first.
const MAX_ANSWERED_APPROVALS: usize = 64;

impl State {
    /// The one place a chat's status changes: each change is logged with its reason, so a wrong
    /// status or alert can be traced (the pane's is `Term::write_status`). A test in
    /// `status_writers` keeps every other write out.
    pub(super) fn set_status(
        &mut self,
        id: crate::conversation::ConversationId,
        new: crate::protocol::Status,
        why: &str,
    ) {
        if self.status != new {
            tracing::info!("chat {}: {:?} -> {new:?}: {why}", id.0, self.status);
        }
        self.status = new;
    }

    /// Remembers that `request` was answered with `decision`.
    pub(super) fn record_answer(
        &mut self,
        request: crate::conversation::ApprovalRequest,
        decision: crate::conversation::ApprovalDecision,
    ) {
        let answered_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok());
        if self.answered_approvals.len() >= MAX_ANSWERED_APPROVALS {
            self.answered_approvals.pop_front();
        }
        self.answered_approvals.push_back(crate::conversation::AnsweredApproval {
            request,
            decision,
            answered_at_ms,
        });
    }

    /// The problem a reader is shown: one that outlives turns first, since it is what needs
    /// fixing, else why the latest turn failed.
    pub(super) fn shown_error(&self) -> Option<&str> {
        self.error.as_deref().or(self.turn_error.as_deref())
    }

    /// Nothing is wrong any more: neither a lasting problem nor the latest turn's.
    pub(super) fn clear_errors(&mut self) {
        self.error = None;
        self.turn_error = None;
    }

    pub(super) fn effective_status(&self) -> crate::protocol::Status {
        use crate::protocol::Status;
        if self.shown_error().is_some()
            || !self.helper_consent.asked.is_empty()
            || (matches!(self.status, Status::Done | Status::Idle) && self.checks.holds_done())
        {
            Status::Blocked
        } else {
            self.status
        }
    }
}

#[cfg(test)]
mod tests;
