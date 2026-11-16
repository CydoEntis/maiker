//! The Tickets view in the side panel: the tickets of the project the session in front works in,
//! from GitHub (the machine's own `gh`), Plane and Linear (the key this computer's daemon keeps).
//! Every read goes through this computer's daemon (`Query::Tickets`), tagged, and the answer comes
//! back as a message. Which sources a project reads is the daemon's too (`Query::TicketLinks`): a
//! link is kept per project (its repository, so every worktree and session in it), keys once per
//! computer, and a source not set up yet is set up from its own tab. The only writes are a comment and marking a ticket done, each shown exactly
//! as it will be written and sent only on `y` or a click on the confirm button (`TicketWrite`,
//! `confirmed: true`); Enter alone never writes. Ticket text is other people's: drawn as plain text,
//! cleaned of control and hidden characters, never read as Markdown or HTML.

use super::*;
use crate::client::tickets::{self as tk, Picked, Provider, Source, TicketLink, Unlinked};
use crate::client::{Bg, Btn, View};
use crate::protocol::{ClientMsg, Query, TicketKeyChange};
use maitty_shared::protocol::TICKET_LINKS_SINCE;
use maitty_shared::ticket_links::{LinkedProject, TicketLinkChange, TicketLinks, TicketPlace};
use maitty_shared::ticket_paste::{PastedLink, parse_ticket_link};
use maitty_shared::tickets::{
    Group, StateCategory, TICKET_COMMENT_MAX_CHARS, TICKET_NAME_MAX_CHARS, TICKETS_PAGE_MAX, Ticket, TicketError,
    TicketKeyState, TicketProvider, TicketSummary, TicketWrite, TicketWritten, TicketsReply,
    TicketsRequest,
};
use std::sync::atomic::{AtomicU64, Ordering};

/// The tag of the next request; every answer names the request it answers.
static NEXT_TAG: AtomicU64 = AtomicU64::new(1);

fn next_tag() -> u64 {
    NEXT_TAG.fetch_add(1, Ordering::Relaxed)
}

/// The most characters typed into one field (a key, an address, a name, the search).
const FIELD_MAX: usize = 400;
/// Below this width a row shows its key and title only.
const FULL_ROW_FROM: u16 = 44;
/// The most bullets a key's field shows: its length is not the screen's business.
const KEY_BULLETS: usize = 12;
const COMMANDS_HINT: &str = "gh auth login";
/// Said where links would be when this computer's daemon is older than keeping them.
const OLD_LINKS: &str = "The Maitty service on this computer is older than ticket links. Restart it (Restart maitty, in Search commands) to link Plane, Linear or another repo.";
/// Where a link is kept, said wherever one is set.
fn saved_for(name: &str) -> String {
    format!("Saved for {name} and every worktree of it: every session in this project shows these tickets.")
}

/// The project Tickets reads for: its name, where the daemon keeps its links, its folder, the
/// machine it is on, and the session in front (where Send goes).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TicketsProject {
    pub name: String,
    pub place: TicketPlace,
    pub folder: PathBuf,
    pub machine: MachineId,
    pub git: bool,
    pub term: Option<ClientTerm>,
    /// The session in front runs an agent, so a ticket can be sent to it.
    pub agent: bool,
    pub session: String,
}

/// What a request was for, so its answer lands where it belongs.
#[derive(Debug, Clone, PartialEq)]
enum Asked {
    Keys,
    /// The daemon's links; `moved` when the saved UI state's links went with the question.
    Links { moved: bool },
    Groups { source: String },
    List { source: String, page: u32 },
    Ticket { id: String },
    Write { id: String },
}

/// One kind of write, as reviewed.
#[derive(Debug, Clone, PartialEq)]
enum WriteState {
    Ready,
    Sending,
    Refused(String),
}

/// What the panel shows.
#[derive(Clone, PartialEq)]
enum Page {
    List,
    Ticket { id: String, scroll: usize },
    /// Narrow the list to a milestone, module or cycle.
    Scope { sel: usize },
    Sources(Sources),
    /// Start an agent on the ticket in a new worktree: what will be sent, before it is.
    Start { id: String, agent: usize, scroll: usize },
    /// Send the ticket to the session in front.
    Send { id: String, scroll: usize },
    Comment { id: String, text: String, problem: Option<String> },
    Review { id: String, write: TicketWrite, state: WriteState, scroll: usize },
}

/// Settings › Tickets, as a page of the panel: the accounts (keys and your names, once for every
/// project) and the linked projects. With `setup` it is one source's setup for the project in
/// front instead, opened from that source's tab, and goes back to the list when done.
#[derive(Clone, PartialEq, Default)]
struct Sources {
    setup: bool,
    sel: usize,
    /// A field being typed: which row, and what is typed.
    edit: Option<(SourceRow, String)>,
    form: Option<KeyForm>,
    /// Remove this provider's key? (asked first)
    remove: Option<TicketProvider>,
    /// Pick a Plane project or a Linear team from what the provider lists.
    pick: Option<(Provider, usize)>,
    note: Option<(String, bool)>,
    /// The setup's first step: a link to the project, being typed or pasted.
    paste: Option<String>,
    /// The project or team the pasted link named, put under the cursor once the list is read.
    want: Option<Want>,
}

/// What a pasted link asks the pick to land on.
#[derive(Clone, PartialEq)]
enum Want {
    /// A Plane project, by the group id the daemon gives it (`plane:<id>`).
    Group(String),
    /// A Linear team, by its key: the daemon's team list has no keys, so it lands on a team whose
    /// name reads the same.
    TeamKey(String),
}

/// The form a key is typed into. The key is held as `SecretText`, which never prints, and is
/// dropped as soon as it is sent.
#[derive(Clone, PartialEq)]
struct KeyForm {
    provider: TicketProvider,
    address: String,
    workspace: String,
    key: crate::protocol::SecretText,
    at: usize,
    sending: bool,
    error: Option<String>,
}

impl KeyForm {
    /// An empty form for `provider`, its address and workspace as last connected.
    fn new(provider: TicketProvider, keys: Option<&[TicketKeyState]>) -> KeyForm {
        let known = keys.and_then(|k| k.iter().find(|k| k.provider == provider)).cloned();
        KeyForm {
            provider,
            address: known.as_ref().map(|k| k.address.clone()).unwrap_or_default(),
            workspace: known.map(|k| k.workspace).unwrap_or_default(),
            key: crate::protocol::SecretText::default(),
            at: 0,
            sending: false,
            error: None,
        }
    }

    fn fields(&self) -> usize {
        if self.provider == TicketProvider::Plane { 3 } else { 1 }
    }

