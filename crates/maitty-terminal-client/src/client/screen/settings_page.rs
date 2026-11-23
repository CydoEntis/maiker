//! Settings as a full window: a 20-column list of pages at the left, the chosen page's rows at the
//! right (a label and a dim description at the left of each, its control at the right). Docs: UI.md,
//! "Settings screen".

use super::*;
use crate::client::design::{self, control, segmented, switch};
use crate::client::modal::{Cat, Kind};

/// The page list's width, its rule included.
const PAGES_W: u16 = 20;
/// Narrower than this, the screen asks for a wider window instead of squeezing the rows.
const MIN_W: u16 = 56;
const MIN_H: u16 = 12;
/// The most columns a row of segments takes before the control falls back to `‹ value ›`.
const SEGMENTS_MAX_W: usize = 44;
/// The most choices drawn as segments.
const SEGMENTS_MAX: usize = 4;
/// The least room the words at the left of a row keep.
const WORDS_MIN_W: usize = 24;

impl App {
    /// The rows of a page. Machines depend on the configuration, so they are listed here and
    /// not in `design::settings_rows`.
    pub(in crate::client) fn settings_page_rows(&self, cat: Cat) -> Vec<SRow> {
        if cat != Cat::Machines {
            return design::settings_rows(cat);
        }
        let mut names: Vec<&str> = self.cfg.machines.iter().map(|m| m.name.as_str()).collect();
        names.sort_by_key(|n| n.to_lowercase());
        std::iter::once(SRow::Machine(None))
            .chain(names.into_iter().map(|n| SRow::Machine(Some(n.to_string()))))
            .collect()
    }

    /// The machine a Machines row stands for, when it is a remote one.
    pub(in crate::client) fn machine_named(&self, name: &str) -> Option<MachineId> {
        self.remotes
            .iter()
            .find(|(_, r)| r.name.eq_ignore_ascii_case(name))
            .map(|(id, _)| *id)
    }

    /// `u` on a machine's row: the fix its app needs, when it needs one.
    pub(in crate::client) fn update_machine_named(&mut self, name: &str) {
        if let Some(id) = self.machine_named(name).filter(|id| self.machine_fix(*id).is_some()) {
            self.machine_update_from_side(id);
        }
    }

    /// `i` installs what was found and `r` restarts to finish it, on any page. True when it was one
    /// of them and had something to do.
    pub(in crate::client) fn settings_update_key(&mut self, k: &KeyEvent) -> bool {
        if k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) {
            return false;
        }
        match k.code {
            KeyCode::Char('i') if self.update_available.is_some() && !self.restart_needed() => {
                self.act(Action::Update);
                true
            }
            KeyCode::Char('r') if self.restart_needed() => {
                self.ask_restart();
                true
            }
            _ => false,
        }
    }

    /// Keys while the page list has them: up and down choose a page, enter, right or tab go into
    /// its rows. False closes Settings.
    pub(in crate::client) fn on_settings_page_key(&mut self, v: &mut SettingsView, k: &KeyEvent) -> bool {
        let last = Cat::ALL.len() - 1;
        match k.code {
            KeyCode::Esc => return false,
            KeyCode::Up | KeyCode::Char('k') => v.cat = v.cat.saturating_sub(1),
            KeyCode::Down | KeyCode::Char('j') => v.cat = (v.cat + 1).min(last),
            KeyCode::BackTab => v.cat = v.cat.saturating_sub(1),
            KeyCode::Enter | KeyCode::Right | KeyCode::Char('l') | KeyCode::Tab => {
                v.in_rows = true;
                v.sel = 0;
                return true;
            }
            KeyCode::Char('o') => {
                self.open_outside(crate::config::config_path(), "config.toml".into());
            }
            KeyCode::Char('u') => self.act(Action::CheckUpdate),
            KeyCode::Char('R') => self.ask_restart(),
            _ => {
                self.settings_update_key(k);
                return true;
            }
        }
        v.sel = 0;
        true
    }
}

