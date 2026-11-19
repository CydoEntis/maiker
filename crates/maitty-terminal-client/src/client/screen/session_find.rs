//! Find in every session: what this computer's sessions printed recently, searched by the daemon
//! (`Query::PaneSearch`), both as its own list (Search commands' *Find in every session*) and as
//! the IN SESSIONS rows of Search commands. Each search copies every pane's recent output on the
//! daemon, so one runs at a time and only after a pause in typing; the answer carries no tag, so
//! it belongs to the one search in flight.

use super::*;
use crate::protocol::{ClientMsg, Query, SearchHit};
use std::time::Duration;

/// A search starts once this many characters are typed: fewer match nearly every line.
pub(in crate::client) const OUTPUT_MIN_CHARS: usize = 3;
/// The most session-output rows Search commands lists.
pub(in crate::client) const OUTPUT_HIT_LIMIT: usize = 10;
/// The pause in typing before a search is sent.
const SEARCH_DELAY: Duration = Duration::from_millis(300);
/// A search unanswered this long is given up, so the next one can go.
const SEARCH_GIVE_UP: Duration = Duration::from_secs(10);
/// The longest query the view takes; the daemon refuses past 200.
const QUERY_MAX: usize = 120;
/// A row's snippet: at most this many cells, with this many before the match.
const SNIPPET_CELLS: usize = 60;
const CELLS_BEFORE_MATCH: usize = 16;
/// The session column of the view.
const NAME_CELLS: usize = 24;
/// The widest and tallest the view gets.
const VIEW_MAX_W: u16 = 110;
const VIEW_MAX_H: u16 = 30;

/// The window's one search at a time, and the last answer.
#[derive(Default)]
pub(in crate::client) struct PaneSearch {
    /// The query sent and not answered yet, and when.
    running: Option<(String, Instant)>,
    /// The newest query typed, to send once its pause is over and nothing runs.
    due: Option<(String, Instant)>,
    /// The last answer and the query it answers.
    answer: Option<(String, Vec<SearchHit>)>,
}

/// The view's state: what is typed and which row is chosen.
#[derive(Debug, Clone, Default, PartialEq)]
pub(in crate::client) struct SessionFind {
    pub query: String,
    pub sel: usize,
}

/// One line some session printed, as a row: the session, its state and the line.
#[derive(Clone)]
pub(in crate::client) struct OutputHit {
    pub term: ClientTerm,
    pub state: status_mark::State,
    pub name: String,
    pub snippet: String,
}

/// The query as it is searched: trimmed, and only when long enough.
fn searched(query: &str) -> Option<String> {
    let q = query.trim();
    (q.chars().count() >= OUTPUT_MIN_CHARS).then(|| q.to_string())
}

/// The line cut around the match: at most `SNIPPET_CELLS` wide, `CELLS_BEFORE_MATCH` of it
/// before the match, an ellipsis where something was cut. Control and invisible characters
/// (which could make the line read as something it is not) are dropped first.
pub(in crate::client) fn snippet(line: &str, query: &str) -> String {
    use unicode_width::UnicodeWidthChar;
    let clean = crate::hidden::sanitize(line, false);
    let text: Vec<char> = clean.split_whitespace().collect::<Vec<_>>().join(" ").chars().collect();
    let lower: String = text.iter().collect::<String>().to_lowercase();
    let needle = query.trim().to_lowercase();
    // The match's place in characters (lowercasing can change byte lengths, not this order).
    let at = lower
        .find(&needle)
        .map(|b| lower[..b].chars().count())
        .unwrap_or(0)
        .min(text.len());
    let cells = |c: &char| c.width().unwrap_or(0);
    let mut start = at;
    let mut before = 0;
    while start > 0 && before + cells(&text[start - 1]) <= CELLS_BEFORE_MATCH {
        start -= 1;
        before += cells(&text[start]);
    }
    let lead = if start > 0 { "…" } else { "" };
    let room = SNIPPET_CELLS - lead.chars().count();
    let rest = &text[start..];
    let width: usize = rest.iter().map(cells).sum();
    if width <= room {
        return format!("{lead}{}", rest.iter().collect::<String>());
    }
    let mut out = String::from(lead);
    let mut used = 0;
    for c in rest {
        if used + cells(c) > room - 1 {
            break;
        }
        used += cells(c);
        out.push(*c);
    }
    out.push('…');
    out
}

