//! The Work board (ADR 0010): the workflow runs of one session as columns, one per step name the
//! runs reported, each run in the step it sits in, then "Needs human" and "Done". Display only, like
//! the sidebar's run lines: nothing here starts, stops or changes a run. Enter opens a run's steps.

use super::*;
use super::side::put_cut;
use super::workflow_runs::{run_active, run_key, run_label, step_mark};
use crate::workflow::{StepState, WorkflowRun, WorkflowStep};

/// The column every run needing you sits in, as the desktop's board names it.
pub(in crate::client) const NEEDS_COLUMN: &str = "Needs human";
/// The column every finished run sits in.
pub(in crate::client) const DONE_COLUMN: &str = "Done";
/// Steps in hand at once from which a card names them instead of showing one step's note.
const SEVERAL: usize = 2;
/// The narrowest a column is drawn beside the others; narrower, the columns stack.
const COLUMN_MIN: u16 = 18;
/// The widest the board grows.
const BOARD_W: u16 = 160;

/// What a column holds: the runs in one reported step, every run that needs you, or every run done.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::client) enum BoardColumnKind {
    Step,
    Needs,
    Done,
}

/// A run on the board: its place among the session's runs and the step it sits in.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::client) struct BoardCard {
    pub run: usize,
    pub step: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct BoardColumn {
    pub kind: BoardColumnKind,
    pub name: String,
    pub cards: Vec<BoardCard>,
}

/// A run as a whole: what its card's mark and the run's word say.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::client) enum RunState {
    Needs,
    Working,
    Waiting,
    Done,
    Failed,
}

impl RunState {
    pub(in crate::client) fn word(self) -> &'static str {
        match self {
            RunState::Needs => "needs you",
            RunState::Working => "working",
            RunState::Waiting => "waiting",
            RunState::Done => "done",
            RunState::Failed => "failed",
        }
    }

    /// The step state whose mark stands for the run as a whole.
    fn mark_state(self) -> StepState {
        match self {
            RunState::Needs => StepState::NeedsYou,
            RunState::Working => StepState::Working,
            RunState::Waiting => StepState::Waiting,
            RunState::Done => StepState::Passed,
            RunState::Failed => StepState::Failed,
        }
    }
}

/// A step's word, lower case as the board and a run's steps show it.
pub(in crate::client) fn step_word(state: StepState) -> &'static str {
    match state {
        StepState::Waiting => "waiting",
        StepState::Working => "working",
        StepState::Passed => "passed",
        StepState::Failed => "failed",
        StepState::SentBack => "sent back",
        StepState::NeedsYou => "needs you",
        StepState::Skipped => "skipped",
        StepState::Unknown => "unknown",
    }
}

/// A step the run has moved past: it sits further on.
fn passed_by(state: StepState) -> bool {
    matches!(state, StepState::Passed | StepState::Skipped)
}

fn needs_you(run: &WorkflowRun) -> bool {
    run.steps.iter().any(|s| s.state == StepState::NeedsYou)
}

/// The step names of every run, in the order the runs give them. A name one run has and another
/// lacks goes in after the step before it, so two workflows with different steps still read in order.
pub(in crate::client) fn column_names(runs: &[WorkflowRun]) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for run in runs {
        let mut previous: Option<usize> = None;
        for step in &run.steps {
            let at = match names.iter().position(|n| *n == step.name) {
                Some(at) => at,
                None => {
                    let at = previous.map_or(0, |p| p + 1);
                    names.insert(at, step.name.clone());
                    at
                }
            };
            previous = Some(at);
        }
    }
    names
}

/// The step a run sits in: its first that has not passed, else its last (a run that finished).
pub(in crate::client) fn sitting_step(run: &WorkflowRun) -> Option<usize> {
    run.steps
        .iter()
        .position(|s| !passed_by(s.state))
        .or_else(|| run.steps.len().checked_sub(1))
}

