//! One conversation with an ACP agent: one process, opened with `initialize` and a session, then
//! one `session/prompt` per turn.

use crate::envelope::{self, Incoming, METHOD_NOT_FOUND};
use crate::updates::{Projector, label};
use crate::wire::{
    CancelNotification, ClientCapabilities, InitializeRequest, InitializeResponse,
    NewSessionResponse, Outcome, PROTOCOL_VERSION, PermissionOption, PermissionOptionKind,
    PromptRequest, PromptResponse, RequestPermissionRequest, RequestPermissionResponse,
    SessionModeState, SessionNotification, SessionRequest, StopReason, TextBlock, ToolKind,
};
use anyhow::{Context, Result, bail, ensure};
use maitty_provider::approval::approval_text;
use maitty_provider::tool_input::clean_text;
use maitty_provider::{Asked, Command, Item, LaunchPlan, ProviderDialect, ProviderEvent, Step};
use maitty_shared::conversation::capabilities::{Capabilities, Mode, Verified};
use maitty_shared::conversation::history::{Content, ItemState, Role};
use maitty_shared::conversation::{
    ApprovalDecision, ApprovalRequest, ApprovalRequestKind, ProviderRequestId,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;

const INITIALIZE: &str = "initialize";
const SESSION_NEW: &str = "session/new";
const SESSION_LOAD: &str = "session/load";
const SESSION_PROMPT: &str = "session/prompt";
const SESSION_CANCEL: &str = "session/cancel";
const SESSION_UPDATE: &str = "session/update";
const REQUEST_PERMISSION: &str = "session/request_permission";

/// The most of an agent's own error message a person is shown.
const MAX_ERROR_CHARS: usize = 500;
/// The most permission requests kept open at once. An agent that asks for more is not trusted.
const MAX_OPEN_PERMISSIONS: usize = 32;
/// The most modes an agent may list.
const MAX_MODES: usize = 32;

/// What the daemon decided before the agent starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    /// The arguments that put the agent's program in ACP mode, from its `[[agents]]` entry.
    pub arguments: Vec<OsString>,
    /// The conversation's folder. ACP requires it absolute.
    pub cwd: PathBuf,
}

/// Which request of ours the agent has yet to answer. There is never more than one.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Sent {
    Initialize { resume: Option<String> },
    NewSession,
    LoadSession { session: String },
    Prompt,
}

struct Turn {
    id: String,
    projector: Projector,
}

pub struct AcpDialect {
    settings: Settings,
    next_id: i64,
    awaiting: Option<(i64, Sent)>,
    session: Option<String>,
    turn: Option<Turn>,
    /// The permission requests a person has yet to answer, with the options the agent gave.
    permissions: BTreeMap<ProviderRequestId, Vec<PermissionOption>>,
    load_session: bool,
    modes: Vec<Mode>,
    /// The dialect closed the agent's input, so its exit is expected.
    closed: bool,
}

impl AcpDialect {
    pub fn new(settings: Settings) -> Self {
        Self {
            settings,
            next_id: 1,
            awaiting: None,
            session: None,
            turn: None,
            permissions: BTreeMap::new(),
            load_session: false,
            modes: Vec::new(),
            closed: false,
        }
    }

    fn ask(&mut self, sent: Sent, method: &str, params: &impl serde::Serialize) -> Result<Step> {
        ensure!(self.awaiting.is_none(), "The agent has not answered the last request yet");
        let id = self.next_id;
        self.next_id += 1;
        let line = envelope::request(id, method, params)?;
        self.awaiting = Some((id, sent));
        Ok(Step::Write(line))
    }

    fn open(&mut self, resume: Option<String>) -> Result<Vec<Step>> {
        ensure!(self.session.is_none() && self.awaiting.is_none(), "The conversation is already open");
        ensure!(self.settings.cwd.is_absolute(), "The conversation's folder is not an absolute path");
        let plan = LaunchPlan { arguments: self.settings.arguments.clone(), ..LaunchPlan::default() };
        // No client capabilities: the agent reads, writes and runs with its own tools.
        let initialize = InitializeRequest {
            protocol_version: PROTOCOL_VERSION,
            client_capabilities: ClientCapabilities::default(),
        };
        let asked = self.ask(Sent::Initialize { resume }, INITIALIZE, &initialize)?;
        Ok(vec![Step::Spawn(plan), asked])
    }