/// `text` with every case-blind occurrence of `query` in `lit`.
fn lit_matches(text: &str, query: &str, plain: Style, lit: Style) -> Vec<Seg> {
    let needle: Vec<char> = query.trim().to_lowercase().chars().collect();
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars
        .iter()
        .map(|c| c.to_lowercase().next().unwrap_or(*c))
        .collect();
    let mut out: Vec<Seg> = Vec::new();
    let mut i = 0;
    let mut run = String::new();
    while i < chars.len() {
        if !needle.is_empty() && lower[i..].starts_with(&needle) {
            if !run.is_empty() {
                out.push(seg(std::mem::take(&mut run), plain));
            }
            out.push(seg(chars[i..i + needle.len()].iter().collect::<String>(), lit));
            i += needle.len();
        } else {
            run.push(chars[i]);
            i += 1;
        }
    }
    if !run.is_empty() {
        out.push(seg(run, plain));
    }
    out
}

impl App {
    /// The query whatever is on screen searches for now: the view's, or Search commands'.
    fn pane_search_wanted(&self) -> Option<String> {
        match &self.mode {
            Mode::FindSessions(v) => searched(&v.query),
            Mode::KeyMap(km) if km.view == KeyView::Search && km.step.is_none() => {
                searched(&km.query)
            }
            _ => None,
        }
    }

    /// Called after every event: send the search the screen wants once typing has paused and
    /// nothing else is out. A search left unanswered too long is given up.
    pub(in crate::client) fn pane_search_tick(&mut self) {
        let wanted = self.pane_search_wanted();
        let s = &mut self.pane_search;
        if s.running.as_ref().is_some_and(|(_, at)| at.elapsed() >= SEARCH_GIVE_UP) {
            s.running = None;
        }
        let Some(q) = wanted else {
            s.due = None;
            return;
        };
        let answered = s.answer.as_ref().is_some_and(|(a, _)| *a == q);
        let asked = s.running.as_ref().is_some_and(|(r, _)| *r == q);
        if answered || asked {
            s.due = None;
            return;
        }
        match &s.due {
            Some((d, _)) if *d == q => {}
            _ => s.due = Some((q, Instant::now() + SEARCH_DELAY)),
        }
        let ready = s.due.as_ref().is_some_and(|(_, at)| Instant::now() >= *at);
        if !ready || s.running.is_some() {
            return;
        }
        let Some((q, _)) = s.due.take() else { return };
        s.running = Some((q.clone(), Instant::now()));
        self.send(MachineId::LOCAL, ClientMsg::Query(Query::PaneSearch { query: q }));
    }

    /// The daemon's answer to the search in flight.
    pub(in crate::client) fn pane_search_arrived(&mut self, hits: Vec<SearchHit>) {
        if let Some((q, _)) = self.pane_search.running.take() {
            self.pane_search.answer = Some((q, hits));
        }
    }

    /// This computer's daemon refused something: if it was the search, the next one may go.
    pub(in crate::client) fn pane_search_failed(&mut self) {
        self.pane_search.running = None;
    }

    /// Whether a search for `query` is typed and not answered yet.
    fn pane_search_waiting(&self, query: &str) -> bool {
        searched(query).is_some_and(|q| {
            self.pane_search.answer.as_ref().is_none_or(|(a, _)| *a != q)
        })
    }

