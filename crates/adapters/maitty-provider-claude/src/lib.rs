use anyhow::{Context, Result, bail};
use serde_json::Value;
use maitty_shared::conversation::TurnChoice;
use std::ffi::OsString;

pub mod approvals;
pub mod dialect;
mod hooks;
mod projection;
pub use hooks::{
    HookShell, JsonHookGroupOptions, STATUS_EVENTS, StatusLineFileChange, command_line, is_our_hook_group, is_our_name,
    is_our_statusline, json_hook_group, replace_json_hook_group, runs_our_hook, stale_hooks,
    status_from_hook, update_statusline,
};
pub use projection::{MAX_PENDING_TOOLS, TurnProjector};

pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
const VERIFIED_VERSIONS: &[&str] = &["2.1.312", "2.1.314", "2.1.316", "2.1.327", "2.1.330"];

#[derive(Debug, PartialEq)]
pub enum OutputFrame {
    Initialized {
        session_id: String,
    },
    MessageStarted {
        message_id: String,
        model: String,
    },
    TextDelta {
        block_index: u64,
        text: String,
    },
    ToolInputDelta {
        block_index: u64,
        partial_json: String,
    },
    ContentBlockEnded {
        block_index: u64,
    },
    ControlRequest {
        request_id: String,
        request: Value,
    },
    ControlResponse {
        response: Value,
    },
    Result {
        session_id: String,
        is_error: bool,
        result: Option<String>,
    },
    UserReplay {
        text: String,
    },
    ToolUse {
        block_index: u64,
        id: String,
        name: String,
        input: Value,
    },
    ToolResults(Vec<ToolResult>),
    Other,
}

#[derive(Debug, PartialEq)]
pub struct ToolResult {
    pub id: String,
    pub output: String,
    pub is_error: bool,
}

pub fn parse_output_frame(line: &str) -> Result<OutputFrame> {
    anyhow::ensure!(
        line.len() <= MAX_FRAME_BYTES,
        "Claude output frame exceeds size limit"
    );
    let frame: Value =
        serde_json::from_str(line).context("Claude output frame is not valid JSON")?;
    let kind = frame
        .get("type")
        .and_then(Value::as_str)
        .context("Claude output frame has no type")?;

    match kind {
        "system" if frame.get("subtype").and_then(Value::as_str) == Some("init") => {
            let session_id = required_text(&frame, "session_id")?;
            Ok(OutputFrame::Initialized { session_id })
        }
        "stream_event" => parse_stream_event(&frame),
        "control_request" => Ok(OutputFrame::ControlRequest {
            request_id: required_text(&frame, "request_id")?,
            request: frame
                .get("request")
                .cloned()
                .context("Claude control request has no request body")?,
        }),
        "control_response" => Ok(OutputFrame::ControlResponse {
            response: frame
                .get("response")
                .cloned()
                .context("Claude control response has no response body")?,
        }),
        "result" => {
            let is_error = frame
                .get("is_error")
                .and_then(Value::as_bool)
                .context("Claude result has no error status")?;
            Ok(OutputFrame::Result {
                session_id: required_text(&frame, "session_id")?,
                is_error,
                result: frame
                    .get("result")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| is_error.then(|| result_errors(&frame)).flatten()),
            })
        }
        "user" => parse_user_frame(&frame),
        "assistant" | "system" | "rate_limit_event" | "tool_progress" => Ok(OutputFrame::Other),
        _ => bail!("Unsupported Claude output frame type: {kind}"),
    }
}

/// An error result's reasons: Claude Code lists them in `errors` when it has no `result` text,
/// as when a turn fails during execution.
fn result_errors(frame: &Value) -> Option<String> {
    let reasons: Vec<&str> = frame
        .get("errors")?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .collect();
    (!reasons.is_empty()).then(|| reasons.join("; "))
}

