//! Dialogs: new agent, message an agent, settings, keys.

use super::*;

/// Models to pick from for `agent` ("default" first), or none when it has no choice.
pub(in crate::client) fn np_models(app: &App, agent: &str) -> Vec<String> {
    let q = app.cfg.quick.agents.iter().find(|q| q.name == agent);
    let list: Vec<String> = match q {
        Some(q) if !q.models.is_empty() => q.models.clone(),
        _ if agent == "claude" => maitty_shared::conversation::CLAUDE_MODEL_ALIASES.map(String::from).to_vec(),
        _ => Vec::new(),
    };
    if list.is_empty() {
        return list;
    }
    std::iter::once("default".to_string()).chain(list).collect()
}

/// The command line that starts `agent` with `model` (index into np_models) on `task`.
pub(in crate::client) fn np_command(
    app: &App,
    agent: &str,
    model: usize,
    task: &str,
) -> Option<String> {
    if agent == "shell" {
        return None;
    }
    if let Some(p) = preset_of(app, agent) {
        let m = np_models(app, &p.agent)
            .iter()
            .position(|m| *m == p.model)
            .unwrap_or(0);
        return np_command(app, &p.agent, m, &p.fill(task));
    }
    let q = app.cfg.quick.agents.iter().find(|q| q.name == agent);
    let base = q
        .map(|q| q.command.clone())
        .unwrap_or_else(|| agent.to_string());
    let task = task.trim();
    let mut cmd = if task.is_empty() {
        base.replace("{prompt}", "").trim().to_string()
    } else if base.contains("{prompt}") {
        base.replace("{prompt}", &app.cfg.quote_for_shell(task))
    } else {
        format!("{base} {}", app.cfg.quote_for_shell(task))
    };
    if let Some(m) = np_models(app, agent).get(model).filter(|_| model > 0) {
        cmd = app
            .cfg
            .with_model(&cmd, q.map_or("", |q| q.model_flag.as_str()), m);
    }
    // Without permission prompts while `[permissions.bypass]` has it on (ADR 0005).
    let cmd = app.cfg.with_bypass(agent, &cmd);
    // An account runs through `<app> account`, which gives it its own sign-in.
    Some(app.cfg.as_account(agent, &cmd))
}

