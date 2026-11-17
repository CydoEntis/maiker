//! Skills, plugins, MCP servers and marketplaces of Claude Code and Codex, for the window's
//! Extensions page (`Query::Extensions`; design in `docs/features/chat-extensions/spec.md`).
//!
//! The daemon refuses an agent's connection before it gets here (`daemon/mod.rs`). A list reads
//! files and starts nothing. A plugin or an MCP server runs code with the person's access, so an
//! add is two requests: `PreviewAdd` reads what would run and keeps it under a one-time token, and
//! `Add` runs only the request that token was given for, once, within ten minutes. Every command
//! is an argument list started with a time limit and an output cap (`cli.rs`); every answer is a
//! typed `ExtError`, never an agent's raw words. Codex's own commands exit 0 for something that was
//! never there, so a removal is checked against what is listed before and after.

mod cli;
mod preview;
mod read;
mod write;

use cli::Programs;
use maitty_shared::extensions::{ExtAdd, ExtError, ExtReply, ExtRequest, ExtensionList, checked_project};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// How long a preview's token can still be used.
const TOKEN_LIFETIME: Duration = Duration::from_secs(10 * 60);
/// The most previews kept at once; a new one beyond it drops the oldest.
const PREVIEWS_MAX: usize = 16;

/// Where the agents keep their files on this computer.
#[derive(Debug, Clone)]
struct Homes {
    pub claude_dir: PathBuf,
    /// Claude's user file with the user's MCP servers: `~/.claude.json`, or inside the config
    /// folder when `CLAUDE_CONFIG_DIR` says where that is.
    pub claude_json: PathBuf,
    pub codex_dir: PathBuf,
    /// Whether a command is told these folders. Off for the real ones, which the agents find
    /// by themselves; on where a test keeps its own.
    pub pin_env: bool,
}

impl Homes {
    fn real() -> Result<Homes, ExtError> {
        let home = directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf());
        let (claude_dir, claude_json) = match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|dir| !dir.is_empty()).map(PathBuf::from) {
            Some(dir) => (dir.clone(), dir.join(".claude.json")),
            None => {
                let home = home.clone().ok_or_else(|| ExtError::Failed("This computer's home folder is not known".into()))?;
                (home.join(".claude"), home.join(".claude.json"))
            }
        };
        let codex_dir = super::usage::codex_home().ok_or_else(|| ExtError::Failed("This computer's home folder is not known".into()))?;
        Ok(Homes { claude_dir, claude_json, codex_dir, pin_env: false })
    }
}

/// The adds a person was shown and has not yet confirmed.
#[derive(Default)]
struct Previews {
    kept: Mutex<HashMap<String, (Instant, ExtAdd)>>,
}

impl Previews {
    /// Keeps `add` and returns the token that runs it.
    fn keep(&self, add: ExtAdd) -> Result<String, ExtError> {
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|_| ExtError::Failed("No safe token could be made".into()))?;
        let token: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        let mut kept = self.kept.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        kept.retain(|_, (made, _)| now.duration_since(*made) < TOKEN_LIFETIME);
        if kept.len() >= PREVIEWS_MAX
            && let Some(oldest) = kept.iter().min_by_key(|(_, (made, _))| *made).map(|(token, _)| token.clone())
        {
            kept.remove(&oldest);
        }
        kept.insert(token.clone(), (now, add));
        Ok(token)
    }

    /// The add `token` was given for, which no token can be used for again.
    fn take(&self, token: &str) -> Result<ExtAdd, ExtError> {
        let mut kept = self.kept.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match kept.remove(token) {
            Some((made, add)) if made.elapsed() < TOKEN_LIFETIME => Ok(add),
            _ => Err(ExtError::NeedsConfirmation),
        }
    }
}

/// Everything a request needs; the daemon's own is `Env::real`.
struct Env<'a> {
    pub homes: Homes,
    pub programs: Programs,
    pub previews: &'a Previews,
}

/// Does `request` with this computer's real files, programs and previews. Blocks.
pub(super) fn answer(request: ExtRequest) -> Result<ExtReply, ExtError> {
    static PREVIEWS: OnceLock<Previews> = OnceLock::new();
    let env = Env { homes: Homes::real()?, programs: Programs::real(), previews: PREVIEWS.get_or_init(Previews::default) };
    perform(&env, request).map(ExtReply::cleaned).map_err(ExtError::cleaned)
}

fn perform(env: &Env, request: ExtRequest) -> Result<ExtReply, ExtError> {
    match request {
        ExtRequest::List { project } => {
            let project = project_folder(project.as_deref())?;
            Ok(ExtReply::List(read::list(&env.homes, project.as_deref())))
        }
        ExtRequest::PreviewAdd { add } => preview::of(env, add.checked()?).map(ExtReply::Preview),
        ExtRequest::Add { token } => {
            // The token is spent before anything runs, so a failed add is shown again, not retried.
            let add = env.previews.take(&token)?;
            write::add(env, add)
        }
        ExtRequest::SetEnabled { target, enabled } => write::set_enabled(env, target.checked()?, enabled),
        ExtRequest::Remove { target } => write::remove(env, target.checked()?),
    }
}

/// `project` as a folder that is there: `None` when none was asked about.
fn project_folder(project: Option<&str>) -> Result<Option<PathBuf>, ExtError> {
    let Some(project) = project else { return Ok(None) };
    let project = Path::new(checked_project(project)?);
    if !project.is_dir() {
        return Err(ExtError::Invalid("That project folder is not there".into()));
    }
    Ok(Some(project.to_path_buf()))
}

/// What is listed now, for a check before or after a change.
fn listed(env: &Env, project: Option<&Path>) -> ExtensionList {
    read::list(&env.homes, project)
}

#[cfg(test)]
mod tests;
