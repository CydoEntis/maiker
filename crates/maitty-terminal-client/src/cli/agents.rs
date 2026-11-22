//! `agents`: the agents that run as a chat over ACP on this computer, and installing one from
//! the ACP registry (ADR 0021). The downloading is done here, in a command that ends, never in
//! the service; the desktop app runs these same commands.

use crate::acp_registry::{self as registry, Installed, Listed};
use anyhow::{Result, bail};
use clap::Subcommand;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Subcommand)]
pub(crate) enum Cmd {
    /// List the agents that can run over ACP: the ACP registry's, and the config's own.
    List {
        /// One JSON array, for a program to read.
        #[arg(long)]
        json: bool,
    },
    /// Install an agent from the ACP registry by its id, or replace it with the newest version.
    Install { id: String },
    /// Remove an agent that was installed from the ACP registry.
    Remove { id: String },
}

/// One agent as `agents list` tells it.
#[derive(Serialize, Debug, PartialEq, Eq)]
struct Row {
    id: String,
    name: String,
    /// The registry's version; empty for an agent the config names.
    version: String,
    description: String,
    /// `registry`, or `config` for an `[[agents]]` entry with `acp = true`.
    source: &'static str,
    /// The version on this computer, when it is installed. A config entry is always ready.
    installed: Option<String>,
    /// Why it cannot be installed here, when it cannot.
    unavailable: Option<String>,
}

pub(crate) fn run(cmd: Cmd) -> Result<()> {
    let data = crate::config::data_dir();
    match cmd {
        Cmd::List { json } => {
            let (cfg, _) = crate::config::Config::load_or_default();
            let named: Vec<String> = cfg.acp_agents().into_iter().map(|agent| agent.name).collect();
            let listed = registry::fetch_index(&data)?;
            let rows = rows(&named, &listed, &registry::installed(&data), &registry::platform());
            if json {
                println!("{}", serde_json::to_string(&rows)?);
            } else {
                for row in &rows {
                    println!("{}", line(row));
                }
            }
            Ok(())
        }
        Cmd::Install { id } => {
            let agent = install(&id, &data)?;
            println!("Installed {} {}", agent.name, agent.version);
            Ok(())
        }
        Cmd::Remove { id } => {
            if !registry::remove(&id, &data)? {
                bail!("No agent `{id}` is installed from the registry");
            }
            println!("Removed {id}");
            Ok(())
        }
    }
}

fn install(id: &str, data: &Path) -> Result<Installed> {
    // Checked before the registry is asked, so a mistyped id is told as one.
    if !crate::conversation::acp_agent_name(id) {
        bail!("{id:?} is not an agent's id: lowercase letters, digits, `-` or `_`");
    }
    let listed = registry::fetch_index(data)?;
    let Some(agent) = listed.iter().find(|agent| agent.id == id) else {
        bail!("The ACP registry lists no agent `{id}`. `agents list` shows the ones it has");
    };
    registry::install(agent, data)
}

/// The config's agents first (they win over the registry's of the same name), then the
/// registry's in its own order.
fn rows(named: &[String], listed: &[Listed], installed: &BTreeMap<String, Installed>, platform: &str) -> Vec<Row> {
    let from_config = named.iter().map(|name| Row {
        id: name.clone(),
        name: name.clone(),
        version: String::new(),
        description: String::new(),
        source: "config",
        installed: Some(String::new()),
        unavailable: None,
    });
    let from_registry = listed.iter().filter(|agent| !named.contains(&agent.id)).map(|agent| Row {
        id: agent.id.clone(),
        name: agent.name.clone(),
        version: agent.version.clone(),
        description: agent.description.clone(),
        source: "registry",
        installed: installed.get(&agent.id).map(|kept| kept.version.clone()),
        unavailable: registry::source(agent, platform).err(),
    });
    from_config.chain(from_registry).collect()
}

fn line(row: &Row) -> String {
    let state = match (&row.installed, &row.unavailable) {
        (Some(_), _) if row.source == "config" => "in the config".to_owned(),
        (Some(version), _) if *version == row.version => "installed".to_owned(),
        (Some(version), _) => format!("installed {version}, {} is out", row.version),
        (None, Some(why)) => format!("cannot be installed: it {why}"),
        (None, None) => "not installed".to_owned(),
    };
    format!("{}\t{} {}\t{state}", row.id, row.name, row.version)
}

#[cfg(test)]
mod tests {
    use super::*;

    const INDEX: &str = r#"{"agents":[
        {"id":"demo","name":"Demo","version":"2.0.0","description":"A demo","distribution":{"npx":{"package":"demo@2.0.0"}}},
        {"id":"mine","name":"Mine","version":"1.0.0","distribution":{"npx":{"package":"mine@1.0.0"}}},
        {"id":"snake","name":"Snake","version":"1.0.0","distribution":{"uvx":{"package":"snake==1.0.0"}}}
    ]}"#;

    fn kept(version: &str) -> Installed {
        Installed { name: "Demo".into(), version: version.into(), command: "/node".into(), args: Vec::new(), env: BTreeMap::new() }
    }

    #[test]
    fn the_list_has_the_configs_agents_first_and_says_what_is_installed_or_cannot_be() {
        let listed = registry::parse_index(INDEX).unwrap();
        let installed = BTreeMap::from([("demo".to_owned(), kept("1.9.0"))]);

        let rows = rows(&["mine".to_owned()], &listed, &installed, "linux-x86_64");

        assert_eq!(rows.iter().map(|row| (row.id.as_str(), row.source)).collect::<Vec<_>>(), [("mine", "config"), ("demo", "registry"), ("snake", "registry")]);
        assert_eq!(line(&rows[0]), "mine\tmine \tin the config");
        assert_eq!(line(&rows[1]), "demo\tDemo 2.0.0\tinstalled 1.9.0, 2.0.0 is out");
        assert!(line(&rows[2]).contains("cannot be installed: it is a Python package"), "{}", line(&rows[2]));
    }

    #[test]
    fn an_id_that_is_no_agents_is_refused_before_anything_is_fetched() {
        let refused = install("../demo", Path::new("/nonexistent")).unwrap_err().to_string();

        assert!(refused.contains("not an agent's id"), "{refused}");
    }
}
