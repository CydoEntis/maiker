//! The sidebar: the sessions grouped by status (Needs you, Working, Done, Idle) or by machine, agents and shells
//! alike. A session is two lines (its status mark, name and age, then `project / branch`), and the open one has a
//! third saying what it is doing; an agent's subagents follow it, as a row of marks or, for the session you are on,
//! one row each. `SideModel` is the one list the drawing, the arrow keys and Enter all read.

use super::chips::{Chip, chip};
use super::status_mark::State;
use super::*;
use crate::client::ids::ClientSession;
use crate::protocol::{PrTone, SubagentActivity, SubagentState, TurnKind};

/// Rows a session takes before its subagents: its name and age, the project and branch under it, and for the open
/// session a line saying what it is doing.
fn session_h(open: bool) -> u16 {
    2 + u16::from(open)
}
/// Columns from the sidebar's left edge: the selection bar, the status mark, the name, and the
/// subagents' tree.
const BAR_X: u16 = 1;
const MARK_X: u16 = 2;
const NAME_X: u16 = 4;
pub(super) const TREE_X: u16 = 6;
const ONLINE_DOT: &str = "●";
const RECONNECTING_MARK: &str = "┆";
/// The status groups in the order the list shows them, with the words on their headings.
const GROUPS: [&str; 4] = ["Needs you", "Working", "Done", "Idle"];
/// What the machine heading calls the computer the window runs on.
const THIS_COMPUTER: &str = "This computer";
/// The sidebar's title chip, and the chips that hide it and bring it back.
const TITLE: &str = "Maiker";
pub(in crate::client) const HIDE: &str = "«";
pub(in crate::client) const SHOW: &str = "»";
/// The fold arrows of a heading: open (it folds), and folded (it opens).
const OPEN: &str = "▾";
const FOLDED: &str = "▸";

/// The collapsed sidebar's width: its frame and one mark between.
pub(in crate::client) const RAIL_W: u16 = 5;
/// The sidebar's footer: the menu, with the update dot beside it, and the keys help.
const MENU: &str = "menu";
const KEYS: &str = "? keys";
/// The sidebar's header buttons.
pub(in crate::client) const SEARCH: &str = "⌕";
const NEW: &str = "+";
const FILTER: &str = "≡";
/// The mark that says an update waits, on `menu` and the rail's `≡`: a square, or a dot when corners are round.
const UPDATE_SQUARE: &str = "▪";
const UPDATE_DOT: &str = "•";

/// The mark before the name of the session that started a helper, on the helper's place line.
const STARTED_BY: &str = "↳";
/// The most of a starter's name a helper's place line keeps, so the place after it stays readable.
const STARTER_NAME_MAX: usize = 14;
/// The least room a session's name keeps when its helpers are counted beside it; with less, the count is shortened
/// to `+2`, and then left out.
const NAME_MIN_BESIDE_HELPERS: usize = 10;

/// The helpers a session's agent started and that are still listed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Helpers {
    pub total: usize,
    /// How many of them wait on you.
    pub needs: usize,
}

impl Helpers {
    /// The count as a row writes it in `room` columns: `2 helpers`, `+2` when that leaves the name too little, or
    /// nothing when even that does.
    fn note(self, room: usize) -> Option<String> {
        if self.total == 0 {
            return None;
        }
        let long = format!("{} helper{}", self.total, if self.total == 1 { "" } else { "s" });
        let short = format!("+{}", self.total);
        [long, short].into_iter().find(|note| room >= note.width() + 1 + NAME_MIN_BESIDE_HELPERS)
    }
}

/// A subagent as its parent's row lists it.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct SubRow {
    pub id: String,
    pub name: String,
    pub state: State,
}

/// A session as the sidebar lists it.
#[derive(Debug, Clone)]
pub(super) struct SideRow {
    pub key: ClientSession,
    pub term: Option<ClientTerm>,
    /// Your name for it, else what runs in it.
    pub name: String,
    pub project: String,
    pub branch: String,
    /// Its pull request as `#45 merged`, with how it is going, when the branch has one.
    pub pr: Option<(String, PrTone)>,
    pub state: State,
    /// Seconds since its status last changed.
    pub age: Option<u64>,
    /// The agent's name (`Claude`), empty for a shell.
    pub agent_name: String,
    /// It works in a worktree of its own.
    pub linked: bool,
    /// It hit its plan limit: when the daemon continues it (unix seconds), while that is ahead.
    pub limited_until: Option<u64>,
    /// An agent (its name is bold while it has something going on), not a shell.
    pub agent: bool,
    pub process: String,
    pub machine: String,
    /// The session whose agent started this one, by name, while that session is still in its machine's list.
    pub starter: Option<String>,
    /// The helpers its own agent started.
    pub helpers: Helpers,
    pub subs: Vec<SubRow>,
    /// Its finished subagents not in `subs`, shown as one "N done" line under the open session.
    pub subs_done: usize,
    /// Its finished subagents are listed in `subs` (the "N done" line was opened).
    pub subs_open: bool,
    /// Folded away: its machine or its folder is closed, so it is not drawn and the cursor skips it.
    pub hidden: bool,
    /// Creation order: ids only count up.
    order: (u64, MachineId),
}

impl SideRow {
    fn matches(&self, query: &str) -> bool {
        let q = query.trim().to_lowercase();
        q.is_empty()
            || [&self.name, &self.project, &self.process, &self.machine, &self.branch]
                .iter()
                .any(|field| field.to_lowercase().contains(&q))
    }

    /// Bold, in the strong colour: a session that is working, needs you or failed.
    fn busy(&self) -> bool {
        matches!(self.state, State::Working | State::Needs | State::Problem)
    }

    /// Which group a status heading puts it under: Needs you (failed ones too), Working, Done, Idle.
    fn group(&self) -> usize {
        match self.state {
            State::Needs | State::Problem => 0,
            State::Working => 1,
            State::Done => 2,
            State::Idle | State::Unknown => 3,
        }
    }

