//! Tickets in the side panel: what is asked of this computer's daemon, every state it draws, that
//! links are the daemon's (set up in place, once per project), and that nothing is written or sent
//! without its review and `y`.
//! `MAITTY_SHOW=1 cargo test tickets_tests -- --nocapture` prints the frames.

use super::*;
use crate::client::Outgoing;
use crate::client::reference_fixture::{Layout, Stage, raw_text, world};
use crate::protocol::{Reply, ServerMsg};
use maitty_shared::ticket_links::{GitHubLink, LinkedProject, TicketLinkChange, TicketLinks, TicketMe as DaemonMe, TicketPick};
use maitty_shared::tickets::{Group, GroupKind, Ticket, TicketComment, TicketPage, TicketState};
use tokio::sync::mpsc;

const SHOP: &str = "/home/me/shop";

/// Tickets opened on the shop project, the daemon answering that it reads `link`.
fn opened_with(link: TicketLink) -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let (mut app, mut rx) = opened();
    // The test's folder is no repository: it has no origin.
    app.with_tickets(|_, v| v.origin = Some(None));
    let msgs = sent(&mut rx);
    let tag = links_tag(&msgs);
    links_reply(&mut app, tag, Ok(links_of(&link)));
    // What was asked before the answer (the keys) stays to be read.
    for m in msgs.into_iter().filter(|m| !matches!(m, ClientMsg::Query(Query::TicketLinks { .. }))) {
        let _ = app.out.send(Outgoing { machine: MachineId::LOCAL, msg: m });
    }
    (app, rx)
}

fn links_of(link: &TicketLink) -> TicketLinks {
    let here = LinkedProject { machine: None, folder: SHOP.into(), link: link.to_daemon() };
    let projects = if link.to_daemon().is_empty() { Vec::new() } else { vec![here.clone()] };
    TicketLinks { project: Some(here), projects, me: DaemonMe::default(), repo_file: None }
}

fn links_tag(msgs: &[ClientMsg]) -> u64 {
    msgs.iter()
        .find_map(|m| match m {
            ClientMsg::Query(Query::TicketLinks { tag, .. }) => Some(*tag),
            _ => None,
        })
        .expect("the links were asked for")
}

fn links_reply(app: &mut App, tag: u64, answer: Result<TicketLinks, TicketError>) {
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::TicketLinks { tag, answer }));
}

fn keys_reply(app: &mut App, tag: u64, keys: Vec<TicketKeyState>) {
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::TicketKeys { tag, answer: Ok(keys) }));
}

/// Tickets opened on the shop project, nothing answered yet.
fn opened() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    let term = app.selected_term().expect("a session in front");
    let root = PathBuf::from("/home/me/shop");
    if let Some(info) = app.snap.terms.get_mut(&term.term) {
        info.root = Some(root.clone());
        info.top = Some(root.clone());
        info.cwd = root;
        info.agent = Some("claude".into());
    }
    app.act(Action::Tickets);
    (app, rx)
}

fn github() -> TicketLink {
    TicketLink { github: Some("me/shop".into()), ..TicketLink::default() }
}

fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<ClientMsg> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|o| {
            assert_eq!(o.machine, MachineId::LOCAL, "tickets go to this computer's daemon");
            o.msg
        })
        .collect()
}

fn tag_of(msgs: &[ClientMsg], want: impl Fn(&Query) -> bool) -> u64 {
    msgs.iter()
        .find_map(|m| match m {
            ClientMsg::Query(q) if want(q) => Some(match q {
                Query::Tickets { tag, .. } | Query::TicketKeys { tag, .. } | Query::TicketWrite { tag, .. } | Query::TicketLinks { tag, .. } => *tag,
                _ => 0,
            }),
            _ => None,
        })
        .expect("the request was sent")
}

fn frame_at(app: &mut App, title: &str, w: u16, h: u16) -> String {
    let text = raw_text(app, Layout::Floating, w, h, "unicode");
    if std::env::var(concat!(env!("APP_ENV"), "_SHOW")).is_ok() {
        println!("---- {title} ({w}x{h})\n{text}");
    }
    text
}

