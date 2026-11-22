//! The settings the terminal app and the desktop app share, as the daemon serves them.
//!
//! Both apps read and write the same `config.toml` through the daemon. Only the keys named
//! here are reachable this way: never secrets, machines or key bindings. The enums are the
//! wire form and the on-disk form (lowercase words), so a value that is not one of them
//! cannot be decoded, let alone written.

use serde::{Deserialize, Serialize};

/// What a new session opens as (`ui.new_session_view`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewSessionView {
    #[default]
    Chat,
    Terminal,
}

/// Which edge the sidebar sits on (`ui.sidebar_position`, also read as `sidebar_side`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SidebarSide {
    #[default]
    Left,
    Right,
}

/// Which of the dark and light themes shows (`appearance`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    Dark,
    Light,
}

/// How the desktop window is drawn (`ui.window_style`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowStyle {
    Flat,
    #[default]
    Glass,
}

/// What happens when an agent wants helpers (`sessions.helpers`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HelpersMay {
    #[default]
    Ask,
    Always,
    Never,
}

/// `as_str` gives the word each enum has in config.toml.
macro_rules! words {
    ($ty:ident { $($variant:ident => $word:literal),+ }) => {
        impl $ty {
            pub fn as_str(self) -> &'static str {
                match self { $($ty::$variant => $word),+ }
            }
        }
    };
}
words!(NewSessionView { Chat => "chat", Terminal => "terminal" });
words!(SidebarSide { Left => "left", Right => "right" });
words!(Appearance { Dark => "dark", Light => "light" });
words!(WindowStyle { Flat => "flat", Glass => "glass" });
words!(HelpersMay { Ask => "ask", Always => "always", Never => "never" });

/// `sessions.helpers_at_once` when the daemon did not say: the limit a config that sets none has.
pub const HELPERS_AT_ONCE_UNSAID: u8 = 4;

/// The longest theme name, agent name or start folder a setting may hold.
pub const SETTING_TEXT_MAX_BYTES: usize = 4096;

/// The shared settings as they are now (`Reply::Settings`, `ServerMsg::SettingsChanged`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SharedSettings {
    /// `sessions.agent`: "last used", or the agent a new session starts.
    pub default_agent: String,
    pub new_session_view: NewSessionView,
    pub sidebar_side: SidebarSide,
    pub theme_dark: String,
    pub theme_light: String,
    pub appearance: Appearance,
    /// The working spinner's frames.
    pub spinner: Vec<String>,
    /// `ui.start_dir`; empty means wherever the app runs.
    pub start_dir: String,
    /// The inverse of `ui.motion`.
    pub reduce_motion: bool,
    pub window_style: WindowStyle,
    /// The agents switched off in `[permissions.bypass]`: the app starts them asking for permission.
    /// Every other one that has a bypass flag starts without (ADR 0005). Absent from an older daemon.
    #[serde(default)]
    pub bypass_off: Vec<String>,
    /// `updates.machines`: remote machines update themselves after this computer does. Absent from an older
    /// daemon, which reads as on, its default.
    #[serde(default = "on")]
    pub update_machines: bool,
    /// `sessions.helpers`: whether an agent may start helpers. Absent from a daemon before
    /// `protocol::HELPER_SETTINGS_SINCE`, which reads as asking, the default.
    #[serde(default)]
    pub helpers: HelpersMay,
    /// `sessions.helpers_at_once`: how many helpers one session has working at once; more wait
    /// for a free slot. Absent from a daemon before `protocol::HELPER_SETTINGS_SINCE`, which reads
    /// as the default.
    #[serde(default = "helpers_at_once_unsaid")]
    pub helpers_at_once: u8,
}

fn on() -> bool {
    true
}

fn helpers_at_once_unsaid() -> u8 {
    HELPERS_AT_ONCE_UNSAID
}

/// Which shared setting `Command::SetSetting` changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SettingKey {
    DefaultAgent,
    NewSessionView,
    SidebarSide,
    ThemeDark,
    ThemeLight,
    Appearance,
    Spinner,
    StartDir,
    ReduceMotion,
    WindowStyle,
    /// Takes `SettingValue::List`: the agents to switch off; the rest are switched on.
    BypassOff,
    /// Takes `SettingValue::Bool`.
    UpdateMachines,
    /// Takes `SettingValue::Text`: `ask`, `always` or `never`. Read since
    /// `protocol::HELPER_SETTINGS_SINCE`.
    Helpers,
    /// Takes `SettingValue::Text`: one of the limits Settings offers (`2`, `4`, `8`). Read since
    /// `protocol::HELPER_SETTINGS_SINCE`.
    HelpersAtOnce,
}

/// The new value; it must be the kind the key takes or the daemon refuses it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SettingValue {
    Text(String),
    Bool(bool),
    List(Vec<String>),
    NewSessionView(NewSessionView),
    SidebarSide(SidebarSide),
    Appearance(Appearance),
    WindowStyle(WindowStyle),
}