pub(in crate::client) fn draw_new_pane(
    app: &mut App,
    f: &mut Frame,
    area: Rect,
    t: &Theme,
    np: &NewPaneHy,
) {
    let model = app.screen_model();
    let buf = f.buffer_mut();
    dim_all(app, buf, area, t);
    let r = panel(app, buf, area, 86, 21, "New", &[], t);
    let lab = |buf: &mut Buffer, y: u16, text: &str, row: u8| {
        put(
            buf,
            r.x + 3,
            y,
            &[seg(
                text,
                Style::default()
                    .fg(if np.row == row { t.accent } else { t.muted })
                    .bg(t.card)
                    .add_modifier(Modifier::BOLD),
            )],
            r.right(),
        );
    };
    // A row of chips; the selected one is filled. Long rows scroll to keep it in view.
    let chips = |app: &mut App,
                 buf: &mut Buffer,
                 y: u16,
                 items: &[String],
                 cur: usize,
                 mk: fn(usize) -> ScreenHit| {
        // The list can shrink under the selection (a session closed while this is open).
        let cur = cur.min(items.len().saturating_sub(1));
        let mut start = 0;
        let room = (r.right() - 2).saturating_sub(r.x + 14) as usize;
        while start < cur
            && items[start..=cur]
                .iter()
                .map(|s| s.width() + 3)
                .sum::<usize>()
                > room
        {
            start += 1;
        }
        let mut x = r.x + 14;
        if start > 0 {
            put(
                buf,
                x - 2,
                y,
                &[seg("‹", Style::default().fg(t.muted).bg(t.card))],
                r.right(),
            );
        }
        for (i, it) in items.iter().enumerate().skip(start) {
            let txt = format!(" {it} ");
            if x + txt.width() as u16 > r.right() - 2 {
                put(
                    buf,
                    r.right() - 2,
                    y,
                    &[seg("›", Style::default().fg(t.muted).bg(t.card))],
                    r.right(),
                );
                break;
            }
            let on = i == cur;
            let cr = Rect {
                x,
                y,
                width: txt.width() as u16,
                height: 1,
            };
            let st = if on {
                Style::default()
                    .bg(t.accent)
                    .fg(t.acc_ink)
                    .add_modifier(Modifier::BOLD)
            } else if hovered(app, cr) {
                Style::default().bg(t.hov).fg(t.strong)
            } else {
                Style::default().bg(t.btn).fg(t.text)
            };
            put(buf, x, y, &chip(it, st), r.right());
            hit(app, cr, mk(i));
            x += txt.width() as u16 + 1;
        }
    };
    let agents = np_agents(app, np.p);
    let agent = agents.get(np.a).cloned().unwrap_or_default();
    let muted = Style::default().fg(t.muted).bg(t.card);
    // The task: typed straight away, it's the agent's first prompt.
    lab(buf, r.y + 2, "TASK", 0);
    let tb = Rect {
        x: r.x + 14,
        y: r.y + 2,
        width: r.right().saturating_sub(r.x + 17),
        height: 1,
    };
    strip(buf, tb, t.card2);
    let s2 = Style::default().bg(t.card2);
    let shown = {
        let w = tb.width.saturating_sub(3) as usize;
        let n = np.task.chars().count();
        if n > w {
            np.task.chars().skip(n - w).collect::<String>()
        } else {
            np.task.clone()
        }
    };
    let mut ts = vec![seg(format!(" {shown}"), s2.fg(t.strong))];
    if np.row == 0 {
        ts.push(seg("█", s2.fg(t.accent)));
    }
    if np.task.is_empty() {
        let ph = match preset_of(app, &agent) {
            Some(p) if !p.asks() => format!(" (the preset says: {})", truncate(&p.prompt, 50)),
            Some(_) => " what should it do?".to_string(),
            None if agent == "shell" || agent.starts_with('⚙') => {
                " (not used for this)".to_string()
            }
            None => " what should it do? (optional)".to_string(),
        };
        ts.push(seg(ph, s2.fg(t.muted)));
    }
    put(buf, tb.x, tb.y, &ts, tb.right());
    hit(app, tb, ScreenHit::NpTask);
    lab(buf, r.y + 4, "RUN", 1);
    chips(app, buf, r.y + 4, &agents, np.a, ScreenHit::NpRun);
    lab(buf, r.y + 6, "MODEL", 2);
    let models = if agent.starts_with('★') || agent.starts_with('◇') {
        Vec::new()
    } else {
        np_models(app, &agent)
    };
    if let Some(p) = preset_of(app, &agent) {
        let m = if p.model.is_empty() {
            "its default".to_string()
        } else {
            p.model.clone()
        };
        put(
            buf,
            r.x + 14,
            r.y + 6,
            &[seg(format!("{m} (from the preset)"), muted)],
            r.right(),
        );
    } else if models.is_empty() {
        put(
            buf,
            r.x + 14,
            r.y + 6,
            &[seg("its default", muted)],
            r.right(),
        );
    } else {
        chips(
            app,
            buf,
            r.y + 6,
            &models,
            np.model.min(models.len() - 1),
            ScreenHit::NpModel,
        );
    }
    let mut projs: Vec<String> = model.iter().map(|p| p.name.clone()).collect();
    projs.push("other folder…".into());
    lab(buf, r.y + 8, "PROJECT", 3);
    chips(app, buf, r.y + 8, &projs, np.p, ScreenHit::NpProj);
    let place = np.place_for(&agent, app.cfg.worktree.per_agent);
    let proj = model.get(np.p);
    lab(buf, r.y + 10, "WHERE", 4);
    if proj.is_some_and(|p| p.git) && !agent.starts_with('⚙') {
        chips(
            app,
            buf,
            r.y + 10,
            &np_places(proj.unwrap()),
            place as usize,
            ScreenHit::NpWhere,
        );
    } else {
        put(
            buf,
            r.x + 14,
            r.y + 10,
            &[seg(
                if agent.starts_with('⚙') {
                    "as the recipe says"
                } else {
                    "in the folder"
                },
                muted,
            )],
            r.right(),
        );
    }
    lab(buf, r.y + 12, "OPEN", 5);
    chips(
        app,
        buf,
        r.y + 12,
        &["full screen".into(), "beside this".into()],
        np.beside as usize,
        ScreenHit::NpBeside,
    );

    // What will happen, in words.
    let branch = proj
        .and_then(|p| p.wts.iter().find(|w| w.main))
        .map(|w| w.branch.clone())
        .unwrap_or_default();
    let others = proj
        .and_then(|p| p.wts.iter().find(|w| w.main))
        .map(|w| w.sessions.len())
        .unwrap_or(0);
    let what = match proj {
        None => "Pick a folder; it becomes a project.".to_string(),
        Some(p) if p.git && !agent.starts_with('⚙') && place >= 3 => {
            let w = p.wts.iter().filter(|w| !w.main).nth(place as usize - 3);
            format!(
                "{agent} runs in the {} worktree, on {}.",
                w.map(|w| w.name.as_str()).unwrap_or("?"),
                w.map(|w| w.branch.as_str()).unwrap_or("?")
            )
        }
        Some(p) if p.git && !agent.starts_with('⚙') && place == 0 => format!(
            "{agent} gets its own new worktree in {}, on a new branch named for you.",
            p.name
        ),
        Some(p) if p.git && !agent.starts_with('⚙') && place == 1 => format!(
            "Switches {} to a new branch, then starts {agent} there.{}",
            p.name,
            if others > 0 {
                format!(" The {others} already running in it will be on that branch too.")
            } else {
                String::new()
            }
        ),
        Some(p) if p.git && !agent.starts_with('⚙') => {
            format!("{agent} runs in {} on {branch}.", p.name)
        }
        Some(p) if agent == "shell" => format!("A shell in {}.", p.name),
        Some(p) if agent.starts_with('⚙') => {
            let r = app
                .cfg
                .recipes
                .iter()
                .find(|r| Some(r.name.as_str()) == agent.strip_prefix("⚙ "));
            match r {
                Some(r) => format!(
                    "{}{}",
                    if r.worktree && p.git {
                        "A new worktree running "
                    } else {
                        "Runs "
                    },
                    r.run.join(" + ")
                ),
                None => String::new(),
            }
        }
        Some(p) if !p.git => format!(
            "{} isn't a git repo, so {agent} runs in the folder.",
            p.name
        ),
        Some(p) if app.cfg.worktree.per_agent => format!(
            "{agent} gets its own new worktree in {}, named for you.",
            p.name
        ),
        Some(p) => format!("{agent} runs in {}.", p.name),
    };
    let c = Style::default().bg(t.card);
    let what = match if agent.starts_with('◇') {
        None
    } else {
        np_command(app, &agent, np.model, &np.task)
    } {
        Some(cmd) if !np.task.trim().is_empty() || np.model > 0 => format!("{what}  Runs: {cmd}"),
        _ => what,
    };
    for (i, l) in crate::client::views::wrap(&what, (r.width - 6) as usize)
        .into_iter()
        .take(3)
        .enumerate()
    {
        put(
            buf,
            r.x + 3,
            r.y + 14 + i as u16,
            &[seg(l, c.fg(t.text))],
            r.right() - 2,
        );
    }
    let gx = btn(
        app,
        buf,
        r.x + 3,
        r.y + 18,
        if np.task.trim().is_empty() {
            "Open"
        } else {
            "Start"
        },
        "Enter",
        BtnKind::Primary,
        ScreenHit::NpGo,
        r.right(),
    );
    put(
        buf,
        gx + 2,
        r.y + 18,
        &hints(
            t,
            &[
                ("↑↓", "rows"),
                ("←→", "choose"),
                ("Esc", "close, keeps the task"),
            ],
        ),
        r.right(),
    );
}

