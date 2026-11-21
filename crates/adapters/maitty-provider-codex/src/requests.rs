//! What the daemon sends Codex's app-server, and what it reads from the answers: the parameters
//! of each request, the answer to each approval, and the checks on a thread's reply.

use anyhow::{Result, bail};
use maitty_shared::conversation::{ApprovalDecision, ApprovalPolicy, LaunchSettings, Sandbox, TurnChoice};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn approval(settings: &LaunchSettings) -> &'static str {
    match settings.approval_policy {
        ApprovalPolicy::Untrusted => "untrusted",
        ApprovalPolicy::OnRequest => "on-request",
        ApprovalPolicy::Never => "never",
    }
}

fn sandbox(settings: &LaunchSettings) -> &'static str {
    match settings.sandbox {
        Sandbox::ReadOnly => "read-only",
        Sandbox::WorkspaceWrite => "workspace-write",
        Sandbox::FullAccess => "danger-full-access",
    }
}

/// The parameters of `thread/start`: where to work and how far the agent may go.
pub fn thread_start_params(settings: &LaunchSettings) -> Value {
    json!({"cwd": settings.cwd, "model": settings.model, "modelProvider": settings.model_provider,
        "approvalPolicy": approval(settings), "approvalsReviewer":"user", "sandbox":sandbox(settings),
        "config": {"sandbox_workspace_write": {"network_access":false,"writable_roots":[],"exclude_tmpdir_env_var":true,"exclude_slash_tmp":true}}})
}

/// The parameters of `thread/resume` for exactly `thread`. Its turns are read apart, in pages.
pub fn thread_resume_params(settings: &LaunchSettings, thread: &str) -> Value {
    let mut params = thread_start_params(settings);
    params["threadId"] = json!(thread);
    params["excludeTurns"] = json!(true);
    params
}

/// The parameters of `turn/start`. Only what the user picked is added; the providers keep a
/// model and effort for the turns after, so a choice made once holds until changed.
pub fn turn_start_params(
    thread: &str,
    text: &str,
    client_message_id: &str,
    choice: &TurnChoice,
) -> Value {
    let mut params = json!({"threadId":thread,"input":[{"type":"text","text":text,"text_elements":[]}],"clientUserMessageId":client_message_id});
    if let Some(model) = &choice.model {
        params["model"] = json!(model);
    }
    if let Some(effort) = &choice.effort {
        params["effort"] = json!(effort);
    }
    params
}

/// The parameters of `thread/turns/list` for one page of `thread`, oldest first and with every
/// item whole. `cursor` is what the page before named as next.
pub fn turns_list_params(thread: &str, cursor: Option<&str>, limit: usize) -> Value {
    match cursor {
        Some(cursor) => {
            json!({"threadId":thread,"cursor":cursor,"limit":limit,"sortDirection":"asc","itemsView":"full"})
        }
        None => json!({"threadId":thread,"limit":limit,"sortDirection":"asc","itemsView":"full"}),
    }
}

/// The parameters of `turn/interrupt`.
pub fn turn_interrupt_params(thread: &str, turn: &str) -> Value {
    json!({"threadId":thread,"turnId":turn})
}

/// The answer to a command or file-change approval.
pub fn decision_response(decision: ApprovalDecision) -> Value {
    let result = match decision {
        ApprovalDecision::Accept => "accept",
        ApprovalDecision::AcceptForSession => "acceptForSession",
        ApprovalDecision::Decline => "decline",
        ApprovalDecision::Cancel => "cancel",
    };
    json!({ "decision": result })
}

/// The answer to a permission request: the profile it asked for, for this turn only, or none.
pub fn permission_response(decision: ApprovalDecision, requested: Option<&Value>) -> Result<Value> {
    let permissions = match decision {
        ApprovalDecision::Accept => requested
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Permission request has no requested profile"))?,
        ApprovalDecision::Decline => json!({}),
        ApprovalDecision::AcceptForSession | ApprovalDecision::Cancel => {
            bail!("This permission request supports only a turn-scoped approval")
        }
    };
    Ok(json!({ "permissions": permissions, "scope": "turn" }))
}

/// The answer to the questions Codex asked a person, by question.
pub fn user_input_response(answers: BTreeMap<String, Vec<String>>) -> Value {
    let answers = answers
        .into_iter()
        .map(|(question, answers)| (question, json!({ "answers": answers })))
        .collect::<serde_json::Map<_, _>>();
    json!({ "answers": answers })
}