    /// What it is doing, for the open session's third line.
    fn doing(&self) -> String {
        let for_how_long = || self.age.map_or_else(String::new, |s| format!(" {}", span(s)));
        match self.state {
            State::Working => format!("working{}", for_how_long()),
            State::Needs => "waiting for you".into(),
            State::Done => format!("finished{}", for_how_long()),
            State::Problem => "stopped".into(),
            State::Idle => "idle".into(),
            State::Unknown => "not answering".into(),
        }
    }
}

/// A span as the third line says it: `12s`, `4m`, `2h`.
pub(super) fn span(secs: u64) -> String {
    match secs {
        0..=59 => format!("{secs}s"),
        60..=3599 => format!("{}m", secs / 60),
        _ => format!("{}h", secs / 3600),
    }
}

/// A row's age at the right: `now`, `4m`, `2h`, `1d`.
fn age_label(secs: u64) -> String {
    match secs {
        0..=59 => "now".into(),
        60..=3599 => format!("{}m", secs / 60),
        3600..=86_399 => format!("{}h", secs / 3600),
        _ => format!("{}d", secs / 86_400),
    }
}

/// A machine and the sessions on it, or (grouped by status) one status group.
#[derive(Debug, Clone)]
pub(super) struct MachineSection {
    pub id: MachineId,
    /// A status group has a heading of its own and nothing of a machine's.
    pub status_group: bool,
    pub label: String,
    pub down: bool,
    /// The app there is missing or another version: the heading offers the fix.
    pub fix: Option<super::machine_group::AppFix>,
    /// Its heading is folded: the sessions under it are hidden.
    pub folded: bool,
    pub rows: Vec<SideRow>,
}

/// What a session is called: your name for it, else what runs in it, else `fallback`.
pub(in crate::client) fn display_name(info: Option<&TermInfo>, fallback: &str) -> String {
    let custom = info.map_or("", |i| i.label.trim());
    let process = info.map_or("", |i| i.process.trim());
    if !custom.is_empty() {
        custom.to_string()
    } else if !process.is_empty() {
        process.to_string()
    } else {
        fallback.to_string()
    }
}

/// A subagent's state as its mark draws it.
pub(super) fn sub_state(s: SubagentState) -> State {
    match s {
        SubagentState::Starting | SubagentState::Working => State::Working,
        SubagentState::WaitingForInput | SubagentState::AwaitingApproval => State::Needs,
        SubagentState::Completed => State::Done,
        SubagentState::Failed | SubagentState::ConnectionLost => State::Problem,
        SubagentState::Cancelled => State::Idle,
    }
}

/// When the agent's current turn began: the first `Working` after its last `Done` or `Idle`,
/// else when its status last changed.
fn turn_start(info: &TermInfo) -> u64 {
    let ended = info
        .timeline
        .iter()
        .rposition(|e| matches!(e.kind, TurnKind::Done | TurnKind::Idle));
    info.timeline
        .iter()
        .skip(ended.map_or(0, |i| i + 1))
        .find(|e| e.kind == TurnKind::Working)
        .map_or(info.since, |e| e.at)
}

/// How long a finished subagent stays listed before it clears, so a long turn does not pile up
/// rows that look stuck.
const FINISHED_LINGER_SECS: u64 = 15;

/// A session's subagents as the sidebar lists them, and how many finished ones are folded away.
/// One still running is listed for as long as it runs, after its parent's turn too (a background
/// helper). One that finished in the turn the agent is in stays for [`FINISHED_LINGER_SECS`]; every
/// other finished one is folded into the count, or listed too when `show_done`.
pub(super) fn session_subagents(info: &TermInfo, now: u64, show_done: bool) -> (Vec<&SubagentActivity>, usize) {
    let in_turn = matches!(info.status, Status::Working | Status::Blocked);
    let from = turn_start(info);
    let lingers = |a: &SubagentActivity| {
        in_turn
            && a.started_at.unwrap_or(a.updated_at) >= from
            && now.saturating_sub(a.updated_at) <= FINISHED_LINGER_SECS
    };
    let (listed, folded): (Vec<_>, Vec<_>) = info
        .subagent_activity
        .iter()
        .partition(|a| show_done || a.state.active() || lingers(a));
    (listed, folded.len())
}

/// Every session in creation order.
fn side_rows(app: &App, model: &[Proj]) -> Vec<SideRow> {
    let mut rows: Vec<SideRow> = model
        .iter()
        .flat_map(|p| p.sessions().map(move |s| (p, s)))
        .map(|(p, s)| {
            let info = s.native_term.and_then(|t| app.term_info(t));
            // A chat goes by its title, even once it has a terminal.
            let name = if matches!(s.key.key, SessionKey::Conversation(_)) {
                s.name.clone()
            } else {
                display_name(info, &s.name)
            };
            let failed = super::status_mark::failed(
                info.is_some_and(|i| i.exit.is_some()),
                s.status,
                s.check.as_ref(),
            );
            let subs_open = app.screen.subs_opened.contains(&s.key);
            let (subs, subs_done) = info
                .filter(|_| app.cfg.ui.subagent_count)
                .map(|i| {
                    let now = super::now_secs();
                    let done = session_subagents(i, now, false).1;
                    let rows = session_subagents(i, now, subs_open)
                        .0
                        .into_iter()
                        .map(|a| SubRow {
                            id: a.id.clone(),
                            name: a.name.clone(),
                            state: sub_state(a.state),
                        })
                        .collect();
                    (rows, done)
                })
                .unwrap_or_default();
            SideRow {
                key: s.key,
                term: s.native_term,
                name,
                project: p.name.clone(),
                branch: info.and_then(|i| i.branch.clone()).unwrap_or_default(),
                pr: info.and_then(|i| i.pr.as_ref()).map(|p| (p.headline(), p.tone())),
                state: State::of(s.status, failed, s.down),
                age: info.filter(|i| i.since > 0).map(|i| super::now_secs().saturating_sub(i.since)),
                agent_name: info.and_then(|i| i.agent.as_deref()).map(capitalised).unwrap_or_default(),
                linked: info.is_some_and(|i| i.linked),
                limited_until: info.and_then(|i| i.resume_at).filter(|at| *at > super::now_secs()),
                agent: s.is_agent,
                process: info.map_or(String::new(), |i| i.process.clone()),
                machine: app.machine_label_of(s.key.machine),
                starter: None,
                helpers: Helpers::default(),
                subs,
                subs_done,
                subs_open,
                hidden: false,
                order: (
                    s.native_term.map_or(u64::MAX, |t| u64::from(t.term)),
                    s.key.machine,
                ),
            }
        })
        .collect();
    rows.sort_by_key(|r| (!r.agent, r.order, r.key));
    mark_helpers(app, &mut rows);
    rows
}