    /// What the sessions printed that matches `query`, as rows; empty until the daemon has
    /// answered for this exact query. Only lines of sessions this window shows are kept.
    pub(in crate::client) fn output_hits(&self, query: &str) -> Vec<OutputHit> {
        let Some(q) = searched(query) else {
            return Vec::new();
        };
        let Some((_, hits)) = self.pane_search.answer.as_ref().filter(|(a, _)| *a == q) else {
            return Vec::new();
        };
        let model = self.screen_model();
        hits.iter()
            .filter_map(|h| {
                let term = ClientTerm::on(MachineId::LOCAL, h.term);
                let (_, _, s) = find(&model, term)?;
                let exit = self.term_info(term).is_some_and(|i| i.exit.is_some());
                let failed = status_mark::failed(exit, s.status, s.check.as_ref());
                Some(OutputHit {
                    term,
                    state: status_mark::State::of(s.status, failed, s.down),
                    name: s.name.clone(),
                    snippet: snippet(&h.text, &q),
                })
            })
            .collect()
    }

    /// Search commands' IN SESSIONS rows: the newest matching line of each session, at most
    /// `OUTPUT_HIT_LIMIT`.
    pub(in crate::client) fn palette_output_hits(&self, query: &str) -> Vec<OutputHit> {
        let mut seen = HashSet::new();
        self.output_hits(query)
            .into_iter()
            .filter(|h| seen.insert(h.term))
            .take(OUTPUT_HIT_LIMIT)
            .collect()
    }

    pub(in crate::client) fn open_session_find(&mut self) {
        self.mode = Mode::FindSessions(Box::default());
    }

    /// Go to the session that printed the line, and find `query` in its history there: copy
    /// mode, at the newest match, `n` and `N` for the others.
    pub(in crate::client) fn open_output_hit(&mut self, term: ClientTerm, query: &str) {
        self.screen_focus(term);
        let q = query.trim().to_string();
        if self.enter_copy(term)
            && let Mode::Copy(c) = &mut self.mode
        {
            let last = c.lines.len().saturating_sub(1);
            let end = c.lines.get(last).map_or(0, |l| l.chars().count());
            c.cur = (last, end);
            c.query = Some(q);
            c.backward = true;
            c.search_next();
        }
    }

    pub(in crate::client) fn on_session_find_key(&mut self, mut v: SessionFind, k: &KeyEvent) {
        let ctrl = k.modifiers.contains(KeyModifiers::CONTROL);
        let n = self.output_hits(&v.query).len();
        match k.code {
            KeyCode::Esc => {
                self.mode = Mode::Normal;
                return;
            }
            KeyCode::Down => v.sel = (v.sel + 1).min(n.saturating_sub(1)),
            KeyCode::Up => v.sel = v.sel.saturating_sub(1),
            KeyCode::PageDown => v.sel = (v.sel + 10).min(n.saturating_sub(1)),
            KeyCode::PageUp => v.sel = v.sel.saturating_sub(10),
            KeyCode::Enter => {
                if let Some(h) = self.output_hits(&v.query).get(v.sel) {
                    let term = h.term;
                    return self.open_output_hit(term, &v.query);
                }
            }
            KeyCode::Backspace => {
                v.query.pop();
                v.sel = 0;
            }
            KeyCode::Char('u') if ctrl => {
                v.query.clear();
                v.sel = 0;
            }
            KeyCode::Char(c)
                if !ctrl
                    && !k.modifiers.contains(KeyModifiers::ALT)
                    && v.query.chars().count() < QUERY_MAX =>
            {
                v.query.push(c);
                v.sel = 0;
            }
            _ => {}
        }
        self.mode = Mode::FindSessions(Box::new(v));
    }

