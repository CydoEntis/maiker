use crate::{OutputFrame, bounded_content_text};
use anyhow::{Context, Result, bail};
use maitty_provider::tool_input::{bound_input, command_label};
use maitty_provider::{Item, ProviderEvent};
use maitty_shared::conversation::history::{Content, ItemState, Role};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

struct ProjectedTool {
    id: String,
    name: String,
    initial_input: Value,
    /// The complete input, known once the tool block ends; kept for the completion event.
    input: Value,
    partial_input: String,
    command: String,
}

pub struct TurnProjector {
    thread_id: String,
    turn_id: String,
    submitted_text: String,
    user_item_id: String,
    /// When this turn began (Unix ms). Claude reports no times, so the daemon-side clock stands in.
    started_at_ms: u64,
    acknowledged: bool,
    /// Claude acknowledged an interrupt of this turn, so an error result is the stop, not a failure.
    interrupted: bool,
    active_message_id: Option<String>,
    assistant_text: BTreeMap<String, String>,
    started_messages: BTreeSet<String>,
    tools_by_block: BTreeMap<u64, ProjectedTool>,
    tools_by_id: BTreeMap<String, ProjectedTool>,
}

impl TurnProjector {
    pub fn new(
        thread_id: String,
        turn_id: String,
        submitted_text: String,
        user_item_id: String,
    ) -> Self {
        Self {
            thread_id,
            turn_id,
            submitted_text,
            user_item_id,
            started_at_ms: now_ms(),
            acknowledged: false,
            interrupted: false,
            active_message_id: None,
            assistant_text: BTreeMap::new(),
            started_messages: BTreeSet::new(),
            tools_by_block: BTreeMap::new(),
            tools_by_id: BTreeMap::new(),
        }
    }

    #[cfg(test)]
    fn acknowledged(&self) -> bool {
        self.acknowledged
    }

    /// Records that Claude acknowledged an interrupt of this turn. Claude then ends the turn with an
    /// error result (`error_during_execution`, seen on Claude Code 2.1.325 and 2.1.327), which is the
    /// person's stop: it is reported as interrupted, not as a failure.
    pub fn interrupt_acknowledged(&mut self) {
        self.interrupted = true;
    }

