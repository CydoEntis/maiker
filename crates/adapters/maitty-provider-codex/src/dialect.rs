//! Codex's app-server as a [`ProviderDialect`]: one long-lived process speaking JSON-RPC.
//!
//! The dialect starts at the open connection. Starting the process, the `initialize` handshake
//! and the version and schema checks are still the daemon's, as is the tracking of helper
//! agents: what Codex reports about a helper's own thread is not carried here yet.

use crate::approvals;
use crate::envelope::{Envelope, RequestId, decode};
use crate::history::{self, HistoryEvent};
use crate::requests;
use anyhow::{Context, Result, bail, ensure};
use maitty_provider::{Asked, Command, Item, LaunchPlan, ProviderDialect, ProviderEvent, SavedTurn, Step};
use maitty_shared::conversation::capabilities::{Capabilities, Verified};
use maitty_shared::conversation::history::ItemState;
use maitty_shared::conversation::{
    ApprovalRequestKind, FileChangePreview, LaunchSettings, ProviderRequestId,
};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

const FILE_CHANGE_PATCH: &str = "item/fileChange/patchUpdated";

/// What an answer from Codex will be the answer to.
enum Waiting {
    Open,
    Send,
    Steer { turn: String },
    Interrupt { turn: String },
    History,
}

impl Waiting {
    fn asked(&self) -> Asked {
        match self {
            Self::Open => Asked::Open,
            Self::Send => Asked::Send,
            Self::Steer { .. } => Asked::Steer,
            Self::Interrupt { .. } => Asked::Interrupt,
            Self::History => Asked::ReadHistory,
        }
    }
}

/// What a request to a person needs for its answer to be written.
struct Open {
    kind: ApprovalRequestKind,
    permissions: Option<Value>,
}

pub struct CodexDialect {
    settings: LaunchSettings,
    /// The effective-configuration overrides every thread is opened with.
    policy: Map<String, Value>,
    /// Whether this Codex takes a message into a running turn, as its schema says.
    steer: bool,
    thread: Option<String>,
    expected: Option<String>,
    last_request: i64,
    waiting: BTreeMap<i64, Waiting>,
    requests: BTreeMap<ProviderRequestId, Open>,
    file_changes: BTreeMap<(String, String), Vec<FileChangePreview>>,
}

impl CodexDialect {
    /// `last_request` is the identity of the last request the handshake sent; the dialect counts
    /// on from it.
    pub fn new(settings: LaunchSettings, policy: Map<String, Value>, steer: bool, last_request: i64) -> Self {
        Self {
            settings,
            policy,
            steer,
            thread: None,
            expected: None,
            last_request,
            waiting: BTreeMap::new(),
            requests: BTreeMap::new(),
            file_changes: BTreeMap::new(),
        }
    }

    fn thread(&self) -> Result<&str> {
        self.thread.as_deref().context("The Codex thread is not open yet")
    }

    fn request(&mut self, waiting: Waiting, method: &str, params: Value) -> Result<Step> {
        self.last_request = self
            .last_request
            .checked_add(1)
            .context("Codex request identity exhausted")?;
        self.waiting.insert(self.last_request, waiting);
        Ok(Step::Write(
            json!({"id": self.last_request, "method": method, "params": params}).to_string(),
        ))
    }

    fn respond(request: &ProviderRequestId, response: Value) -> Step {
        let id = RequestId::from(request.clone());
        Step::Write(json!({"id": id, "result": response}).to_string())
    }

    fn open(&mut self, session: Option<String>) -> Result<Step> {
        ensure!(
            self.thread.is_none() && !self.waiting.values().any(|waiting| matches!(waiting, Waiting::Open)),
            "The Codex thread is already open"
        );
        let (method, mut params) = match &session {
            Some(thread) => ("thread/resume", requests::thread_resume_params(&self.settings, thread)),
            None => ("thread/start", requests::thread_start_params(&self.settings)),
        };
        params
            .get_mut("config")
            .and_then(Value::as_object_mut)
            .context("Structured launch configuration overrides missing")?
            .extend(self.policy.clone());
        self.expected = session;
        self.request(Waiting::Open, method, params)
    }