// Talk ----------------------------------------------------------------------------------------

// Settings ------------------------------------------------------------------------------------

/// The spinners the settings row shows as choices (Blocks, Braille, Dots, Line); Enter opens the rest.
const SPINNER_CHOICES: usize = 4;

/// The values a settings row offers as chips, and which one is current.
pub(in crate::client) fn chips_for(app: &App, row: &SRow) -> Option<(Vec<String>, Option<usize>)> {
    use crate::client::modal::Kind;
    let SRow::Setting(s) = row else { return None };
    let cur = crate::client::modal::current(&app.cfg, s.path);
    match s.kind {
        Kind::Spinner => {
            let name = crate::config::spinner_name(&app.cfg.ui.spinner);
            let shown = &crate::config::SPINNERS[..SPINNER_CHOICES];
            Some((
                shown.iter().map(|(n, _)| n.to_string()).collect(),
                shown.iter().position(|(n, _)| *n == name),
            ))
        }
        Kind::Bool | Kind::BoolOff => {
            let on = crate::client::modal::is_on(&app.cfg, s);
            Some((
                vec!["on".into(), "off".into()],
                Some(if on { 0 } else { 1 }),
            ))
        }
        Kind::Choice(_) if super::super::modal::is_theme_row(s.path) => None,
        Kind::Choice(opts) => {
            let curs = cur
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            Some((
                opts.iter().map(|o| o.to_string()).collect(),
                opts.iter().position(|o| *o == curs),
            ))
        }
        Kind::Program(cands) => {
            let curs = cur
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            let opts = crate::client::modal::program_options(cands, &curs);
            let i = if curs.is_empty() {
                Some(0)
            } else {
                opts.iter().position(|o| *o == curs)
            };
            Some((opts, i))
        }
        _ => None,
    }
}

