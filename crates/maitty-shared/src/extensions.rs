//! Skills, plugins, MCP servers and marketplaces of Claude Code and Codex, as the window sees
//! them (`Query::Extensions`): what is installed, and the few changes a person may ask for. The
//! shapes, the rules for a name, a source or a server address, and the words a client shows. No I/O.
//!
//! A plugin or an MCP server runs code with the person's own access, so an add is two requests:
//! `PreviewAdd` says what would run and returns a one-time token, and `Add` only runs with that
//! token (`docs/features/chat-extensions/spec.md`). Every string that came from a file on disk is
//! somebody else's text, so a reply is cleaned with `ExtensionList::cleaned` before it is drawn.

use crate::hidden::sanitize;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The most items one list carries.
pub const EXT_ITEMS_MAX: usize = 400;
/// The most characters of a name or an id.
pub const EXT_NAME_MAX_CHARS: usize = 130;
/// The most characters of an item's one-line detail (a description, a command line, an address).
pub const EXT_DETAIL_MAX_CHARS: usize = 300;
/// The most characters of a source (a repository, an address or a folder) or a command.
pub const EXT_SOURCE_MAX_CHARS: usize = 500;
/// The most arguments of an MCP server's command.
pub const EXT_ARGS_MAX: usize = 32;
/// The most characters of one argument.
pub const EXT_ARG_MAX_CHARS: usize = 1_000;
/// The most lines of what an add will run.
pub const EXT_RUNS_MAX: usize = 40;
/// The most characters of the one line that says why a request failed.
pub const EXT_ERROR_MAX_CHARS: usize = 200;
/// The words every confirmation carries, whatever is added.
pub const EXT_RUNS_CODE: &str = "This runs code on your computer with your access";

/// The agent whose extensions these are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExtAgent {
    Claude,
    Codex,
}

impl ExtAgent {
    /// The program that is started, by the name it has on a PATH.
    pub fn program(self) -> &'static str {
        match self {
            ExtAgent::Claude => "claude",
            ExtAgent::Codex => "codex",
        }
    }
}

/// Where a change applies. Codex has only `User`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExtScope {
    User,
    Project,
    /// This project, on this computer only (Claude's `local`).
    Local,
}

impl ExtScope {
    /// The word Claude's commands take for a plugin's `--scope` and an MCP server's `-s`.
    pub fn word(self) -> &'static str {
        match self {
            ExtScope::User => "user",
            ExtScope::Project => "project",
            ExtScope::Local => "local",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ExtKind {
    Plugin,
    McpServer,
    Skill,
    Marketplace,
}

/// One installed thing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtItem {
    pub agent: ExtAgent,
    pub kind: ExtKind,
    pub scope: ExtScope,
    /// What a request names it by: `name@marketplace` for a plugin, the name for the others.
    pub id: String,
    pub name: String,
    /// One line: a description, a command line, an address or a version.
    pub detail: String,
    /// `None` where there is no such switch (skills, marketplaces, MCP servers).
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtensionList {
    pub items: Vec<ExtItem>,
    /// One line for each file that exists but could not be read, so a list that looks empty is
    /// not mistaken for one that is.
    #[serde(default)]
    pub problems: Vec<String>,
}

impl ExtensionList {
    /// What a client draws: every string cleaned and cut, the list capped.
    pub fn cleaned(self) -> ExtensionList {
        let problems = self.problems.iter().take(EXT_RUNS_MAX).map(|problem| line(problem, EXT_DETAIL_MAX_CHARS)).collect();
        let items = self
            .items
            .into_iter()
            .take(EXT_ITEMS_MAX)
            .map(|item| ExtItem {
                id: line(&item.id, EXT_NAME_MAX_CHARS),
                name: line(&item.name, EXT_NAME_MAX_CHARS),
                detail: line(&item.detail, EXT_DETAIL_MAX_CHARS),
                ..item
            })
            .collect();
        ExtensionList { items, problems }
    }
}

/// What a change is aimed at: one item the daemon listed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtTarget {
    pub agent: ExtAgent,
    pub kind: ExtKind,
    pub id: String,
    pub scope: ExtScope,
    /// The project folder on the daemon's computer, for a scope other than `User`.
    pub project: Option<String>,
}

/// How an MCP server is reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum McpRun {
    /// A program the agent starts, with its arguments, one by one.
    Command { command: String, args: Vec<String> },
    /// A server somewhere else, reached over HTTP.
    Url { url: String },
}

