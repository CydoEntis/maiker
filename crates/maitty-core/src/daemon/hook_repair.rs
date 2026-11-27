//! Keeps the status hooks of the folder a Claude pane really runs with pointed at this build.
//!
//! An agent's hooks live in the settings file of its own config folder, and that folder is the
//! agent process's `CLAUDE_CONFIG_DIR`: a user's alias, a shell function or an account entry can
//! set it for one pane, and the daemon's own environment says nothing about it. A folder still
//! naming an older build's hook (or none) makes every report of its panes vanish: the pane never
//! counts as hooked, so no chat follows it. The scan reads the folder off the agent process; this
//! module checks it in the background, repairs it once, and says in the pane's info what is wrong
//! when it cannot be fixed or only a restart of the agent loads the fix.

use super::{Daemon, Ev};
use crate::protocol::{HookProblem, Surface, TermId};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// How long an agent may run without a hook before its folder is looked at: hooks reach the
/// daemon within seconds of the agent starting.
const UNHOOKED_GRACE: Duration = Duration::from_secs(15);

/// How often a folder that still looks wrong is looked at again.
const RECHECK_EVERY: Duration = Duration::from_secs(60);
/// How often the server reads the reports its panes' hooks could not hand over
/// (`crate::hook_drops`).
const LOST_REPORTS_EVERY: Duration = Duration::from_secs(2);
/// Said after a pane's status reason while a report its hooks sent was lost, until the next one
/// arrives: the status may be behind what the agent is doing.
pub(super) const UNCONFIRMED: &str = " (unconfirmed: a status report from its hooks was lost)";

/// What the client crate knows about hooks: reading and writing an agent's settings file is its
/// job (the daemon never imports the CLI), so it hands these in when the daemon starts.
pub struct HookTools {
    /// Why the settings in this config folder do not send hooks to this build (`None` when they do,
    /// or when hooks are not this build's to manage).
    pub check: fn(&Path) -> Result<Option<String>, String>,
    /// Points the hooks in this config folder at this build.
    pub repair: fn(&Path) -> Result<(), String>,
}

static TOOLS: OnceLock<HookTools> = OnceLock::new();

pub fn install_hook_tools(tools: HookTools) {
    let _ = TOOLS.set(tools);
}

/// The folder Claude Code reads its settings from when nothing names another.
pub fn default_claude_folder() -> Option<PathBuf> {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::home_dir().map(|home| home.join(".claude")))
}

/// The config folder a pane's Claude will run with, as far as its spawn says: its account's own
/// environment, then the config's, then the daemon's. A leading `~` is the home folder, as in the
/// config. `None` when none names one (Claude then reads `default_claude_folder`).
pub fn folder_at_spawn(
    account_env: Option<&std::collections::BTreeMap<String, String>>,
    config_env: &std::collections::BTreeMap<String, String>,
) -> Option<PathBuf> {
    let named = account_env
        .and_then(|env| env.get("CLAUDE_CONFIG_DIR"))
        .or_else(|| config_env.get("CLAUDE_CONFIG_DIR"))?;
    match named.strip_prefix("~/") {
        Some(rest) => std::env::home_dir().map(|home| home.join(rest)),
        None => Some(PathBuf::from(named)),
    }
}

/// What the daemon remembers about one pane's hooks. In memory only.
#[derive(Default)]
pub struct HookWatch {
    unhooked_since: Option<Instant>,
    folder: Option<PathBuf>,
    last: Option<Instant>,
    in_flight: bool,
}

/// What a background look at one folder found.
pub struct Checked {
    pub term: TermId,
    pub folder: PathBuf,
    pub problem: Option<HookProblem>,
}