/// A name Codex gave something: present, not blank and free of control characters.
pub fn identifier(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty() && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("Codex response lacks a valid {key}"))
}

/// The thread a `thread/start` or `thread/resume` reply names, which must be `expected` when one
/// was asked for.
pub fn thread_id(value: &Value, expected: Option<&str>) -> Result<String> {
    let thread = value
        .get("thread")
        .ok_or_else(|| anyhow::anyhow!("Codex response lacks thread"))?;
    let id = identifier(thread, "id")?;
    if expected.is_some_and(|expected| expected != id) {
        bail!("Provider resumed a different exact session");
    }
    Ok(id)
}

/// Checks that the thread Codex opened is the one asked for and no wider: the same folder,
/// approval posture, sandbox and model. Records the model Codex chose in `settings`.
pub fn validate_thread(
    value: &Value,
    settings: &mut LaunchSettings,
    expected: Option<&str>,
) -> Result<String> {
    let id = thread_id(value, expected)?;
    let cwd = identifier(value, "cwd")?;
    if std::path::Path::new(&cwd) != settings.cwd
        || value.get("approvalPolicy") != Some(&json!(approval(settings)))
        || value.get("approvalsReviewer") != Some(&json!("user"))
    {
        bail!("Codex effective working directory or approval posture differs");
    }
    let effective = value
        .get("sandbox")
        .ok_or_else(|| anyhow::anyhow!("Codex response lacks sandbox"))?;
    let kind = match settings.sandbox {
        Sandbox::ReadOnly => "readOnly",
        Sandbox::WorkspaceWrite => "workspaceWrite",
        Sandbox::FullAccess => "dangerFullAccess",
    };
    // Full access has no sandbox, so there is no network restriction to verify.
    if effective.get("type") != Some(&json!(kind))
        || (settings.sandbox != Sandbox::FullAccess
            && effective
                .get("networkAccess")
                .is_some_and(|v| v != &json!(false)))
    {
        bail!("Codex effective sandbox differs");
    }
    if settings.sandbox == Sandbox::WorkspaceWrite {
        let roots = effective.get("writableRoots").and_then(Value::as_array);
        if roots.is_some_and(|roots| {
            roots
                .iter()
                .any(|root| root.as_str().map(std::path::Path::new) != Some(settings.cwd.as_path()))
        }) || effective.get("excludeTmpdirEnvVar") != Some(&json!(true))
            || effective.get("excludeSlashTmp") != Some(&json!(true))
        {
            bail!("Codex effective writable roots differ");
        }
    }
    let model = identifier(value, "model")?;
    let provider = identifier(value, "modelProvider")?;
    if settings.model.as_ref().is_some_and(|m| m != &model)
        || settings
            .model_provider
            .as_ref()
            .is_some_and(|p| p != &provider)
    {
        bail!("Codex effective model selection differs");
    }
    settings.model = Some(model);
    settings.model_provider = Some(provider);
    Ok(id)
}

/// The turn a `turn/start` reply says it started. An incomplete reply leaves the delivery
/// uncertain, so it is an error and never a guess.
pub fn started_turn(value: &Value) -> Result<String> {
    let turn = value
        .get("turn")
        .ok_or_else(|| anyhow::anyhow!("Codex turn response lacks turn"))?;
    let turn_id = identifier(turn, "id")?;
    if !turn.get("items").is_some_and(Value::is_array)
        || !turn.get("status").is_some_and(Value::is_string)
    {
        bail!("Codex turn response is incomplete; delivery uncertain");
    }
    Ok(turn_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picked_model_and_effort_ride_on_the_codex_turn_start_and_nothing_else_changes() {
        let plain = turn_start_params("thread", "hi", "1-1-1", &TurnChoice::default());
        assert!(plain.get("model").is_none() && plain.get("effort").is_none());
        let picked = turn_start_params(
            "thread",
            "hi",
            "1-1-1",
            &TurnChoice { model: Some("gpt-x".into()), effort: Some("high".into()) },
        );
        assert_eq!(picked["model"], "gpt-x");
        assert_eq!(picked["effort"], "high");
        // Permissions are set when the thread starts and are not part of a turn's parameters.
        for key in ["approvalPolicy", "sandbox", "sandboxPolicy", "cwd"] {
            assert!(picked.get(key).is_none(), "{key}");
        }
        let mut stripped = picked.clone();
        stripped.as_object_mut().unwrap().retain(|key, _| key != "model" && key != "effort");
        assert_eq!(stripped, plain);
    }
}