/// Something to add.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtAdd {
    /// `plugin` is `name@marketplace`, from a marketplace already added.
    Plugin { agent: ExtAgent, plugin: String, scope: ExtScope, project: Option<String> },
    /// A source of plugins: a GitHub `owner/repo`, an https address or a folder.
    Marketplace { agent: ExtAgent, source: String },
    Mcp { agent: ExtAgent, name: String, run: McpRun, scope: ExtScope, project: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtRequest {
    /// Read what is installed, per user and (when `project` is given) per project. Reads files
    /// only; no agent is started.
    List { project: Option<String> },
    /// Work out what `add` would run, and keep it for `Add`. Changes nothing.
    PreviewAdd { add: ExtAdd },
    /// Run the add that `token` was given for, once.
    Add { token: String },
    SetEnabled { target: ExtTarget, enabled: bool },
    Remove { target: ExtTarget },
}

/// What a confirmation shows, from the files, before anything runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtPreview {
    /// The one-time token `Add` needs.
    pub token: String,
    pub agent: ExtAgent,
    pub kind: ExtKind,
    pub name: String,
    pub scope: ExtScope,
    /// Where it comes from: a marketplace and its source, a repository, an address, a command.
    pub source: String,
    /// What it will run, one line each: hook commands, server commands, addresses.
    pub runs: Vec<String>,
    /// Hosts that receive the person's prompts and tool results.
    pub hosts: Vec<String>,
}

