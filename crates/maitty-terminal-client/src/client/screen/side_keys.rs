//! The sidebar's bare keys, which work only while it has the keys (a pane gets every key but the leader's). Docs: UI.md,
//! "Sidebar keys".

use super::*;
use crate::client::menu::Act;

/// What `s` steps through: newest first, oldest first, A to Z, and round again.
const SORT_CYCLE: [&str; 3] = ["", "oldest", "az"];

/// The sort that follows `current` in `SORT_CYCLE` (an unknown one starts the cycle again).
fn next_sort(current: &str) -> &'static str {
    let at = SORT_CYCLE.iter().position(|s| *s == current);
    SORT_CYCLE[at.map_or(0, |i| (i + 1) % SORT_CYCLE.len())]
}

impl App {
    /// A key that acts on the sidebar or its row. True when it was one, so it is not typed into the pane.
    pub(in crate::client) fn on_side_shortcut(&mut self, k: &KeyEvent) -> bool {
        let plain = !k.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT);
        match k.code {
            KeyCode::Delete => self.close_cursor_chat(),
            KeyCode::F(2) => self.act(Action::RenameWorkspace),
            KeyCode::Menu => self.act(Action::Menu),
            KeyCode::F(10) if k.modifiers.contains(KeyModifiers::SHIFT) => self.act(Action::Menu),
            KeyCode::Char('g') if plain => {
                let by_machine = self.screen.saved.group_machine;
                self.menu_do(Act::GroupBy(!by_machine));
            }
            KeyCode::Char('s') if plain => {
                let next = next_sort(&self.screen.saved.side_sort);
                self.menu_do(Act::SideSort(next));
            }
            KeyCode::Char('f') if plain => self.group_menu(),
            KeyCode::Char('m') if plain => self.sidebar_menu(),
            KeyCode::Char('n') if plain => self.act(Action::PickSession),
            KeyCode::Char('?') if plain => self.act(Action::Help),
            _ => return false,
        }
        true
    }

    /// `del` on a row: close that chat, through the question every close asks.
    fn close_cursor_chat(&mut self) {
        let Some(row) = self.screen.cursor else {
            return;
        };
        match (self.session_term(row), self.bare_conversation(row)) {
            (Some(term), _) => self.menu_act(Act::End(vec![term])),
            (None, Some(id)) => self.menu_act(Act::ArchiveConversation(id)),
            (None, None) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::reference_fixture::{Stage, world};

    fn press(app: &mut App, code: KeyCode, mods: KeyModifiers) {
        app.on_side_key(&KeyEvent::new(code, mods));
    }

    fn on_a_row() -> App {
        let mut app = world(Stage::None);
        let mut term = ratatui::Terminal::new(ratatui::backend::TestBackend::new(120, 34)).expect("a test terminal");
        term.draw(|f| crate::client::render::draw(&mut app, f)).expect("a frame");
        let first = app.screen.side_items.first().cloned().expect("a row");
        app.screen_side_set(first);
        app.mode = Mode::Side;
        app
    }

    #[test]
    fn sort_steps_through_the_three_orders_and_round() {
        assert_eq!(next_sort(""), "oldest");
        assert_eq!(next_sort("oldest"), "az");
        assert_eq!(next_sort("az"), "");
        assert_eq!(next_sort("unheard-of"), "");
    }

    #[test]
    fn g_flips_the_grouping_and_s_steps_the_sort() {
        let mut app = on_a_row();
        let before = app.screen.saved.group_machine;
        press(&mut app, KeyCode::Char('g'), KeyModifiers::NONE);
        assert_ne!(app.screen.saved.group_machine, before);
        press(&mut app, KeyCode::Char('s'), KeyModifiers::NONE);
        assert_eq!(app.screen.saved.side_sort, "oldest");
    }

    #[test]
    fn each_sidebar_key_opens_what_it_names_and_del_asks_before_closing() {
        type Opened = fn(&Mode) -> bool;
        let cases: [(KeyCode, KeyModifiers, Opened, &str); 7] = [
            (KeyCode::Char('m'), KeyModifiers::NONE, |m| matches!(m, Mode::ScreenMenu(s) if s.title == "menu"), "m: the menu"),
            (KeyCode::Char('f'), KeyModifiers::NONE, |m| matches!(m, Mode::ScreenMenu(s) if s.title == "sidebar"), "f: the sidebar menu"),
            (KeyCode::Char('?'), KeyModifiers::SHIFT, |m| !matches!(m, Mode::Side), "?: the keys list takes over"),
            (KeyCode::Char('n'), KeyModifiers::NONE, |m| !matches!(m, Mode::Side), "n: the new-chat picker takes over"),
            (KeyCode::Delete, KeyModifiers::NONE, |m| matches!(m, Mode::Confirm(c) if matches!(c.act, Act::End(_))), "del: asks before closing the row"),
            (
                KeyCode::F(10),
                KeyModifiers::SHIFT,
                |m| {
                    matches!(m, Mode::ScreenMenu(s)
                        if s.items.iter().any(|(l, _)| l == "Rename…") && s.items.iter().any(|(l, _)| l == "Close chat"))
                },
                "shift+F10: the row's chat menu",
            ),
            (KeyCode::F(2), KeyModifiers::NONE, |m| matches!(m, Mode::Prompt { .. }), "F2: renames the row in place"),
        ];
        for (code, mods, opened, what) in cases {
            let mut app = on_a_row();
            press(&mut app, code, mods);
            assert!(opened(&app.mode), "{what}: {:?}", app.mode);
        }
    }
}
