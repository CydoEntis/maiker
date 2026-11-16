//! The specialist agents a pane's project and its user's home define for Claude Code and Codex,
//! read-only (`Action::Specialists`, `Query::Specialists`; ADR 0010). The app never makes or edits
//! these files: `/agents` in Claude Code and the files themselves are where that is done. Enter
//! shows one file as it is. Docs: UI.md, "Specialist agents".

use super::*;
use crate::protocol::{ClientMsg, Query};
use maitty_shared::specialists::{SpecialistFile, SpecialistList, SpecialistScope, SpecialistTool};

/// The widest the modal grows.
const SPECIALISTS_W: u16 = 100;

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct SpecialistsView {
    pub term: ClientTerm,
    /// The session's name, for the title.
    pub title: String,
    /// The files, or why they could not be listed; None until the answer comes.
    pub list: Option<Result<SpecialistList, String>>,
    pub sel: usize,
    /// The file being read (an index into the list), and how far down it is scrolled.
    pub open: Option<usize>,
    pub scroll: usize,
}

/// The order the groups are listed in, and each one's heading.
const SCOPES: [(SpecialistScope, &str); 3] =
    [(SpecialistScope::Project, "THIS PROJECT"), (SpecialistScope::Home, "YOUR HOME FOLDER"), (SpecialistScope::Unknown, "ELSEWHERE")];

fn tool_words(tool: SpecialistTool) -> &'static str {
    match tool {
        SpecialistTool::Claude => "Claude Code",
        SpecialistTool::Codex => "Codex",
        SpecialistTool::Unknown => "Other",
    }
}

/// A line of a file from the pane's machine, made safe for a cell grid: tabs as spaces, no
/// control or hidden characters.
fn plain(line: &str) -> String {
    line.replace('\t', "    ")
        .chars()
        .filter(|c| !c.is_control() && !crate::hidden::is_invisible(*c))
        .collect()
}

impl SpecialistsView {
    /// The files in the order they are drawn: by group, then as listed.
    pub fn ordered(&self) -> Vec<&SpecialistFile> {
        let Some(Ok(list)) = &self.list else {
            return Vec::new();
        };
        SCOPES
            .iter()
            .flat_map(|(scope, _)| list.files.iter().filter(move |f| f.scope == *scope))
            .collect()
    }
}

impl App {
    /// Lists the agent files for the pane you are on, on whichever machine it runs.
    pub(in crate::client) fn open_specialists(&mut self) {
        let Some(term) = self.selected_term() else {
            return self.notify("no pane to list the agent files of".into(), true);
        };
        let ask = ClientMsg::Query(Query::Specialists { term: term.term });
        // An older daemon passes over a request it cannot read and never answers.
        if term.machine == MachineId::LOCAL && ask.introduced_in() > self.local_protocol {
            return self.notify("restart the service to list specialist agents".into(), true);
        }
        self.send(term.machine, ask);
        let title = self.session_name(term);
        self.mode = Mode::Specialists(Box::new(SpecialistsView { term, title, list: None, sel: 0, open: None, scroll: 0 }));
    }

    pub(in crate::client) fn specialists_arrived(&mut self, machine: MachineId, list: SpecialistList) {
        if let Mode::Specialists(v) = &mut self.mode
            && v.term.machine == machine
            && v.term.term == list.term
            && v.list.is_none()
        {
            v.list = Some(Ok(list));
        }
    }

    /// The daemon could not list them. True when the error was for the open list.
    pub(in crate::client) fn specialists_failed(&mut self, machine: MachineId, why: &str) -> bool {
        match &mut self.mode {
            Mode::Specialists(v) if v.term.machine == machine && v.list.is_none() => {
                v.list = Some(Err(plain(why)));
                true
            }
            _ => false,
        }
    }

    pub(in crate::client) fn specialists_click(&mut self, i: usize) {
        if let Mode::Specialists(v) = &mut self.mode {
            v.sel = i;
            v.open = Some(i);
            v.scroll = 0;
        }
    }

    pub(in crate::client) fn on_specialists_key(&mut self, mut v: SpecialistsView, k: &KeyEvent) {
        let n = v.ordered().len();
        match (v.open, k.code) {
            (None, KeyCode::Esc | KeyCode::Char('q')) => {
                self.mode = Mode::Normal;
                return;
            }
            (Some(_), KeyCode::Esc | KeyCode::Backspace | KeyCode::Left) => v.open = None,
            (None, KeyCode::Up | KeyCode::Char('k')) => v.sel = v.sel.saturating_sub(1),
            (None, KeyCode::Down | KeyCode::Char('j')) => v.sel = (v.sel + 1).min(n.saturating_sub(1)),
            (None, KeyCode::Enter | KeyCode::Right) if n > 0 => {
                v.open = Some(v.sel);
                v.scroll = 0;
            }
            (Some(_), KeyCode::Up | KeyCode::Char('k')) => v.scroll = v.scroll.saturating_sub(1),
            (Some(_), KeyCode::Down | KeyCode::Char('j')) => v.scroll += 1,
            (Some(_), KeyCode::PageUp) => v.scroll = v.scroll.saturating_sub(10),
            (Some(_), KeyCode::PageDown | KeyCode::Char(' ')) => v.scroll += 10,
            _ => {}
        }
        self.mode = Mode::Specialists(Box::new(v));
    }
}

