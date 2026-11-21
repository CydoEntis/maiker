//! A prototype of a provider dialect with no I/O, written over `TurnProjector` to see if one
//! trait can hold Claude Code's one-process-per-message model. Test-only: the daemon does not use
//! it. The findings are in `docs/research/provider-trait-claude-fit.md`.

use crate::{
    MAX_PENDING_TOOLS, OutputFrame, ProjectedEvent, TurnProjector, command_arguments_for_turn,
    parse_output_frame,
};
use anyhow::{Context, Result, bail, ensure};
use maitty_shared::conversation::{LaunchSettings, TurnChoice};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::ffi::OsString;

const INITIALIZE_REQUEST_ID: &str = "claude-initialize";

/// A process the caller starts for the dialect. Two equal plans describe interchangeable
/// processes, which is how a caller knows one it started ahead can take the next message.
#[derive(Debug, PartialEq)]
struct LaunchPlan {
    arguments: Vec<OsString>,
    /// Written as soon as the process starts, so one started ahead is already initializing.
    preamble: Vec<String>,
}

/// The caller makes the ids, so the dialect needs no randomness.
enum Command {
    Open,
    Send { turn: String, user_item: String, text: String, choice: TurnChoice },
    Answer { request: String, accept: bool },
    Interrupt { turn: String },
}

#[derive(Debug, PartialEq)]
enum Step {
    Spawn(LaunchPlan),
    Write(String),
    /// Ends the process's input, so it exits by itself.
    CloseInput,
    Emit(ProviderEvent),
}

#[derive(Debug, PartialEq)]
enum Stop {
    Done,
    Interrupted,
    Failed,
}

#[derive(Debug, PartialEq)]
enum ProviderEvent {
    Ready { session: String },
    TurnStarted { turn: String },
    ItemStarted(Value),
    TextDelta { item: String, text: String },
    ItemCompleted(Value),
    ApprovalRequested { request: String, tool: String, input: Value },
    InterruptAcknowledged,
    TurnCompleted { turn: String, stop: Stop },
    Terminated { failure: String },
}

trait ProviderDialect {
    /// An error refuses the command and leaves the conversation as it was.
    fn on_command(&mut self, command: Command) -> Result<Vec<Step>>;
    /// An error means the provider can no longer be trusted: the caller ends the conversation.
    fn on_line(&mut self, line: &str) -> Result<Vec<Step>>;
    fn on_exit(&mut self) -> Vec<Step>;
    /// The process the next message most likely needs, for a caller that starts it ahead.
    fn next_launch(&self) -> Option<LaunchPlan>;
}

struct ActiveTurn {
    id: String,
    projector: TurnProjector,
    /// The message, held until Claude answers the initialize request.
    unsent: Option<String>,
    acknowledged: bool,
    /// Each pending request's tool input: Claude wants it back in the answer.
    approvals: BTreeMap<String, Value>,
}

struct ClaudeDialect {
    session: String,
    settings: LaunchSettings,
    awaiting_first_message: bool,
    last_choice: TurnChoice,
    turn: Option<ActiveTurn>,
}

impl ClaudeDialect {
    fn new(session: String, settings: LaunchSettings, awaiting_first_message: bool) -> Self {
        Self { session, settings, awaiting_first_message, last_choice: TurnChoice::default(), turn: None }
    }

    fn launch_plan(&self, choice: &TurnChoice) -> LaunchPlan {
        let initialize = json!({
            "type":"control_request",
            "request_id":INITIALIZE_REQUEST_ID,
            "request":{"subtype":"initialize","hooks":null}
        });
        LaunchPlan {
            arguments: command_arguments_for_turn(
                &self.session,
                !self.awaiting_first_message,
                &self.settings,
                choice,
            ),
            preamble: vec![initialize.to_string()],
        }
    }
}

