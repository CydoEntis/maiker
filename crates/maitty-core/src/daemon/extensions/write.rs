//! The changes: add (after a preview), turn a plugin on or off, remove. Claude's own commands do
//! the work where it has one; Codex has no command to switch a plugin, so that one is an edit of
//! its `config.toml` that keeps every comment and key it did not touch. A skill is a folder, and
//! only a folder the daemon lists is ever deleted.

use super::cli::{Cli, Said, args, first_line, with};
use super::{Env, listed, project_folder, read};
use maitty_shared::extensions::{ExtAdd, ExtAgent, ExtError, ExtKind, ExtReply, ExtScope, ExtTarget, McpRun};
use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Where an agent reads its project from: only a scope above the user's runs in the project.
fn working_in(scope: ExtScope, project: Option<&str>) -> Result<Option<PathBuf>, ExtError> {
    match scope {
        ExtScope::User => Ok(None),
        _ => project_folder(project),
    }
}

/// The command that runs `add`, built from checked parts only.
pub(super) fn add_command(add: &ExtAdd) -> (ExtAgent, Vec<OsString>) {
    match add {
        ExtAdd::Plugin { agent: ExtAgent::Claude, plugin, scope, .. } => (ExtAgent::Claude, args(["plugin", "install", plugin, "--scope", scope.word(), "--json"])),
        ExtAdd::Plugin { agent: ExtAgent::Codex, plugin, .. } => (ExtAgent::Codex, args(["plugin", "add", plugin, "--json"])),
        ExtAdd::Marketplace { agent, source } => (*agent, args(["plugin", "marketplace", "add", source, "--json"])),
        // The name comes first and the server's own words after `--`: Claude's `-e` swallows what
        // follows it, and a command's flags are the command's, not ours.
        ExtAdd::Mcp { agent: ExtAgent::Claude, name, run: McpRun::Command { command, args: words }, scope, .. } => {
            (ExtAgent::Claude, with(args(["mcp", "add", "--scope", scope.word(), name, "--", command]), words))
        }
        ExtAdd::Mcp { agent: ExtAgent::Claude, name, run: McpRun::Url { url }, scope, .. } => {
            (ExtAgent::Claude, args(["mcp", "add", "--scope", scope.word(), "--transport", "http", name, url]))
        }
        ExtAdd::Mcp { agent: ExtAgent::Codex, name, run: McpRun::Command { command, args: words }, .. } => {
            (ExtAgent::Codex, with(args(["mcp", "add", name, "--", command]), words))
        }
        ExtAdd::Mcp { agent: ExtAgent::Codex, name, run: McpRun::Url { url }, .. } => (ExtAgent::Codex, args(["mcp", "add", name, "--url", url])),
    }
}

fn add_scope(add: &ExtAdd) -> (ExtScope, Option<&str>) {
    match add {
        ExtAdd::Plugin { scope, project, .. } | ExtAdd::Mcp { scope, project, .. } => (*scope, project.as_deref()),
        ExtAdd::Marketplace { .. } => (ExtScope::User, None),
    }
}

/// What the add is called in a message and in the listing.
fn add_target(add: &ExtAdd) -> (ExtKind, &str) {
    match add {
        ExtAdd::Plugin { plugin, .. } => (ExtKind::Plugin, plugin),
        ExtAdd::Marketplace { source, .. } => (ExtKind::Marketplace, source),
        ExtAdd::Mcp { name, .. } => (ExtKind::McpServer, name),
    }
}

pub(super) fn add(env: &Env, add: ExtAdd) -> Result<ExtReply, ExtError> {
    let (scope, project) = add_scope(&add);
    let cwd = working_in(scope, project)?;
    let (kind, name) = add_target(&add);
    let (agent, command) = add_command(&add);
    if kind != ExtKind::Marketplace && listed(env, cwd.as_deref()).items.iter().any(|item| item.agent == agent && item.kind == kind && item.scope == scope && item.id == name) {
        return Err(ExtError::AlreadyInstalled);
    }
    let cli = Cli { programs: &env.programs, homes: &env.homes };
    let said = cli.run(agent, &command, cwd.as_deref())?;
    outcome(agent, kind, &said)?;
    Ok(ExtReply::Done(match kind {
        ExtKind::Marketplace => "Marketplace added".into(),
        _ => format!("{name} added"),
    }))
}