/// Who started whom: each helper's starter by name, and each starter's count of helpers. A session is a helper only
/// while the pane that started it is still in its machine's list, the rule `App::is_helper` alerts by.
fn mark_helpers(app: &App, rows: &mut [SideRow]) {
    let starters: Vec<Option<ClientTerm>> = rows
        .iter()
        .map(|row| {
            let term = row.term?;
            let by = ClientTerm { machine: term.machine, term: app.term_info(term)?.started_by? };
            app.term_info(by).map(|_| by)
        })
        .collect();
    for (helper, by) in starters.into_iter().enumerate() {
        let Some(by) = by else { continue };
        let needs = rows[helper].state == State::Needs;
        let starter = rows.iter_mut().find(|row| row.term == Some(by));
        // A starter that is put away has no row, and is still named.
        let name = match starter {
            Some(starter) => {
                starter.helpers.total += 1;
                starter.helpers.needs += usize::from(needs);
                starter.name.clone()
            }
            None => display_name(app.term_info(by), &format!("session {}", by.term)),
        };
        rows[helper].starter = Some(name);
    }
}

/// How the rows within a group are ordered (`Saved.side_sort`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SortBy {
    Recent,
    Oldest,
    Name,
}

impl SortBy {
    pub(super) fn of(saved: &str) -> SortBy {
        match saved {
            "oldest" => SortBy::Oldest,
            "az" => SortBy::Name,
            _ => SortBy::Recent,
        }
    }

    fn sort(self, rows: &mut [SideRow]) {
        match self {
            // Newest change first; a row with no age last.
            SortBy::Recent => rows.sort_by_key(|r| (r.age.is_none(), r.age, r.order, r.key)),
            SortBy::Oldest => rows.sort_by_key(|r| (r.age.is_none(), std::cmp::Reverse(r.age), r.order, r.key)),
            SortBy::Name => rows.sort_by_key(|r| (r.name.to_lowercase(), r.order, r.key)),
        }
    }
}

/// What the sidebar shows once the filter has had its say.
pub(super) struct SideModel {
    pub machines: Vec<MachineSection>,
    pub filtering: bool,
}

impl SideModel {
    pub fn build(app: &App, model: &[Proj]) -> SideModel {
        let query = app.screen.filter.trim().to_lowercase();
        let sort = SortBy::of(&app.screen.saved.side_sort);
        let rows: Vec<SideRow> = side_rows(app, model).into_iter().filter(|r| r.matches(&query)).collect();
        let sections = if app.screen.saved.group_machine {
            Self::by_machine(app, &rows)
        } else {
            Self::by_status(&rows)
        };
        let machines = sections
            .into_iter()
            .filter(|m| query.is_empty() || !m.rows.is_empty())
            .map(|mut m| {
                // Within a group the rows follow the sort; by machine they are in status order first.
                m.rows.sort_by_key(|r| if m.status_group { 0 } else { r.group() });
                for group in m.rows.chunk_by_mut(|a, b| a.group() == b.group() || m.status_group) {
                    sort.sort(group);
                }
                // A closed heading hides its sessions; a filter shows every match.
                if query.is_empty() {
                    m.folded = app.screen.saved.closed.contains(&machine_fold_key(&m.label));
                    for r in &mut m.rows {
                        r.hidden = m.folded;
                    }
                }
                m
            })
            .collect();
        SideModel { machines, filtering: !query.is_empty() }
    }

    fn by_status(rows: &[SideRow]) -> Vec<MachineSection> {
        GROUPS
            .iter()
            .enumerate()
            .map(|(g, label)| MachineSection {
                id: MachineId::LOCAL,
                status_group: true,
                label: (*label).to_string(),
                down: false,
                fix: None,
                folded: false,
                rows: rows.iter().filter(|r| r.group() == g).cloned().collect(),
            })
            .filter(|m| !m.rows.is_empty())
            .collect()
    }

    fn by_machine(app: &App, rows: &[SideRow]) -> Vec<MachineSection> {
        app.machines()
            .into_iter()
            .map(|m| MachineSection {
                id: m.id,
                status_group: false,
                label: if m.id == MachineId::LOCAL {
                    THIS_COMPUTER.to_string()
                } else {
                    app.machine_label_of(m.id)
                },
                down: app.machine_down(m.id),
                fix: app.machine_fix(m.id),
                folded: false,
                rows: rows.iter().filter(|r| r.key.machine == m.id).cloned().collect(),
            })
            .collect()
    }

    /// Every row the cursor can rest on, top to bottom.
    pub fn items(&self) -> Vec<SideItem> {
        self.machines
            .iter()
            .flat_map(|m| m.rows.iter().filter(|r| !r.hidden))
            .map(|r| SideItem::Sess(r.key))
            .collect()
    }
}

/// The sessions as the sidebar lists them, top to bottom.
pub(in crate::client) fn side_keys(app: &App, model: &[Proj]) -> Vec<ClientSession> {
    SideModel::build(app, model)
        .machines
        .iter()
        .flat_map(|m| m.rows.iter().filter(|r| !r.hidden).map(|r| r.key))
        .collect()
}

/// `▲` at a list's top when rows are scrolled off above, `▼` at its bottom when more are below,
/// in column `x`.
pub(super) fn scroll_marks(buf: &mut Buffer, x: u16, (top, rows_h): (u16, u16), more: (bool, bool), st: Style) {
    if more.0 {
        put(buf, x, top, &[seg("▲", st)], x + 1);
    }
    if more.1 {
        put(
            buf,
            x,
            top + rows_h.saturating_sub(1),
            &[seg("▼", st)],
            x + 1,
        );
    }
}

