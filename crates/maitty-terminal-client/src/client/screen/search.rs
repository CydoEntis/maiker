//! Search (leader `k`, the sidebar's `⌕`): a box near the top with the typing row, then Chats
//! (the sessions, at most eight) and Commands. With nothing typed the Commands are the short
//! list the design names; typing also reaches every other command and what the sessions
//! printed. Docs: UI.md, "Search".

use super::keyoverlay::{Entry, bar, found, fuzzy_segs, input_row};
use super::status_mark::State;
use super::*;
use crate::client::design::{keycaps, long_key};
use crate::client::menu::{Act, COMPACT_OFFERED_AT};

/// Chats listed, typed or not.
const CHATS_SHOWN: usize = 8;
/// The box's width at most, and the rows above it.
const SEARCH_W: u16 = 76;
const TOP_GAP: u16 = 2;
/// Rows the box takes besides its list: two borders, the typing row and a blank under it.
const FRAME_ROWS: u16 = 4;
/// How long typed words may get.
pub(super) const QUERY_MAX: usize = 40;
/// Columns the key caps at the right may take, and the age before them.
const AGE_W: u16 = 4;

/// What picking a row does.
#[derive(Clone, Debug, PartialEq)]
enum Run {
    Chat(ClientTerm),
    Act(Action),
    GroupBy(bool),
    Compact(ClientTerm),
    /// A line a session printed: that session, at the line.
    Printed(ClientTerm),
}

#[derive(Clone)]
struct ChatRow {
    term: ClientTerm,
    state: State,
    name: String,
    /// `project / branch · machine`.
    place: String,
    age: String,
}

#[derive(Clone)]
struct CommandRow {
    label: String,
    /// Key caps as `keycaps` reads them: `Ctrl+Space k`.
    keys: String,
    run: Run,
}

#[derive(Clone)]
enum Row {
    Chat(ChatRow),
    Command(CommandRow),
    Printed(OutputHit),
}

impl Row {
    fn run(&self) -> Run {
        match self {
            Row::Chat(c) => Run::Chat(c.term),
            Row::Command(c) => c.run.clone(),
            Row::Printed(p) => Run::Printed(p.term),
        }
    }
}

/// A heading or the row `Row(i)` of the list, in the order drawn.
#[derive(Debug, PartialEq)]
enum Line {
    Head(&'static str),
    Row(usize),
}

fn head_of(row: &Row) -> &'static str {
    match row {
        Row::Chat(_) => "Chats",
        Row::Command(_) => "Commands",
        Row::Printed(_) => "In chats",
    }
}

/// The list with a heading wherever the group changes.
fn lines(rows: &[Row]) -> Vec<Line> {
    let mut out = Vec::new();
    let mut last = "";
    for (i, row) in rows.iter().enumerate() {
        let head = head_of(row);
        if head != last {
            out.push(Line::Head(head));
            last = head;
        }
        out.push(Line::Row(i));
    }
    out
}

/// The chats whose name or place match, in the sidebar's order.
fn chat_rows(app: &App, query: &str) -> Vec<Row> {
    let q: String = query.split_whitespace().collect();
    let machine_name = |m: MachineId| {
        app.remotes
            .get(&m)
            .map_or_else(|| "local".to_string(), |r| r.name.clone())
    };
    app.screen_model()
        .iter()
        .flat_map(|p| p.wts.iter().map(move |w| (p, w)))
        .flat_map(|(p, w)| w.sessions.iter().map(move |s| (p, w, s)))
        .filter_map(|(p, w, s)| {
            let term = s.native_term?;
            let machine = machine_name(p.machine);
            let place = if w.branch.is_empty() {
                format!("{} · {machine}", p.name)
            } else {
                format!("{} / {} · {machine}", p.name, w.branch)
            };
            let exit = app.term_info(term).is_some_and(|i| i.exit.is_some());
            let failed = super::status_mark::failed(exit, s.status, s.check.as_ref());
            Some(ChatRow {
                term,
                state: State::of(s.status, failed, s.down),
                name: s.name.clone(),
                place,
                age: age(s.since),
            })
        })
        .filter(|c| {
            q.is_empty()
                || super::fuzzy::fuzzy_indices(&q, &c.name).is_some()
                || super::fuzzy::fuzzy_indices(&q, &c.place).is_some()
        })
        .take(CHATS_SHOWN)
        .map(Row::Chat)
        .collect()
}

