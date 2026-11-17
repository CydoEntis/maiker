//! What is installed, read from the agents' own files. Nothing here starts an agent: `claude mcp
//! list` starts every server it lists, and a listing must never run someone else's code. Every file
//! is somebody else's text, so it is read with a size limit and only the fields below are kept.
//! A file that is there and cannot be read is reported in `problems`, never dropped silently; a
//! file that is not there is simply empty.

use super::Homes;
use maitty_shared::extensions::{ExtAgent, ExtItem, ExtKind, ExtScope, ExtensionList};
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

/// The most bytes read of one file.
const FILE_MAX_BYTES: u64 = 1024 * 1024;
/// The most bytes of a `SKILL.md` read for its name and description.
const SKILL_HEAD_BYTES: u64 = 8 * 1024;
/// The most skill folders read from one place.
const SKILLS_MAX: usize = 200;

/// Everything installed for the user, and for `project` when one is given.
pub(super) fn list(homes: &Homes, project: Option<&Path>) -> ExtensionList {
    let mut found = Found::default();
    claude(homes, project, &mut found);
    codex(homes, project, &mut found);
    let mut items = found.items;
    items.sort_by(|a, b| {
        (a.agent as u8, a.kind as u8, a.scope as u8, &a.name).cmp(&(b.agent as u8, b.kind as u8, b.scope as u8, &b.name))
    });
    ExtensionList { items, problems: found.problems }
}

/// The folder an agent keeps the skills of `scope` in. Claude Code reads a project's from
/// `.claude/skills`; Codex from the shared `.agents/skills` (spec: from the binary, not run here).
pub(super) fn skills_dir(homes: &Homes, agent: ExtAgent, scope: ExtScope, project: Option<&Path>) -> Option<PathBuf> {
    match (agent, scope) {
        (ExtAgent::Claude, ExtScope::User) => Some(homes.claude_dir.join("skills")),
        (ExtAgent::Claude, ExtScope::Project) => project.map(|project| project.join(".claude").join("skills")),
        (ExtAgent::Codex, ExtScope::User) => Some(homes.codex_dir.join("skills")),
        (ExtAgent::Codex, ExtScope::Project) => project.map(|project| project.join(".agents").join("skills")),
        _ => None,
    }
}

#[derive(Default)]
struct Found {
    items: Vec<ExtItem>,
    problems: Vec<String>,
}

impl Found {
    fn add(&mut self, agent: ExtAgent, kind: ExtKind, scope: ExtScope, id: &str, name: &str, detail: String, enabled: Option<bool>) {
        self.items.push(ExtItem { agent, kind, scope, id: id.to_owned(), name: name.to_owned(), detail, enabled });
    }
}

/// A file read as text: `None` when it is not there, a problem line when it cannot be read.
fn read_text(path: &Path, limit: u64, found: &mut Found) -> Option<String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(_) => {
            found.problems.push(format!("{} could not be opened", shown(path)));
            return None;
        }
    };
    let mut text = String::new();
    // One byte more than the limit says whether the file is longer than it.
    if file.take(limit + 1).read_to_string(&mut text).is_err() {
        found.problems.push(format!("{} could not be read", shown(path)));
        return None;
    }
    if text.len() as u64 > limit {
        found.problems.push(format!("{} is too large to read", shown(path)));
        return None;
    }
    Some(text)
}

fn read_json(path: &Path, found: &mut Found) -> Option<Value> {
    let text = read_text(path, FILE_MAX_BYTES, found)?;
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(value) => Some(value),
        Err(_) => {
            found.problems.push(format!("{} is not valid JSON", shown(path)));
            None
        }
    }
}

fn read_toml(path: &Path, found: &mut Found) -> Option<toml::Table> {
    let text = read_text(path, FILE_MAX_BYTES, found)?;
    match text.parse::<toml::Table>() {
        Ok(table) => Some(table),
        Err(_) => {
            found.problems.push(format!("{} is not valid TOML", shown(path)));
            None
        }
    }
}