/// Which rows of a list show: the first one, and how many fit. The row `want` is kept in view
/// when `follow` is set, otherwise the wheel's scroll stands.
pub(super) fn window(heights: &[u16], scroll: usize, want: Option<usize>, room: u16) -> (usize, usize) {
    let mut first = scroll.min(heights.len().saturating_sub(1));
    if let Some(w) = want.filter(|w| *w < heights.len()) {
        if w < first {
            first = w;
        }
        while first < w && heights[first..=w].iter().sum::<u16>() > room {
            first += 1;
        }
    }
    // Scrolled past the point where the end of the list is already in view.
    while first > 0 && heights[first - 1..].iter().sum::<u16>() <= room {
        first -= 1;
    }
    let mut used = 0;
    let mut shown = 0;
    for h in &heights[first..] {
        if used + h > room {
            break;
        }
        used += h;
        shown += 1;
    }
    (first, shown)
}

/// One block of the list: a heading (a machine's or a status group's), a session with its subagents, or the blank
/// line between two groups.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Block {
    Machine(usize),
    Session(usize, usize),
    Gap,
}

/// The session open in the workspace, which shows its subagents one per row.
fn open_session(app: &App) -> Option<ClientSession> {
    app.focused().map(|id| app.session_key(id))
}

fn block_h(sm: &SideModel, b: Block, open: Option<ClientSession>) -> u16 {
    match b {
        Block::Machine(_) | Block::Gap => 1,
        Block::Session(mi, ri) => {
            let r = &sm.machines[mi].rows[ri];
            let open = Some(r.key) == open;
            session_h(open) + subs_h(r, open)
        }
    }
}

/// The lines a session's subagents take under it.
fn subs_h(r: &SideRow, open: bool) -> u16 {
    let rows = match r.subs.len() {
        0 => 0,
        n if open => n as u16,
        _ => 1,
    };
    rows + u16::from(open && r.subs_done > 0)
}

/// `word` with its first letter in capitals, for a label.
pub(super) fn capitalised(word: &str) -> String {
    let mut chars = word.chars();
    chars.next().map_or_else(String::new, |first| first.to_uppercase().chain(chars).collect())
}

fn blocks(sm: &SideModel) -> Vec<Block> {
    let mut out = Vec::new();
    for (mi, m) in sm.machines.iter().enumerate() {
        if mi > 0 {
            out.push(Block::Gap);
        }
        out.push(Block::Machine(mi));
        if m.folded {
            continue;
        }
        for (ri, row) in m.rows.iter().enumerate() {
            if !row.hidden {
                out.push(Block::Session(mi, ri));
            }
        }
    }
    out
}

/// The key a heading's fold is kept under in the saved state.
pub(super) fn machine_fold_key(label: &str) -> String {
    format!("m:{label}")
}

/// The sidebar: its frame, the header, the sessions by group and the footer.
pub(in crate::client) fn draw_side(
    app: &mut App,
    buf: &mut Buffer,
    r: Rect,
    model: &[Proj],
    t: &Theme,
) {
    let focused = side_focused(app);
    let mut c = Card::new(t, "");
    if focused {
        c = c.lit(t.text);
    }
    let inside = card(app, buf, r, &c, t);
    fill(buf, inside, t.bg);
    app.screen.side_rect = r;
    hit(app, r, ScreenHit::SideFocus);
    if r.width < 12 || r.height < 7 {
        return;
    }
    draw_header(app, buf, r, t);
    draw_foot(app, buf, r, t);
    let sm = SideModel::build(app, model);
    let open = open_session(app);
    app.screen.side_items = sm.items();
    app.screen.visible = sm
        .machines
        .iter()
        .flat_map(|m| m.rows.iter().filter(|x| !x.hidden).map(|x| x.key))
        .collect();
    app.screen.row_y.clear();
    app.screen.sub_rows.clear();
    app.screen.sub_ids.clear();
    app.screen.fold_keys.clear();
    // Every session the panes of this view show, so a split's other panes are marked in the list as well as the focused one.
    app.screen.in_view = app.panes.iter().map(|(term, _)| app.session_key(*term)).collect();
    let top = r.y + 3;
    let bottom = r.bottom().saturating_sub(3);
    draw_list(app, buf, r, (top, bottom), &sm, open, t);
    app.screen.follow = false;
}

/// Whether an update is on offer or waits for a restart: the `menu` button and the rail carry a mark.
fn update_waits(app: &App) -> bool {
    app.update_available.is_some() || app.restart_needed()
}

/// The update mark: a square, or a dot when corners are round.
fn update_mark(app: &App) -> &'static str {
    if Look::of(&app.cfg.ui).caps { UPDATE_DOT } else { UPDATE_SQUARE }
}

/// The sidebar collapsed to a narrow column: `»` opens it again, then search and a new chat, one mark per session
/// with a short rule between groups, and `≡` (the menu, with the update mark) at the bottom.
pub(in crate::client) fn draw_rail(app: &mut App, buf: &mut Buffer, r: Rect, model: &[Proj], t: &Theme) {
    let inside = card(app, buf, r, &Card::new(t, ""), t);
    fill(buf, inside, t.bg);
    if r.width < 5 || r.height < 9 {
        return;
    }
    let right = app.cfg.ui.sidebar_position == "right";
    let x = r.x + r.width / 2;
    let button = |app: &mut App, buf: &mut Buffer, y: u16, text: &str, target: ScreenHit| {
        put(buf, x, y, &[seg(text, Style::default().fg(t.muted).bg(t.bg))], x + 1);
        hit(app, Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: 1 }, target);
    };
    button(app, buf, r.y + 1, if right { HIDE } else { SHOW }, ScreenHit::ExpandSidebar);
    button(app, buf, r.y + 2, SEARCH, ScreenHit::SidebarSearch);
    button(app, buf, r.y + 3, NEW, ScreenHit::NewMenu);
    app.screen.new_at = (x, r.y + 4);
    let foot = r.bottom().saturating_sub(2);
    button(app, buf, foot, FILTER, ScreenHit::Actions);
    if update_waits(app) {
        put(buf, x + 1, foot, &[seg(update_mark(app), Style::default().fg(t.accent).bg(t.bg))], x + 2);
    }
    app.screen.release_in_side = update_waits(app);
    let open = open_session(app);
    let sm = SideModel::build(app, model);
    let mut y = r.y + 5;
    for (gi, m) in sm.machines.iter().enumerate() {
        if gi > 0 {
            put(buf, x, y, &[seg("─", Style::default().fg(t.line).bg(t.bg))], x + 1);
            y += 1;
        }
        for row in &m.rows {
            if y + 1 >= foot {
                return;
            }
            let ground = if Some(row.key) == open { t.sel_bg() } else { t.bg };
            let line = Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: 1 };
            fill(buf, line, ground);
            let mark = app.state_mark(row.state, t);
            put(buf, x, y, &[seg(mark.glyph, Style::default().fg(mark.color).bg(ground).add_modifier(Modifier::BOLD))], x + 2);
            hit(app, line, ScreenHit::Session(row.key));
            y += 1;
        }
    }
}