    fn send(&mut self, turn: String, user_item: String, text: String) -> Result<Vec<Step>> {
        let session = self.session.clone().context("The conversation is not open")?;
        ensure!(self.turn.is_none(), "A turn is already running");
        let prompt = PromptRequest { session_id: session, prompt: [TextBlock { r#type: "text", text: text.clone() }] };
        let asked = self.ask(Sent::Prompt, SESSION_PROMPT, &prompt)?;
        let said = Item {
            turn: turn.clone(),
            id: user_item,
            content: Content::Message { role: Role::User, text },
            state: ItemState::Completed,
            started_at_ms: None,
            completed_at_ms: None,
        };
        self.turn = Some(Turn { id: turn.clone(), projector: Projector::new(turn.clone()) });
        Ok(vec![
            asked,
            Step::Emit(ProviderEvent::Item(said)),
            Step::Emit(ProviderEvent::Delivered { turn: turn.clone() }),
            Step::Emit(ProviderEvent::TurnStarted { turn, started_at_ms: None }),
        ])
    }

    fn interrupt(&mut self, turn: &str) -> Result<Vec<Step>> {
        ensure!(self.turn.as_ref().is_some_and(|running| running.id == turn), "That turn is not running");
        let session = self.session.clone().context("The conversation is not open")?;
        let mut steps = vec![Step::Write(envelope::notification(SESSION_CANCEL, &CancelNotification { session_id: session })?)];
        // ACP requires every open permission request to be answered as cancelled, never chosen.
        let cancelled = RequestPermissionResponse { outcome: Outcome::Cancelled };
        for request in std::mem::take(&mut self.permissions).into_keys() {
            steps.push(Step::Write(envelope::response(&request, &cancelled)?));
        }
        steps.push(Step::Emit(ProviderEvent::InterruptAcknowledged { turn: turn.to_owned() }));
        Ok(steps)
    }

    fn answer(&mut self, request: &ProviderRequestId, decision: ApprovalDecision) -> Result<Vec<Step>> {
        let options = self.permissions.get(request).context("That request is not waiting for an answer")?;
        // Only an option the agent gave is ever sent back, and only the one of the kind chosen.
        let chosen = options
            .iter()
            .find(|option| decision_of(option.kind) == Some(decision))
            .context("The agent offered no such choice")?;
        let outcome = Outcome::Selected { option_id: chosen.option_id.clone() };
        let line = envelope::response(request, &RequestPermissionResponse { outcome })?;
        self.permissions.remove(request);
        Ok(vec![Step::Write(line)])
    }

    fn answered(&mut self, id: i64, result: std::result::Result<Value, (i64, String)>) -> Result<Vec<Step>> {
        let (expected, sent) = self.awaiting.take().context("The agent answered a request that was never sent")?;
        ensure!(id == expected, "The agent answered a request that was never sent");
        match (sent, result) {
            (Sent::Initialize { resume }, Ok(result)) => self.initialized(resume, result),
            (Sent::NewSession, Ok(result)) => {
                let opened: NewSessionResponse = read(result, SESSION_NEW)?;
                Ok(self.opened(opened.session_id, opened.modes))
            }
            // The session keeps the name it was asked for by.
            (Sent::LoadSession { session }, Ok(_)) => Ok(self.opened(session, None)),
            (Sent::Prompt, Ok(result)) => {
                let ended: PromptResponse = read(result, SESSION_PROMPT)?;
                Ok(self.turn_ended(stop_state(ended.stop_reason)))
            }
            (Sent::Prompt, Err((_, message))) => Ok(self.turn_ended((ItemState::Failed, Some(error_text(&message))))),
            (_, Err((code, _))) => Ok(self.refuse_open(ProviderEvent::Refused { asked: Asked::Open, code })),
        }
    }

    fn initialized(&mut self, resume: Option<String>, result: Value) -> Result<Vec<Step>> {
        let agent: InitializeResponse = read(result, INITIALIZE)?;
        if agent.protocol_version != PROTOCOL_VERSION {
            let reason = format!("The agent speaks ACP version {}, and only version 1 is supported", agent.protocol_version);
            return Ok(self.refuse_open(ProviderEvent::Invalid { asked: Asked::Open, reason }));
        }
        self.load_session = agent.agent_capabilities.unwrap_or_default().load_session.unwrap_or(false);
        // No MCP servers are handed over: the agent uses the ones in its own configuration.
        let cwd = self.settings.cwd.clone();
        match resume {
            None => {
                let new = SessionRequest { session_id: None, cwd, mcp_servers: [] };
                Ok(vec![self.ask(Sent::NewSession, SESSION_NEW, &new)?])
            }
            Some(session) if self.load_session => {
                let load = SessionRequest { session_id: Some(session.clone()), cwd, mcp_servers: [] };
                Ok(vec![self.ask(Sent::LoadSession { session }, SESSION_LOAD, &load)?])
            }
            Some(_) => {
                let reason = "The agent cannot continue a saved conversation".to_owned();
                Ok(self.refuse_open(ProviderEvent::Invalid { asked: Asked::Open, reason }))
            }
        }
    }

    fn opened(&mut self, session: String, modes: Option<SessionModeState>) -> Vec<Step> {
        self.modes = modes
            .map(|modes| modes.available_modes)
            .unwrap_or_default()
            .into_iter()
            .take(MAX_MODES)
            .map(|mode| Mode { id: clean_text(&mode.id), name: label(&mode.name) })
            .collect();
        self.session = Some(session.clone());
        vec![Step::Emit(ProviderEvent::Ready { session, model: None, model_provider: None })]
    }

    /// The conversation could not be opened, so the agent has nothing left to do.
    fn refuse_open(&mut self, event: ProviderEvent) -> Vec<Step> {
        self.closed = true;
        vec![Step::Emit(event), Step::CloseInput]
    }

    fn turn_ended(&mut self, (state, error): (ItemState, Option<String>)) -> Vec<Step> {
        let Some(mut turn) = self.turn.take() else {
            return Vec::new();
        };
        self.permissions.clear();
        let mut steps: Vec<Step> = turn.projector.finish().into_iter().map(Step::Emit).collect();
        steps.push(Step::Emit(ProviderEvent::TurnCompleted {
            turn: turn.id,
            state,
            error,
            started_at_ms: None,
            completed_at_ms: None,
        }));
        steps
    }

    fn notified(&mut self, method: &str, params: Value) -> Result<Vec<Step>> {
        // Anything but a session's update says nothing a conversation keeps.
        if method != SESSION_UPDATE {
            return Ok(Vec::new());
        }
        let notice: SessionNotification = read(params, SESSION_UPDATE)?;
        // Before the session is open the agent may replay a saved one; that is not this turn's.
        let (Some(session), Some(turn)) = (&self.session, &mut self.turn) else {
            return Ok(Vec::new());
        };
        ensure!(notice.session_id == *session, "The agent reported on another session");
        Ok(turn.projector.update(notice.update).into_iter().map(Step::Emit).collect())
    }

    fn requested(&mut self, id: ProviderRequestId, method: &str, params: Value) -> Result<Vec<Step>> {
        if method != REQUEST_PERMISSION {
            // Files, terminals and questions were never offered, so they are not answered as if
            // they had been.
            return Ok(vec![
                Step::Write(envelope::error(&id, METHOD_NOT_FOUND, "Method not found")?),
                Step::Emit(ProviderEvent::UnsupportedRequest { request: id, method: label(method) }),
            ]);
        }
        let asked: RequestPermissionRequest = read(params, REQUEST_PERMISSION)?;
        let (Some(session), Some(turn)) = (&self.session, &self.turn) else {
            // Nothing is running that a person could allow anything for.
            let cancelled = RequestPermissionResponse { outcome: Outcome::Cancelled };
            return Ok(vec![Step::Write(envelope::response(&id, &cancelled)?)]);
        };
        ensure!(asked.session_id == *session, "The agent asked on another session");
        ensure!(!self.permissions.contains_key(&id), "The agent asked twice under one id");
        ensure!(self.permissions.len() < MAX_OPEN_PERMISSIONS, "The agent has too many requests open");
        let mut choices = Vec::new();
        for option in &asked.options {
            if let Some(decision) = decision_of(option.kind)
                && !choices.contains(&decision)
            {
                choices.push(decision);
            }
        }
        let call = &asked.tool_call;
        let what = approval_text(&label(call.title.as_deref().unwrap_or_default()));
        let runs = call.kind == Some(ToolKind::Execute);
        let request = ApprovalRequest {
            request_id: id.clone(),
            kind: if runs { ApprovalRequestKind::Command } else { ApprovalRequestKind::Permission },
            item_id: Some(call.tool_call_id.clone()),
            turn_id: Some(turn.id.clone()),
            command: runs.then(|| what.clone()),
            reason: (!runs).then(|| format!("{}: {what}", call.kind.unwrap_or_default().name())),
            cwd: None,
            changes: Vec::new(),
            questions: Vec::new(),
            permissions: None,
            choices,
            // The command is the agent's title for it, not the exact text it will run.
            can_remember: false,
        };
        self.permissions.insert(id, asked.options);
        Ok(vec![Step::Emit(ProviderEvent::ApprovalRequested { request, command_hash: None })])
    }
}

/// The decision a person is offered for an option of this kind. Rejecting for good has no
/// decision of ours, so it is not offered.
fn decision_of(kind: PermissionOptionKind) -> Option<ApprovalDecision> {
    match kind {
        PermissionOptionKind::AllowOnce => Some(ApprovalDecision::Accept),
        PermissionOptionKind::AllowAlways => Some(ApprovalDecision::AcceptForSession),
        PermissionOptionKind::RejectOnce => Some(ApprovalDecision::Decline),
        PermissionOptionKind::RejectAlways | PermissionOptionKind::Other => None,
    }
}

fn stop_state(reason: StopReason) -> (ItemState, Option<String>) {
    match reason {
        StopReason::EndTurn => (ItemState::Completed, None),
        StopReason::Cancelled => (ItemState::Interrupted, None),
        StopReason::Refusal => (ItemState::Failed, Some("The agent refused to continue".into())),
        StopReason::MaxTokens => (ItemState::Failed, Some("The agent reached its token limit".into())),
        StopReason::MaxTurnRequests => (ItemState::Failed, Some("The agent reached its limit of steps in one turn".into())),
        StopReason::Other => (ItemState::Failed, Some("The agent stopped for a reason this version does not know".into())),
    }
}

/// The agent's own error message, as a person may be shown it.
fn error_text(message: &str) -> String {
    let text: String = approval_text(&clean_text(message)).chars().take(MAX_ERROR_CHARS).collect();
    if text.trim().is_empty() { "The agent reported an error".into() } else { text }
}

/// A payload as its type. The parser's error can quote the payload, so it is not kept.
fn read<T: serde::de::DeserializeOwned>(payload: Value, method: &str) -> Result<T> {
    serde_json::from_value(payload).ok().with_context(|| format!("Agent payload for {method} is invalid"))
}

impl ProviderDialect for AcpDialect {
    fn on_command(&mut self, command: Command) -> Result<Vec<Step>> {
        match command {
            Command::Open { session } => self.open(session),
            Command::Send { turn, user_item, text, .. } => self.send(turn, user_item, text),
            Command::Interrupt { turn } => self.interrupt(&turn),
            Command::Answer { request, decision } => self.answer(&request, decision),
            Command::Steer { .. } => bail!("An ACP agent takes no message into a running turn"),
            Command::AnswerInput { .. } => bail!("An ACP agent is asked no questions"),
            Command::ReadHistory { .. } => bail!("An ACP agent's saved history is not read"),
        }
    }

    fn on_line(&mut self, line: &str) -> Result<Vec<Step>> {
        match envelope::decode(line)? {
            Incoming::Response { id, result } => self.answered(id, result),
            Incoming::Notification { method, params } => self.notified(&method, params),
            Incoming::Request { id, method, params } => self.requested(id, &method, params),
        }
    }

    fn on_exit(&mut self) -> Vec<Step> {
        if self.closed {
            return Vec::new();
        }
        self.closed = true;
        vec![Step::Emit(ProviderEvent::Terminated { failure: "The agent's process ended".into() })]
    }

    fn next_launch(&self) -> Option<LaunchPlan> {
        // The one process lives as long as the conversation.
        None
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            resume: self.load_session,
            modes: self.modes.clone(),
            verified: Verified::Advertised,
            ..Capabilities::default()
        }
    }
}

#[cfg(test)]
mod tests;