fn parse_stream_event(frame: &Value) -> Result<OutputFrame> {
    let event = frame
        .get("event")
        .context("Claude stream event has no event body")?;
    if frame
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .is_some_and(|parent| !parent.is_empty())
    {
        return Ok(OutputFrame::Other);
    }
    if event.get("type").and_then(Value::as_str) == Some("message_start") {
        let message = event
            .get("message")
            .context("Claude message start has no message body")?;
        return Ok(OutputFrame::MessageStarted {
            message_id: required_text(message, "id")?,
            model: required_text(message, "model")?,
        });
    }
    if event.get("type").and_then(Value::as_str) == Some("content_block_start")
        && event
            .get("content_block")
            .and_then(|block| block.get("type"))
            .and_then(Value::as_str)
            == Some("tool_use")
    {
        let block = &event["content_block"];
        return Ok(OutputFrame::ToolUse {
            block_index: event
                .get("index")
                .and_then(Value::as_u64)
                .context("Claude tool block has no valid index")?,
            id: required_text(block, "id")?,
            name: required_text(block, "name")?,
            input: block
                .get("input")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        });
    }
    if event.get("type").and_then(Value::as_str) == Some("content_block_stop") {
        return Ok(OutputFrame::ContentBlockEnded {
            block_index: event
                .get("index")
                .and_then(Value::as_u64)
                .context("Claude content block end has no valid index")?,
        });
    }
    if event.get("type").and_then(Value::as_str) != Some("content_block_delta") {
        return Ok(OutputFrame::Other);
    }
    let delta = event
        .get("delta")
        .context("Claude content delta has no delta body")?;
    let block_index = event
        .get("index")
        .and_then(Value::as_u64)
        .context("Claude text delta has no valid content block index")?;
    match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") => {
            let text = delta
                .get("text")
                .and_then(Value::as_str)
                .context("Claude text delta has no text")?
                .to_owned();
            Ok(OutputFrame::TextDelta { block_index, text })
        }
        Some("input_json_delta") => {
            let partial_json = delta
                .get("partial_json")
                .and_then(Value::as_str)
                .context("Claude tool input delta has no partial JSON")?
                .to_owned();
            Ok(OutputFrame::ToolInputDelta {
                block_index,
                partial_json,
            })
        }
        _ => Ok(OutputFrame::Other),
    }
}

fn parse_user_frame(frame: &Value) -> Result<OutputFrame> {
    if frame
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .is_some_and(|parent| !parent.is_empty())
    {
        return Ok(OutputFrame::Other);
    }
    let Some(content) = frame
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
    else {
        return Ok(OutputFrame::Other);
    };
    let tool_results: Vec<_> = content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
        .map(|block| {
            Ok(ToolResult {
                id: required_text(block, "tool_use_id")?,
                output: bounded_content_text(block.get("content")),
                is_error: block
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            })
        })
        .collect::<Result<_>>()?;
    if !tool_results.is_empty() {
        return Ok(OutputFrame::ToolResults(tool_results));
    }
    if frame.get("isReplay").and_then(Value::as_bool) != Some(true) {
        return Ok(OutputFrame::Other);
    }
    let text = content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<String>();
    Ok(OutputFrame::UserReplay { text })
}