/// The header, inside the frame's top: the name and how the list is grouped at the left, and the buttons for search,
/// a new chat, the group menu and collapse at the right.
fn draw_header(app: &mut App, buf: &mut Buffer, r: Rect, t: &Theme) {
    let y = r.y + 1;
    let base = Style::default().bg(t.bg);
    let end = r.right().saturating_sub(2);
    let mut how = if app.screen.saved.group_machine { "machine".to_string() } else { "status".to_string() };
    match app.screen.saved.side_sort.as_str() {
        "oldest" => how.push_str(" · oldest"),
        "az" => how.push_str(" · a–z"),
        _ => {}
    }
    // Each button is a glyph with a cell either side to click.
    let buttons = [(HIDE, ScreenHit::CollapseSidebar), (FILTER, ScreenHit::GroupFolders), (NEW, ScreenHit::NewMenu), (SEARCH, ScreenHit::SidebarSearch)];
    // The grouping words give way to the buttons rather than run under them.
    let room = end.saturating_sub(3 * buttons.len() as u16);
    put(buf, r.x + 2, y, &[seg(TITLE, base.fg(t.strong).add_modifier(Modifier::BOLD)), seg(format!(" {how}"), base.fg(t.muted))], room);
    let mut x = end;
    for (text, target) in buttons {
        x = x.saturating_sub(3);
        put(buf, x + 1, y, &[seg(text, base.fg(t.muted))], x + 2);
        hit(app, Rect { x, y, width: 3, height: 1 }, target);
        match target {
            ScreenHit::NewMenu => app.screen.new_at = (x, y + 1),
            ScreenHit::GroupFolders => app.screen.group_at = (x, y + 1),
            _ => {}
        }
    }
}

/// The footer: a rule, then `menu` (with the update mark) at the left and `? keys` at the right.
fn draw_foot(app: &mut App, buf: &mut Buffer, r: Rect, t: &Theme) {
    let rule = r.bottom().saturating_sub(3);
    let y = r.bottom().saturating_sub(2);
    let base = Style::default().bg(t.bg);
    let end = r.right().saturating_sub(2);
    put(buf, r.x + 1, rule, &[seg("─".repeat(r.width.saturating_sub(2) as usize), base.fg(t.line))], r.right().saturating_sub(1));
    let x = r.x + 2;
    let mut menu = vec![seg(MENU, base.fg(t.text))];
    if update_waits(app) {
        menu.push(seg(update_mark(app), base.fg(t.accent)));
    }
    let after = put(buf, x, y, &menu, end);
    hit(app, Rect { x, y, width: after.saturating_sub(x).max(1), height: 1 }, ScreenHit::Actions);
    let kw = KEYS.chars().count() as u16;
    let kx = end.saturating_sub(kw);
    // A build that is not a clean release says which it is, between `menu` and `? keys`, so a stale one shows.
    let note = build_note();
    let note = note.trim();
    if !note.is_empty() {
        let nw = note.width() as u16;
        let nx = after + 2;
        if nx + nw < kx {
            put(buf, nx, y, &[seg(note, base.fg(t.muted))], kx);
        }
    }
    if kx > after + 1 {
        put(buf, kx, y, &[seg(KEYS, base.fg(t.muted))], end);
        hit(app, Rect { x: kx, y, width: kw, height: 1 }, ScreenHit::SidebarKeys);
    }
    app.screen.release_in_side = update_waits(app);
}

/// ` abc1234* 12m` for a build that is not a clean release: the commit, `*` for uncommitted
/// changes and how long ago it was built. Empty for a release, and in tests.
pub(in crate::client) fn build_note() -> String {
    let build = env!("APP_BUILD");
    if build.is_empty() || cfg!(test) {
        return String::new();
    }
    let built: u64 = env!("APP_BUILT_UNIX").parse().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    let minutes = now.saturating_sub(built) / 60;
    let age = if minutes < 60 { format!("{minutes}m") } else { format!("{}h", minutes / 60) };
    format!(" {build} {age}")
}

/// The block the cursor, or failing that the open session, sits in.
fn wanted_block(app: &App, sm: &SideModel, list: &[Block]) -> Option<usize> {
    let key = app
        .screen
        .cursor
        .filter(|_| side_focused(app))
        .or_else(|| open_session(app))?;
    list.iter().position(|b| {
        matches!(*b, Block::Session(mi, ri) if sm.machines[mi].rows[ri].key == key)
    })
}

#[allow(clippy::too_many_arguments)]
fn draw_list(
    app: &mut App,
    buf: &mut Buffer,
    r: Rect,
    (top, bottom): (u16, u16),
    sm: &SideModel,
    open: Option<ClientSession>,
    t: &Theme,
) {
    let room = bottom.saturating_sub(top);
    if room == 0 {
        return;
    }
    if sm.machines.is_empty() {
        let msg = if sm.filtering { "no match" } else { "no sessions yet" };
        put(
            buf,
            r.x + NAME_X,
            top,
            &[seg(msg, Style::default().fg(t.muted).bg(t.bg))],
            r.right().saturating_sub(1),
        );
        return;
    }
    let list = blocks(sm);
    let heights: Vec<u16> = list.iter().map(|b| block_h(sm, *b, open)).collect();
    let want = if app.screen.follow || side_focused(app) {
        wanted_block(app, sm, &list)
    } else {
        None
    };
    let (first, shown) = window(&heights, app.screen.side_scroll as usize, want, room);
    app.screen.side_scroll = first as u16;
    let mut y = top;
    for (b, h) in list.iter().zip(&heights).skip(first).take(shown) {
        match *b {
            Block::Machine(mi) => {
                let machine = &sm.machines[mi];
                if machine.status_group {
                    draw_status_head(app, buf, r, y, machine, t);
                } else {
                    draw_machine(app, buf, r, y, machine, t);
                }
            }
            Block::Session(mi, ri) => {
                let row = &sm.machines[mi].rows[ri];
                draw_session(app, buf, r, y, row, Some(row.key) == open, t);
            }
            Block::Gap => {}
        }
        y += h;
    }
    scroll_marks(
        buf,
        r.right().saturating_sub(2),
        (top, room),
        (first > 0, first + shown < list.len()),
        Style::default().bg(t.bg).fg(t.muted),
    );
}

