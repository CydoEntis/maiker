//! What a provider can do in one conversation, as the daemon reports it.

use serde::{Deserialize, Serialize};

/// How far a capability claim can be trusted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum Verified {
    /// Checked by this project against a pinned version of the provider.
    Pinned,
    /// Only what the provider said about itself; shown with a label.
    #[default]
    Advertised,
}

/// A way of working the provider offers, such as a permission mode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mode {
    pub id: String,
    pub name: String,
}

/// The abilities a control in the chat depends on. A flag is set only when the ability was
/// verified or advertised, so the default claims nothing.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Capabilities {
    /// A message can be sent into a running turn.
    #[serde(default)]
    pub steer: bool,
    /// A saved conversation can be continued after its process ended.
    #[serde(default)]
    pub resume: bool,
    /// The provider can replay a saved conversation's history.
    #[serde(default)]
    pub history_replay: bool,
    /// The models a person may pick. `None` when the provider offers no choice.
    #[serde(default)]
    pub models: Option<Vec<String>>,
    #[serde(default)]
    pub modes: Vec<Mode>,
    #[serde(default)]
    pub slash_commands: bool,
    /// The provider reports the helper agents it starts.
    #[serde(default)]
    pub helpers: bool,
    /// The provider reports token usage.
    #[serde(default)]
    pub usage: bool,
    #[serde(default)]
    pub verified: Verified,
}
