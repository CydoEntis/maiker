//! What a turn's failure leaves on a conversation: the next turn that starts, or ends well, takes
//! it away, and a problem that outlives turns (a history that cannot be read) stays through both.

use super::*;
use crate::protocol::Status;

/// Codex's own turn events, as its app-server sends them for one thread.
fn turn(thread: &str, method: &str, id: &str, status: &str, error: Option<&str>) -> Payload {
    let error = error.map_or(serde_json::Value::Null, |message| json!({ "message": message }));
    Payload::Notification {
        method: method.into(),
        params: json!({"threadId": thread, "turn": {"id": id, "status": status, "items": [], "error": error}}),
    }
}

fn provider_error(thread: &str, turn: &str, message: &str, will_retry: bool) -> Payload {
    Payload::Notification {
        method: "error".into(),
        params: json!({"threadId": thread, "turnId": turn, "willRetry": will_retry, "error": {"message": message}}),
    }
}

#[tokio::test]
async fn a_turn_that_starts_or_ends_well_clears_the_last_turns_error_but_not_an_unreadable_history() {
    with_fixture(move |session| {
        Box::pin(async move {
            let TestSession { fixture: f, daemon: d, events: rx } = session;
            d.start_conversation(f.launch("normal")).unwrap();
            let ready = next(rx).await;
            let owner = ready.owner;
            d.handle(Ev::Conversation(ready));
            d.handle(Ev::Conversation(next(rx).await));
            let id = f.record.id;
            let thread = f.record.binding.session_id.clone();
            let report = |d: &mut Daemon, payload: Payload| d.handle(Ev::Conversation(Event { owner, payload }));
            let seen = |d: &Daemon| {
                let state = &d.conversation_states[&id];
                (state.effective_status(), state.shown_error().map(str::to_owned))
            };

            // The first turn fails with its reason.
            report(d, turn(&thread, "turn/started", "turn-a", "inProgress", None));
            report(d, provider_error(&thread, "turn-a", "Synthetic provider failure", false));
            report(d, turn(&thread, "turn/completed", "turn-a", "failed", Some("Model not found")));
            assert_eq!(seen(d), (Status::Blocked, Some("Model not found".into())));

            // The next one starting takes it away, and ending well leaves the chat done.
            report(d, turn(&thread, "turn/started", "turn-b", "inProgress", None));
            assert_eq!(seen(d), (Status::Working, None), "a turn under way is past the last one's failure");
            report(d, turn(&thread, "turn/completed", "turn-b", "completed", None));
            assert_eq!(d.conversation_states[&id].status, Status::Done);
            assert_eq!(d.conversation_states[&id].shown_error(), None);

            // A problem the provider got past within the turn goes when the turn ends well.
            report(d, turn(&thread, "turn/started", "turn-c", "inProgress", None));
            report(d, provider_error(&thread, "turn-c", "Reconnecting... 1/5", true));
            assert_eq!(seen(d), (Status::Blocked, Some("Reconnecting... 1/5".into())));
            report(d, turn(&thread, "turn/completed", "turn-c", "completed", None));
            assert_eq!(d.conversation_states[&id].status, Status::Done);
            assert_eq!(d.conversation_states[&id].shown_error(), None);

            // A history that cannot be read outlives the turns around it, failed or not.
            report(d, turn(&thread, "turn/started", "turn-d", "inProgress", None));
            report(d, Payload::Notification {
                method: "item/completed".into(),
                params: json!({"threadId": thread, "turnId": "turn-d", "item": {"type": "somethingNew", "id": "x"}}),
            });
            let unreadable = d.conversation_states[&id].shown_error().map(str::to_owned);
            assert!(unreadable.as_deref().is_some_and(|error| error.contains("history is incomplete")), "{unreadable:?}");
            report(d, turn(&thread, "turn/completed", "turn-d", "failed", Some("Model not found")));
            assert_eq!(seen(d), (Status::Blocked, unreadable.clone()), "the lasting problem is the one shown");
            report(d, turn(&thread, "turn/started", "turn-e", "inProgress", None));
            report(d, turn(&thread, "turn/completed", "turn-e", "completed", None));
            let state = &d.conversation_states[&id];
            assert_eq!((state.effective_status(), state.shown_error().map(str::to_owned)), (Status::Blocked, unreadable));
            assert!(!state.history_ready);

            d.dispose_conversation(id).unwrap();
            d.handle(Ev::Conversation(next(rx).await));
            stopped(f.pids().await).await;
        })
    })
    .await;
}