/// Apply a chip click: the setting row's `vi`-th value.
pub(in crate::client) fn set_chip(app: &mut App, row: &SRow, vi: usize) {
    use crate::client::modal::Kind;
    let SRow::Setting(s) = row else { return };
    let v: toml_edit::Value = match s.kind {
        Kind::Bool => (vi == 0).into(),
        Kind::BoolOff => (vi != 0).into(),
        Kind::Spinner => {
            let Some((_, frames)) = crate::config::SPINNERS.get(vi).filter(|_| vi < SPINNER_CHOICES) else {
                return;
            };
            frames.iter().copied().collect::<toml_edit::Array>().into()
        }
        Kind::Choice(opts) => match opts.get(vi) {
            Some(o) => (*o).into(),
            None => return,
        },
        Kind::Program(cands) => {
            let curs = crate::client::modal::current(&app.cfg, s.path)
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            match crate::client::modal::program_options(cands, &curs).get(vi) {
                Some(o) if o == "default" => "".into(),
                Some(o) => o.as_str().into(),
                None => return,
            }
        }
        _ => return,
    };
    app.save_setting(s.path, v);
}

/// Columns the label column of a settings page holds; no setting label is longer.
#[cfg(test)]
pub(in crate::client) const SETTINGS_LABEL_COLS: u16 = 33;

/// What is off about the versions, each a line under the section's title: a newer release, an
/// installed or daemon version that differs, a restart that waits. Returns the lines used.
pub(in crate::client) fn draw_version_notes(app: &mut App, buf: &mut Buffer, r: Rect, y0: u16, t: &Theme) -> u16 {
    let look = Look::of(&app.cfg.ui);
    let c = Style::default().bg(t.card);
    let window = env!("APP_VERSION");
    let daemon = if app.snap.daemon_version.is_empty() {
        "unknown".to_string()
    } else {
        app.snap.daemon_version.clone()
    };
    let known = daemon != "unknown";
    let mismatch = known && daemon != window;
    let host = app
        .machine
        .host()
        .map(|h| format!("Remote daemon ({h})"))
        .unwrap_or_else(|| "Running daemon".into());
    let mut used = 0u16;
    let end = r.right().saturating_sub(2);
    if let Some(next) = app.update_available.clone() {
        let y = y0 + used;
        used += 1;
        let lead = format!("↑ {} {next} is out — ", env!("APP_COMMAND"));
        let x = put(buf, r.x, y, &[seg(lead, c.fg(t.accent).add_modifier(Modifier::BOLD))], end);
        let btn = button_pill(look, t, "Update now", "", true, t.card);
        let bend = put(buf, x, y, &btn, end);
        hit(app, Rect { x, y, width: bend.saturating_sub(x).max(1), height: 1 }, ScreenHit::Update);
    }
    let mut notes: Vec<(String, Style)> = Vec::new();
    match &app.installed_version {
        Some(Ok(v)) if v != window => notes.push((format!("Installed here: {v}   This window: {window}"), c.fg(t.muted))),
        Some(Err(error)) => notes.push((format!("Installed here: unavailable ({error})"), c.fg(t.err))),
        _ => {}
    }
    if mismatch || !known {
        notes.push((format!("{host}: {daemon}"), c.fg(t.muted)));
    }
    for (text, style) in notes {
        put(buf, r.x, y0 + used, &[seg(text, style)], end);
        used += 1;
    }
    let say = |buf: &mut Buffer, y: u16, text: &str, style: Style| {
        put(buf, r.x, y, &[seg(text, style)], end);
    };
    if app.daemon_restartable() {
        let lead = "Restart pending — ";
        let y = y0 + used;
        used += 1;
        say(buf, y, lead, c.fg(t.accent).add_modifier(Modifier::BOLD));
        let x = r.x + lead.width() as u16;
        let btn = button_pill(look, t, "Restart now", "R", true, t.card);
        let bend = put(buf, x, y, &btn, end);
        hit(app, Rect { x, y, width: bend.saturating_sub(x).max(1), height: 1 }, ScreenHit::Restart);
        put(buf, bend, y, &[seg("  or when all sessions close", c.fg(t.muted))], end);
    } else if app.restart_pending() {
        let note = if app.machine.is_remote() {
            "Remote daemon differs — update it on its host after its sessions are closed."
        } else {
            "Restart pending — waiting until all sessions are closed."
        };
        say(buf, y0 + used, note, c.fg(t.accent).add_modifier(Modifier::BOLD));
        used += 1;
    }
    used
}

/// `text` on up to two lines of `width` columns, broken at spaces; the second ends in `…` if cut.
pub(in crate::client) fn wrap_two(text: &str, width: usize) -> Vec<String> {
    let mut lines = vec![String::new()];
    for word in text.split_whitespace() {
        let Some(line) = lines.last_mut() else { break };
        if line.is_empty() || line.width() + 1 + word.width() <= width {
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        } else if lines.len() < 2 {
            lines.push(word.to_string());
        } else {
            return vec![
                std::mem::take(&mut lines[0]),
                truncate(&format!("{} {word}", lines[1]), width),
            ];
        }
    }
    lines
}