/// What a choice is called on screen: the design's words for the few that differ from the stored ones.
fn option_label(path: &str, option: &str) -> String {
    match (path, option) {
        ("ui.rounded", "off") => "Square".into(),
        ("ui.rounded", "corners") => "Rounded".into(),
        ("ui.rounded", "full") => "Pills".into(),
        ("appearance", o) | ("sessions.agent", o) if o != "last used" => capitalised(o),
        ("ui.spinner", o) => o.split(" (").next().unwrap_or(o).to_string(),
        _ => option.to_string(),
    }
}

fn capitalised(word: &str) -> String {
    let mut chars = word.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().collect::<String>() + chars.as_str())
        .unwrap_or_default()
}

fn row_label(row: &SRow) -> String {
    match row {
        SRow::Setting(s) => s.label.to_string(),
        SRow::Bind { label, .. } => label.to_string(),
        SRow::Agent(row) => row.label().to_string(),
        SRow::Version => env!("APP_NAME").to_string(),
        SRow::Machine(Some(name)) => name.clone(),
        SRow::Machine(None) => "This computer".to_string(),
    }
}

/// The dim words under a row's label.
fn row_desc(app: &App, row: &SRow) -> String {
    match row {
        SRow::Setting(s) => s.help.to_string(),
        SRow::Bind { acts, .. } if acts.len() > 1 => "Several keys; change them in the config file (o).".into(),
        SRow::Bind { .. } => "Enter, then press the new key.".into(),
        SRow::Agent(a @ (design::AgentRow::Claude | design::AgentRow::Codex)) => {
            let dir = if *a == design::AgentRow::Claude { ".claude" } else { ".codex" };
            format!("~/{dir} · {}", a.help())
        }
        SRow::Agent(row) => row.help().to_string(),
        SRow::Version => concat!("u looks for a newer ", env!("APP_COMMAND"), " now; i installs one that was found; r restarts to finish.").into(),
        SRow::Machine(None) => format!("{} {}", env!("APP_NAME"), env!("APP_VERSION")),
        SRow::Machine(Some(name)) => machine_desc(app, name),
    }
}

/// `ssh <target> · Maiker <version>`, and that it is older when the connection says so.
fn machine_desc(app: &App, name: &str) -> String {
    let target = app
        .cfg
        .machines
        .iter()
        .find(|m| m.name == *name)
        .map(|m| m.target.clone())
        .unwrap_or_default();
    let id = app.machine_named(name);
    let version = id
        .and_then(|id| app.remotes.get(&id))
        .map(|r| r.snap.daemon_version.clone())
        .filter(|v| !v.is_empty());
    let mut desc = format!("ssh {}", crate::hidden::sanitize(&target, false));
    if let Some(v) = version {
        desc.push_str(&format!(" · {} {v}", env!("APP_NAME")));
    }
    if id.and_then(|id| app.machine_fix(id)) == Some(machine_group::AppFix::Update) {
        desc.push_str(" · older than this computer");
    }
    desc
}

/// A row's control: what is drawn, and the regions a click lands on (offset, width, value index).
struct Control {
    segs: Vec<Seg>,
    clicks: Vec<(u16, u16, usize)>,
}

impl Control {
    fn whole(segs: Vec<Seg>, value: usize) -> Control {
        let w = segs_width(&segs);
        Control { segs, clicks: vec![(0, w, value)] }
    }
}

fn row_control(app: &App, t: &Theme, row: &SRow, v: &SettingsView, selected: bool) -> Control {
    if let SRow::Machine(m) = row {
        return Control::whole(machine_control(app, t, m.as_deref()), usize::MAX);
    }
    let editing = selected && v.editing.is_some();
    if let (SRow::Setting(s), Some((opts, cur)), false) = (row, chips_for(app, row), editing) {
        let next = (cur.unwrap_or(0) + 1) % opts.len().max(1);
        if matches!(s.kind, Kind::Bool | Kind::BoolOff) {
            return Control::whole(switch(t, cur == Some(0)), next);
        }
        let labels: Vec<String> = opts.iter().map(|o| option_label(s.path, o)).collect();
        let width: usize = labels.iter().map(|l| l.width() + 2).sum();
        if labels.len() <= SEGMENTS_MAX && width <= SEGMENTS_MAX_W && (cur.is_some() || s.kind != Kind::Spinner) {
            return segments(app, t, s.kind, &labels, cur);
        }
        return Control::whole(control(app, t, row, v, selected), next);
    }
    Control::whole(control(app, t, row, v, selected), usize::MAX)
}

