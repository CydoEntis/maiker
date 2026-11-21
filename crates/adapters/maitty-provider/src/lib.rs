//! The contract between the daemon and a provider adapter.
//!
//! An adapter is a [`ProviderDialect`]: a state machine with no I/O. The daemon owns the process,
//! its pipes, the clock and every identity. It hands the dialect what a person asked for and each
//! line the provider printed, and carries out the [`Step`]s it gets back. A dialect never decides
//! a conversation's status; it reports [`ProviderEvent`]s and the daemon decides.

pub mod approval;
pub mod redact;
pub mod tool_input;

use maitty_shared::conversation::capabilities::Capabilities;
use maitty_shared::conversation::history::{Content, IncompleteReason, ItemState};
use maitty_shared::conversation::{
    ApprovalDecision, ApprovalRequest, FileChangePreview, ProviderRequestId, TurnChoice,
};
use std::collections::BTreeMap;
use std::ffi::OsString;

/// A provider process to start: what to run it with and what to tell it first.
///
/// Two plans that compare equal start interchangeable processes. The daemon relies on that to use
/// a process it started ahead of the message it was meant for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LaunchPlan {
    /// The arguments after the program itself. The daemon chooses the program.
    pub arguments: Vec<OsString>,
    /// Variables to set for the process, by name.
    pub environment: BTreeMap<String, String>,
    /// Variables the process must not inherit from the daemon.
    pub removed_environment: Vec<String>,
    /// Lines written to the process as soon as it runs, before anything else.
    pub preamble: Vec<String>,
}

/// What the daemon asks of a dialect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Take up a conversation: a new one, or `session` as the provider knows it.
    Open { session: Option<String> },
    /// Start a turn with a person's message. `turn` and `user_item` are the daemon's names for
    /// the turn and the message; a provider that names turns itself reports its own in
    /// [`ProviderEvent::Delivered`], and the daemon uses that one from then on.
    Send {
        turn: String,
        user_item: String,
        text: String,
        choice: TurnChoice,
    },
    /// Add a message to the turn that is running.
    Steer { turn: String, text: String },
    /// Answer an approval the provider asked for.
    Answer {
        request: ProviderRequestId,
        decision: ApprovalDecision,
    },
    /// Answer the questions the provider asked a person, by question.
    AnswerInput {
        request: ProviderRequestId,
        answers: BTreeMap<String, Vec<String>>,
    },
    /// Stop the turn that is running.
    Interrupt { turn: String },
    /// Read a page of the conversation as the provider saved it. `cursor` is what the page
    /// before named as next; `limit` is the most turns wanted.
    ReadHistory { cursor: Option<String>, limit: usize },
}

/// Which command a provider refused, for an answer that arrives later than the command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Asked {
    Open,
    Send,
    Steer,
    Interrupt,
    ReadHistory,
}

/// One thing in a turn that a person can see: a message, a tool call, a thought.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub turn: String,
    pub id: String,
    pub content: Content,
    pub state: ItemState,
    /// When the provider says the item started and ended, in Unix milliseconds. A provider that
    /// reports no times leaves them out and the daemon stamps the item itself.
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
}

/// A turn as the provider saved it, with everything in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedTurn {
    pub turn: String,
    pub state: ItemState,
    pub started_at_ms: Option<u64>,
    pub completed_at_ms: Option<u64>,
    pub items: Vec<Item>,
}

/// What a provider did, in the daemon's words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderEvent {
    /// The conversation is open under the provider's own name for it, on the model it chose.
    Ready {
        session: String,
        model: Option<String>,
        model_provider: Option<String>,
    },
    /// The provider took the message into `turn`. This is the delivery receipt.
    Delivered { turn: String },
    /// The provider says the turn is running.
    TurnStarted { turn: String, started_at_ms: Option<u64> },
    /// An item appeared or changed.
    Item(Item),
    /// More text for a message that is still being written.
    TextDelta {
        turn: String,
        item: String,
        text: String,
    },
    /// The provider reported a problem. When it will retry, the turn goes on.
    Problem { message: String, will_retry: bool },
    /// The provider waits for a person: an approval or questions. `command_hash` is what a
    /// remembered answer to a command holds to, from the command exactly as sent.
    ApprovalRequested {
        request: ApprovalRequest,
        command_hash: Option<String>,
    },
    /// The provider asked something this project cannot answer. It is left unanswered.
    UnsupportedRequest {
        request: ProviderRequestId,
        method: String,
    },
    /// The files a pending change touches, as a person is shown them. `None` when the provider
    /// described them incompletely: such a change must not be approved.
    FileChanges {
        turn: String,
        item: String,
        changes: Option<Vec<FileChangePreview>>,
    },
    InterruptAcknowledged { turn: String },
    /// The provider took a steered message into `turn`.
    Steered { turn: String },
    /// The turn is over: completed, failed or interrupted, with the provider's reason if it
    /// gave one.
    TurnCompleted {
        turn: String,
        state: ItemState,
        error: Option<String>,
        started_at_ms: Option<u64>,
        completed_at_ms: Option<u64>,
    },
    /// A page of the saved conversation, oldest turn first, and the cursor of the next page.
    HistoryPage {
        turns: Vec<SavedTurn>,
        next: Option<String>,
    },
    /// The provider says there is no saved history to read yet, because no message was ever
    /// sent. `code` is its own, for a daemon that knows a message was sent and so reads this as
    /// a refusal.
    NoHistoryYet { code: i64 },
    /// The provider refused a command after it was written. `code` is the provider's own.
    Refused { asked: Asked, code: i64 },
    /// The provider answered a command with something that cannot be accepted, such as a
    /// conversation opened wider than was asked for. The conversation stays as it was.
    Invalid { asked: Asked, reason: String },
    /// Something the provider reported about a turn could not be read, so the history can no
    /// longer be called complete.
    Unreadable { reason: IncompleteReason },
    /// The provider process ended when it should not have.
    Terminated { failure: String },
}