/// The key that runs `a` after the leader, as caps: `Ctrl+Space k`.
fn leader_keys(app: &App, a: &Action) -> String {
    let keys = key_text(app, std::slice::from_ref(a));
    match keys.split("  ").next().filter(|k| !k.is_empty()) {
        Some(first) => format!("{} {first}", long_key(&app.keymap.prefix)),
        None => String::new(),
    }
}

fn command(app: &App, label: &str, a: Action) -> CommandRow {
    CommandRow { label: label.into(), keys: leader_keys(app, &a), run: Run::Act(a) }
}

/// The commands the design lists, those that apply now.
fn curated(app: &App) -> Vec<CommandRow> {
    let mut out = vec![command(app, "New chat", Action::PickSession), command(app, "Show changes", Action::Changes)];
    let full = app
        .selected_term()
        .filter(|t| app.term_info(*t).is_some_and(|i| i.agent.is_some() && i.usage.context.is_some_and(|c| c >= COMPACT_OFFERED_AT)));
    if let Some(term) = full {
        out.push(CommandRow { label: "Compact this chat".into(), keys: String::new(), run: Run::Compact(term) });
    }
    out.push(command(app, "Settings", Action::Settings));
    let sidebar = if app.sidebar { "Collapse sidebar" } else { "Expand sidebar" };
    out.push(command(app, sidebar, Action::ToggleSidebar));
    let by_machine = app.screen.saved.group_machine;
    let group = if by_machine { "Group by status" } else { "Group by machine" };
    out.push(CommandRow { label: group.into(), keys: String::new(), run: Run::GroupBy(!by_machine) });
    let theme = if app.cfg.appearance == "light" { "Dark theme" } else { "Light theme" };
    out.push(command(app, theme, Action::ToggleAppearance));
    if app.update_available.is_some() && !app.updating {
        out.push(command(app, "Install update", Action::Update));
    }
    out.push(command(app, "Keys", Action::Help));
    out
}

/// Keys of a command found by typing: the ones after the leader get the leader before them.
fn found_keys(app: &App, e: &Entry) -> String {
    if e.keys.is_empty() || e.group == "No leader" {
        e.keys.clone()
    } else {
        format!("{} {}", long_key(&app.keymap.prefix), e.keys.split("  ").next().unwrap_or_default())
    }
}

/// Whether `label` has the typed letters in order, in any case.
fn matches(query: &str, label: &str) -> bool {
    super::fuzzy::fuzzy_indices(query, &label.to_lowercase()).is_some()
}

fn command_rows(app: &App, query: &str) -> Vec<Row> {
    let q: String = query.split_whitespace().collect::<String>().to_lowercase();
    let mut out: Vec<CommandRow> = curated(app);
    if q.is_empty() {
        return out.into_iter().map(Row::Command).collect();
    }
    out.retain(|c| matches(&q, &c.label));
    for e in found(app, query) {
        let Some(a) = e.act.clone() else { continue };
        if out.iter().any(|c| c.label == e.label || c.run == Run::Act(a.clone())) {
            continue;
        }
        out.push(CommandRow { keys: found_keys(app, &e), label: e.label, run: Run::Act(a) });
    }
    out.into_iter().map(Row::Command).collect()
}

/// Everything the box lists for `query`, in the order it is drawn and numbered.
fn rows(app: &App, query: &str) -> Vec<Row> {
    let mut out = chat_rows(app, query);
    out.extend(command_rows(app, query));
    out.extend(app.palette_output_hits(query).into_iter().map(Row::Printed));
    out
}

