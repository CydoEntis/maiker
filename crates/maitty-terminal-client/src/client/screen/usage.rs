//! Usage and cost (`u` in key mode, the sidebar's menu): what each agent session has used and
//! the plan limits, exactly as the providers reported them to the daemon (ADR 0009). Nothing is
//! estimated here; a figure the provider did not report is left out.
//!
//! Four tabs: `now` (the open sessions and the plan limits, from the snapshot) and `today`,
//! `7 days`, `30 days` (this computer's usage store, `Query::UsageReport`): the totals, a bar per
//! day and the sessions, most cost first.

use super::chips::{Chip, chip};
use super::*;
use crate::protocol::{ClientMsg, Limit, Query, Usage};
use maitty_shared::usage_report::{SessionUsage, UsageFigures, UsagePeriod, UsageReport};

/// The modal's width and the rows it shows sessions in before `+ N more`.
const USAGE_W: u16 = 84;
const SESSIONS_SHOWN: usize = 12;
/// A period tab's height: the tabs, the totals, the chart and the sessions under it.
const REPORT_H: u16 = 26;
/// How tall the day chart is, in rows; each row holds eight steps of a bar.
const CHART_ROWS: u16 = 3;
/// The widest one day's bar is drawn, so a week does not become seven slabs.
const BAR_MAX_W: u16 = 6;
/// Eighths of a cell, for the top of a bar.
const EIGHTHS: [&str; 8] = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/// The tabs, in the order Tab steps through them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(in crate::client) enum UsageTab {
    #[default]
    Now,
    Period(UsagePeriod),
}

const TABS: [UsageTab; 4] = [
    UsageTab::Now,
    UsageTab::Period(UsagePeriod::Day),
    UsageTab::Period(UsagePeriod::Week),
    UsageTab::Period(UsagePeriod::Month),
];

impl UsageTab {
    fn label(self) -> &'static str {
        match self {
            UsageTab::Now => "now",
            UsageTab::Period(UsagePeriod::Day) => "today",
            UsageTab::Period(UsagePeriod::Week) => "7 days",
            UsageTab::Period(UsagePeriod::Month) => "30 days",
        }
    }
}

/// The modal's state between frames: the tab, the chosen session row, and the last report the
/// daemon sent for each period (kept, so going back to a tab shows it while it is asked again).
#[derive(Debug, Default)]
pub(in crate::client) struct UsageView {
    tab: UsageTab,
    sel: usize,
    reports: Vec<UsageReport>,
    /// The period asked and not answered yet.
    waiting: Option<UsagePeriod>,
    /// Said instead of a report: the daemon is too old to keep one.
    refused: Option<String>,
}

impl UsageView {
    fn report(&self, period: UsagePeriod) -> Option<&UsageReport> {
        self.reports.iter().find(|r| r.period == period)
    }
}

/// One agent session's line: its name, what it reported, and the pane to open.
struct UsageRow {
    state: status_mark::State,
    name: String,
    usage: Usage,
    term: ClientTerm,
}

fn rows(app: &App) -> Vec<UsageRow> {
    let model = app.screen_model();
    let mut rows: Vec<UsageRow> = app
        .all_terms()
        .into_iter()
        .filter(|(_, i)| i.agent.is_some())
        .map(|(term, info)| UsageRow {
            state: pane_state(app, info, term),
            name: session_name(app, &model, term),
            usage: info.usage.clone(),
            term,
        })
        .collect();
    rows.sort_by(|a, b| b.usage.cost.unwrap_or(0.0).total_cmp(&a.usage.cost.unwrap_or(0.0)));
    rows
}

/// Tokens as people read them: `950`, `12.3k`, `1.2M`.
fn tokens(n: u64) -> String {
    match n {
        0..1_000 => n.to_string(),
        1_000..1_000_000 => format!("{:.1}k", n as f64 / 1_000.0),
        _ => format!("{:.1}M", n as f64 / 1_000_000.0),
    }
}

