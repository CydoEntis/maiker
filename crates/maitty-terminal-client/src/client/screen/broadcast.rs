//! Broadcasting: what is typed into the focused pane of the tab on screen is typed into each of its
//! panes too, for the same command in several shells.

use super::*;

impl App {
    /// Broadcast typing to every pane of this tab, or stop.
    pub(in crate::client) fn toggle_broadcast(&mut self) {
        let at = self.screen.tab;
        let Some(tab) = self.screen.tabs.get_mut(at) else {
            return self.notify("no tab to broadcast to".into(), false);
        };
        if !tab.broadcast && tab.layout.leaves().len() < 2 {
            return self.notify("broadcast needs two panes in this tab: split it first".into(), false);
        }
        tab.broadcast = !tab.broadcast;
        let said = if tab.broadcast {
            format!("typing goes to all {} panes of this tab", tab.layout.leaves().len())
        } else {
            "broadcast off: typing goes to this pane only".into()
        };
        self.notify(said, false);
    }

    /// The number of panes typing goes to when the tab on screen broadcasts; `None` when it doesn't.
    pub(in crate::client) fn broadcasting(&self) -> Option<usize> {
        let tab = self.screen.tabs.get(self.screen.tab)?;
        let n = tab.layout.leaves().len();
        (tab.broadcast && n > 1).then_some(n)
    }

    /// The other panes what is typed into `term` also goes to: the rest of its tab while that tab
    /// broadcasts, else none.
    pub(in crate::client) fn broadcast_peers(&self, term: ClientTerm) -> Vec<ClientTerm> {
        self.screen
            .tabs
            .iter()
            .find(|tab| tab.broadcast && tab.contains(term))
            .map(|tab| tab.leaves().into_iter().filter(|t| *t != term).collect())
            .unwrap_or_default()
    }
}
