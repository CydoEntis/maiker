//! The states of an update that show in the window: the toast that says a release is ready, the status-bar chip while
//! it downloads, and the wait for working chats before Maiker restarts. The daemon keeps every chat running through
//! all of it. Docs: UI.md, "Update".

use super::toasts::{Toast, ToastKind};
use super::*;
use std::time::Duration;

/// How long "Updated to" stays on the bar.
const UPDATED_FOR: Duration = Duration::from_secs(4);
const INSTALLS_ON_RESTART: &str = "It installs when you restart, never while an agent is working.";

/// A version as people say it: no leading `v`.
fn plain(version: &str) -> &str {
    version.trim_start_matches('v')
}

impl App {
    /// A newer release was found: one toast with what changed, and when it installs.
    pub(in crate::client) fn announce_update(&mut self, version: &str) {
        let body = match self.update_notes.first() {
            Some(note) => format!("{note} {INSTALLS_ON_RESTART}"),
            None => INSTALLS_ON_RESTART.to_string(),
        };
        self.push_toast(Toast {
            kind: ToastKind::Update,
            term: None,
            title: format!("{} {} is ready", env!("APP_NAME"), plain(version)),
            body,
            at: Instant::now(),
        });
    }

    pub(in crate::client) fn working_chats(&self) -> usize {
        self.snap.terms.values().filter(|t| t.status == Status::Working).count()
    }

    /// Restart was asked for while chats are working: wait for them instead of stopping them.
    pub(in crate::client) fn restart_when_idle(&mut self) {
        self.restart_waiting = true;
        self.dirty = true;
    }

    /// Once a tick: restart when the last working chat finished, or forget the wait when there is nothing to restart onto.
    pub(in crate::client) fn release_tick(&mut self) {
        if !self.restart_waiting {
            return;
        }
        if !self.restart_needed() {
            self.restart_waiting = false;
        } else if self.working_chats() == 0 {
            self.restart_waiting = false;
            self.ask_restart();
        }
        self.dirty = true;
    }

    /// The window came back on the new version: say so on the bar for a few seconds.
    pub(in crate::client) fn updated_to(&mut self, version: &str) {
        self.updated = Some((plain(version).to_string(), Instant::now()));
        self.dirty = true;
    }
}

/// The status bar's chip for the update, if it has one. It takes the slot of the service's chip, which comes first.
pub(in crate::client) fn release_chip(app: &App, t: &Theme) -> Option<(Vec<crate::client::design::Seg>, Option<ScreenHit>)> {
    let style = |color: Color| Style::default().bg(t.bg).fg(color).add_modifier(Modifier::BOLD);
    if app.updating {
        let version = app.update_available.as_deref().map_or("the update", plain);
        return Some((vec![seg(format!("{} Downloading {version}…", app.working_frame()), style(t.working))], None));
    }
    if app.restart_waiting {
        let n = app.working_chats();
        let words = if n == 1 {
            "1 chat is working · Maiker restarts when it finishes".to_string()
        } else {
            format!("{n} chats are working · Maiker restarts when they finish")
        };
        return Some((vec![seg(format!("{} {words}", app.working_frame()), style(t.working))], None));
    }
    app.updated
        .as_ref()
        .filter(|(_, at)| at.elapsed() < UPDATED_FOR)
        .map(|(v, _)| (vec![seg(format!("✓ Updated to {v} · all chats reconnected"), style(t.done))], None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::reference_fixture::{Stage, world};

    fn chip_text(app: &App) -> Option<String> {
        let t = app.theme.clone();
        release_chip(app, &t).map(|(segs, _)| segs.into_iter().map(|s| s.0).collect())
    }

    #[test]
    fn the_start_up_toast_says_what_changed_and_when_it_installs() {
        let mut app = world(Stage::None);
        app.update_available = Some("v0.46.0".into());
        app.update_notes = vec!["Faster sidebar and mouse support in the TUI.".into()];
        app.announce_update("v0.46.0");
        let (toast, _) = app.head_toast().expect("a toast");
        assert_eq!(toast.title, format!("{} 0.46.0 is ready", env!("APP_NAME")));
        assert!(toast.body.starts_with("Faster sidebar") && toast.body.ends_with(INSTALLS_ON_RESTART), "{}", toast.body);
    }

    #[test]
    fn i_installs_now_and_esc_means_later_but_only_with_the_keys_on_the_sidebar() {
        let mut app = world(Stage::None);
        app.update_available = Some("v0.46.0".into());
        app.announce_update("v0.46.0");
        app.mode = Mode::Normal;
        app.on_key(KeyEvent::new(KeyCode::Char('i'), KeyModifiers::NONE));
        assert!(!app.updating, "typing in a pane is never an install");
        app.mode = Mode::Side;
        app.on_key(KeyEvent::new(KeyCode::Char('i'), KeyModifiers::NONE));
        assert!(app.updating && app.toasts.is_empty());
    }

    #[test]
    fn esc_puts_the_update_toast_away_and_the_update_stays_in_the_menu() {
        let mut app = world(Stage::None);
        app.update_available = Some("v0.46.0".into());
        app.announce_update("v0.46.0");
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.toasts.is_empty() && app.update_available.is_some());
    }

    #[test]
    fn the_update_toast_hides_after_twelve_seconds() {
        let mut app = world(Stage::None);
        app.update_available = Some("v0.46.0".into());
        app.announce_update("v0.46.0");
        app.toasts[0].at = Instant::now() - Duration::from_secs(13);
        assert!(app.prune_toasts());
    }

    #[test]
    fn while_downloading_the_bar_says_so() {
        let mut app = world(Stage::None);
        app.update_available = Some("v0.46.0".into());
        app.updating = true;
        assert!(chip_text(&app).expect("a chip").ends_with("Downloading 0.46.0…"));
    }

    #[test]
    fn a_restart_waits_for_working_chats_then_goes() {
        let mut app = world(Stage::None);
        let working = app.working_chats();
        assert!(working > 0, "the fixture has a working chat");
        app.restart_when_idle();
        let said = chip_text(&app).expect("a chip");
        assert!(said.contains(&format!("{working} chat")) && said.contains("Maiker restarts when"), "{said}");
        for t in app.snap.terms.values_mut() {
            if t.status == Status::Working {
                t.status = Status::Idle;
            }
        }
        app.release_tick();
        assert!(!app.restart_waiting, "nothing to wait for now");
    }

    #[test]
    fn after_the_restart_the_bar_says_all_chats_reconnected() {
        let mut app = world(Stage::None);
        app.updated_to("v0.46.0");
        assert_eq!(chip_text(&app).as_deref(), Some("✓ Updated to 0.46.0 · all chats reconnected"));
    }
}