impl ProviderDialect for ClaudeDialect {
    fn on_command(&mut self, command: Command) -> Result<Vec<Step>> {
        match command {
            Command::Open => Ok(vec![Step::Emit(ProviderEvent::Ready { session: self.session.clone() })]),
            Command::Send { turn, user_item, text, choice } => {
                ensure!(self.turn.is_none(), "Claude is still answering the last message");
                ensure!(!text.is_empty(), "Claude send has no text input");
                choice.validate().map_err(anyhow::Error::msg)?;
                let plan = self.launch_plan(&choice);
                let projector =
                    TurnProjector::new(self.session.clone(), turn.clone(), text.clone(), user_item);
                self.turn = Some(ActiveTurn {
                    id: turn,
                    projector,
                    unsent: Some(text),
                    acknowledged: false,
                    approvals: BTreeMap::new(),
                });
                self.last_choice = choice;
                Ok(vec![Step::Spawn(plan)])
            }
            Command::Answer { request, accept } => {
                let turn = self.turn.as_mut().context("Claude approval has no running turn")?;
                let input = turn.approvals.remove(&request).context("Claude approval is stale")?;
                let mut answer = json!({"behavior": if accept { "allow" } else { "deny" }, "updatedInput": input});
                if !accept {
                    answer["message"] = "The user declined this action.".into();
                }
                Ok(vec![control_response(&request, answer)])
            }
            Command::Interrupt { turn } => {
                ensure!(
                    self.turn.as_ref().is_some_and(|active| active.id == turn),
                    "Claude interruption targets a stale turn"
                );
                Ok(vec![write(json!({
                    "type":"control_request",
                    "request_id":interrupt_id(&turn),
                    "request":{"subtype":"interrupt"}
                }))])
            }
        }
    }

    fn on_line(&mut self, line: &str) -> Result<Vec<Step>> {
        let frame = parse_output_frame(line)?;
        let turn = self.turn.as_mut().context("Claude sent output with no message in flight")?;
        match frame {
            OutputFrame::Initialized { session_id } => {
                ensure!(
                    session_id == self.session,
                    "Claude initialized a different session than the requested identity"
                );
                Ok(Vec::new())
            }
            OutputFrame::ControlResponse { response } => {
                let request_id = response.get("request_id").and_then(Value::as_str);
                if request_id == Some(INITIALIZE_REQUEST_ID) {
                    ensure!(
                        response.get("subtype").and_then(Value::as_str) != Some("error"),
                        "Claude Code rejected adapter initialization"
                    );
                    let message = turn.unsent.take().map(|text| {
                        write(json!({
                            "type":"user",
                            "message":{"role":"user","content":[{"type":"text","text":text}]}
                        }))
                    });
                    return Ok(message.into_iter().collect());
                }
                if request_id == Some(interrupt_id(&turn.id).as_str()) {
                    turn.projector.interrupt_acknowledged();
                    return Ok(vec![Step::Emit(ProviderEvent::InterruptAcknowledged)]);
                }
                Ok(Vec::new())
            }
            OutputFrame::ControlRequest { request_id, request } => {
                ensure!(
                    request.get("subtype").and_then(Value::as_str) == Some("can_use_tool"),
                    "Unsupported Claude control request"
                );
                let tool = request.get("tool_name").and_then(Value::as_str).unwrap_or_default().to_owned();
                let input = request.get("input").filter(|input| input.is_object()).cloned().unwrap_or_else(|| json!({}));
                if tool == "AskUserQuestion" {
                    let refusal = json!({"behavior":"deny","message":"Ask the user in your response; chat accepts free-text replies."});
                    return Ok(vec![control_response(&request_id, refusal)]);
                }
                ensure!(
                    turn.approvals.len() < MAX_PENDING_TOOLS
                        && turn.approvals.insert(request_id.clone(), input.clone()).is_none(),
                    "Claude approval request queue overflow or ID reuse"
                );
                Ok(vec![Step::Emit(ProviderEvent::ApprovalRequested { request: request_id, tool, input })])
            }
            frame => {
                let finished = matches!(frame, OutputFrame::Result { .. });
                ensure!(
                    !finished || turn.acknowledged,
                    "Claude completed without echoing the submitted prompt; delivery is uncertain"
                );
                let mut steps = Vec::new();
                for event in turn.projector.project(frame)? {
                    match event {
                        ProjectedEvent::Acknowledged { .. } => turn.acknowledged = true,
                        ProjectedEvent::Notification { method, params } => {
                            steps.push(Step::Emit(provider_event(&method, params)?));
                        }
                        ProjectedEvent::ControlRequest { .. } => {
                            bail!("Claude control request reached the turn projection")
                        }
                    }
                }
                if finished {
                    steps.push(Step::CloseInput);
                    self.turn = None;
                    self.awaiting_first_message = false;
                }
                Ok(steps)
            }
        }
    }

