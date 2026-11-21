//! A made-up agent that speaks the Agent Client Protocol, version 1, on its standard input and
//! output. Its lines are written from the protocol's schema, not recorded from a real agent.
//!
//! What it does with a prompt is in the prompt's own text:
//! - `permission`: asks to run a command under request `perm-1` and goes on once answered;
//! - `read a file`: asks for `fs/read_text_file`, which the daemon never offers;
//! - `wait`: says nothing more until the turn is cancelled;
//! - `die`: exits in the middle of the turn;
//! - anything else: answers "You said: <text>" and ends the turn.
//!
//! Started with `--version-2` it answers `initialize` with protocol version 2.
//!
//! It has no JSON library (a fixture is one file built by `rustc` alone), so it reads only the
//! lines the daemon writes: compact JSON with plain words in it.

use std::io::{self, BufRead, Write};

const SESSION: &str = "fake-acp-session";

/// The text of the string that follows `"key":"`, up to its closing quote. Escapes are left as
/// written, which is enough for the plain words the tests send.
fn text<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let start = line.find(&format!("\"{key}\":\""))? + key.len() + 4;
    let end = line[start..].find('"')?;
    Some(&line[start..start + end])
}

/// The message's id as written: a number, or a string with its quotes. No other key the daemon
/// writes ends in a quoted `id`.
fn id(line: &str) -> Option<&str> {
    let rest = &line[line.find("\"id\":")? + 5..];
    let end = rest.find([',', '}'])?;
    Some(&rest[..end])
}

fn say(out: &mut impl Write, line: &str) {
    writeln!(out, "{line}").unwrap();
    out.flush().unwrap();
}

fn update(out: &mut impl Write, update: &str) {
    say(out, &format!(r#"{{"jsonrpc":"2.0","method":"session/update","params":{{"sessionId":"{SESSION}","update":{update}}}}}"#));
}

fn message(out: &mut impl Write, text: &str) {
    update(out, &format!(r#"{{"sessionUpdate":"agent_message_chunk","content":{{"type":"text","text":"{text}"}}}}"#));
}

fn result(out: &mut impl Write, id: &str, result: &str) {
    say(out, &format!(r#"{{"jsonrpc":"2.0","id":{id},"result":{result}}}"#));
}

fn main() {
    let version = if std::env::args().any(|argument| argument == "--version-2") { 2 } else { 1 };
    let stdin = io::stdin();
    let mut out = io::stdout();
    // The prompt whose turn is still running, by its request id.
    let mut prompt: Option<String> = None;
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        let method = text(&line, "method");
        match (method, id(&line)) {
            (Some("initialize"), Some(id)) => {
                result(&mut out, id, &format!(r#"{{"protocolVersion":{version},"agentCapabilities":{{"loadSession":false}}}}"#));
            }
            (Some("session/new"), Some(id)) => {
                result(&mut out, id, &format!(r#"{{"sessionId":"{SESSION}"}}"#));
            }
            (Some("session/prompt"), Some(id)) => {
                let said = text(&line, "text").unwrap_or_default().to_owned();
                prompt = Some(id.to_owned());
                if said.contains("die") {
                    std::process::exit(3);
                }
                if said.contains("permission") {
                    update(&mut out, r#"{"sessionUpdate":"tool_call","toolCallId":"call-1","title":"cargo test","kind":"execute","status":"pending"}"#);
                    say(&mut out, &format!(r#"{{"jsonrpc":"2.0","id":"perm-1","method":"session/request_permission","params":{{"sessionId":"{SESSION}","toolCall":{{"toolCallId":"call-1","title":"cargo test","kind":"execute"}},"options":[{{"optionId":"allow","name":"Allow","kind":"allow_once"}},{{"optionId":"reject","name":"Reject","kind":"reject_once"}}]}}}}"#));
                } else if said.contains("read a file") {
                    say(&mut out, &format!(r#"{{"jsonrpc":"2.0","id":77,"method":"fs/read_text_file","params":{{"sessionId":"{SESSION}","path":"/tmp/x"}}}}"#));
                } else if !said.contains("wait") {
                    message(&mut out, &format!("You said: {said}"));
                    result(&mut out, id, r#"{"stopReason":"end_turn"}"#);
                    prompt = None;
                }
            }
            (Some("session/cancel"), None) => {
                if let Some(id) = prompt.take() {
                    result(&mut out, &id, r#"{"stopReason":"cancelled"}"#);
                }
            }
            // An answer to something this agent asked.
            (None, Some(_)) => {
                let Some(id) = prompt.take() else { continue };
                if line.contains("\"error\"") {
                    message(&mut out, "I may not read files here.");
                } else if line.contains("\"cancelled\"") {
                    // The cancel that follows ends the turn.
                    prompt = Some(id);
                    continue;
                } else {
                    let chosen = text(&line, "optionId").unwrap_or_default();
                    let status = if chosen == "allow" { "completed" } else { "failed" };
                    update(&mut out, &format!(r#"{{"sessionUpdate":"tool_call_update","toolCallId":"call-1","status":"{status}"}}"#));
                    message(&mut out, &format!("You chose {chosen}."));
                }
                result(&mut out, &id, r#"{"stopReason":"end_turn"}"#);
            }
            _ => {}
        }
    }
}
