//! What another machine's daemon may answer to a chat request from this window. That daemon is
//! someone else's computer (ADR 0007), so only the answers a chat asks for are accepted, and
//! every string in them is made safe to draw before anything reads it.
//!
//! The walk is over the answer's serialized form, so a string field added to the protocol is
//! cleaned without anyone remembering to list it here.

use crate::remote_snapshot::{ITEMS_MAX, NODES_MAX};
use maitty_shared::hidden::{is_invisible, sanitize};
use maitty_shared::protocol::{Reply, SIDE_ANSWER_MAX_BYTES, SideAnswer};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

/// Longest string kept in a chat answer, in characters: a message, a tool's output, a diff.
pub const CHAT_TEXT_MAX: usize = 256 * 1024;

/// `reply` made safe, or why it is refused. Only the answers a chat asks for pass: a history
/// page, a send's receipt (delivered or queued) and a bare acknowledgement. Anything else, a
/// file's contents or a screen included, is refused, so a remote cannot answer a chat question
/// with something this window would treat differently.
pub fn vet_chat_reply(reply: Reply) -> Result<Reply, String> {
    match reply {
        Reply::Ok => Ok(Reply::Ok),
        Reply::ConversationRead(page) => Ok(Reply::ConversationRead(cleaned(page)?)),
        Reply::ConversationSent(receipt) => Ok(Reply::ConversationSent(cleaned(receipt)?)),
        Reply::ConversationQueued(receipt) => Ok(Reply::ConversationQueued(cleaned(receipt)?)),
        _ => Err("it is not an answer a chat asks for".into()),
    }
}

/// The answer to a chat started on another machine, or why it is refused. Only the start itself
/// passes: the new conversation's number and generation, which are used for requests to that
/// machine alone and never drawn.
pub fn vet_chat_start(reply: Reply) -> Result<Reply, String> {
    match reply {
        Reply::ConversationStarted { id, generation } => Ok(Reply::ConversationStarted { id, generation }),
        _ => Err("it is not the start of a chat".into()),
    }
}

/// A side answer (`/btw`) from another machine's daemon, made safe, or why it is refused. Only a
/// side answer passes, its text cut to what a side answer may hold and every string cleaned like a
/// chat's.
pub fn vet_side_answer(reply: Reply) -> Result<Reply, String> {
    match reply {
        Reply::SideAnswer { tag, answer } => {
            let answer = match cleaned(answer)? {
                SideAnswer::Answered { text } => SideAnswer::Answered { text: cut_to(text, SIDE_ANSWER_MAX_BYTES) },
                SideAnswer::Failed { reason } => SideAnswer::Failed { reason: cut_to(reason, SIDE_ANSWER_MAX_BYTES) },
                SideAnswer::NotSupported => SideAnswer::NotSupported,
            };
            Ok(Reply::SideAnswer { tag, answer })
        }
        _ => Err("it is not a side answer".into()),
    }
}

/// Longest worktree folder taken from another machine, in bytes.
const WORKTREE_PATH_MAX: usize = 4096;

/// The folder of a worktree another machine's daemon made (`Command::BranchWorktree`), or why it
/// is refused. It becomes the folder a session starts in there, so it must be one plain absolute
/// path: a single line, no control or hidden characters, not too long. It is never read here.
pub fn vet_worktree_reply(reply: Reply) -> Result<Reply, String> {
    let Reply::Text(folder) = reply else { return Err("it is not a worktree's folder".into()) };
    let plain = !folder.is_empty()
        && folder.len() <= WORKTREE_PATH_MAX
        && folder.starts_with('/')
        && !folder.chars().any(|c| c.is_control() || is_invisible(c));
    if plain { Ok(Reply::Text(folder)) } else { Err("its folder is not a plain absolute path".into()) }
}