/// A run as a whole, from its steps: what needs you first, then what is in hand, then how it ended.
pub(in crate::client) fn run_state(run: &WorkflowRun) -> RunState {
    if run_active(run) {
        if needs_you(run) {
            return RunState::Needs;
        }
        let busy = run
            .steps
            .iter()
            .any(|s| matches!(s.state, StepState::Working | StepState::SentBack));
        return if busy { RunState::Working } else { RunState::Waiting };
    }
    if run.steps.iter().any(|s| s.state == StepState::Failed) {
        RunState::Failed
    } else {
        RunState::Done
    }
}

fn titled(name: &str) -> String {
    let mut chars = name.chars();
    chars
        .next()
        .map_or_else(String::new, |c| c.to_uppercase().chain(chars).collect())
}

/// The board of `runs`: a column per reported step name, each run going in the step it sits in,
/// then the runs that need you and the runs that finished. The step columns are named by every run,
/// finished ones too, so a run finishing never reorders the board. A run with no steps is not placed.
pub(in crate::client) fn work_board(runs: &[WorkflowRun]) -> Vec<BoardColumn> {
    let names = column_names(runs);
    let mut columns: Vec<BoardColumn> = names
        .iter()
        .map(|n| BoardColumn { kind: BoardColumnKind::Step, name: titled(n), cards: Vec::new() })
        .collect();
    let mut needs = BoardColumn { kind: BoardColumnKind::Needs, name: NEEDS_COLUMN.into(), cards: Vec::new() };
    let mut done = BoardColumn { kind: BoardColumnKind::Done, name: DONE_COLUMN.into(), cards: Vec::new() };
    for (i, run) in runs.iter().enumerate() {
        let Some(step) = sitting_step(run) else {
            continue;
        };
        if !run_active(run) {
            done.cards.push(BoardCard { run: i, step });
        } else if needs_you(run) {
            let asking = run.steps.iter().position(|s| s.state == StepState::NeedsYou).unwrap_or(step);
            needs.cards.push(BoardCard { run: i, step: asking });
        } else if let Some(col) = names.iter().position(|n| *n == run.steps[step].name) {
            columns[col].cards.push(BoardCard { run: i, step });
        }
    }
    columns.push(needs);
    columns.push(done);
    columns
}

/// The cards in the order the arrows walk them: column by column.
pub(in crate::client) fn board_cards(columns: &[BoardColumn]) -> Vec<BoardCard> {
    columns.iter().flat_map(|c| c.cards.iter().copied()).collect()
}

/// The line under the board's title: what needs you, what is in hand and what finished.
pub(in crate::client) fn board_summary(runs: &[WorkflowRun]) -> String {
    let active = runs.iter().filter(|r| run_active(r));
    let needs = active.clone().filter(|r| needs_you(r)).count();
    let working = active.filter(|r| !needs_you(r)).count();
    let done = runs.iter().filter(|r| !run_active(r) && !r.steps.is_empty()).count();
    let parts: Vec<String> = [(needs, "needs you"), (working, "working"), (done, "done")]
        .into_iter()
        .filter(|(n, _)| *n > 0)
        .map(|(n, w)| format!("{n} {w}"))
        .collect();
    if parts.is_empty() { "Nothing running".into() } else { parts.join(" · ") }
}

fn is_review(step: &WorkflowStep) -> bool {
    let name = step.name.to_lowercase();
    name == "review" || name.starts_with("review ")
}

/// A review step's name on its chip: without the "review" every one of them starts with.
pub(in crate::client) fn review_short(name: &str) -> &str {
    let rest = name.get(6..).filter(|_| name.len() > 7 && name[..6].eq_ignore_ascii_case("review")).map(str::trim_start);
    rest.filter(|r| !r.is_empty()).unwrap_or(name)
}

/// The review steps a card shows as chips: only once the run is past its first step, since before
/// the work is built there is nothing to review yet.
pub(in crate::client) fn review_track(run: &WorkflowRun) -> Vec<&WorkflowStep> {
    match run.steps.first() {
        Some(first) if passed_by(first.state) => run.steps.iter().filter(|s| is_review(s)).collect(),
        _ => Vec::new(),
    }
}

