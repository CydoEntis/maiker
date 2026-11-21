//! What an agent reports during a turn (`session/update`) as the items a person sees.

use crate::wire::{
    ContentBlock, PlanEntry, PlanEntryStatus, SessionUpdate, ToolCall, ToolCallContent,
    ToolCallStatus, ToolCallUpdate,
};
use maitty_provider::tool_input::{bound_input, clean_text};
use maitty_provider::{Item, ProviderEvent};
use maitty_shared::conversation::history::{Content, ItemState, Role};
use std::collections::BTreeMap;

/// The most text one message, thought or tool output keeps. More than this is cut, and says so.
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_LABEL_CHARS: usize = 200;
/// The most tool calls one turn keeps track of. A call past this is shown once and not updated.
const MAX_TOOLS: usize = 256;
const CUT: &str = "\n[cut]";

#[derive(Clone, Copy, PartialEq, Eq)]
enum Speech {
    Message,
    Thought,
}

/// A message or thought that is still arriving in pieces.
struct Speaking {
    kind: Speech,
    item: String,
    text: String,
}

struct Tool {
    kind: String,
    label: String,
    input: Option<serde_json::Value>,
    output: String,
    state: ItemState,
}

pub(crate) struct Projector {
    turn: String,
    speaking: Option<Speaking>,
    spoken: u32,
    tools: BTreeMap<String, Tool>,
}

impl Projector {
    pub(crate) fn new(turn: String) -> Self {
        Self { turn, speaking: None, spoken: 0, tools: BTreeMap::new() }
    }

    pub(crate) fn update(&mut self, update: SessionUpdate) -> Vec<ProviderEvent> {
        match update {
            SessionUpdate::AgentMessageChunk { content } => self.speak(Speech::Message, &content),
            SessionUpdate::AgentThoughtChunk { content } => self.speak(Speech::Thought, &content),
            SessionUpdate::ToolCall(call) => {
                // A tool after some text ends that text, so what follows is a new message below it.
                let mut events = self.stop_speaking();
                events.extend(self.tool_started(call));
                events
            }
            SessionUpdate::ToolCallUpdate(update) => self.tool_changed(update),
            SessionUpdate::Plan { entries } => vec![self.plan(&entries)],
            // The person's own message is the daemon's to record, and the rest (commands, modes,
            // usage, titles) says nothing a turn's history keeps.
            SessionUpdate::Other => Vec::new(),
        }
    }

    /// The turn is over: whatever was still being said is complete as it stands.
    pub(crate) fn finish(&mut self) -> Vec<ProviderEvent> {
        self.stop_speaking()
    }

    fn item(&self, id: String, content: Content, state: ItemState) -> ProviderEvent {
        ProviderEvent::Item(Item {
            turn: self.turn.clone(),
            id,
            content,
            state,
            started_at_ms: None,
            completed_at_ms: None,
        })
    }

    fn speak(&mut self, kind: Speech, block: &ContentBlock) -> Vec<ProviderEvent> {
        let ContentBlock::Text { text } = block else {
            let mut events = self.stop_speaking();
            self.spoken += 1;
            let id = format!("{}-content-{}", self.turn, self.spoken);
            events.push(self.item(id, Content::Unsupported { kind: block.kind().into() }, ItemState::Completed));
            return events;
        };
        let mut events = Vec::new();
        if self.speaking.as_ref().is_some_and(|speaking| speaking.kind != kind) {
            events = self.stop_speaking();
        }
        let turn = self.turn.clone();
        let speaking = self.speaking.get_or_insert_with(|| {
            self.spoken += 1;
            Speaking { kind, item: format!("{turn}-text-{}", self.spoken), text: String::new() }
        });
        let room = MAX_TEXT_BYTES.saturating_sub(speaking.text.len());
        let added = cut_to(&clean_text(text), room).to_owned();
        if added.is_empty() {
            return events;
        }
        speaking.text.push_str(&added);
        let (item, whole) = (speaking.item.clone(), speaking.text.clone());
        events.push(match kind {
            Speech::Message => ProviderEvent::TextDelta { turn, item, text: added },
            // A thought has no piecewise update, so it is sent whole each time.
            Speech::Thought => self.item(item, Content::Reasoning { text: whole }, ItemState::Running),
        });
        events
    }

