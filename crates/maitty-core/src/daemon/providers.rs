//! The one place the daemon names a provider. Everything that differs between agents is a field
//! here, and the rest of the daemon reads the field. A new agent is one more entry.

use super::conversation::follow_transcript::Format;
use crate::conversation::capabilities::Capabilities;
use crate::conversation::{LaunchSettings, Provider};
use anyhow::Result;
use serde_json::Value;
use std::path::PathBuf;

/// What the daemon needs to know about one agent.
pub(in crate::daemon) struct Adapter {
    /// How a chat with this agent runs. `None` when its chat is only read from the transcript
    /// its terminal writes.
    pub(in crate::daemon) structured: Option<Structured>,
    /// The format of the transcript the agent writes.
    pub(in crate::daemon) transcript: Format,
    /// Whether `stem`, a transcript's file name without its extension, is `session`'s.
    pub(in crate::daemon) transcript_is_sessions: fn(stem: &str, session: &str) -> bool,
    /// Finds a session's transcript by its id, for an agent whose hooks do not name the file.
    /// `None` for an agent whose hooks do: its file is never guessed.
    pub(in crate::daemon) find_transcript: Option<fn(session: &str) -> Option<PathBuf>>,
    /// The list of commands the agent can be asked for. `None` when it has none to ask for.
    pub(in crate::daemon) commands: Option<Commands>,
    /// Whether a side question can be put to a session without disturbing it.
    pub(in crate::daemon) side_questions: bool,
}

/// How the daemon runs a chat with an agent.
pub(in crate::daemon) struct Structured {
    /// The variable that tells the agent where its configuration is.
    pub(in crate::daemon) config_variable: &'static str,
    pub(in crate::daemon) process: ProcessModel,
    pub(in crate::daemon) history: HistorySource,
    /// Checks the reply to opening a conversation and returns the agent's own name for it,
    /// which must be the expected one when one was asked for.
    pub(in crate::daemon) opened:
        fn(reply: &Value, settings: &mut LaunchSettings, expected: Option<&str>) -> Result<String>,
    /// What the agent can do in a chat. `steers` is whether its running process says it takes
    /// a message into a turn; an agent that never does ignores it.
    pub(in crate::daemon) capabilities: fn(steers: bool) -> Capabilities,
}

/// How long an agent's process lives.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::daemon) enum ProcessModel {
    /// One server process for the whole conversation, spoken to in requests and replies.
    Server,
    /// One process for each message, which resumes the session and exits when the turn ends.
    PerMessage,
}

/// Where a conversation's saved history is read from.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::daemon) enum HistorySource {
    /// The agent is asked for it, a page at a time.
    Provider,
    /// The transcript file the agent writes.
    Transcript,
}

/// The program that lists an agent's commands, and what kind of list it gives.
pub(in crate::daemon) struct Commands {
    pub(in crate::daemon) program: &'static str,
    pub(in crate::daemon) list: CommandList,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(in crate::daemon) enum CommandList {
    SlashCommands,
    Skills,
}

/// How many characters of a session's id a Gemini transcript's name ends with.
const GEMINI_ID_CHARS: usize = 8;

static CODEX: Adapter = Adapter {
    structured: Some(Structured {
        config_variable: "CODEX_HOME",
        process: ProcessModel::Server,
        history: HistorySource::Provider,
        opened: maitty_provider_codex::requests::validate_thread,
        capabilities: maitty_provider_codex::capabilities,
    }),
    transcript: Format::Codex,
    transcript_is_sessions: |stem, session| stem.starts_with("rollout-") && stem.ends_with(session),
    find_transcript: Some(super::usage::codex_file_for),
    commands: Some(Commands { program: "codex", list: CommandList::Skills }),
    side_questions: false,
};

static CLAUDE: Adapter = Adapter {
    structured: Some(Structured {
        config_variable: "CLAUDE_CONFIG_DIR",
        process: ProcessModel::PerMessage,
        history: HistorySource::Transcript,
        // Claude's loop answers with the session alone: it has no sandbox or model to echo.
        opened: |reply, _, expected| maitty_provider_codex::requests::thread_id(reply, expected),
        capabilities: |_| maitty_provider_claude::capabilities(),
    }),
    transcript: Format::Claude,
    transcript_is_sessions: |stem, session| stem == session,
    find_transcript: None,
    commands: Some(Commands { program: "claude", list: CommandList::SlashCommands }),
    side_questions: true,
};

static GEMINI: Adapter = Adapter {
    structured: None,
    transcript: Format::Gemini,
    // `session-<time>-<first 8 of the session id>`.
    transcript_is_sessions: |stem, session| {
        stem.starts_with("session-")
            && session
                .get(..GEMINI_ID_CHARS)
                .is_some_and(|short| stem.ends_with(short))
    },
    find_transcript: None,
    commands: None,
    side_questions: false,
};

/// Any agent run over ACP. It has no transcript of its own that the daemon follows: a pane
/// running the same agent is known by that agent's own name, never as this.
static ACP: Adapter = Adapter {
    // Not run by the daemon yet (MAITTY-491).
    structured: None,
    // Never read: no pane's agent is named as this provider, so nothing follows a file for it.
    transcript: Format::Gemini,
    transcript_is_sessions: |_, _| false,
    find_transcript: None,
    commands: None,
    side_questions: false,
};

pub(in crate::daemon) fn adapter(provider: Provider) -> &'static Adapter {
    match provider {
        Provider::Codex => &CODEX,
        Provider::Claude => &CLAUDE,
        Provider::Gemini => &GEMINI,
        Provider::Acp => &ACP,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_has_an_entry_and_only_gemini_has_no_chat_runtime() {
        let without: Vec<_> = Provider::ALL
            .into_iter()
            .filter(|provider| adapter(*provider).structured.is_none())
            .collect();

        assert_eq!(without, [Provider::Gemini]);
    }

    #[test]
    fn only_codex_can_steer_and_only_when_its_process_says_so() {
        let steers = |provider, running: bool| {
            let structured = adapter(provider).structured.as_ref().unwrap();
            (structured.capabilities)(running).steer
        };

        assert!(steers(Provider::Codex, true) && !steers(Provider::Codex, false));
        assert!(!steers(Provider::Claude, true));
    }

    #[test]
    fn a_transcript_is_a_sessions_only_under_its_agents_naming() {
        let session = "0123abcd-ffff";
        let named = |provider, stem| (adapter(provider).transcript_is_sessions)(stem, session);

        assert!(named(Provider::Claude, "0123abcd-ffff") && !named(Provider::Claude, "rollout-0123abcd-ffff"));
        assert!(named(Provider::Codex, "rollout-2026-0123abcd-ffff") && !named(Provider::Codex, "0123abcd-ffff"));
        assert!(named(Provider::Gemini, "session-2026-0123abcd") && !named(Provider::Gemini, "session-2026-ffffffff"));
    }

    #[test]
    fn a_transcript_is_found_by_session_only_where_hooks_do_not_name_it() {
        let found: Vec<_> = Provider::ALL
            .into_iter()
            .filter(|provider| adapter(*provider).find_transcript.is_some())
            .collect();

        assert_eq!(found, [Provider::Codex]);
    }
}