/// A file's name as a problem line shows it: the last two parts, never the person's home.
fn shown(path: &Path) -> String {
    let parts: Vec<_> = path.components().rev().take(2).map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

fn claude(homes: &Homes, project: Option<&Path>, found: &mut Found) {
    let agent = ExtAgent::Claude;
    let user_settings = read_json(&homes.claude_dir.join("settings.json"), found);
    let project_settings = project.and_then(|project| read_json(&project.join(".claude").join("settings.json"), found));
    let local_settings = project.and_then(|project| read_json(&project.join(".claude").join("settings.local.json"), found));

    // Plugins: the record of what is installed, and each scope's own switch.
    if let Some(record) = read_json(&homes.claude_dir.join("plugins").join("installed_plugins.json"), found) {
        for (id, installs) in record.get("plugins").and_then(Value::as_object).into_iter().flatten() {
            for install in installs.as_array().into_iter().flatten() {
                let scope = match install.get("scope").and_then(Value::as_str) {
                    Some("user") => ExtScope::User,
                    Some("project") => ExtScope::Project,
                    Some("local") => ExtScope::Local,
                    _ => continue,
                };
                if scope != ExtScope::User && !same_folder(install.get("projectPath").and_then(Value::as_str), project) {
                    continue;
                }
                let settings = match scope {
                    ExtScope::User => &user_settings,
                    ExtScope::Project => &project_settings,
                    ExtScope::Local => &local_settings,
                };
                let enabled = settings.as_ref().and_then(|settings| settings.get("enabledPlugins")).and_then(|plugins| plugins.get(id)).and_then(Value::as_bool).unwrap_or(true);
                let version = install.get("version").and_then(Value::as_str).map(|version| format!("version {version}")).unwrap_or_default();
                let name = id.split('@').next().unwrap_or(id);
                found.add(agent, ExtKind::Plugin, scope, id, name, version, Some(enabled));
            }
        }
    }

    if let Some(markets) = read_json(&homes.claude_dir.join("plugins").join("known_marketplaces.json"), found) {
        for (name, market) in markets.as_object().into_iter().flatten() {
            found.add(agent, ExtKind::Marketplace, ExtScope::User, name, name, market_source(market.get("source")), None);
        }
    }

    // MCP servers: the user's, this project's own private ones, and the project's shared file.
    let user_json = read_json(&homes.claude_json, found);
    if let Some(json) = &user_json {
        mcp_json(found, agent, ExtScope::User, json.get("mcpServers"));
        if let (Some(project), Some(projects)) = (project, json.get("projects").and_then(Value::as_object)) {
            let here = projects.iter().find(|(path, _)| same_folder(Some(path), Some(project)));
            if let Some((_, entry)) = here {
                mcp_json(found, agent, ExtScope::Local, entry.get("mcpServers"));
            }
        }
    }
    if let Some(shared) = project.and_then(|project| read_json(&project.join(".mcp.json"), found)) {
        mcp_json(found, agent, ExtScope::Project, shared.get("mcpServers"));
    }

    for scope in [ExtScope::User, ExtScope::Project] {
        if let Some(dir) = skills_dir(homes, agent, scope, project) {
            skills(found, agent, scope, &dir);
        }
    }
}

fn codex(homes: &Homes, project: Option<&Path>, found: &mut Found) {
    let agent = ExtAgent::Codex;
    if let Some(config) = read_toml(&homes.codex_dir.join("config.toml"), found) {
        for (id, plugin) in table_of(&config, "plugins") {
            let enabled = plugin.get("enabled").and_then(toml::Value::as_bool).unwrap_or(true);
            let name = id.split('@').next().unwrap_or(id);
            found.add(agent, ExtKind::Plugin, ExtScope::User, id, name, String::new(), Some(enabled));
        }
        for (name, market) in table_of(&config, "marketplaces") {
            let source = market.get("source").and_then(toml::Value::as_str).unwrap_or_default();
            let kind = market.get("source_type").and_then(toml::Value::as_str).unwrap_or_default();
            found.add(agent, ExtKind::Marketplace, ExtScope::User, name, name, format!("{kind} {source}").trim().to_owned(), None);
        }
        for (name, server) in table_of(&config, "mcp_servers") {
            let detail = match server.get("url").and_then(toml::Value::as_str) {
                Some(url) => url.to_owned(),
                None => {
                    let command = server.get("command").and_then(toml::Value::as_str).unwrap_or_default();
                    let args = server.get("args").and_then(toml::Value::as_array).into_iter().flatten().filter_map(toml::Value::as_str);
                    std::iter::once(command).chain(args).collect::<Vec<_>>().join(" ")
                }
            };
            found.add(agent, ExtKind::McpServer, ExtScope::User, name, name, detail, None);
        }
    }
    for scope in [ExtScope::User, ExtScope::Project] {
        if let Some(dir) = skills_dir(homes, agent, scope, project) {
            skills(found, agent, scope, &dir);
        }
    }
}

fn table_of<'a>(config: &'a toml::Table, name: &str) -> impl Iterator<Item = (&'a String, &'a toml::Table)> {
    config.get(name).and_then(toml::Value::as_table).into_iter().flatten().filter_map(|(key, value)| Some((key, value.as_table()?)))
}