fn segments(app: &App, t: &Theme, kind: Kind, labels: &[String], cur: Option<usize>) -> Control {
    let mut segs = Vec::new();
    // The spinner moves in its own row, so a choice shows what it will look like in use.
    let lead = if kind == Kind::Spinner {
        crate::client::render::spinner_preview(app) + "  "
    } else {
        String::new()
    };
    if !lead.is_empty() {
        segs.push(seg(lead.clone(), Style::default().fg(t.accent)));
    }
    let mut at = lead.width() as u16;
    let mut clicks = Vec::new();
    for (i, s) in segmented(t, labels, cur).into_iter().enumerate() {
        let w = s.0.width() as u16;
        clicks.push((at, w, i));
        at += w;
        segs.push(s);
    }
    Control { segs, clicks }
}

/// A machine's line: its connection and, when its app needs it, the key that fixes it.
fn machine_control(app: &App, t: &Theme, name: Option<&str>) -> Vec<Seg> {
    let ok = Style::default().fg(t.done);
    let Some(name) = name else {
        return vec![seg("● online", ok)];
    };
    let rows = app.machine_rows(t);
    let Some(row) = rows.iter().find(|r| r.name == name) else {
        return Vec::new();
    };
    let mut out = vec![seg(format!("{} {}", row.glyph, row.word), Style::default().fg(row.color))];
    if let Some(fix) = row.fix {
        let key = Style::default().fg(t.accent).add_modifier(Modifier::BOLD);
        out.push(seg("   ", Style::default()));
        out.push(seg("u", key));
        out.push(seg(format!(" {} {name}", fix.verb()), Style::default().fg(t.muted)));
    }
    out
}

