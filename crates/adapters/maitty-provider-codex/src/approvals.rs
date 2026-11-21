//! Reads what Codex asks a person (`item/*/requestApproval`, `item/tool/requestUserInput`) into
//! a request that can be shown: invisible characters spelled out, secrets masked, and only the
//! choices Codex offered.

use maitty_provider::redact;
use maitty_shared::conversation::{
    ApprovalDecision, ApprovalRequest, ApprovalRequestKind, FileChangePreview, ProviderRequestId,
    UserInputOption, UserInputQuestion,
};
use serde_json::Value;

const COMMAND_APPROVAL: &str = "item/commandExecution/requestApproval";
const FILE_CHANGE_APPROVAL: &str = "item/fileChange/requestApproval";
const PERMISSION_APPROVAL: &str = "item/permissions/requestApproval";
const USER_INPUT: &str = "item/tool/requestUserInput";

/// Whether `method` is one of the requests that must name the turn that is running.
pub fn is_turn_request(method: &str) -> bool {
    matches!(method, COMMAND_APPROVAL | FILE_CHANGE_APPROVAL | PERMISSION_APPROVAL | USER_INPUT)
}

/// Whether the request names exactly this thread and this turn.
pub fn names(params: &Value, thread: Option<&str>, turn: Option<&str>) -> bool {
    params.get("threadId").and_then(Value::as_str) == thread
        && params.get("turnId").and_then(Value::as_str) == turn
}

/// The turn and item a request is about, when it names both.
pub fn subject(params: &Value) -> Option<(String, String)> {
    let turn = params.get("turnId").and_then(Value::as_str)?;
    let item = params.get("itemId").and_then(Value::as_str)?;
    Some((turn.to_owned(), item.to_owned()))
}

/// A request a person can answer, and what a remembered answer would hold to.
pub struct Asked {
    pub request: ApprovalRequest,
    /// The hash of a command exactly as Codex sent it. Only a command can be remembered.
    pub command_hash: Option<String>,
}

/// The request `method` makes, or `None` when it is not one this project can show and answer.
/// `known_changes` are the file changes Codex sent earlier for the same item, as a patch update.
pub fn approval_request(
    request_id: ProviderRequestId,
    method: &str,
    params: &Value,
    known_changes: Option<Vec<FileChangePreview>>,
) -> Option<Asked> {
    let command = params.get("command").and_then(Value::as_str);
    let kind = match method {
        COMMAND_APPROVAL if command.is_some() => ApprovalRequestKind::Command,
        FILE_CHANGE_APPROVAL => ApprovalRequestKind::FileChange,
        PERMISSION_APPROVAL
            if params.get("itemId").and_then(Value::as_str).is_some()
                && params.get("cwd").and_then(Value::as_str).is_some()
                && params.get("permissions").is_some_and(Value::is_object) =>
        {
            ApprovalRequestKind::Permission
        }
        USER_INPUT if user_input_questions(params).is_some() => ApprovalRequestKind::UserInput,
        _ => return None,
    };
    let changes = known_changes
        // Claude states an edit's diff in the request itself; Codex sends it earlier, as a
        // patch update.
        .or_else(|| {
            params
                .get("changes")
                .and_then(Value::as_array)
                .and_then(|changes| file_change_previews(changes))
        })
        .unwrap_or_default();
    let choices = match kind {
        ApprovalRequestKind::FileChange if changes.is_empty() => Vec::new(),
        ApprovalRequestKind::Permission => vec![ApprovalDecision::Decline, ApprovalDecision::Accept],
        _ => supported_approval_choices(params),
    };
    let command_hash = (kind == ApprovalRequestKind::Command)
        .then(|| command.map(maitty_shared::protocol::command_hash))
        .flatten();
    let request = ApprovalRequest {
        request_id,
        kind,
        item_id: params.get("itemId").and_then(Value::as_str).map(str::to_owned),
        turn_id: params.get("turnId").and_then(Value::as_str).map(str::to_owned),
        questions: if kind == ApprovalRequestKind::UserInput {
            user_input_questions(params).unwrap_or_default()
        } else {
            Vec::new()
        },
        permissions: params.get("permissions").cloned(),
        command: command.map(approval_text),
        reason: params.get("reason").and_then(Value::as_str).map(approval_text),
        cwd: params
            .get("cwd")
            .or_else(|| params.get("grantRoot"))
            .and_then(Value::as_str)
            .map(std::path::PathBuf::from),
        changes,
        choices,
        can_remember: command_hash.is_some(),
    };
    Some(Asked { request, command_hash })
}

