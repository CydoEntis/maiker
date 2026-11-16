//! Clone a repository onto a machine without leaving the window (`Action::CloneRepo`): its
//! address, picked from that machine's GitHub account or pasted, and the folder the clone goes
//! inside. The machine's daemon runs git and `gh` (`Query::CloneRepo`, `Query::GitHubRepos`,
//! `Query::GitHubOwners`), so the address is judged and the sign-in found there; what it says
//! when it will not clone is shown as it said it. Docs: UI.md, "Clone a repository".

use super::*;
use crate::protocol::{ClientMsg, GitHubAnswer, GitHubRepo, GitHubRepoList, Query};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Longest address and path the daemon takes, as the desktop app limits them.
const MOST_ADDRESS_CHARS: usize = 2048;
const MOST_PATH_CHARS: usize = 4096;
/// Longest search the daemon takes.
const MOST_SEARCH_CHARS: usize = 100;
/// How long after the last key the machine is asked again: `gh` runs once per ask.
const SEARCH_DELAY: Duration = Duration::from_millis(300);
/// The widest the dialog grows.
const CLONE_W: u16 = 96;
/// Where GitHub gives out its command line.
const GH_SITE: &str = "cli.github.com";

/// Tags for this window's clone and GitHub questions; each answer names the one it answers.
static NEXT_TAG: AtomicU64 = AtomicU64::new(1);

fn next_tag() -> u64 {
    NEXT_TAG.fetch_add(1, Ordering::Relaxed)
}

/// Which line of the dialog has the keys.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum CloneField {
    /// The search over the machine's GitHub repositories, with the list under it.
    Search,
    Address,
    Parent,
}