/// What the screen is made of, top to bottom: a heading over a group of rows, or a row.
enum Item {
    Head(&'static str),
    Row(usize),
}

impl Item {
    fn height(&self, heights: &[u16]) -> u16 {
        match self {
            Item::Head(_) => 2,
            Item::Row(i) => heights[*i],
        }
    }
}

fn items(rows: &[SRow]) -> Vec<Item> {
    let mut out = Vec::new();
    let mut last = "";
    for (i, row) in rows.iter().enumerate() {
        let g = design::settings_group(row);
        if g != last && !g.is_empty() {
            out.push(Item::Head(g));
        }
        last = g;
        out.push(Item::Row(i));
    }
    out
}

/// The first item to draw so that item `at` is in view in `room` rows, with as much above it as fits.
fn first_in_view(items: &[Item], heights: &[u16], at: usize, room: u16) -> usize {
    let mut start = at;
    let mut used = items[at].height(heights);
    while start > 0 && used + items[start - 1].height(heights) <= room {
        start -= 1;
        used += items[start].height(heights);
    }
    start
}

/// Settings: the pages down the left and the chosen page's rows beside them.
pub(in crate::client) fn draw_settings_screen(app: &mut App, buf: &mut Buffer, area: Rect, t: &Theme) {
    let Mode::ScreenSettings(view) = &app.mode else {
        return;
    };
    let v = (**view).clone();
    fill(buf, area, t.bg);
    hit(app, area, ScreenHit::SettingsBody);
    if area.width < MIN_W || area.height < MIN_H {
        let msg = if area.width < MIN_W { "Make the window wider" } else { "Make the window taller" };
        put(buf, area.x + 2, area.y + 1, &[seg(msg, Style::default().fg(t.muted).bg(t.bg))], area.right());
        return;
    }
    draw_title(buf, area, t);
    let body = Rect { y: area.y + 2, height: area.height - 2, ..area };
    draw_pages(app, buf, body, t, &v);
    let cat = Cat::ALL[v.cat.min(Cat::ALL.len() - 1)];
    let right = Rect {
        x: body.x + PAGES_W + 2,
        width: body.width.saturating_sub(PAGES_W + 4),
        ..body
    };
    if cat == Cat::Check {
        let page = Rect { x: right.x.saturating_sub(3), width: right.width + 3, ..body };
        return super::check_settings::draw_page(app, buf, page, right.y, t);
    }
    ask_agent_state(app, cat);
    let notes = if cat == Cat::About { draw_version_notes(app, buf, right, right.y, t) } else { 0 };
    draw_rows(app, buf, Rect { y: right.y + notes, height: right.height.saturating_sub(notes), ..right }, t, &v, cat);
}

fn draw_title(buf: &mut Buffer, area: Rect, t: &Theme) {
    let ground = Style::default().bg(t.bg);
    put(buf, area.x + 2, area.y, &[seg("Settings", ground.fg(t.strong).add_modifier(Modifier::BOLD))], area.right());
    let saved = format!("saved to {}", tilde(&crate::config::config_path()));
    let x = area.right().saturating_sub(2 + saved.width() as u16);
    if x > area.x + 14 {
        put(buf, x, area.y, &[seg(saved, ground.fg(t.muted))], area.right());
    }
    hline(buf, area.x, area.y + 1, area.width, t, t.bg);
}

fn draw_pages(app: &mut App, buf: &mut Buffer, body: Rect, t: &Theme, v: &SettingsView) {
    let mut y = body.y;
    for (i, cat) in Cat::ALL.iter().enumerate() {
        if i == Cat::DESIGNED {
            // The pages the design does not list sit under a short rule.
            hline(buf, body.x + 2, y, PAGES_W - 5, t, t.bg);
            y += 1;
        }
        if y >= body.bottom() {
            break;
        }
        let row = Rect { x: body.x, y, width: PAGES_W - 1, height: 1 };
        let on = i == v.cat;
        let bg = match (on, v.in_rows) {
            (true, false) => t.selection_bg,
            (true, true) => t.hov,
            _ => t.bg,
        };
        fill(buf, row, bg);
        let st = Style::default().bg(bg);
        if on && !v.in_rows {
            put(buf, row.x, y, &[seg("▎", st.fg(t.accent))], row.x + 1);
        }
        let name = if on { st.fg(t.strong).add_modifier(Modifier::BOLD) } else { st.fg(t.text) };
        put(buf, row.x + 2, y, &[seg(cat.label(), name)], row.right());
        hit(app, row, ScreenHit::SetTab(i));
        y += 1;
    }
    for y in body.top()..body.bottom() {
        put(buf, body.x + PAGES_W - 1, y, &[seg("│", Style::default().fg(t.line).bg(t.bg))], body.x + PAGES_W);
    }
}

/// Which hooks an agent has is read once, in the background, when Agents first shows.
fn ask_agent_state(app: &mut App, cat: Cat) {
    if cat != Cat::Agents {
        return;
    }
    if !app.claude_hooks_asked {
        app.claude_hooks_asked = true;
        app.spawn_bg(|| {
            let installed = crate::cli::claude_status_hooks_installed();
            crate::client::Bg::Then(Box::new(move |app: &mut App| app.claude_hooks = Some(installed)))
        });
    }
    if !app.codex_hooks_asked {
        app.codex_hooks_asked = true;
        app.spawn_bg(|| {
            let state = crate::cli::codex_hooks_state();
            crate::client::Bg::Then(Box::new(move |app: &mut App| app.codex_hooks = Some(state)))
        });
    }
}

fn draw_rows(app: &mut App, buf: &mut Buffer, right: Rect, t: &Theme, v: &SettingsView, cat: Cat) {
    let rows = app.settings_page_rows(cat);
    if rows.is_empty() {
        put(buf, right.x, right.y, &[seg("Nothing to change here.", Style::default().fg(t.muted).bg(t.bg))], right.right());
        return;
    }
    let sel = v.sel.min(rows.len() - 1);
    let controls: Vec<Control> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| row_control(app, t, r, v, v.in_rows && i == sel))
        .collect();
    let words: Vec<Vec<String>> = rows
        .iter()
        .zip(&controls)
        .map(|(r, c)| {
            let w = (right.width as usize).saturating_sub(segs_width(&c.segs) as usize + 3).max(WORDS_MIN_W);
            super::service::wrap(&row_desc(app, r), w)
        })
        .collect();
    // A label, its description lines, and a blank row after.
    let heights: Vec<u16> = words.iter().map(|w| 2 + w.len() as u16).collect();
    let list = items(&rows);
    let at = list.iter().position(|i| matches!(i, Item::Row(r) if *r == sel)).unwrap_or(0);
    let mut y = right.y;
    for item in list.iter().skip(first_in_view(&list, &heights, at, right.height)) {
        if y + item.height(&heights) > right.bottom() + 1 {
            break;
        }
        match item {
            Item::Head(g) => {
                let ground = Style::default().bg(t.bg);
                let end = put(buf, right.x, y, &[seg(*g, ground.fg(t.muted).add_modifier(Modifier::BOLD)), seg(" ", ground)], right.right());
                hline(buf, end, y, right.right().saturating_sub(end), t, t.bg);
            }
            Item::Row(i) => {
                let focused = v.in_rows && *i == sel;
                draw_row(app, buf, Rect { y, height: heights[*i] - 1, ..right }, t, (&rows[*i], &words[*i], &controls[*i]), (*i, focused));
            }
        }
        y += item.height(&heights);
    }
}