pub(super) fn set_enabled(env: &Env, target: ExtTarget, enabled: bool) -> Result<ExtReply, ExtError> {
    if target.kind != ExtKind::Plugin {
        return Err(ExtError::Invalid("Only a plugin can be turned on or off here".into()));
    }
    let cwd = working_in(target.scope, target.project.as_deref())?;
    require_listed(env, &target, cwd.as_deref())?;
    match target.agent {
        ExtAgent::Claude => {
            let word = if enabled { "enable" } else { "disable" };
            let command = args(["plugin", word, &target.id, "--scope", target.scope.word(), "--json"]);
            let said = Cli { programs: &env.programs, homes: &env.homes }.run(ExtAgent::Claude, &command, cwd.as_deref())?;
            outcome(ExtAgent::Claude, ExtKind::Plugin, &said)?;
        }
        ExtAgent::Codex => set_codex_plugin(&env.homes.codex_dir.join("config.toml"), &target.id, enabled)?,
    }
    Ok(ExtReply::Done(format!("{} turned {}", target.id, if enabled { "on" } else { "off" })))
}

pub(super) fn remove(env: &Env, target: ExtTarget) -> Result<ExtReply, ExtError> {
    let cwd = working_in(target.scope, target.project.as_deref())?;
    require_listed(env, &target, cwd.as_deref())?;
    let cli = Cli { programs: &env.programs, homes: &env.homes };
    match (target.agent, target.kind) {
        (_, ExtKind::Skill) => remove_skill(env, &target, cwd.as_deref())?,
        (ExtAgent::Claude, ExtKind::Plugin) => {
            let said = cli.run(ExtAgent::Claude, &args(["plugin", "uninstall", &target.id, "--scope", target.scope.word(), "--json"]), cwd.as_deref())?;
            outcome(ExtAgent::Claude, ExtKind::Plugin, &said)?;
        }
        (ExtAgent::Claude, ExtKind::Marketplace) => {
            let said = cli.run(ExtAgent::Claude, &args(["plugin", "marketplace", "remove", &target.id, "--json"]), None)?;
            outcome(ExtAgent::Claude, ExtKind::Marketplace, &said)?;
        }
        (ExtAgent::Claude, ExtKind::McpServer) => {
            let said = cli.run(ExtAgent::Claude, &args(["mcp", "remove", "--scope", target.scope.word(), &target.id]), cwd.as_deref())?;
            outcome(ExtAgent::Claude, ExtKind::McpServer, &said)?;
        }
        (ExtAgent::Codex, kind) => {
            let command = match kind {
                ExtKind::Plugin => args(["plugin", "remove", &target.id]),
                ExtKind::Marketplace => args(["plugin", "marketplace", "remove", &target.id]),
                _ => args(["mcp", "remove", &target.id]),
            };
            let said = cli.run(ExtAgent::Codex, &command, None)?;
            outcome(ExtAgent::Codex, kind, &said)?;
            // Codex exits 0 for something that was never there, and may exit 0 having removed
            // nothing, so the listing says whether it is gone.
            if still_listed(env, &target, cwd.as_deref()) {
                return Err(ExtError::Failed("Codex did not remove it".into()));
            }
        }
    }
    Ok(ExtReply::Done(format!("{} removed", target.id)))
}

fn still_listed(env: &Env, target: &ExtTarget, project: Option<&Path>) -> bool {
    listed(env, project).items.iter().any(|item| is_target(item, target))
}

fn is_target(item: &maitty_shared::extensions::ExtItem, target: &ExtTarget) -> bool {
    item.agent == target.agent && item.kind == target.kind && item.scope == target.scope && item.id == target.id
}

/// A change names only something the daemon lists.
fn require_listed(env: &Env, target: &ExtTarget, project: Option<&Path>) -> Result<(), ExtError> {
    if still_listed(env, target, project) { Ok(()) } else { Err(ExtError::NotFound) }
}

/// Deletes the skill folder the listing showed. A linked folder loses only the link.
fn remove_skill(env: &Env, target: &ExtTarget, project: Option<&Path>) -> Result<(), ExtError> {
    let dir = read::skills_dir(&env.homes, target.agent, target.scope, project).ok_or_else(|| ExtError::Invalid("That agent does not keep skills there".into()))?.join(&target.id);
    let failed = |_: std::io::Error| ExtError::Failed("The skill's folder could not be removed".into());
    let meta = std::fs::symlink_metadata(&dir).map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { ExtError::NotFound } else { failed(error) })?;
    if meta.file_type().is_symlink() {
        // A link to a folder is removed as a file on Unix and as a folder on Windows.
        std::fs::remove_file(&dir).or_else(|_| std::fs::remove_dir(&dir)).map_err(failed)
    } else if meta.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(failed)
    } else {
        Err(ExtError::NotFound)
    }
}