impl CloneField {
    /// The next line down (or up), round again at the end, in the order they are drawn. Without
    /// a list to search (no `gh`, nobody signed in) the search is passed over.
    fn next(self, back: bool, searchable: bool) -> CloneField {
        use CloneField::*;
        let order: &[CloneField] = if searchable { &[Address, Search, Parent] } else { &[Address, Parent] };
        let at = order.iter().position(|f| *f == self).unwrap_or(0);
        let n = order.len();
        order[if back { (at + n - 1) % n } else { (at + 1) % n }]
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct CloneView {
    pub machine: MachineId,
    /// The machine as the title names it: "this computer" or its name.
    pub place: String,
    pub address: String,
    pub parent: String,
    pub field: CloneField,
    /// What is typed into the search, and what the machine was last asked with it.
    pub search: String,
    asked_search: String,
    search_due: Option<Instant>,
    /// Whose repositories: the signed-in account (none), then its organisations.
    pub owners: Vec<String>,
    pub owner: Option<usize>,
    owners_tag: u64,
    repos_tag: u64,
    /// The answer to the last ask; None until it comes.
    pub repos: Option<GitHubAnswer<GitHubRepoList>>,
    pub sel: usize,
    /// The clone asked for, while it runs.
    clone_tag: Option<u64>,
    pub failure: Option<String>,
}

impl CloneView {
    pub fn cloning(&self) -> bool {
        self.clone_tag.is_some()
    }

    /// The listed repositories, newest pushed first; GitHub's times sort as text.
    pub fn rows(&self) -> Vec<&GitHubRepo> {
        let mut rows: Vec<&GitHubRepo> = match &self.repos {
            Some(GitHubAnswer::Listed(list)) => list.repos.iter().collect(),
            _ => Vec::new(),
        };
        rows.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
        rows
    }

    fn ready(&self) -> bool {
        !self.address.trim().is_empty() && !self.parent.trim().is_empty() && !self.cloning()
    }

    /// The machine's repositories can be searched: it has `gh` and someone signed in.
    fn searchable(&self) -> bool {
        !matches!(self.repos, Some(GitHubAnswer::NotSignedIn | GitHubAnswer::NotInstalled))
    }

    fn owner_name(&self) -> Option<String> {
        self.owner.and_then(|i| self.owners.get(i)).cloned()
    }

    fn field_text(&mut self) -> Option<(&mut String, usize)> {
        match self.field {
            CloneField::Search => Some((&mut self.search, MOST_SEARCH_CHARS)),
            CloneField::Address => Some((&mut self.address, MOST_ADDRESS_CHARS)),
            CloneField::Parent => Some((&mut self.parent, MOST_PATH_CHARS)),
        }
    }

    /// Typed or pasted text, one line, without control or hidden characters.
    pub fn type_text(&mut self, text: &str) {
        if self.cloning() {
            return;
        }
        let searching = self.field == CloneField::Search;
        if let Some((into, most)) = self.field_text() {
            let room = most.saturating_sub(into.chars().count());
            into.extend(
                text.lines()
                    .next()
                    .unwrap_or("")
                    .chars()
                    .filter(|c| !c.is_control() && !crate::hidden::is_invisible(*c))
                    .take(room),
            );
        }
        if searching {
            self.typed_search();
        }
        self.failure = None;
    }

    fn typed_search(&mut self) {
        self.sel = 0;
        self.search_due = Some(Instant::now() + SEARCH_DELAY);
    }
}

/// Text from a machine (a repository's name or description) as one plain line for a cell grid.
fn plain(text: &str) -> String {
    text.chars()
        .map(|c| if c == '\n' || c == '\t' { ' ' } else { c })
        .filter(|c| !c.is_control() && !crate::hidden::is_invisible(*c))
        .collect()
}

impl App {
    /// The dialog for the machine you are on: the focused pane's, else this computer.
    pub(in crate::client) fn open_clone_repo(&mut self) {
        let machine = self.focused().map_or(MachineId::LOCAL, |t| t.machine);
        self.open_clone_repo_on(machine);
    }

    pub(in crate::client) fn open_clone_repo_on(&mut self, machine: MachineId) {
        let probe = ClientMsg::Query(Query::CloneRepo { address: String::new(), parent: String::new(), tag: 0 });
        // An older daemon passes over a request it cannot read and never answers.
        if machine == MachineId::LOCAL && probe.introduced_in() > self.local_protocol {
            return self.notify("restart the service to clone a repository".into(), true);
        }
        let place = self.place_name(machine);
        let parent = self.clone_start(machine);
        let mut v = CloneView {
            machine,
            place,
            address: String::new(),
            parent,
            field: CloneField::Address,
            search: String::new(),
            asked_search: String::new(),
            search_due: None,
            owners: Vec::new(),
            owner: None,
            owners_tag: next_tag(),
            repos_tag: 0,
            repos: None,
            sel: 0,
            clone_tag: None,
            failure: None,
        };
        self.send(machine, ClientMsg::Query(Query::GitHubOwners { tag: v.owners_tag }));
        self.ask_repos(&mut v);
        self.mode = Mode::Clone(Box::new(v));
    }

    /// "this computer", or the machine's name.
    pub(in crate::client) fn place_name(&self, machine: MachineId) -> String {
        if machine == MachineId::LOCAL {
            "this computer".into()
        } else {
            self.machine_name(machine).to_string()
        }
    }

    /// Where a clone on `machine` goes in when nothing is typed: the folder it last went in
    /// there, else the start folder (this computer) or the home folder.
    fn clone_start(&self, machine: MachineId) -> String {
        let key = if machine == MachineId::LOCAL { "" } else { self.machine_name(machine) };
        if let Some(last) = self.screen.saved.clone_into.get(key) {
            return last.clone();
        }
        if machine == MachineId::LOCAL && !self.cfg.ui.start_dir.is_empty() {
            return self.cfg.ui.start_dir.clone();
        }
        "~".into()
    }

    fn ask_repos(&self, v: &mut CloneView) {
        v.repos_tag = next_tag();
        v.asked_search = v.search.trim().to_string();
        v.search_due = None;
        let search = Some(v.asked_search.clone()).filter(|s| !s.is_empty());
        self.send(v.machine, ClientMsg::Query(Query::GitHubRepos { owner: v.owner_name(), search, tag: v.repos_tag }));
    }

    /// Asks again once typing in the search has paused.
    pub(in crate::client) fn clone_search_tick(&mut self) {
        let due = matches!(&self.mode, Mode::Clone(v) if v.search_due.is_some_and(|at| Instant::now() >= at));
        if !due {
            return;
        }
        let Mode::Clone(mut v) = std::mem::replace(&mut self.mode, Mode::Normal) else {
            return;
        };
        if v.search.trim() != v.asked_search {
            v.repos = None;
            self.ask_repos(&mut v);
        } else {
            v.search_due = None;
        }
        self.mode = Mode::Clone(v);
        self.dirty = true;
    }

    pub(in crate::client) fn github_owners_arrived(&mut self, machine: MachineId, tag: u64, answer: GitHubAnswer<Vec<String>>) {
        if let Mode::Clone(v) = &mut self.mode
            && v.machine == machine
            && v.owners_tag == tag
            && let GitHubAnswer::Listed(owners) = answer
        {
            // Without the owners there is no owner to switch to; the list's own answer says what is wrong.
            v.owners = owners.iter().map(|o| plain(o)).collect();
        }
    }

    pub(in crate::client) fn github_repos_arrived(&mut self, machine: MachineId, tag: u64, answer: GitHubAnswer<GitHubRepoList>) {
        if let Mode::Clone(v) = &mut self.mode
            && v.machine == machine
            && v.repos_tag == tag
        {
            v.repos = Some(answer);
            v.sel = v.sel.min(v.rows().len().saturating_sub(1));
            if !v.searchable() && v.field == CloneField::Search {
                v.field = CloneField::Address;
            }
        }
    }

    /// How a clone ended. One whose dialog was closed still says so in a toast.
    pub(in crate::client) fn cloned_arrived(&mut self, machine: MachineId, tag: u64, outcome: Result<String, String>) {
        let open = matches!(&self.mode, Mode::Clone(v) if v.machine == machine && v.clone_tag == Some(tag));
        match outcome {
            Err(why) if open => {
                if let Mode::Clone(v) = &mut self.mode {
                    v.clone_tag = None;
                    v.failure = Some(plain(&why));
                }
            }
            Err(why) => self.notify(format!("The repository was not cloned: {}", plain(&why)), true),
            Ok(folder) if open => {
                if let Mode::Clone(v) = &self.mode {
                    let key = if machine == MachineId::LOCAL { String::new() } else { self.machine_name(machine).to_string() };
                    let into = v.parent.trim().to_string();
                    self.screen.saved.clone_into.insert(key, into);
                    self.screen.save();
                }
                self.mode = Mode::Normal;
                self.open_cloned(machine, PathBuf::from(plain(&folder)));
            }
            Ok(folder) => self.notify(format!("Cloned into {}", plain(&folder)), false),
        }
    }

    /// The new folder as a project: this computer's opens as any folder does, another
    /// machine's starts a shell there.
    fn open_cloned(&mut self, machine: MachineId, folder: PathBuf) {
        if machine == MachineId::LOCAL {
            self.screen_open_project(folder);
            return;
        }
        let name = folder_name(&folder);
        self.screen_new_session_on(machine, folder, None, false);
        self.notify(format!("Cloned {name} on {}", self.machine_name(machine)), false);
    }

    /// The daemon refused a question the dialog waits on. True when the error was for it.
    pub(in crate::client) fn clone_failed(&mut self, machine: MachineId, why: &str) -> bool {
        match &mut self.mode {
            Mode::Clone(v) if v.machine == machine && v.cloning() => {
                v.clone_tag = None;
                v.failure = Some(plain(why));
                true
            }
            Mode::Clone(v) if v.machine == machine && v.repos.is_none() => {
                v.repos = Some(GitHubAnswer::Failed(plain(why)));
                true
            }
            _ => false,
        }
    }

    fn clone_go(&mut self, mut v: CloneView) {
        if !v.ready() {
            if !v.cloning() {
                v.failure = Some("Type the repository's address and the folder it goes in.".into());
            }
            self.mode = Mode::Clone(Box::new(v));
            return;
        }
        let tag = next_tag();
        v.clone_tag = Some(tag);
        v.failure = None;
        self.send(
            v.machine,
            ClientMsg::Query(Query::CloneRepo { address: v.address.trim().to_string(), parent: v.parent.trim().to_string(), tag }),
        );
        self.mode = Mode::Clone(Box::new(v));
    }

    /// A repository picked from the list fills in the address; the folder is next.
    fn clone_pick(&mut self, mut v: CloneView, i: usize) {
        if let Some(repo) = v.rows().get(i) {
            v.address = plain(&repo.clone_url);
            v.sel = i;
            v.field = CloneField::Parent;
            v.failure = None;
        }
        self.mode = Mode::Clone(Box::new(v));
    }

    pub(in crate::client) fn clone_click(&mut self, i: usize) {
        if let Mode::Clone(v) = &self.mode
            && !v.cloning()
        {
            let v = (**v).clone();
            self.clone_pick(v, i);
        }
    }

    pub(in crate::client) fn clone_click_go(&mut self) {
        if let Mode::Clone(v) = &self.mode {
            let v = (**v).clone();
            self.clone_go(v);
        }
    }

    pub(in crate::client) fn on_clone_key(&mut self, mut v: CloneView, k: &KeyEvent) {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        match k.code {
            KeyCode::Esc => {
                // A clone that has started cannot be taken back; it goes on and ends in a toast.
                if v.cloning() {
                    self.notify("The clone goes on; a note says when it ends".into(), false);
                }
                self.mode = Mode::Normal;
                return;
            }
            _ if v.cloning() => {}
            KeyCode::Tab => v.field = v.field.next(false, v.searchable()),
            KeyCode::BackTab => v.field = v.field.next(true, v.searchable()),
            KeyCode::Enter if v.field == CloneField::Search => {
                let at = v.sel;
                return self.clone_pick(v, at);
            }
            KeyCode::Enter => return self.clone_go(v),
            KeyCode::Down if v.field == CloneField::Search => v.sel = (v.sel + 1).min(v.rows().len().saturating_sub(1)),
            KeyCode::Up if v.field == CloneField::Search => v.sel = v.sel.saturating_sub(1),
            KeyCode::Down => v.field = v.field.next(false, v.searchable()),
            KeyCode::Up => v.field = v.field.next(true, v.searchable()),
            // Whose repositories: the next owner, round to the signed-in account again.
            KeyCode::Char('o') if ctrl && !v.owners.is_empty() => {
                v.owner = match v.owner {
                    None if v.owners.len() > 1 => Some(1),
                    Some(i) if i + 1 < v.owners.len() => Some(i + 1),
                    _ => None,
                };
                v.sel = 0;
                v.repos = None;
                self.ask_repos(&mut v);
            }
            KeyCode::Backspace => {
                let searching = v.field == CloneField::Search;
                if let Some((text, _)) = v.field_text() {
                    text.pop();
                }
                if searching {
                    v.typed_search();
                }
                v.failure = None;
            }
            KeyCode::Char(c) if !ctrl => v.type_text(&c.to_string()),
            _ => {}
        }
        self.mode = Mode::Clone(Box::new(v));
    }
}

/// One text line of the dialog: a `›` box with its text and, while it has the keys, a cursor.
fn field_line(buf: &mut Buffer, r: Rect, y: u16, t: &Theme, text: &str, hint: &str, on: bool) {
    let line = Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: 1 };
    strip(buf, line, if on { t.card2 } else { t.card });
    let s = Style::default().bg(if on { t.card2 } else { t.card });
    let room = line.width.saturating_sub(6) as usize;
    // A long address shows its end, where you are typing.
    let shown = if text.width() > room {
        let tail: String = text.chars().rev().take(room.saturating_sub(1)).collect::<Vec<_>>().into_iter().rev().collect();
        format!("…{tail}")
    } else {
        text.to_string()
    };
    let mut segs = vec![seg("› ", s.fg(if on { t.accent } else { t.muted }).add_modifier(Modifier::BOLD)), seg(shown, s.fg(t.strong))];
    if on {
        segs.push(seg("█", s.fg(t.accent)));
    }
    if text.is_empty() {
        segs.push(seg(format!(" {hint}"), s.fg(t.muted)));
    }
    put(buf, r.x + 3, y, &segs, line.right());
}

pub(in crate::client) fn draw_clone(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, v: &CloneView) {
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let h = area.height.saturating_sub(4).min(28);
    let r = panel(app, buf, area, CLONE_W, h, &format!("Clone a repository to {}", v.place), &[], t);
    let c = Style::default().bg(t.card);
    let quiet = c.fg(t.muted).add_modifier(Modifier::ITALIC);
    let end = r.right().saturating_sub(2);
    let mut y = r.y + 2;
    field_line(buf, r, y, t, &v.address, "https://github.com/owner/name.git or git@github.com:owner/name.git", v.field == CloneField::Address);
    y += 2;
    // The machine's own GitHub repositories, to pick one instead of pasting its address.
    let signed_out = matches!(v.repos, Some(GitHubAnswer::NotSignedIn));
    let no_gh = matches!(v.repos, Some(GitHubAnswer::NotInstalled));
    let list_rows = r.bottom().saturating_sub(y + 9);
    if signed_out {
        put(buf, r.x + 3, y, &[seg(format!("Sign in to GitHub on {} to pick from your repositories: ", v.place), c.fg(t.muted)), seg("gh auth login", c.fg(t.text))], end);
        y += 2;
    } else if no_gh {
        put(buf, r.x + 3, y, &[seg(format!("To pick from your repositories, install the GitHub command line (gh) on {}. Get it from {GH_SITE}", v.place), c.fg(t.muted))], end);
        y += 2;
    } else {
        let owner = v.owner_name();
        field_line(buf, r, y, t, &v.search, "search your repositories on GitHub", v.field == CloneField::Search);
        if v.owners.len() > 1 {
            let label = format!(" {} ", owner.as_deref().or(v.owners.first().map(String::as_str)).unwrap_or(""));
            let w = label.width() as u16;
            put(buf, end.saturating_sub(w + 1), y, &[seg(label, Style::default().bg(t.btn).fg(t.strong))], end);
        }
        y += 1;
        let rows = v.rows();
        let list = Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: list_rows };
        match &v.repos {
            None => {
                put(buf, list.x + 2, list.y, &[seg("Loading your repositories…", quiet)], list.right());
            }
            Some(GitHubAnswer::Failed(why)) => {
                put(buf, list.x + 2, list.y, &[seg(format!("{}. You can still paste an address.", plain(why)), c.fg(t.err))], list.right());
            }
            Some(_) if rows.is_empty() => {
                let say = if v.asked_search.is_empty() { "No repositories here yet." } else { "No repository matches." };
                put(buf, list.x + 2, list.y, &[seg(say, quiet)], list.right());
            }
            Some(_) => {
                let start = v.sel.saturating_sub(list.height.saturating_sub(1) as usize);
                for (i, repo) in rows.iter().enumerate().skip(start).take(list.height as usize) {
                    let ry = list.y + (i - start) as u16;
                    let rr = Rect { y: ry, height: 1, ..list };
                    let on = i == v.sel && v.field == CloneField::Search;
                    let st = list_row(app, buf, rr, on, t);
                    let mut segs = vec![seg(plain(&repo.name), st.fg(if on { t.strong } else { t.text }).add_modifier(Modifier::BOLD))];
                    if repo.private {
                        segs.push(seg("  · private", st.fg(t.muted)));
                    }
                    if !repo.description.is_empty() {
                        segs.push(seg(format!("  · {}", plain(&repo.description)), st.fg(t.muted)));
                    }
                    put(buf, rr.x + 3, ry, &segs, rr.right().saturating_sub(1));
                    hit(app, rr, ScreenHit::ClonePick(i));
                }
            }
        }
        y += list_rows;
        if matches!(&v.repos, Some(GitHubAnswer::Listed(l)) if l.more) {
            put(buf, r.x + 3, y, &[seg(format!("Showing the first {} repositories. Search to find the others.", rows.len()), quiet)], end);
        }
        y += 1;
    }
    put(buf, r.x + 3, y, &[seg("It goes in a new folder, named after the repository, inside:", c.fg(t.muted))], end);
    y += 1;
    field_line(buf, r, y, t, &v.parent, "a folder on that machine", v.field == CloneField::Parent);
    y += 2;
    if v.cloning() {
        put(buf, r.x + 3, y, &[seg("Cloning… A large repository can take a few minutes.", quiet)], end);
    } else if let Some(why) = &v.failure {
        put(buf, r.x + 3, y, &[seg(why.clone(), c.fg(t.err))], end);
    }
    let by = r.bottom().saturating_sub(3);
    let label = if v.cloning() { "Cloning…" } else { "Clone" };
    let kind = if v.ready() { BtnKind::Primary } else { BtnKind::Ghost };
    btn(app, buf, r.x + 3, by, label, "Enter", kind, ScreenHit::CloneGo, r.right());
    let mut keys = vec![("Tab", "next line")];
    if v.field == CloneField::Search {
        keys.push(("↑↓", "pick"));
        keys.push(("Enter", "use it"));
        if v.owners.len() > 1 {
            keys.push(("Ctrl+O", "owner"));
        }
    } else {
        keys.push(("Enter", "clone"));
    }
    keys.push(("Esc", "close"));
    panel_bar(buf, r, t, &keys);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str, pushed: &str) -> GitHubRepo {
        GitHubRepo { name: name.into(), description: String::new(), private: false, pushed_at: pushed.into(), clone_url: format!("https://github.com/{name}.git") }
    }

    fn view() -> CloneView {
        CloneView {
            machine: MachineId::LOCAL,
            place: "this computer".into(),
            address: String::new(),
            parent: "~".into(),
            field: CloneField::Search,
            search: String::new(),
            asked_search: String::new(),
            search_due: None,
            owners: Vec::new(),
            owner: None,
            owners_tag: 1,
            repos_tag: 2,
            repos: None,
            sel: 0,
            clone_tag: None,
            failure: None,
        }
    }

    #[test]
    fn repositories_list_newest_pushed_first_and_unknown_times_last() {
        let mut v = view();
        v.repos = Some(GitHubAnswer::Listed(GitHubRepoList {
            repos: vec![repo("me/old", "2025-01-01T00:00:00Z"), repo("me/none", ""), repo("me/new", "2026-10-01T00:00:00Z")],
            more: false,
        }));
        let names: Vec<&str> = v.rows().iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["me/new", "me/old", "me/none"]);
    }

    #[test]
    fn typed_text_keeps_one_line_and_drops_control_characters() {
        let mut v = view();
        v.field = CloneField::Address;
        v.type_text("https://x/y.git\u{1b}[31m\nsecond line");
        assert_eq!(v.address, "https://x/y.git[31m");
    }

    #[test]
    fn an_address_is_cut_at_the_length_the_daemon_takes() {
        let mut v = view();
        v.field = CloneField::Address;
        v.type_text(&"a".repeat(MOST_ADDRESS_CHARS + 50));
        assert_eq!(v.address.chars().count(), MOST_ADDRESS_CHARS);
    }

    #[test]
    fn nothing_is_typed_while_a_clone_runs() {
        let mut v = view();
        v.field = CloneField::Address;
        v.clone_tag = Some(9);
        v.type_text("x");
        assert!(v.address.is_empty());
    }

    #[test]
    fn a_name_from_the_machine_is_drawn_as_one_plain_line() {
        assert_eq!(plain("a\u{1b}]0;title\u{7}b\nc\u{200b}"), "a]0;titleb c");
    }
}