fn frame(app: &mut App, title: &str) -> String {
    frame_at(app, title, 120, 32)
}

fn key(app: &mut App, code: KeyCode) {
    app.on_view_key(&KeyEvent::new(code, KeyModifiers::NONE));
}

fn typed(app: &mut App, text: &str) {
    for c in text.chars() {
        key(app, KeyCode::Char(c));
    }
}

fn summary(n: u64, title: &str, category: StateCategory) -> TicketSummary {
    TicketSummary {
        id: format!("github:me/shop#{n}"),
        title: title.into(),
        state: TicketState { name: String::new(), category },
        labels: vec!["bug".into()],
        assignee: Some("cydo".into()),
        url: format!("https://github.com/me/shop/issues/{n}"),
        groups: Vec::new(),
        updated_at: "2026-11-14T09:30:00Z".into(),
    }
}

fn list_reply(app: &mut App, tag: u64, tickets: Vec<TicketSummary>) {
    app.on_machine_server(
        MachineId::LOCAL,
        ServerMsg::Reply(Reply::Tickets { tag, answer: Ok(TicketsReply::List(TicketPage { tickets, more: false })) }),
    );
}

fn reply(app: &mut App, tag: u64, answer: Result<TicketsReply, TicketError>) {
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::Tickets { tag, answer }));
}

fn list_tag(msgs: &[ClientMsg]) -> u64 {
    tag_of(msgs, |q| matches!(q, Query::Tickets { request: TicketsRequest::List(_), .. }))
}

/// Tickets open on a list of three, the first selected.
fn with_list() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let (mut app, mut rx) = opened_with(github());
    let tag = list_tag(&sent(&mut rx));
    list_reply(
        &mut app,
        tag,
        vec![
            summary(142, "Login breaks on \u{1b}[31mred\u{1b}[0m Safari", StateCategory::Open),
            summary(7, "Cart total rounds wrong", StateCategory::Started),
            summary(3, "Old crash", StateCategory::Closed),
        ],
    );
    (app, rx)
}

fn ticket(body: &str) -> Ticket {
    Ticket {
        summary: summary(142, "Login breaks on Safari", StateCategory::Open),
        body: body.into(),
        comments: vec![TicketComment { author: "ana".into(), body: "Seen it too".into(), created_at: "2026-11-14T10:00:00Z".into() }],
        comments_more: false,
        links: Vec::new(),
        blocked_by: vec!["github:me/shop#7".into()],
    }
}

/// The first ticket opened and read whole.
fn on_ticket() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let (mut app, mut rx) = with_list();
    key(&mut app, KeyCode::Enter);
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::Tickets { request: TicketsRequest::Get { .. }, .. }));
    reply(&mut app, tag, Ok(TicketsReply::Ticket(Box::new(ticket("Steps:\n1. open\n\u{1b}]52;c;ZXZpbA==\u{7}2. log in")))));
    (app, rx)
}

#[test]
fn the_tickets_key_asks_this_computer_for_the_keys_and_the_linked_repos_list() {
    let (mut app, mut rx) = opened_with(github());
    let msgs = sent(&mut rx);
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketKeys { change: TicketKeyChange::Status, .. }))));
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::Tickets { source, request: TicketsRequest::List(f), .. }) if source == "me/shop" && f.page == 0)));
    let shown = frame(&mut app, "reading");
    assert!(shown.contains("tickets") && shown.contains("reading tickets…"), "{shown}");
    assert!(shown.contains("GitHub") && shown.contains("Plane") && shown.contains("Linear"));
}

#[test]
fn the_list_shows_open_tickets_as_plain_text_and_hides_closed_ones() {
    let (mut app, _rx) = with_list();
    let shown = frame(&mut app, "list");
    assert!(shown.contains("#142") && shown.contains("Login breaks on [31mred[0m Safari"), "{shown}");
    assert!(!shown.contains('\u{1b}'), "a ticket's escape never reaches the terminal");
    assert!(shown.contains("#7") && !shown.contains("Old crash"));
    assert!(shown.contains("1 closed hidden"));
    key(&mut app, KeyCode::Char('a'));
    assert!(frame(&mut app, "with closed").contains("Old crash"));
    frame_at(&mut app, "list at 80x24", 80, 24);
}