impl ExtPreview {
    pub fn cleaned(self) -> ExtPreview {
        ExtPreview {
            name: line(&self.name, EXT_NAME_MAX_CHARS),
            source: line(&self.source, EXT_SOURCE_MAX_CHARS),
            runs: self.runs.iter().take(EXT_RUNS_MAX).map(|run| line(run, EXT_DETAIL_MAX_CHARS)).collect(),
            hosts: self.hosts.iter().take(EXT_RUNS_MAX).map(|host| line(host, EXT_NAME_MAX_CHARS)).collect(),
            ..self
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtReply {
    List(ExtensionList),
    Preview(ExtPreview),
    /// A change was made; the line says what, for the toast.
    Done(String),
}

impl ExtReply {
    pub fn cleaned(self) -> ExtReply {
        match self {
            ExtReply::List(list) => ExtReply::List(list.cleaned()),
            ExtReply::Preview(preview) => ExtReply::Preview(preview.cleaned()),
            ExtReply::Done(said) => ExtReply::Done(line(&said, EXT_ERROR_MAX_CHARS)),
        }
    }
}

/// Why a request changed nothing. Each is an answer a client shows a way out of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtError {
    /// The agent's program is not on this computer.
    CliMissing(ExtAgent),
    /// The agent's program does not know the command (an older version).
    CliTooOld(ExtAgent),
    NotFound,
    AlreadyInstalled,
    /// An add without a preview token, or with one that is spent or expired.
    NeedsConfirmation,
    /// Only the agent's own terminal can do this. The line is the exact command to type.
    NeedsTerminal(String),
    /// The request itself is not one the daemon will run.
    Invalid(String),
    /// The agent's program ran and said no, or did not answer in time. One cleaned line.
    Failed(String),
}

impl ExtError {
    pub fn cleaned(self) -> ExtError {
        match self {
            ExtError::NeedsTerminal(command) => ExtError::NeedsTerminal(line(&command, EXT_SOURCE_MAX_CHARS)),
            ExtError::Invalid(why) => ExtError::Invalid(line(&why, EXT_ERROR_MAX_CHARS)),
            ExtError::Failed(why) => ExtError::Failed(line(&why, EXT_ERROR_MAX_CHARS)),
            other => other,
        }
    }
}

fn line(text: &str, max: usize) -> String {
    sanitize(text, false).trim().chars().take(max).collect()
}

fn invalid<T>(why: &str) -> Result<T, ExtError> {
    Err(ExtError::Invalid(why.to_owned()))
}

/// Whether `text` is one name a marketplace, a plugin, a server or a skill folder can have: plain
/// characters, starting with a letter or digit, so it can never read as a flag or a path.
pub fn is_ext_name(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(|first| first.is_ascii_alphanumeric())
        && text.len() <= 64
        && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// Whether `text` is `name@marketplace`.
pub fn is_plugin_id(text: &str) -> bool {
    text.split_once('@').is_some_and(|(name, market)| is_ext_name(name) && is_ext_name(market))
}

/// A folder on the daemon's computer a person's project is in: one line, no control characters.
pub fn checked_project(project: &str) -> Result<&str, ExtError> {
    let project = project.trim();
    if project.is_empty() || project.chars().count() > EXT_SOURCE_MAX_CHARS || project.chars().any(char::is_control) {
        return invalid("That is not a project folder");
    }
    if !Path::new(project).is_absolute() {
        return invalid("A project folder is a full path");
    }
    Ok(project)
}

/// Where a marketplace comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MarketSource {
    GitHub(String),
    Url(String),
    Folder(String),
}

impl MarketSource {
    /// `text` as a marketplace source, or why it is not one. Never starts with `-` and never holds
    /// a control character, so it cannot be read as a flag or smuggle a second argument.
    pub fn parse(text: &str) -> Result<MarketSource, ExtError> {
        let text = text.trim();
        if text.is_empty() || text.chars().count() > EXT_SOURCE_MAX_CHARS || text.chars().any(char::is_control) || text.starts_with('-') {
            return invalid("That is not a marketplace source");
        }
        if let Some(rest) = text.strip_prefix("https://") {
            return match host_of(rest) {
                Some(_) => Ok(MarketSource::Url(text.to_owned())),
                None => invalid("That address is not one a marketplace can be read from"),
            };
        }
        if is_repo_path(text) {
            return Ok(MarketSource::GitHub(text.to_owned()));
        }
        if Path::new(text).is_absolute() {
            return Ok(MarketSource::Folder(text.to_owned()));
        }
        invalid("A marketplace is a GitHub owner/repo, an https address or a full folder path")
    }

    pub fn text(&self) -> &str {
        match self {
            MarketSource::GitHub(text) | MarketSource::Url(text) | MarketSource::Folder(text) => text,
        }
    }
}

fn is_repo_path(text: &str) -> bool {
    let part = |part: &str| !part.is_empty() && part.len() <= 100 && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    text.split_once('/').is_some_and(|(owner, repo)| part(owner) && part(repo) && !owner.starts_with('.'))
}

/// The host of what follows `scheme://`, when it is a plain one: no sign-in in the address
/// (`user:pass@host`), no spaces.
fn host_of(after_scheme: &str) -> Option<&str> {
    let authority = after_scheme.split(['/', '?', '#']).next().unwrap_or_default();
    let plain = !authority.is_empty() && !authority.contains('@') && !authority.chars().any(|c| c.is_whitespace() || c == '\\');
    plain.then(|| authority.rsplit_once(':').filter(|(_, port)| port.chars().all(|c| c.is_ascii_digit())).map_or(authority, |(host, _)| host)).filter(|host| !host.is_empty())
}

impl McpRun {
    /// The checked request, or why it is refused. A server's address is `https`, or `http` only
    /// for this computer; it carries no sign-in.
    pub fn checked(self) -> Result<McpRun, ExtError> {
        match self {
            McpRun::Command { command, args } => {
                let command = command.trim().to_owned();
                if command.is_empty() || command.chars().count() > EXT_SOURCE_MAX_CHARS || command.chars().any(char::is_control) {
                    return invalid("That is not a command a server can be started with");
                }
                if args.len() > EXT_ARGS_MAX || args.iter().any(|arg| arg.chars().count() > EXT_ARG_MAX_CHARS || arg.chars().any(char::is_control)) {
                    return invalid("Those arguments cannot be used");
                }
                Ok(McpRun::Command { command, args })
            }
            McpRun::Url { url } => {
                let url = url.trim().to_owned();
                if url.chars().count() > EXT_SOURCE_MAX_CHARS || url.chars().any(char::is_control) {
                    return invalid("That is not a server address");
                }
                let allowed = match (url.strip_prefix("https://"), url.strip_prefix("http://")) {
                    (Some(rest), _) => host_of(rest).is_some(),
                    (None, Some(rest)) => host_of(rest).is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "[::1]")),
                    _ => false,
                };
                if !allowed {
                    return invalid("A server address starts with https:// (http:// only for this computer) and has no sign-in in it");
                }
                Ok(McpRun::Url { url })
            }
        }
    }