/// What a session reported, in the order a reader compares them; empty when it reported none.
fn figures(u: &Usage) -> String {
    let mut parts = Vec::new();
    if let Some(c) = u.context {
        parts.push(format!("context {c:.0}%"));
    }
    if let Some(n) = u.tokens {
        parts.push(format!("{} tokens", tokens(n)));
    }
    if let Some(c) = u.cost {
        parts.push(format!("${c:.2}"));
    }
    parts.join(" · ")
}

/// Working time as people say it: `45s`, `12m`, `5h 3m`.
fn duration(secs: u64) -> String {
    match secs {
        0..60 => format!("{secs}s"),
        60..3_600 => format!("{}m", secs / 60),
        _ => format!("{}h {}m", secs / 3_600, secs % 3_600 / 60),
    }
}

/// A period's or a session's figures: cost, tokens in and out, turns, working time; only what
/// was reported.
fn period_figures(f: &UsageFigures) -> String {
    let mut parts = Vec::new();
    if let Some(c) = f.cost {
        parts.push(format!("${c:.2}"));
    }
    if let Some(n) = f.tokens_in {
        parts.push(format!("{} in", tokens(n)));
    }
    if let Some(n) = f.tokens_out {
        parts.push(format!("{} out", tokens(n)));
    }
    if f.turns > 0 {
        parts.push(format!("{} turn{}", f.turns, if f.turns == 1 { "" } else { "s" }));
    }
    if f.working_secs > 0 {
        parts.push(format!("{} working", duration(f.working_secs)));
    }
    parts.join(" · ")
}

/// What a day's bar measures: cost when the period reported any, else tokens.
fn bar_value(f: &UsageFigures, by_cost: bool) -> f64 {
    if by_cost {
        f.cost.unwrap_or(0.0)
    } else {
        (f.tokens_in.unwrap_or(0) + f.tokens_out.unwrap_or(0)) as f64
    }
}