#[test]
fn typed_search_narrows_at_once_and_enter_asks_the_provider() {
    let (mut app, mut rx) = with_list();
    key(&mut app, KeyCode::Char('/'));
    typed(&mut app, "zzz");
    let shown = frame(&mut app, "no match");
    assert!(shown.contains("Nothing matches “zzz”"), "{shown}");
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::Tickets { request: TicketsRequest::List(f), .. }) if f.search.as_deref() == Some("zzz"))));
    key(&mut app, KeyCode::Esc);
    assert!(app.view.is_some(), "the first Esc clears the search, not the view");
    key(&mut app, KeyCode::Esc);
    assert!(app.view.is_none(), "the next one closes it");
}

#[test]
fn each_failure_says_what_to_do() {
    for (e, words) in [
        (TicketError::SignedOut, "GitHub is not signed in"),
        (TicketError::RateLimited, "too many requests"),
        (TicketError::Unreachable("no network".into()), "Couldn't reach GitHub: no network"),
        (TicketError::NotFound, "has no such project"),
    ] {
        let (mut app, mut rx) = opened_with(github());
        let tag = list_tag(&sent(&mut rx));
        reply(&mut app, tag, Err(e.clone()));
        let shown = frame(&mut app, &format!("{e:?}"));
        assert!(shown.contains(words), "{e:?}: {shown}");
        if e == TicketError::SignedOut {
            assert!(shown.contains("gh auth login"));
        }
    }
}

#[test]
fn offline_keeps_the_list_read_last_with_a_line_under_it() {
    let (mut app, mut rx) = with_list();
    key(&mut app, KeyCode::Char('r'));
    let tag = list_tag(&sent(&mut rx));
    reply(&mut app, tag, Err(TicketError::Unreachable("no network".into())));
    let shown = frame(&mut app, "offline");
    assert!(shown.contains("#142") && shown.contains("showing what was read"), "{shown}");
}

#[test]
fn the_links_are_asked_of_the_daemon_for_the_folder_in_front() {
    let (mut app, mut rx) = opened();
    let msgs = sent(&mut rx);
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { place: Some(place), change: TicketLinkChange::Read, .. }) if place.machine.is_none() && place.folder == SHOP)));
    assert!(!msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::Tickets { .. }))), "nothing is read before the links are known");
    assert!(frame(&mut app, "links unread").contains("reading…"));
}

#[test]
fn links_this_window_kept_move_to_the_daemon_once() {
    let mut app = world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    // `project_key` of /home/me/blog on this computer.
    let key = "\\home\\me\\blog".to_string();
    app.screen.saved.ticket_links.insert(key, TicketLink { github: Some(String::new()), linear: Some(Picked { id: "linear:team.1".into(), name: "Core".into() }), plane: None });
    app.screen.saved.ticket_me.set(Provider::Linear, "Ada");
    app.screen.saved.ticket_me.set(Provider::Github, "ada-gh");
    app.act(Action::Tickets);
    let msgs = sent(&mut rx);
    let Some(ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Import { projects, me }, tag, .. })) = msgs.iter().find(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { .. }))) else {
        panic!("the saved links go with the first question: {msgs:?}");
    };
    assert_eq!(projects.len(), 1);
    assert_eq!((projects[0].machine.as_deref(), projects[0].folder.as_str()), (None, "/home/me/blog"));
    assert_eq!(projects[0].link.github, GitHubLink::Off);
    assert_eq!(me.linear, "Ada");
    links_reply(&mut app, *tag, Ok(TicketLinks::default()));
    assert!(app.screen.saved.ticket_links.is_empty(), "the daemon has them now");
    assert_eq!((app.screen.saved.ticket_me.linear.as_str(), app.screen.saved.ticket_me.github.as_str()), ("", "ada-gh"));
    app.view = None;
    app.act(Action::Tickets);
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Read, .. }))), "and are not sent twice");
}