    /// The host an address sends the person's words to, if this is one.
    pub fn host(&self) -> Option<String> {
        match self {
            McpRun::Url { url } => url.split_once("://").and_then(|(_, rest)| host_of(rest)).map(str::to_owned),
            McpRun::Command { .. } => None,
        }
    }
}

impl ExtTarget {
    /// The request, when it names one thing a daemon could have listed and a scope the agent has.
    pub fn checked(self) -> Result<ExtTarget, ExtError> {
        let named = match self.kind {
            ExtKind::Plugin => is_plugin_id(&self.id),
            ExtKind::McpServer | ExtKind::Skill | ExtKind::Marketplace => is_ext_name(&self.id),
        };
        if !named {
            return invalid("That is not a name this can be asked about");
        }
        check_scope(self.agent, self.kind, self.scope, self.project.as_deref())?;
        Ok(self)
    }
}

impl ExtAdd {
    /// The request, checked, for the agent that will run it.
    pub fn checked(self) -> Result<ExtAdd, ExtError> {
        match self {
            ExtAdd::Plugin { agent, plugin, scope, project } => {
                if !is_plugin_id(&plugin) {
                    return invalid("A plugin is written name@marketplace");
                }
                check_scope(agent, ExtKind::Plugin, scope, project.as_deref())?;
                Ok(ExtAdd::Plugin { agent, plugin, scope, project })
            }
            ExtAdd::Marketplace { agent, source } => {
                let source = MarketSource::parse(&source)?.text().to_owned();
                Ok(ExtAdd::Marketplace { agent, source })
            }
            ExtAdd::Mcp { agent, name, run, scope, project } => {
                if !is_ext_name(&name) {
                    return invalid("A server name is letters, digits, dots, dashes and underscores");
                }
                check_scope(agent, ExtKind::McpServer, scope, project.as_deref())?;
                Ok(ExtAdd::Mcp { agent, name, run: run.checked()?, scope, project })
            }
        }
    }
}