/// A status group's heading: its name in bold and the number of sessions under it. A click folds the group.
fn draw_status_head(app: &mut App, buf: &mut Buffer, r: Rect, y: u16, m: &MachineSection, t: &Theme) {
    let x = r.x + 2;
    let end = r.right().saturating_sub(2);
    let base = Style::default().bg(t.bg);
    put(
        buf,
        x,
        y,
        &[
            seg(m.label.clone(), base.fg(t.muted).add_modifier(Modifier::BOLD)),
            seg(format!(" {}", m.rows.len()), base.fg(t.muted)),
        ],
        end,
    );
    app.screen.fold_keys.push(machine_fold_key(&m.label));
    let n = app.screen.fold_keys.len() - 1;
    hit(app, Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: 1 }, ScreenHit::Fold(n));
}

/// A machine heading: its name chip with the number of sessions, a `+` chip that starts a shell
/// there at once (` install ` or ` update ` instead while the app there needs it), and the
/// connection dot at the right.
fn draw_machine(app: &mut App, buf: &mut Buffer, r: Rect, y: u16, m: &MachineSection, t: &Theme) {
    let x = r.x + 1;
    let end = r.right().saturating_sub(1);
    hit(app, Rect { x, y, width: end.saturating_sub(x), height: 1 }, ScreenHit::MachineHead(m.id));
    let name = chip(app, &m.label, Chip::Title { focused: false }, t.bg, t);
    // The count sits inside the chip, quieter than the name.
    let mut segs = vec![seg(format!("{} ", if m.folded { FOLDED } else { OPEN }), Style::default().fg(t.accent).bg(t.bg))];
    segs.extend(name);
    let count = Style::default().fg(t.muted).bg(t.btn);
    if let Some(last) = segs.pop() {
        segs.push(seg(format!(" {}", m.rows.len()), count));
        segs.push(last);
    }
    let after = put(buf, x, y, &segs, end.saturating_sub(4));
    // The arrow and the name fold the machine; the rest of the row keeps what a click on it did.
    app.screen.fold_keys.push(machine_fold_key(&m.label));
    let n = app.screen.fold_keys.len() - 1;
    hit(app, Rect { x, y, width: after.saturating_sub(x), height: 1 }, ScreenHit::FoldMachine(n, m.id));
    let (text, act) = match m.fix {
        Some(fix) => (capitalised(fix.verb()), ScreenHit::MachineFix(m.id)),
        None => ("+".to_string(), ScreenHit::MachinePlus(m.id)),
    };
    let plus = chip(app, &text, Chip::Action, t.bg, t);
    let pw = segs_width(&plus);
    let px = after + 1;
    if px + pw < end.saturating_sub(2) {
        put(buf, px, y, &plus, end);
        hit(app, Rect { x: px, y, width: pw, height: 1 }, act);
    }
    let (dot, colour) = if m.down {
        (RECONNECTING_MARK, t.idle)
    } else {
        (ONLINE_DOT, t.done)
    };
    let dx = end.saturating_sub(2);
    put(buf, dx, y, &[seg(dot, Style::default().fg(colour).bg(t.bg))], dx + 1);
}

/// The colour a pull request's headline takes. Not `blocked`: that one means the agent needs you.
fn pr_colour(tone: PrTone, t: &Theme) -> Color {
    match tone {
        PrTone::Bad => t.err,
        PrTone::Good => t.done,
        PrTone::Waiting => t.working,
        PrTone::Plain => t.muted,
    }
}

/// `limited 16:30`: the session hit its plan limit, and the local time it goes on; with the
/// weekday (`limited Thu 16:30`) when that is not today, since a weekly limit resets days away.
fn limited_note(resume_at: u64, now: u64) -> String {
    use crate::clock::{local_day, local_hm, local_weekday};
    let time = local_hm(resume_at);
    if local_day(resume_at) == local_day(now) {
        format!("limited {time}")
    } else {
        format!("limited {} {time}", local_weekday(resume_at))
    }
}

/// One session: its mark, name and age, the project and branch under it, and for the open session a line saying
/// what it is doing; then its subagents.
/// The cursor in a name being typed.
const CURSOR: &str = "▏";

/// The last `max` columns of `text`, so what is being typed stays in view.
fn tail(text: &str, max: usize) -> String {
    let mut kept: Vec<char> = Vec::new();
    let mut width = 0;
    for c in text.chars().rev() {
        let w = c.to_string().width();
        if width + w > max {
            break;
        }
        width += w;
        kept.push(c);
    }
    kept.into_iter().rev().collect()
}

/// What is typed over this row's name while it is renamed in place (the row shows it with a cursor, `Enter` saves).
fn typing_name(app: &App, row: &SideRow) -> Option<String> {
    use crate::client::PromptKind;
    let Mode::Prompt { kind, input } = &app.mode else {
        return None;
    };
    let mine = match kind {
        PromptKind::RenamePane(t) => row.term == Some(*t),
        PromptKind::RenameConversation(id) => {
            let of_term = row.term.and_then(|t| app.term_info(t)).and_then(|i| i.conversation_id);
            matches!(row.key.key, SessionKey::Conversation(c) if c == *id) || of_term == Some(*id)
        }
        _ => false,
    };
    mine.then(|| input.clone())
}

