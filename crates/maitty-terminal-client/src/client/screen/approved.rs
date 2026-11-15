//! Approved commands (Settings › Agents › PERMISSIONS): the commands a person let a chat run
//! "always in this project", as this computer's daemon keeps them (`Query::AllowedCommands`), and
//! the way to take one back (`Command::ForgetAllowedCommand`). Nothing is approved from here:
//! approving happens only where the chat asks.

use super::*;
use crate::hidden::sanitize;
use crate::protocol::{AllowedCommand, ClientMsg, Query};

const WIDTH: u16 = 96;
const HEIGHT: u16 = 24;

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct ApprovedView {
    /// What the daemon listed; None while it is asked.
    pub(in crate::client) list: Option<Vec<AllowedCommand>>,
    pub(in crate::client) sel: usize,
    /// The chosen command is being asked about before it is forgotten.
    pub(in crate::client) confirming: bool,
    /// Said in place of the list: the daemon is too old to keep any.
    pub(in crate::client) refused: Option<String>,
}

/// The list as it is drawn: by project, then newest first, so a project's commands sit together.
fn ordered(list: &[AllowedCommand]) -> Vec<AllowedCommand> {
    let mut list = list.to_vec();
    list.sort_by(|a, b| a.project.cmp(&b.project).then(b.at.cmp(&a.at)));
    list
}

impl App {
    /// Open the list and ask this computer's daemon for it.
    pub(in crate::client) fn open_approved(&mut self) {
        let ask = ClientMsg::Query(Query::AllowedCommands);
        let refused = (ask.introduced_in() > self.local_protocol)
            .then(|| "Restart the service to list approved commands.".to_string());
        if refused.is_none() {
            self.send(MachineId::LOCAL, ask);
        }
        self.mode = Mode::Approved(Box::new(ApprovedView {
            list: None,
            sel: 0,
            confirming: false,
            refused,
        }));
    }

    pub(in crate::client) fn approved_arrived(&mut self, list: Vec<AllowedCommand>) {
        if let Mode::Approved(v) = &mut self.mode {
            let list = ordered(&list);
            v.sel = v.sel.min(list.len().saturating_sub(1));
            v.list = Some(list);
            self.dirty = true;
        }
    }

    pub(in crate::client) fn on_approved_key(&mut self, mut v: ApprovedView, k: &KeyEvent) {
        let list = v.list.clone().unwrap_or_default();
        if v.confirming {
            v.confirming = false;
            if k.code == KeyCode::Enter {
                if let Some(c) = list.get(v.sel) {
                    self.forget_approved(&mut v, c.clone());
                }
            }
            self.mode = Mode::Approved(Box::new(v));
            return;
        }
        match k.code {
            KeyCode::Esc | KeyCode::Char('q') => return self.mode = Mode::Normal,
            KeyCode::Char('x') | KeyCode::Delete if v.sel < list.len() => v.confirming = true,
            _ => {
                Self::list_move(&mut v.sel, list.len(), k);
            }
        }
        self.mode = Mode::Approved(Box::new(v));
    }

    /// Forget one, then ask for the list again so it shows what the daemon kept.
    fn forget_approved(&mut self, v: &mut ApprovedView, c: AllowedCommand) {
        self.cmd(Command::ForgetAllowedCommand {
            project: c.project.clone(),
            command_sha256: c.command_sha256.clone(),
        });
        self.send(MachineId::LOCAL, ClientMsg::Query(Query::AllowedCommands));
        if let Some(list) = &mut v.list {
            list.retain(|x| x.command_sha256 != c.command_sha256 || x.project != c.project);
            v.sel = v.sel.min(list.len().saturating_sub(1));
        }
        let shown = truncate(&sanitize(&c.command, false), 40);
        self.notify(format!("forgot {shown}: the chat asks again next time"), false);
    }
}

pub(in crate::client) fn approved_keys(v: &ApprovedView) -> Vec<(&'static str, &'static str)> {
    if v.confirming {
        return vec![("Enter", "forget it"), ("Esc", "keep it")];
    }
    let any = v.list.as_ref().is_some_and(|l| !l.is_empty());
    let mut keys = Vec::new();
    if any {
        keys.extend([("↑↓", "move"), ("x", "forget")]);
    }
    keys.push(("Esc", "close"));
    keys
}