#[test]
fn an_unlinked_source_is_set_up_from_its_own_tab() {
    let (mut app, mut rx) = opened_with(TicketLink { github: Some(String::new()), ..TicketLink::default() });
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketKeys { .. }));
    keys_reply(&mut app, tag, Vec::new());
    let shown = frame(&mut app, "github off");
    assert!(shown.contains("Set up GitHub for shop") && shown.contains("GitHub is off for shop"), "{shown}");
    key(&mut app, KeyCode::Right);
    let shown = frame(&mut app, "plane, no key");
    assert!(shown.contains("Connect Plane") && shown.contains("Pick the Plane project for shop") && shown.contains("once on this computer"), "{shown}");
    key(&mut app, KeyCode::Enter);
    let shown = frame(&mut app, "setup paste step");
    assert!(shown.contains("Paste a link to your Plane project") && shown.contains("Tab enters the details instead"), "{shown}");
    // The details typed by hand instead of a link.
    key(&mut app, KeyCode::Tab);
    typed(&mut app, "https://plane.example");
    key(&mut app, KeyCode::Tab);
    typed(&mut app, "acme");
    key(&mut app, KeyCode::Tab);
    assert!(app.paste_into_tickets("plane_api_SECRET123"));
    let shown = frame(&mut app, "setup key form");
    assert!(shown.contains("Set up Plane for shop") && !shown.contains("SECRET123"), "{shown}");
    key(&mut app, KeyCode::Enter);
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketKeys { change: TicketKeyChange::Set { .. }, .. }));
    let state = TicketKeyState { provider: TicketProvider::Plane, set: true, address: "https://plane.example".into(), workspace: "acme".into(), stored_in: maitty_shared::tickets::KeyStorage::File };
    keys_reply(&mut app, tag, vec![state]);
    // Connected: the groups are read and picked from, in place.
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::Tickets { request: TicketsRequest::Groups, .. }));
    let group = |id: &str, name: &str| Group { id: id.into(), name: name.into(), kind: GroupKind::Project, parent: None, ticket_count: None };
    reply(&mut app, tag, Ok(TicketsReply::Groups(vec![group("plane:p1", "Acme"), group("plane:p2", "Web")])));
    let shown = frame(&mut app, "setup pick");
    assert!(shown.contains("Pick the Plane project for shop") && shown.contains("Web") && shown.contains("every worktree"), "{shown}");
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Enter);
    let msgs = sent(&mut rx);
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { place, link }, .. }) if place.folder == SHOP && link.plane == Some(TicketPick { id: "plane:p2".into(), name: "Web".into() }) && link.github == GitHubLink::Off)));
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::Tickets { source, request: TicketsRequest::List(f), .. }) if source == "plane" && f.group.as_deref() == Some("plane:p2"))), "and its tickets are read at once");
    assert!(frame(&mut app, "set up").contains("reading tickets…"));
}

#[test]
fn github_without_an_origin_asks_for_the_repository() {
    let (mut app, mut rx) = opened_with(TicketLink::default());
    sent(&mut rx);
    let shown = frame(&mut app, "github, no origin");
    assert!(shown.contains("Which repository are shop's issues in?"), "{shown}");
    key(&mut app, KeyCode::Enter);
    key(&mut app, KeyCode::Tab);
    typed(&mut app, "me/shop");
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { link, .. }, .. }) if link.github == GitHubLink::Repo("me/shop".into()))));
    assert!(frame(&mut app, "repo set").contains("reading tickets…"));
}

#[test]
fn a_pasted_github_link_sets_the_repository() {
    let (mut app, mut rx) = opened_with(TicketLink::default());
    sent(&mut rx);
    key(&mut app, KeyCode::Enter);
    assert!(app.paste_into_tickets("https://github.com/me/shop/issues/3"));
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { link, .. }, .. }) if link.github == GitHubLink::Repo("me/shop".into()))));
}