    /// What one line of Claude's output says about the turn, in the order it happened.
    pub fn project(&mut self, frame: OutputFrame) -> Result<Vec<ProviderEvent>> {
        let mut events = Vec::new();
        match frame {
            OutputFrame::UserReplay { text } if !self.acknowledged => {
                anyhow::ensure!(
                    text == self.submitted_text,
                    "Claude replayed a different user message"
                );
                events.push(ProviderEvent::TurnStarted {
                    turn: self.turn_id.clone(),
                    started_at_ms: Some(whole_seconds(self.started_at_ms)),
                });
                let message = Content::Message { role: Role::User, text };
                events.push(self.started(self.user_item_id.clone(), message.clone()));
                events.push(self.ended(self.user_item_id.clone(), message, ItemState::Completed));
                events.push(ProviderEvent::Delivered { turn: self.turn_id.clone() });
                self.acknowledged = true;
            }
            OutputFrame::UserReplay { .. } => {}
            OutputFrame::MessageStarted { message_id, .. } => {
                self.active_message_id = Some(message_id);
            }
            OutputFrame::TextDelta { text, .. } => {
                let message_id = self
                    .active_message_id
                    .clone()
                    .context("Claude text arrived outside a message")?;
                if self.started_messages.insert(message_id.clone()) {
                    events.push(self.started(message_id.clone(), answer(String::new())));
                }
                self.assistant_text
                    .entry(message_id.clone())
                    .or_default()
                    .push_str(&text);
                events.push(ProviderEvent::TextDelta {
                    turn: self.turn_id.clone(),
                    item: message_id,
                    text,
                });
            }
            OutputFrame::ToolUse {
                block_index,
                id,
                name,
                input,
            } => {
                if self.tools_by_block.len() >= MAX_PENDING_TOOLS {
                    bail!("Claude emitted too many unfinished tool calls");
                }
                self.tools_by_block.insert(
                    block_index,
                    ProjectedTool {
                        id,
                        name,
                        initial_input: input,
                        input: Value::Null,
                        partial_input: String::new(),
                        command: String::new(),
                    },
                );
            }
            OutputFrame::ToolInputDelta {
                block_index,
                partial_json,
            } => {
                let tool = self
                    .tools_by_block
                    .get_mut(&block_index)
                    .context("Claude tool input delta has no matching tool call")?;
                let size = tool
                    .partial_input
                    .len()
                    .checked_add(partial_json.len())
                    .filter(|size| *size <= MAX_TOOL_INPUT_BYTES)
                    .context("Claude tool input exceeds size limit")?;
                tool.partial_input.reserve(size - tool.partial_input.len());
                tool.partial_input.push_str(&partial_json);
            }
            OutputFrame::ContentBlockEnded { block_index } => {
                if let Some(mut tool) = self.tools_by_block.remove(&block_index) {
                    let input = if tool.partial_input.is_empty() {
                        tool.initial_input.clone()
                    } else {
                        serde_json::from_str(&tool.partial_input)
                            .context("Claude tool input is invalid JSON")?
                    };
                    tool.input = input.clone();
                    tool.command = input
                        .get("command")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .unwrap_or_else(|| {
                            format!("{} {}", tool.name, bounded_content_text(Some(&input)))
                        });
                    events.push(self.started(tool.id.clone(), tool.step(String::new())));
                    self.tools_by_id.insert(tool.id.clone(), tool);
                }
            }
            OutputFrame::ToolResults(results) => {
                for result in results {
                    let tool = self
                        .tools_by_id
                        .remove(&result.id)
                        .context("Claude returned a result for an unknown tool call")?;
                    let state = if result.is_error {
                        ItemState::Failed
                    } else {
                        ItemState::Completed
                    };
                    events.push(self.ended(result.id, tool.step(result.output), state));
                }
            }
            OutputFrame::ControlRequest { .. } => {
                bail!("Claude control request reached the turn projection")
            }
            OutputFrame::Result {
                session_id,
                is_error,
                result,
            } => {
                anyhow::ensure!(
                    session_id == self.thread_id,
                    "Claude returned a different session identity"
                );
                for (message_id, streamed_text) in std::mem::take(&mut self.assistant_text) {
                    let text = result
                        .as_ref()
                        .filter(|text| !text.is_empty())
                        .unwrap_or(&streamed_text)
                        .clone();
                    events.push(self.ended(message_id, answer(text), ItemState::Completed));
                }
                let state = match (is_error, self.interrupted) {
                    (true, true) => ItemState::Interrupted,
                    (true, false) => ItemState::Failed,
                    (false, _) => ItemState::Completed,
                };
                events.push(ProviderEvent::TurnCompleted {
                    turn: self.turn_id.clone(),
                    state,
                    error: None,
                    started_at_ms: Some(whole_seconds(self.started_at_ms)),
                    completed_at_ms: Some(whole_seconds(now_ms())),
                });
            }
            OutputFrame::Initialized { .. }
            | OutputFrame::ControlResponse { .. }
            | OutputFrame::Other => {}
        }
        Ok(events)
    }

    fn started(&self, id: String, content: Content) -> ProviderEvent {
        ProviderEvent::Item(Item {
            turn: self.turn_id.clone(),
            id,
            content,
            state: ItemState::Running,
            started_at_ms: Some(now_ms()),
            completed_at_ms: None,
        })
    }

    fn ended(&self, id: String, content: Content, state: ItemState) -> ProviderEvent {
        ProviderEvent::Item(Item {
            turn: self.turn_id.clone(),
            id,
            content,
            state,
            started_at_ms: None,
            completed_at_ms: Some(now_ms()),
        })
    }
}

impl ProjectedTool {
    /// The tool call as a step of the turn, with what it has printed so far.
    fn step(&self, output: String) -> Content {
        Content::Tool {
            kind: TOOL_STEP.into(),
            label: command_label(Some(&self.command)),
            output,
            input: bound_input(&self.input),
            exit_code: None,
            duration_ms: None,
        }
    }
}

fn answer(text: String) -> Content {
    Content::Message { role: Role::Assistant, text }
}