/// A rename is typed on the sidebar's row, so it asks for no box of its own.
pub(in crate::client) fn renames_in_place(app: &App) -> bool {
    use crate::client::PromptKind;
    matches!(&app.mode, Mode::Prompt { kind: PromptKind::RenamePane(_) | PromptKind::RenameConversation(_), .. })
        && app.screen.side_rect.width > 0
}

fn draw_session(app: &mut App, buf: &mut Buffer, r: Rect, y: u16, row: &SideRow, open: bool, t: &Theme) {
    let height = session_h(open);
    let picked = side_focused(app) && app.screen.cursor == Some(row.key);
    let ground = if picked || open { t.sel_bg() } else { t.bg };
    let lines = Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height };
    fill(buf, lines, ground);
    let base = Style::default().bg(ground);
    let end = r.right().saturating_sub(2);
    if open {
        for dy in 0..height {
            put(buf, r.x + BAR_X, y + dy, &[seg("▎", base.fg(t.strong))], r.x + BAR_X + 1);
        }
    } else if app.screen.in_view.contains(&row.key) {
        // Shown in another pane of this view: the same bar, quieter, so every pane of a split is marked.
        for dy in 0..height {
            put(buf, r.x + BAR_X, y + dy, &[seg("▎", base.fg(t.muted))], r.x + BAR_X + 1);
        }
    }
    let mark = app.state_mark(row.state, t);
    put(
        buf,
        r.x + MARK_X,
        y,
        &[seg(mark.glyph, base.fg(mark.color).add_modifier(Modifier::BOLD))],
        // The room before the name: a spinner may be two cells (the Bars frames), and clipping it to one showed two bars, not three.
        r.x + NAME_X,
    );
    let age = row.age.map(age_label).unwrap_or_default();
    let age_w = age.width() as u16;
    let name_style = if row.busy() {
        base.fg(t.strong).add_modifier(Modifier::BOLD)
    } else if row.state == State::Unknown {
        base.fg(t.idle)
    } else {
        base.fg(t.text)
    };
    let mut room = end.saturating_sub(r.x + NAME_X + age_w + 1) as usize;
    let typing = typing_name(app, row);
    // A name being typed keeps the whole line.
    if let Some(note) = row.helpers.note(room).filter(|_| typing.is_none()) {
        let note_w = note.width() as u16;
        let colour = if row.helpers.needs > 0 { t.blocked } else { t.muted };
        let right = end.saturating_sub(if age_w > 0 { age_w + 1 } else { 0 });
        put(buf, right.saturating_sub(note_w), y, &[seg(note, base.fg(colour))], right);
        room = room.saturating_sub(note_w as usize + 1);
    }
    match typing {
        Some(typed) => {
            let shown = tail(&typed, room.saturating_sub(1));
            put(buf, r.x + NAME_X, y, &[seg(format!("{shown}{CURSOR}"), base.fg(t.strong).add_modifier(Modifier::BOLD))], end)
        }
        None => put(buf, r.x + NAME_X, y, &[seg(truncate(&row.name, room.max(1)), name_style)], end),
    };
    if age_w > 0 {
        put(buf, end.saturating_sub(age_w), y, &[seg(age, base.fg(t.muted))], end);
    }

    // `project / branch`, a `⑂` for a worktree of its own and the machine when it is not this one; then a plan limit and
    // the pull request, when there are any.
    let mut place = row.project.clone();
    if !row.branch.is_empty() {
        place.push_str(" / ");
        place.push_str(&row.branch);
    }
    if row.linked {
        place.push_str(" ⑂");
    }
    if row.key.machine != MachineId::LOCAL {
        place.push_str(" · ");
        place.push_str(&row.machine);
    }
    let mut line = Vec::new();
    if let Some(starter) = &row.starter {
        line.push(seg(format!("{STARTED_BY} {}  ", truncate(starter, STARTER_NAME_MAX)), base.fg(t.muted)));
    }
    line.push(seg(place, base.fg(t.muted)));
    let limited = row.limited_until.map(|at| seg(limited_note(at, super::now_secs()), base.fg(t.blocked)));
    let pr = row.pr.as_ref().map(|(text, tone)| seg(text.clone(), base.fg(pr_colour(*tone, t))));
    for note in limited.into_iter().chain(pr) {
        line.push(seg("  ", base));
        line.push(note);
    }
    put_cut(buf, r.x + NAME_X, y + 1, line, end);
    if open {
        let machine = if row.key.machine == MachineId::LOCAL { THIS_COMPUTER.to_lowercase() } else { row.machine.clone() };
        let who = if row.agent_name.is_empty() { machine } else { format!("{} · {machine}", row.agent_name) };
        put_cut(buf, r.x + NAME_X, y + 2, vec![seg(format!("{who} · {}", row.doing()), base.fg(t.muted))], end);
    }
    if let Some(term) = row.term {
        app.screen.row_y.insert(term, y);
    }
    hit(app, lines, ScreenHit::Session(row.key));
    draw_subs(app, buf, r, y + height, row, open, t);
}

/// `segs` from `x`, the last one cut with `…` where they would pass `end`.
pub(super) fn put_cut(buf: &mut Buffer, x: u16, y: u16, segs: Vec<Seg>, end: u16) {
    let room = end.saturating_sub(x) as usize;
    let mut used = 0;
    let mut out = Vec::new();
    for (text, style) in segs {
        let w = text.width();
        if used + w <= room {
            used += w;
            out.push((text, style));
        } else {
            let left = room.saturating_sub(used);
            if left > 1 {
                out.push(seg(truncate(&text, left), style));
            }
            break;
        }
    }
    put(buf, x, y, &out, end);
}

