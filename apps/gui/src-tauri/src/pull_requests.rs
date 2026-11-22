//! A project's open pull requests for the window. The daemon of the machine the project is on is
//! asked, this computer's or another's, because `gh` and its sign-in live there; the host never
//! runs `gh` for this and reads no token. What comes back from another machine is cleaned first
//! (`remote_policy::vet_pull_requests_reply`).

use maitty_shared::protocol::{GitHubAnswer, ProjectPulls, PullRequestList};
use serde::Serialize;

/// The longest folder that is passed on, in bytes; the daemon judges the rest.
const MOST_FOLDER_BYTES: usize = 4096;

/// What a machine said of a project's pull requests, as the window reads it: `state` is `listed`,
/// `not-installed`, `not-signed-in`, `not-on-github` or `failed`; `listed` is set for `listed` and
/// `why` for `failed`.
#[derive(Serialize, Debug, PartialEq)]
pub struct PullRequestsOut {
    state: &'static str,
    why: Option<String>,
    listed: Option<PullRequestList>,
}

fn out(answer: GitHubAnswer<ProjectPulls>) -> PullRequestsOut {
    let (state, why, listed) = match answer {
        GitHubAnswer::Listed(ProjectPulls::Open(list)) => ("listed", None, Some(list)),
        GitHubAnswer::Listed(ProjectPulls::NotOnGitHub) => ("not-on-github", None, None),
        GitHubAnswer::NotInstalled => ("not-installed", None, None),
        GitHubAnswer::NotSignedIn => ("not-signed-in", None, None),
        GitHubAnswer::Failed(why) => ("failed", Some(why), None),
    };
    PullRequestsOut { state, why, listed }
}

/// A folder as a request can carry one. The daemon decides whether it is a folder it will read.
fn sendable(folder: &str) -> Result<(), String> {
    if folder.trim().is_empty() || folder.len() > MOST_FOLDER_BYTES || folder.chars().any(char::is_control) {
        return Err("That folder cannot be sent".to_string());
    }
    Ok(())
}

/// The open pull requests of the repository `folder` is in, on `machine` (this computer when left
/// out), and which of them wait for the account signed in there. `fresh` asks past the list the
/// daemon keeps for a minute.
#[tauri::command]
pub async fn pull_requests(
    app: tauri::AppHandle,
    wire: tauri::State<'_, crate::terminal_stream::Wire>,
    machine: Option<u16>,
    folder: String,
    fresh: bool,
) -> Result<PullRequestsOut, String> {
    sendable(&folder)?;
    let daemon = wire.pull_requests_daemon(machine, || crate::daemon_executable(&app))?;
    maitty_desktop_client::pull_requests(folder, fresh, daemon)
        .await
        .map(out)
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_answer_reaches_the_window_as_one_flat_state() {
        let state = |answer| out(answer).state;
        assert_eq!(state(GitHubAnswer::NotInstalled), "not-installed");
        assert_eq!(state(GitHubAnswer::NotSignedIn), "not-signed-in");
        assert_eq!(state(GitHubAnswer::Listed(ProjectPulls::NotOnGitHub)), "not-on-github");
        assert_eq!(out(GitHubAnswer::Failed("no network".into())), PullRequestsOut { state: "failed", why: Some("no network".into()), listed: None });

        let list = PullRequestList { login: "me".into(), items: Vec::new(), more: true };
        let said = serde_json::to_value(out(GitHubAnswer::Listed(ProjectPulls::Open(list)))).unwrap();
        assert_eq!(said, serde_json::json!({ "state": "listed", "why": null, "listed": { "login": "me", "items": [], "more": true } }));
    }

    #[test]
    fn a_folder_that_could_not_be_a_request_is_refused_before_anything_is_asked() {
        assert!(sendable("~/code/app").is_ok());
        assert!(sendable("C:\\code\\app").is_ok());
        for not in ["", "  ", "/code/a\nb", "/code/\u{1b}[31m", &"a".repeat(MOST_FOLDER_BYTES + 1)] {
            assert!(sendable(not).is_err(), "{not:?}");
        }
    }
}