fn visible_approval_text(text: &str) -> String {
    let mut visible = String::with_capacity(text.len());
    for character in text.chars() {
        if maitty_shared::hidden::is_invisible(character) {
            visible.push_str(&format!("\\u{{{:x}}}", character as u32));
        } else {
            visible.push(character);
        }
    }
    visible
}

/// Approval text that may be stored and served: invisible characters spelled out, and
/// token- and key-shaped strings masked (see `redact.rs`).
fn approval_text(text: &str) -> String {
    redact::redact_text(&visible_approval_text(text)).into_owned()
}

fn supported_approval_choices(
    params: &Value,
) -> Vec<ApprovalDecision> {
    const ACCEPT: &str = "accept";
    const ACCEPT_FOR_SESSION: &str = "acceptForSession";
    const DECLINE: &str = "decline";
    const CANCEL: &str = "cancel";
    use ApprovalDecision as Decision;
    let Some(choices) = params
        .get("availableDecisions")
        .and_then(Value::as_array)
    else {
        return vec![Decision::Accept, Decision::Decline];
    };
    choices
        .iter()
        .filter_map(|choice| {
            let name = choice.as_str().or_else(|| {
                choice
                    .as_object()
                    .and_then(|choice| choice.keys().next().map(String::as_str))
            })?;
            match name {
                ACCEPT => Some(Decision::Accept),
                ACCEPT_FOR_SESSION => Some(Decision::AcceptForSession),
                DECLINE => Some(Decision::Decline),
                CANCEL => Some(Decision::Cancel),
                _ => None,
            }
        })
        .collect()
}

fn user_input_questions(
    params: &Value,
) -> Option<Vec<UserInputQuestion>> {
    let questions = params.get("questions")?.as_array()?;
    if questions.is_empty() {
        return None;
    }
    let mut ids = std::collections::BTreeSet::new();
    questions
        .iter()
        .map(|question| {
            let id = question.get("id")?.as_str()?.to_owned();
            if id.is_empty() || !ids.insert(id.clone()) {
                return None;
            }
            let options = match question.get("options") {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(options)) => options
                    .iter()
                    .map(|option| {
                        Some(UserInputOption {
                            label: approval_text(option.get("label")?.as_str()?),
                            description: approval_text(
                                option.get("description")?.as_str()?,
                            ),
                        })
                    })
                    .collect::<Option<Vec<_>>>()?,
                Some(_) => return None,
            };
            Some(UserInputQuestion {
                id,
                header: approval_text(question.get("header")?.as_str()?),
                question: approval_text(question.get("question")?.as_str()?),
                is_other: question
                    .get("isOther")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                is_secret: question
                    .get("isSecret")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                options,
            })
        })
        .collect()
}

/// The changes of a patch as a person is shown them. `None` when any change is incomplete: a
/// partial diff must never be approved.
pub fn file_change_previews(
    changes: &[Value],
) -> Option<Vec<FileChangePreview>> {
    changes
        .iter()
        .map(|change| {
            let raw_path = change.get("path")?.as_str()?;
            Some(FileChangePreview {
                path: visible_approval_text(raw_path),
                kind: change.get("kind")?.as_str()?.to_owned(),
                // The diff of a secret file is left out, the path and kind stay.
                diff: redact::redact_diff(
                    raw_path,
                    &visible_approval_text(change.get("diff")?.as_str()?),
                ),
            })
        })
        .collect()
}