/// Looks at `folder` and, when its hooks run another build, repairs them: the one place that
/// decides what to say. Blocking (reads and writes a file): call it off the UI thread.
pub fn check_and_repair(tools: &HookTools, folder: &Path) -> Option<HookProblem> {
    let file = folder.join("settings.json");
    let failed = |why: String| {
        tracing::warn!("Claude hooks in {}: {why}", file.display());
        Some(HookProblem {
            file: file.clone(),
            why,
            repaired: false,
        })
    };
    match (tools.check)(folder) {
        Ok(None) => None,
        Err(error) => failed(format!("could not read them: {error}")),
        Ok(Some(why)) => match (tools.repair)(folder) {
            Ok(()) => {
                tracing::info!("pointed the Claude hooks in {} at this build ({why})", file.display());
                Some(HookProblem {
                    file,
                    why: format!("{why}; now fixed"),
                    repaired: true,
                })
            }
            Err(error) => failed(format!("{why}; could not fix them: {error}")),
        },
    }
}

impl Daemon {
    /// A pane that starts Claude Code: its own config folder is looked at and repaired before the
    /// agent reads it, off the daemon's loop. Quiet when it worked: the agent starts with the right
    /// hooks. A failure is logged and said in the pane's info (`HookProblem`).
    pub(in crate::daemon) fn repair_hooks_for_spawn(&mut self, term: TermId, account: Option<&str>) {
        let Some(tools) = TOOLS.get() else {
            return;
        };
        let account_env = account.and_then(|a| self.cfg.account(a)).map(|a| &a.env);
        let Some(folder) = folder_at_spawn(account_env, &self.cfg.env).or_else(default_claude_folder) else {
            return;
        };
        let Some(t) = self.terms.get_mut(&term) else {
            return;
        };
        t.claude_dir = Some(folder.clone());
        t.hook_watch.folder = Some(folder.clone());
        t.hook_watch.in_flight = true;
        t.hook_watch.last = Some(Instant::now());
        let tx = self.tx.clone();
        tokio::task::spawn_blocking(move || {
            let problem = check_and_repair(tools, &folder).filter(|p| !p.repaired);
            let _ = tx.blocking_send(Ev::HookFolderChecked(Box::new(Checked { term, folder, problem })));
        });
    }

    /// Starts a background look at the folder of every Claude pane whose hooks never reported.
    /// Log the reports each pane's hooks lost, and say on the pane that its status is not
    /// confirmed until its next report arrives (`hook_report` clears it).
    pub(in crate::daemon) fn note_lost_reports(&mut self) {
        if self.lost_reports_read.elapsed() < LOST_REPORTS_EVERY {
            return;
        }
        self.lost_reports_read = Instant::now();
        let lost = match crate::hook_drops::take(&self.hook_drops_file) {
            Ok(lost) => lost,
            Err(error) => {
                tracing::warn!("could not read the hook reports that were lost: {error}");
                return;
            }
        };
        for (term, count) in lost {
            let Some(t) = self.terms.get_mut(&term) else {
                tracing::warn!("{count} status report(s) for pane {term}, now closed, never reached the server");
                continue;
            };
            tracing::warn!(
                "pane {term} ({}): {count} status report(s) from its hooks never reached the server",
                t.agent.as_deref().unwrap_or("no agent")
            );
            if !t.status_why.ends_with(UNCONFIRMED) {
                t.status_why.push_str(UNCONFIRMED);
                self.dirty = true;
            }
        }
    }

