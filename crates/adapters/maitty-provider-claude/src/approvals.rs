//! Claude's `can_use_tool` request as something a person can be shown and answer.

use maitty_provider::approval::{approval_text, file_change_previews};
use maitty_provider::tool_input;
use maitty_shared::conversation::{
    ApprovalDecision, ApprovalRequest, ApprovalRequestKind, ProviderRequestId,
};
use serde_json::Value;

/// Longest tool-use id accepted as a link to a tool step.
const MAX_TOOL_USE_ID_CHARS: usize = 256;

/// The request that asks a person to decide on one tool call, and the hash a remembered answer
/// to a command holds to.
///
/// The request is linked to the tool's own history step when Claude names the tool use
/// (`tool_use_id`, the same id the step has); otherwise it falls back to the request id. An edit
/// tool is raised as a file change that carries its diff, any other tool as a command whose text
/// names its target.
pub fn approval_request(
    turn: &str,
    request_id: &str,
    request: &Value,
    tool_name: &str,
    input: &Value,
) -> (ApprovalRequest, Option<String>) {
    let item = request
        .get("tool_use_id")
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.chars().count() <= MAX_TOOL_USE_ID_CHARS
                && !id.chars().any(char::is_control)
        })
        .unwrap_or(request_id);
    let command = tool_input::approval_command(tool_name, input);
    let edit = tool_input::file_change_previews(tool_name, input);
    let kind = match edit {
        Some(_) => ApprovalRequestKind::FileChange,
        None => ApprovalRequestKind::Command,
    };
    // A diff that cannot be shown whole leaves nothing to choose: it must not be approved.
    let changes = edit
        .and_then(|changes| file_change_previews(&changes))
        .unwrap_or_default();
    let choices = if kind == ApprovalRequestKind::FileChange && changes.is_empty() {
        Vec::new()
    } else {
        vec![ApprovalDecision::Accept, ApprovalDecision::Decline]
    };
    let command_hash = (kind == ApprovalRequestKind::Command)
        .then(|| maitty_shared::protocol::command_hash(&command));
    let request = ApprovalRequest {
        request_id: ProviderRequestId::Text(request_id.to_owned()),
        kind,
        item_id: Some(item.to_owned()),
        turn_id: Some(turn.to_owned()),
        command: Some(approval_text(&command)),
        reason: None,
        cwd: None,
        changes,
        questions: Vec::new(),
        permissions: None,
        choices,
        can_remember: command_hash.is_some(),
    };
    (request, command_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn approvals_name_their_target_and_link_to_the_tool_step() {
        use ApprovalRequestKind::{Command, FileChange};
        let cases = [
            ("Bash", json!({"command":"cargo test"}), json!({"tool_use_id":"toolu_1"}), Command, "toolu_1", "cargo test"),
            (
                "Edit",
                json!({"file_path":"src/a.rs","old_string":"x","new_string":"y"}),
                json!({"tool_use_id":"toolu_2"}),
                FileChange,
                "toolu_2",
                "Edit: src/a.rs",
            ),
            ("Write", json!({"file_path":"b.txt","content":"hi"}), json!({}), FileChange, "request-1", "Write: b.txt"),
            (
                "WebFetch",
                json!({"url":"https://example.com"}),
                json!({"tool_use_id":""}),
                Command,
                "request-1",
                "WebFetch: https://example.com",
            ),
            ("Bash", json!({"command":"ls"}), json!({"tool_use_id":"bad\nid"}), Command, "request-1", "ls"),
        ];
        for (tool, input, request, kind, item, command) in cases {
            let (asked, hash) = approval_request("turn", "request-1", &request, tool, &input);

            assert_eq!(asked.kind, kind, "{tool}");
            assert_eq!(asked.item_id.as_deref(), Some(item), "{tool}");
            assert_eq!(asked.command.as_deref(), Some(command), "{tool}");
            assert_eq!(!asked.changes.is_empty(), kind == FileChange, "{tool}");
            assert_eq!(asked.turn_id.as_deref(), Some("turn"));
            assert_eq!((hash.is_some(), asked.can_remember), (kind == Command, kind == Command), "{tool}");
            assert_eq!(asked.choices, [ApprovalDecision::Accept, ApprovalDecision::Decline], "{tool}");
        }
    }

    #[test]
    fn a_command_is_shown_with_its_secrets_masked_but_remembered_as_sent() {
        let command = "curl -H 'Authorization: Bearer sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' x";

        let (asked, hash) = approval_request("turn", "request-1", &json!({}), "Bash", &json!({"command": command}));

        assert_ne!(asked.command.as_deref(), Some(command));
        assert_eq!(hash, Some(maitty_shared::protocol::command_hash(command)));
    }
}
