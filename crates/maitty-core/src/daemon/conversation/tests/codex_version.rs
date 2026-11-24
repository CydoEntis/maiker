//! A Codex chat is gated on what the installed app-server declares, not on its version number.

use super::*;
use crate::conversation::capabilities::Verified;
use crate::protocol::{ClientMsg, Command, Reply};

async fn start_codex_as(session: &mut TestSession, client: u64, version: &str) -> ServerMsg {
    let root = session.fixture.directory.path().to_path_buf();
    let version = version.to_owned();
    tokio::task::spawn_blocking(move || std::fs::write(root.join("codex-version"), version).unwrap())
        .await
        .unwrap();
    let target = crate::conversation::StartTarget::Create(settings(session));
    exchange(session, client, ClientMsg::Command(Command::ConversationStart { target, branch: None }), None).await
}

#[tokio::test]
async fn a_codex_version_no_one_listed_starts_a_chat_and_is_tagged_untested() {
    let mut session = conversation_fixture("conversation-newer-codex").await;
    let outcome = AssertUnwindSafe(async {
        let started = start_codex_as(&mut session, 500, "9.9.9").await;
        let ServerMsg::Reply(Reply::ConversationStarted { id, .. }) = started else {
            panic!("{started:?}");
        };
        let summaries = session.daemon.conversation_summaries();
        let capabilities = summaries.iter().find(|summary| summary.id == id).unwrap().capabilities.as_ref().unwrap();
        assert_eq!(capabilities.verified, Verified::Advertised);
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_listed_codex_version_stays_tagged_pinned() {
    let mut session = conversation_fixture("conversation-listed-codex").await;
    let outcome = AssertUnwindSafe(async {
        let started = start_codex_as(&mut session, 505, "0.164.0").await;
        let ServerMsg::Reply(Reply::ConversationStarted { id, .. }) = started else {
            panic!("{started:?}");
        };
        let summaries = session.daemon.conversation_summaries();
        let capabilities = summaries.iter().find(|summary| summary.id == id).unwrap().capabilities.as_ref().unwrap();
        assert_eq!(capabilities.verified, Verified::Pinned);
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_codex_missing_a_needed_method_is_refused_by_name_and_leaves_no_chat_behind() {
    let mut session = conversation_fixture("conversation-old-codex").await;
    let outcome = AssertUnwindSafe(async {
        let root = session.fixture.directory.path().to_path_buf();
        tokio::task::spawn_blocking(move || {
            let path = root.join("ClientRequest.json");
            let mut requests: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            requests["oneOf"].as_array_mut().unwrap().retain(|variant| {
                variant["properties"]["method"]["enum"] != serde_json::json!(["turn/interrupt"])
            });
            std::fs::write(path, requests.to_string()).unwrap();
        })
        .await
        .unwrap();
        let before = session.daemon.conversation_summaries().len();
        let refused = start_codex_as(&mut session, 510, "9.9.9").await;
        assert!(
            matches!(refused, ServerMsg::Error(ref why) if why.contains("Codex 9.9.9") && why.contains("turn/interrupt") && why.contains("Update Codex")),
            "{refused:?}"
        );
        assert!(session.daemon.pending_starts.is_empty());
        assert_eq!(session.daemon.conversation_summaries().len(), before, "no blocked row is left in the sidebar");
    })
    .catch_unwind()
    .await;
    session.cleanup().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