    /// A click on a row: choose it, and open it when it was already chosen or double-clicked.
    pub(in crate::client) fn session_find_click(&mut self, i: usize, double: bool) {
        let Mode::FindSessions(v) = &mut self.mode else {
            return;
        };
        let again = v.sel == i;
        v.sel = i;
        if again || double {
            let v = (**v).clone();
            self.on_session_find_key(v, &KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        }
    }

    /// Typed or pasted text for the view's box.
    pub(in crate::client) fn session_find_paste(v: &mut SessionFind, text: &str) {
        let line = text.lines().next().unwrap_or("");
        let room = QUERY_MAX.saturating_sub(v.query.chars().count());
        v.query.extend(line.chars().filter(|c| !c.is_control()).take(room));
        v.sel = 0;
    }
}

/// The view: the box, then each line found with its session, newest first within a session.
pub(in crate::client) fn draw_session_find(
    app: &mut App,
    buf: &mut Buffer,
    area: Rect,
    t: &Theme,
    v: &SessionFind,
) {
    dim_all(app, buf, area, t);
    let w = VIEW_MAX_W.min(area.width.saturating_sub(4));
    let h = VIEW_MAX_H.min(area.height.saturating_sub(2));
    let elsewhere = !app.remotes.is_empty();
    let title = if elsewhere {
        "Find in this computer's sessions"
    } else {
        "Find in every session"
    };
    let r = panel(app, buf, area, w, h, title, &[], t);
    if r.width < 20 || r.height < 8 {
        return;
    }
    let c = Style::default().bg(t.card);
    let qrow = Rect { x: r.x + 1, y: r.y + 2, width: r.width - 2, height: 1 };
    strip(buf, qrow, t.card2);
    let s = Style::default().bg(t.card2);
    let mut q = vec![
        seg("› ", s.fg(t.accent).add_modifier(Modifier::BOLD)),
        seg(v.query.clone(), s.fg(t.strong)),
        seg("█", s.fg(t.accent)),
    ];
    if v.query.is_empty() {
        q.push(seg(" type what a session printed (3+ characters)", s.fg(t.muted)));
    }
    put(buf, r.x + 3, qrow.y, &q, r.right().saturating_sub(2));
    let list = Rect {
        x: r.x + 1,
        y: r.y + 4,
        width: r.width.saturating_sub(2),
        height: r.height.saturating_sub(7),
    };
    let rows = app.output_hits(&v.query);
    let note = if searched(&v.query).is_none() {
        Some(format!("Type at least {OUTPUT_MIN_CHARS} characters."))
    } else if app.pane_search_waiting(&v.query) {
        Some("searching…".to_string())
    } else if rows.is_empty() {
        Some(if elsewhere {
            "No session on this computer printed that recently.".to_string()
        } else {
            "No session printed that recently.".to_string()
        })
    } else {
        None
    };
    if let Some(msg) = note {
        put(
            buf,
            list.x + 2,
            list.y,
            &[seg(msg, c.fg(t.muted).add_modifier(Modifier::ITALIC))],
            list.right(),
        );
    }
    let sel = v.sel.min(rows.len().saturating_sub(1));
    let start = sel.saturating_sub(usize::from(list.height).saturating_sub(1));
    for (i, row) in rows.iter().enumerate().skip(start).take(usize::from(list.height)) {
        let y = list.y + (i - start) as u16;
        let rr = Rect { y, height: 1, ..list };
        let on = i == sel || hovered(app, rr);
        let bg = if on { t.sel_on(t.card) } else { t.card };
        fill(buf, rr, bg);
        let st = Style::default().bg(bg);
        if i == sel {
            put(buf, rr.x, y, &[seg("▌", st.fg(t.accent).add_modifier(Modifier::BOLD))], rr.x + 1);
        }
        let mark = app.state_mark(row.state, t);
        put(buf, rr.x + 2, y, &[seg(mark.glyph, st.fg(mark.color))], rr.x + 4);
        let name = truncate(&row.name, NAME_CELLS);
        put(buf, rr.x + 4, y, &[seg(name, st.fg(t.strong).add_modifier(Modifier::BOLD))], rr.x + 4 + NAME_CELLS as u16);
        let text = lit_matches(
            &row.snippet,
            &v.query,
            st.fg(t.text),
            st.fg(t.accent).add_modifier(Modifier::BOLD),
        );
        put(buf, rr.x + 6 + NAME_CELLS as u16, y, &text, rr.right().saturating_sub(1));
        hit(app, rr, ScreenHit::SessionFindRow(i));
    }
    panel_bar(
        buf,
        r,
        t,
        &[("↑↓", "move"), ("Enter", "go to the line"), ("Esc", "close")],
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::ids::Outgoing;
    use crate::client::reference_fixture::{Layout, Stage, raw_text, world};
    use crate::protocol::{Reply, ServerMsg};
    use tokio::sync::mpsc;

    fn app_with_outbox() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
        let mut app = world(Stage::None);
        let (tx, rx) = mpsc::unbounded_channel();
        app.out = tx;
        (app, rx)
    }

    /// The searches sent, in order.
    fn searches(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<String> {
        std::iter::from_fn(|| rx.try_recv().ok())
            .filter_map(|o| match o.msg {
                ClientMsg::Query(Query::PaneSearch { query }) => {
                    assert_eq!(o.machine, MachineId::LOCAL, "this computer's daemon is asked");
                    Some(query)
                }
                _ => None,
            })
            .collect()
    }

    fn press(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn type_text(app: &mut App, text: &str) {
        for c in text.chars() {
            press(app, KeyCode::Char(c));
        }
    }

    /// The pause in typing is over.
    fn pause(app: &mut App) {
        app.pane_search_tick();
        if let Some((_, at)) = &mut app.pane_search.due {
            *at = Instant::now();
        }
        app.pane_search_tick();
    }

    fn answer(app: &mut App, hits: Vec<SearchHit>) {
        app.on_machine_server(MachineId::LOCAL, ServerMsg::Reply(Reply::Search(hits)));
    }

    /// A session the reference world shows, and its name there.
    fn a_session(app: &App) -> (ClientTerm, String) {
        let term = app.selected_term().expect("a focused session");
        (term, app.session_name(term))
    }

    fn frame(app: &mut App, title: &str) -> String {
        let text = raw_text(app, Layout::Floating, 120, 30, "unicode");
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("---- {title}\n{text}");
        }
        text
    }

    #[test]
    fn a_search_waits_for_a_pause_and_only_one_runs_at_a_time() {
        let (mut app, mut rx) = app_with_outbox();
        app.act(Action::FindSessions);
        assert!(matches!(app.mode, Mode::FindSessions(_)));
        type_text(&mut app, "er");
        pause(&mut app);
        assert!(searches(&mut rx).is_empty(), "two characters search nothing");
        type_text(&mut app, "ror");
        app.pane_search_tick();
        assert!(searches(&mut rx).is_empty(), "nothing goes before the pause");
        pause(&mut app);
        assert_eq!(searches(&mut rx), ["error"]);
        // Typing on while it runs: the newest is sent once the answer is in, not before.
        type_text(&mut app, "s");
        pause(&mut app);
        assert!(searches(&mut rx).is_empty(), "one search at a time");
        answer(&mut app, Vec::new());
        pause(&mut app);
        assert_eq!(searches(&mut rx), ["errors"]);
        answer(&mut app, Vec::new());
        pause(&mut app);
        assert!(searches(&mut rx).is_empty(), "an answered search is not asked again");
    }

    #[test]
    fn the_lines_found_are_listed_with_their_session_and_enter_goes_to_the_line() {
        let (mut app, mut rx) = app_with_outbox();
        let (term, name) = a_session(&app);
        app.act(Action::FindSessions);
        let empty = frame(&mut app, "find in every session, nothing typed");
        assert!(empty.contains("Find in every session") && empty.contains("Type at least 3"), "{empty}");
        type_text(&mut app, "panic");
        pause(&mut app);
        assert_eq!(searches(&mut rx), ["panic"]);
        let waiting = frame(&mut app, "searching");
        assert!(waiting.contains("searching…"), "{waiting}");
        let hits = vec![
            SearchHit { term: term.term, line: 40, text: "thread 'main' panicked at src/lib.rs:3".into() },
            // A pane this window does not show is left out.
            SearchHit { term: 9_999, line: 2, text: "panic elsewhere".into() },
        ];
        answer(&mut app, hits);
        let listed = frame(&mut app, "one line found");
        assert!(listed.contains(&truncate(&name, NAME_CELLS)) && listed.contains("panicked at src/lib.rs"), "{listed}");
        assert!(!listed.contains("panic elsewhere"), "{listed}");
        press(&mut app, KeyCode::Enter);
        match &app.mode {
            Mode::Copy(c) => {
                assert_eq!(c.term, term);
                assert_eq!(c.query.as_deref(), Some("panic"), "the pane opens on the search");
            }
            other => panic!("not at the line: {other:?}"),
        }
    }

    #[test]
    fn nothing_found_says_so_and_esc_closes() {
        let (mut app, _rx) = app_with_outbox();
        app.act(Action::FindSessions);
        type_text(&mut app, "nowhere");
        pause(&mut app);
        answer(&mut app, Vec::new());
        let text = frame(&mut app, "nothing found");
        assert!(text.contains("No session printed that recently."), "{text}");
        press(&mut app, KeyCode::Esc);
        assert_eq!(app.mode, Mode::Normal);
    }

    #[test]
    fn search_commands_lists_what_sessions_printed_one_row_per_session() {
        let (mut app, mut rx) = app_with_outbox();
        let (term, name) = a_session(&app);
        app.act(Action::Palette);
        type_text(&mut app, "migrate");
        pause(&mut app);
        assert_eq!(searches(&mut rx), ["migrate"]);
        answer(
            &mut app,
            vec![
                SearchHit { term: term.term, line: 9, text: "running migrate step 2".into() },
                SearchHit { term: term.term, line: 3, text: "running migrate step 1".into() },
            ],
        );
        let text = frame(&mut app, "search with what chats printed");
        assert!(text.contains("In chats") && text.contains("running migrate step 2"), "{text}");
        assert!(!text.contains("step 1"), "the newest line of each session only: {text}");
        assert!(text.contains(&name), "{text}");
        let Mode::KeyMap(km) = &app.mode else { panic!("search closed") };
        let km = (**km).clone();
        let rows = app.keymap_rows(&km);
        app.keymap_run(&km, rows - 1);
        assert!(matches!(&app.mode, Mode::Copy(c) if c.term == term && c.query.as_deref() == Some("migrate")));
    }

    #[test]
    fn a_snippet_keeps_the_match_in_view_and_says_where_it_was_cut() {
        let long = format!("{} error: the build failed {}", "x".repeat(80), "y".repeat(80));
        let s = snippet(&long, "error");
        assert!(s.starts_with('…'), "cut before: {s}");
        assert!(s.ends_with('…'), "cut after: {s}");
        assert!(s.contains("error: the build failed"), "{s}");
        assert!(unicode_width::UnicodeWidthStr::width(s.as_str()) <= SNIPPET_CELLS);
        assert_eq!(snippet("  short   line ", "line"), "short line");
    }

    #[test]
    fn a_snippet_drops_what_could_make_the_line_read_as_something_else() {
        let s = snippet("ok\u{202e}evil\u{7}\tdone", "done");
        assert!(!s.contains('\u{202e}') && !s.contains('\u{7}'), "{s:?}");
        assert!(s.contains("done"));
    }

    #[test]
    fn every_match_is_lit_whatever_its_case() {
        let plain = Style::default();
        let lit = Style::default().add_modifier(Modifier::BOLD);
        let segs = lit_matches("Error then error", "error", plain, lit);
        let lit_runs: Vec<&str> = segs.iter().filter(|(_, s)| *s == lit).map(|(t, _)| t.as_str()).collect();
        assert_eq!(lit_runs, ["Error", "error"]);
    }
}
