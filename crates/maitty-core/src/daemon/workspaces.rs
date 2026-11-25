//! The sessions that were open in a project when it was parked or closed, kept per project so they
//! can be opened again (`Command::SaveWorkspace`, `Query::Workspace`). Records are the fields of a
//! closed session: enough to resume the work, never a message or terminal output.
//!
//! The file is `workspaces-<socket>.json` in the data folder, private to the user, replaced
//! atomically, the project saved last first. It is read tolerantly like the closed sessions: a file
//! that can't be read is kept as `.bak` and the store starts empty, never stopping the daemon.

use super::closed_sessions::{cleaned, lock, write_latest};
use super::usage_store::set_aside;
use super::*;
use maitty_shared::protocol::{WORKSPACE_PROJECTS_MAX, WORKSPACE_SESSIONS_MAX};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The file format this build writes. A file with a higher number was written by a newer build
/// and is kept untouched as `.bak` rather than read wrongly.
const FORMAT_VERSION: u32 = 1;
const PATH_MAX_BYTES: usize = 4096;
const WHAT: &str = "saved workspaces";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Project {
    path: PathBuf,
    sessions: Vec<ClosedSession>,
}

/// The file as stored. Unknown fields are ignored and missing ones default, so a field can be
/// added without a version bump.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Stored {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    projects: Vec<Project>,
}

pub(super) struct Workspaces {
    path: Option<PathBuf>,
    /// The project saved last first.
    projects: Vec<Project>,
    /// The latest bytes not yet on disk. A writer takes them, so a slow write never overwrites a
    /// newer save with an older one.
    unsaved: Arc<Mutex<Option<Vec<u8>>>>,
    /// Held while the file is written, so two writes never share the temporary file.
    writing: Arc<Mutex<()>>,
}

impl Workspaces {
    /// A store that lives in memory only (tests, and daemons with no data folder).
    pub fn in_memory() -> Workspaces {
        Workspaces {
            path: None,
            projects: Vec::new(),
            unsaved: Arc::default(),
            writing: Arc::default(),
        }
    }

    /// Where this daemon keeps the store, named by socket so a nested daemon never shares it.
    pub fn default_path() -> PathBuf {
        let label =
            maitty_shared::brand::env_var("SOCKET").unwrap_or_else(|_| "default".into());
        crate::config::data_dir().join(format!("workspaces-{label}.json"))
    }

    /// Read the file at `path`, keeping it as the place to save. A missing file starts empty;
    /// one that can't be read is set aside as `.bak` and the store starts empty, saying why.
    pub fn open(path: PathBuf) -> Workspaces {
        let mut store = Workspaces::in_memory();
        match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Stored>(&text) {
                Ok(stored) if stored.version <= FORMAT_VERSION => store.fill(stored.projects),
                Ok(stored) => {
                    tracing::warn!(
                        "workspaces file {} is format {}, newer than this build reads \
                         ({FORMAT_VERSION}); keeping it as .bak and starting empty",
                        path.display(),
                        stored.version
                    );
                    set_aside(&path);
                }
                Err(error) => {
                    tracing::warn!(
                        "workspaces file {} can't be read ({error}); keeping it as .bak and \
                         starting empty",
                        path.display()
                    );
                    set_aside(&path);
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => tracing::warn!(
                "workspaces file {} can't be opened ({error}); starting empty",
                path.display()
            ),
        }
        store.path = Some(path);
        store
    }

    /// What was stored, checked as if it had just been saved: a hand-edited or damaged entry is
    /// dropped, never trusted. The file lists the project saved last first.
    fn fill(&mut self, stored: Vec<Project>) {
        for project in stored.into_iter().rev() {
            self.replace(project.path, project.sessions);
        }
    }

    /// The sessions kept for `project`, in the order they were saved; empty when none.
    pub fn get(&self, project: &Path) -> Vec<ClosedSession> {
        self.projects
            .iter()
            .find(|kept| kept.path == project)
            .map(|kept| kept.sessions.clone())
            .unwrap_or_default()
    }

    /// The record kept for the conversation `session` of `agent` in any project's set, from the
    /// project saved last first; None when no set holds it.
    pub fn find(&self, agent: &str, session: &str) -> Option<ClosedSession> {
        self.projects
            .iter()
            .flat_map(|kept| &kept.sessions)
            .find(|kept| kept.agent == agent && kept.session == session)
            .cloned()
    }

    /// Keep `sessions` as the set for `project`, replacing the one before, and save off the loop.
    /// An empty set (or one with nothing valid in it) forgets the project.
    pub fn save(&mut self, project: PathBuf, sessions: Vec<ClosedSession>) -> Result<()> {
        anyhow::ensure!(valid_path(&project), "the project folder is not an absolute path");
        self.replace(project, sessions);
        self.save_soon();
        Ok(())
    }

    fn replace(&mut self, path: PathBuf, sessions: Vec<ClosedSession>) {
        if !valid_path(&path) {
            return;
        }
        self.projects.retain(|kept| kept.path != path);
        let sessions = kept_sessions(sessions);
        if sessions.is_empty() {
            return;
        }
        self.projects.insert(0, Project { path, sessions });
        self.projects.truncate(WORKSPACE_PROJECTS_MAX);
    }

    fn save_soon(&self) {
        let Some(path) = self.path.clone() else {
            return;
        };
        let bytes = match self.to_bytes() {
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!("couldn't encode the {WHAT}: {error:#}");
                return;
            }
        };
        *lock(&self.unsaved) = Some(bytes);
        let (unsaved, writing) = (self.unsaved.clone(), self.writing.clone());
        tokio::task::spawn_blocking(move || write_latest(&path, &unsaved, &writing, WHAT));
    }

    /// Write what is not on disk yet, on the caller's thread, for when the daemon is about to exit.
    pub fn save_now(&self) {
        if let Some(path) = &self.path {
            write_latest(path, &self.unsaved, &self.writing, WHAT);
        }
    }

    fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(&Stored {
            version: FORMAT_VERSION,
            projects: self.projects.clone(),
        })?)
    }
}

/// An absolute path no longer than a path can be and with no control character in it: a client's
/// word for a folder, never one to keep or print as it came.
fn valid_path(path: &Path) -> bool {
    path.is_absolute()
        && path.as_os_str().len() <= PATH_MAX_BYTES
        && path.to_str().is_some_and(|text| !text.chars().any(char::is_control))
}

/// `sessions` as they may be kept: each cleaned like a closed session, with an absolute folder, one
/// entry per conversation (the first), and at most `WORKSPACE_SESSIONS_MAX`. When there are more,
/// the oldest by `at` go and the order sent is kept.
fn kept_sessions(sessions: Vec<ClosedSession>) -> Vec<ClosedSession> {
    let mut kept: Vec<ClosedSession> = Vec::new();
    for session in sessions.into_iter().filter(|session| valid_path(&session.cwd)) {
        let Some(session) = cleaned(session) else {
            continue;
        };
        if !kept.iter().any(|k| k.agent == session.agent && k.session == session.session) {
            kept.push(session);
        }
    }
    if kept.len() > WORKSPACE_SESSIONS_MAX {
        let mut newest: Vec<usize> = (0..kept.len()).collect();
        newest.sort_by_key(|&index| std::cmp::Reverse(kept[index].at));
        newest.truncate(WORKSPACE_SESSIONS_MAX);
        newest.sort_unstable();
        kept = newest.into_iter().map(|index| kept[index].clone()).collect();
    }
    kept
}

#[cfg(test)]
#[path = "workspaces_tests.rs"]
mod tests;
