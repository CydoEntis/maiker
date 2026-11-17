//! What an add would run, worked out from files and shown before anything is installed. Nothing
//! here executes or fetches anything: a plugin's manifest is read as data with a size limit, and
//! only a plugin that sits in a marketplace folder already on this computer can be read before it is
//! installed. One fetched from somewhere else says so, instead of guessing.

use super::{Env, project_folder};
use maitty_shared::extensions::{EXT_RUNS_CODE, ExtAdd, ExtAgent, ExtError, ExtKind, ExtPreview, ExtScope, McpRun, MarketSource};
use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The most bytes read of one manifest.
const MANIFEST_MAX_BYTES: u64 = 256 * 1024;
const CANNOT_LIST: &str = "What it runs cannot be listed before it is installed, because its files are fetched when you install it.";

/// The preview of `add` (already checked), kept under a token for `Add`.
pub(super) fn of(env: &Env, add: ExtAdd) -> Result<ExtPreview, ExtError> {
    let shown = describe(env, &add)?;
    let token = env.previews.keep(add)?;
    Ok(ExtPreview { token, ..shown })
}

fn describe(env: &Env, add: &ExtAdd) -> Result<ExtPreview, ExtError> {
    let blank = |agent, kind, name: &str, scope, source: String| ExtPreview { token: String::new(), agent, kind, name: name.to_owned(), scope, source, runs: Vec::new(), hosts: Vec::new() };
    match add {
        ExtAdd::Mcp { agent, name, run, scope, project } => {
            if *scope != ExtScope::User {
                project_folder(project.as_deref())?;
            }
            let mut shown = blank(*agent, ExtKind::McpServer, name, *scope, "Typed in this window".into());
            match run {
                McpRun::Command { command, args } => {
                    shown.runs.push(std::iter::once(command.as_str()).chain(args.iter().map(String::as_str)).collect::<Vec<_>>().join(" "));
                    shown.runs.push("It starts whenever the agent starts, as you.".into());
                }
                McpRun::Url { url } => {
                    shown.runs.push(format!("Connects to {url}"));
                    shown.hosts.extend(run.host());
                }
            }
            Ok(shown)
        }
        ExtAdd::Marketplace { agent, source } => {
            let parsed = MarketSource::parse(source)?;
            let mut shown = blank(*agent, ExtKind::Marketplace, source, ExtScope::User, source.clone());
            shown.runs.push("Adds a list of plugins. Nothing in it runs until you install one, but each plugin in it is then one click from running code.".into());
            match parsed {
                MarketSource::GitHub(_) => shown.hosts.push("github.com".into()),
                MarketSource::Url(url) => shown.hosts.extend(url.strip_prefix("https://").and_then(|rest| rest.split(['/', '?', '#']).next()).map(str::to_owned)),
                MarketSource::Folder(_) => {}
            }
            Ok(shown)
        }
        ExtAdd::Plugin { agent, plugin, scope, project } => {
            if *scope != ExtScope::User {
                project_folder(project.as_deref())?;
            }
            let (name, market) = plugin.split_once('@').ok_or_else(|| ExtError::Invalid("A plugin is written name@marketplace".into()))?;
            let found = market_of(env, *agent, market).ok_or(ExtError::NotFound)?;
            let mut shown = blank(*agent, ExtKind::Plugin, plugin, *scope, format!("Plugin {name} from the marketplace {market} ({})", found.source));
            let entry = found.dir.as_deref().and_then(manifest).and_then(|manifest| plugin_entry(&manifest, name));
            match (entry, found.dir.as_deref()) {
                (Some(PluginSource::Folder(relative)), Some(dir)) => match inside(dir, &relative) {
                    Some(folder) => shown.runs = runs_of(&folder, &mut shown.hosts),
                    None => shown.runs.push(CANNOT_LIST.into()),
                },
                (Some(PluginSource::Elsewhere(from)), _) => {
                    shown.source = format!("{} It comes from {from}.", shown.source);
                    shown.runs.push(CANNOT_LIST.into());
                }
                (None, Some(_)) if found.readable => return Err(ExtError::NotFound),
                _ => shown.runs.push(CANNOT_LIST.into()),
            }
            if shown.runs.is_empty() {
                shown.runs.push("Its files list no hook, server or command. Its skills and agents still instruct the model, which can run tools.".into());
            }
            Ok(shown)
        }
    }
}

/// A marketplace on this computer: where it came from, and its folder when that is local.
struct Market {
    source: String,
    dir: Option<PathBuf>,
    /// Whether its manifest could be looked in at all.
    readable: bool,
}

fn market_of(env: &Env, agent: ExtAgent, market: &str) -> Option<Market> {
    let listed = super::listed(env, None);
    let item = listed.items.iter().find(|item| item.agent == agent && item.kind == ExtKind::Marketplace && item.id == market)?;
    let dir = match agent {
        ExtAgent::Claude => read_json(&env.homes.claude_dir.join("plugins").join("known_marketplaces.json"))
            .and_then(|markets| markets.get(market)?.get("installLocation")?.as_str().map(PathBuf::from)),
        ExtAgent::Codex => std::fs::read_to_string(env.homes.codex_dir.join("config.toml"))
            .ok()
            .and_then(|text| text.parse::<toml::Table>().ok())
            .and_then(|config| {
                let entry = config.get("marketplaces")?.get(market)?;
                (entry.get("source_type")?.as_str()? == "local").then(|| entry.get("source")?.as_str().map(PathBuf::from)).flatten()
            }),
    };
    let readable = dir.as_deref().is_some_and(|dir| manifest(dir).is_some());
    Some(Market { source: item.detail.clone(), dir, readable })
}