pub(in crate::client) fn draw_specialists(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, v: &SpecialistsView) {
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let files = v.ordered();
    let opened = v.open.and_then(|i| files.get(i).copied());
    let title = match opened {
        Some(file) => plain(&file.name),
        None => format!("Specialist agents · {}", plain(&v.title)),
    };
    let h = area.height.saturating_sub(6).max(10);
    let r = panel(app, buf, area, SPECIALISTS_W, h, &title, &[], t);
    let c = Style::default().bg(t.card);
    let quiet = c.fg(t.muted).add_modifier(Modifier::ITALIC);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    let room = r.height.saturating_sub(5) as usize;
    if let Some(file) = opened {
        put(buf, x, r.y + 2, &[seg(format!("{} · {}", tool_words(file.tool), plain(&file.path)), c.fg(t.muted))], end);
        let lines: Vec<String> = file.text.lines().map(plain).collect();
        let body = room.saturating_sub(2);
        let top = v.scroll.min(lines.len().saturating_sub(body));
        for (n, line) in lines.iter().skip(top).take(body).enumerate() {
            put(buf, x, r.y + 4 + n as u16, &[seg(line.clone(), c.fg(t.text))], end);
        }
        if file.text_cut && top + body >= lines.len() {
            let y = r.y + 4 + lines.len().saturating_sub(top).min(body) as u16;
            put(buf, x, y.min(r.bottom().saturating_sub(3)), &[seg("The file is longer; only its start is shown.", quiet)], end);
        }
        panel_bar(buf, r, t, &[("↑↓", "scroll"), ("Esc", "back")]);
        return;
    }
    let mut y = r.y + 2;
    let last = r.bottom().saturating_sub(3);
    match &v.list {
        None => {
            put(buf, x, y, &[seg("Looking for agent files…", quiet)], end);
        }
        Some(Err(why)) => {
            put(buf, x, y, &[seg(format!("Could not list the agent files: {why}"), c.fg(t.err))], end);
        }
        Some(Ok(_)) if files.is_empty() => {
            put(buf, x, y, &[seg("No agent files in .claude/agents or .codex/agents here or in your home folder.", quiet)], end);
        }
        Some(Ok(list)) => {
            // Rows (a group's heading or a file) in order; scrolled so the selected file shows.
            let mut rows: Vec<Option<usize>> = Vec::new();
            let mut heads: Vec<&str> = Vec::new();
            let mut at = 0;
            for (scope, head) in SCOPES {
                let count = files.iter().filter(|f| f.scope == scope).count();
                if count == 0 {
                    continue;
                }
                rows.push(None);
                heads.push(head);
                rows.extend((at..at + count).map(Some));
                at += count;
            }
            let fit = (last.saturating_sub(y)) as usize;
            let sel_row = rows.iter().position(|r| *r == Some(v.sel)).unwrap_or(0);
            let start = sel_row.saturating_sub(fit.saturating_sub(1));
            let head_before = rows[..start].iter().filter(|r| r.is_none()).count();
            let mut head_i = head_before;
            for row in rows.iter().skip(start).take(fit) {
                match row {
                    None => {
                        put(buf, x, y, &[seg(heads.get(head_i).copied().unwrap_or(""), c.fg(t.muted).add_modifier(Modifier::BOLD))], end);
                        head_i += 1;
                    }
                    Some(i) => {
                        let file = files[*i];
                        let rr = Rect { x: r.x + 1, y, width: r.width.saturating_sub(2), height: 1 };
                        let on = *i == v.sel;
                        let st = list_row(app, buf, rr, on, t);
                        let mut segs = vec![
                            seg(format!("{:<28}", truncate(&plain(&file.name), 28)), st.fg(if on { t.strong } else { t.text }).add_modifier(Modifier::BOLD)),
                            seg(format!("  {:<12}", tool_words(file.tool)), st.fg(t.muted)),
                        ];
                        if let Some(d) = &file.description {
                            segs.push(seg(format!("  {}", plain(d)), st.fg(t.muted)));
                        }
                        put(buf, x, y, &segs, end);
                        hit(app, rr, ScreenHit::SpecialistRow(*i));
                    }
                }
                y += 1;
            }
            if list.truncated && y < last {
                put(buf, x, y, &[seg(format!("Only the first {} files are listed.", list.files.len()), quiet)], end);
            }
        }
    }
    panel_bar(buf, r, t, &[("↑↓", "move"), ("Enter", "read it"), ("Esc", "close")]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(scope: SpecialistScope, name: &str) -> SpecialistFile {
        SpecialistFile { tool: SpecialistTool::Claude, scope, name: name.into(), description: None, path: format!("/p/{name}.md"), text: String::new(), text_cut: false }
    }

    #[test]
    fn project_files_come_before_home_ones_whatever_order_they_arrive_in() {
        let v = SpecialistsView {
            term: ClientTerm::on(MachineId::LOCAL, 1),
            title: "s".into(),
            list: Some(Ok(SpecialistList {
                term: 1,
                project: "/p".into(),
                files: vec![file(SpecialistScope::Home, "mine"), file(SpecialistScope::Project, "reviewer")],
                truncated: false,
            })),
            sel: 0,
            open: None,
            scroll: 0,
        };
        let names: Vec<&str> = v.ordered().iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["reviewer", "mine"]);
    }

    #[test]
    fn a_file_line_loses_escape_sequences_and_keeps_its_indent() {
        assert_eq!(plain("\tname: \u{1b}[2Jx"), "    name: [2Jx");
    }
}