fn mcp_json(found: &mut Found, agent: ExtAgent, scope: ExtScope, servers: Option<&Value>) {
    for (name, server) in servers.and_then(Value::as_object).into_iter().flatten() {
        let detail = match server.get("url").and_then(Value::as_str) {
            Some(url) => url.to_owned(),
            None => {
                let command = server.get("command").and_then(Value::as_str).unwrap_or_default();
                let args = server.get("args").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str);
                std::iter::once(command).chain(args).collect::<Vec<_>>().join(" ")
            }
        };
        found.add(agent, ExtKind::McpServer, scope, name, name, detail, None);
    }
}

fn market_source(source: Option<&Value>) -> String {
    let field = |name: &str| source.and_then(|source| source.get(name)).and_then(Value::as_str).unwrap_or_default();
    match field("source") {
        "github" => format!("GitHub {}", field("repo")),
        "directory" | "file" => format!("folder {}", field("path")),
        "git" | "url" => format!("address {}", field("url")),
        other => other.to_owned(),
    }
}

/// Whether a folder a file names is the project asked about. Paths are compared as text with the
/// separators made alike, since Claude writes a Windows folder either way.
fn same_folder(named: Option<&str>, project: Option<&Path>) -> bool {
    let (Some(named), Some(project)) = (named, project) else { return false };
    let plain = |text: &str| text.replace('\\', "/").trim_end_matches('/').to_owned();
    plain(named) == plain(&project.to_string_lossy())
}

/// The skills in `dir`: each folder that holds a `SKILL.md`. A folder's name is what a request
/// names it by; the front matter only supplies the words shown.
fn skills(found: &mut Found, agent: ExtAgent, scope: ExtScope, dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| Some((entry.file_name().into_string().ok()?, entry.path())))
        .filter(|(name, _)| maitty_shared::extensions::is_ext_name(name))
        .collect();
    names.sort();
    for (folder, path) in names.into_iter().take(SKILLS_MAX) {
        // `metadata` follows a link, so a linked skill folder is listed like any other.
        if !path.metadata().is_ok_and(|meta| meta.is_dir()) {
            continue;
        }
        let Some(head) = read_head(&path.join("SKILL.md")) else { continue };
        let (name, description) = front_matter(&head);
        found.add(agent, ExtKind::Skill, scope, &folder, &name.unwrap_or_else(|| folder.clone()), description.unwrap_or_default(), None);
    }
}

