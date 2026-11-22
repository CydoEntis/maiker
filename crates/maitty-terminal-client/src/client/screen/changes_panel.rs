//! The Changes panel's drawing: the branch and what is to push, the changed files with a box each,
//! the selected file's diff, the commit message and the two actions. Docs: UI.md, "Changes panel".

use super::*;
use crate::client::tasks::{Changed, Review};
use crate::client::views::{ChangesRow, ChangesView, wrap};
use crate::client::{Btn, Hit};
use crossterm::event::{KeyCode, KeyModifiers};

/// Rows the diff keeps when the files list is long: the list gives way first.
const DIFF_ROWS_MIN: u16 = 4;
/// Lines of the message the box shows before it cuts.
const MESSAGE_LINES_MAX: usize = 3;
/// How much of the green or the red a diff line's ground takes.
const DIFF_TINT: f32 = 0.09;
const PICKED: &str = "[x]";
const NOT_PICKED: &str = "[ ]";
/// Columns the box and the checkbox take at the left of a file row.
const BOX_W: u16 = 4;

/// What the commit box holds and says under it.
struct MessageBox {
    text: String,
    caption: String,
    editing: bool,
}

/// `⑂ branch from main · ↑2 to push`: the branch and where it started and stands; `on build`
/// after the branch when the checkout is another machine's.
pub(super) fn branch_line(r: &Review, machine: Option<&str>) -> String {
    let t = &r.task;
    let from = if t.base == t.branch || t.base == "HEAD" { String::new() } else { format!(" from {}", t.base) };
    let push = match r.to_push {
        None => String::new(),
        Some(0) => " · nothing to push".to_string(),
        Some(n) => format!(" · ↑{n} to push"),
    };
    let on = machine.map(|m| format!(" on {m}")).unwrap_or_default();
    format!("⑂ {}{on}{from}{push}", t.branch)
}

/// `2 of 3 in the next commit`, and how many comments wait to go to the agent.
pub(super) fn picked_line(picked: usize, all: usize, comments: usize) -> String {
    let notes = if comments == 0 { String::new() } else { format!(" · ✎ {comments}") };
    format!("{picked} of {all} in the next commit{notes}")
}

/// Who wrote the message, as the line under the box says it.
fn author_caption(agent: &str) -> String {
    let mut name = agent.chars();
    let name: String = name.next().map(|c| c.to_uppercase().chain(name).collect()).unwrap_or_default();
    if name.is_empty() {
        "Message made from the changes. Click it to edit.".into()
    } else {
        format!("Message written by {name}. Click it to edit.")
    }
}

fn status_letter(f: &Changed) -> (&'static str, fn(&Theme) -> Color) {
    match (f.untracked, f.deleted) {
        (_, true) => ("D", |t| t.err),
        (true, _) => ("A", |t| t.done),
        _ => ("M", |t| t.warning),
    }
}

fn commit_box(v: &ChangesView, path: &str, who: &str) -> MessageBox {
    if let Some(comment) = &v.extra.commenting {
        let at = v
            .extra
            .line
            .and_then(|i| v.review.as_ref().and_then(|r| crate::client::changes_more::line_numbers(&r.diff).get(i).copied().flatten()))
            .map_or(String::new(), |(n, _)| format!(", line {n}"));
        return MessageBox { text: comment.clone(), caption: format!("Comment for {who} on {path}{at}. Enter keeps it, Esc leaves it."), editing: true };
    }
    MessageBox { text: v.message_text(), caption: author_caption(&v.agent), editing: v.extra.message.is_some() }
}