#[test]
fn a_link_for_another_source_says_which_tab_it_goes_on() {
    let (mut app, mut rx) = opened_with(TicketLink::default());
    sent(&mut rx);
    key(&mut app, KeyCode::Enter);
    typed(&mut app, "https://linear.app/acme/team/ENG");
    key(&mut app, KeyCode::Enter);
    let shown = frame(&mut app, "wrong tab");
    assert!(shown.contains("That is a Linear link: paste it on the Linear tab"), "{shown}");
    assert!(!sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { .. }, .. }))));
}

#[test]
fn a_pasted_plane_link_fills_the_key_form_and_lands_on_its_project() {
    const ID: &str = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    let (mut app, mut rx) = opened_with(TicketLink { github: Some(String::new()), ..TicketLink::default() });
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketKeys { .. }));
    keys_reply(&mut app, tag, Vec::new());
    key(&mut app, KeyCode::Right);
    // A link pasted on the setup screen opens the setup with it.
    assert!(app.paste_into_tickets(&format!("http://192.168.1.244/ideayard/projects/{ID}/issues/")));
    key(&mut app, KeyCode::Enter);
    // Only the key is left: the address and workspace came from the link.
    assert!(app.paste_into_tickets("plane_api_SECRET123"));
    let shown = frame(&mut app, "key form from link");
    assert!(shown.contains("192.168.1.244") && shown.contains("ideayard") && !shown.contains("SECRET123"), "{shown}");
    key(&mut app, KeyCode::Enter);
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketKeys { change: TicketKeyChange::Set { address, workspace, .. }, .. } if address == "http://192.168.1.244" && workspace == "ideayard"));
    let state = TicketKeyState { provider: TicketProvider::Plane, set: true, address: "http://192.168.1.244".into(), workspace: "ideayard".into() };
    keys_reply(&mut app, tag, vec![state]);
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::Tickets { request: TicketsRequest::Groups, .. }));
    let group = |id: &str, name: &str| Group { id: id.into(), name: name.into(), kind: GroupKind::Project, parent: None, ticket_count: None };
    reply(&mut app, tag, Ok(TicketsReply::Groups(vec![group("plane:00000000-0000-4000-8000-000000000000", "Other"), group(&format!("plane:{ID}"), "MAITTY")])));
    let shown = frame(&mut app, "aimed pick");
    assert!(shown.contains("The link names MAITTY: Enter links it"), "{shown}");
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { link, .. }, .. }) if link.plane.as_ref().is_some_and(|p| p.name == "MAITTY"))));
}

#[test]
fn sources_lists_the_accounts_then_every_linked_project() {
    let (mut app, mut rx) = opened();
    let tag = links_tag(&sent(&mut rx));
    let here = LinkedProject { machine: None, folder: SHOP.into(), link: github().to_daemon() };
    let blog = LinkedProject { machine: Some("kingdom".into()), folder: "/srv/blog".into(), link: maitty_shared::ticket_links::TicketLink { linear: Some(TicketPick { id: "linear:team.1".into(), name: "Core".into() }), ..Default::default() } };
    links_reply(&mut app, tag, Ok(TicketLinks { project: Some(here.clone()), projects: vec![blog, here], me: DaemonMe { plane: String::new(), linear: "Ada".into() }, repo_file: None }));
    key(&mut app, KeyCode::Char(','));
    let shown = frame_at(&mut app, "sources", 120, 40);
    assert!(shown.contains("ACCOUNTS") && shown.contains("LINKED PROJECTS"), "{shown}");
    assert!(shown.contains("Ada") && shown.contains("me/shop"));
    assert!(shown.contains("blog       kingdom · /srv/blog · GitHub from origin"), "{shown}");
    // The last row is the other project: x unlinks it.
    key(&mut app, KeyCode::End);
    key(&mut app, KeyCode::Char('x'));
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Unlink { place }, .. }) if place.machine.as_deref() == Some("kingdom") && place.folder == "/srv/blog")));
}