    fn stop_speaking(&mut self) -> Vec<ProviderEvent> {
        let Some(said) = self.speaking.take() else {
            return Vec::new();
        };
        let content = match said.kind {
            Speech::Message => Content::Message { role: Role::Assistant, text: said.text },
            Speech::Thought => Content::Reasoning { text: said.text },
        };
        vec![self.item(said.item, content, ItemState::Completed)]
    }

    fn tool_started(&mut self, call: ToolCall) -> Vec<ProviderEvent> {
        let id = call.tool_call_id;
        let tool = Tool {
            kind: call.kind.unwrap_or_default().name().into(),
            label: label(&call.title),
            input: call.raw_input.as_ref().and_then(bound_input),
            output: output(&call.content.unwrap_or_default()),
            state: state(call.status.unwrap_or_default()),
        };
        let event = self.tool_item(&id, &tool);
        if self.tools.len() < MAX_TOOLS || self.tools.contains_key(&id) {
            self.tools.insert(id, tool);
        }
        vec![event]
    }

    fn tool_changed(&mut self, update: ToolCallUpdate) -> Vec<ProviderEvent> {
        let id = update.tool_call_id.clone();
        // An update for a call never announced has nothing to change.
        let Some(mut tool) = self.tools.remove(&id) else {
            return Vec::new();
        };
        let fields = update;
        if let Some(kind) = fields.kind {
            tool.kind = kind.name().into();
        }
        if let Some(title) = &fields.title {
            tool.label = label(title);
        }
        if let Some(input) = &fields.raw_input {
            tool.input = bound_input(input);
        }
        if let Some(content) = &fields.content {
            tool.output = output(content);
        }
        if let Some(status) = fields.status {
            tool.state = state(status);
        }
        let event = self.tool_item(&id, &tool);
        self.tools.insert(id, tool);
        vec![event]
    }

    fn tool_item(&self, id: &str, tool: &Tool) -> ProviderEvent {
        let content = Content::Tool {
            kind: tool.kind.clone(),
            output: tool.output.clone(),
            label: tool.label.clone(),
            input: tool.input.clone(),
            exit_code: None,
            duration_ms: None,
        };
        self.item(id.to_owned(), content, tool.state.clone())
    }

    /// The agent's plan, one line per step. It is sent whole each time, so it is one item.
    fn plan(&self, entries: &[PlanEntry]) -> ProviderEvent {
        let mut lines = String::new();
        for entry in entries {
            let mark = match entry.status {
                PlanEntryStatus::Completed => "[x]",
                PlanEntryStatus::InProgress => "[~]",
                _ => "[ ]",
            };
            lines.push_str(&format!("{mark} {}\n", clean_text(&entry.content).replace('\n', " ")));
        }
        let done = entries.iter().all(|entry| matches!(entry.status, PlanEntryStatus::Completed));
        let content = Content::Tool {
            kind: "plan".into(),
            output: bounded(lines.trim_end()),
            label: "Plan".into(),
            input: None,
            exit_code: None,
            duration_ms: None,
        };
        self.item(format!("{}-plan", self.turn), content, if done { ItemState::Completed } else { ItemState::Running })
    }
}

fn state(status: ToolCallStatus) -> ItemState {
    match status {
        ToolCallStatus::Completed => ItemState::Completed,
        ToolCallStatus::Failed => ItemState::Failed,
        _ => ItemState::Running,
    }
}

/// A tool's title on one line, as a person is shown it.
pub(crate) fn label(title: &str) -> String {
    let clean = clean_text(title);
    clean.lines().next().unwrap_or_default().chars().take(MAX_LABEL_CHARS).collect()
}

/// What a tool produced, as text: its text, and for a change the file it touches.
fn output(content: &[ToolCallContent]) -> String {
    let mut text = String::new();
    for part in content {
        let line = match part {
            ToolCallContent::Content { content } => match content {
                ContentBlock::Text { text } => clean_text(text),
                other => format!("[{}]", other.kind()),
            },
            ToolCallContent::Diff { path } => format!("[changes {}]", clean_text(path)),
            ToolCallContent::Terminal => "[terminal]".into(),
            ToolCallContent::Other => continue,
        };
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&line);
    }
    bounded(&text)
}

fn bounded(text: &str) -> String {
    if text.len() <= MAX_TEXT_BYTES {
        return text.to_owned();
    }
    format!("{}{CUT}", cut_to(text, MAX_TEXT_BYTES))
}

/// The start of `text` that fits in `bytes`, ending on a whole character.
fn cut_to(text: &str, bytes: usize) -> &str {
    if text.len() <= bytes {
        return text;
    }
    let mut end = bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}