/// One row: its label and words at the left, its control at the right. `line` is the row, its
/// description lines and its control; `at` is its place in the page and whether it has the keys.
fn draw_row(app: &mut App, buf: &mut Buffer, r: Rect, t: &Theme, line: (&SRow, &[String], &Control), at: (usize, bool)) {
    let (row, words, control) = line;
    let (i, focused) = at;
    let bg = if focused { t.hov } else { t.bg };
    let ground = Style::default().bg(bg);
    // The selected row's ground reaches a column past the words on each side.
    let wide = Rect { x: r.x.saturating_sub(1), width: r.width + 2, ..r };
    fill(buf, wide, bg);
    let label = if focused { ground.fg(t.strong).add_modifier(Modifier::BOLD) } else { ground.fg(t.text) };
    put(buf, r.x, r.y, &[seg(row_label(row), label)], r.right());
    for (k, line) in words.iter().enumerate() {
        put(buf, r.x, r.y + 1 + k as u16, &[seg(line.clone(), ground.fg(t.muted))], r.right());
    }
    let cw = segs_width(&control.segs);
    let cx = r.right().saturating_sub(cw);
    let styled: Vec<Seg> = control
        .segs
        .iter()
        .map(|(x, s)| (x.clone(), if s.bg.is_none() { s.bg(bg) } else { *s }))
        .collect();
    put(buf, cx, r.y, &styled, r.right());
    hit(app, Rect { height: 2, width: r.width.saturating_sub(cw + 1), ..r }, ScreenHit::SetRow(i));
    for (off, w, value) in &control.clicks {
        let region = Rect { x: cx + off, y: r.y, width: (*w).max(1), height: 1 };
        hit(app, region, ScreenHit::SetVal(i, *value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::modal;
    use crate::client::reference_fixture::{Stage, world};
    use ratatui::{Terminal, backend::TestBackend};

    fn press(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn frame(app: &mut App, w: u16, h: u16) -> String {
        let mut term = Terminal::new(TestBackend::new(w, h)).expect("a test terminal");
        term.draw(|f| crate::client::render::draw(app, f)).expect("a frame");
        let buf = term.backend().buffer().clone();
        let text = (0..h)
            .map(|y| (0..w).map(|x| buf[(x, y)].symbol()).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("{text}");
        }
        text
    }

    fn settings_on(cat: Cat) -> App {
        let mut app = world(Stage::None);
        app.act(Action::Settings);
        let Mode::ScreenSettings(v) = &mut app.mode else {
            panic!("Settings is open")
        };
        v.cat = Cat::ALL.iter().position(|c| *c == cat).expect("a page");
        app
    }

    #[test]
    fn the_keys_go_pages_then_rows_and_esc_goes_back_before_it_closes() {
        let mut app = world(Stage::None);
        app.act(Action::Settings);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.cat == 0 && !v.in_rows));
        press(&mut app, KeyCode::Down);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.cat == 1 && !v.in_rows));
        press(&mut app, KeyCode::Enter);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.in_rows && v.sel == 0));
        press(&mut app, KeyCode::Down);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.sel == 1));
        press(&mut app, KeyCode::Esc);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if !v.in_rows && v.cat == 1));
        press(&mut app, KeyCode::Right);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.in_rows), "right goes in too");
        press(&mut app, KeyCode::Esc);
        press(&mut app, KeyCode::Esc);
        assert_eq!(app.mode, Mode::Normal);
    }

    #[test]
    fn tab_from_the_page_list_goes_into_the_rows() {
        let mut app = settings_on(Cat::General);
        press(&mut app, KeyCode::Tab);
        assert!(matches!(&app.mode, Mode::ScreenSettings(v) if v.in_rows));
    }

    #[test]
    fn ctrl_comma_on_the_sidebar_opens_settings() {
        let mut app = world(Stage::None);
        app.mode = Mode::Side;
        app.on_side_key(&KeyEvent::new(KeyCode::Char(','), KeyModifiers::CONTROL));
        assert!(matches!(app.mode, Mode::ScreenSettings(_)));
    }

    #[test]
    fn reduce_motion_is_on_when_the_motion_flag_is_off() {
        let s = modal::SETTINGS.iter().find(|s| s.path == "ui.motion").expect("the motion setting");
        let mut cfg = crate::config::Config::default();
        cfg.ui.motion = true;
        assert!(!modal::is_on(&cfg, s));
        cfg.ui.motion = false;
        assert!(modal::is_on(&cfg, s));
        assert_eq!(modal::display(&cfg, s), "on");
    }

    #[test]
    fn machines_lists_this_computer_then_each_machine_with_its_ssh_target() {
        let mut app = settings_on(Cat::Machines);
        app.cfg = toml::from_str("[[machines]]\nname = \"devbox\"\ntarget = \"me@devbox\"\n").expect("a config");
        let rows = app.settings_page_rows(Cat::Machines);
        assert_eq!(rows.len(), 2);
        assert!(matches!(&rows[1], SRow::Machine(Some(n)) if n == "devbox"));
        let page = frame(&mut app, 120, 40);
        assert!(page.contains("This computer") && page.contains("devbox") && page.contains("ssh me@devbox"), "{page}");
    }

    #[test]
    fn about_is_the_only_page_with_the_version_and_i_installs_only_what_was_found() {
        let mut app = settings_on(Cat::About);
        assert!(!app.settings_update_key(&KeyEvent::new(KeyCode::Char('i'), KeyModifiers::NONE)));
        app.update_available = Some("9.9.9".into());
        let page = frame(&mut app, 120, 40);
        assert!(page.contains("9.9.9 is ready") && page.contains("i install"), "{page}");
        let general = {
            let mut app = settings_on(Cat::General);
            frame(&mut app, 120, 40)
        };
        assert!(!general.contains(env!("APP_VERSION")), "{general}");
    }

    #[test]
    fn a_window_too_narrow_for_the_rows_asks_for_a_wider_one() {
        let mut app = settings_on(Cat::General);
        assert!(frame(&mut app, 48, 20).contains("Make the window wider"));
    }
}