/// Whether `agent` has `scope` for `kind`, and a project is named exactly when the scope needs one.
fn check_scope(agent: ExtAgent, kind: ExtKind, scope: ExtScope, project: Option<&str>) -> Result<(), ExtError> {
    let has = match (agent, kind, scope) {
        (_, ExtKind::Marketplace, scope) => scope == ExtScope::User,
        (ExtAgent::Claude, ExtKind::Plugin | ExtKind::McpServer, _) => true,
        (ExtAgent::Claude | ExtAgent::Codex, ExtKind::Skill, ExtScope::User | ExtScope::Project) => true,
        (ExtAgent::Codex, _, ExtScope::User) => true,
        _ => false,
    };
    if !has {
        return invalid("That agent does not keep this there");
    }
    match (scope, project) {
        (ExtScope::User, _) => Ok(()),
        (_, Some(project)) => checked_project(project).map(|_| ()),
        (_, None) => invalid("This needs the project it is for"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_that_could_be_read_as_flags_or_paths_are_refused() {
        for good in ["hello", "a.b-c_d", "x1"] {
            assert!(is_ext_name(good), "{good}");
        }
        for bad in ["", "-rf", "--scope", "a/b", "..", ".hidden", "a b", "a@b", &"x".repeat(65), "tab\t"] {
            assert!(!is_ext_name(bad), "{bad:?}");
        }
        assert!(is_plugin_id("hello@local-mk"));
        for bad in ["hello", "@m", "h@", "a@b@c", "-x@m", "h@-m"] {
            assert!(!is_plugin_id(bad), "{bad:?}");
        }
    }

    #[test]
    fn a_marketplace_source_is_a_repository_an_https_address_or_a_full_folder() {
        assert_eq!(MarketSource::parse(" owner/repo "), Ok(MarketSource::GitHub("owner/repo".into())));
        assert_eq!(MarketSource::parse("https://example.com/m.git"), Ok(MarketSource::Url("https://example.com/m.git".into())));
        let folder = if cfg!(windows) { "C:\\My Plugins\\mk" } else { "/home/me/my plugins/mk" };
        assert_eq!(MarketSource::parse(folder), Ok(MarketSource::Folder(folder.into())));
        for bad in ["", "--flag", "-o/r", "relative/dir/x", "http://example.com/m", "https://user:pw@example.com/m", "https://", "git@host:o/r", "a\nb", "o/r\n--x", "ftp://x/y"] {
            assert!(matches!(MarketSource::parse(bad), Err(ExtError::Invalid(_))), "{bad:?}");
        }
    }

    #[test]
    fn a_server_address_is_https_or_this_computer_and_has_no_sign_in() {
        let url = |url: &str| McpRun::Url { url: url.into() }.checked();
        assert!(url("https://mcp.example.com/sse").is_ok());
        assert!(url("http://localhost:8080/mcp").is_ok());
        assert!(url("http://127.0.0.1/mcp").is_ok());
        for bad in ["http://example.com/mcp", "https://u:p@example.com", "ftp://example.com", "example.com", "https://", "https://a b/c", "https://x/\u{7}"] {
            assert!(matches!(url(bad), Err(ExtError::Invalid(_))), "{bad:?}");
        }
        assert_eq!(McpRun::Url { url: "https://mcp.example.com:8443/x".into() }.host().as_deref(), Some("mcp.example.com"));
    }

    #[test]
    fn a_server_command_has_no_control_characters_and_a_bounded_list_of_arguments() {
        let command = |command: &str, args: &[&str]| McpRun::Command { command: command.into(), args: args.iter().map(|arg| (*arg).into()).collect() }.checked();
        assert!(command("npx", &["-y", "@scope/server", "--flag=a b"]).is_ok());
        assert!(command("", &[]).is_err());
        assert!(command("npx\n", &[]).is_ok(), "trimmed");
        assert!(command("np\nx", &[]).is_err());
        assert!(command("npx", &["a\0b"]).is_err());
        assert!(McpRun::Command { command: "x".into(), args: vec!["a".into(); EXT_ARGS_MAX + 1] }.checked().is_err());
    }

    #[test]
    fn a_scope_the_agent_does_not_have_is_refused() {
        let plugin = |agent, scope, project: Option<&str>| ExtAdd::Plugin { agent, plugin: "a@b".into(), scope, project: project.map(Into::into) }.checked();
        let here = if cfg!(windows) { "C:\\work\\app" } else { "/work/app" };
        assert!(plugin(ExtAgent::Claude, ExtScope::User, None).is_ok());
        assert!(plugin(ExtAgent::Claude, ExtScope::Project, Some(here)).is_ok());
        assert!(plugin(ExtAgent::Claude, ExtScope::Project, None).is_err(), "a project scope needs a project");
        assert!(plugin(ExtAgent::Claude, ExtScope::Project, Some("relative")).is_err());
        assert!(plugin(ExtAgent::Codex, ExtScope::User, None).is_ok());
        assert!(plugin(ExtAgent::Codex, ExtScope::Project, Some(here)).is_err(), "Codex has no project plugins");
        let target = |kind, id: &str| ExtTarget { agent: ExtAgent::Claude, kind, id: id.into(), scope: ExtScope::User, project: None }.checked();
        assert!(target(ExtKind::Skill, "../etc").is_err(), "a skill is a folder name, never a path");
        assert!(target(ExtKind::Skill, "notes").is_ok());
        assert!(target(ExtKind::Plugin, "notes").is_err());
    }

    #[test]
    fn what_came_from_a_file_is_cleaned_before_it_is_drawn() {
        let item = ExtItem {
            agent: ExtAgent::Claude,
            kind: ExtKind::Plugin,
            scope: ExtScope::User,
            id: "a@b".into(),
            name: "evil\u{1b}[2J\u{202e}".into(),
            detail: "x".repeat(EXT_DETAIL_MAX_CHARS + 50),
            enabled: Some(true),
        };
        let cleaned = ExtensionList { items: vec![item; EXT_ITEMS_MAX + 5], problems: Vec::new() }.cleaned();
        assert_eq!(cleaned.items.len(), EXT_ITEMS_MAX);
        assert_eq!(cleaned.items[0].name, "evil[2J");
        assert_eq!(cleaned.items[0].detail.chars().count(), EXT_DETAIL_MAX_CHARS);
    }
}