/// The lines of the box: the head of the message, or its tail while it is edited so the cursor stays in view.
fn box_lines(text: &str, width: usize, editing: bool) -> Vec<String> {
    let mut lines = wrap(text, width);
    if text.ends_with('\n') {
        lines.push(String::new());
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    if lines.len() > MESSAGE_LINES_MAX {
        if editing {
            lines.drain(..lines.len() - MESSAGE_LINES_MAX);
        } else {
            lines.truncate(MESSAGE_LINES_MAX);
            if let Some(last) = lines.last_mut() {
                last.push('…');
            }
        }
    }
    lines
}

pub(in crate::client) fn draw_changes(app: &mut App, buf: &mut Buffer, area: Rect, t: &Theme, v: &ChangesView) {
    fill(buf, area, t.bg);
    let Some(r) = &v.review else {
        let msg = v.error.clone().unwrap_or_else(|| match &v.extra.remote {
            Some(remote) => format!("reading the changes on {}…", remote.machine),
            None => "reading changes…".into(),
        });
        put(buf, area.x + 1, area.y + 1, &[seg(msg, Style::default().fg(t.muted).bg(t.bg))], area.right());
        return;
    };
    let inner = Rect { x: area.x + 1, width: area.width.saturating_sub(2), ..area };
    let dim = Style::default().fg(t.muted).bg(t.bg);
    put(buf, inner.x, inner.y, &[seg(branch_line(r, v.extra.remote.as_ref().map(|m| m.machine.as_str())), Style::default().fg(t.strong).bg(t.bg))], inner.right());
    if r.files.is_empty() {
        let none = vec![seg("No changes on ", dim), seg(r.task.branch.clone(), Style::default().fg(t.strong).bg(t.bg)), seg(".", dim)];
        put(buf, inner.x, inner.y + 2, &none, inner.right());
        return;
    }
    put(buf, inner.x, inner.y + 1, &[seg(picked_line(v.picked().len(), r.files.len(), v.extra.comments.len()), dim)], inner.right());
    let who = if v.agent.is_empty() { "the agent".to_string() } else { v.agent.clone() };
    let path = r.files.get(r.sel).map(|f| f.path.as_str()).unwrap_or_default();
    let boxed = commit_box(v, path, &who);
    let lines = box_lines(&boxed.text, usize::from(inner.width.saturating_sub(4)), boxed.editing);
    // The rows under the diff: a rule, the box and its borders, the line under it, the actions.
    let foot = 1 + 2 + lines.len() as u16 + 1 + 1;
    let top = inner.y + 2;
    let room = inner.bottom().saturating_sub(top + foot);
    let list = (r.files.len() as u16).min(room.saturating_sub(DIFF_ROWS_MIN + 1).max(1));
    draw_files(app, buf, Rect { y: top, height: list, ..inner }, t, v, r);
    let diff_top = top + list;
    draw_rule(buf, inner, diff_top, t);
    let diff = Rect { y: diff_top + 1, height: room.saturating_sub(list + 1), ..inner };
    draw_diff(buf, diff, t, v, r);
    let foot_top = inner.bottom() - foot;
    draw_rule(buf, inner, foot_top, t);
    draw_box(app, buf, Rect { y: foot_top + 1, height: lines.len() as u16 + 2, ..inner }, t, &boxed, &lines);
    put(buf, inner.x, inner.bottom() - 2, &[seg(boxed.caption, dim)], inner.right());
    draw_actions(app, buf, Rect { y: inner.bottom() - 1, height: 1, ..inner }, t, v, r);
}

fn draw_rule(buf: &mut Buffer, inner: Rect, y: u16, t: &Theme) {
    let line = "─".repeat(usize::from(inner.width));
    put(buf, inner.x, y, &[seg(line, Style::default().fg(t.line).bg(t.bg))], inner.right());
}

/// The files that fit, the chosen one in view; a click chooses, a click on the box picks.
fn draw_files(app: &mut App, buf: &mut Buffer, rect: Rect, t: &Theme, v: &ChangesView, r: &Review) {
    let rows: Vec<(usize, usize)> = v
        .rows()
        .into_iter()
        .enumerate()
        .filter_map(|(i, row)| match row {
            ChangesRow::File(fi, _) => Some((i, fi)),
            _ => None,
        })
        .collect();
    let height = usize::from(rect.height);
    let at = rows.iter().position(|(_, fi)| *fi == r.sel).unwrap_or(0);
    let start = at.saturating_sub(height.saturating_sub(1));
    for (offset, (row, fi)) in rows.iter().skip(start).take(height).enumerate() {
        let f = &r.files[*fi];
        let y = rect.y + offset as u16;
        let line = Rect { y, height: 1, ..rect };
        let on = *fi == r.sel;
        let bg = if on { t.sel_on(t.bg) } else { t.bg };
        if on {
            fill(buf, line, bg);
        }
        let base = Style::default().bg(bg);
        let reviewed = v.reviewed.contains(&f.path);
        let (letter, colour) = status_letter(f);
        let counts = vec![
            seg(format!("+{}", f.added), base.fg(t.done)),
            seg(format!(" −{}", f.removed), base.fg(t.err)),
        ];
        let cw = segs_width(&counts);
        let check = if v.is_picked(&f.path) { PICKED } else { NOT_PICKED };
        put(buf, line.x, y, &[seg(check, base.fg(if v.is_picked(&f.path) { t.accent } else { t.muted }))], line.right());
        put(buf, line.x + BOX_W, y, &[seg(letter, base.fg(colour(t)).add_modifier(Modifier::BOLD))], line.right());
        let name_x = line.x + BOX_W + 2;
        let room = usize::from(line.right().saturating_sub(name_x + cw + 1));
        let ink = if reviewed { t.muted } else if on { t.strong } else { t.fg };
        put(buf, name_x, y, &[seg(crate::client::render::truncate(&f.path, room), base.fg(ink))], line.right());
        put(buf, line.right().saturating_sub(cw), y, &counts, line.right());
        app.hits.push((Rect { width: BOX_W - 1, ..line }, Hit::Button(Btn::Tick(*row))));
        app.hits.push((line, Hit::Button(Btn::Row(*row))));
    }
}

/// One diff line as the panel draws it: its text and the tint behind the whole row.
fn panel_diff_line(t: &Theme, l: &str) -> (Vec<Seg>, Option<Color>) {
    let plus = l.strip_prefix('+');
    let minus = l.strip_prefix('-');
    match (plus, minus) {
        (Some(body), _) => (vec![seg(format!("+ {body}"), Style::default().fg(t.done))], Some(crate::theme::mix(t.bg, t.done, DIFF_TINT))),
        (_, Some(body)) => (vec![seg(format!("− {body}"), Style::default().fg(t.err))], Some(crate::theme::mix(t.bg, t.err, DIFF_TINT))),
        _ if l.starts_with("@@") => (vec![seg(l.to_string(), Style::default().fg(t.muted).add_modifier(Modifier::DIM))], None),
        _ => (vec![seg(format!("  {}", l.strip_prefix(' ').unwrap_or(l)), Style::default().fg(t.muted))], None),
    }
}

/// The selected file's diff from `r.scroll`, with the comments written under their lines and the
/// cursor's row marked while the diff has the keys.
fn draw_diff(buf: &mut Buffer, rect: Rect, t: &Theme, v: &ChangesView, r: &Review) {
    let path = r.files.get(r.sel).map(|f| f.path.as_str()).unwrap_or("");
    let mut rows: Vec<(Option<usize>, Vec<Seg>, Option<Color>)> = Vec::new();
    for (k, l) in r.diff.iter().enumerate() {
        let (segs, tint) = panel_diff_line(t, l);
        rows.push((Some(k), segs, tint));
        for c in v.extra.comments.iter().filter(|c| c.path == path && c.index == k) {
            rows.push((None, vec![seg(format!("  ✎ {}", c.comment), Style::default().fg(t.accent))], None));
        }
    }
    let height = usize::from(rect.height);
    let last_start = rows.len().saturating_sub(height);
    let mut start = rows
        .iter()
        .position(|(k, ..)| k.is_some_and(|k| k >= usize::from(r.scroll)))
        .unwrap_or(last_start)
        .min(last_start);
    if let Some(at) = v.extra.line.and_then(|line| rows.iter().position(|(k, ..)| *k == Some(line))) {
        if at < start {
            start = at;
        } else if height > 0 && at >= start + height {
            start = at + 1 - height;
        }
    }
    for (offset, (index, segs, tint)) in rows.iter().skip(start).take(height).enumerate() {
        let y = rect.y + offset as u16;
        let line = Rect { y, height: 1, ..rect };
        let on = index.is_some() && *index == v.extra.line;
        let bg = if on { t.sel_on(t.bg) } else { tint.unwrap_or(t.bg) };
        fill(buf, line, bg);
        let segs: Vec<Seg> = segs.iter().map(|(s, st)| (s.clone(), st.bg(bg))).collect();
        put(buf, line.x, y, &segs, line.right());
    }
}

/// The message in a bordered box; a click on it edits.
fn draw_box(app: &mut App, buf: &mut Buffer, rect: Rect, t: &Theme, boxed: &MessageBox, lines: &[String]) {
    let look = Look::of(&app.cfg.ui);
    let edge = Style::default().fg(if boxed.editing { t.accent } else { t.border }).bg(t.bg);
    panel_box(buf, rect, look, edge);
    let ink = Style::default().fg(t.strong).bg(t.bg);
    for (i, line) in lines.iter().enumerate() {
        let mut segs = vec![seg(line.clone(), ink)];
        if boxed.editing && i + 1 == lines.len() {
            segs.push(seg("▏", Style::default().fg(t.accent).bg(t.bg)));
        }
        put(buf, rect.x + 2, rect.y + 1 + i as u16, &segs, rect.right().saturating_sub(2));
    }
    if !boxed.editing {
        app.hits.push((rect, Hit::Button(Btn::ViewKey('m'))));
    }
}

/// `[ctrl+enter] Commit 2 of 3` and `p Create PR`; while a question waits, it and its two answers.
fn draw_actions(app: &mut App, buf: &mut Buffer, rect: Rect, t: &Theme, v: &ChangesView, r: &Review) {
    if let Some((question, _)) = &v.confirm {
        let q = vec![seg(question.clone(), Style::default().fg(t.strong).bg(t.bg).add_modifier(Modifier::BOLD))];
        let x = put(buf, rect.x, rect.y, &q, rect.right().saturating_sub(12));
        let mut x = x + 1;
        for (key, label) in [('y', "yes"), ('n', "no")] {
            let segs = [chip(&key.to_string(), Style::default().bg(t.btn).fg(t.accent).add_modifier(Modifier::BOLD)), vec![seg(format!(" {label} "), Style::default().fg(t.strong).bg(t.bg))]].concat();
            let end = put(buf, x, rect.y, &segs, rect.right());
            app.hits.push((Rect { x, width: end - x, ..rect }, Hit::Button(Btn::ViewKey(key))));
            x = end;
        }
        return;
    }
    let commit = format!(" Commit {} of {} ", v.picked().len(), r.files.len());
    let key = chip("ctrl+enter", Style::default().bg(t.strong).fg(t.bg).add_modifier(Modifier::BOLD));
    let label = vec![seg(commit, Style::default().fg(t.strong).bg(t.bg))];
    let x = put(buf, rect.x, rect.y, &[key, label].concat(), rect.right());
    app.hits.push((Rect { width: x - rect.x, ..rect }, Hit::Button(Btn::ViewChord(KeyCode::Enter, KeyModifiers::CONTROL))));
    let pr = [chip("p", Style::default().bg(t.btn).fg(t.accent).add_modifier(Modifier::BOLD)), vec![seg(" Create PR", Style::default().fg(t.strong).bg(t.bg))]].concat();
    let px = x + 2;
    let end = put(buf, px, rect.y, &pr, rect.right());
    app.hits.push((Rect { x: px, width: end.saturating_sub(px), ..rect }, Hit::Button(Btn::ViewKey('p'))));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_long_message_is_cut_at_its_head_and_followed_at_its_tail_while_edited() {
        let text = "one\ntwo\nthree\nfour\nfive";
        assert_eq!(box_lines(text, 40, false), ["one", "two", "three…"]);
        assert_eq!(box_lines(text, 40, true), ["three", "four", "five"]);
        assert_eq!(box_lines("one\n", 40, true), ["one", ""], "a new line is a line to type on");
    }

    #[test]
    fn a_files_letter_is_a_for_new_m_for_changed_and_d_for_deleted() {
        let t = crate::theme::Theme::named("night");
        let file = |untracked, deleted| Changed { path: "f".into(), added: 0, removed: 0, untracked, deleted };
        let letter = |f: Changed| {
            let (l, colour) = status_letter(&f);
            (l, colour(&t))
        };
        assert_eq!(letter(file(true, false)), ("A", t.done));
        assert_eq!(letter(file(false, false)), ("M", t.warning));
        assert_eq!(letter(file(false, true)), ("D", t.err));
    }
}