/// Under a session: `└` and a mark per subagent, or for the open session a row each with its
/// name, then an "N done" line for the finished ones folded away. A row opens the parent's pane:
/// the agent shows its subagents in its own terminal. The "N done" line lists or folds them.
fn draw_subs(app: &mut App, buf: &mut Buffer, r: Rect, y: u16, row: &SideRow, open: bool, t: &Theme) {
    if row.subs.is_empty() && !(open && row.subs_done > 0) {
        return;
    }
    let base = Style::default().bg(t.bg);
    let end = r.right().saturating_sub(2);
    let tree = base.fg(t.faint());
    if !open {
        let mut segs = vec![seg("└", tree)];
        for s in &row.subs {
            let m = app.state_mark(s.state, t);
            segs.push(seg(" ", base));
            segs.push(seg(m.glyph, base.fg(m.color)));
        }
        put(buf, r.x + TREE_X, y, &segs, end);
        return;
    }
    let Some(term) = row.term else {
        return;
    };
    for (i, s) in row.subs.iter().enumerate() {
        let yy = y + i as u16;
        let ground = t.bg;
        let line = Rect {
            x: r.x + 1,
            y: yy,
            width: r.width.saturating_sub(2),
            height: 1,
        };
        fill(buf, line, ground);
        let st = Style::default().bg(ground);
        let m = app.state_mark(s.state, t);
        let last = i + 1 == row.subs.len() && row.subs_done == 0;
        let branch = if last { "└" } else { "├" };
        let segs = vec![
            seg(branch, st.fg(t.faint())),
            seg(" ", st),
            seg(m.glyph, st.fg(m.color)),
            seg(" ", st),
            seg(s.name.clone(), st.fg(t.text)),
        ];
        put_cut(buf, r.x + TREE_X, yy, segs, end);
        app.screen.sub_rows.push(term);
        app.screen.sub_ids.push((s.id.clone(), s.name.clone()));
        hit(app, line, ScreenHit::Subagent(app.screen.sub_rows.len() - 1));
    }
    if row.subs_done > 0 {
        let yy = y + row.subs.len() as u16;
        let line = Rect {
            x: r.x + 1,
            y: yy,
            width: r.width.saturating_sub(2),
            height: 1,
        };
        fill(buf, line, t.bg);
        let word = if row.subs_open { "hide" } else { "show" };
        let segs = vec![
            seg("└", tree),
            seg(" ", base),
            seg(format!("{} done · {word}", row.subs_done), base.fg(t.muted)),
        ];
        put_cut(buf, r.x + TREE_X, yy, segs, end);
        app.screen.done_rows.push(row.key);
        hit(app, line, ScreenHit::SubagentsDone(app.screen.done_rows.len() - 1));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::TurnEvent;

    fn row() -> SideRow {
        SideRow {
            key: ClientSession::local(SessionKey::Pane(1)),
            term: None,
            name: "Growth Tests".into(),
            project: "AeVoxGrowth".into(),
            branch: "agent/grow-025".into(),
            pr: None,
            state: State::Idle,
            age: None,
            agent_name: "Claude".into(),
            linked: false,
            limited_until: None,
            agent: true,
            process: "claude".into(),
            machine: "devbox".into(),
            starter: None,
            helpers: Helpers::default(),
            subs: Vec::new(),
            subs_done: 0,
            subs_open: false,
            hidden: false,
            order: (1, MachineId::LOCAL),
        }
    }

    #[test]
    fn the_filter_matches_name_project_process_machine_and_branch() {
        let row = row();
        for q in ["", "growth t", "AEVOX", "cla", "devbox", "  devbox ", "grow-025"] {
            assert!(row.matches(q), "{q:?}");
        }
        assert!(!row.matches("pacman"));
    }

    #[test]
    fn a_list_scrolls_to_keep_the_wanted_row_in_view_and_never_past_its_end() {
        let ones = [1u16; 10];
        assert_eq!(window(&ones, 0, None, 4), (0, 4));
        assert_eq!(window(&ones, 0, Some(6), 4), (3, 4), "the row lands at the bottom");
        assert_eq!(window(&ones, 8, None, 4), (6, 4), "no empty space under the end");
        let twos = [2u16; 5];
        assert_eq!(window(&twos, 0, Some(3), 5), (2, 2), "only whole rows are shown");
    }

    fn activity(id: &str, state: SubagentState, started: u64) -> SubagentActivity {
        SubagentActivity {
            id: id.into(),
            name: id.into(),
            parent: None,
            state,
            task: None,
            model: None,
            effort: None,
            started_at: Some(started),
            updated_at: started,
            latest_activity: None,
            result: None,
        }
    }

    #[test]
    fn running_subagents_stay_listed_and_finished_ones_fold_into_a_count() {
        let mut info: TermInfo = serde_json::from_value(serde_json::json!({
            "id": 3, "cols": 80, "rows": 24, "title": "", "process": "claude", "agent": "claude",
            "status": "Working", "cwd": "/code", "summary": "", "name": "", "model": "", "said": "",
            "branch": null, "linked": false, "subagents": [], "root": null, "top": null,
            "since": 100, "asleep": false, "win32_input": false,
        }))
        .unwrap();
        info.timeline = vec![
            TurnEvent { at: 10, kind: TurnKind::Working, detail: String::new() },
            TurnEvent { at: 20, kind: TurnKind::Done, detail: String::new() },
            TurnEvent { at: 50, kind: TurnKind::Working, detail: String::new() },
        ];
        info.subagent_activity = vec![
            activity("old", SubagentState::Completed, 12),
            activity("this turn", SubagentState::Completed, 60),
            activity("running", SubagentState::Working, 70),
        ];
        let names = |info: &TermInfo, now, show_done| {
            let (listed, done) = session_subagents(info, now, show_done);
            (listed.iter().map(|a| a.name.clone()).collect::<Vec<_>>(), done)
        };
        assert_eq!(names(&info, 60, false), (vec!["this turn".into(), "running".into()], 1));
        assert_eq!(
            names(&info, 60 + FINISHED_LINGER_SECS + 1, false),
            (vec!["running".into()], 2),
            "a finished one folds into the count after a while"
        );
        info.status = Status::Done;
        assert_eq!(
            names(&info, 60, false),
            (vec!["running".into()], 2),
            "one still running stays listed after the turn: a background helper"
        );
        assert_eq!(names(&info, 60, true).0, ["old", "this turn", "running"], "opened, the finished ones are listed too");
    }

    #[test]
    fn a_subagents_state_reads_as_a_status_mark() {
        assert_eq!(sub_state(SubagentState::Working), State::Working);
        assert_eq!(sub_state(SubagentState::AwaitingApproval), State::Needs);
        assert_eq!(sub_state(SubagentState::Completed), State::Done);
        assert_eq!(sub_state(SubagentState::Failed), State::Problem);
    }
}
