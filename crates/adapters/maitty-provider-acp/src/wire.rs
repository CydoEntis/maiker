//! The part of ACP version 1 this adapter reads and writes, as it is on the wire.
//!
//! Written here and not taken from `agent-client-protocol-schema`: that crate turns on
//! `serde_json`'s `preserve_order` for every crate built with it, which changes the daemon's
//! own JSON (`docs/stack/acp.md`). A kind this file does not name reads as `Other`, so a newer
//! agent is understood as far as it can be and never misread.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

/// The only protocol version spoken.
pub(crate) const PROTOCOL_VERSION: u16 = 1;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeRequest {
    pub protocol_version: u16,
    pub client_capabilities: ClientCapabilities,
}

/// What the agent may ask the daemon to do for it: nothing.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClientCapabilities {
    pub fs: FileSystemCapabilities,
    pub terminal: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileSystemCapabilities {
    pub read_text_file: bool,
    pub write_text_file: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InitializeResponse {
    pub protocol_version: u16,
    #[serde(default)]
    pub agent_capabilities: Option<AgentCapabilities>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentCapabilities {
    #[serde(default)]
    pub load_session: Option<bool>,
}

/// A new session, or a saved one to load when `session_id` is set. No MCP servers are ever
/// handed over, and the protocol requires the list to be there.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub cwd: PathBuf,
    pub mcp_servers: [(); 0],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewSessionResponse {
    pub session_id: String,
    #[serde(default)]
    pub modes: Option<SessionModeState>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionModeState {
    #[serde(default)]
    pub available_modes: Vec<SessionMode>,
}

#[derive(Deserialize)]
pub(crate) struct SessionMode {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptRequest {
    pub session_id: String,
    pub prompt: [TextBlock; 1],
}

/// A piece of text a person wrote, as a content block.
#[derive(Serialize)]
pub(crate) struct TextBlock {
    pub r#type: &'static str,
    pub text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PromptResponse {
    pub stop_reason: StopReason,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub(crate) enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
    #[serde(other)]
    Other,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelNotification {
    pub session_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionNotification {
    pub session_id: String,
    pub update: SessionUpdate,
}

#[derive(Deserialize)]
#[serde(tag = "sessionUpdate", rename_all = "snake_case")]
pub(crate) enum SessionUpdate {
    AgentMessageChunk { content: ContentBlock },
    AgentThoughtChunk { content: ContentBlock },
    ToolCall(ToolCall),
    ToolCallUpdate(ToolCallUpdate),
    Plan { entries: Vec<PlanEntry> },
    /// The person's own message, commands, modes, usage, titles and anything newer.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ContentBlock {
    Text { text: String },
    Image,
    Audio,
    ResourceLink,
    Resource,
    #[serde(other)]
    Other,
}

impl ContentBlock {
    pub(crate) fn kind(&self) -> &'static str {
        match self {
            Self::Text { .. } => "text",
            Self::Image => "image",
            Self::Audio => "audio",
            Self::ResourceLink => "resource_link",
            Self::Resource => "resource",
            Self::Other => "content",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolCall {
    pub tool_call_id: String,
    pub title: String,
    #[serde(default)]
    pub kind: Option<ToolKind>,
    #[serde(default)]
    pub status: Option<ToolCallStatus>,
    #[serde(default)]
    pub content: Option<Vec<ToolCallContent>>,
    #[serde(default)]
    pub raw_input: Option<Value>,
}

/// A change to a tool call: only the fields that are there changed.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolCallUpdate {
    pub tool_call_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub kind: Option<ToolKind>,
    #[serde(default)]
    pub status: Option<ToolCallStatus>,
    #[serde(default)]
    pub content: Option<Vec<ToolCallContent>>,
    #[serde(default)]
    pub raw_input: Option<Value>,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ToolKind {
    Read,
    Edit,
    Delete,
    Move,
    Search,
    Execute,
    Think,
    Fetch,
    SwitchMode,
    #[default]
    #[serde(other)]
    Other,
}

impl ToolKind {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Edit => "edit",
            Self::Delete => "delete",
            Self::Move => "move",
            Self::Search => "search",
            Self::Execute => "execute",
            Self::Think => "think",
            Self::Fetch => "fetch",
            Self::SwitchMode => "switch_mode",
            Self::Other => "other",
        }
    }
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ToolCallStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
    Failed,
    /// A status this version does not know leaves the call running.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum ToolCallContent {
    Content { content: ContentBlock },
    Diff { path: String },
    Terminal,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
pub(crate) struct PlanEntry {
    pub content: String,
    pub status: PlanEntryStatus,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PlanEntryStatus {
    Pending,
    InProgress,
    Completed,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RequestPermissionRequest {
    pub session_id: String,
    pub tool_call: ToolCallUpdate,
    pub options: Vec<PermissionOption>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionOption {
    pub option_id: String,
    /// The agent's words for the option, as a person is shown them.
    #[serde(default)]
    pub name: String,
    pub kind: PermissionOptionKind,
}

#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PermissionOptionKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    #[serde(other)]
    Other,
}

#[derive(Serialize)]
pub(crate) struct RequestPermissionResponse {
    pub outcome: Outcome,
}

#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub(crate) enum Outcome {
    /// The turn was cancelled before a person chose.
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Selected { option_id: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_kind_this_version_does_not_know_reads_as_other_with_the_rest_intact() {
        let update: SessionUpdate = serde_json::from_value(json!({"sessionUpdate": "something_new", "x": [1]})).unwrap();
        let block: ContentBlock = serde_json::from_value(json!({"type": "hologram", "data": "…"})).unwrap();
        let image: ContentBlock = serde_json::from_value(json!({"type": "image", "data": "aGk=", "mimeType": "image/png"})).unwrap();
        let call: ToolCall = serde_json::from_value(json!({"toolCallId": "c", "title": "t", "kind": "teleport", "status": "paused", "locations": []})).unwrap();
        let stop: PromptResponse = serde_json::from_value(json!({"stopReason": "bored", "usage": {}})).unwrap();

        assert!(matches!(update, SessionUpdate::Other));
        assert_eq!((block.kind(), image.kind()), ("content", "image"));
        assert_eq!((call.kind, call.status), (Some(ToolKind::Other), Some(ToolCallStatus::Other)));
        assert_eq!(stop.stop_reason, StopReason::Other);
    }

    #[test]
    fn what_is_written_has_the_protocols_field_names() {
        let session = SessionRequest { session_id: None, cwd: "/work".into(), mcp_servers: [] };
        let chosen = RequestPermissionResponse { outcome: Outcome::Selected { option_id: "yes".into() } };
        let cancelled = RequestPermissionResponse { outcome: Outcome::Cancelled };

        assert_eq!(serde_json::to_value(session).unwrap(), json!({"cwd": "/work", "mcpServers": []}));
        assert_eq!(serde_json::to_value(chosen).unwrap(), json!({"outcome": {"outcome": "selected", "optionId": "yes"}}));
        assert_eq!(serde_json::to_value(cancelled).unwrap(), json!({"outcome": {"outcome": "cancelled"}}));
    }
}