/// Converts provider tool content to a bounded text preview.
pub fn bounded_content_text(content: Option<&Value>) -> String {
    const MAX_PREVIEW_BYTES: usize = 8192;
    let text = match content {
        Some(Value::String(text)) => text.clone(),
        Some(value) => value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|block| block.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        None => String::new(),
    };
    let mut end = text.len().min(MAX_PREVIEW_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut preview = text[..end].to_owned();
    if end < text.len() {
        preview.push_str("\n[Output truncated]");
    }
    preview
}

fn required_text(frame: &Value, field: &str) -> Result<String> {
    frame
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
        .map(str::to_owned)
        .with_context(|| format!("Claude frame has no valid {field}"))
}

pub fn verified_version(version: &str) -> bool {
    VERIFIED_VERSIONS.contains(&version)
}

/// Flags `command_arguments_for_turn` passes, which `claude --help` must list.
const REQUIRED_FLAGS: &[&str] = &[
    "--input-format",
    "--output-format",
    "--include-partial-messages",
    "--replay-user-messages",
    "--verbose",
    "--permission-mode",
    "--session-id",
    "--resume",
];

/// The permission channel is `--permission-prompt-tool=stdio`; newer Claude Code lists it only as
/// part of `--permission-prompts`, so either name shows the channel exists.
const PERMISSION_CHANNEL_FLAGS: &[&str] = &["--permission-prompt-tool", "--permission-prompts"];

/// Whether a CLI is one the adapter's own run has been checked against (`VERIFIED_VERSIONS`) or
/// one it only found able to do what a chat needs.
#[derive(Debug, PartialEq, Eq)]
pub enum CliTag {
    Tested,
    Untested(String),
}

fn lists_flag(help: &str, flag: &str) -> bool {
    help.match_indices(flag).any(|(at, _)| {
        !help[at + flag.len()..]
            .chars()
            .next()
            .is_some_and(|next| next.is_ascii_alphanumeric() || next == '-')
    })
}

/// Decides from `claude --version` and `claude --help` whether a chat can run on this binary. Any
/// version that names itself and lists the flags the adapter passes is accepted: a new release
/// must not need an edit here. Frame and permission handling stay strict at run time.
pub fn check_cli(version_output: &str, help: &str) -> Result<CliTag> {
    let version = version_number(version_output)
        .filter(|version| version.starts_with(|c: char| c.is_ascii_digit()))
        .with_context(|| {
            format!("`claude --version` did not print a Claude Code version (it printed {:?})", version_output.trim())
        })?;
    let missing: Vec<&str> = REQUIRED_FLAGS.iter().copied().filter(|flag| !lists_flag(help, flag)).collect();
    anyhow::ensure!(
        missing.is_empty(),
        "Claude Code {version} cannot run structured chat: `claude --help` does not list {}. Update Claude Code, or use the terminal agent.",
        missing.join(", ")
    );
    anyhow::ensure!(
        PERMISSION_CHANNEL_FLAGS.iter().any(|flag| lists_flag(help, flag)),
        "Claude Code {version} cannot run structured chat: `claude --help` lists no way to answer permission prompts ({}). Update Claude Code, or use the terminal agent.",
        PERMISSION_CHANNEL_FLAGS.join(" or ")
    );
    Ok(if verified_version(version) { CliTag::Tested } else { CliTag::Untested(version.to_owned()) })
}

pub fn version_number(output: &str) -> Option<&str> {
    let output = output.trim();
    let output = output.strip_prefix("Claude Code ").unwrap_or(output);
    let version = output.strip_suffix(" (Claude Code)").unwrap_or(output);
    (!version.is_empty() && !version.chars().any(char::is_whitespace)).then_some(version)
}

pub fn session_id() -> Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes)
        .map_err(|error| anyhow::anyhow!("Create Claude session identity: {error}"))?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex = bytes.map(|byte| format!("{byte:02x}")).concat();
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    ))
}

pub fn command_arguments(
    session_id: &str,
    resume: bool,
    settings: &maitty_shared::conversation::LaunchSettings,
) -> Vec<OsString> {
    command_arguments_for_turn(session_id, resume, settings, &TurnChoice::default())
}