/// What each row runs, in the order they are numbered.
pub(super) fn actions(app: &App, query: &str) -> Vec<Option<Action>> {
    rows(app, query)
        .iter()
        .map(|r| match r.run() {
            Run::Act(a) => Some(a),
            _ => None,
        })
        .collect()
}

pub(super) fn row_count(app: &App, query: &str) -> usize {
    rows(app, query).len()
}

/// The box: `⌕` and the typing, the groups under it, and the keys on the bottom border.
pub(in crate::client) fn draw_search(app: &mut App, buf: &mut Buffer, area: Rect, t: &Theme, km: &KeyMap) {
    let rows = rows(app, &km.query);
    let lines = lines(&rows);
    dim_all(app, buf, area, t);
    hit(app, area, ScreenHit::Close);
    let w = SEARCH_W.min(area.width.saturating_sub(4));
    let wanted = FRAME_ROWS + u16::try_from(lines.len().max(1)).unwrap_or(u16::MAX);
    let h = wanted.min(area.height.saturating_sub(TOP_GAP + 1));
    let r = Rect { x: area.x + (area.width - w) / 2, y: area.y + TOP_GAP, width: w, height: h };
    let mut c = Card::new(t, "Search").lit(t.blocked);
    c.bg = t.bg;
    c.close = Some(ScreenHit::Close);
    app.screen.modal_rects.push(r);
    let inside = card(app, buf, r, &c, t);
    hit(app, r, ScreenHit::Noop);

    let ps = Style::default().bg(t.card2);
    let mut typed = vec![seg("⌕ ", ps.fg(t.muted)), seg(km.query.clone(), ps.fg(t.strong).add_modifier(Modifier::BOLD)), seg("█", ps.fg(t.accent))];
    if km.query.is_empty() {
        typed.push(seg(" Search chats and commands", ps.fg(t.muted)));
    }
    input_row(app, buf, r, r.y + 1, t, typed);

    let first_y = r.y + 3;
    let cap = usize::from(inside.bottom().saturating_sub(first_y));
    let at = lines.iter().position(|l| *l == Line::Row(km.sel)).unwrap_or(0);
    let start = at.saturating_sub(cap.saturating_sub(1));
    let visible: Vec<(u16, &Line)> = lines.iter().skip(start).take(cap).enumerate().map(|(o, l)| (first_y + o as u16, l)).collect();
    let rect_of = |y: u16| Rect { x: r.x + 2, y, width: r.width.saturating_sub(4), height: 1 };
    // Pointing at a row moves the selection to it, so one row is lit, not two.
    let lit = visible
        .iter()
        .find_map(|(y, l)| match l {
            Line::Row(i) if hovered(app, rect_of(*y)) => Some(*i),
            _ => None,
        })
        .unwrap_or(km.sel);
    let needle: String = km.query.split_whitespace().collect::<String>().to_lowercase();
    for (y, line) in visible {
        match line {
            Line::Head(name) => {
                put(buf, r.x + 3, y, &[seg(*name, Style::default().bg(t.bg).fg(t.muted).add_modifier(Modifier::BOLD))], r.right().saturating_sub(3));
            }
            Line::Row(i) => {
                let rr = rect_of(y);
                draw_row(app, buf, rr, &rows[*i], (*i == lit, &needle), t);
                hit(app, rr, ScreenHit::KeyRow(*i));
            }
        }
    }
    if rows.is_empty() {
        put(buf, r.x + 3, first_y, &[seg("Nothing matches.", Style::default().bg(t.bg).fg(t.muted))], r.right().saturating_sub(3));
    }
    bar(buf, inside, t, &[("↑ ↓", "move"), ("Enter", "open"), ("Esc", "close")]);
}