/// A turn's times are kept in whole seconds, as every provider's saved history reports them, so
/// a turn reads the same live and after it is read back.
fn whole_seconds(ms: u64) -> u64 {
    ms / 1000 * 1000
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| u64::try_from(elapsed.as_millis()).ok())
        .unwrap_or_default()
}

pub const MAX_PENDING_TOOLS: usize = 64;
const MAX_TOOL_INPUT_BYTES: usize = 64 * 1024;
/// The kind every tool call is kept under: the history shows a tool call as a command step.
const TOOL_STEP: &str = "commandExecution";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn projector() -> TurnProjector {
        TurnProjector::new(
            "session-1".into(),
            "turn-1".into(),
            "show status".into(),
            "user-1".into(),
        )
    }

    fn result(is_error: bool, text: Option<&str>) -> OutputFrame {
        OutputFrame::Result {
            session_id: "session-1".into(),
            is_error,
            result: text.map(str::to_owned),
        }
    }

    fn item(event: &ProviderEvent) -> &Item {
        let ProviderEvent::Item(item) = event else {
            panic!("{event:?}");
        };
        item
    }

    #[test]
    fn acknowledges_only_the_exact_submitted_message_once() {
        let mut projector = projector();
        assert!(
            projector
                .project(OutputFrame::UserReplay {
                    text: "different prompt".into()
                })
                .is_err()
        );
        assert!(!projector.acknowledged());

        let events = projector
            .project(OutputFrame::UserReplay {
                text: "show status".into(),
            })
            .unwrap();
        assert!(matches!(events.first(), Some(ProviderEvent::TurnStarted { turn, .. }) if turn == "turn-1"));
        assert_eq!(events.last(), Some(&ProviderEvent::Delivered { turn: "turn-1".into() }));
        assert!(projector.acknowledged());
        assert!(
            projector
                .project(OutputFrame::UserReplay {
                    text: "show status".into()
                })
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn the_submitted_message_enters_the_turn_as_the_persons_own() {
        let mut projector = projector();

        let events = projector
            .project(OutputFrame::UserReplay { text: "show status".into() })
            .unwrap();

        let message = Content::Message { role: Role::User, text: "show status".into() };
        assert_eq!((&item(&events[1]).content, &item(&events[1]).state), (&message, &ItemState::Running));
        assert_eq!((&item(&events[2]).content, &item(&events[2]).state), (&message, &ItemState::Completed));
        assert_eq!(item(&events[2]).id, "user-1");
    }

    #[test]
    fn projects_streamed_assistant_text_into_an_answer() {
        let mut projector = projector();
        projector
            .project(OutputFrame::MessageStarted {
                message_id: "message-1".into(),
                model: "claude-sonnet".into(),
            })
            .unwrap();
        let started = projector
            .project(OutputFrame::TextDelta {
                block_index: 0,
                text: "hello".into(),
            })
            .unwrap();
        assert_eq!((&item(&started[0]).content, &item(&started[0]).state), (&answer(String::new()), &ItemState::Running));
        assert_eq!(
            started.last(),
            Some(&ProviderEvent::TextDelta { turn: "turn-1".into(), item: "message-1".into(), text: "hello".into() })
        );

        let completed = projector.project(result(false, Some("hello"))).unwrap();
        assert_eq!(item(&completed[0]).content, answer("hello".into()));
        assert!(matches!(
            completed.last(),
            Some(ProviderEvent::TurnCompleted { state: ItemState::Completed, error: None, .. })
        ));
    }

    #[test]
    fn projects_tool_input_only_after_the_complete_json_arrives() {
        let mut projector = projector();
        projector
            .project(OutputFrame::ToolUse {
                block_index: 2,
                id: "tool-1".into(),
                name: "Bash".into(),
                input: json!({}),
            })
            .unwrap();
        assert!(
            projector
                .project(OutputFrame::ToolInputDelta {
                    block_index: 2,
                    partial_json: "{\"command\":\"pwd\"}".into(),
                })
                .unwrap()
                .is_empty()
        );
        let started = projector
            .project(OutputFrame::ContentBlockEnded { block_index: 2 })
            .unwrap();
        assert!(matches!(
            started.as_slice(),
            [ProviderEvent::Item(Item { content: Content::Tool { label, .. }, state: ItemState::Running, .. })] if label == "pwd"
        ));

        let completed = projector
            .project(OutputFrame::ToolResults(vec![crate::ToolResult {
                id: "tool-1".into(),
                output: "done".into(),
                is_error: false,
            }]))
            .unwrap();
        assert!(matches!(
            completed.as_slice(),
            [ProviderEvent::Item(Item { content: Content::Tool { output, .. }, state: ItemState::Completed, .. })] if output == "done"
        ));
    }

    #[test]
    fn a_tool_step_carries_its_full_input_and_times_through_start_and_completion() {
        let mut projector = projector();
        projector
            .project(OutputFrame::ToolUse {
                block_index: 0,
                id: "tool-1".into(),
                name: "TodoWrite".into(),
                input: json!({}),
            })
            .unwrap();
        projector
            .project(OutputFrame::ToolInputDelta {
                block_index: 0,
                partial_json: r#"{"todos":[{"content":"ship","status":"pending"}]}"#.into(),
            })
            .unwrap();
        let todos = Some(json!({"todos":[{"content":"ship","status":"pending"}]}));
        let started = projector
            .project(OutputFrame::ContentBlockEnded { block_index: 0 })
            .unwrap();
        let completed = projector
            .project(OutputFrame::ToolResults(vec![crate::ToolResult {
                id: "tool-1".into(),
                output: "ok".into(),
                is_error: false,
            }]))
            .unwrap();
        let (begin, end) = (item(&started[0]), item(&completed[0]));
        let input = |item: &Item| match &item.content {
            Content::Tool { input, .. } => input.clone(),
            other => panic!("{other:?}"),
        };
        assert_eq!(input(begin), todos);
        assert_eq!(input(end), todos);
        assert!(begin.started_at_ms.unwrap() > 0);
        assert!(end.completed_at_ms.unwrap() >= begin.started_at_ms.unwrap());
    }

    #[test]
    fn a_failed_tool_call_is_a_failed_step() {
        let mut projector = projector();
        projector
            .project(OutputFrame::ToolUse { block_index: 0, id: "tool-1".into(), name: "Bash".into(), input: json!({"command":"false"}) })
            .unwrap();
        projector.project(OutputFrame::ContentBlockEnded { block_index: 0 }).unwrap();

        let completed = projector
            .project(OutputFrame::ToolResults(vec![crate::ToolResult { id: "tool-1".into(), output: "no".into(), is_error: true }]))
            .unwrap();

        assert_eq!(item(&completed[0]).state, ItemState::Failed);
    }

    #[test]
    fn an_error_result_after_an_acknowledged_interrupt_is_an_interrupted_turn() {
        let status = |interrupted: bool, is_error: bool| {
            let mut projector = projector();
            if interrupted {
                projector.interrupt_acknowledged();
            }
            let events = projector.project(result(is_error, None)).unwrap();
            let Some(ProviderEvent::TurnCompleted { state, .. }) = events.last() else {
                panic!("turn completion");
            };
            state.clone()
        };
        assert_eq!(status(true, true), ItemState::Interrupted);
        assert_eq!(status(false, true), ItemState::Failed, "an error nobody asked for is a failure");
        assert_eq!(status(true, false), ItemState::Completed, "a turn that ended before the stop is complete");
    }

    #[test]
    fn turn_events_carry_the_turn_times_in_whole_seconds() {
        let mut projector = projector();
        let started = projector
            .project(OutputFrame::UserReplay {
                text: "show status".into(),
            })
            .unwrap();
        let ProviderEvent::TurnStarted { started_at_ms: Some(began), .. } = &started[0] else {
            panic!("turn start");
        };
        let finished = projector.project(result(false, None)).unwrap();
        let Some(ProviderEvent::TurnCompleted { started_at_ms: Some(start), completed_at_ms: Some(end), .. }) = finished.last() else {
            panic!("turn completion");
        };
        assert!(*began > 0 && began % 1000 == 0 && end % 1000 == 0);
        assert!((start, end >= start) == (began, true));
    }

    #[test]
    fn a_control_request_never_reaches_the_projection() {
        let request = OutputFrame::ControlRequest { request_id: "request-1".into(), request: json!({}) };

        assert!(projector().project(request).is_err());
    }
}