    pub(in crate::daemon) fn hook_watch_tick(&mut self) {
        if TOOLS.get().is_none() {
            return;
        }
        let now = Instant::now();
        let default = default_claude_folder();
        let mut due = Vec::new();
        for t in self.terms.values_mut() {
            let watched = t.owner == Surface::Desktop
                && t.remote.is_none()
                && !t.popup
                && !t.spare
                && t.agent.as_deref() == Some("claude");
            if !watched || t.hooked {
                t.hook_watch.unhooked_since = None;
                if t.hooked && t.hook_problem.take().is_some() {
                    self.dirty = true;
                }
                continue;
            }
            let since = *t.hook_watch.unhooked_since.get_or_insert(now);
            if now.duration_since(since) < UNHOOKED_GRACE || t.hook_watch.in_flight {
                continue;
            }
            let Some(folder) = t.claude_dir.clone().or_else(|| default.clone()) else {
                continue;
            };
            let same = t.hook_watch.folder.as_ref() == Some(&folder);
            let fresh = t.hook_watch.last.is_some_and(|at| now.duration_since(at) < RECHECK_EVERY);
            // A folder already repaired is not looked at again: the agent has to restart to load it.
            let settled = same && t.hook_problem.as_ref().is_some_and(|p| p.repaired);
            if settled || (same && fresh) {
                continue;
            }
            t.hook_watch.in_flight = true;
            t.hook_watch.folder = Some(folder.clone());
            t.hook_watch.last = Some(now);
            due.push((t.id, folder));
        }
        for (term, folder) in due {
            let tx = self.tx.clone();
            tokio::task::spawn_blocking(move || {
                let problem = TOOLS.get().and_then(|tools| check_and_repair(tools, &folder));
                let _ = tx.blocking_send(Ev::HookFolderChecked(Box::new(Checked { term, folder, problem })));
            });
        }
    }

    /// A background look finished: what it found is what the pane's info says until the pane is
    /// hooked or another look finds otherwise.
    pub(in crate::daemon) fn hook_checked(&mut self, done: Checked) {
        let Some(t) = self.terms.get_mut(&done.term) else {
            return;
        };
        t.hook_watch.in_flight = false;
        // The agent moved to another folder while this was being read.
        if t.hook_watch.folder.as_ref() != Some(&done.folder) {
            return;
        }
        if t.hook_problem != done.problem {
            t.hook_problem = done.problem;
            self.dirty = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNREADABLE: HookTools = HookTools {
        check: |_| Err("settings.json is not valid JSON".into()),
        repair: |_| Ok(()),
    };
    const STALE_AND_FIXABLE: HookTools = HookTools {
        check: |_| Ok(Some("runs another maiker".into())),
        repair: |_| Ok(()),
    };
    const STALE_AND_STUCK: HookTools = HookTools {
        check: |_| Ok(Some("runs another maiker".into())),
        repair: |_| Err("read-only file".into()),
    };
    const FINE: HookTools = HookTools {
        check: |_| Ok(None),
        repair: |_| Err("never called".into()),
    };

    #[test]
    fn a_folder_outside_dot_claude_is_named_in_what_the_person_sees() {
        let folder = Path::new("/srv/agents/claude-home");
        let problem = check_and_repair(&UNREADABLE, folder).expect("a problem");
        assert_eq!(problem.file, Path::new("/srv/agents/claude-home/settings.json"));
        assert!(!problem.repaired);
    }

    #[test]
    fn a_stale_folder_is_repaired_and_says_the_agent_must_restart() {
        let problem = check_and_repair(&STALE_AND_FIXABLE, Path::new("/x")).expect("a problem");
        assert!(problem.repaired);
        assert!(problem.why.contains("now fixed"));
    }

    #[test]
    fn a_repair_that_fails_is_said_not_swallowed() {
        let problem = check_and_repair(&STALE_AND_STUCK, Path::new("/x")).expect("a problem");
        assert!(!problem.repaired);
        assert!(problem.why.contains("read-only file"));
    }

    #[test]
    fn a_spawn_names_its_folder_from_its_account_then_the_config() {
        use std::collections::BTreeMap;
        let env = |dir: &str| BTreeMap::from([("CLAUDE_CONFIG_DIR".to_string(), dir.to_string())]);
        assert_eq!(
            folder_at_spawn(Some(&env("/srv/account")), &env("/srv/config")),
            Some(PathBuf::from("/srv/account"))
        );
        assert_eq!(folder_at_spawn(None, &env("/srv/config")), Some(PathBuf::from("/srv/config")));
        assert_eq!(folder_at_spawn(None, &BTreeMap::new()), None);
    }

    #[test]
    fn a_folder_that_is_right_says_nothing() {
        assert!(check_and_repair(&FINE, Path::new("/x")).is_none());
    }
}