fn read_head(path: &Path) -> Option<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path).ok()?.take(SKILL_HEAD_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// `name` and `description` from the front matter of a `SKILL.md`. A description may be one line
/// or a folded block (`>` or `|`) of indented lines.
fn front_matter(text: &str) -> (Option<String>, Option<String>) {
    let mut lines = text.trim_start_matches('\u{feff}').lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let (mut name, mut description) = (None, None);
    let mut block: Option<&str> = None;
    let mut folded = String::new();
    for raw in lines {
        if raw.trim() == "---" {
            break;
        }
        if block.is_some() && (raw.starts_with(' ') || raw.starts_with('\t')) {
            folded.push(' ');
            folded.push_str(raw.trim());
            continue;
        }
        if block.take().is_some() {
            description = Some(folded.trim().to_owned());
        }
        let Some((key, value)) = raw.split_once(':') else { continue };
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        match key.trim() {
            "name" if !value.is_empty() => name = Some(value.to_owned()),
            "description" if matches!(value, ">" | "|" | ">-" | "|-") => {
                block = Some("description");
                folded.clear();
            }
            "description" if !value.is_empty() => description = Some(value.to_owned()),
            _ => {}
        }
    }
    if block.is_some() {
        description = Some(folded.trim().to_owned());
    }
    (name, description)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::persist::scratch_dir;

    const INSTALLED: &str = include_str!("samples/claude-installed-plugins.json");
    const MARKETS: &str = include_str!("samples/claude-known-marketplaces.json");
    const SETTINGS: &str = include_str!("samples/claude-settings.json");
    const PROJECT_SETTINGS: &str = include_str!("samples/claude-project-settings.json");
    const PROJECT_MCP: &str = include_str!("samples/claude-project-mcp.json");
    const CLAUDE_JSON: &str = include_str!("samples/claude-json.json");
    const CODEX_CONFIG: &str = include_str!("samples/codex-config.toml");
    const PROJECT: &str = "/home/me/sample/proj";

    fn put(root: &Path, file: &str, text: &str) {
        let path = root.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    /// The files of an isolated Claude and Codex, as the real programs wrote them, under `root`.
    fn homes(root: &Path) -> Homes {
        put(root, "claude/plugins/installed_plugins.json", INSTALLED);
        put(root, "claude/plugins/known_marketplaces.json", MARKETS);
        put(root, "claude/settings.json", SETTINGS);
        put(root, "claude.json", CLAUDE_JSON);
        put(root, "codex/config.toml", CODEX_CONFIG);
        Homes { claude_dir: root.join("claude"), claude_json: root.join("claude.json"), codex_dir: root.join("codex"), pin_env: true }
    }

    fn find<'a>(list: &'a ExtensionList, agent: ExtAgent, kind: ExtKind, scope: ExtScope, id: &str) -> Option<&'a ExtItem> {
        list.items.iter().find(|item| item.agent == agent && item.kind == kind && item.scope == scope && item.id == id)
    }

    #[test]
    fn claude_plugins_marketplaces_and_servers_are_read_per_user() {
        let root = scratch_dir();
        let list = list(&homes(root.path()), None);
        assert!(list.problems.is_empty(), "{:?}", list.problems);
        let plugin = find(&list, ExtAgent::Claude, ExtKind::Plugin, ExtScope::User, "hello@local-mk").unwrap();
        assert_eq!((plugin.name.as_str(), plugin.detail.as_str(), plugin.enabled), ("hello", "version 1.0.0", Some(false)), "the user's settings switched it off");
        assert!(find(&list, ExtAgent::Claude, ExtKind::Plugin, ExtScope::Project, "hello@local-mk").is_none(), "no project was asked about");
        let market = find(&list, ExtAgent::Claude, ExtKind::Marketplace, ExtScope::User, "local-mk").unwrap();
        assert_eq!(market.detail, "folder /home/me/sample/mk");
        let server = find(&list, ExtAgent::Claude, ExtKind::McpServer, ExtScope::User, "srv").unwrap();
        assert_eq!((server.detail.as_str(), server.enabled), ("echo a b", None));
        assert!(find(&list, ExtAgent::Claude, ExtKind::McpServer, ExtScope::Local, "mine").is_none());
    }

    #[test]
    fn a_project_adds_its_own_plugins_servers_and_local_servers() {
        let root = scratch_dir();
        let homes = homes(root.path());
        let project = root.path().join("proj");
        put(&project, ".claude/settings.json", PROJECT_SETTINGS);
        put(&project, ".mcp.json", PROJECT_MCP);
        // The record names the folder the sample was made in; this test's folder stands in for it.
        let installed = INSTALLED.replace(PROJECT, &project.to_string_lossy().replace('\\', "/"));
        put(root.path(), "claude/plugins/installed_plugins.json", &installed);
        let list = list(&homes, Some(&project));
        let plugin = find(&list, ExtAgent::Claude, ExtKind::Plugin, ExtScope::Project, "hello@local-mk").unwrap();
        assert_eq!(plugin.enabled, Some(true));
        assert_eq!(find(&list, ExtAgent::Claude, ExtKind::McpServer, ExtScope::Project, "web").unwrap().detail, "https://example.com/mcp");
        let other = root.path().join("elsewhere");
        let elsewhere = super::list(&homes, Some(&other));
        assert!(find(&elsewhere, ExtAgent::Claude, ExtKind::Plugin, ExtScope::Project, "hello@local-mk").is_none(), "another project's plugin is not this one's");
    }

    #[test]
    fn a_local_server_is_found_by_the_project_folder() {
        let root = scratch_dir();
        let list = list(&homes(root.path()), Some(Path::new(PROJECT)));
        assert_eq!(find(&list, ExtAgent::Claude, ExtKind::McpServer, ExtScope::Local, "mine").unwrap().detail, "node server.js");
        let windows_style = list_for("C:\\work\\app\\", "C:/work/app");
        assert!(windows_style, "separators and a trailing one do not tell two spellings of a folder apart");
    }

    fn list_for(named: &str, project: &str) -> bool {
        same_folder(Some(named), Some(Path::new(project)))
    }

    #[test]
    fn codex_plugins_marketplaces_and_servers_come_from_its_config() {
        let root = scratch_dir();
        let list = list(&homes(root.path()), None);
        let plugin = find(&list, ExtAgent::Codex, ExtKind::Plugin, ExtScope::User, "hello@local-mk").unwrap();
        assert_eq!(plugin.enabled, Some(true));
        assert_eq!(find(&list, ExtAgent::Codex, ExtKind::Marketplace, ExtScope::User, "local-mk").unwrap().detail, "local /home/me/sample/mk");
        assert_eq!(find(&list, ExtAgent::Codex, ExtKind::McpServer, ExtScope::User, "srv").unwrap().detail, "echo a b");
        assert_eq!(find(&list, ExtAgent::Codex, ExtKind::McpServer, ExtScope::User, "web").unwrap().detail, "https://example.com/mcp");
    }

    #[test]
    fn skills_are_the_folders_that_hold_a_skill_file() {
        let root = scratch_dir();
        let homes = homes(root.path());
        put(root.path(), "claude/skills/notes/SKILL.md", "---\nname: Notes\ndescription: Keeps notes\n---\nbody");
        put(root.path(), "claude/skills/folded/SKILL.md", "---\nname: folded\ndescription: >\n  first line\n  second line\nother: x\n---\n");
        put(root.path(), "claude/skills/plain/readme.txt", "no skill file");
        put(root.path(), "claude/skills/.system/SKILL.md", "---\nname: hidden\n---\n");
        put(root.path(), "codex/skills/review/SKILL.md", "no front matter");
        let project = root.path().join("proj");
        put(&project, ".claude/skills/local/SKILL.md", "---\ndescription: 'quoted'\n---\n");
        put(&project, ".agents/skills/shared/SKILL.md", "---\nname: shared\n---\n");
        let list = list(&homes, Some(&project));
        let notes = find(&list, ExtAgent::Claude, ExtKind::Skill, ExtScope::User, "notes").unwrap();
        assert_eq!((notes.name.as_str(), notes.detail.as_str()), ("Notes", "Keeps notes"));
        assert_eq!(find(&list, ExtAgent::Claude, ExtKind::Skill, ExtScope::User, "folded").unwrap().detail, "first line second line");
        assert!(find(&list, ExtAgent::Claude, ExtKind::Skill, ExtScope::User, "plain").is_none());
        assert!(find(&list, ExtAgent::Claude, ExtKind::Skill, ExtScope::User, ".system").is_none());
        assert_eq!(find(&list, ExtAgent::Codex, ExtKind::Skill, ExtScope::User, "review").unwrap().name, "review");
        assert_eq!(find(&list, ExtAgent::Claude, ExtKind::Skill, ExtScope::Project, "local").unwrap().detail, "quoted");
        assert!(find(&list, ExtAgent::Codex, ExtKind::Skill, ExtScope::Project, "shared").is_some());
    }

    #[test]
    fn a_file_that_is_there_but_unreadable_is_reported_and_one_that_is_not_there_is_not() {
        let root = scratch_dir();
        let homes = homes(root.path());
        put(root.path(), "claude/settings.json", "{ not json");
        put(root.path(), "codex/config.toml", "= nope");
        put(root.path(), "claude.json", &"x".repeat(FILE_MAX_BYTES as usize + 1));
        std::fs::remove_file(root.path().join("claude/plugins/known_marketplaces.json")).unwrap();
        let list = list(&homes, None);
        assert_eq!(list.problems.len(), 3, "{:?}", list.problems);
        assert!(list.problems.iter().any(|problem| problem == "claude/settings.json is not valid JSON"));
        assert!(list.problems.iter().any(|problem| problem == "codex/config.toml is not valid TOML"));
        assert!(list.problems.iter().any(|problem| problem == "root/claude.json is too large to read" || problem.ends_with("claude.json is too large to read")));
        assert!(find(&list, ExtAgent::Claude, ExtKind::Plugin, ExtScope::User, "hello@local-mk").is_some(), "the rest is still listed");
    }

    #[test]
    fn nothing_installed_is_an_empty_list() {
        let root = scratch_dir();
        let homes = Homes { claude_dir: root.path().join("c"), claude_json: root.path().join("c.json"), codex_dir: root.path().join("x"), pin_env: true };
        assert_eq!(list(&homes, None), ExtensionList::default());
    }

    #[test]
    fn a_description_block_ends_where_its_indent_does() {
        assert_eq!(front_matter("---\ndescription: |\n  a\n  b\nname: n\n---\n"), (Some("n".into()), Some("a b".into())));
        assert_eq!(front_matter("no front matter"), (None, None));
        assert_eq!(front_matter("---\nname: x\n"), (Some("x".into()), None));
    }
}