fn draw_row(app: &App, buf: &mut Buffer, rr: Rect, row: &Row, (on, needle): (bool, &str), t: &Theme) {
    let bg = if on { t.sel_on(t.bg) } else { t.bg };
    if on {
        row_pill(Look::of(&app.cfg.ui), buf, rr.x, rr.y, rr.width, bg, t.bg);
        put(buf, rr.x, rr.y, &[seg("▌", Style::default().bg(bg).fg(t.accent).add_modifier(Modifier::BOLD))], rr.x + 1);
    }
    let lit = Style::default().bg(bg).fg(t.accent).add_modifier(Modifier::BOLD);
    let end = rr.right().saturating_sub(1);
    match row {
        Row::Chat(c) => {
            let mark = app.state_mark(c.state, t);
            put(buf, rr.x + 2, rr.y, &[seg(mark.glyph, Style::default().bg(bg).fg(mark.color))], rr.x + 4);
            let age_x = end.saturating_sub(AGE_W);
            put(buf, age_x, rr.y, &[seg(format!("{:>w$}", c.age, w = usize::from(AGE_W)), Style::default().bg(bg).fg(t.muted))], end);
            let plain = Style::default().bg(bg).fg(if c.state == State::Unknown { t.idle } else { t.strong });
            let name_end = put(buf, rr.x + 4, rr.y, &fuzzy_segs(&c.name, needle, plain, lit), age_x.saturating_sub(1));
            put(buf, name_end + 2, rr.y, &[seg(c.place.clone(), Style::default().bg(bg).fg(t.muted))], age_x.saturating_sub(1));
        }
        Row::Command(c) => {
            let caps = keycaps(t, &c.keys, bg);
            let cw = segs_width(&caps);
            put(buf, end.saturating_sub(cw), rr.y, &caps, end);
            let plain = Style::default().bg(bg).fg(t.strong);
            put(buf, rr.x + 2, rr.y, &fuzzy_segs(&c.label, needle, plain, lit), end.saturating_sub(cw + 1));
        }
        Row::Printed(p) => {
            put(buf, rr.x + 2, rr.y, &[seg(">_", Style::default().bg(bg).fg(t.muted))], rr.x + 5);
            let name_w = u16::try_from(p.name.chars().count()).unwrap_or(u16::MAX);
            let name_x = end.saturating_sub(name_w);
            put(buf, name_x, rr.y, &[seg(p.name.clone(), Style::default().bg(bg).fg(t.muted))], end);
            put(buf, rr.x + 5, rr.y, &[seg(p.snippet.clone(), Style::default().bg(bg).fg(t.text))], name_x.saturating_sub(1));
        }
    }
}

impl App {
    /// Run what row `i` of the box stands for (a click, or Enter).
    pub(in crate::client) fn search_run(&mut self, query: &str, i: usize) {
        let Some(row) = rows(self, query).get(i).cloned() else {
            return;
        };
        match row.run() {
            Run::Chat(term) => {
                self.mode = Mode::Normal;
                self.screen_focus(term);
            }
            Run::Act(a) => self.keymap_do(a),
            Run::GroupBy(machine) => {
                self.mode = Mode::Normal;
                self.menu_do(Act::GroupBy(machine));
            }
            Run::Compact(term) => {
                self.mode = Mode::Normal;
                self.send_compact(term);
            }
            Run::Printed(term) => self.open_output_hit(term, query),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_heading_comes_where_the_group_changes() {
        let chat = |name: &str| ChatRow { term: ClientTerm::on(MachineId::LOCAL, 1), state: State::Idle, name: name.into(), place: String::new(), age: String::new() };
        let command = CommandRow { label: "Keys".into(), keys: String::new(), run: Run::Act(Action::Help) };
        let rows = vec![Row::Chat(chat("a")), Row::Chat(chat("b")), Row::Command(command)];
        assert_eq!(
            lines(&rows),
            [Line::Head("Chats"), Line::Row(0), Line::Row(1), Line::Head("Commands"), Line::Row(2)]
        );
    }
}
