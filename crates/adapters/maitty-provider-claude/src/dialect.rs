//! Claude Code as a [`ProviderDialect`]: one `claude -p` process per message, resumed by session.
//!
//! The dialect asks for a process on every send and closes its input when the turn ends. The
//! daemon does not run it yet: its own loop still owns the process and uses the same projector
//! and approval reading.

use crate::approvals::approval_request;
use crate::{
    MAX_PENDING_TOOLS, OutputFrame, TurnProjector, command_arguments_for_turn, parse_output_frame,
};
use anyhow::{Context, Result, bail, ensure};
use maitty_provider::{Command, LaunchPlan, ProviderDialect, ProviderEvent, Step};
use maitty_shared::conversation::capabilities::Capabilities;
use maitty_shared::conversation::{ApprovalDecision, LaunchSettings, ProviderRequestId, TurnChoice};
use serde_json::{Value, json};
use std::collections::BTreeMap;

const INITIALIZE_REQUEST_ID: &str = "claude-initialize";

struct ActiveTurn {
    id: String,
    projector: TurnProjector,
    /// The message, held until Claude answers the initialize request.
    unsent: Option<String>,
    acknowledged: bool,
    /// Each pending request's tool input: Claude wants it back in the answer.
    approvals: BTreeMap<String, Value>,
}

pub struct ClaudeDialect {
    session: String,
    settings: LaunchSettings,
    /// No message has been sent yet, so the first process creates the session and the ones
    /// after resume it.
    awaiting_first_message: bool,
    last_choice: TurnChoice,
    turn: Option<ActiveTurn>,
}

impl ClaudeDialect {
    pub fn new(session: String, settings: LaunchSettings, awaiting_first_message: bool) -> Self {
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
            // Written at once, so a process started ahead is already initializing.
            preamble: vec![initialize.to_string()],
            ..LaunchPlan::default()
        }
    }

    fn answer(&mut self, request: &ProviderRequestId, decision: ApprovalDecision) -> Result<Step> {
        let ProviderRequestId::Text(request) = request else {
            bail!("Claude approval is stale");
        };
        let turn = self.turn.as_mut().context("Claude approval has no running turn")?;
        ensure!(turn.approvals.contains_key(request), "Claude approval is stale");
        let (behavior, message) = match decision {
            ApprovalDecision::Accept => ("allow", None),
            ApprovalDecision::Decline => ("deny", Some("The user declined this action.")),
            ApprovalDecision::AcceptForSession | ApprovalDecision::Cancel => {
                bail!("Unsupported Claude approval decision")
            }
        };
        let input = turn.approvals.remove(request).context("Claude approval is stale")?;
        let mut answer = json!({"behavior":behavior,"updatedInput":input});
        if let Some(message) = message {
            answer["message"] = message.into();
        }
        Ok(control_response(request, answer))
    }
}

impl ProviderDialect for ClaudeDialect {
    fn on_command(&mut self, command: Command) -> Result<Vec<Step>> {
        match command {
            Command::Open { session } => {
                ensure!(
                    session.is_none_or(|session| session == self.session),
                    "Claude was asked to open a different session"
                );
                Ok(vec![Step::Emit(ProviderEvent::Ready {
                    session: self.session.clone(),
                    model: None,
                    model_provider: None,
                })])
            }
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
            Command::Answer { request, decision } => Ok(vec![self.answer(&request, decision)?]),
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
            Command::Steer { .. } => bail!("Claude Code does not take a message into a running turn"),
            // Claude's questions are refused as they arrive, so none is ever open to answer.
            Command::AnswerInput { .. } => bail!("Claude approval is stale"),
            // The saved conversation is Claude's transcript file, which the daemon reads itself.
            Command::ReadHistory { .. } => bail!("Claude Code has no history to ask for"),
        }
    }

    fn on_line(&mut self, line: &str) -> Result<Vec<Step>> {
        let frame = parse_output_frame(line)?;
        let turn = self.turn.as_mut().context("Claude sent output with no message in flight")?;
        match frame {
            // Claude Code (2.1.325, 2.1.327) sends its `init` only once the message is in, after
            // the initialize answer, so the session it names is checked whenever it comes.
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
                    return Ok(vec![Step::Emit(ProviderEvent::InterruptAcknowledged { turn: turn.id.clone() })]);
                }
                Ok(Vec::new())
            }
            OutputFrame::ControlRequest { request_id, request } => {
                ensure!(
                    request.get("subtype").and_then(Value::as_str) == Some("can_use_tool"),
                    "Unsupported Claude control request"
                );
                let tool = request.get("tool_name").and_then(Value::as_str).unwrap_or_default();
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
                let (request, command_hash) = approval_request(&turn.id, &request_id, &request, tool, &input);
                Ok(vec![Step::Emit(ProviderEvent::ApprovalRequested { request: Box::new(request), command_hash })])
            }
            frame => {
                let finished = matches!(frame, OutputFrame::Result { .. });
                ensure!(
                    !finished || turn.acknowledged,
                    "Claude completed without echoing the submitted prompt; delivery is uncertain"
                );
                let events = turn.projector.project(frame)?;
                turn.acknowledged |= events.iter().any(|event| matches!(event, ProviderEvent::Delivered { .. }));
                let mut steps: Vec<_> = events.into_iter().map(Step::Emit).collect();
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

    fn capabilities(&self) -> Capabilities {
        crate::capabilities()
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

#[cfg(test)]
mod tests;