/// A card's line under its title: the note of the step it sits in, else, when several steps are in
/// hand at once, which ones ("review code and review security are working.").
pub(in crate::client) fn card_note(run: &WorkflowRun, step: usize) -> Option<String> {
    if let Some(note) = run.steps.get(step).and_then(|s| s.note.clone()) {
        return Some(note);
    }
    let working: Vec<&str> = run
        .steps
        .iter()
        .filter(|s| s.state == StepState::Working)
        .map(|s| s.name.as_str())
        .collect();
    let (last, rest) = working.split_last()?;
    (working.len() >= SEVERAL).then(|| format!("{} and {last} are working.", rest.join(", ")))
}

fn runs_of(app: &App, term: ClientTerm) -> Vec<WorkflowRun> {
    app.term_info(term).map(|i| i.workflows.clone()).unwrap_or_default()
}

/// The lines of one card beside the others: its head, title, reviews and note.
fn card_lines(app: &App, run: &WorkflowRun, step: usize, t: &Theme, ground: Style) -> Vec<Vec<Seg>> {
    let state = run_state(run);
    let (glyph, color) = step_mark(app, state.mark_state(), t);
    let mut head = vec![seg(glyph, ground.fg(color)), seg(" ", ground), seg(run_label(run), ground.fg(t.strong).bold())];
    if matches!(state, RunState::Done | RunState::Failed) {
        let tone = if state == RunState::Failed { t.err } else { t.muted };
        head.extend([seg("  ", ground), seg(state.word(), ground.fg(tone))]);
    }
    let title = run.ticket.as_ref().and_then(|tk| tk.title.clone());
    let mut lines = vec![
        head,
        vec![match title {
            Some(title) => seg(title, ground.fg(t.text)),
            None => seg("No ticket", ground.fg(t.muted)),
        }],
    ];
    let reviews = review_track(run);
    if !reviews.is_empty() {
        let mut chips = Vec::new();
        for r in reviews {
            let (g, c) = step_mark(app, r.state, t);
            chips.extend([seg(review_short(&r.name).to_string(), ground.fg(t.text)), seg(" ", ground), seg(g, ground.fg(c)), seg("  ", ground)]);
        }
        lines.push(chips);
    }
    if let Some(note) = card_note(run, step) {
        lines.push(vec![seg(note, ground.fg(t.muted))]);
    }
    lines
}

/// One line of a card when the columns stack: its mark, key, title and note.
fn card_line(app: &App, run: &WorkflowRun, step: usize, t: &Theme, ground: Style) -> Vec<Seg> {
    let state = run_state(run);
    let (glyph, color) = step_mark(app, state.mark_state(), t);
    let mut segs = vec![seg(glyph, ground.fg(color)), seg(" ", ground), seg(run_label(run), ground.fg(t.strong).bold())];
    if let Some(title) = run.ticket.as_ref().and_then(|tk| tk.title.clone()) {
        segs.extend([seg("  ", ground), seg(title, ground.fg(t.text))]);
    }
    if matches!(state, RunState::Done | RunState::Failed) {
        let tone = if state == RunState::Failed { t.err } else { t.muted };
        segs.extend([seg("  ", ground), seg(state.word(), ground.fg(tone))]);
    } else if let Some(note) = card_note(run, step) {
        segs.extend([seg(" · ", ground.fg(t.muted)), seg(note, ground.fg(t.muted))]);
    }
    segs
}