    /// The field being typed, by its place among the fields.
    fn text_mut(&mut self) -> &mut String {
        match (self.provider, self.at) {
            (TicketProvider::Plane, 0) => &mut self.address,
            (TicketProvider::Plane, 1) => &mut self.workspace,
            _ => &mut self.key.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceRow {
    GithubName,
    PlaneKey,
    PlaneName,
    LinearKey,
    LinearName,
    GithubRepo,
    PlaneProject,
    LinearTeam,
    /// Another linked project, by its place among `other_projects`.
    Other(usize),
}

/// Accounts: once on this computer, for every project.
const ACCOUNT_ROWS: [SourceRow; 5] = [SourceRow::GithubName, SourceRow::PlaneKey, SourceRow::PlaneName, SourceRow::LinearKey, SourceRow::LinearName];
/// The project in front's links.
const PROJECT_ROWS: [SourceRow; 3] = [SourceRow::GithubRepo, SourceRow::PlaneProject, SourceRow::LinearTeam];

impl SourceRow {
    fn provider(self) -> Option<Provider> {
        match self {
            SourceRow::GithubRepo | SourceRow::GithubName => Some(Provider::Github),
            SourceRow::PlaneKey | SourceRow::PlaneProject | SourceRow::PlaneName => Some(Provider::Plane),
            SourceRow::LinearKey | SourceRow::LinearTeam | SourceRow::LinearName => Some(Provider::Linear),
            SourceRow::Other(_) => None,
        }
    }

    fn is_name(self) -> bool {
        matches!(self, SourceRow::GithubName | SourceRow::PlaneName | SourceRow::LinearName)
    }

    fn name_of(provider: Provider) -> SourceRow {
        match provider {
            Provider::Github => SourceRow::GithubName,
            Provider::Plane => SourceRow::PlaneName,
            Provider::Linear => SourceRow::LinearName,
        }
    }
}

/// The list as last read: its tickets, whether more follow, and what went wrong.
#[derive(Clone, PartialEq, Default)]
struct Listing {
    tickets: Vec<TicketSummary>,
    more: bool,
    page: u32,
    loading: bool,
    error: Option<TicketError>,
    /// When the shown tickets were read; None before any arrived.
    read_at: Option<Instant>,
    /// The source and group these tickets are of.
    of: Option<(String, Option<String>)>,
}

pub(crate) struct TicketsView {
    /// None when no session is in front: there is no project to read for.
    pub project: Option<TicketsProject>,
    provider: Provider,
    /// The repository the folder's `origin` names: None while read, Some(None) when it has none.
    origin: Option<Option<String>>,
    keys: Option<Result<Vec<TicketKeyState>, TicketError>>,
    /// The daemon's links (this project's, every linked one, your names): None while read.
    links: Option<Result<TicketLinks, TicketError>>,
    /// The groups of a source, by source.
    groups: HashMap<String, Result<Vec<Group>, TicketError>>,
    scope: Option<Picked>,
    list: Listing,
    search: String,
    /// What the list was asked for with: typed words narrow the read list at once, Enter asks.
    asked_search: String,
    typing: bool,
    show_closed: bool,
    mine: bool,
    sel: usize,
    scroll: usize,
    page: Page,
    asked: HashMap<u64, Asked>,
    tickets: HashMap<String, Result<Ticket, TicketError>>,
    /// The daemon is older than tickets: nothing is asked of it.
    old_daemon: bool,
    /// Esc on the list (or the Tickets key) asked to close the view.
    closing: bool,
    /// A link the next setup starts its paste step with (`suggest_link`).
    suggested_link: Option<String>,
}

impl TicketsView {
    pub(crate) fn new(project: Option<TicketsProject>) -> TicketsView {
        TicketsView {
            project,
            provider: Provider::Github,
            origin: None,
            keys: None,
            links: None,
            groups: HashMap::new(),
            scope: None,
            list: Listing::default(),
            search: String::new(),
            asked_search: String::new(),
            typing: false,
            show_closed: false,
            mine: false,
            sel: 0,
            scroll: 0,
            page: Page::List,
            asked: HashMap::new(),
            tickets: HashMap::new(),
            old_daemon: false,
            closing: false,
            suggested_link: None,
        }
    }

    /// Starts the next setup's paste step with `link`, such as one an agent suggested
    /// (feat/tk-agent opens Tickets with it), and opens the tab of the source it names. It only
    /// fills the step: nothing is read or saved until the person presses Enter on it.
    pub(crate) fn suggest_link(&mut self, link: &str) {
        if let Ok(pasted) = parse_ticket_link(link) {
            self.provider = match pasted {
                PastedLink::Github { .. } => Provider::Github,
                PastedLink::Plane { .. } => Provider::Plane,
                PastedLink::Linear { .. } => Provider::Linear,
            };
        }
        let mut kept = String::new();
        push_capped(&mut kept, link.trim());
        self.suggested_link = Some(kept);
    }

    fn keys_known(&self) -> Option<&[TicketKeyState]> {
        match &self.keys {
            Some(Ok(k)) => Some(k),
            _ => None,
        }
    }

    fn source(&self, link: &TicketLink, provider: Provider) -> Source {
        tk::source_for(provider, link, self.origin.clone().flatten().as_deref(), self.keys_known())
    }

    fn links_known(&self) -> Option<&TicketLinks> {
        match &self.links {
            Some(Ok(links)) => Some(links),
            _ => None,
        }
    }

    /// What the project in front reads, as the daemon keeps it; nothing linked while unknown.
    fn link(&self) -> TicketLink {
        self.links_known().and_then(|l| l.project.as_ref()).map(|p| TicketLink::of_daemon(&p.link)).unwrap_or_default()
    }

    /// Every other linked project, as Sources lists them.
    fn other_projects(&self) -> Vec<&LinkedProject> {
        let Some(links) = self.links_known() else { return Vec::new() };
        let here = links.project.as_ref().map(|p| (&p.machine, &p.folder));
        links.projects.iter().filter(|p| Some((&p.machine, &p.folder)) != here).collect()
    }

    /// The rows Sources lists: the accounts, the project in front, then every other linked one.
    fn source_rows(&self) -> Vec<SourceRow> {
        ACCOUNT_ROWS.into_iter().chain(PROJECT_ROWS).chain((0..self.other_projects().len()).map(SourceRow::Other)).collect()
    }

    /// Whether the list's tab can be set up now (what it lacks is known).
    fn setup_ready(&self) -> bool {
        self.links.is_some() && (self.provider.keyed().is_none() || self.keys.is_some()) && (self.provider != Provider::Github || self.origin.is_some())
    }

    /// The tickets the list shows: the read ones that match the search, Mine and the state filter.
    fn shown(&self, me: &str) -> Vec<&TicketSummary> {
        self.list
            .tickets
            .iter()
            .filter(|t| tk::matches_search(t, &self.search))
            .filter(|t| !self.mine || tk::is_mine(t, me))
            .filter(|t| self.show_closed || t.state.category != StateCategory::Closed)
            .collect()
    }

    fn hidden_closed(&self) -> usize {
        self.list
            .tickets
            .iter()
            .filter(|t| t.state.category == StateCategory::Closed && tk::matches_search(t, &self.search))
            .count()
    }

    fn summary(&self, id: &str) -> Option<&TicketSummary> {
        self.list.tickets.iter().find(|t| t.id == id)
    }

    fn detail(&self, id: &str) -> Option<&Ticket> {
        self.tickets.get(id).and_then(|r| r.as_ref().ok())
    }

    /// The ticket's key, from what was read of it.
    fn key_of(&self, id: &str) -> String {
        let url = self.summary(id).map(|s| s.url.as_str()).or(self.detail(id).map(|t| t.summary.url.as_str()));
        tk::ticket_key(id, url.unwrap_or_default())
    }

    /// The blockers of `id` that are not done; a blocker in no list read counts as not done.
    fn open_blockers(&self, id: &str) -> Vec<String> {
        let Some(t) = self.detail(id) else { return Vec::new() };
        t.blocked_by
            .iter()
            .filter(|b| self.summary(b).is_none_or(|s| s.state.category != StateCategory::Closed))
            .map(|b| self.key_of(b))
            .collect()
    }

    /// Whether a text field has the keys, so letters are typed rather than acted on.
    pub(in crate::client) fn typing(&self) -> bool {
        match &self.page {
            Page::List => self.typing,
            Page::Comment { .. } => true,
            Page::Sources(s) => s.paste.is_some() || s.edit.is_some() || s.form.as_ref().is_some_and(|f| !f.sending),
            _ => false,
        }
    }

    /// A click on row `i` of what the page lists; returns whether it should open it too.
    pub(in crate::client) fn click_row(&mut self, i: usize) {
        match &mut self.page {
            Page::List => self.sel = i,
            Page::Scope { sel } => *sel = i,
            Page::Sources(s) if s.pick.is_some() => {
                if let Some((_, sel)) = &mut s.pick {
                    *sel = i;
                }
            }
            Page::Sources(s) if s.edit.is_none() && s.form.is_none() => s.sel = i,
            _ => {}
        }
    }

    /// The key hints the mode bar shows for the page.
    pub(in crate::client) fn hints(&self) -> (&'static [(&'static str, &'static str)], (&'static str, &'static str)) {
        match &self.page {
            Page::List if self.typing => (&[("", "type to search"), ("Enter", "ask")], ("Esc", "done")),
            Page::List if self.setup_ready() && !self.source(&self.link(), self.provider).linked() => {
                (&[("Enter", "set up"), ("←→", "source"), (",", "sources")], ("Esc", "close"))
            }
            Page::List => (
                &[("Enter", "open"), ("/", "search"), ("←→", "source"), ("m", "mine"), ("a", "closed"), ("g", "scope"), (",", "sources")],
                ("Esc", "close"),
            ),
            Page::Ticket { .. } => (
                &[("s", "start agent"), ("t", "send to session"), ("c", "comment"), ("d", "mark done"), ("o", "open link")],
                ("Esc", "back"),
            ),
            Page::Scope { .. } => (&[("↑↓", "choose"), ("Enter", "pick")], ("Esc", "back")),
            Page::Sources(s) if s.form.is_some() => (&[("Tab", "next field"), ("Enter", "connect")], ("Esc", "cancel")),
            Page::Sources(s) if s.edit.is_some() => (&[("", "type"), ("Enter", "save")], ("Esc", "cancel")),
            Page::Sources(s) if s.remove.is_some() => (&[("y", "remove")], ("Esc", "keep")),
            Page::Sources(s) if s.pick.is_some() => (&[("↑↓", "choose"), ("Enter", "pick")], ("Esc", "back")),
            Page::Sources(_) => (&[("Enter", "change"), ("x", "turn off / remove / unlink")], ("Esc", "back")),
            Page::Start { .. } => (&[("y", "start"), ("←→", "agent"), ("↑↓", "read")], ("Esc", "cancel")),
            Page::Send { .. } => (&[("y", "send"), ("↑↓", "read")], ("Esc", "cancel")),
            Page::Comment { .. } => (&[("", "type"), ("Tab", "review")], ("Esc", "cancel")),
            Page::Review { write: TicketWrite::Comment { .. }, .. } => (&[("y", "post"), ("e", "edit")], ("Esc", "cancel")),
            Page::Review { .. } => (&[("y", "mark done")], ("Esc", "cancel")),
        }
    }
}

/// The agents a ticket can be started with: the default first, then the quick agents, then the
/// built-in ones.
fn agents(cfg: &crate::config::Config) -> Vec<String> {
    let mut out = vec![cfg.default_agent()];
    for name in cfg.quick.agents.iter().map(|a| a.name.clone()).chain(["claude", "codex", "gemini"].map(String::from)) {
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

impl App {
    /// The project of the session in front, as Tickets reads for it.
    fn tickets_project(&self) -> Option<TicketsProject> {
        let term = self.selected_term()?;
        let info = self.term_info(term)?;
        let folder = info.root.clone().or_else(|| info.top.clone()).unwrap_or_else(|| info.cwd.clone());
        let machine = (term.machine != MachineId::LOCAL).then(|| self.machine_name(term.machine).to_string());
        Some(TicketsProject {
            name: folder_name(&folder),
            place: TicketPlace { machine, folder: folder.to_string_lossy().into_owned() },
            git: info.root.is_some() || info.top.is_some(),
            folder,
            machine: term.machine,
            term: Some(term),
            agent: info.agent.is_some(),
            session: crate::client::design::pane_name(info),
        })
    }

    /// The name you are known by at `provider`, for Mine: GitHub's is kept by this window, Plane's
    /// and Linear's by the daemon (the saved ones until they are moved there).
    fn ticket_me(&self, v: &TicketsView, provider: Provider) -> String {
        let saved = &self.screen.saved.ticket_me;
        match (provider.keyed(), v.links_known()) {
            (Some(keyed), Some(links)) => tk::kept(links.me.of(keyed), TICKET_NAME_MAX_CHARS),
            _ => saved.of(provider).to_string(),
        }
    }

    /// Keep the name you are known by at `provider`.
    fn set_ticket_me(&mut self, v: &mut TicketsView, provider: Provider, name: &str) {
        let Some(keyed) = provider.keyed() else {
            self.screen.saved.ticket_me.set(provider, name);
            self.screen.save();
            return;
        };
        let name = tk::kept(name, TICKET_NAME_MAX_CHARS);
        if let Some(Ok(links)) = &mut v.links {
            match keyed {
                TicketProvider::Plane => links.me.plane = name.clone(),
                TicketProvider::Linear => links.me.linear = name.clone(),
            }
        }
        self.ask_ticket_links(v, TicketLinkChange::SetMe { provider: keyed, name });
    }

    /// Change what the project in front reads and have the daemon keep it. The view shows the change
    /// at once; a refusal says so and reads the links again. False when the daemon can't keep links.
    fn set_ticket_link(&mut self, v: &mut TicketsView, change: impl FnOnce(&mut TicketLink)) -> bool {
        let Some(p) = v.project.clone() else { return false };
        let Some(links) = v.links_known() else {
            let why = match &v.links {
                Some(Err(e)) => tk::read_failure(v.provider, e),
                _ => "The links are still being read".into(),
            };
            self.notify(why, true);
            return false;
        };
        let place = links.project.as_ref().map_or_else(|| p.place.clone(), |at| TicketPlace { machine: at.machine.clone(), folder: at.folder.clone() });
        let mut link = v.link();
        change(&mut link);
        let link = link.to_daemon();
        if let Some(Ok(links)) = &mut v.links {
            let project = links.project.get_or_insert_with(|| LinkedProject { machine: place.machine.clone(), folder: place.folder.clone(), link: Default::default() });
            project.link = link.clone();
        }
        self.ask_ticket_links(v, TicketLinkChange::Set { place, link });
        true
    }

    /// Ask this computer's daemon for the links (or change them) for the project in front. An
    /// older daemon is not asked: it would never answer.
    fn ask_ticket_links(&mut self, v: &mut TicketsView, change: TicketLinkChange) {
        if TICKET_LINKS_SINCE > self.local_protocol {
            v.links = Some(Err(TicketError::Invalid(OLD_LINKS.into())));
            return;
        }
        let place = v.project.as_ref().map(|p| p.place.clone());
        let moved = matches!(change, TicketLinkChange::Import { .. });
        self.ask_tickets(v, Asked::Links { moved }, |tag| Query::TicketLinks { place, change, tag });
    }

    /// The Tickets key: the project's tickets in the side panel, or closed again.
    pub(in crate::client) fn toggle_tickets_sheet(&mut self) {
        if matches!(self.view, Some(View::Tickets(_))) {
            if !self.view_has_keys() {
                self.view_set_aside = None;
                return;
            }
            self.view = None;
            return;
        }
        let project = self.tickets_project();
        let mut v = TicketsView::new(project.clone());
        self.screen.cursor = None;
        self.mode = Mode::Normal;
        if let Some(p) = &project {
            self.ask_ticket_keys(&mut v, TicketKeyChange::Status);
            // The links this window kept before the daemon kept them go with the first question,
            // which adds only what the daemon has not got.
            let saved = &self.screen.saved;
            let change = match tk::saved_to_import(&saved.ticket_links, &saved.ticket_me) {
                Some((projects, me)) => TicketLinkChange::Import { projects, me },
                None => TicketLinkChange::Read,
            };
            if !v.old_daemon {
                self.ask_ticket_links(&mut v, change);
            }
            if p.machine == MachineId::LOCAL {
                self.read_origin(p.folder.clone());
            } else {
                v.origin = Some(None);
            }
            self.tickets_reload(&mut v);
        }
        self.show_view(View::Tickets(Box::new(v)));
    }

    /// The repository the folder's `origin` names, read off the UI thread.
    fn read_origin(&self, folder: PathBuf) {
        self.spawn_bg(move || {
            let repo = crate::proc::git(&folder, &["remote", "get-url", "origin"])
                .ok()
                .and_then(|address| maitty_shared::github::repo_of_remote(&address));
            Bg::Then(Box::new(move |app: &mut App| {
                app.with_tickets(|app, v| {
                    if v.project.as_ref().is_some_and(|p| p.folder == folder) {
                        v.origin = Some(repo);
                        app.tickets_reload(v);
                    }
                });
            }))
        });
    }

    /// Run `f` on the open Tickets view, if it is open.
    fn with_tickets(&mut self, f: impl FnOnce(&mut App, &mut TicketsView)) {
        match self.view.take() {
            Some(View::Tickets(mut v)) => {
                f(self, &mut v);
                if self.view.is_none() {
                    self.view = Some(View::Tickets(v));
                }
            }
            other => self.view = other,
        }
        self.dirty = true;
    }

    /// Send `query` to this computer's daemon, remembering what it was for; an older daemon is
    /// not asked (it would never answer).
    fn ask_tickets(&self, v: &mut TicketsView, asked: Asked, query: impl FnOnce(u64) -> Query) -> bool {
        let tag = next_tag();
        let msg = ClientMsg::Query(query(tag));
        if msg.introduced_in() > self.local_protocol {
            v.old_daemon = true;
            return false;
        }
        v.asked.insert(tag, asked);
        self.send(MachineId::LOCAL, msg);
        true
    }

    fn ask_ticket_keys(&self, v: &mut TicketsView, change: TicketKeyChange) {
        self.ask_tickets(v, Asked::Keys, |tag| Query::TicketKeys { change, tag });
    }

    /// Read the list again from its first page, for the provider, scope and search shown.
    fn tickets_reload(&self, v: &mut TicketsView) {
        if v.project.is_none() || v.links.is_none() {
            return;
        }
        let link = v.link();
        let Source::Linked { source, top, .. } = v.source(&link, v.provider) else {
            v.list = Listing::default();
            return;
        };
        let group = v.scope.as_ref().map(|s| s.id.clone()).or(top);
        let same = v.list.of.as_ref() == Some(&(source.clone(), group.clone()));
        if !same {
            v.list = Listing::default();
            v.sel = 0;
        }
        v.asked_search = v.search.trim().to_string();
        self.ask_list_page(v, source, group, 0);
    }

    fn ask_list_page(&self, v: &mut TicketsView, source: String, group: Option<String>, page: u32) {
        let filter = maitty_shared::tickets::Filter {
            group: group.clone(),
            search: Some(v.asked_search.clone()).filter(|s| !s.is_empty()),
            page,
            ..Default::default()
        };
        v.list.loading = true;
        v.list.of = Some((source.clone(), group));
        let asked = Asked::List { source: source.clone(), page };
        if !self.ask_tickets(v, asked, |tag| Query::Tickets { source, request: TicketsRequest::List(filter), tag }) {
            v.list.loading = false;
        }
    }

    /// Read one ticket whole, unless it already was.
    fn ask_ticket(&self, v: &mut TicketsView, id: &str, again: bool) {
        if !again && v.tickets.get(id).is_some_and(Result::is_ok) {
            return;
        }
        let Some((source, _)) = v.list.of.clone() else { return };
        let id = id.to_string();
        self.ask_tickets(v, Asked::Ticket { id: id.clone() }, |tag| Query::Tickets {
            source,
            request: TicketsRequest::Get { id },
            tag,
        });
    }

    fn ask_groups(&self, v: &mut TicketsView, source: &str) {
        let source = source.to_string();
        self.ask_tickets(v, Asked::Groups { source: source.clone() }, |tag| Query::Tickets {
            source,
            request: TicketsRequest::Groups,
            tag,
        });
    }

    /// A `Reply::Tickets` from this computer's daemon.
    pub(in crate::client) fn tickets_arrived(&mut self, tag: u64, answer: Result<TicketsReply, TicketError>) {
        // Cleaned again here, whatever the daemon did: this text is drawn on a terminal.
        let answer = match answer {
            Ok(reply) => reply.cleaned().ok_or_else(|| TicketError::Invalid("The service sent a ticket that is not one".into())),
            Err(e) => Err(e.cleaned()),
        };
        self.with_tickets(|app, v| {
            let Some(asked) = v.asked.remove(&tag) else { return };
            match (asked, answer) {
                (Asked::List { source, page }, answer) => {
                    if v.list.of.as_ref().map(|(s, _)| s) != Some(&source) {
                        return;
                    }
                    v.list.loading = false;
                    match answer {
                        Ok(TicketsReply::List(found)) => {
                            if page == 0 {
                                v.list.tickets.clear();
                            }
                            for t in found.tickets {
                                if !v.list.tickets.iter().any(|have| have.id == t.id) {
                                    v.list.tickets.push(t);
                                }
                            }
                            v.list.more = found.more;
                            v.list.page = page;
                            v.list.error = None;
                            v.list.read_at = Some(Instant::now());
                        }
                        Ok(_) => v.list.error = Some(TicketError::Invalid("The service gave an answer to another question".into())),
                        Err(e) => v.list.error = Some(e),
                    }
                }
                (Asked::Ticket { id }, Ok(TicketsReply::Ticket(t))) => {
                    v.tickets.insert(id, Ok(*t));
                }
                (Asked::Ticket { id }, Ok(_)) => {
                    v.tickets.insert(id, Err(TicketError::Invalid("The service gave an answer to another question".into())));
                }
                (Asked::Ticket { id }, Err(e)) => {
                    v.tickets.insert(id, Err(e));
                }
                (Asked::Groups { source }, Ok(TicketsReply::Groups(groups))) => {
                    v.groups.insert(source, Ok(groups));
                    aim_pick(v);
                }
                (Asked::Groups { source }, Ok(_)) => {
                    v.groups.insert(source, Err(TicketError::Invalid("The service gave an answer to another question".into())));
                }
                (Asked::Groups { source }, Err(e)) => {
                    v.groups.insert(source, Err(e));
                }
                (Asked::Keys | Asked::Links { .. } | Asked::Write { .. }, _) => {}
            }
            let _ = app;
        });
    }

    /// A `Reply::TicketKeys`: which providers have a key now. Never a key.
    pub(in crate::client) fn ticket_keys_arrived(&mut self, tag: u64, answer: Result<Vec<TicketKeyState>, TicketError>) {
        let answer = answer.map(|k| k.into_iter().map(TicketKeyState::cleaned).collect()).map_err(TicketError::cleaned);
        self.with_tickets(|app, v| {
            if v.asked.remove(&tag) != Some(Asked::Keys) {
                return;
            }
            let sent = matches!(&v.page, Page::Sources(s) if s.form.as_ref().is_some_and(|f| f.sending));
            let mut picking = None;
            if sent && let Page::Sources(s) = &mut v.page {
                match &answer {
                    Ok(_) => {
                        let provider = s.form.as_ref().map(|f| f.provider);
                        let name = provider.map_or("", TicketProvider::name);
                        s.form = None;
                        s.note = Some((format!("{} connected · key saved", capital(name)), false));
                        // Setting up: the key is for every project; this project's team or project next.
                        if s.setup && let Some(keyed) = provider {
                            picking = Some(keyed);
                        }
                    }
                    Err(e) => {
                        if let Some(f) = &mut s.form {
                            f.sending = false;
                            f.error = Some(key_failure(e));
                        }
                    }
                }
            }
            match answer {
                Ok(keys) => v.keys = Some(Ok(keys)),
                // A refused change leaves what was known; a refused status says why.
                Err(e) if v.keys.is_none() => v.keys = Some(Err(e)),
                Err(_) => {}
            }
            if let Some(keyed) = picking {
                let provider = if keyed == TicketProvider::Plane { Provider::Plane } else { Provider::Linear };
                if v.source(&v.link(), provider).linked() {
                    v.page = Page::List;
                } else if let Page::Sources(s) = &mut v.page {
                    s.pick = Some((provider, 0));
                    app.ask_groups(v, keyed.name());
                    aim_pick(v);
                }
            }
            if v.list.of.is_none() && !v.list.loading {
                app.tickets_reload(v);
            }
        });
    }

    /// A `Reply::TicketLinks`: what the project in front reads, every linked project, your names; or
    /// why a change was refused.
    pub(in crate::client) fn ticket_links_arrived(&mut self, tag: u64, answer: Result<TicketLinks, TicketError>) {
        let answer = answer.map_err(TicketError::cleaned);
        self.with_tickets(|app, v| {
            let Some(Asked::Links { moved }) = v.asked.remove(&tag) else { return };
            let first = v.links.is_none();
            let before = v.link();
            match answer {
                Ok(links) => {
                    if moved {
                        // The daemon has them now; the window keeps only GitHub's name.
                        let saved = &mut app.screen.saved;
                        saved.ticket_links.clear();
                        saved.ticket_me.plane.clear();
                        saved.ticket_me.linear.clear();
                        app.screen.save();
                    }
                    v.links = Some(Ok(links));
                }
                Err(e) if first => v.links = Some(Err(e)),
                Err(e) => {
                    // A refused change: say why and read what the daemon really keeps.
                    app.notify(format!("Not saved: {}", tk::read_failure(v.provider, &e)), true);
                    app.ask_ticket_links(v, TicketLinkChange::Read);
                }
            }
            let link = v.link();
            if first {
                // The first tab with something linked.
                if link.github.as_deref() == Some("") && (link.plane.is_some() || link.linear.is_some()) {
                    v.provider = if link.plane.is_some() { Provider::Plane } else { Provider::Linear };
                }
            }
            if first || link != before {
                app.tickets_reload(v);
            }
        });
    }

    /// A `Reply::TicketWrite`: the write was done, or why it was not.
    pub(in crate::client) fn ticket_write_arrived(&mut self, tag: u64, answer: Result<TicketWritten, TicketError>) {
        let answer = answer.map_err(TicketError::cleaned);
        self.with_tickets(|app, v| {
            let Some(Asked::Write { id }) = v.asked.remove(&tag) else { return };
            let provider = Provider::of_id(&id).unwrap_or(v.provider);
            let key = v.key_of(&id);
            match answer {
                Ok(done) => {
                    let said = match done {
                        TicketWritten::Commented => format!("commented on {key} in {}", provider.name()),
                        TicketWritten::Closed => format!("marked {key} done in {}", provider.name()),
                    };
                    app.notify(said, false);
                    v.page = Page::Ticket { id: id.clone(), scroll: 0 };
                    app.ask_ticket(v, &id, true);
                    app.tickets_reload(v);
                }
                Err(e) => {
                    if let Page::Review { id: shown, state, .. } = &mut v.page
                        && *shown == id
                    {
                        *state = WriteState::Refused(tk::write_failure(provider, &e));
                    }
                }
            }
        });
    }

    /// A paste while Tickets types into a field: the text goes into it, a line at a time for a
    /// one-line field. Never repeated in a toast: it may be a key.
    pub(in crate::client) fn paste_into_tickets(&mut self, text: &str) -> bool {
        if !self.view_has_keys() || !matches!(self.mode, Mode::Normal) {
            return false;
        }
        let Some(View::Tickets(v)) = &mut self.view else {
            return false;
        };
        let one_line = || text.lines().next().unwrap_or_default().trim().to_string();
        // A link pasted on a source's setup screen starts its setup with it, on the tab it is for.
        if matches!(v.page, Page::List) && !v.typing && v.setup_ready() && !v.source(&v.link(), v.provider).linked() {
            v.suggest_link(&one_line());
            if v.setup_ready() && !v.source(&v.link(), v.provider).linked() {
                v.page = Page::Sources(Sources { setup: true, paste: v.suggested_link.take(), ..Sources::default() });
            }
            self.dirty = true;
            return true;
        }
        if !v.typing() {
            return false;
        }
        match &mut v.page {
            Page::List => push_capped(&mut v.search, &one_line()),
            Page::Comment { text: typed, problem, .. } => {
                *problem = None;
                push_text(typed, text, TICKET_COMMENT_MAX_CHARS + 1);
            }
            Page::Sources(s) => {
                if let Some(f) = &mut s.form {
                    push_capped(f.text_mut(), &one_line());
                    f.error = None;
                } else if let Some(typed) = &mut s.paste {
                    push_capped(typed, &one_line());
                    s.note = None;
                } else if let Some((_, typed)) = &mut s.edit {
                    push_capped(typed, &one_line());
                }
            }
            _ => return false,
        }
        self.dirty = true;
        true
    }

    /// Keys in the Tickets view; returns false when it closes.
    pub(in crate::client) fn on_tickets_key(&mut self, v: &mut TicketsView, k: &KeyEvent) -> bool {
        if v.project.is_none() || v.old_daemon {
            return !matches!(k.code, KeyCode::Esc | KeyCode::Char('p'));
        }
        let page = std::mem::replace(&mut v.page, Page::List);
        let (page, open) = match page {
            Page::List => (self.on_tickets_list_key(v, k), true),
            Page::Ticket { id, scroll } => self.on_ticket_page_key(v, k, id, scroll),
            Page::Scope { sel } => (self.on_scope_key(v, k, sel), true),
            Page::Sources(s) => (self.on_sources_key(v, k, s), true),
            Page::Start { id, agent, scroll } => (self.on_start_key(v, k, id, agent, scroll), true),
            Page::Send { id, scroll } => (self.on_send_key(v, k, id, scroll), true),
            Page::Comment { id, text, problem } => (self.on_comment_key(v, k, id, text, problem), true),
            Page::Review { id, write, state, scroll } => (self.on_review_key(v, k, id, write, state, scroll), true),
        };
        if let Some(page) = page {
            v.page = page;
        }
        let close = std::mem::take(&mut v.closing);
        open && !close
    }
}

/// `name` with a capital first letter.
fn capital(name: &str) -> String {
    let mut c = name.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

fn key_failure(e: &TicketError) -> String {
    match e {
        TicketError::SignedOut => "The provider refused the key.".into(),
        TicketError::Invalid(line) | TicketError::Unreachable(line) => tk::shown(line, false),
        TicketError::NotFound => "The provider has no such workspace.".into(),
        TicketError::RateLimited => "Too many requests. Try again in a minute.".into(),
        TicketError::NotInstalled => "The service could not keep the key.".into(),
    }
}

/// The source a pasted link is for.
fn pasted_provider(pasted: &PastedLink) -> Provider {
    match pasted {
        PastedLink::Github { .. } => Provider::Github,
        PastedLink::Plane { .. } => Provider::Plane,
        PastedLink::Linear { .. } => Provider::Linear,
    }
}

/// Puts the project or team a pasted link named under the pick's cursor once its list is read,
/// and says whether it was found. It moves the cursor only: Enter still links it.
fn aim_pick(v: &mut TicketsView) {
    let Page::Sources(s) = &mut v.page else { return };
    let (Some((provider, _)), Some(want)) = (s.pick, s.want.clone()) else { return };
    let source = provider.keyed().map_or("", TicketProvider::name);
    let Some(Ok(groups)) = v.groups.get(source) else { return };
    let tops = tk::tops(groups);
    let found = tops.iter().position(|g| match &want {
        Want::Group(id) => g.id.eq_ignore_ascii_case(id),
        Want::TeamKey(key) => g.name.trim().eq_ignore_ascii_case(key),
    });
    s.want = None;
    match found {
        Some(at) => {
            let name = tk::shown(&tops[at].name, false);
            s.pick = Some((provider, at));
            s.note = Some((format!("The link names {name}: Enter links it"), false));
        }
        None => s.note = Some((format!("No {} this key sees matches the link: pick it", provider.top_word()), true)),
    }
}

/// `more` added to a one-line field, without control characters, up to `FIELD_MAX`.
fn push_capped(field: &mut String, more: &str) {
    for c in more.chars().filter(|c| !c.is_control()) {
        if field.chars().count() >= FIELD_MAX {
            break;
        }
        field.push(c);
    }
}

/// `more` added to a comment, line breaks kept, up to `max` characters (one past the limit, so
/// the review can say it is too long rather than cut it quietly).
fn push_text(field: &mut String, more: &str, max: usize) {
    for c in more.replace("\r\n", "\n").chars().filter(|c| *c == '\n' || !c.is_control()) {
        if field.chars().count() >= max {
            break;
        }
        field.push(c);
    }
}

/// A list's selection moved by the arrows, j / k, Home / End and the page keys.
fn moved(sel: usize, n: usize, k: &KeyEvent) -> usize {
    let last = n.saturating_sub(1);
    match k.code {
        KeyCode::Down | KeyCode::Char('j') => (sel + 1).min(last),
        KeyCode::Up | KeyCode::Char('k') => sel.saturating_sub(1),
        KeyCode::Home => 0,
        KeyCode::End => last,
        KeyCode::PageDown => (sel + 10).min(last),
        KeyCode::PageUp => sel.saturating_sub(10),
        _ => sel,
    }
}

impl App {
    fn on_tickets_list_key(&mut self, v: &mut TicketsView, k: &KeyEvent) -> Option<Page> {
        if v.typing {
            match k.code {
                KeyCode::Esc => {
                    v.typing = false;
                }
                KeyCode::Enter => {
                    v.typing = false;
                    if v.search.trim() != v.asked_search {
                        self.tickets_reload(v);
                    }
                }
                KeyCode::Backspace => {
                    v.search.pop();
                    v.sel = 0;
                }
                KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                    push_capped(&mut v.search, &c.to_string());
                    v.sel = 0;
                }
                _ => {}
            }
            return Some(Page::List);
        }
        let me = self.ticket_me(v, v.provider);
        let n = v.shown(&me).len();
        if k.code == KeyCode::Enter && v.setup_ready() && !v.source(&v.link(), v.provider).linked() {
            return Some(self.start_setup(v));
        }
        match k.code {
            KeyCode::Esc | KeyCode::Char('p') if k.code == KeyCode::Char('p') || v.search.is_empty() => {
                v.closing = true;
            }
            KeyCode::Esc => {
                v.search.clear();
                v.sel = 0;
                if !v.asked_search.is_empty() {
                    self.tickets_reload(v);
                }
            }
            KeyCode::Char('/') => v.typing = true,
            KeyCode::Left | KeyCode::Right | KeyCode::Char('h') | KeyCode::Char('l') => {
                let i = Provider::ALL.iter().position(|p| *p == v.provider).unwrap_or(0);
                let step = if matches!(k.code, KeyCode::Left | KeyCode::Char('h')) { Provider::ALL.len() - 1 } else { 1 };
                v.provider = Provider::ALL[(i + step) % Provider::ALL.len()];
                v.scope = None;
                v.mine = false;
                v.list = Listing::default();
                v.sel = 0;
                self.tickets_reload(v);
            }
            KeyCode::Char('m') => {
                if me.is_empty() {
                    return Some(Page::Sources(Sources {
                        sel: v.source_rows().iter().position(|r| *r == SourceRow::name_of(v.provider)).unwrap_or(0),
                        note: Some((format!("Type your {} name for Mine", v.provider.name()), false)),
                        ..Sources::default()
                    }));
                }
                v.mine = !v.mine;
                v.sel = 0;
            }
            KeyCode::Char('a') => {
                v.show_closed = !v.show_closed;
                v.sel = 0;
            }
            KeyCode::Char('r') => self.tickets_reload(v),
            KeyCode::Char(',') => return Some(Page::Sources(Sources::default())),
            KeyCode::Char('t') if matches!(v.list.error, Some(TicketError::SignedOut)) && v.provider == Provider::Github => {
                self.sign_in_github(v);
            }
            KeyCode::Char('g') => {
                if let Source::Linked { source, .. } = v.source(&v.link(), v.provider) {
                    if !matches!(v.groups.get(&source), Some(Ok(_))) {
                        self.ask_groups(v, &source);
                    }
                    return Some(Page::Scope { sel: 0 });
                }
            }
            KeyCode::Enter | KeyCode::Char('s') | KeyCode::Char('o') => {
                let Some(id) = v.shown(&me).get(v.sel).map(|t| t.id.clone()) else { return Some(Page::List) };
                self.ask_ticket(v, &id, false);
                return Some(match k.code {
                    KeyCode::Char('s') => Page::Start { id, agent: 0, scroll: 0 },
                    _ => Page::Ticket { id, scroll: 0 },
                });
            }
            _ => {
                v.sel = moved(v.sel, n, k);
                // The end of what was read: the next page, while the provider has more.
                if n > 0 && v.sel + 1 >= n && v.list.more && !v.list.loading && v.list.page < TICKETS_PAGE_MAX
                    && let Some((source, group)) = v.list.of.clone()
                {
                    let page = v.list.page + 1;
                    self.ask_list_page(v, source, group, page);
                }
            }
        }
        Some(Page::List)
    }

    /// The setup of the list's source for the project in front: GitHub asks for a repository,
    /// Plane and Linear for a key (once, for every project) and then the project or team.
    fn start_setup(&mut self, v: &mut TicketsView) -> Page {
        Page::Sources(Sources { setup: true, paste: Some(v.suggested_link.take().unwrap_or_default()), ..Sources::default() })
    }

    /// The setup's steps after the paste step, with what `pasted` filled in: GitHub's repository
    /// is saved at once; Plane's address and workspace go into the key form, and the project or
    /// team the link names is put under the cursor. With nothing pasted, the steps as typed by hand.
    fn setup_after_paste(&mut self, v: &mut TicketsView, pasted: Option<PastedLink>) -> Option<Page> {
        let mut s = Sources { setup: true, ..Sources::default() };
        if let Some(PastedLink::Github { repo }) = &pasted {
            let name = v.project.as_ref().map_or_else(String::new, |p| p.name.clone());
            if !self.set_ticket_link(v, |l| l.github = Some(repo.clone())) {
                s.paste = Some(String::new());
                return Some(Page::Sources(s));
            }
            self.notify(format!("GitHub reads {repo} for {name}"), false);
            self.tickets_reload(v);
            return Some(Page::List);
        }
        s.want = match &pasted {
            Some(PastedLink::Plane { project: Some(id), .. }) => Some(Want::Group(format!("plane:{id}"))),
            Some(PastedLink::Linear { team_key }) => Some(Want::TeamKey(team_key.clone())),
            _ => None,
        };
        match (v.provider.keyed(), v.source(&v.link(), v.provider)) {
            (None, _) => s.edit = Some((SourceRow::GithubRepo, String::new())),
            (Some(keyed), Source::Unlinked(Unlinked::NoKey)) => {
                let mut form = KeyForm::new(keyed, v.keys_known());
                if let Some(PastedLink::Plane { address, workspace, .. }) = pasted {
                    form.address = address;
                    form.workspace = workspace;
                    // Only the key is left to type.
                    form.at = form.fields() - 1;
                }
                s.form = Some(form);
            }
            (Some(keyed), _) => {
                self.ask_groups(v, keyed.name());
                s.pick = Some((v.provider, 0));
            }
        }
        v.page = Page::Sources(s);
        aim_pick(v);
        Some(std::mem::replace(&mut v.page, Page::List))
    }

    /// A shell on this computer running `gh auth login`: GitHub is read with this computer's `gh`.
    fn sign_in_github(&mut self, v: &TicketsView) {
        let dir = v.project.as_ref().filter(|p| p.machine == MachineId::LOCAL).map_or_else(|| self.here_dir(), |p| p.folder.clone());
        self.screen_new_session_on(MachineId::LOCAL, dir, Some(COMMANDS_HINT.into()), false);
    }

    fn on_ticket_page_key(&mut self, v: &mut TicketsView, k: &KeyEvent, id: String, scroll: usize) -> (Option<Page>, bool) {
        let page = |scroll| Some(Page::Ticket { id: id.clone(), scroll });
        let closed = v.detail(&id).map(|t| t.summary.state.category) == Some(StateCategory::Closed)
            || v.summary(&id).map(|t| t.state.category) == Some(StateCategory::Closed);
        let out = match k.code {
            KeyCode::Esc => Some(Page::List),
            KeyCode::Char('s') => Some(Page::Start { id: id.clone(), agent: 0, scroll: 0 }),
            KeyCode::Char('t') => {
                if v.project.as_ref().is_some_and(|p| p.agent) {
                    Some(Page::Send { id: id.clone(), scroll: 0 })
                } else {
                    self.notify("the session in front runs no agent to send the ticket to".into(), true);
                    page(scroll)
                }
            }
            KeyCode::Char('c') => Some(Page::Comment { id: id.clone(), text: String::new(), problem: None }),
            KeyCode::Char('d') if closed => {
                self.notify("that ticket is already done".into(), false);
                page(scroll)
            }
            KeyCode::Char('d') => Some(Page::Review { id: id.clone(), write: TicketWrite::Close, state: WriteState::Ready, scroll: 0 }),
            KeyCode::Char('o') | KeyCode::Char('y') => {
                let url = v.detail(&id).map(|t| t.summary.url.clone()).or_else(|| v.summary(&id).map(|s| s.url.clone())).unwrap_or_default();
                if url.is_empty() {
                    self.notify("the provider gave no link for this ticket".into(), false);
                } else if k.code == KeyCode::Char('y') {
                    crate::client::copy::to_clipboard(&url);
                    self.notify(format!("copied {url}"), false);
                } else {
                    self.open_link(url);
                }
                page(scroll)
            }
            KeyCode::Char('r') => {
                self.ask_ticket(v, &id, true);
                page(scroll)
            }
            _ => page(scroll_moved(scroll, k)),
        };
        (out, true)
    }

    fn on_scope_key(&mut self, v: &mut TicketsView, k: &KeyEvent, sel: usize) -> Option<Page> {
        let groups = scope_groups(v);
        match k.code {
            KeyCode::Esc => Some(Page::List),
            KeyCode::Enter => {
                v.scope = if sel == 0 { None } else { groups.get(sel - 1).and_then(tk::picked) };
                self.tickets_reload(v);
                Some(Page::List)
            }
            _ => Some(Page::Scope { sel: moved(sel, groups.len() + 1, k) }),
        }
    }

    fn on_start_key(&mut self, v: &mut TicketsView, k: &KeyEvent, id: String, agent: usize, scroll: usize) -> Option<Page> {
        let n = agents(&self.cfg).len();
        match k.code {
            KeyCode::Esc => Some(Page::Ticket { id, scroll: 0 }),
            KeyCode::Left => Some(Page::Start { id, agent: (agent + n - 1) % n, scroll }),
            KeyCode::Right => Some(Page::Start { id, agent: (agent + 1) % n, scroll }),
            KeyCode::Char('y') => {
                if self.start_ticket_agent(v, &id, agent) {
                    Some(Page::Ticket { id, scroll: 0 })
                } else {
                    Some(Page::Start { id, agent, scroll })
                }
            }
            _ => Some(Page::Start { id, agent, scroll: scroll_moved(scroll, k) }),
        }
    }

    /// Start the agent on the ticket in a new worktree of the project, with the ticket as its first
    /// prompt: the daemon checks the branch and the prompt and quotes the prompt itself.
    fn start_ticket_agent(&mut self, v: &TicketsView, id: &str, agent: usize) -> bool {
        let Some(p) = v.project.clone() else { return false };
        let Some(t) = v.detail(id) else {
            self.notify("the ticket is still being read".into(), false);
            return false;
        };
        if !p.git {
            self.notify(format!("{} is not a git repository, so there is no worktree to start in; t sends the ticket to the session in front", p.name), true);
            return false;
        }
        if !self.guard_local(p.machine, crate::client::routing::Feature::Worktrees) {
            return false;
        }
        let Some(ws) = self
            .snap_of(p.machine)
            .and_then(|s| {
                let term = p.term.map(|t| t.term);
                s.workspaces.iter().find(|w| term.is_some_and(|t| w.tabs.iter().any(|tab| tab.layout.contains(t)))).or(s.workspaces.first())
            })
            .map(|w| w.id)
        else {
            self.notify("start something first".into(), true);
            return false;
        };
        let agent = agents(&self.cfg).get(agent).cloned().unwrap_or_else(|| self.cfg.default_agent());
        let key = v.key_of(id);
        let branch = tk::ticket_branch(&key, &t.summary.title);
        let message = tk::ticket_message(t, &v.open_blockers(id));
        self.notify(format!("starting {agent} on {key} in a new worktree, {branch}"), false);
        self.cmd_on(
            p.machine,
            Command::NewWorktree {
                ws,
                branch,
                // A new branch from this checkout, never an old `origin/<name>` that shares the name.
                base: Some("HEAD".into()),
                cmd: None,
                split: None,
                from: Some(p.folder.clone()),
                agent: Some(agent),
                prompt: Some(message),
            },
        );
        true
    }

    fn on_send_key(&mut self, v: &mut TicketsView, k: &KeyEvent, id: String, scroll: usize) -> Option<Page> {
        match k.code {
            KeyCode::Esc => Some(Page::Ticket { id, scroll: 0 }),
            KeyCode::Char('y') => {
                let (Some(p), Some(t)) = (v.project.clone(), v.detail(&id)) else {
                    self.notify("the ticket is still being read".into(), false);
                    return Some(Page::Send { id, scroll });
                };
                let Some(term) = p.term.filter(|_| p.agent) else { return Some(Page::Ticket { id, scroll: 0 }) };
                let text = tk::ticket_message(t, &v.open_blockers(&id));
                let key = v.key_of(&id);
                self.cmd_on(term.machine, Command::QueueFollowUp { term: term.term, text, first: false, operation: None });
                self.notify(format!("sent {key} to {}", p.session), false);
                Some(Page::Ticket { id, scroll: 0 })
            }
            _ => Some(Page::Send { id, scroll: scroll_moved(scroll, k) }),
        }
    }

    fn on_comment_key(&mut self, _v: &mut TicketsView, k: &KeyEvent, id: String, mut text: String, mut problem: Option<String>) -> Option<Page> {
        match k.code {
            KeyCode::Esc => return Some(Page::Ticket { id, scroll: 0 }),
            KeyCode::Tab => {
                return match maitty_shared::tickets::clean_comment(&text) {
                    Ok(clean) => Some(Page::Review { id, write: TicketWrite::Comment { text: clean }, state: WriteState::Ready, scroll: 0 }),
                    Err(e) => Some(Page::Comment { id, text, problem: Some(tk::write_failure(Provider::Github, &e)) }),
                };
            }
            KeyCode::Enter => push_text(&mut text, "\n", TICKET_COMMENT_MAX_CHARS + 1),
            KeyCode::Backspace => {
                text.pop();
            }
            KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                push_text(&mut text, &c.to_string(), TICKET_COMMENT_MAX_CHARS + 1);
            }
            _ => return Some(Page::Comment { id, text, problem }),
        }
        problem = None;
        Some(Page::Comment { id, text, problem })
    }

    fn on_review_key(&mut self, v: &mut TicketsView, k: &KeyEvent, id: String, write: TicketWrite, state: WriteState, scroll: usize) -> Option<Page> {
        if state == WriteState::Sending {
            // Nothing changes while the write is out; Esc leaves it to finish behind the page.
            return Some(if k.code == KeyCode::Esc { Page::Ticket { id, scroll: 0 } } else { Page::Review { id, write, state, scroll } });
        }
        match k.code {
            KeyCode::Esc => Some(Page::Ticket { id, scroll: 0 }),
            KeyCode::Char('e') if matches!(write, TicketWrite::Comment { .. }) => {
                let TicketWrite::Comment { text } = write else { return None };
                Some(Page::Comment { id, text, problem: None })
            }
            // `y` (or a click on the confirm button) and nothing else writes.
            KeyCode::Char('y') => {
                let Some((source, _)) = v.list.of.clone() else { return Some(Page::Review { id, write, state, scroll }) };
                let sent = write.clone();
                let ticket = id.clone();
                let asked = self.ask_tickets(v, Asked::Write { id: id.clone() }, |tag| Query::TicketWrite {
                    source,
                    id: ticket,
                    write: sent,
                    confirmed: true,
                    tag,
                });
                let state = if asked { WriteState::Sending } else { WriteState::Refused("Restart the Maitty service to write to tickets.".into()) };
                Some(Page::Review { id, write, state, scroll })
            }
            _ => Some(Page::Review { id, write, state, scroll: scroll_moved(scroll, k) }),
        }
    }

    fn on_sources_key(&mut self, v: &mut TicketsView, k: &KeyEvent, mut s: Sources) -> Option<Page> {
        let Some(p) = v.project.clone() else { return Some(Page::List) };
        // Setting up goes back to the list whenever it is left or done.
        let back = |s: Sources| Some(if s.setup { Page::List } else { Page::Sources(s) });
        if let Some(mut typed) = s.paste.take() {
            match k.code {
                KeyCode::Esc => return back(s),
                // Tab: the details typed by hand instead.
                KeyCode::Tab => return self.setup_after_paste(v, None),
                KeyCode::Enter if typed.trim().is_empty() => return self.setup_after_paste(v, None),
                KeyCode::Enter => match parse_ticket_link(&typed) {
                    Ok(pasted) if pasted_provider(&pasted) == v.provider => return self.setup_after_paste(v, Some(pasted)),
                    Ok(pasted) => {
                        let other = pasted_provider(&pasted).name();
                        s.note = Some((format!("That is a {other} link: paste it on the {other} tab"), true));
                    }
                    Err(why) => s.note = Some((why.to_string(), true)),
                },
                KeyCode::Backspace => {
                    typed.pop();
                    s.note = None;
                }
                KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                    push_capped(&mut typed, &c.to_string());
                    s.note = None;
                }
                _ => {}
            }
            s.paste = Some(typed);
            return Some(Page::Sources(s));
        }
        if let Some(mut f) = s.form.take() {
            if f.sending {
                s.form = Some(f);
                return Some(Page::Sources(s));
            }
            match k.code {
                KeyCode::Esc => return back(s),
                KeyCode::Tab | KeyCode::Down => f.at = (f.at + 1) % f.fields(),
                KeyCode::BackTab | KeyCode::Up => f.at = (f.at + f.fields() - 1) % f.fields(),
                KeyCode::Backspace => {
                    f.text_mut().pop();
                    f.error = None;
                }
                KeyCode::Enter => {
                    let key = std::mem::take(&mut f.key);
                    if key.0.trim().is_empty() {
                        f.error = Some("Paste the API key first.".into());
                    } else {
                        let change = TicketKeyChange::Set {
                            provider: f.provider,
                            address: f.address.trim().to_string(),
                            workspace: f.workspace.trim().to_string(),
                            key: crate::protocol::SecretText(key.0.trim().to_string()),
                        };
                        f.sending = true;
                        f.error = None;
                        self.ask_ticket_keys(v, change);
                    }
                }
                KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                    push_capped(f.text_mut(), &c.to_string());
                    f.error = None;
                }
                _ => {}
            }
            s.form = Some(f);
            return Some(Page::Sources(s));
        }
        if let Some(provider) = s.remove.take() {
            if k.code == KeyCode::Char('y') {
                self.ask_ticket_keys(v, TicketKeyChange::Remove { provider });
                s.note = Some((format!("{} key removed from this computer", capital(provider.name())), false));
            }
            return Some(Page::Sources(s));
        }
        if let Some((provider, sel)) = s.pick.take() {
            let source = provider.keyed().map_or("", TicketProvider::name).to_string();
            let tops: Vec<Picked> = match v.groups.get(&source) {
                Some(Ok(g)) => tk::tops(g).into_iter().filter_map(tk::picked).collect(),
                _ => Vec::new(),
            };
            match k.code {
                KeyCode::Esc => return back(s),
                KeyCode::Enter => {
                    if let Some(chosen) = tops.get(sel).cloned() {
                        let name = chosen.name.clone();
                        let saved = self.set_ticket_link(v, |l| {
                            if provider == Provider::Plane {
                                l.plane = Some(chosen);
                            } else {
                                l.linear = Some(chosen);
                            }
                        });
                        if saved {
                            self.notify(format!("{} reads {name} for {}", provider.name(), p.name), false);
                            v.provider = provider;
                            v.scope = None;
                            self.tickets_reload(v);
                            return back(s);
                        }
                    }
                    s.pick = Some((provider, sel));
                }
                _ => s.pick = Some((provider, moved(sel, tops.len(), k))),
            }
            return Some(Page::Sources(s));
        }
        if let Some((row, mut typed)) = s.edit.take() {
            match k.code {
                KeyCode::Esc => return back(s),
                KeyCode::Enter => {
                    if row == SourceRow::GithubRepo {
                        let repo = if typed.trim().is_empty() { None } else { tk::typed_repo(&typed) };
                        if !typed.trim().is_empty() && repo.is_none() {
                            s.note = Some(("A GitHub repo is owner/name".into(), true));
                            s.edit = Some((row, typed));
                            return Some(Page::Sources(s));
                        }
                        if s.setup && repo.is_none() {
                            s.note = Some(("Type the repository as owner/name".into(), true));
                            s.edit = Some((row, typed));
                            return Some(Page::Sources(s));
                        }
                        let said = repo.clone().map_or_else(|| "GitHub follows the folder's origin".to_string(), |r| format!("GitHub reads {r} for {}", p.name));
                        if !self.set_ticket_link(v, |l| l.github = repo) {
                            s.edit = Some((row, typed));
                            return Some(Page::Sources(s));
                        }
                        s.note = Some((said.clone(), false));
                        if v.provider == Provider::Github {
                            self.tickets_reload(v);
                        }
                        if s.setup {
                            self.notify(said, false);
                            return back(s);
                        }
                    } else if let Some(provider) = row.provider() {
                        self.set_ticket_me(v, provider, &typed);
                        s.note = Some((format!("your {} name is saved for Mine", provider.name()), false));
                    }
                }
                KeyCode::Backspace => {
                    typed.pop();
                    s.edit = Some((row, typed));
                }
                KeyCode::Char(c) if !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                    push_capped(&mut typed, &c.to_string());
                    s.edit = Some((row, typed));
                }
                _ => s.edit = Some((row, typed)),
            }
            return Some(Page::Sources(s));
        }
        let rows = v.source_rows();
        let row = rows[s.sel.min(rows.len() - 1)];
        let link = v.link();
        let has_key = |provider: TicketProvider| v.keys_known().is_some_and(|k| k.iter().any(|k| k.provider == provider && k.set));
        s.note = None;
        match k.code {
            KeyCode::Esc => return Some(Page::List),
            KeyCode::Enter => match row {
                SourceRow::GithubRepo => s.edit = Some((row, link.github.clone().unwrap_or_default())),
                SourceRow::Other(_) => s.note = Some(("Open a session in that project to change what it reads; x unlinks it".into(), false)),
                r if r.is_name() => {
                    let provider = r.provider().unwrap_or(Provider::Github);
                    s.edit = Some((row, self.ticket_me(v, provider)));
                }
                SourceRow::PlaneKey | SourceRow::LinearKey => {
                    let provider = if row == SourceRow::PlaneKey { TicketProvider::Plane } else { TicketProvider::Linear };
                    s.form = Some(KeyForm::new(provider, v.keys_known()));
                }
                _ => {
                    let provider = if row == SourceRow::PlaneProject { Provider::Plane } else { Provider::Linear };
                    let keyed = provider.keyed().unwrap_or(TicketProvider::Plane);
                    if !has_key(keyed) {
                        s.note = Some((format!("Add the {} key first", provider.name()), true));
                    } else {
                        self.ask_groups(v, keyed.name());
                        s.pick = Some((provider, 0));
                    }
                }
            },
            KeyCode::Char('x') | KeyCode::Delete => match row {
                SourceRow::GithubRepo => {
                    if self.set_ticket_link(v, |l| l.github = Some(String::new())) {
                        s.note = Some((format!("GitHub is off for {}", p.name), false));
                        self.tickets_reload(v);
                    }
                }
                SourceRow::PlaneKey | SourceRow::LinearKey => {
                    let provider = if row == SourceRow::PlaneKey { TicketProvider::Plane } else { TicketProvider::Linear };
                    if has_key(provider) {
                        s.remove = Some(provider);
                    }
                }
                SourceRow::PlaneProject => {
                    self.set_ticket_link(v, |l| l.plane = None);
                }
                SourceRow::LinearTeam => {
                    self.set_ticket_link(v, |l| l.linear = None);
                }
                SourceRow::Other(i) => {
                    if let Some(other) = v.other_projects().get(i).copied() {
                        let place = TicketPlace { machine: other.machine.clone(), folder: other.folder.clone() };
                        s.note = Some((format!("{} is unlinked", folder_name(Path::new(&other.folder))), false));
                        self.ask_ticket_links(v, TicketLinkChange::Unlink { place });
                        s.sel = s.sel.min(rows.len().saturating_sub(2));
                    }
                }
                r => {
                    if let Some(provider) = r.provider() {
                        self.set_ticket_me(v, provider, "");
                    }
                }
            },
            _ => s.sel = moved(s.sel, rows.len(), k),
        }
        Some(Page::Sources(s))
    }
}

/// The groups the scope page offers for the shown source.
fn scope_groups(v: &TicketsView) -> Vec<Group> {
    let Source::Linked { source, top, .. } = v.source(&v.link(), v.provider) else { return Vec::new() };
    match v.groups.get(&source) {
        Some(Ok(g)) => tk::groups_under(g, top.as_deref()).into_iter().cloned().collect(),
        _ => Vec::new(),
    }
}

fn scroll_moved(scroll: usize, k: &KeyEvent) -> usize {
    match k.code {
        KeyCode::Down | KeyCode::Char('j') => scroll + 1,
        KeyCode::Up | KeyCode::Char('k') => scroll.saturating_sub(1),
        KeyCode::PageDown | KeyCode::Char(' ') => scroll + 10,
        KeyCode::PageUp => scroll.saturating_sub(10),
        KeyCode::Home => 0,
        _ => scroll,
    }
}

// ---- drawing ----------------------------------------------------------------------------------

/// Lines of text drawn from `scroll`, as many as fit `r`; returns the scroll held in range.
fn draw_lines(buf: &mut Buffer, r: Rect, lines: &[Vec<Seg>], scroll: usize) -> usize {
    let h = r.height as usize;
    let scroll = scroll.min(lines.len().saturating_sub(h));
    for (i, l) in lines.iter().skip(scroll).take(h).enumerate() {
        put(buf, r.x, r.y + i as u16, l, r.right());
    }
    scroll
}

/// `text` word-wrapped to `w` columns, each line in `st`.
fn wrapped(text: &str, w: u16, st: Style) -> Vec<Vec<Seg>> {
    crate::client::views::wrap(text, w as usize).into_iter().map(|l| vec![seg(l, st)]).collect()
}

/// `text` as a quote box: each wrapped line after a `│ ` in the line colour.
fn boxed(text: &str, w: u16, st: Style, line: Style) -> Vec<Vec<Seg>> {
    let mut out = Vec::new();
    for para in text.split('\n') {
        let rows = crate::client::views::wrap(para, w.saturating_sub(2) as usize);
        for l in if rows.is_empty() { vec![String::new()] } else { rows } {
            out.push(vec![seg("│ ", line), seg(l, st)]);
        }
    }
    out
}

/// The buttons at the bottom of a review page: each a keycap and its label, clickable.
fn buttons(app: &mut App, buf: &mut Buffer, x: u16, y: u16, right: u16, t: &Theme, items: &[(char, &str, &str, BtnKind)]) {
    let mut at = x;
    for (c, key, label, kind) in items {
        let b = button(t, label, key, *kind);
        let w = segs_width(&b);
        if at + w > right {
            break;
        }
        put(buf, at, y, &b, right);
        let hit = match c {
            '\x1b' => Btn::ViewChord(KeyCode::Esc, KeyModifiers::NONE),
            '\t' => Btn::ViewChord(KeyCode::Tab, KeyModifiers::NONE),
            c => Btn::ViewKey(*c),
        };
        app.hits.push((Rect { x: at, y, width: w, height: 1 }, Hit::Button(hit)));
        at += w + 2;
    }
}

/// The Tickets view inside the side panel; `bg` is the panel's ground.
pub(in crate::client) fn draw_tickets(app: &mut App, buf: &mut Buffer, body: Rect, bg: Color, t: &Theme, v: &mut TicketsView) {
    let c = Style::default().bg(bg);
    let r = Rect { x: body.x + 1, width: body.width.saturating_sub(2), ..body };
    let inner = Rect { x: r.x + 1, width: r.width.saturating_sub(2), ..r };
    if v.old_daemon {
        let lines = wrapped("The Maitty service on this computer is older than tickets. Restart it to read them: Restart maitty, in Search commands (Ctrl+K).", inner.width, c.fg(t.muted));
        draw_lines(buf, Rect { y: inner.y + 1, ..inner }, &lines, 0);
        return;
    }
    let Some(p) = v.project.clone() else {
        put(buf, inner.x, inner.y + 1, &[seg("Open a session first", c.fg(t.strong).add_modifier(Modifier::BOLD))], inner.right());
        let lines = wrapped("Tickets shows the tickets of the project the session in front works in.", inner.width, c.fg(t.muted));
        draw_lines(buf, Rect { y: inner.y + 3, height: inner.height.saturating_sub(3), ..inner }, &lines, 0);
        return;
    };
    match v.page.clone() {
        Page::List => draw_list(app, buf, r, inner, c, t, v, &p),
        Page::Ticket { id, scroll } => {
            let s = draw_ticket(app, buf, inner, c, t, v, &id, scroll);
            v.page = Page::Ticket { id, scroll: s };
        }
        Page::Scope { sel } => draw_scope(app, buf, r, inner, c, t, v, sel),
        Page::Sources(s) => draw_sources(app, buf, r, inner, c, t, v, &p, &s),
        Page::Start { id, agent, scroll } => {
            let s = draw_start(app, buf, inner, c, t, v, &p, &id, agent, scroll);
            v.page = Page::Start { id, agent, scroll: s };
        }
        Page::Send { id, scroll } => {
            let s = draw_send(app, buf, inner, c, t, v, &p, &id, scroll);
            v.page = Page::Send { id, scroll: s };
        }
        Page::Comment { id, text, problem } => draw_comment(app, buf, inner, c, t, v, &id, &text, problem.as_deref()),
        Page::Review { id, write, state, scroll } => {
            let s = draw_review(app, buf, inner, c, t, v, &id, &write, &state, scroll);
            v.page = Page::Review { id, write, state, scroll: s };
        }
    }
}

/// The provider tabs: each name, the shown one bold in the accent, an unlinked one dim.
fn draw_tabs(buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, p: &TicketsProject) {
    let link = v.link();
    let mut segs = Vec::new();
    for provider in Provider::ALL {
        let linked = v.source(&link, provider).linked();
        let st = if provider == v.provider {
            c.fg(t.accent).add_modifier(Modifier::BOLD | Modifier::UNDERLINED)
        } else if linked {
            c.fg(t.text)
        } else {
            c.fg(t.muted)
        };
        segs.push(seg(provider.name(), st));
        if !linked {
            segs.push(seg(" –", c.fg(t.muted)));
        }
        segs.push(seg("   ", c));
    }
    put(buf, inner.x, inner.y, &segs, inner.right());
    let name = truncate(&p.name, (inner.width / 3) as usize);
    let nw = name.width() as u16;
    if segs_width(&segs) + nw + 1 < inner.width {
        put(buf, inner.right().saturating_sub(nw), inner.y, &[seg(name, c.fg(t.muted))], inner.right());
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_list(app: &mut App, buf: &mut Buffer, r: Rect, inner: Rect, c: Style, t: &Theme, v: &mut TicketsView, p: &TicketsProject) {
    draw_tabs(buf, inner, c, t, v, p);
    let link = v.link();
    let me = app.ticket_me(v, v.provider);
    // The search line and the filters at its right.
    let y = inner.y + 1;
    let search: Vec<Seg> = if v.typing {
        vec![seg("/ ", c.fg(t.accent)), seg(tk::shown(&v.search, false), c.fg(t.strong)), seg("▏", c.fg(t.accent))]
    } else if v.search.is_empty() {
        vec![seg("/ search", c.fg(t.muted))]
    } else {
        vec![seg("/ ", c.fg(t.muted)), seg(tk::shown(&v.search, false), c.fg(t.text))]
    };
    let mut filters = vec![if v.show_closed { "all states" } else { "open" }.to_string()];
    if v.mine {
        filters.push("mine".into());
    }
    if let Some(s) = &v.scope {
        filters.push(truncate(&s.name, 18));
    }
    let filters = filters.join(" · ");
    let fw = filters.width() as u16;
    put(buf, inner.x, y, &search, inner.right().saturating_sub(fw + 2));
    put(buf, inner.right().saturating_sub(fw), y, &[seg(filters, c.fg(t.muted))], inner.right());
    let area = Rect { y: inner.y + 3, height: inner.height.saturating_sub(3), ..inner };
    let say = |buf: &mut Buffer, lines: Vec<Vec<Seg>>| {
        draw_lines(buf, area, &lines, 0);
    };
    let source = v.source(&link, v.provider);
    if let Source::Unlinked(why) = source {
        if !v.setup_ready() {
            return say(buf, vec![vec![seg("reading…", c.fg(t.muted).add_modifier(Modifier::ITALIC))]]);
        }
        return say(buf, setup_lines(v, p, why, area.width, c, t));
    }
    let shown = v.shown(&me);
    let has_data = v.list.read_at.is_some();
    // A failure over a list already read is a line at the bottom; with nothing read, it is the page.
    if let Some(e) = &v.list.error
        && !has_data
    {
        let mut lines = vec![vec![seg(tk::read_failure(v.provider, e), c.fg(if matches!(e, TicketError::RateLimited) { t.muted } else { t.err }))]];
        lines = lines.into_iter().flat_map(|l| wrapped(&l[0].0, area.width, l[0].1)).collect();
        lines.push(vec![]);
        match e {
            TicketError::SignedOut if v.provider == Provider::Github => {
                lines.push([crate::client::design::keycap(t, "t"), vec![seg(" sign in (runs gh auth login in a new shell)", c.fg(t.muted))]].concat());
            }
            TicketError::SignedOut | TicketError::NotInstalled => {
                lines.push([crate::client::design::keycap(t, ","), vec![seg(" replace the key in Sources", c.fg(t.muted))]].concat());
            }
            TicketError::RateLimited => {}
            _ => lines.push([crate::client::design::keycap(t, "r"), vec![seg(" try again", c.fg(t.muted))]].concat()),
        }
        return say(buf, lines);
    }
    if v.list.loading && !has_data {
        // Skeleton rows while the first page is read.
        let mut lines = vec![vec![seg("reading tickets…", c.fg(t.muted).add_modifier(Modifier::ITALIC))], vec![]];
        for w in [28usize, 36, 22] {
            lines.push(vec![seg(format!("□ ░░░  {}", "░".repeat(w.min(area.width.saturating_sub(8) as usize))), c.fg(t.line))]);
        }
        return say(buf, lines);
    }
    // A failure over a list already read: its words, then what is shown, on the last two rows.
    let failed = match (&v.list.error, v.list.read_at) {
        (Some(e), Some(at)) => Some((tk::read_failure(v.provider, e), format!("showing what was read {} ago · r retries", age_of(at)))),
        _ => None,
    };
    let foot = match &failed {
        Some((_, shown_words)) => Some((shown_words.clone(), t.muted)),
        None => {
            let hidden = if v.show_closed { 0 } else { v.hidden_closed() };
            let mut words = format!("{} ticket{}", shown.len(), if shown.len() == 1 { "" } else { "s" });
            if hidden > 0 {
                words.push_str(&format!(" · {hidden} closed hidden · a shows them"));
            }
            if v.list.loading {
                words.push_str(" · reading…");
            } else if v.list.more {
                words.push_str(" · more below");
            }
            Some((words, t.muted))
        }
    };
    let rows = Rect { height: area.height.saturating_sub(u16::from(foot.is_some()) + u16::from(failed.is_some())), ..area };
    if let Some((words, fg)) = foot {
        put(buf, inner.x, area.bottom().saturating_sub(1), &[seg(truncate(&words, inner.width as usize), c.fg(fg))], inner.right());
    }
    if let Some((why, _)) = &failed {
        put(buf, inner.x, area.bottom().saturating_sub(2), &[seg(truncate(why, inner.width as usize), c.fg(t.err))], inner.right());
    }
    if shown.is_empty() {
        let words = if !v.search.trim().is_empty() {
            format!("Nothing matches “{}” · Esc clears the search", tk::shown(v.search.trim(), false))
        } else if v.mine {
            "Nothing assigned to you here · m shows everyone's".to_string()
        } else {
            "No open tickets here".to_string()
        };
        put(buf, inner.x, rows.y, &[seg(truncate(&words, inner.width as usize), c.fg(t.muted))], inner.right());
        return;
    }
    let ids: Vec<(String, String, String, StateCategory, String)> = shown
        .iter()
        .map(|s| (s.id.clone(), tk::ticket_key(&s.id, &s.url), tk::shown(&s.title, false), s.state.category, tk::unix_of(&s.updated_at).map(age).unwrap_or_default()))
        .collect();
    v.sel = v.sel.min(ids.len().saturating_sub(1));
    let h = rows.height as usize;
    v.scroll = v.scroll.min(v.sel).max((v.sel + 1).saturating_sub(h));
    let full = r.width >= FULL_ROW_FROM;
    let look = Look::of(&app.cfg.ui);
    let key_w = ids.iter().map(|(_, k, ..)| k.width()).max().unwrap_or(0).min(10) as u16;
    for (i, (_, key, title, category, when)) in ids.iter().enumerate().skip(v.scroll).take(h) {
        let rr = Rect { x: r.x, y: rows.y + (i - v.scroll) as u16, width: r.width, height: 1 };
        let sel = i == v.sel;
        let row_bg = if sel {
            let sb = t.sel_on(c.bg.unwrap_or(t.bg));
            row_pill(look, buf, rr.x, rr.y, rr.width, sb, c.bg.unwrap_or(t.bg));
            put(buf, rr.x + 1, rr.y, &[seg("▎", Style::default().fg(t.accent).bg(sb).add_modifier(Modifier::BOLD))], rr.right());
            sb
        } else if hovered(app, rr) {
            fill(buf, rr, t.hov);
            t.hov
        } else {
            c.bg.unwrap_or(t.bg)
        };
        app.hits.push((rr, Hit::Button(Btn::Row(i))));
        let st = Style::default().bg(row_bg);
        let glyph_fg = match category {
            StateCategory::Open => t.text,
            StateCategory::Started => t.working,
            StateCategory::Closed => t.muted,
        };
        let meta = if full { when.clone() } else { String::new() };
        let mw = meta.width() as u16;
        let x = rr.x + 2;
        let title_st = if sel { st.fg(t.strong).add_modifier(Modifier::BOLD) } else if *category == StateCategory::Closed { st.fg(t.muted) } else { st.fg(t.text) };
        let segs = vec![
            seg(tk::category_glyph(*category), st.fg(glyph_fg)),
            seg(" ", st),
            seg(format!("{key:<w$}", w = key_w as usize), st.fg(t.muted)),
            seg("  ", st),
            seg(title.clone(), title_st),
        ];
        put(buf, x, rr.y, &segs, rr.right().saturating_sub(mw + 2));
        if mw > 0 {
            put(buf, rr.right().saturating_sub(mw + 1), rr.y, &[seg(meta, st.fg(t.muted))], rr.right());
        }
    }
}

/// The setup of a source the project in front does not read yet, in place of its tickets: each
/// step, done or not, says whether it is once for every project or for this one.
fn setup_lines(v: &TicketsView, p: &TicketsProject, why: Unlinked, w: u16, c: Style, t: &Theme) -> Vec<Vec<Seg>> {
    let name = v.provider.name();
    let step = |n: &str, done: bool, title: String| {
        let mark = if done { seg(" ✓ ", c.fg(t.accent).add_modifier(Modifier::BOLD)) } else { seg(format!(" {n} "), c.fg(t.muted)) };
        vec![mark, seg(" ", c), seg(title, c.fg(if done { t.text } else { t.strong }))]
    };
    let mut lines = vec![vec![seg(format!("Set up {name} for {}", p.name), c.fg(t.strong).add_modifier(Modifier::BOLD))], vec![]];
    let hint = |lines: &mut Vec<Vec<Seg>>, text: &str| {
        lines.extend(wrapped(text, w.saturating_sub(5), c.fg(t.muted)).into_iter().map(|l| [vec![seg("     ", c)], l].concat()));
    };
    let enter = match v.provider.keyed() {
        None => {
            lines.push(step("1", true, "GitHub uses your gh login".into()));
            hint(&mut lines, "There is no key to paste: Maitty reads issues with the GitHub command line's own sign-in.");
            let off = v.link().github.as_deref() == Some("");
            lines.push(step("2", false, if off { format!("GitHub is off for {}", p.name) } else { format!("Which repository are {}'s issues in?", p.name) }));
            hint(&mut lines, if off { "Type the repository to read, or follow the folder's origin again in Sources (,)." } else { "The folder has no GitHub origin. Type the repository as owner/name." });
            "type owner/name"
        }
        Some(_) => {
            let connected = why != Unlinked::NoKey;
            let word = v.provider.top_word();
            lines.push(step("1", connected, if connected { format!("{name} is connected on this computer") } else { format!("Connect {name}") }));
            hint(&mut lines, if connected { "For every project. Replace or remove the key in Sources (,)." } else { "You do this once on this computer: the key is kept by the Maitty service, used for every project, and never shown again." });
            lines.push(step("2", false, format!("Pick the {name} {word} for {}", p.name)));
            hint(&mut lines, &format!("Then every session in {} shows that {word}'s tickets.", p.name));
            if connected { "pick it" } else { "connect" }
        }
    };
    lines.push(vec![]);
    lines.push([crate::client::design::keycap(t, "Enter"), vec![seg(format!(" {enter}, or paste a link to the project here"), c.fg(t.muted))]].concat());
    lines.extend(wrapped(&saved_for(&p.name), w, c.fg(t.muted)));
    for failed in [v.links.as_ref().and_then(|l| l.as_ref().err()), v.keys.as_ref().and_then(|k| k.as_ref().err())].into_iter().flatten() {
        lines.push(vec![]);
        lines.extend(wrapped(&tk::read_failure(v.provider, failed), w, c.fg(t.err)));
    }
    lines
}

/// How long ago `at` was, said short ("40s", "3m").
fn age_of(at: Instant) -> String {
    age(now_secs().saturating_sub(at.elapsed().as_secs()))
}

#[allow(clippy::too_many_arguments)]
fn draw_ticket(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, id: &str, scroll: usize) -> usize {
    let provider = Provider::of_id(id).unwrap_or(v.provider);
    let key = v.key_of(id);
    let summary = v.detail(id).map(|d| &d.summary).or_else(|| v.summary(id));
    let w = inner.width;
    let mut lines: Vec<Vec<Seg>> = Vec::new();
    let state = summary.map(|s| if s.state.name.is_empty() { tk::category_word(s.state.category).to_string() } else { tk::shown(&s.state.name, false) }).unwrap_or_default();
    lines.push(vec![seg(format!("‹ {key} · {state} · {}", provider.name()), c.fg(t.muted))]);
    lines.push(vec![]);
    if let Some(s) = summary {
        lines.extend(wrapped(&tk::shown(&s.title, false), w, c.fg(t.strong).add_modifier(Modifier::BOLD)));
        lines.push(vec![]);
        let row = |label: &str, value: String, fg: Color| vec![seg(format!("{label:<10} "), c.fg(t.muted)), seg(value, c.fg(fg))];
        if !s.labels.is_empty() {
            lines.push(row("labels", tk::shown(&s.labels.join(", "), false), t.text));
        }
        lines.push(row("assignee", s.assignee.as_deref().map_or("nobody".into(), |a| tk::shown(a, false)), t.text));
        if let Some(when) = tk::unix_of(&s.updated_at) {
            lines.push(row("updated", format!("{} ago", age(when)), t.text));
        }
        if !s.url.is_empty() {
            lines.push(row("link", format!("↗ {}", s.url), t.accent));
        }
    }
    let blockers = v.open_blockers(id);
    if !blockers.is_empty() {
        lines.push(vec![seg(format!("{:<10} ", "blocked by"), c.fg(t.muted)), seg(blockers.join(", "), c.fg(t.err))]);
    }
    lines.push(vec![]);
    match v.tickets.get(id) {
        None => lines.push(vec![seg("reading the ticket…", c.fg(t.muted).add_modifier(Modifier::ITALIC))]),
        Some(Err(e)) => {
            lines.extend(wrapped(&tk::read_failure(provider, e), w, c.fg(t.err)));
            lines.push([crate::client::design::keycap(t, "r"), vec![seg(" try again", c.fg(t.muted))]].concat());
        }
        Some(Ok(d)) => {
            let body = tk::shown(d.body.trim(), true);
            if body.is_empty() {
                lines.push(vec![seg("(no description)", c.fg(t.muted))]);
            } else {
                lines.extend(wrapped(&body, w, c.fg(t.text)));
            }
            lines.push(vec![]);
            let more = if d.comments_more { " (the newest are not shown)" } else { "" };
            lines.push(vec![seg(format!("comments {}{more}", d.comments.len()), c.fg(t.muted).add_modifier(Modifier::BOLD))]);
            for cm in &d.comments {
                lines.push(vec![]);
                let when = tk::unix_of(&cm.created_at).map(|u| format!(" · {} ago", age(u))).unwrap_or_default();
                lines.push(vec![seg(format!("{}{when}", tk::shown(&cm.author, false)), c.fg(t.muted))]);
                lines.extend(wrapped(&tk::shown(cm.body.trim(), true), w, c.fg(t.text)));
            }
        }
    }
    let _ = app;
    draw_lines(buf, inner, &lines, scroll)
}

#[allow(clippy::too_many_arguments)]
fn draw_scope(app: &mut App, buf: &mut Buffer, r: Rect, inner: Rect, c: Style, t: &Theme, v: &TicketsView, sel: usize) {
    put(buf, inner.x, inner.y, &[seg("Narrow the list to", c.fg(t.strong).add_modifier(Modifier::BOLD))], inner.right());
    let Source::Linked { source, .. } = v.source(&v.link(), v.provider) else { return };
    let mut names = vec![("all".to_string(), "everything".to_string())];
    match v.groups.get(&source) {
        None => {
            put(buf, inner.x, inner.y + 2, &[seg("reading…", c.fg(t.muted).add_modifier(Modifier::ITALIC))], inner.right());
            return;
        }
        Some(Err(e)) => {
            draw_lines(buf, Rect { y: inner.y + 2, height: inner.height.saturating_sub(2), ..inner }, &wrapped(&tk::read_failure(v.provider, e), inner.width, c.fg(t.err)), 0);
            return;
        }
        Some(Ok(_)) => {}
    }
    for g in scope_groups(v) {
        let count = g.ticket_count.map(|n| format!("  {n}")).unwrap_or_default();
        names.push((tk::kind_word(v.provider, g.kind).to_string(), format!("{}{count}", tk::shown(&g.name, false))));
    }
    let rows: Vec<String> = names.iter().map(|(kind, name)| format!("{kind:<10} {name}")).collect();
    pick_rows(app, buf, Rect { x: r.x, y: inner.y + 2, width: r.width, height: inner.height.saturating_sub(2) }, c, t, &rows, sel);
}

/// Rows to choose from, the chosen one lit.
fn pick_rows(app: &mut App, buf: &mut Buffer, r: Rect, c: Style, t: &Theme, rows: &[String], sel: usize) {
    let look = Look::of(&app.cfg.ui);
    let h = r.height as usize;
    let first = (sel + 1).saturating_sub(h);
    for (i, text) in rows.iter().enumerate().skip(first).take(h) {
        let rr = Rect { y: r.y + (i - first) as u16, height: 1, ..r };
        let ground = c.bg.unwrap_or(t.bg);
        let row_bg = if i == sel {
            let sb = t.sel_on(ground);
            row_pill(look, buf, rr.x, rr.y, rr.width, sb, ground);
            put(buf, rr.x + 1, rr.y, &[seg("▎", Style::default().fg(t.accent).bg(sb))], rr.right());
            sb
        } else {
            ground
        };
        app.hits.push((rr, Hit::Button(Btn::Row(i))));
        let st = Style::default().bg(row_bg).fg(if i == sel { t.strong } else { t.text });
        put(buf, rr.x + 2, rr.y, &[seg(text.clone(), st)], rr.right().saturating_sub(1));
    }
}

#[allow(clippy::too_many_arguments)]
fn draw_sources(app: &mut App, buf: &mut Buffer, r: Rect, inner: Rect, c: Style, t: &Theme, v: &TicketsView, p: &TicketsProject, s: &Sources) {
    let title = if s.setup { format!("Set up {} for {}", v.provider.name(), p.name) } else { "Ticket sources".to_string() };
    put(buf, inner.x, inner.y, &[seg(title, c.fg(t.strong).add_modifier(Modifier::BOLD))], inner.right());
    let mut y = inner.y + 1;
    if let Some((note, err)) = &s.note {
        put(buf, inner.x, y, &[seg(truncate(note, inner.width as usize), c.fg(if *err { t.err } else { t.accent }))], inner.right());
    }
    y += 2;
    let room = Rect { y, height: inner.bottom().saturating_sub(y), ..inner };
    if let Some(typed) = &s.paste {
        let what = match v.provider {
            Provider::Github => "repository",
            Provider::Plane => "Plane project",
            Provider::Linear => "Linear team",
        };
        let example = match v.provider {
            Provider::Github => "https://github.com/owner/name",
            Provider::Plane => "https://app.plane.so/workspace/projects/…",
            Provider::Linear => "https://linear.app/team-name/team/ENG",
        };
        let field = if typed.is_empty() { seg(example.to_string(), c.fg(t.muted)) } else { seg(tk::shown(typed, false), c.fg(t.strong)) };
        let lines = [
            wrapped(&format!("Paste a link to your {what}: any page of it, copied from the browser. The rest is filled from it."), room.width, c.fg(t.text)),
            vec![vec![]],
            vec![vec![seg("link       ", c.fg(t.accent)), field, seg("▏", c.fg(t.accent))]],
            vec![vec![]],
            wrapped("Enter uses the link · Tab enters the details instead · Esc goes back", room.width, c.fg(t.muted)),
        ]
        .concat();
        draw_lines(buf, room, &lines, 0);
        return;
    }
    if let Some(f) = &s.form {
        return draw_key_form(buf, room, c, t, f);
    }
    if let Some(provider) = s.remove {
        let lines = [
            wrapped(&format!("Remove the {} key from this computer? Tickets stops reading {} for every project until a key is added again.", capital(provider.name()), capital(provider.name())), room.width, c.fg(t.text)),
            vec![vec![]],
        ]
        .concat();
        draw_lines(buf, room, &lines, 0);
        buttons(app, buf, room.x, room.y + lines.len() as u16, room.right(), t, &[('y', "y", "Remove key", BtnKind::Danger), ('\x1b', "Esc", "Keep it", BtnKind::Ghost)]);
        return;
    }
    if let Some((provider, sel)) = s.pick {
        let source = provider.keyed().map_or("", TicketProvider::name).to_string();
        put(buf, room.x, room.y, &[seg(format!("Pick the {} {} for {}", provider.name(), provider.top_word(), p.name), c.fg(t.text))], room.right());
        let list = Rect { x: r.x, y: room.y + 2, width: r.width, height: room.height.saturating_sub(4) };
        match v.groups.get(&source) {
            None => {
                put(buf, room.x, list.y, &[seg("reading…", c.fg(t.muted).add_modifier(Modifier::ITALIC))], room.right());
            }
            Some(Err(e)) => {
                draw_lines(buf, Rect { x: room.x, width: room.width, ..list }, &wrapped(&tk::read_failure(provider, e), room.width, c.fg(t.err)), 0);
            }
            Some(Ok(g)) => {
                let rows: Vec<String> = tk::tops(g).into_iter().map(|g| tk::shown(&g.name, false)).collect();
                if rows.is_empty() {
                    put(buf, room.x, list.y, &[seg(format!("{} lists no {}", provider.name(), provider.top_word()), c.fg(t.muted))], room.right());
                } else {
                    pick_rows(app, buf, list, c, t, &rows, sel);
                    let foot = Rect { y: list.bottom(), height: room.bottom().saturating_sub(list.bottom()), ..room };
                    draw_lines(buf, foot, &wrapped(&saved_for(&p.name), room.width, c.fg(t.muted)), 0);
                }
            }
        }
        return;
    }
    if s.setup && let Some((_, typed)) = &s.edit {
        // GitHub's setup: only the repository, typed.
        let lines = [
            wrapped(&format!("Which repository are {}'s issues in? Type it as owner/name.", p.name), room.width, c.fg(t.text)),
            vec![vec![]],
            vec![vec![seg("repo       ", c.fg(t.accent)), seg(tk::shown(typed, false), c.fg(t.strong)), seg("▏", c.fg(t.accent))]],
            vec![vec![]],
            wrapped(&saved_for(&p.name), room.width, c.fg(t.muted)),
        ]
        .concat();
        draw_lines(buf, room, &lines, 0);
        return;
    }
    let link = v.link();
    let key_of = |provider: TicketProvider| v.keys_known().and_then(|k| k.iter().find(|k| k.provider == provider)).cloned();
    let head = |text: &str| (None, vec![seg(text.to_string(), c.fg(t.strong).add_modifier(Modifier::BOLD))]);
    let say = |text: &str| (None, vec![seg(text.to_string(), c.fg(t.muted))]);
    let others = v.other_projects();
    let rows = v.source_rows();
    let mut lines: Vec<(Option<usize>, Vec<Seg>)> = vec![head("ACCOUNTS"), say("Once on this computer, for every project.")];
    let mut in_projects = false;
    for (i, row) in rows.iter().enumerate() {
        if !in_projects && PROJECT_ROWS.contains(row) {
            in_projects = true;
            lines.push((None, vec![]));
            lines.push(head("LINKED PROJECTS"));
            lines.push(say("A project is its repository: every worktree and session in it shows the same tickets."));
            lines.push((None, vec![seg(format!("{} · the session in front", p.name), c.fg(t.text).add_modifier(Modifier::BOLD))]));
        }
        if matches!(row, SourceRow::Other(0)) {
            lines.push((None, vec![]));
            lines.push(say("Other linked projects"));
        }
        if *row == SourceRow::GithubName {
            lines.push((None, vec![seg(format!(" {:<10} ", "GitHub"), c.fg(t.muted)), seg("your gh login · no key", c.fg(t.text))]));
        }
        let (label, value, fg): (String, String, Color) = match row {
            SourceRow::GithubRepo => {
                let (value, fg) = match (&link.github, &v.origin) {
                    _ if v.links.is_none() => ("reading…".into(), t.muted),
                    (Some(r), _) if r.is_empty() => ("off".into(), t.muted),
                    (Some(r), _) => (r.clone(), t.text),
                    (None, Some(Some(r))) => (format!("{r} (from origin)"), t.text),
                    (None, None) => ("reading the folder's origin…".into(), t.muted),
                    (None, Some(None)) => ("not linked · Enter to type owner/name".into(), t.muted),
                };
                ("GitHub".into(), value, fg)
            }
            SourceRow::PlaneKey | SourceRow::LinearKey => {
                let provider = if *row == SourceRow::PlaneKey { Provider::Plane } else { Provider::Linear };
                let keyed = provider.keyed().unwrap_or(TicketProvider::Plane);
                let (value, fg) = match (&v.keys, key_of(keyed)) {
                    (None, _) => ("checking…".into(), t.muted),
                    (Some(Err(e)), _) => (tk::read_failure(provider, e), t.err),
                    (_, Some(k)) if k.set => {
                        let at = [k.address.as_str(), k.workspace.as_str()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" / ");
                        let refused = matches!(v.list.error, Some(TicketError::SignedOut)) && v.provider == provider;
                        if refused {
                            ("key refused · Enter to replace".into(), t.err)
                        } else if at.is_empty() {
                            ("connected · key saved".into(), t.text)
                        } else {
                            (format!("connected · {at}"), t.text)
                        }
                    }
                    _ => ("no key · Enter to connect".into(), t.muted),
                };
                (provider.name().into(), value, fg)
            }
            SourceRow::PlaneProject | SourceRow::LinearTeam => {
                let (provider, pick) = if *row == SourceRow::PlaneProject { (Provider::Plane, &link.plane) } else { (Provider::Linear, &link.linear) };
                let (value, fg) = match pick {
                    _ if v.links.is_none() => ("reading…".into(), t.muted),
                    Some(pick) => (pick.name.clone(), t.text),
                    None => (format!("no {} picked", provider.top_word()), t.muted),
                };
                (provider.name().into(), value, fg)
            }
            SourceRow::Other(i) => {
                let Some(other) = others.get(*i) else { continue };
                (folder_name(Path::new(&other.folder)), tk::shown(&link_summary(other), false), t.text)
            }
            r => {
                let provider = r.provider().unwrap_or(Provider::Github);
                let name = app.ticket_me(v, provider);
                if name.is_empty() { ("your name".into(), "not set (for Mine)".into(), t.muted) } else { ("your name".into(), name, t.text) }
            }
        };
        let editing = s.edit.as_ref().filter(|(r, _)| r == row).map(|(_, typed)| typed.clone());
        let value_segs = match editing {
            Some(typed) => vec![seg(tk::shown(&typed, false), c.fg(t.strong)), seg("▏", c.fg(t.accent))],
            None => vec![seg(value, c.fg(fg))],
        };
        lines.push((Some(i), [vec![seg(format!("{:<10} ", truncate(&label, 10)), c.fg(t.muted))], value_segs].concat()));
    }
    if let Some(Err(e)) = &v.links {
        lines.push((None, vec![]));
        lines.push((None, vec![seg(tk::read_failure(v.provider, e), c.fg(t.err))]));
    }
    lines.push((None, vec![]));
    lines.push(say("Keys stay with the Maitty service on this computer and are never shown again. It keeps the links and your Plane and Linear names too, so every window shows a project the same tickets."));
    // Long lines wrap; the selected row stays in sight.
    let mut drawn: Vec<(Option<usize>, Vec<Seg>)> = Vec::new();
    for (row, segs) in lines {
        if row.is_none() && segs.len() == 1 && segs_width(&segs) > room.width {
            for l in wrapped(&segs[0].0, room.width, segs[0].1) {
                drawn.push((None, l));
            }
        } else {
            drawn.push((row, segs));
        }
    }
    let at = drawn.iter().position(|(row, _)| *row == Some(s.sel)).unwrap_or(0);
    let skip = (at + 1).saturating_sub(room.height as usize);
    let look = Look::of(&app.cfg.ui);
    let ground = c.bg.unwrap_or(t.bg);
    for (n, (row, segs)) in drawn.iter().skip(skip).enumerate() {
        let y = room.y + n as u16;
        if y >= room.bottom() {
            break;
        }
        let rr = Rect { x: r.x, y, width: r.width, height: 1 };
        let mut segs = segs.clone();
        if let Some(i) = row {
            app.hits.push((rr, Hit::Button(Btn::Row(*i))));
            if *i == s.sel {
                let sb = t.sel_on(ground);
                row_pill(look, buf, rr.x, rr.y, rr.width, sb, ground);
                put(buf, rr.x + 1, rr.y, &[seg("▎", Style::default().fg(t.accent).bg(sb))], rr.right());
                segs = segs.into_iter().map(|(text, st)| (text, st.bg(sb))).collect();
            }
        }
        // One column in from the headers, clear of the selection's `▎`.
        let x = if row.is_some() { room.x + 1 } else { room.x };
        put(buf, x, y, &segs, room.right());
    }
}

/// One linked project said in a line: its machine (another computer's), its folder, and what it reads.
fn link_summary(project: &LinkedProject) -> String {
    let link = TicketLink::of_daemon(&project.link);
    let mut parts: Vec<String> = project.machine.iter().cloned().collect();
    parts.push(project.folder.clone());
    parts.push(match link.github.as_deref() {
        None => "GitHub from origin".into(),
        Some("") => "GitHub off".into(),
        Some(repo) => format!("GitHub {repo}"),
    });
    if let Some(pick) = &link.plane {
        parts.push(format!("Plane {}", pick.name));
    }
    if let Some(pick) = &link.linear {
        parts.push(format!("Linear {}", pick.name));
    }
    parts.join(" · ")
}

fn draw_key_form(buf: &mut Buffer, room: Rect, c: Style, t: &Theme, f: &KeyForm) {
    let name = capital(f.provider.name());
    put(buf, room.x, room.y, &[seg(format!("Connect {name}"), c.fg(t.text).add_modifier(Modifier::BOLD))], room.right());
    let mut fields: Vec<(&str, String)> = Vec::new();
    if f.provider == TicketProvider::Plane {
        fields.push(("address", tk::shown(&f.address, false)));
        fields.push(("workspace", tk::shown(&f.workspace, false)));
    }
    // A key is never drawn: a few bullets say something is typed, not what or how long.
    let bullets = if f.key.0.is_empty() { String::new() } else { "•".repeat(KEY_BULLETS) };
    fields.push(("API key", bullets));
    for (i, (label, value)) in fields.iter().enumerate() {
        let y = room.y + 2 + i as u16;
        let on = i == f.at;
        let mut segs = vec![seg(format!("{label:<10} "), c.fg(if on { t.accent } else { t.muted })), seg(value.clone(), c.fg(t.strong))];
        if on && !f.sending {
            segs.push(seg("▏", c.fg(t.accent)));
        }
        put(buf, room.x, y, &segs, room.right());
    }
    let y = room.y + 3 + fields.len() as u16;
    let status = if f.sending {
        Some(("connecting…".to_string(), t.muted))
    } else {
        f.error.clone().map(|e| (e, t.err))
    };
    let mut lines = Vec::new();
    if let Some((words, fg)) = status {
        lines.extend(wrapped(&words, room.width, c.fg(fg)));
        lines.push(vec![]);
    }
    let how = if f.provider == TicketProvider::Plane {
        "Your Plane server's address (https://…), the workspace's slug, and an API key from Plane's profile settings. Paste the key: it is sent to the Maitty service on this computer, which keeps it in its data folder. You do this once on this computer, for every project; the key is never shown again."
    } else {
        "A personal API key from Linear's settings. Paste it: it is sent to the Maitty service on this computer, which keeps it in its data folder. You do this once on this computer, for every project; the key is never shown again."
    };
    lines.extend(wrapped(how, room.width, c.fg(t.muted)));
    draw_lines(buf, Rect { y, height: room.bottom().saturating_sub(y), ..room }, &lines, 0);
}

/// The ticket as it will be sent, for the start and send pages; None while it is read.
fn message_lines(v: &TicketsView, id: &str, w: u16, c: Style, t: &Theme) -> Option<Vec<Vec<Seg>>> {
    let d = v.detail(id)?;
    let text = tk::ticket_message(d, &v.open_blockers(id));
    Some(boxed(&text, w, c.fg(t.text), c.fg(t.line)))
}

/// A review page: its head lines, then what will be sent in a box, then its buttons on the last
/// row. Returns the scroll held in range.
#[allow(clippy::too_many_arguments)]
fn draw_review_page(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, head: Vec<Vec<Seg>>, sent: Option<Vec<Vec<Seg>>>, after: Vec<Vec<Seg>>, scroll: usize, items: &[(char, &str, &str, BtnKind)]) -> usize {
    let mut lines = head;
    match sent {
        None => lines.push(vec![seg("reading the ticket…", c.fg(t.muted).add_modifier(Modifier::ITALIC))]),
        Some(body) => lines.extend(body),
    }
    if !after.is_empty() {
        lines.push(vec![]);
        lines.extend(after);
    }
    let text = Rect { height: inner.height.saturating_sub(2), ..inner };
    let s = draw_lines(buf, text, &lines, scroll);
    buttons(app, buf, inner.x, inner.bottom().saturating_sub(1), inner.right(), t, items);
    s
}

#[allow(clippy::too_many_arguments)]
fn draw_start(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, p: &TicketsProject, id: &str, agent: usize, scroll: usize) -> usize {
    let key = v.key_of(id);
    let names = agents(&app.cfg);
    let agent = names.get(agent).cloned().unwrap_or_default();
    let title = v.detail(id).map(|d| d.summary.title.clone()).unwrap_or_default();
    let mut head = vec![
        vec![seg(format!("Start an agent on {key}"), c.fg(t.strong).add_modifier(Modifier::BOLD))],
        vec![],
        vec![seg(format!("{:<8} ", "agent"), c.fg(t.muted)), seg(format!("‹ {agent} ›"), c.fg(t.accent).add_modifier(Modifier::BOLD))],
        vec![seg(format!("{:<8} ", "where"), c.fg(t.muted)), seg(format!("a new worktree of {}", p.name), c.fg(t.text))],
        vec![seg(format!("{:<8} ", "branch"), c.fg(t.muted)), seg(tk::ticket_branch(&key, &title), c.fg(t.text))],
    ];
    let blockers = v.open_blockers(id);
    if !blockers.is_empty() {
        head.push(vec![seg(format!("Blocked by {}. It can still be started.", blockers.join(", ")), c.fg(t.err))]);
    }
    if !p.git {
        head.push(vec![seg(format!("{} is not a git repository: t on the ticket sends it to the session in front instead.", p.name), c.fg(t.err))]);
    }
    head.push(vec![]);
    head.push(vec![seg("Exactly what will be sent:", c.fg(t.muted))]);
    let sent = message_lines(v, id, inner.width, c, t);
    draw_review_page(app, buf, inner, c, t, head, sent, Vec::new(), scroll, &[('y', "y", "Start", BtnKind::Primary), ('\x1b', "Esc", "Cancel", BtnKind::Ghost)])
}

#[allow(clippy::too_many_arguments)]
fn draw_send(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, p: &TicketsProject, id: &str, scroll: usize) -> usize {
    let key = v.key_of(id);
    let head = vec![
        vec![seg(format!("Send {key} to {}", p.session), c.fg(t.strong).add_modifier(Modifier::BOLD))],
        vec![seg("It is typed in when the agent's turn is over.", c.fg(t.muted))],
        vec![],
        vec![seg("Exactly what will be sent:", c.fg(t.muted))],
    ];
    let sent = message_lines(v, id, inner.width, c, t);
    draw_review_page(app, buf, inner, c, t, head, sent, Vec::new(), scroll, &[('y', "y", "Send", BtnKind::Primary), ('\x1b', "Esc", "Cancel", BtnKind::Ghost)])
}

#[allow(clippy::too_many_arguments)]
fn draw_comment(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, id: &str, text: &str, problem: Option<&str>) {
    let provider = Provider::of_id(id).unwrap_or(v.provider);
    let key = v.key_of(id);
    put(buf, inner.x, inner.y, &[seg(format!("Comment on {key} · {}", provider.name()), c.fg(t.strong).add_modifier(Modifier::BOLD))], inner.right());
    let count = text.trim().chars().count();
    let count_fg = if count > TICKET_COMMENT_MAX_CHARS { t.err } else { t.muted };
    put(buf, inner.x, inner.y + 1, &[seg(format!("{count} / {TICKET_COMMENT_MAX_CHARS} · Enter starts a new line · Tab reviews it"), c.fg(count_fg))], inner.right());
    let area = Rect { y: inner.y + 3, height: inner.height.saturating_sub(5), ..inner };
    let mut lines = boxed(&tk::shown(text, true), area.width, c.fg(t.strong), c.fg(t.accent));
    if let Some(last) = lines.last_mut() {
        last.push(seg("▏", c.fg(t.accent)));
    }
    // The end of what is typed stays in sight.
    let scroll = lines.len().saturating_sub(area.height as usize);
    draw_lines(buf, area, &lines, scroll);
    if let Some(problem) = problem {
        put(buf, inner.x, inner.bottom().saturating_sub(2), &[seg(problem.to_string(), c.fg(t.err))], inner.right());
    }
    buttons(app, buf, inner.x, inner.bottom().saturating_sub(1), inner.right(), t, &[('\t', "Tab", "Review", BtnKind::Primary), ('\x1b', "Esc", "Cancel", BtnKind::Ghost)]);
}

#[allow(clippy::too_many_arguments)]
fn draw_review(app: &mut App, buf: &mut Buffer, inner: Rect, c: Style, t: &Theme, v: &TicketsView, id: &str, write: &TicketWrite, state: &WriteState, scroll: usize) -> usize {
    let provider = Provider::of_id(id).unwrap_or(v.provider);
    let key = v.key_of(id);
    let name = provider.name();
    let (title, sent, confirm) = match write {
        TicketWrite::Comment { text } => (
            format!("Post this comment to {name} {key}?"),
            boxed(text, inner.width, c.fg(t.text), c.fg(t.line)),
            format!("Post comment to {name}"),
        ),
        TicketWrite::Close => (
            format!("Mark {key} done on {name}?"),
            wrapped(&format!("{key} moves to {name}'s finished state. Its words and comments stay as they are."), inner.width, c.fg(t.text)),
            format!("Mark done on {name}"),
        ),
    };
    let head = vec![
        vec![seg(title, c.fg(t.strong).add_modifier(Modifier::BOLD))],
        vec![],
        vec![seg("Exactly what will be written:", c.fg(t.muted))],
    ];
    let after = match state {
        WriteState::Ready => Vec::new(),
        WriteState::Sending => vec![vec![seg("writing…", c.fg(t.muted).add_modifier(Modifier::ITALIC))]],
        WriteState::Refused(why) => wrapped(&format!("Not written. {why}"), inner.width, c.fg(t.err)),
    };
    let mut items: Vec<(char, &str, &str, BtnKind)> = Vec::new();
    if *state != WriteState::Sending {
        items.push(('y', "y", &confirm, BtnKind::Primary));
        if matches!(write, TicketWrite::Comment { .. }) {
            items.push(('e', "e", "Edit", BtnKind::Ghost));
        }
    }
    items.push(('\x1b', "Esc", "Cancel", BtnKind::Ghost));
    draw_review_page(app, buf, inner, c, t, head, Some(sent), after, scroll, &items)
}

#[cfg(test)]
#[path = "tickets_tests.rs"]
mod tests;