    fn answered(&mut self, waiting: Waiting, value: Value) -> Result<ProviderEvent> {
        Ok(match waiting {
            Waiting::Open => {
                let opened = requests::validate_thread(&value, &mut self.settings, self.expected.as_deref());
                match opened {
                    Ok(session) => {
                        self.thread = Some(session.clone());
                        ProviderEvent::Ready {
                            session,
                            model: self.settings.model.clone(),
                            model_provider: self.settings.model_provider.clone(),
                        }
                    }
                    Err(error) => ProviderEvent::Invalid { asked: Asked::Open, reason: error.to_string() },
                }
            }
            Waiting::Send => ProviderEvent::Delivered { turn: requests::started_turn(&value)? },
            // Codex answered without an error, so the message is in its turn: it must count as
            // steered even if the answer is oddly shaped, or it would be sent twice.
            Waiting::Steer { turn } => ProviderEvent::Steered {
                turn: crate::parse_turn_steer_ack(&json!({"id":0,"result":value})).unwrap_or(turn),
            },
            Waiting::Interrupt { turn } => {
                ensure!(value.is_object(), "Codex interrupt acknowledgement is stale or invalid");
                ProviderEvent::InterruptAcknowledged { turn }
            }
            Waiting::History => self.history_page(&value)?,
        })
    }

    fn history_page(&self, value: &Value) -> Result<ProviderEvent> {
        let thread = self.thread()?;
        let turns = value
            .get("data")
            .and_then(Value::as_array)
            .context("Codex history page lacks turns")?;
        let mut saved = Vec::with_capacity(turns.len());
        for turn in turns {
            if turn.get("itemsView").is_some_and(|view| view != "full") {
                bail!("Codex history returned a partial item view");
            }
            let turn_id = requests::identifier(turn, "id")?;
            let status = history::event(thread, "turn/completed", &json!({"threadId":thread,"turn":turn}))
                .map_err(|reason| anyhow::anyhow!("{reason}"))?;
            let Some(HistoryEvent::TurnStatus { turn: named, state, started_at_ms, completed_at_ms }) = status else {
                bail!("Codex history turn has no status");
            };
            let mut items = Vec::new();
            for item in turn
                .get("items")
                .and_then(Value::as_array)
                .context("Codex history turn lacks items")?
            {
                let read = history::event(
                    thread,
                    "item/completed",
                    &json!({"threadId":thread,"turnId":turn_id,"item":item}),
                )
                .map_err(|reason| anyhow::anyhow!("{reason}"))?;
                if let Some(HistoryEvent::Item { turn, item, content, state, started_at_ms, completed_at_ms }) = read {
                    items.push(Item { turn, id: item, content, state, started_at_ms, completed_at_ms });
                }
            }
            saved.push(SavedTurn { turn: named, state, started_at_ms, completed_at_ms, items });
        }
        let next = match value.get("nextCursor") {
            Some(Value::String(cursor)) if !cursor.is_empty() => Some(cursor.clone()),
            None | Some(Value::Null) => None,
            _ => bail!("Codex history cursor is invalid or repeated"),
        };
        Ok(ProviderEvent::HistoryPage { turns: saved, next })
    }

    fn reported(&mut self, method: &str, params: &Value) -> Result<Vec<ProviderEvent>> {
        let thread = self.thread()?.to_owned();
        if params.get("threadId").and_then(Value::as_str) != Some(thread.as_str()) {
            return Ok(Vec::new());
        }
        let mut events = Vec::new();
        if method == FILE_CHANGE_PATCH
            && let Some((turn, item)) = approvals::subject(params)
            && let Some(changes) = params.get("changes").and_then(Value::as_array)
        {
            let changes = approvals::file_change_previews(changes);
            let subject = (turn.clone(), item.clone());
            match &changes {
                Some(changes) => self.file_changes.insert(subject, changes.clone()),
                None => self.file_changes.remove(&subject),
            };
            events.push(ProviderEvent::FileChanges { turn, item, changes });
        }
        let event = match history::event(&thread, method, params) {
            Ok(Some(event)) => event,
            Ok(None) => return Ok(events),
            Err(reason) => {
                events.push(ProviderEvent::Unreadable { reason });
                return Ok(events);
            }
        };
        events.push(match event {
            HistoryEvent::ProviderError { message, will_retry } => ProviderEvent::Problem { message, will_retry },
            HistoryEvent::Item { turn, item, content, state, started_at_ms, completed_at_ms } => {
                ProviderEvent::Item(Item { turn, id: item, content, state, started_at_ms, completed_at_ms })
            }
            HistoryEvent::Delta { turn, item, delta } => ProviderEvent::TextDelta { turn, item, text: delta },
            HistoryEvent::TurnStatus { turn, state: ItemState::Running, started_at_ms, .. } => {
                ProviderEvent::TurnStarted { turn, started_at_ms }
            }
            HistoryEvent::TurnStatus { turn, state, started_at_ms, completed_at_ms } => {
                if state != ItemState::Running {
                    self.requests.clear();
                    self.file_changes.clear();
                }
                let error = params
                    .get("turn")
                    .and_then(|turn| turn.get("error"))
                    .filter(|error| !error.is_null())
                    .map(history::error_message)
                    .transpose()
                    .map_err(|reason| anyhow::anyhow!("{reason}"))?;
                ProviderEvent::TurnCompleted { turn, state, error, started_at_ms, completed_at_ms }
            }
        });
        Ok(events)
    }

