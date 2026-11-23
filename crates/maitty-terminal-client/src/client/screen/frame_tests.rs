//! The frame set beside the reference frames:
//! the grid, the pane's title strip and right-hand mark, corners, where a sheet goes, the
//! modal and popover frames, and the pointer's tint. Sidebar rows, sheet and modal contents
//! and the pane's own terminal text belong to other screens and are left out.
use super::*;
use crate::client::reference_fixture::{self, Stage};
use crate::layout::Node;
use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::Terminal;
use ratatui::backend::TestBackend;

/// The reference's world with fix-footer's session in two tabs, as the reference draws it.
fn world(stage: Stage) -> App {
    let mut app = reference_fixture::world(stage);
    let owner = app.screen.tabs[app.screen.tab].owner;
    app.screen.tabs.push(ScreenTab {
        layout: Node::Leaf(2),
        focus: ClientTerm::local(2),
        owner,
        used: 0,
        name: String::new(),
        broadcast: false,
    });
    app
}

#[test]
fn a_confirm_s_long_sub_is_cut_inside_its_title_chip() {
    use crate::config::Rounding;
    for rounded in [Rounding::Full, Rounding::Corners, Rounding::Off] {
        let at = format!("{rounded:?}");
        let mut app = world(Stage::None);
        app.cfg.ui.rounded = rounded;
        app.mode = Mode::Confirm(Box::new(super::super::menu::Confirm {
            title: "changes".into(),
            sub: "a-folder-with-a-very-long-name-that-runs-far-past-the-header-of-this-confirm"
                .into(),
            what: "Not a git repository".into(),
            detail: String::new(),
            note: String::new(),
            list: Vec::new(),
            yes: "Init".into(),
            key: '\n',
            danger: false,
            act: super::super::menu::Act::RestartDaemon,
        }));
        let buf = drawn_in(&mut app, "cards");
        let close = app
            .hits
            .iter()
            .rev()
            .find(|(_, h)| *h == Hit::Screen(ScreenHit::Close))
            .map(|(r, _)| *r)
            .expect("the Esc chip");
        let (x0, x1) = ((160 - 58) / 2, (160 - 58) / 2 + 58);
        let row: Vec<String> = (x0..x1)
            .map(|x| buf[(x, close.y)].symbol().to_string())
            .collect();
        let caps = rounded == Rounding::Full;
        let (l, e) = if caps { (CAP_L, CAP_R) } else { ("", "") };
        let last = if caps { CAP_R } else { " " };
        let tl = if rounded == Rounding::Off {
            "┌"
        } else {
            "╭"
        };
        let text = row.concat();
        assert!(
            text.starts_with(&format!("{tl}─{l} changes · a-folder")),
            "{at}: {text}"
        );
        let tr = if rounded == Rounding::Off { "┐" } else { "╮" };
        assert!(text.ends_with(&format!("─{l} × {e}{tr}")), "{at}: {text}");
        let esc = close.x - x0;
        assert_eq!(
            (
                row[esc as usize - 3].as_str(),
                row[esc as usize - 2].as_str()
            ),
            (last, "─"),
            "{at}: the title chip ends whole before the close chip: {text}"
        );
        assert!(text.contains('…'), "{at}: the sub is cut: {text}");
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: close.x + 2,
                row: close.y,
                modifiers: KeyModifiers::NONE,
            });
        }
        assert!(
            !matches!(app.mode, Mode::Confirm(_)),
            "{at}: the close chip closes it"
        );
    }
}

/// A modal too narrow for the Esc chip beside its title drops the chip rather than draw it
/// over the corner and the title.
#[test]
fn a_modal_too_narrow_for_its_esc_chip_keeps_its_corner_and_title() {
    let mut app = world(Stage::None);
    app.cfg.ui.rounded = crate::config::Rounding::Full;
    let t = app.theme.clone();
    let mut buf = Buffer::empty(Rect::new(0, 0, 20, 6));
    let r = panel_at(&mut app, &mut buf, Rect::new(2, 1, 6, 4), "NEW", &[], &t);
    let row: String = (r.x..r.right())
        .map(|x| buf[(x, r.y)].symbol().to_string())
        .collect();
    assert!(
        row.starts_with("╭─") && row.ends_with("─╮") && !row.contains('×'),
        "{row}"
    );
    assert!(
        !app.hits
            .iter()
            .any(|(_, h)| *h == Hit::Screen(ScreenHit::Close)),
        "nothing to click: Esc closes it"
    );
}


/// The world drawn at 160×45 in `[ui] layout` `layout` (Grid included, which the reference has not).
fn drawn_in(app: &mut App, layout: &str) -> Buffer {
    (app.cfg.ui.layout, app.cfg.ui.panes) = (layout.into(), "floating".into());
    app.screen_fresh();
    let mut term = Terminal::new(TestBackend::new(160, 45)).expect("a test terminal");
    term.draw(|f| crate::client::render::draw(app, f))
        .expect("a frame");
    term.backend().buffer().clone()
}