/// The board of `term`'s runs in a modal; `sel` is the chosen card in `board_cards` order.
pub(in crate::client) fn draw_board(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, term: ClientTerm, sel: usize) {
    let runs = runs_of(app, term);
    let name = app.session_name(term);
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let w = area.width.saturating_sub(4).min(BOARD_W);
    let h = area.height.saturating_sub(2);
    let right = [seg(format!(" {} ", board_summary(&runs)), Style::default().fg(t.muted))];
    let r = panel(app, buf, area, w, h, &format!("work · {name}"), &right, t);
    let ground = Style::default().bg(t.card);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    let top = r.y + 2;
    let bottom = r.bottom().saturating_sub(3);
    panel_bar(buf, r, t, &[("↑↓←→", "move"), ("Enter", "open run"), ("Esc", "close")]);
    if runs.iter().all(|run| run.steps.is_empty()) {
        put(buf, x, top, &[seg("No runs reported in this session.", ground.fg(t.text))], end);
        put(buf, x, top + 1, &[seg(concat!("A workflow reports its steps with `", env!("APP_COMMAND"), " workflow report`."), ground.fg(t.muted))], end);
        return;
    }
    let columns = work_board(&runs);
    let cards = board_cards(&columns);
    let sel = sel.min(cards.len().saturating_sub(1));
    let chosen = cards.get(sel).copied();
    let n = columns.len() as u16;
    let room = end.saturating_sub(x);
    let gap = 2;
    let col_w = room.saturating_sub(gap * n.saturating_sub(1)) / n.max(1);
    let mut card_i = 0;
    if col_w >= COLUMN_MIN {
        for (ci, col) in columns.iter().enumerate() {
            let cx = x + ci as u16 * (col_w + gap);
            let cend = cx + col_w;
            let head_style = if col.kind == BoardColumnKind::Step { ground.fg(t.strong).bold() } else { ground.fg(t.text).bold() };
            put_cut(buf, cx, top, vec![seg(col.name.clone(), head_style), seg(format!("  {}", col.cards.len()), ground.fg(t.muted))], cend);
            put(buf, cx, top + 1, &[seg("─".repeat(col_w as usize), ground.fg(t.line))], cend);
            if col.cards.is_empty() {
                put(buf, cx, top + 2, &[seg("Nothing here", ground.fg(t.muted))], cend);
            }
            // Keep the chosen card in view: the column scrolls by whole cards.
            let heights: Vec<u16> = col.cards.iter().map(|c| card_lines(app, &runs[c.run], c.step, t, ground).len() as u16 + 1).collect();
            let picked = col.cards.iter().position(|c| Some(*c) == chosen);
            let room_h = bottom.saturating_sub(top + 2);
            let mut skip = 0;
            if let Some(p) = picked {
                while heights[skip..=p].iter().sum::<u16>() > room_h && skip < p {
                    skip += 1;
                }
            }
            let mut y = top + 2;
            for (k, card) in col.cards.iter().enumerate() {
                let index = card_i + k;
                if k < skip {
                    continue;
                }
                let lines = card_lines(app, &runs[card.run], card.step, t, ground);
                if y + lines.len() as u16 > bottom {
                    break;
                }
                let on = index == sel;
                let rect = Rect { x: cx, y, width: col_w, height: lines.len() as u16 };
                let bg = if on { t.sel_on(t.card) } else { t.card };
                fill(buf, rect, bg);
                let st = Style::default().bg(bg);
                for (l, segs) in lines.into_iter().enumerate() {
                    let segs = segs.into_iter().map(|(s, style)| (s, style.bg(bg))).collect();
                    put_cut(buf, cx + 1, y + l as u16, segs, cend);
                }
                if on {
                    for l in 0..rect.height {
                        put(buf, cx, y + l, &[seg("▎", st.fg(t.accent))], cend);
                    }
                }
                hit(app, rect, ScreenHit::BoardCard(index));
                y += rect.height + 1;
            }
            card_i += col.cards.len();
        }
        return;
    }
    // Too narrow for the columns side by side: each under its heading, a card a line.
    let mut lines: Vec<(Vec<Seg>, Option<usize>)> = Vec::new();
    for col in &columns {
        let mut head = vec![seg(col.name.to_uppercase(), ground.fg(t.muted).bold()), seg(format!("  {}", col.cards.len()), ground.fg(t.muted))];
        if col.cards.is_empty() {
            head.push(seg("  nothing here", ground.fg(t.faint())));
        }
        lines.push((head, None));
        for card in &col.cards {
            lines.push((card_line(app, &runs[card.run], card.step, t, ground), Some(card_i)));
            card_i += 1;
        }
    }
    let room_h = bottom.saturating_sub(top) as usize;
    let at = lines.iter().position(|(_, c)| *c == Some(sel)).unwrap_or(0);
    let start = (at + 1).saturating_sub(room_h);
    for (k, (segs, card)) in lines.into_iter().skip(start).take(room_h).enumerate() {
        let y = top + k as u16;
        let on = card == Some(sel);
        let bg = if on { t.sel_on(t.card) } else { t.card };
        let row = Rect { x: x.saturating_sub(1), y, width: end.saturating_sub(x) + 1, height: 1 };
        if card.is_some() {
            fill(buf, row, bg);
        }
        let segs: Vec<Seg> = segs.into_iter().map(|(s, style)| (s, style.bg(bg))).collect();
        let indent = if card.is_some() { 2 } else { 0 };
        put_cut(buf, x + indent, y, segs, end);
        if on {
            put(buf, row.x, y, &[seg("▎", Style::default().bg(bg).fg(t.accent))], end);
        }
        if let Some(i) = card {
            hit(app, row, ScreenHit::BoardCard(i));
        }
    }
}