    fn on_exit(&mut self) -> Vec<Step> {
        match self.turn.take() {
            Some(_) => vec![Step::Emit(ProviderEvent::Terminated {
                failure: "Claude Code exited before the turn ended".into(),
            })],
            None => Vec::new(),
        }
    }

    fn next_launch(&self) -> Option<LaunchPlan> {
        (self.turn.is_none() && !self.awaiting_first_message)
            .then(|| self.launch_plan(&self.last_choice))
    }
}

fn write(value: Value) -> Step {
    Step::Write(value.to_string())
}

fn control_response(request_id: &str, response: Value) -> Step {
    write(json!({
        "type":"control_response",
        "response":{"subtype":"success","request_id":request_id,"response":response}
    }))
}

fn interrupt_id(turn: &str) -> String {
    format!("interrupt-{turn}")
}

/// `TurnProjector` speaks Codex's notification names; this is the one place they are read back.
fn provider_event(method: &str, mut params: Value) -> Result<ProviderEvent> {
    let text = |value: &Value| {
        value.as_str().map(str::to_owned).context("Claude projection has no text where one is needed")
    };
    Ok(match method {
        "turn/started" => ProviderEvent::TurnStarted { turn: text(&params["turn"]["id"])? },
        "item/started" => ProviderEvent::ItemStarted(params["item"].take()),
        "item/completed" => ProviderEvent::ItemCompleted(params["item"].take()),
        "item/agentMessage/delta" => ProviderEvent::TextDelta {
            item: text(&params["itemId"])?,
            text: text(&params["delta"])?,
        },
        "turn/completed" => ProviderEvent::TurnCompleted {
            turn: text(&params["turn"]["id"])?,
            stop: match params["turn"]["status"].as_str() {
                Some("completed") => Stop::Done,
                Some("interrupted") => Stop::Interrupted,
                _ => Stop::Failed,
            },
        },
        other => bail!("Claude projection has no provider event: {other}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::conversation::{ApprovalPolicy, Provider, Sandbox};
    use std::path::PathBuf;

    const INITIALIZED: &str =
        r#"{"type":"control_response","response":{"request_id":"claude-initialize","subtype":"success"}}"#;
    const RESULT: &str = r#"{"type":"result","session_id":"session-1","is_error":false}"#;

    fn dialect() -> ClaudeDialect {
        let settings = LaunchSettings {
            provider: Provider::Claude,
            executable: PathBuf::from("claude"),
            config_root: PathBuf::from("config"),
            cwd: PathBuf::from("workspace"),
            model: None,
            model_provider: None,
            approval_policy: ApprovalPolicy::OnRequest,
            sandbox: Sandbox::WorkspaceWrite,
        };
        ClaudeDialect::new("session-1".into(), settings, true)
    }

    fn send(turn: &str, text: &str, model: Option<&str>) -> Command {
        Command::Send {
            turn: turn.into(),
            user_item: format!("user-{turn}"),
            text: text.into(),
            choice: TurnChoice { model: model.map(str::to_owned), effort: None },
        }
    }

    fn replay(text: &str) -> String {
        json!({"type":"user","isReplay":true,"message":{"content":[{"type":"text","text":text}]}}).to_string()
    }

    /// Sends a message and plays Claude's side until the turn has started.
    fn start_turn(dialect: &mut ClaudeDialect, turn: &str, text: &str) {
        dialect.on_command(send(turn, text, None)).unwrap();
        dialect.on_line(INITIALIZED).unwrap();
        dialect.on_line(&replay(text)).unwrap();
    }

    fn arguments(steps: &[Step]) -> Vec<String> {
        let [Step::Spawn(plan)] = steps else {
            panic!("one process start, got {steps:?}");
        };
        plan.arguments.iter().map(|argument| argument.to_string_lossy().into_owned()).collect()
    }

    fn written(steps: &[Step]) -> Value {
        let [Step::Write(line)] = steps else {
            panic!("one written line, got {steps:?}");
        };
        serde_json::from_str(line).unwrap()
    }

    #[test]
    fn opening_a_conversation_starts_no_process() {
        let steps = dialect().on_command(Command::Open).unwrap();

        assert_eq!(steps, [Step::Emit(ProviderEvent::Ready { session: "session-1".into() })]);
    }

    #[test]
    fn a_first_message_starts_its_own_process_and_goes_out_once_claude_initialized() {
        let mut dialect = dialect();

        let started = dialect.on_command(send("turn-1", "show status", None)).unwrap();
        let early_init = dialect
            .on_line(r#"{"type":"system","subtype":"init","session_id":"session-1"}"#)
            .unwrap();
        let initialized = dialect.on_line(INITIALIZED).unwrap();

        let [Step::Spawn(plan)] = started.as_slice() else {
            panic!("one process start, got {started:?}");
        };
        let preamble: Value = serde_json::from_str(&plan.preamble[0]).unwrap();
        assert_eq!(preamble["request_id"], INITIALIZE_REQUEST_ID);
        assert!(arguments(&started).windows(2).any(|pair| pair == ["--session-id", "session-1"]));
        assert!(early_init.is_empty());
        assert_eq!(
            written(&initialized)["message"]["content"],
            json!([{"type":"text","text":"show status"}])
        );
    }

    #[test]
    fn a_turn_streams_text_and_ends_by_closing_its_process() {
        let mut dialect = dialect();
        dialect.on_command(send("turn-1", "show status", None)).unwrap();
        dialect.on_line(INITIALIZED).unwrap();

        let started = dialect.on_line(&replay("show status")).unwrap();
        dialect
            .on_line(r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg-1","model":"claude-sonnet"}}}"#)
            .unwrap();
        let streamed = dialect
            .on_line(r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"clean"}}}"#)
            .unwrap();
        let finished = dialect.on_line(RESULT).unwrap();

        let user = json!({"id":"user-turn-1","type":"userMessage","content":[{"type":"text","text":"show status"}]});
        assert_eq!(
            started,
            [
                Step::Emit(ProviderEvent::TurnStarted { turn: "turn-1".into() }),
                Step::Emit(ProviderEvent::ItemStarted(user.clone())),
                Step::Emit(ProviderEvent::ItemCompleted(user)),
            ]
        );
        assert_eq!(
            streamed,
            [
                Step::Emit(ProviderEvent::ItemStarted(json!({"id":"msg-1","type":"agentMessage","text":""}))),
                Step::Emit(ProviderEvent::TextDelta { item: "msg-1".into(), text: "clean".into() }),
            ]
        );
        assert_eq!(
            finished,
            [
                Step::Emit(ProviderEvent::ItemCompleted(json!({"id":"msg-1","type":"agentMessage","text":"clean"}))),
                Step::Emit(ProviderEvent::TurnCompleted { turn: "turn-1".into(), stop: Stop::Done }),
                Step::CloseInput,
            ]
        );
    }

    #[test]
    fn an_approval_is_answered_with_the_tool_input_claude_sent() {
        let mut dialect = dialect();
        start_turn(&mut dialect, "turn-1", "list files");

        let asked = dialect
            .on_line(r#"{"type":"control_request","request_id":"request-1","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"ls"}}}"#)
            .unwrap();
        let answered = dialect
            .on_command(Command::Answer { request: "request-1".into(), accept: true })
            .unwrap();
        let again = dialect.on_command(Command::Answer { request: "request-1".into(), accept: true });

        assert_eq!(
            asked,
            [Step::Emit(ProviderEvent::ApprovalRequested {
                request: "request-1".into(),
                tool: "Bash".into(),
                input: json!({"command":"ls"}),
            })]
        );
        assert_eq!(
            written(&answered)["response"],
            json!({"subtype":"success","request_id":"request-1","response":{"behavior":"allow","updatedInput":{"command":"ls"}}})
        );
        assert!(again.is_err(), "an approval is answered once");
    }

    #[test]
    fn the_next_message_resumes_the_session_in_a_new_process() {
        let mut dialect = dialect();
        assert_eq!(dialect.next_launch(), None, "nothing is started ahead of the first message");
        start_turn(&mut dialect, "turn-1", "show status");
        assert_eq!(dialect.next_launch(), None, "nothing is started ahead while a turn runs");
        dialect.on_line(RESULT).unwrap();

        let ahead = dialect.next_launch().expect("a process for the next message");
        let same_choice = dialect.on_command(send("turn-2", "and now?", None)).unwrap();

        assert_eq!(same_choice, [Step::Spawn(ahead)], "the process started ahead fits the message");
        let arguments = arguments(&same_choice);
        assert!(arguments.iter().any(|argument| argument == "--resume=session-1"));
        assert!(!arguments.iter().any(|argument| argument == "--session-id"));
    }

    #[test]
    fn a_message_with_another_model_does_not_fit_the_process_started_ahead() {
        let mut dialect = dialect();
        start_turn(&mut dialect, "turn-1", "show status");
        dialect.on_line(RESULT).unwrap();
        let ahead = dialect.next_launch().expect("a process for the next message");

        let picked = dialect.on_command(send("turn-2", "and now?", Some("opus"))).unwrap();

        assert_ne!(picked, [Step::Spawn(ahead)]);
        assert!(arguments(&picked).windows(2).any(|pair| pair == ["--model", "opus"]));
    }

    #[test]
    fn an_acknowledged_interrupt_ends_the_turn_as_interrupted() {
        let mut dialect = dialect();
        start_turn(&mut dialect, "turn-1", "run forever");

        let stale = dialect.on_command(Command::Interrupt { turn: "turn-0".into() });
        let asked = dialect.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap();
        let acknowledged = dialect
            .on_line(r#"{"type":"control_response","response":{"request_id":"interrupt-turn-1","subtype":"success"}}"#)
            .unwrap();
        let finished = dialect
            .on_line(r#"{"type":"result","session_id":"session-1","is_error":true,"subtype":"error_during_execution"}"#)
            .unwrap();

        assert!(stale.is_err());
        assert_eq!(written(&asked)["request"], json!({"subtype":"interrupt"}));
        assert_eq!(acknowledged, [Step::Emit(ProviderEvent::InterruptAcknowledged)]);
        assert_eq!(
            finished,
            [
                Step::Emit(ProviderEvent::TurnCompleted { turn: "turn-1".into(), stop: Stop::Interrupted }),
                Step::CloseInput,
            ]
        );
    }

    #[test]
    fn a_message_sent_during_a_turn_is_refused_and_the_turn_goes_on() {
        let mut dialect = dialect();
        start_turn(&mut dialect, "turn-1", "show status");

        let second = dialect.on_command(send("turn-2", "hurry", None));
        let finished = dialect.on_line(RESULT).unwrap();

        assert!(second.is_err());
        assert!(finished.contains(&Step::Emit(ProviderEvent::TurnCompleted {
            turn: "turn-1".into(),
            stop: Stop::Done
        })));
    }

    #[test]
    fn a_result_before_the_message_is_echoed_is_an_error() {
        let mut dialect = dialect();
        dialect.on_command(send("turn-1", "show status", None)).unwrap();
        dialect.on_line(INITIALIZED).unwrap();

        assert!(dialect.on_line(RESULT).is_err(), "delivery is uncertain");
    }

    #[test]
    fn a_process_that_exits_mid_turn_is_reported_and_one_that_exits_after_is_not() {
        let mut dialect = dialect();
        start_turn(&mut dialect, "turn-1", "show status");

        let mid_turn = dialect.on_exit();
        start_turn(&mut dialect, "turn-2", "again");
        dialect.on_line(RESULT).unwrap();
        let after_turn = dialect.on_exit();

        assert_eq!(
            mid_turn,
            [Step::Emit(ProviderEvent::Terminated {
                failure: "Claude Code exited before the turn ended".into()
            })]
        );
        assert!(after_turn.is_empty());
    }
}