fn read_json(path: &Path) -> Option<Value> {
    let mut text = String::new();
    std::fs::File::open(path).ok()?.take(MANIFEST_MAX_BYTES + 1).read_to_string(&mut text).ok()?;
    if text.len() as u64 > MANIFEST_MAX_BYTES {
        return None;
    }
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn manifest(dir: &Path) -> Option<Value> {
    [".claude-plugin/marketplace.json", "marketplace.json"].iter().find_map(|file| read_json(&dir.join(file)))
}

enum PluginSource {
    /// A folder inside the marketplace, written `./relative`.
    Folder(String),
    /// A repository or an address, which is only fetched on install.
    Elsewhere(String),
}

fn plugin_entry(manifest: &Value, name: &str) -> Option<PluginSource> {
    let entry = manifest.get("plugins")?.as_array()?.iter().find(|entry| entry.get("name").and_then(Value::as_str) == Some(name))?;
    Some(match entry.get("source") {
        Some(Value::String(path)) => PluginSource::Folder(path.clone()),
        Some(Value::Object(source)) => {
            let word = |field: &str| source.get(field).and_then(Value::as_str).unwrap_or_default();
            let place = [word("repo"), word("url"), word("path")].into_iter().find(|place| !place.is_empty()).unwrap_or("another place");
            PluginSource::Elsewhere(place.to_owned())
        }
        _ => PluginSource::Elsewhere("another place".into()),
    })
}

/// `relative` below `dir`, when it stays below it: no `..`, no root.
fn inside(dir: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative.strip_prefix("./").unwrap_or(relative));
    relative.components().all(|part| matches!(part, Component::Normal(_) | Component::CurDir)).then(|| dir.join(relative))
}