pub(in crate::client) fn draw_approved(app: &mut App, f: &mut Frame, area: Rect, t: &Theme, v: &ApprovedView) {
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let r = panel(app, buf, area, WIDTH, HEIGHT, "approved commands", &[], t);
    let ground = Style::default().bg(t.card);
    let (x, end) = (r.x + 3, r.right().saturating_sub(3));
    let mut y = r.y + 2;
    let intro = "Commands you let a chat run “always in this project”. Forget one and the chat asks again.";
    for line in wrap_two(intro, usize::from(end - x)) {
        put(buf, x, y, &[seg(line, ground.fg(t.muted))], end);
        y += 1;
    }
    y += 1;
    let bar_y = r.bottom().saturating_sub(2);
    let list = match (&v.list, &v.refused) {
        (_, Some(why)) => {
            put(buf, x, y, &[seg(why.as_str(), ground.fg(t.muted))], end);
            return panel_bar(buf, r, t, &approved_keys(v));
        }
        (None, None) => {
            put(buf, x, y, &[seg("asking this computer…", ground.fg(t.muted))], end);
            return panel_bar(buf, r, t, &approved_keys(v));
        }
        (Some(list), None) => list,
    };
    if list.is_empty() {
        put(buf, x, y, &[seg("None yet. A chat's “always in this project” adds one here.", ground.fg(t.muted))], end);
        return panel_bar(buf, r, t, &approved_keys(v));
    }
    // Each project's heading, then its rows; the view follows the chosen row.
    let mut lines: Vec<(Option<usize>, String)> = Vec::new();
    let mut last: Option<&Path> = None;
    for (i, c) in list.iter().enumerate() {
        if last != Some(c.project.as_path()) {
            lines.push((None, super::super::design::tilde(&c.project)));
            last = Some(c.project.as_path());
        }
        lines.push((Some(i), sanitize(&c.command, false)));
    }
    let room = usize::from(bar_y.saturating_sub(y + 2));
    let at = lines.iter().position(|(i, _)| *i == Some(v.sel)).unwrap_or(0);
    let skip = (at + 1).saturating_sub(room);
    for (i, text) in lines.iter().skip(skip).take(room) {
        match i {
            None => {
                put(buf, x, y, &[seg(truncate(&sanitize(text, false), usize::from(end - x)), ground.fg(t.muted).add_modifier(Modifier::BOLD))], end);
            }
            Some(i) => {
                let on = *i == v.sel;
                let row = if on { Style::default().bg(t.hov) } else { ground };
                if on {
                    fill(buf, Rect { x: x - 1, y, width: end - x + 2, height: 1 }, t.hov);
                    put(buf, x - 1, y, &[seg("▎", row.fg(t.accent))], end);
                }
                let when = format!("approved {} ago", age(list[*i].at));
                let right = when.width() as u16;
                let text_end = end.saturating_sub(right + 2);
                let ink = if on && v.confirming { t.err } else { t.strong };
                put(buf, x + 2, y, &[seg(truncate(text, usize::from(text_end.saturating_sub(x + 2))), row.fg(ink))], text_end);
                put(buf, end.saturating_sub(right), y, &[seg(when, row.fg(t.muted))], end);
            }
        }
        y += 1;
    }
    if v.confirming {
        let ask = "Forget this command? The chat asks again before it runs it.";
        put(buf, x, bar_y.saturating_sub(1), &[seg(ask, ground.fg(t.err).add_modifier(Modifier::BOLD))], end);
    }
    panel_bar(buf, r, t, &approved_keys(v));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn approved(project: &str, command: &str, at: u64) -> AllowedCommand {
        AllowedCommand {
            project: PathBuf::from(project),
            command: command.into(),
            command_sha256: format!("sha-{command}"),
            at,
        }
    }

    #[test]
    fn the_list_groups_by_project_newest_first() {
        let list = ordered(&[
            approved("/b", "make", 1),
            approved("/a", "npm test", 1),
            approved("/a", "npm run lint", 5),
        ]);
        let shown: Vec<&str> = list.iter().map(|c| c.command.as_str()).collect();
        assert_eq!(shown, ["npm run lint", "npm test", "make"]);
    }
}
