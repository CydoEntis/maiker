//! Giving the panes of the tab on screen equal room again after they were resized.

use super::*;
use crate::layout::Node;

impl App {
    /// Give the panes of this tab equal room: each split shares its room by how many panes lie
    /// along it on each side, so three side by side get a third each.
    pub(in crate::client) fn reset_widths(&mut self) {
        let at = self.screen.tab;
        let Some(tab) = self.screen.tabs.get_mut(at) else {
            return;
        };
        if tab.layout.leaves().len() < 2 {
            return self.notify("one pane here: nothing to share out".into(), false);
        }
        even(&mut tab.layout);
        self.screen.save();
        self.notify("panes share the room evenly again".into(), false);
    }
}

/// How many panes lie along `horizontal` in `node`: summed through splits the same way, the most of
/// either side through splits the other way.
fn along(node: &Node, horizontal: bool) -> u32 {
    match node {
        Node::Leaf(_) => 1,
        Node::Split { horizontal: h, a, b, .. } if *h == horizontal => along(a, horizontal) + along(b, horizontal),
        Node::Split { a, b, .. } => along(a, horizontal).max(along(b, horizontal)),
    }
}

/// Set every split's ratio so the panes along it get equal room.
pub(in crate::client) fn even(node: &mut Node) {
    if let Node::Split { horizontal, ratio, a, b } = node {
        let (na, nb) = (along(a, *horizontal), along(b, *horizontal));
        *ratio = na as f32 / (na + nb) as f32;
        even(a);
        even(b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::Dir;

    #[test]
    fn three_side_by_side_get_a_third_each_and_a_stack_inside_counts_once() {
        let mut node = Node::Leaf(1);
        node.split(1, Dir::Right, 2);
        node.split(2, Dir::Right, 3);
        node.split(3, Dir::Down, 4);
        node.resize(1, Dir::Right, 0.3);
        even(&mut node);
        let Node::Split { ratio, b, .. } = &node else { panic!("a split") };
        assert!((ratio - 1.0 / 3.0).abs() < 1e-6, "{ratio}");
        let Node::Split { ratio, .. } = b.as_ref() else { panic!("a split") };
        assert!((ratio - 0.5).abs() < 1e-6, "{ratio}");
    }
}