/// Sets `enabled` of `[plugins."<id>"]` in Codex's `config.toml`, keeping everything else as it
/// was. The file is written whole beside itself and moved into place, so it is never half-written.
fn set_codex_plugin(config: &Path, id: &str, enabled: bool) -> Result<(), ExtError> {
    use toml_edit::{DocumentMut, Item, value};
    let text = std::fs::read_to_string(config).map_err(|error| if error.kind() == std::io::ErrorKind::NotFound { ExtError::NotFound } else { ExtError::Failed("Codex's config.toml could not be read".into()) })?;
    let mut document: DocumentMut = text.parse().map_err(|_| ExtError::Failed("Codex's config.toml is not valid TOML, so it was left alone".into()))?;
    let plugin = document.get_mut("plugins").and_then(Item::as_table_like_mut).and_then(|plugins| plugins.get_mut(id)).and_then(Item::as_table_like_mut).ok_or(ExtError::NotFound)?;
    match plugin.get_mut("enabled") {
        // The new value takes the old one's spacing and trailing comment.
        Some(item) if item.is_value() => {
            let mut new = toml_edit::Value::from(enabled);
            if let Some(old) = item.as_value() {
                *new.decor_mut() = old.decor().clone();
            }
            *item = Item::Value(new);
        }
        _ => {
            plugin.insert("enabled", value(enabled));
        }
    }
    let failed = |_: std::io::Error| ExtError::Failed("Codex's config.toml could not be written".into());
    let beside = config.with_file_name("config.toml.new");
    std::fs::write(&beside, document.to_string()).map_err(failed)?;
    if let Ok(meta) = std::fs::metadata(config) {
        // The new file keeps the old one's rights, which may be owner-only.
        std::fs::set_permissions(&beside, meta.permissions()).map_err(failed)?;
    }
    std::fs::rename(&beside, config).map_err(|error| {
        let _ = std::fs::remove_file(&beside);
        failed(error)
    })
}

