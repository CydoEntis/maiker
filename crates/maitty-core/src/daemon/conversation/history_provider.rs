//! Codex's turn events as updates to one conversation's history. The reading itself is the
//! Codex adapter's (`maitty_provider_codex::history`).

use super::history::{Entry, IncompleteReason, SourceId, Update};
use crate::conversation::ConversationId;
use maitty_provider_codex::history::HistoryEvent;
pub(super) use maitty_provider_codex::history::{CONTEXT_SUMMARY_ITEM, error_message};
use serde_json::Value;

type Result<T> = std::result::Result<T, IncompleteReason>;

pub(super) fn notification(
    conversation: ConversationId,
    thread: &str,
    method: &str,
    params: &Value,
) -> Result<Option<Update>> {
    let Some(event) = maitty_provider_codex::history::event(thread, method, params)? else {
        return Ok(None);
    };
    Ok(Some(match event {
        HistoryEvent::ProviderError { message, will_retry } => Update::ProviderError { message, will_retry },
        HistoryEvent::Item { turn, item, content, state, started_at_ms, completed_at_ms } => {
            Update::UpsertItem(Entry {
                source: SourceId { conversation, turn, item },
                content,
                state,
                started_at_ms,
                completed_at_ms,
            })
        }
        HistoryEvent::Delta { turn, item, delta } => Update::AppendDelta {
            source: SourceId { conversation, turn, item },
            delta,
        },
        HistoryEvent::TurnStatus { turn, state, started_at_ms, completed_at_ms } => {
            Update::SetTurnStatus { turn, state, started_at_ms, completed_at_ms }
        }
    }))
}

#[cfg(test)]
mod tests;
