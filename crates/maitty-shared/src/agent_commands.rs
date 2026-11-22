//! The slash commands and skills an agent offers on a machine, as the window's picker takes them
//! (`Query::AgentCommands`). The agent's own program says them, so they are another program's
//! words, and on another machine another person's: every name and line is cleaned here before it
//! is drawn or put in a text box, by the daemon that read it and again by the window that
//! receives it.

use crate::hidden::sanitize;
use serde::{Deserialize, Serialize};

/// A reply longer than this is cut: no installation has this many commands.
pub const AGENT_COMMANDS_MAX: usize = 2000;
const NAME_MAX_CHARS: usize = 100;
/// The picker shows a line or two of a description; skills write paragraphs.
pub const DESCRIPTION_MAX_CHARS: usize = 240;
pub const HINT_MAX_CHARS: usize = 80;
/// The longest reason a failed ask is kept to, in characters.
const REASON_MAX_CHARS: usize = 300;
/// The agent's own plumbing, which nobody types.
const INTERNAL_PREFIX: &str = "__";

/// One slash command (or skill) an agent takes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentCommand {
    /// What is typed after the slash: `compact`, or `plugin:command`.
    pub name: String,
    pub description: String,
    /// What the command takes after its name, as its author wrote it; empty when it takes nothing.
    pub hint: String,
    /// Other names it answers to.
    pub aliases: Vec<String>,
}

/// A name the window may put in a text box and send to a terminal: letters, digits and the marks
/// command names are written with. Anything else (a space, a control character, an escape) is not a
/// command name, so the entry is left out.
pub fn command_name(raw: &str) -> Option<String> {
    let name = raw.trim();
    let allowed = |c: char| c.is_alphanumeric() || matches!(c, '-' | '_' | ':' | '.');
    (!name.is_empty() && !name.starts_with(INTERNAL_PREFIX) && name.chars().count() <= NAME_MAX_CHARS && name.chars().all(allowed))
        .then(|| name.to_string())
}

/// Text for one line of the picker: runs of whitespace and control characters become one space, and
/// it is cut at `limit` characters.
pub fn one_line(raw: &str, limit: usize) -> String {
    let words: Vec<&str> = raw.split(|c: char| c.is_whitespace() || c.is_control()).filter(|word| !word.is_empty()).collect();
    words.join(" ").chars().take(limit).collect()
}

impl AgentCommand {
    /// This command made safe, or `None` when its name is not one. Idempotent.
    pub fn cleaned(self) -> Option<AgentCommand> {
        Some(AgentCommand {
            name: command_name(&self.name)?,
            description: one_line(&sanitize(&self.description, false), DESCRIPTION_MAX_CHARS),
            hint: one_line(&sanitize(&self.hint, false), HINT_MAX_CHARS),
            aliases: self.aliases.iter().filter_map(|alias| command_name(alias)).collect(),
        })
    }
}

/// An answer from a machine made safe: each command cleaned, those without a proper name dropped,
/// the list capped, and a failure's reason cut to one clean line.
pub fn cleaned_answer(answer: Result<Vec<AgentCommand>, String>) -> Result<Vec<AgentCommand>, String> {
    match answer {
        Ok(commands) => Ok(commands.into_iter().filter_map(AgentCommand::cleaned).take(AGENT_COMMANDS_MAX).collect()),
        Err(reason) => Err(one_line(&sanitize(&reason, false), REASON_MAX_CHARS)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn command(name: &str, description: &str) -> AgentCommand {
        AgentCommand { name: name.into(), description: description.into(), hint: String::new(), aliases: Vec::new() }
    }

    #[test]
    fn a_name_is_what_can_be_typed_after_a_slash() {
        assert_eq!(command_name(" compact "), Some("compact".into()));
        assert_eq!(command_name("plugin:run.it_now-2"), Some("plugin:run.it_now-2".into()));
        for bad in ["", "has space", "esc\u{1b}[31m", "__remote-workflow", &"x".repeat(101)] {
            assert_eq!(command_name(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn a_machines_answer_is_cleaned_before_it_is_drawn() {
        let mut evil = command("pdf", "Reads\u{1b}[31m\n  and writes");
        evil.hint = "<file>\u{7}".into();
        evil.aliases = vec!["ok".into(), "bad alias".into()];
        let cleaned = cleaned_answer(Ok(vec![evil, command("bad name", "x"), command("review", &"d".repeat(1000))])).unwrap();
        assert_eq!(cleaned.len(), 2);
        assert!(cleaned[0].description.starts_with("Reads") && cleaned[0].description.ends_with("and writes"));
        assert!(!cleaned[0].description.chars().any(char::is_control));
        assert_eq!(cleaned[0].hint, "<file>");
        assert_eq!(cleaned[0].aliases, ["ok"]);
        assert_eq!(cleaned[1].description.chars().count(), DESCRIPTION_MAX_CHARS);
    }

    #[test]
    fn a_list_is_capped_and_a_reason_is_one_short_line() {
        let many = (0..AGENT_COMMANDS_MAX + 5).map(|n| command(&format!("c{n}"), "")).collect();
        assert_eq!(cleaned_answer(Ok(many)).unwrap().len(), AGENT_COMMANDS_MAX);
        let reason = cleaned_answer(Err(format!("line one\nline\u{1b}[2J two {}", "z".repeat(1000)))).unwrap_err();
        assert!(!reason.contains('\n') && !reason.contains('\u{1b}'));
        assert!(reason.chars().count() <= REASON_MAX_CHARS);
    }
}