/// Whether a command did what was asked, from what it said.
fn outcome(agent: ExtAgent, kind: ExtKind, said: &Said) -> Result<(), ExtError> {
    // Claude's plugin and marketplace commands answer in one JSON line, and say what failed in it.
    if agent == ExtAgent::Claude
        && matches!(kind, ExtKind::Plugin | ExtKind::Marketplace)
        && let Some(json) = said.stdout.lines().rev().find_map(|line| serde_json::from_str::<Value>(line.trim()).ok()).filter(Value::is_object)
    {
        let text = |field: &str| json.get(field).and_then(Value::as_str).unwrap_or_default();
        return match (text("outcome"), text("failureCode")) {
            ("ok", _) => Ok(()),
            (_, "not_found") => Err(ExtError::NotFound),
            (_, _) if text("message").to_ascii_lowercase().contains("already") => Err(ExtError::AlreadyInstalled),
            _ => Err(ExtError::Failed(first_line(text("message")))),
        };
    }
    if said.success {
        return Ok(());
    }
    let stderr = said.stderr.to_ascii_lowercase();
    if ["unknown command", "unrecognized subcommand", "unknown option", "unexpected argument", "unrecognized option"].iter().any(|words| stderr.contains(words)) {
        return Err(ExtError::CliTooOld(agent));
    }
    if stderr.contains("already exists") || stderr.contains("already installed") || stderr.contains("already added") {
        return Err(ExtError::AlreadyInstalled);
    }
    let words = first_line(&said.stderr);
    Err(ExtError::Failed(if words.is_empty() { first_line(&said.stdout) } else { words }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(command: &[OsString]) -> Vec<String> {
        command.iter().map(|word| word.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn each_add_is_an_argument_list_with_the_name_first_and_the_servers_own_words_after_the_dashes() {
        let project = Some("/work/my app".to_owned());
        let server = |agent, run| ExtAdd::Mcp { agent, name: "srv".into(), run, scope: ExtScope::Project, project: project.clone() };
        let command = McpRun::Command { command: "npx".into(), args: vec!["-y".into(), "a b".into(), "--env=K=V".into()] };
        let (agent, line) = add_command(&server(ExtAgent::Claude, command.clone()));
        assert_eq!(agent, ExtAgent::Claude);
        assert_eq!(text(&line), ["mcp", "add", "--scope", "project", "srv", "--", "npx", "-y", "a b", "--env=K=V"]);
        assert_eq!(text(&add_command(&server(ExtAgent::Codex, command)).1), ["mcp", "add", "srv", "--", "npx", "-y", "a b", "--env=K=V"]);
        let url = McpRun::Url { url: "https://mcp.example.com/x".into() };
        assert_eq!(text(&add_command(&server(ExtAgent::Claude, url.clone())).1), ["mcp", "add", "--scope", "project", "--transport", "http", "srv", "https://mcp.example.com/x"]);
        assert_eq!(text(&add_command(&server(ExtAgent::Codex, url)).1), ["mcp", "add", "srv", "--url", "https://mcp.example.com/x"]);
        let plugin = |agent| ExtAdd::Plugin { agent, plugin: "hello@local-mk".into(), scope: ExtScope::Local, project: project.clone() };
        assert_eq!(text(&add_command(&plugin(ExtAgent::Claude)).1), ["plugin", "install", "hello@local-mk", "--scope", "local", "--json"]);
        assert_eq!(text(&add_command(&plugin(ExtAgent::Codex)).1), ["plugin", "add", "hello@local-mk", "--json"]);
        let market = ExtAdd::Marketplace { agent: ExtAgent::Claude, source: "C:\\My Plugins & more\\mk".into() };
        assert_eq!(text(&add_command(&market).1), ["plugin", "marketplace", "add", "C:\\My Plugins & more\\mk", "--json"], "one argument whatever it holds");
    }

    fn said(success: bool, stdout: &str, stderr: &str) -> Said {
        Said { success, stdout: stdout.into(), stderr: stderr.into() }
    }

    #[test]
    fn claudes_plugin_answers_are_read_from_its_json_not_its_words() {
        let ok = include_str!("samples/claude-plugin-install-ok.json");
        let failed = include_str!("samples/claude-plugin-install-failed.json");
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::Plugin, &said(true, ok, "")), Ok(()));
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::Plugin, &said(false, failed, "Failed to install")), Err(ExtError::NotFound));
        let already = r#"{"outcome":"failed","message":"Plugin x is already installed"}"#;
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::Plugin, &said(false, already, "")), Err(ExtError::AlreadyInstalled));
        let other = r#"{"outcome":"failed","failureCode":"ambiguous_marketplace","message":"Two markets have it"}"#;
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::Plugin, &said(false, other, "")), Err(ExtError::Failed("Two markets have it".into())));
    }

    #[test]
    fn a_command_that_is_not_in_this_version_or_already_done_is_told_apart() {
        let old = said(false, "", "error: unknown command 'plugin'");
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::McpServer, &old), Err(ExtError::CliTooOld(ExtAgent::Claude)));
        let clap = said(false, "", "error: unrecognized subcommand 'plugin'");
        assert_eq!(outcome(ExtAgent::Codex, ExtKind::Plugin, &clap), Err(ExtError::CliTooOld(ExtAgent::Codex)));
        let dup = said(false, "", "MCP server srv already exists in user config");
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::McpServer, &dup), Err(ExtError::AlreadyInstalled));
        assert_eq!(outcome(ExtAgent::Codex, ExtKind::McpServer, &said(true, "", "")), Ok(()));
        assert_eq!(outcome(ExtAgent::Codex, ExtKind::McpServer, &said(false, "", "WARNING: x\nboom API_KEY=abc")), Err(ExtError::Failed("boom ...".into())));
        assert_eq!(outcome(ExtAgent::Claude, ExtKind::Plugin, &said(false, "not json", "")), Err(ExtError::Failed("not json".into())));
    }

    #[test]
    fn a_codex_plugin_is_switched_in_its_config_and_nothing_else_changes() {
        let root = crate::daemon::persist::scratch_dir();
        std::fs::create_dir_all(root.path()).unwrap();
        let config = root.path().join("config.toml");
        let before = "# my notes\nmodel = \"x\" # keep me\n\n[plugins.\"hello@local-mk\"]\nenabled = true # on\nextra = 1\n\n[mcp_servers.srv]\ncommand = \"echo\"\n";
        std::fs::write(&config, before).unwrap();
        set_codex_plugin(&config, "hello@local-mk", false).unwrap();
        let after = std::fs::read_to_string(&config).unwrap();
        assert_eq!(after, before.replace("enabled = true", "enabled = false"));
        assert_eq!(set_codex_plugin(&config, "other@local-mk", true), Err(ExtError::NotFound));
        assert!(!root.path().join("config.toml.new").exists());
        std::fs::write(&config, "= broken").unwrap();
        assert!(matches!(set_codex_plugin(&config, "hello@local-mk", true), Err(ExtError::Failed(_))));
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "= broken", "a file that cannot be read is left alone");
        assert_eq!(set_codex_plugin(&root.path().join("none.toml"), "a@b", true), Err(ExtError::NotFound));
    }
}