/// The launch arguments for one message. A picked model replaces the conversation's own for this
/// message and an effort adds `--effort`; each message starts its own process, so the choice holds
/// exactly as long as the caller keeps sending it. Permission arguments never depend on it.
pub fn command_arguments_for_turn(
    session_id: &str,
    resume: bool,
    settings: &maitty_shared::conversation::LaunchSettings,
    choice: &TurnChoice,
) -> Vec<OsString> {
    let mut arguments = vec![
        "-p".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--include-partial-messages".into(),
        "--verbose".into(),
        "--permission-prompt-tool=stdio".into(),
        "--replay-user-messages".into(),
    ];
    let permission_mode = match (settings.sandbox, settings.approval_policy) {
        (maitty_shared::conversation::Sandbox::FullAccess, _) => "bypassPermissions",
        (maitty_shared::conversation::Sandbox::ReadOnly, _) => "plan",
        (_, maitty_shared::conversation::ApprovalPolicy::Never) => "dontAsk",
        (
            _,
            maitty_shared::conversation::ApprovalPolicy::Untrusted
            | maitty_shared::conversation::ApprovalPolicy::OnRequest,
        ) => "default",
    };
    arguments.extend(["--permission-mode".into(), permission_mode.into()]);
    if settings.sandbox == maitty_shared::conversation::Sandbox::FullAccess {
        arguments.push("--allow-dangerously-skip-permissions".into());
    }
    if !resume {
        arguments.extend(["--session-id".into(), session_id.into()]);
    } else {
        arguments.push(format!("--resume={session_id}").into());
    }
    if let Some(model) = choice.model.as_deref().or(settings.model.as_deref()) {
        arguments.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = choice.effort.as_deref() {
        arguments.extend(["--effort".into(), effort.into()]);
    }
    arguments
}

/// What Claude Code can do in a chat, checked against the pinned version. It takes no message
/// into a running turn and has no history to ask for: its saved conversation is a file.
pub fn capabilities() -> maitty_shared::conversation::capabilities::Capabilities {
    use maitty_shared::conversation::capabilities::{Capabilities, Verified};
    Capabilities {
        resume: true,
        verified: Verified::Pinned,
        ..Capabilities::default()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        OutputFrame, bounded_content_text, command_arguments, parse_output_frame, session_id,
        CliTag, check_cli, verified_version, version_number,
    };
    use maitty_shared::conversation::{ApprovalPolicy, LaunchSettings, Provider, Sandbox};
    use std::path::PathBuf;

    #[test]
    fn only_the_locally_verified_cli_version_read_from_its_output_is_supported() {
        assert!(verified_version("2.1.312"));
        assert!(verified_version("2.1.314"));
        assert!(verified_version("2.1.316"));
        assert!(verified_version("2.1.327"));
        assert!(verified_version("2.1.330"));
        assert!(!verified_version("2.1.313"));
        assert!(!verified_version("2.1.326"), "only the versions run through the adapter are listed");
        // The version is read from what `claude --version` prints.
        assert_eq!(version_number("2.1.314 (Claude Code)"), Some("2.1.314"));
        assert_eq!(version_number("Claude Code 2.1.312"), Some("2.1.312"));
        assert_eq!(version_number(" 2.1.313 "), Some("2.1.313"));
        assert_eq!(version_number("2.1.314 (unexpected)"), None);
    }

    const HELP: &str = "  -p, --print  Print\n  --input-format <format>\n  --output-format <format>\n  --include-partial-messages\n  --replay-user-messages\n  --verbose\n  --permission-mode <mode>\n  --session-id <uuid>\n  -r, --resume [value]\n  --permission-prompts <target>  (or --permission-prompt-tool)\n";

    #[test]
    fn a_newer_cli_that_lists_what_the_adapter_needs_starts_and_is_tagged_untested() {
        assert_eq!(check_cli("2.1.330 (Claude Code)", HELP).unwrap(), CliTag::Tested);
        assert_eq!(check_cli("2.1.331 (Claude Code)", HELP).unwrap(), CliTag::Untested("2.1.331".into()));
        assert_eq!(check_cli("9.0.0 (Claude Code)", HELP).unwrap(), CliTag::Untested("9.0.0".into()));
    }

    #[test]
    fn a_cli_missing_a_needed_flag_is_refused_naming_it() {
        let without = HELP.replace("--replay-user-messages", "--replay");
        let said = check_cli("2.1.400 (Claude Code)", &without).unwrap_err().to_string();
        assert!(said.contains("Claude Code") && said.contains("--replay-user-messages"), "{said}");
        let no_permission_channel = HELP.replace("--permission-prompts", "--x").replace("--permission-prompt-tool", "--y");
        assert!(check_cli("2.1.400 (Claude Code)", &no_permission_channel).is_err());
        // A longer flag does not stand in for the one the adapter passes.
        assert!(check_cli("2.1.400 (Claude Code)", &HELP.replace("--resume", "--resume-session-at")).is_err());
    }

    #[test]
    fn a_binary_that_is_not_claude_code_is_refused() {
        assert!(check_cli("not a version", HELP).is_err());
        assert!(check_cli("", HELP).is_err());
        assert!(check_cli("hello (Claude Code)", HELP).is_err());
        assert!(check_cli("2.1.330 (Claude Code)", "").is_err());
    }

    #[test]
    fn parses_streamed_text_and_refuses_unknown_frame_types() {
        assert_eq!(
            parse_output_frame(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"hello"}}}"#).unwrap(),
            OutputFrame::TextDelta { block_index: 2, text: "hello".into() }
        );
        assert!(parse_output_frame(r#"{"type":"unknown_future_event"}"#).is_err());
    }

    #[test]
    fn an_error_result_carries_its_reason_from_result_or_errors() {
        let result = |line: &str| match parse_output_frame(line).unwrap() {
            OutputFrame::Result { result, .. } => result,
            other => panic!("{other:?}"),
        };
        assert_eq!(
            result(r#"{"type":"result","subtype":"success","session_id":"s","is_error":true,"result":"API Error: 400 model not found"}"#).as_deref(),
            Some("API Error: 400 model not found")
        );
        assert_eq!(
            result(r#"{"type":"result","subtype":"error_during_execution","session_id":"s","is_error":true,"errors":["first", " ", "second"]}"#).as_deref(),
            Some("first; second")
        );
        assert_eq!(
            result(r#"{"type":"result","subtype":"error_during_execution","session_id":"s","is_error":true}"#),
            None
        );
        assert_eq!(
            result(r#"{"type":"result","session_id":"s","is_error":false,"errors":["ignored"]}"#),
            None,
            "a turn that did not fail has no reasons to give"
        );
    }

    #[test]
    fn tool_content_previews_are_bounded() {
        let preview = bounded_content_text(Some(&serde_json::json!("x".repeat(9000))));
        assert!(preview.ends_with("[Output truncated]"));
        assert!(preview.len() < 9000);
    }

    #[test]
    fn session_ids_are_unique_valid_uuids() {
        let first = session_id().unwrap();
        let second = session_id().unwrap();
        assert_eq!(first.len(), 36);
        assert_eq!(first.as_bytes()[14], b'4');
        assert!(matches!(first.as_bytes()[19], b'8'..=b'b'));
        assert_ne!(first, second);
    }

    #[test]
    fn read_only_launch_arguments_select_plan_mode_and_the_model() {
        let settings = LaunchSettings {
            agent: None,
            provider: Provider::Claude,
            executable: PathBuf::from("claude"),
            config_root: PathBuf::from("config"),
            cwd: PathBuf::from("workspace"),
            model: Some("sonnet".into()),
            model_provider: None,
            approval_policy: ApprovalPolicy::OnRequest,
            sandbox: Sandbox::ReadOnly,
        };
        let arguments = command_arguments("session-1", false, &settings);
        let arguments = arguments
            .iter()
            .map(|argument| argument.to_string_lossy())
            .collect::<Vec<_>>();

        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "plan"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--session-id", "session-1"])
        );
        assert!(
            arguments
                .windows(2)
                .any(|pair| pair == ["--model", "sonnet"])
        );
    }
}