impl App {
    /// The board of the session you're on.
    pub(in crate::client) fn open_work_board(&mut self) {
        let Some(term) = self.selected_term() else {
            return self.notify("no session to show the work of".into(), false);
        };
        self.open_board_of(term);
    }

    pub(in crate::client) fn open_board_of(&mut self, term: ClientTerm) {
        // The first card that needs you, else the first card.
        let runs = runs_of(self, term);
        let cards = board_cards(&work_board(&runs));
        let sel = cards.iter().position(|c| run_state(&runs[c.run]) == RunState::Needs).unwrap_or(0);
        self.mode = Mode::Work { term, sel };
    }

    /// A run's steps, opened from the board: Esc goes back to it on the same card.
    pub(in crate::client) fn open_board_card(&mut self, term: ClientTerm, sel: usize) {
        let runs = runs_of(self, term);
        if let Some(card) = board_cards(&work_board(&runs)).get(sel) {
            self.mode = Mode::Run { term, key: run_key(&runs[card.run]), board: Some(sel) };
        }
    }

    pub(in crate::client) fn on_board_key(&mut self, term: ClientTerm, sel: usize, k: &KeyEvent) {
        let runs = runs_of(self, term);
        let columns = work_board(&runs);
        let count = board_cards(&columns).len();
        // Where each column's cards start in the walk, for ← and →.
        let starts: Vec<usize> = columns
            .iter()
            .scan(0, |at, c| {
                let start = *at;
                *at += c.cards.len();
                Some((start, c.cards.len()))
            })
            .filter(|(_, n)| *n > 0)
            .map(|(s, _)| s)
            .collect();
        let here = starts.iter().rposition(|s| *s <= sel).unwrap_or(0);
        let sel = match k.code {
            KeyCode::Esc | KeyCode::Char('q') => {
                self.mode = Mode::Normal;
                return;
            }
            KeyCode::Enter => return self.open_board_card(term, sel),
            KeyCode::Down | KeyCode::Char('j') => (sel + 1).min(count.saturating_sub(1)),
            KeyCode::Up | KeyCode::Char('k') => sel.saturating_sub(1),
            KeyCode::Right | KeyCode::Char('l') => starts.get(here + 1).copied().unwrap_or(sel),
            KeyCode::Left | KeyCode::Char('h') => {
                if starts.get(here).is_some_and(|s| *s < sel) {
                    starts[here]
                } else {
                    here.checked_sub(1).and_then(|p| starts.get(p).copied()).unwrap_or(sel)
                }
            }
            _ => sel,
        };
        self.mode = Mode::Work { term, sel };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::{StepState::*, WorkflowTicket};

    fn run(id: &str, steps: &[(&str, StepState)], key: Option<&str>) -> WorkflowRun {
        WorkflowRun {
            workflow: "factory".into(),
            run: id.into(),
            ticket: key.map(|key| WorkflowTicket { key: key.into(), title: None, link: None }),
            steps: steps
                .iter()
                .map(|(name, state)| WorkflowStep { name: (*name).into(), state: *state, note: None, helper: None })
                .collect(),
            reported_at: 1,
        }
    }

    fn names(columns: &[BoardColumn], runs: &[WorkflowRun]) -> Vec<(String, Vec<String>)> {
        columns
            .iter()
            .map(|c| (c.name.clone(), c.cards.iter().map(|k| run_label(&runs[k.run])).collect()))
            .collect()
    }

    #[test]
    fn a_column_per_reported_step_in_the_order_the_runs_give_them() {
        let a = run("1", &[("intake", Passed), ("build", Working), ("review", Waiting)], None);
        let b = run("2", &[("intake", Passed), ("spec", Working), ("build", Waiting), ("ship", Waiting)], None);
        assert_eq!(column_names(&[a, b]), ["intake", "spec", "build", "ship", "review"]);
    }

    #[test]
    fn a_run_sits_in_its_first_step_not_passed() {
        let on = |steps: &[(&str, StepState)]| {
            let r = run("1", steps, None);
            sitting_step(&r).map(|i| r.steps[i].name.clone())
        };
        assert_eq!(on(&[("intake", Passed), ("spec", Skipped), ("build", SentBack), ("review", Failed)]).as_deref(), Some("build"));
        assert_eq!(on(&[("intake", NeedsYou), ("build", Waiting)]).as_deref(), Some("intake"));
        assert_eq!(on(&[("intake", Passed), ("build", Failed)]).as_deref(), Some("build"));
        assert_eq!(on(&[]), None);
    }

    #[test]
    fn runs_going_sit_in_their_step_asking_in_needs_human_and_finished_in_done() {
        let runs = [
            run("1", &[("intake", Passed), ("build", Working), ("review", Waiting)], Some("MAITTY-42")),
            run("2", &[("intake", NeedsYou), ("build", Waiting)], Some("MAITTY-43")),
            run("3", &[("intake", Passed), ("build", Passed), ("review", Passed)], Some("MAITTY-40")),
            run("4", &[("intake", Passed), ("build", Failed)], Some("MAITTY-41")),
        ];
        let board = work_board(&runs);
        let want: Vec<(String, Vec<String>)> = [
            ("Intake", vec![]),
            ("Build", vec!["MAITTY-42"]),
            ("Review", vec![]),
            ("Needs human", vec!["MAITTY-43"]),
            ("Done", vec!["MAITTY-40", "MAITTY-41"]),
        ]
        .into_iter()
        .map(|(n, c)| (n.to_string(), c.into_iter().map(String::from).collect()))
        .collect();
        assert_eq!(names(&board, &runs), want);
        assert_eq!(board_summary(&runs), "1 needs you · 1 working · 2 done");
        assert_eq!(board_summary(&[]), "Nothing running");
    }

    #[test]
    fn a_run_reads_as_a_whole() {
        let state = |steps: &[(&str, StepState)]| run_state(&run("1", steps, None));
        assert_eq!(state(&[("build", Working), ("review", NeedsYou)]), RunState::Needs);
        assert_eq!(state(&[("build", SentBack), ("review", Failed)]), RunState::Working);
        assert_eq!(state(&[("build", Waiting)]), RunState::Waiting);
        assert_eq!(state(&[("build", Passed), ("review", Skipped)]), RunState::Done);
        assert_eq!(state(&[("build", Passed), ("review", Failed)]), RunState::Failed);
    }

    #[test]
    fn reviews_show_as_chips_once_the_first_step_passed_and_notes_name_steps_in_hand() {
        let early = run("1", &[("spec", Working), ("build", Waiting), ("review code", Waiting)], None);
        let later = run("2", &[("spec", Passed), ("build", Passed), ("review code", Passed), ("review security", Working)], None);
        assert!(review_track(&early).is_empty());
        let chips: Vec<&str> = review_track(&later).iter().map(|s| review_short(&s.name)).collect();
        assert_eq!(chips, ["code", "security"]);
        assert_eq!(review_short("review"), "review");
        let both = run("3", &[("build", Passed), ("review code", Working), ("review security", Working)], None);
        let step = sitting_step(&both).unwrap();
        assert_eq!(card_note(&both, step).as_deref(), Some("review code and review security are working."));
    }
}