/// `text` cut to at most `max` bytes, on a character boundary.
fn cut_to(mut text: String, max: usize) -> String {
    let mut end = max.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

/// `answer` with every string in it made safe to draw and its lists cut to what an answer may
/// hold, or why it cannot be.
pub(crate) fn cleaned<T: Serialize + DeserializeOwned>(answer: T) -> Result<T, String> {
    let mut value = serde_json::to_value(&answer).map_err(|_| "it could not be inspected")?;
    drop(answer);
    let mut nodes = 0;
    clean(&mut value, &mut nodes)?;
    serde_json::from_value(value).map_err(|_| "it was not the answer it claimed once cleaned".into())
}

fn clean(value: &mut Value, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if *nodes > NODES_MAX {
        return Err("it holds too many values".into());
    }
    match value {
        Value::String(text) => *text = clean_text(text),
        Value::Array(items) => {
            items.truncate(ITEMS_MAX);
            for item in items {
                clean(item, nodes)?;
            }
        }
        // The names are another machine's text as much as the values (a tool's input is any JSON).
        Value::Object(map) => {
            for (key, mut item) in std::mem::take(map).into_iter().take(ITEMS_MAX) {
                clean(&mut item, nodes)?;
                map.insert(clean_text(&key), item);
            }
        }
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
    Ok(())
}

/// Chat text keeps its lines and its tabs (code reads badly without them); everything else that
/// is a control or an invisible character goes, and a string is cut at `CHAT_TEXT_MAX`.
fn clean_text(text: &str) -> String {
    text.chars()
        .take(CHAT_TEXT_MAX)
        .flat_map(|c| match c {
            '\n' | '\t' => Some(c),
            c if c.is_control() || is_invisible(c) => sanitize(&c.to_string(), true).chars().next(),
            c => Some(c),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_shared::conversation::{ConversationId, QueuedReceipt};

    #[test]
    fn only_the_start_of_a_chat_is_taken_as_the_answer_to_starting_one() {
        let started = Reply::ConversationStarted { id: maitty_shared::conversation::ConversationId(7), generation: 1 };

        assert!(matches!(vet_chat_start(started), Ok(Reply::ConversationStarted { id, generation: 1 }) if id.0 == 7));
        assert!(vet_chat_start(Reply::Ok).is_err());
        assert!(vet_chat_start(Reply::Text("/etc/passwd".into())).is_err());
    }

    #[test]
    fn a_side_answer_from_another_machine_is_cleaned_and_cut() {
        let long = format!("hi\x1b[2J\u{202e}\n{}", "é".repeat(SIDE_ANSWER_MAX_BYTES));
        let Ok(Reply::SideAnswer { tag: 4, answer: SideAnswer::Answered { text } }) =
            vet_side_answer(Reply::SideAnswer { tag: 4, answer: SideAnswer::Answered { text: long } })
        else {
            panic!("a side answer passes");
        };
        assert!(text.len() <= SIDE_ANSWER_MAX_BYTES);
        assert!(text.starts_with("hi"));
        assert!(text.contains('\n'));
        assert!(!text.chars().any(|c| c == '\x1b' || c == '\u{202e}'));
    }

    #[test]
    fn a_worktree_folder_from_another_machine_is_one_plain_absolute_path() {
        let folder = |text: &str| vet_worktree_reply(Reply::Text(text.into()));
        assert!(matches!(folder("/home/me/.maitty/worktrees/app/quiet-otter"), Ok(Reply::Text(_))));
        for bad in ["", "relative/path", "/a\nrm -rf ~", "/a\u{202e}b", "/a\x1b[2J"] {
            assert!(folder(bad).is_err(), "{bad:?}");
        }
        assert!(folder(&format!("/{}", "a".repeat(5000))).is_err());
        assert!(vet_worktree_reply(Reply::Ok).is_err());
    }

    #[test]
    fn only_a_side_answer_answers_a_side_question() {
        assert!(vet_side_answer(Reply::Ok).is_err());
        assert!(matches!(
            vet_side_answer(Reply::SideAnswer { tag: 1, answer: SideAnswer::NotSupported }),
            Ok(Reply::SideAnswer { tag: 1, answer: SideAnswer::NotSupported })
        ));
    }

    #[test]
    fn chat_text_keeps_lines_and_tabs_and_loses_escapes_and_hidden_characters() {
        let said = "fn main() {\n\tprintln!(\"hi\");\x1b[31m\x07\u{202e}\n}\r\n";
        assert_eq!(clean_text(said), "fn main() {\n\tprintln!(\"hi\");[31m\n} \n");
    }

    #[test]
    fn a_string_past_the_limit_is_cut() {
        let long = "a".repeat(CHAT_TEXT_MAX + 10);
        assert_eq!(clean_text(&long).chars().count(), CHAT_TEXT_MAX);
    }

    #[test]
    fn the_names_in_an_answer_are_cleaned_too() {
        let mut value = serde_json::json!({ "input": { "pa\u{202e}th\x1b": "x" } });
        clean(&mut value, &mut 0).unwrap();
        assert_eq!(value, serde_json::json!({ "input": { "path": "x" } }));
    }

    #[test]
    fn every_string_in_an_answer_is_cleaned_wherever_it_sits() {
        let mut value = serde_json::json!({ "a": ["x\x1b[2Jy", { "b": "p\x07q" }], "n": 3 });
        clean(&mut value, &mut 0).unwrap();
        assert_eq!(value, serde_json::json!({ "a": ["x[2Jy", { "b": "pq" }], "n": 3 }));
    }

    #[test]
    fn the_answers_a_chat_asks_for_pass_and_the_rest_are_refused() {
        let queued = QueuedReceipt { conversation: ConversationId(4), generation: 2, operation: 9 };
        assert!(matches!(vet_chat_reply(Reply::Ok), Ok(Reply::Ok)));
        let Ok(Reply::ConversationQueued(back)) = vet_chat_reply(Reply::ConversationQueued(queued.clone())) else {
            panic!("a receipt is an answer a chat asks for");
        };
        assert_eq!(back, queued);
        for other in [Reply::Text("hi".into()), Reply::ConversationFile("secret".into()), Reply::TerminalReplay(vec![1])] {
            assert!(vet_chat_reply(other).is_err());
        }
    }
}