#[test]
fn an_older_daemon_reads_github_from_the_origin_and_says_why_nothing_else_links() {
    let (mut app, mut rx) = opened_with_protocol(TICKET_LINKS_SINCE - 1);
    let msgs = sent(&mut rx);
    assert!(!msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { .. }))), "an older daemon is not asked");
    let tag = tag_of(&msgs, |q| matches!(q, Query::TicketKeys { .. }));
    keys_reply(&mut app, tag, Vec::new());
    app.with_tickets(|app, v| {
        v.origin = Some(None);
        app.tickets_reload(v);
    });
    let shown = frame(&mut app, "old daemon, no links");
    assert!(shown.contains("older than ticket") && shown.contains("Restart it"), "{shown}");
}

#[test]
fn an_agents_ask_opens_the_setup_on_its_source_with_its_link_as_text() {
    use maitty_shared::ticket_links::{TicketSetupAsk, TicketSetupSource};
    let mut app = world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    let term = app.selected_term().expect("a session in front");
    if let Some(info) = app.snap.terms.get_mut(&term.term) {
        info.root = Some(PathBuf::from(SHOP));
        info.top = Some(PathBuf::from(SHOP));
        info.cwd = PathBuf::from(SHOP);
    }
    let link = "https://plane.example/acme/projects/p1/issues/";
    let ask = TicketSetupAsk { term: term.term, folder: SHOP.into(), source: Some(TicketSetupSource::Plane), link: link.into() };
    app.on_machine_server(MachineId::LOCAL, ServerMsg::TicketSetup(ask.clone()));
    app.with_tickets(|_, v| v.origin = Some(None));
    let msgs = sent(&mut rx);
    links_reply(&mut app, links_tag(&msgs), Ok(links_of(&TicketLink::default())));
    keys_reply(&mut app, tag_of(&msgs, |q| matches!(q, Query::TicketKeys { .. })), Vec::new());
    let shown = frame(&mut app, "agent opened plane setup");
    assert!(shown.contains("Set up Plane for shop") && shown.contains("Your agent suggests") && shown.contains("plane.example/acme"), "{shown}");
    assert!(!sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketLinks { change: TicketLinkChange::Set { .. }, .. }) | ClientMsg::Query(Query::TicketKeys { change: TicketKeyChange::Set { .. }, .. }))), "nothing is saved on an agent's word");
    // Another machine's agent opens nothing here.
    app.view = None;
    app.on_machine_server(MachineId(3), ServerMsg::TicketSetup(ask));
    assert!(app.view.is_none());
}

#[test]
fn sources_say_which_part_came_from_the_repository_file() {
    use maitty_shared::ticket_links::RepoTicketFile;
    let (mut app, mut rx) = opened();
    let tag = links_tag(&sent(&mut rx));
    let here = LinkedProject { machine: None, folder: SHOP.into(), link: github().to_daemon() };
    let file = RepoTicketFile { github: true, notes: vec!["It names a Plane at https://p.example, workspace acme, not the one your key is for, so it is not used".into()], ..RepoTicketFile::default() };
    links_reply(&mut app, tag, Ok(TicketLinks { project: Some(here), projects: Vec::new(), me: DaemonMe::default(), repo_file: Some(file) }));
    key(&mut app, KeyCode::Char(','));
    let shown = frame_at(&mut app, "sources from file", 160, 40);
    assert!(shown.contains("me/shop (from .maitty/tickets.toml)") && shown.contains("not the one your key is for"), "{shown}");
}

fn opened_with_protocol(protocol: u32) -> (App, mpsc::UnboundedReceiver<Outgoing>) {
    let mut app = world(Stage::None);
    let (tx, rx) = mpsc::unbounded_channel();
    app.out = tx;
    app.local_protocol = protocol;
    app.act(Action::Tickets);
    (app, rx)
}