/// The commands and addresses a plugin folder holds: hooks, servers, in its manifest and its
/// `hooks/hooks.json` and `.mcp.json`.
fn runs_of(folder: &Path, hosts: &mut Vec<String>) -> Vec<String> {
    let mut runs = Vec::new();
    let plugin = read_json(&folder.join(".claude-plugin").join("plugin.json"));
    let hook_files = [read_json(&folder.join("hooks").join("hooks.json")), plugin.as_ref().and_then(|plugin| plugin.get("hooks")).filter(|hooks| hooks.is_object()).cloned()];
    for file in hook_files.iter().flatten() {
        let events = file.get("hooks").unwrap_or(file);
        for (event, groups) in events.as_object().into_iter().flatten() {
            for hook in groups.as_array().into_iter().flatten().filter_map(|group| group.get("hooks")?.as_array()).flatten() {
                if let Some(command) = hook.get("command").and_then(Value::as_str) {
                    runs.push(format!("Hook on {event}: {command}"));
                }
            }
        }
    }
    let servers = [read_json(&folder.join(".mcp.json")).and_then(|file| file.get("mcpServers").cloned()), plugin.as_ref().and_then(|plugin| plugin.get("mcpServers")).cloned()];
    for (name, server) in servers.iter().flatten().filter_map(Value::as_object).flatten() {
        if let Some(url) = server.get("url").and_then(Value::as_str) {
            runs.push(format!("Server {name} connects to {url}"));
            let run = McpRun::Url { url: url.to_owned() };
            hosts.extend(run.host());
        } else if let Some(command) = server.get("command").and_then(Value::as_str) {
            let args = server.get("args").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str);
            runs.push(format!("Server {name} runs: {}", std::iter::once(command).chain(args).collect::<Vec<_>>().join(" ")));
        }
    }
    if !runs.is_empty() {
        runs.push(format!("{EXT_RUNS_CODE}."));
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::persist::scratch_dir;

    const MARKET: &str = include_str!("samples/claude-marketplace.json");
    const PLUGIN: &str = include_str!("samples/claude-plugin.json");
    const HOOKS: &str = include_str!("samples/claude-hooks.json");

    fn put(root: &Path, file: &str, text: &str) {
        let path = root.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[test]
    fn what_a_local_plugin_runs_is_read_from_its_files() {
        let root = scratch_dir();
        put(root.path(), "plugins/hello/.claude-plugin/plugin.json", PLUGIN);
        put(root.path(), "plugins/hello/hooks/hooks.json", HOOKS);
        put(root.path(), "plugins/hello/.mcp.json", r#"{"mcpServers":{"remote":{"url":"https://mcp.example.com:8443/x"}}}"#);
        let mut hosts = Vec::new();
        let runs = runs_of(&root.path().join("plugins/hello"), &mut hosts);
        assert_eq!(
            runs,
            [
                "Hook on SessionStart: echo started",
                "Server remote connects to https://mcp.example.com:8443/x",
                "Server hi runs: echo hi",
                "This runs code on your computer with your access."
            ]
        );
        assert_eq!(hosts, ["mcp.example.com"]);
    }

    #[test]
    fn a_plugin_is_found_in_the_marketplace_by_name_and_a_path_cannot_leave_it() {
        let market: Value = serde_json::from_str(MARKET).unwrap();
        assert!(matches!(plugin_entry(&market, "hello"), Some(PluginSource::Folder(path)) if path == "./plugins/hello"));
        assert!(matches!(plugin_entry(&market, "far"), Some(PluginSource::Elsewhere(from)) if from == "someone/far"));
        assert!(plugin_entry(&market, "nope").is_none());
        let dir = Path::new("/m");
        assert_eq!(inside(dir, "./plugins/hello"), Some(PathBuf::from("/m/plugins/hello")));
        for bad in ["../x", "./../x", "/etc", "a/../../b"] {
            assert_eq!(inside(dir, bad), None, "{bad}");
        }
    }

    #[cfg(unix)]
    mod with_programs {
        use super::super::super::cli::{Programs, fake};
        use super::super::super::{Env, Homes, Previews};
        use super::*;

        fn env<'a>(root: &Path, previews: &'a Previews) -> Env<'a> {
            put(root, "claude/plugins/known_marketplaces.json", &format!(r#"{{"local-mk":{{"source":{{"source":"directory","path":"{0}"}},"installLocation":"{0}"}}}}"#, root.join("mk").display()));
            put(root, "mk/.claude-plugin/marketplace.json", MARKET);
            put(root, "mk/plugins/hello/.claude-plugin/plugin.json", PLUGIN);
            put(root, "mk/plugins/hello/hooks/hooks.json", HOOKS);
            let homes = Homes { claude_dir: root.join("claude"), claude_json: root.join("claude.json"), codex_dir: root.join("codex"), pin_env: true };
            Env { homes, programs: Programs { claude: fake::program(root, "claude"), codex: fake::program(root, "codex") }, previews }
        }

        #[test]
        fn a_plugin_preview_shows_what_it_runs_and_starts_nothing() {
            let root = scratch_dir();
            let previews = Previews::default();
            let env = env(root.path(), &previews);
            let add = ExtAdd::Plugin { agent: ExtAgent::Claude, plugin: "hello@local-mk".into(), scope: ExtScope::User, project: None };
            let shown = of(&env, add.clone()).unwrap();
            assert_eq!(shown.token.len(), 32);
            assert!(shown.source.starts_with("Plugin hello from the marketplace local-mk"));
            assert!(shown.runs.contains(&"Hook on SessionStart: echo started".to_owned()));
            assert!(shown.runs.contains(&"Server hi runs: echo hi".to_owned()));
            assert!(fake::calls(&env.programs.claude).is_empty(), "a preview starts no agent");
            assert_eq!(previews.take(&shown.token), Ok(add));
            assert_eq!(previews.take(&shown.token), Err(ExtError::NeedsConfirmation), "a token works once");
        }

        #[test]
        fn a_plugin_that_is_fetched_says_so_and_an_unknown_one_is_not_found() {
            let root = scratch_dir();
            let previews = Previews::default();
            let env = env(root.path(), &previews);
            let plugin = |name: &str, market: &str| ExtAdd::Plugin { agent: ExtAgent::Claude, plugin: format!("{name}@{market}"), scope: ExtScope::User, project: None };
            let far = of(&env, plugin("far", "local-mk")).unwrap();
            assert!(far.source.contains("It comes from someone/far."));
            assert_eq!(far.runs, [CANNOT_LIST]);
            assert_eq!(of(&env, plugin("nope", "local-mk")).unwrap_err(), ExtError::NotFound);
            assert_eq!(of(&env, plugin("hello", "no-market")).unwrap_err(), ExtError::NotFound);
        }

        #[test]
        fn a_marketplace_and_a_server_show_their_source_and_the_host_that_hears_the_person() {
            let root = scratch_dir();
            let previews = Previews::default();
            let env = env(root.path(), &previews);
            let market = of(&env, ExtAdd::Marketplace { agent: ExtAgent::Codex, source: "https://git.example.com/me/mk.git".into() }).unwrap();
            assert_eq!((market.source.as_str(), market.hosts.as_slice()), ("https://git.example.com/me/mk.git", ["git.example.com".to_owned()].as_slice()));
            let server = of(&env, ExtAdd::Mcp { agent: ExtAgent::Claude, name: "docs".into(), run: McpRun::Url { url: "https://mcp.example.com/sse".into() }, scope: ExtScope::User, project: None }).unwrap();
            assert_eq!(server.hosts, ["mcp.example.com"]);
            let local = of(&env, ExtAdd::Mcp { agent: ExtAgent::Claude, name: "fs".into(), run: McpRun::Command { command: "npx".into(), args: vec!["-y".into(), "srv".into()] }, scope: ExtScope::User, project: None }).unwrap();
            assert_eq!(local.runs[0], "npx -y srv");
        }
    }
}