/// Days since 1970-01-01 of a `YYYY-MM-DD` day, None when it is not one.
fn day_number(day: &str) -> Option<i64> {
    let mut parts = day.splitn(3, '-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // Howard Hinnant's days-from-civil: years start in March, so the leap day comes last.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// The most days a chart draws, whatever the report's window says.
const MOST_DAYS: usize = 400;

/// Each day of the window, oldest first, with its value: the report lists only days with usage,
/// so the days between are zero.
fn day_values(r: &UsageReport, by_cost: bool) -> Vec<f64> {
    let (Some(from), Some(to)) = (day_number(&r.from), day_number(&r.to)) else {
        return r.days.iter().map(|d| bar_value(&d.figures, by_cost)).collect();
    };
    let n = usize::try_from(to - from + 1).unwrap_or(0).min(MOST_DAYS);
    let mut values = vec![0.0; n];
    for d in &r.days {
        let at = day_number(&d.day).and_then(|x| usize::try_from(x - from).ok());
        if let Some(v) = at.and_then(|i| values.get_mut(i)) {
            *v = bar_value(&d.figures, by_cost);
        }
    }
    values
}

/// The cell of a bar `eighths` tall at chart row `row` (0 is the top).
fn bar_cell(eighths: u16, row: u16) -> &'static str {
    let below = (CHART_ROWS - 1 - row) * 8;
    match eighths.saturating_sub(below) {
        0 => " ",
        n => EIGHTHS[usize::from(n.min(8)) - 1],
    }
}

/// A plan limit: `5h 40% · resets 14:00`.
fn limit_words(l: &Limit) -> String {
    format!("{} {:.0}% · resets {}", l.name, l.used, crate::clock::local_hm(l.resets_at))
}

fn draw_tabs(app: &mut App, buf: &mut Buffer, x: u16, y: u16, end: u16, t: &Theme) {
    let mut at = x;
    for tab in TABS {
        let chosen = app.usage_view.tab == tab;
        let segs = chip(app, tab.label(), Chip::Title { focused: chosen }, t.card, t);
        let w = segs_width(&segs);
        put(buf, at, y, &segs, end);
        at += w + 1;
    }
}

/// The chosen row's ground and its accent `▎`.
fn mark_row(buf: &mut Buffer, x: u16, y: u16, end: u16, t: &Theme) {
    fill(buf, Rect { x: x - 1, y, width: end + 1 - x + 1, height: 1 }, t.hov);
    put(buf, x - 1, y, &[seg("▎", Style::default().bg(t.hov).fg(t.accent))], end);
}

pub(in crate::client) fn draw_usage(app: &mut App, f: &mut Frame, area: Rect, t: &Theme) {
    match app.usage_view.tab {
        UsageTab::Now => draw_now(app, f, area, t),
        UsageTab::Period(p) => draw_period(app, f, area, p, t),
    }
}

fn draw_now(app: &mut App, f: &mut Frame, area: Rect, t: &Theme) {
    let rows = rows(app);
    let limits = app.snap.limits.clone();
    let shown = rows.len().min(SESSIONS_SHOWN);
    let more = rows.len() - shown;
    let limit_rows = limits.len();
    let body = shown.max(1) + usize::from(more > 0) + 2 + limit_rows.max(1);
    let h = body as u16 + 8;
    let sel = app.usage_view.sel.min(rows.len().saturating_sub(1));
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let r = panel(app, buf, area, USAGE_W, h, "usage and cost", &[], t);
    let ground = Style::default().bg(t.card);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    draw_tabs(app, buf, x, r.y + 2, end, t);
    let mut y = r.y + 4;
    if rows.is_empty() {
        put(buf, x, y, &[seg("No agent sessions yet.", ground.fg(t.muted))], end);
        y += 1;
    }
    for (i, row) in rows.iter().take(shown).enumerate() {
        let row_ground = if i == sel { Style::default().bg(t.hov) } else { ground };
        if i == sel {
            mark_row(buf, x, y, end, t);
        }
        let mark = app.state_mark(row.state, t);
        let said = figures(&row.usage);
        let said = if said.is_empty() { "nothing reported".to_string() } else { said };
        let right = said.width() as u16;
        let name_end = end.saturating_sub(right + 2);
        put(buf, x, y, &[seg(mark.glyph, row_ground.fg(mark.color)), seg(" ", row_ground)], end);
        put(buf, x + 2, y, &[seg(truncate(&row.name, name_end.saturating_sub(x + 2) as usize), row_ground.fg(t.strong))], name_end);
        put(buf, end.saturating_sub(right), y, &[seg(said, row_ground.fg(t.text))], end);
        y += 1;
    }
    if more > 0 {
        put(buf, x, y, &[seg(format!("+ {more} more"), ground.fg(t.muted))], end);
        y += 1;
    }
    y += 1;
    put(buf, x, y, &[seg("plan limits", ground.fg(t.muted))], end);
    y += 1;
    if limits.is_empty() {
        put(buf, x, y, &[seg("none reported", ground.fg(t.muted))], end);
    }
    for (agent, ls) in &limits {
        let words: Vec<String> = ls.iter().map(limit_words).collect();
        put(
            buf,
            x,
            y,
            &[seg(format!("{agent:<8}"), ground.fg(t.strong)), seg(words.join("   "), ground.fg(t.text))],
            end,
        );
        y += 1;
    }
    panel_bar(buf, r, t, &usage_keys(!rows.is_empty()));
}

fn usage_keys(rows: bool) -> Vec<(&'static str, &'static str)> {
    let mut keys = vec![("Tab", "period")];
    if rows {
        keys.extend([("↑↓", "move"), ("Enter", "open")]);
    }
    keys.push(("Esc", "close"));
    keys
}

/// A report session's name: the open pane's when it is still open, else its agent and folder.
fn report_name(app: &App, model: &[Proj], s: &SessionUsage) -> (String, Option<ClientTerm>) {
    let open = s
        .term
        .map(|term| ClientTerm::on(MachineId::LOCAL, term))
        .filter(|term| app.term_info(*term).is_some());
    match open {
        Some(term) => (session_name(app, model, term), Some(term)),
        None => (format!("{} · {}", s.agent, s.project), None),
    }
}

fn draw_period(app: &mut App, f: &mut Frame, area: Rect, period: UsagePeriod, t: &Theme) {
    let model = app.screen_model();
    let report = app.usage_view.report(period).cloned();
    let refused = app.usage_view.refused.clone();
    let waiting = app.usage_view.waiting == Some(period);
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let right: Vec<Seg> = if waiting && report.is_some() {
        vec![seg(" updating… ", Style::default().fg(t.muted))]
    } else {
        Vec::new()
    };
    let r = panel(app, buf, area, USAGE_W, REPORT_H, "usage and cost", &right, t);
    let ground = Style::default().bg(t.card);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    draw_tabs(app, buf, x, r.y + 2, end, t);
    let mut y = r.y + 4;
    let bar_y = r.bottom().saturating_sub(2);
    let Some(report) = report else {
        let said = refused.unwrap_or_else(|| "asking this computer for its usage…".to_string());
        put(buf, x, y, &[seg(said, ground.fg(t.muted))], end);
        panel_bar(buf, r, t, &usage_keys(false));
        return;
    };
    let totals = period_figures(&report.totals);
    let totals = if totals.is_empty() { "nothing reported".to_string() } else { totals };
    put(buf, x, y, &[seg(totals, ground.fg(t.strong).add_modifier(Modifier::BOLD))], end);
    y += 1;
    let plural = if report.session_count == 1 { "" } else { "s" };
    let mut about = format!("{} session{plural}", report.session_count);
    if report.sessions_without_cost > 0 {
        about.push_str(&format!(" · {} reported no cost", report.sessions_without_cost));
    }
    if report.from == report.to {
        about.push_str(&format!(" · {} (UTC)", report.to));
    } else {
        about.push_str(&format!(" · {} to {} (UTC)", report.from, report.to));
    }
    put(buf, x, y, &[seg(about, ground.fg(t.muted))], end);
    y += 2;
    if period != UsagePeriod::Day {
        y = draw_chart(buf, x, y, end, &report, t) + 1;
    }
    put(buf, x, y, &[seg("SESSIONS", ground.fg(t.muted))], end);
    y += 1;
    // One row is kept for `+ N more`.
    let room = usize::from(bar_y.saturating_sub(y + 1)).max(1);
    let sel = app.usage_view.sel.min(report.sessions.len().saturating_sub(1));
    // The list follows the chosen row past the rows it has room for.
    let skip = (sel + 1).saturating_sub(room);
    if report.sessions.is_empty() {
        put(buf, x, y, &[seg("No usage in this period.", ground.fg(t.muted))], end);
    }
    for (i, s) in report.sessions.iter().enumerate().skip(skip).take(room) {
        let row_ground = if i == sel { Style::default().bg(t.hov) } else { ground };
        if i == sel {
            mark_row(buf, x, y, end, t);
        }
        let (name, open) = report_name(app, &model, s);
        let said = period_figures(&s.figures);
        let right = said.width() as u16;
        let name_end = end.saturating_sub(right + 2);
        // A session still open reads brighter: Enter goes to it.
        let ink = if open.is_some() { t.strong } else { t.text };
        put(buf, x + 1, y, &[seg(truncate(&name, name_end.saturating_sub(x + 1) as usize), row_ground.fg(ink))], name_end);
        put(buf, end.saturating_sub(right), y, &[seg(said, row_ground.fg(t.text))], end);
        y += 1;
    }
    let hidden = report.sessions.len().saturating_sub(skip + room);
    if hidden > 0 && y < bar_y {
        put(buf, x, y, &[seg(format!("+ {hidden} more"), ground.fg(t.muted))], end);
    }
    panel_bar(buf, r, t, &usage_keys(!report.sessions.is_empty()));
}

/// The day chart: a bar per day, scaled to the busiest, the first and last day under it and the
/// busiest day's figure at the right. Returns the row under it.
fn draw_chart(buf: &mut Buffer, x: u16, y: u16, end: u16, report: &UsageReport, t: &Theme) -> u16 {
    let ground = Style::default().bg(t.card);
    let by_cost = report.totals.cost.is_some();
    let values = day_values(report, by_cost);
    let top = values.iter().copied().fold(0.0_f64, f64::max);
    let label = if by_cost { format!("${top:.2}") } else { format!("{} tokens", tokens(top as u64)) };
    let label_w = label.width() as u16;
    let room = end.saturating_sub(x + label_w + 2);
    let n = values.len().max(1) as u16;
    let step = (room / n).clamp(1, BAR_MAX_W + 1);
    // Bars part by a blank cell when there is room for one.
    let bar_w = if step > 2 { step - 1 } else { step };
    for (i, v) in values.iter().enumerate() {
        let scaled = if top > 0.0 { ((v / top) * f64::from(CHART_ROWS * 8)).round() as u16 } else { 0 };
        // A day with any usage shows at least a sliver, so it reads apart from an empty one.
        let eighths = if *v > 0.0 { scaled.max(1) } else { 0 };
        let bx = x + i as u16 * step;
        let style = if eighths == 0 { ground.fg(t.faint()) } else { ground.fg(t.accent) };
        for row in 0..CHART_ROWS {
            let cell = if eighths == 0 && row == CHART_ROWS - 1 { "·" } else { bar_cell(eighths, row) };
            put(buf, bx, y + row, &[seg(cell.repeat(usize::from(bar_w)), style)], end);
        }
    }
    put(buf, end.saturating_sub(label_w), y, &[seg(label, ground.fg(t.muted))], end);
    let under = y + CHART_ROWS;
    put(buf, x, under, &[seg(short_day(&report.from), ground.fg(t.muted))], end);
    let to = short_day(&report.to);
    let last_end = x + (n - 1) * step + bar_w;
    let to_x = last_end.saturating_sub(to.width() as u16).max(x + 6);
    put(buf, to_x, under, &[seg(to, ground.fg(t.muted))], end);
    under + 1
}

/// `2026-11-15` as `11-15`.
fn short_day(day: &str) -> String {
    day.get(5..).unwrap_or(day).to_string()
}

impl App {
    /// Open the modal on the tab it was last left on, asking again for that period's report.
    pub(in crate::client) fn open_usage(&mut self) {
        self.mode = Mode::Usage;
        self.usage_view.sel = 0;
        if let UsageTab::Period(p) = self.usage_view.tab {
            self.ask_usage_report(p);
        }
    }

    fn ask_usage_report(&mut self, period: UsagePeriod) {
        let ask = ClientMsg::Query(Query::UsageReport { period });
        // An older daemon passes over a request it cannot read and never answers.
        if ask.introduced_in() > self.local_protocol {
            self.usage_view.refused = Some("Restart the service to see usage by day.".into());
            return;
        }
        self.usage_view.refused = None;
        self.usage_view.waiting = Some(period);
        self.send(MachineId::LOCAL, ask);
    }

    /// This computer's daemon answered: keep it for its period.
    pub(in crate::client) fn usage_report_arrived(&mut self, report: UsageReport) {
        let v = &mut self.usage_view;
        if v.waiting == Some(report.period) {
            v.waiting = None;
        }
        v.reports.retain(|r| r.period != report.period);
        v.reports.push(report);
    }

    /// The pane each row opens, in the order the tab lists them.
    fn usage_terms(&self) -> Vec<Option<ClientTerm>> {
        match self.usage_view.tab {
            UsageTab::Now => rows(self).into_iter().map(|r| Some(r.term)).collect(),
            UsageTab::Period(p) => {
                let model = self.screen_model();
                self.usage_view
                    .report(p)
                    .map(|r| r.sessions.iter().map(|s| report_name(self, &model, s).1).collect())
                    .unwrap_or_default()
            }
        }
    }

    pub(in crate::client) fn on_usage_key(&mut self, k: &KeyEvent) {
        let at = TABS.iter().position(|x| *x == self.usage_view.tab).unwrap_or(0);
        match k.code {
            KeyCode::Esc | KeyCode::Char('u' | 'q') => self.mode = Mode::Normal,
            KeyCode::Tab | KeyCode::Right => self.usage_tab(TABS[(at + 1) % TABS.len()]),
            KeyCode::BackTab | KeyCode::Left => {
                self.usage_tab(TABS[(at + TABS.len() - 1) % TABS.len()])
            }
            KeyCode::Enter => match self.usage_terms().get(self.usage_view.sel) {
                Some(Some(term)) => self.screen_focus(*term),
                Some(None) => self.notify("that session is closed".into(), false),
                None => self.mode = Mode::Normal,
            },
            _ => {
                let n = self.usage_terms().len();
                Self::list_move(&mut self.usage_view.sel, n, k);
            }
        }
    }

    fn usage_tab(&mut self, tab: UsageTab) {
        self.usage_view.tab = tab;
        self.usage_view.sel = 0;
        if let UsageTab::Period(p) = tab {
            self.ask_usage_report(p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn figures_say_only_what_the_provider_reported() {
        assert_eq!(figures(&Usage::default()), "");
        let u = Usage {
            context: Some(42.0),
            cost: Some(0.4213),
            tokens: Some(12_345),
            ..Usage::default()
        };
        assert_eq!(figures(&u), "context 42% · 12.3k tokens · $0.42");
        assert_eq!(tokens(950), "950");
        assert_eq!(tokens(1_200_000), "1.2M");
    }

    #[test]
    fn a_period_says_cost_tokens_turns_and_time_only_when_reported() {
        assert_eq!(period_figures(&UsageFigures::default()), "");
        let f = UsageFigures {
            tokens_in: Some(1_200_000),
            tokens_out: Some(30_000),
            cost: Some(12.345),
            turns: 1,
            working_secs: 18_180,
        };
        assert_eq!(period_figures(&f), "$12.35 · 1.2M in · 30.0k out · 1 turn · 5h 3m working");
    }

    #[test]
    fn days_count_from_the_epoch_and_reject_what_is_not_a_day() {
        assert_eq!(day_number("1970-01-01"), Some(0));
        assert_eq!(day_number("2000-03-01"), Some(11_017));
        let week = day_number("2026-11-15").zip(day_number("2026-11-09"));
        assert_eq!(week.map(|(a, b)| a - b), Some(6));
        assert_eq!(day_number("2026-13-01"), None);
        assert_eq!(day_number("soon"), None);
    }

    #[test]
    fn the_days_without_usage_between_are_zero() {
        let day = |d: &str, cost: f64| maitty_shared::usage_report::DayUsage {
            day: d.into(),
            figures: UsageFigures { cost: Some(cost), ..UsageFigures::default() },
        };
        let r = UsageReport {
            period: UsagePeriod::Week,
            from: "2026-11-09".into(),
            to: "2026-11-15".into(),
            retention_days: 30,
            totals: UsageFigures { cost: Some(3.0), ..UsageFigures::default() },
            session_count: 1,
            sessions_without_cost: 0,
            sessions: Vec::new(),
            days: vec![day("2026-11-10", 1.0), day("2026-11-15", 2.0)],
        };
        assert_eq!(day_values(&r, true), [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 2.0]);
    }

    #[test]
    fn a_bar_fills_from_the_bottom_row_up() {
        assert_eq!(bar_cell(0, 2), " ");
        assert_eq!(bar_cell(3, 2), "▃");
        assert_eq!(bar_cell(3, 1), " ");
        assert_eq!(bar_cell(12, 2), "█");
        assert_eq!(bar_cell(12, 1), "▄");
        assert_eq!(bar_cell(24, 0), "█");
    }
}