#[test]
fn a_ticket_page_is_plain_text_with_its_blocker_and_comments() {
    let (mut app, _rx) = on_ticket();
    let shown = frame(&mut app, "ticket");
    assert!(shown.contains("Login breaks on Safari") && shown.contains("blocked by") && shown.contains("#7"), "{shown}");
    assert!(shown.contains("comments 1") && shown.contains("Seen it too"));
    assert!(!shown.contains('\u{1b}') && !shown.contains('\u{7}'), "an OSC 52 in a body never reaches the terminal");
    frame_at(&mut app, "ticket at 80x24", 80, 24);
}

#[test]
fn starting_an_agent_shows_what_is_sent_and_only_y_starts_it() {
    let (mut app, mut rx) = on_ticket();
    sent(&mut rx);
    key(&mut app, KeyCode::Char('s'));
    let shown = frame(&mut app, "start");
    assert!(shown.contains("Exactly what will be sent") && shown.contains("> Steps:"), "{shown}");
    assert!(shown.contains("Blocked by #7"));
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).is_empty(), "Enter starts nothing");
    key(&mut app, KeyCode::Char('y'));
    let msgs = sent(&mut rx);
    let Some(ClientMsg::Command(Command::NewWorktree { branch, agent, prompt, cmd, from, .. })) = msgs.first() else {
        panic!("a new worktree for the ticket: {msgs:?}");
    };
    assert_eq!(branch, "agent/gh-142-login-breaks-on-safari");
    assert!(agent.is_some() && cmd.is_none());
    assert_eq!(from.as_deref(), Some(Path::new("/home/me/shop")));
    let prompt = prompt.as_deref().unwrap_or_default();
    assert!(prompt.starts_with("Work on GitHub ticket #142") && prompt.contains("> Steps:") && !prompt.contains('\u{1b}'), "{prompt}");
}

#[test]
fn sending_to_the_session_in_front_is_a_follow_up_after_its_review() {
    let (mut app, mut rx) = on_ticket();
    sent(&mut rx);
    key(&mut app, KeyCode::Char('t'));
    assert!(frame(&mut app, "send").contains("Exactly what will be sent"));
    key(&mut app, KeyCode::Char('y'));
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Command(Command::QueueFollowUp { text, .. }) if text.contains("> Steps:"))));
}

#[test]
fn a_comment_is_reviewed_and_written_only_on_y() {
    let (mut app, mut rx) = on_ticket();
    sent(&mut rx);
    key(&mut app, KeyCode::Char('c'));
    typed(&mut app, "Fixed in");
    key(&mut app, KeyCode::Enter);
    typed(&mut app, "#150");
    frame(&mut app, "comment");
    key(&mut app, KeyCode::Tab);
    let shown = frame(&mut app, "review");
    assert!(shown.contains("Post this comment to GitHub #142?") && shown.contains("Exactly what will be written"), "{shown}");
    key(&mut app, KeyCode::Enter);
    assert!(sent(&mut rx).is_empty(), "Enter writes nothing");
    key(&mut app, KeyCode::Char('y'));
    let msgs = sent(&mut rx);
    let tag = tag_of(&msgs, |q| matches!(q, Query::TicketWrite { confirmed: true, write: TicketWrite::Comment { text }, .. } if text == "Fixed in\n#150"));
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::TicketWrite { tag, answer: Err(TicketError::SignedOut) }));
    let shown = frame(&mut app, "refused");
    assert!(shown.contains("Not written.") && shown.contains("not signed in"), "{shown}");
    key(&mut app, KeyCode::Char('y'));
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketWrite { .. }));
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::TicketWrite { tag, answer: Ok(TicketWritten::Commented) }));
    let msgs = sent(&mut rx);
    assert!(msgs.iter().any(|m| matches!(m, ClientMsg::Query(Query::Tickets { request: TicketsRequest::Get { .. }, .. }))), "the ticket is read again");
    assert!(frame(&mut app, "written").contains("commented on #142"));
}

#[test]
fn an_empty_comment_is_refused_before_any_review() {
    let (mut app, mut rx) = on_ticket();
    sent(&mut rx);
    key(&mut app, KeyCode::Char('c'));
    key(&mut app, KeyCode::Tab);
    assert!(frame(&mut app, "empty").contains("The comment is empty"));
    assert!(sent(&mut rx).is_empty());
}

