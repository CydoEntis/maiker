//! A session's status log: what its agent's own reports and the shell's prompt marks said happened
//! (`TermInfo::timeline`), newest first, with how long each turn ran. It explains the status the
//! daemon set (ADR 0003); nothing here decides one.

use super::*;
use super::side::put_cut;
use crate::protocol::{TurnEvent, TurnKind};

/// The widest the log grows.
const LOG_W: u16 = 96;

fn label(kind: TurnKind) -> &'static str {
    match kind {
        TurnKind::Working => "Started working",
        TurnKind::NeedsYou => "Stopped for you",
        TurnKind::Done => "Finished the turn",
        TurnKind::Idle => "Idle",
        TurnKind::Prompt => "Shell prompt",
        TurnKind::CommandStarted => "Command started",
        TurnKind::CommandFinished => "Command finished",
    }
}

/// What a line says happened: a finished command carries its exit code.
pub(in crate::client) fn describe(event: &TurnEvent) -> String {
    if event.kind == TurnKind::CommandFinished && !event.detail.is_empty() {
        return format!("{} (exit {})", label(event.kind), event.detail);
    }
    label(event.kind).to_string()
}

/// How long each turn ran: for a `Working` event, the seconds until the turn ended (done, stopped
/// for you or idle), by its place in `events`.
pub(in crate::client) fn turn_lengths(events: &[TurnEvent]) -> Vec<Option<u64>> {
    events
        .iter()
        .enumerate()
        .map(|(i, e)| {
            (e.kind == TurnKind::Working).then(|| {
                events[i + 1..]
                    .iter()
                    .find(|later| matches!(later.kind, TurnKind::Done | TurnKind::NeedsYou | TurnKind::Idle))
                    .map(|end| end.at.saturating_sub(e.at))
            })?
        })
        .collect()
}

/// `42s`, `3m 12s`.
pub(in crate::client) fn duration(seconds: u64) -> String {
    if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m {}s", seconds / 60, seconds % 60)
    }
}

/// The log of `term`, newest first; `sel` is the line at the top of the list.
pub(in crate::client) fn draw_status_log(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, term: ClientTerm, top: usize) {
    let events = app.term_info(term).map(|i| i.timeline.clone()).unwrap_or_default();
    let why = app.term_info(term).map(|i| crate::hidden::sanitize(&i.status_why, false)).unwrap_or_default();
    let name = app.session_name(term);
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let h = (events.len() as u16 + 9).clamp(11, area.height.saturating_sub(2));
    let r = panel(app, buf, area, LOG_W, h, &format!("status log · {name}"), &[], t);
    let ground = Style::default().bg(t.card);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    // The reason the daemon gave for the status it set last, above what led to it.
    let now = if why.is_empty() { "no reason recorded".to_string() } else { why };
    put_cut(buf, x, r.y + 2, vec![seg("Now  ", ground.fg(t.muted)), seg(now, ground.fg(t.strong))], end);
    let y0 = r.y + 4;
    let rows = r.height.saturating_sub(7) as usize;
    panel_bar(buf, r, t, &[("↑↓", "scroll"), ("Esc", "close")]);
    if events.is_empty() {
        put(buf, x, y0, &[seg("Nothing yet.", ground.fg(t.text))], end);
        put_cut(buf, x, y0 + 1, vec![seg("Turns show here as the agent reports them, and commands too in a shell that marks its prompts.", ground.fg(t.muted))], end);
        return;
    }
    let lengths = turn_lengths(&events);
    let top = top.min(events.len().saturating_sub(rows));
    for (k, i) in (0..events.len()).rev().skip(top).take(rows).enumerate() {
        let e = &events[i];
        let tone = match e.kind {
            TurnKind::NeedsYou => t.blocked,
            TurnKind::Done => t.done,
            TurnKind::CommandFinished if !e.detail.is_empty() && e.detail != "0" => t.err,
            _ => t.text,
        };
        let mut segs = vec![
            seg(crate::clock::local_hms(e.at), ground.fg(t.muted)),
            seg("  ", ground),
            seg(describe(e), ground.fg(tone)),
        ];
        if let Some(Some(ran)) = lengths.get(i) {
            segs.extend([seg("  ran ", ground.fg(t.muted)), seg(duration(*ran), ground.fg(t.muted))]);
        }
        if !e.detail.is_empty() && e.kind != TurnKind::CommandFinished {
            segs.extend([seg("  · ", ground.fg(t.faint())), seg(crate::hidden::sanitize(&e.detail, false), ground.fg(t.muted))]);
        }
        put_cut(buf, x, y0 + k as u16, segs, end);
    }
}

impl App {
    /// The status log of the session you're on.
    pub(in crate::client) fn open_status_log(&mut self) {
        match self.selected_term() {
            Some(term) => self.mode = Mode::StatusLog { term, top: 0 },
            None => self.notify("no session to show the status log of".into(), false),
        }
    }

    pub(in crate::client) fn on_status_log_key(&mut self, term: ClientTerm, top: usize, k: &KeyEvent) {
        let n = self.term_info(term).map_or(0, |i| i.timeline.len());
        let top = match k.code {
            KeyCode::Esc | KeyCode::Enter | KeyCode::Char('q') => {
                self.mode = Mode::Normal;
                return;
            }
            KeyCode::Down | KeyCode::Char('j') => (top + 1).min(n.saturating_sub(1)),
            KeyCode::Up | KeyCode::Char('k') => top.saturating_sub(1),
            KeyCode::PageDown => (top + 10).min(n.saturating_sub(1)),
            KeyCode::PageUp => top.saturating_sub(10),
            _ => top,
        };
        self.mode = Mode::StatusLog { term, top };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(at: u64, kind: TurnKind, detail: &str) -> TurnEvent {
        TurnEvent { at, kind, detail: detail.into() }
    }

    #[test]
    fn a_turn_runs_until_it_ends_and_a_failed_command_says_its_exit() {
        let events = [
            at(100, TurnKind::Working, "hook: UserPromptSubmit"),
            at(130, TurnKind::NeedsYou, "hook: Notification"),
            at(200, TurnKind::Working, ""),
            at(400, TurnKind::Done, "hook: Stop"),
            at(410, TurnKind::Working, ""),
        ];
        assert_eq!(turn_lengths(&events), [Some(30), None, Some(200), None, None]);
        assert_eq!(duration(42), "42s");
        assert_eq!(duration(200), "3m 20s");
        assert_eq!(describe(&at(1, TurnKind::CommandFinished, "1")), "Command finished (exit 1)");
        assert_eq!(describe(&at(1, TurnKind::CommandFinished, "")), "Command finished");
    }
}
