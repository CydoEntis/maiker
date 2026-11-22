//! Reading a drawn screen back as text, for tests.
use ratatui::buffer::Buffer;
use ratatui::layout::Rect;

/// The text of `area` in `buf`, one row per line, trailing spaces trimmed.
pub(super) fn text(buf: &Buffer, area: Rect) -> Vec<String> {
    (area.y..area.bottom())
        .map(|y| {
            (area.x..area.right())
                .map(|x| buf[(x, y)].symbol())
                .collect::<String>()
                .trim_end()
                .to_string()
        })
        .collect()
}