#[test]
fn marking_done_goes_straight_to_its_review() {
    let (mut app, mut rx) = on_ticket();
    sent(&mut rx);
    key(&mut app, KeyCode::Char('d'));
    assert!(frame(&mut app, "done?").contains("Mark #142 done on GitHub?"));
    key(&mut app, KeyCode::Esc);
    assert!(sent(&mut rx).is_empty(), "Esc writes nothing");
    key(&mut app, KeyCode::Char('d'));
    key(&mut app, KeyCode::Char('y'));
    assert!(sent(&mut rx).iter().any(|m| matches!(m, ClientMsg::Query(Query::TicketWrite { write: TicketWrite::Close, confirmed: true, .. }))));
}

#[test]
fn a_key_is_sent_once_and_never_drawn() {
    let (mut app, mut rx) = opened_with(github());
    sent(&mut rx);
    key(&mut app, KeyCode::Char(','));
    frame(&mut app, "sources");
    // The Plane key row, under GitHub's name.
    key(&mut app, KeyCode::Down);
    key(&mut app, KeyCode::Enter);
    typed(&mut app, "https://plane.example");
    key(&mut app, KeyCode::Tab);
    typed(&mut app, "acme");
    key(&mut app, KeyCode::Tab);
    assert!(app.paste_into_tickets("plane_api_SECRET123\n"));
    let shown = frame(&mut app, "key form");
    assert!(shown.contains("Connect Plane") && shown.contains("••••"), "{shown}");
    assert!(!shown.contains("SECRET123"), "a key is never drawn");
    assert!(app.notice.as_ref().is_none_or(|(n, ..)| !n.contains("SECRET")), "nor toasted");
    key(&mut app, KeyCode::Enter);
    let msgs = sent(&mut rx);
    let tag = tag_of(&msgs, |q| matches!(q, Query::TicketKeys { change: TicketKeyChange::Set { provider: TicketProvider::Plane, address, workspace, key }, .. } if address == "https://plane.example" && workspace == "acme" && key.0 == "plane_api_SECRET123"));
    assert!(!format!("{msgs:?}").contains("SECRET123"), "a request's debug form hides the key");
    let state = TicketKeyState { provider: TicketProvider::Plane, set: true, address: "https://plane.example".into(), workspace: "acme".into(), stored_in: maitty_shared::tickets::KeyStorage::Keychain };
    app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::TicketKeys { tag, answer: Ok(vec![state]) }));
    let shown = frame(&mut app, "connected");
    assert!(shown.contains("Plane connected · key kept in your system keychain") && !shown.contains("SECRET"), "{shown}");
}

#[test]
fn an_older_daemon_is_not_asked() {
    let mut app = world(Stage::None);
    let (tx, mut rx) = mpsc::unbounded_channel();
    app.out = tx;
    app.local_protocol = maitty_shared::protocol::TICKETS_SINCE - 1;
    app.act(Action::Tickets);
    assert!(sent(&mut rx).iter().all(|m| !matches!(m, ClientMsg::Query(Query::Tickets { .. } | Query::TicketKeys { .. }))));
    assert!(frame(&mut app, "old daemon").contains("older than"));
}

#[test]
fn the_sources_say_where_each_key_is_kept() {
    use maitty_shared::tickets::KeyStorage;
    let (mut app, mut rx) = opened_with(github());
    let tag = tag_of(&sent(&mut rx), |q| matches!(q, Query::TicketKeys { change: TicketKeyChange::Status, .. }));
    let state = |provider: TicketProvider, stored_in: KeyStorage| TicketKeyState { provider, set: true, address: String::new(), workspace: String::new(), stored_in };
    keys_reply(&mut app, tag, vec![state(TicketProvider::Plane, KeyStorage::Keychain), state(TicketProvider::Linear, KeyStorage::File)]);
    key(&mut app, KeyCode::Char(','));
    let shown = frame(&mut app, "sources");
    assert!(shown.contains("key kept in your system keychain") && shown.contains("key kept in a file: no keychain"), "{shown}");
}
