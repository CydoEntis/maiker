//! The contract between the daemon and a provider adapter.
//!
//! An adapter is a [`ProviderDialect`]: a state machine with no I/O. The daemon owns the process,
//! its pipes, the clock and every identity. It hands the dialect what a person asked for and each
//! line the provider printed, and carries out the [`Step`]s it gets back. A dialect never decides
//! a conversation's status; it reports [`ProviderEvent`]s and the daemon decides.

use maitty_shared::conversation::capabilities::Capabilities;
use maitty_shared::conversation::history::{Content, ItemState};
use maitty_shared::conversation::{ApprovalDecision, ApprovalRequest, ProviderRequestId, TurnChoice};
use std::collections::BTreeMap;

/// A provider process to start: what to run it with and what to tell it first.
///
/// Two plans that compare equal start interchangeable processes. The daemon relies on that to use
/// a process it started ahead of the message it was meant for.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LaunchPlan {
    /// The arguments after the program itself. The daemon chooses the program.
    pub arguments: Vec<String>,
    /// Variables to set for the process, by name.
    pub environment: BTreeMap<String, String>,
    /// Variables the process must not inherit from the daemon.
    pub removed_environment: Vec<String>,
    /// Lines written to the process as soon as it runs, before anything else.
    pub preamble: Vec<String>,
}

/// What the daemon asks of a dialect. Identities are the daemon's: a dialect never makes one up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// Take up a conversation: a new one, or `session` as the provider knows it.
    Open { session: Option<String> },
    /// Start a turn with a person's message.
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
}

/// One thing in a turn that a person can see: a message, a tool call, a thought.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub turn: String,
    pub id: String,
    pub content: Content,
    pub state: ItemState,
}

/// How a turn ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Stop {
    Done,
    /// A person stopped it.
    Cancelled,
    /// The provider gave up; the text is its reason.
    Failed(String),
}

/// What a provider did, in the daemon's words. No event carries a time: the daemon stamps them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderEvent {
    /// The conversation is open under the provider's own name for it.
    Ready { session: String },
    /// The provider took the message. The daemon treats this as the delivery receipt.
    TurnStarted { turn: String },
    ItemStarted(Item),
    /// More text for a message that is still being written.
    TextDelta {
        turn: String,
        item: String,
        text: String,
    },
    ItemCompleted(Item),
    /// The provider waits for a person: an approval or questions.
    ApprovalRequested(ApprovalRequest),
    InterruptAcknowledged { turn: String },
    TurnCompleted { turn: String, stop: Stop },
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
                    Ok(vec![Step::Write(text), Step::Emit(ProviderEvent::TurnStarted { turn })])
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
            };
            Ok(vec![
                Step::Emit(ProviderEvent::ItemCompleted(reply)),
                Step::Emit(ProviderEvent::TurnCompleted { turn, stop: Stop::Done }),
            ])
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
        assert_eq!(events(sent), [ProviderEvent::TurnStarted { turn: "turn-1".into() }]);
        assert!(matches!(
            events(answered).last(),
            Some(ProviderEvent::TurnCompleted { stop: Stop::Done, .. })
        ));
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