/// What the daemon must do next, in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Start a provider process. A dialect whose provider lives for the whole conversation asks
    /// once, on [`Command::Open`]; one whose provider runs a single message asks on every send.
    Spawn(LaunchPlan),
    /// Write one line to the provider.
    Write(String),
    /// Close the provider's input: the dialect is done with this process and its exit is expected.
    CloseInput,
    Emit(ProviderEvent),
}

/// One conversation with one provider, with no I/O.
pub trait ProviderDialect: Send {
    /// Handles a request from the daemon. An error refuses the command and leaves the
    /// conversation as it was.
    fn on_command(&mut self, command: Command) -> anyhow::Result<Vec<Step>>;

    /// Handles one line the provider printed. An error means the provider's output can no longer
    /// be trusted, and the daemon ends the conversation.
    fn on_line(&mut self, line: &str) -> anyhow::Result<Vec<Step>>;

    /// The provider process ended. Returns nothing when the dialect had closed its input.
    fn on_exit(&mut self) -> Vec<Step>;

    /// The process the next message will most likely need, for the daemon to start ahead of time.
    /// `None` when there is nothing to gain: the provider is already running, or a turn is.
    fn next_launch(&self) -> Option<LaunchPlan>;

    /// What this conversation's provider can do. Only what was verified or advertised.
    fn capabilities(&self) -> Capabilities;
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::conversation::history::Role;

    /// A provider that echoes: one process for the conversation, one line in, one line out.
    #[derive(Default)]
    struct Echo {
        turn: Option<String>,
        closed: bool,
    }

    impl ProviderDialect for Echo {
        fn on_command(&mut self, command: Command) -> anyhow::Result<Vec<Step>> {
            match command {
                Command::Open { .. } => Ok(vec![Step::Spawn(LaunchPlan::default())]),
                Command::Send { turn, text, .. } => {
                    anyhow::ensure!(self.turn.is_none(), "a turn is already running");
                    self.turn = Some(turn.clone());
                    Ok(vec![Step::Write(text), Step::Emit(ProviderEvent::Delivered { turn })])
                }
                Command::Interrupt { .. } => {
                    self.closed = true;
                    Ok(vec![Step::CloseInput])
                }
                other => anyhow::bail!("the echo provider cannot {other:?}"),
            }
        }

        fn on_line(&mut self, line: &str) -> anyhow::Result<Vec<Step>> {
            let turn = self.turn.take().ok_or_else(|| anyhow::anyhow!("output outside a turn"))?;
            let reply = Item {
                turn: turn.clone(),
                id: "reply".into(),
                content: Content::Message { role: Role::Assistant, text: line.into() },
                state: ItemState::Completed,
                started_at_ms: None,
                completed_at_ms: None,
            };
            Ok(vec![Step::Emit(ProviderEvent::Item(reply)), Step::Emit(completed(turn))])
        }

        fn on_exit(&mut self) -> Vec<Step> {
            if self.closed {
                return Vec::new();
            }
            vec![Step::Emit(ProviderEvent::Terminated { failure: "the echo provider exited".into() })]
        }

        fn next_launch(&self) -> Option<LaunchPlan> {
            None
        }

        fn capabilities(&self) -> Capabilities {
            Capabilities::default()
        }
    }

    fn completed(turn: String) -> ProviderEvent {
        ProviderEvent::TurnCompleted {
            turn,
            state: ItemState::Completed,
            error: None,
            started_at_ms: None,
            completed_at_ms: None,
        }
    }

    fn send(turn: &str, text: &str) -> Command {
        Command::Send {
            turn: turn.into(),
            user_item: format!("{turn}-user"),
            text: text.into(),
            choice: TurnChoice::default(),
        }
    }

    fn events(steps: Vec<Step>) -> Vec<ProviderEvent> {
        steps
            .into_iter()
            .filter_map(|step| match step {
                Step::Emit(event) => Some(event),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_caller_that_knows_only_the_trait_can_run_a_whole_turn() {
        let mut dialect: Box<dyn ProviderDialect> = Box::new(Echo::default());

        let opened = dialect.on_command(Command::Open { session: None }).unwrap();
        let sent = dialect.on_command(send("turn-1", "hello")).unwrap();
        let answered = dialect.on_line("hello").unwrap();

        assert_eq!(opened, [Step::Spawn(LaunchPlan::default())]);
        assert_eq!(sent[0], Step::Write("hello".into()));
        assert_eq!(events(sent), [ProviderEvent::Delivered { turn: "turn-1".into() }]);
        assert_eq!(events(answered).last(), Some(&completed("turn-1".into())));
    }

    #[test]
    fn a_refused_command_leaves_the_turn_as_it_was() {
        let mut dialect = Echo::default();
        dialect.on_command(send("turn-1", "first")).unwrap();

        let refused = dialect.on_command(send("turn-2", "second"));

        assert!(refused.is_err());
        let answered = events(dialect.on_line("first").unwrap());
        assert!(matches!(&answered[1], ProviderEvent::TurnCompleted { turn, .. } if turn == "turn-1"));
    }

    #[test]
    fn an_exit_is_reported_unless_the_dialect_closed_the_input() {
        let mut crashed = Echo::default();
        let mut closed = Echo::default();
        closed.on_command(Command::Interrupt { turn: "turn-1".into() }).unwrap();

        assert!(matches!(events(crashed.on_exit())[..], [ProviderEvent::Terminated { .. }]));
        assert!(closed.on_exit().is_empty());
    }
}
