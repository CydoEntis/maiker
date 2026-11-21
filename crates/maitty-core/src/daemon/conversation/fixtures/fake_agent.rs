//! A made-up agent with a made-up line protocol, for a dialect that is neither Codex nor Claude.
//! It answers `say <text>` with `heard <text>` and then `done`, ends on `bye`, and with the
//! argument `--die` ends as soon as it has been told anything.

use std::io::{self, BufRead, Write};

fn main() {
    let die = std::env::args().any(|argument| argument == "--die");
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = line.unwrap();
        if die || line == "bye" {
            return;
        }
        if let Some(text) = line.strip_prefix("say ") {
            writeln!(stdout, "heard {text}").unwrap();
            writeln!(stdout, "done").unwrap();
            stdout.flush().unwrap();
        }
    }
}