    fn asked(&mut self, id: RequestId, method: &str, params: &Value) -> Result<ProviderEvent> {
        let request_id = ProviderRequestId::from(id);
        let known = approvals::subject(params).and_then(|subject| self.file_changes.get(&subject)).cloned();
        let Some(asked) = approvals::approval_request(request_id.clone(), method, params, known) else {
            return Ok(ProviderEvent::UnsupportedRequest { request: request_id, method: method.to_owned() });
        };
        let open = Open { kind: asked.request.kind, permissions: asked.request.permissions.clone() };
        ensure!(
            self.requests.insert(request_id, open).is_none(),
            "Codex reused a pending approval request ID"
        );
        Ok(ProviderEvent::ApprovalRequested { request: asked.request, command_hash: asked.command_hash })
    }
}

impl ProviderDialect for CodexDialect {
    fn on_command(&mut self, command: Command) -> Result<Vec<Step>> {
        let step = match command {
            Command::Open { session } => self.open(session)?,
            Command::Send { user_item, text, choice, .. } => {
                let params = requests::turn_start_params(self.thread()?, &text, &user_item, &choice);
                self.request(Waiting::Send, "turn/start", params)?
            }
            Command::Steer { turn, text } => {
                ensure!(self.steer, "This Codex does not take a message into a running turn");
                let mut request = crate::turn_steer_request(0, self.thread()?, &turn, &text);
                self.request(Waiting::Steer { turn }, "turn/steer", request["params"].take())?
            }
            Command::Interrupt { turn } => {
                let params = requests::turn_interrupt_params(self.thread()?, &turn);
                self.request(Waiting::Interrupt { turn }, "turn/interrupt", params)?
            }
            Command::ReadHistory { cursor, limit } => {
                let params = requests::turns_list_params(self.thread()?, cursor.as_deref(), limit);
                self.request(Waiting::History, "thread/turns/list", params)?
            }
            Command::Answer { request, decision } => {
                let open = self.requests.get(&request).context("Approval request is stale or already answered")?;
                let response = match open.kind {
                    ApprovalRequestKind::Permission => {
                        requests::permission_response(decision, open.permissions.as_ref())?
                    }
                    ApprovalRequestKind::Command | ApprovalRequestKind::FileChange => {
                        requests::decision_response(decision)
                    }
                    ApprovalRequestKind::UserInput => {
                        bail!("This provider request kind does not support approval decisions")
                    }
                };
                self.requests.remove(&request);
                Self::respond(&request, response)
            }
            Command::AnswerInput { request, answers } => {
                let open = self.requests.get(&request).context("Approval request is stale or already answered")?;
                ensure!(
                    open.kind == ApprovalRequestKind::UserInput,
                    "This provider request does not take typed answers"
                );
                self.requests.remove(&request);
                Self::respond(&request, requests::user_input_response(answers))
            }
        };
        Ok(vec![step])
    }

    fn on_line(&mut self, line: &str) -> Result<Vec<Step>> {
        let events = match decode(line)? {
            Envelope::Response { id: RequestId::Integer(id), result } => {
                let waiting = self.waiting.remove(&id).context("Codex response has no pending request")?;
                vec![match result {
                    Ok(value) => self.answered(waiting, value)?,
                    Err(error) if matches!(waiting, Waiting::History) && error.is_thread_not_materialized() => {
                        ProviderEvent::NoHistoryYet { code: error.code }
                    }
                    Err(error) => ProviderEvent::Refused { asked: waiting.asked(), code: error.code },
                }]
            }
            Envelope::Response { .. } => bail!("Codex response has no pending request"),
            Envelope::Notification { method, params } => self.reported(&method, &params)?,
            Envelope::Request { id, method, params } => vec![self.asked(id, &method, &params)?],
        };
        Ok(events.into_iter().map(Step::Emit).collect())
    }

    fn on_exit(&mut self) -> Vec<Step> {
        vec![Step::Emit(ProviderEvent::Terminated { failure: "Codex stdout closed".into() })]
    }

    fn next_launch(&self) -> Option<LaunchPlan> {
        None
    }

    fn capabilities(&self) -> Capabilities {
        Capabilities {
            steer: self.steer,
            resume: true,
            history_replay: true,
            helpers: true,
            usage: true,
            verified: Verified::Pinned,
            ..Capabilities::default()
        }
    }
}

#[cfg(test)]
mod tests;
