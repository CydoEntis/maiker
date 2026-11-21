//! What a person is shown before they allow something: text with invisible characters spelled
//! out and secrets masked, and file changes with the content of secret files left out.

use crate::redact;
use maitty_shared::conversation::FileChangePreview;
use serde_json::Value;

pub fn visible_text(text: &str) -> String {
    let mut visible = String::with_capacity(text.len());
    for character in text.chars() {
        if maitty_shared::hidden::is_invisible(character) {
            visible.push_str(&format!("\\u{{{:x}}}", character as u32));
        } else {
            visible.push(character);
        }
    }
    visible
}

/// Approval text that may be stored and served: invisible characters spelled out, and
/// token- and key-shaped strings masked (see `redact.rs`).
pub fn approval_text(text: &str) -> String {
    redact::redact_text(&visible_text(text)).into_owned()
}

/// The changes of a patch as a person is shown them. `None` when any change is incomplete: a
/// partial diff must never be approved.
pub fn file_change_previews(
    changes: &[Value],
) -> Option<Vec<FileChangePreview>> {
    changes
        .iter()
        .map(|change| {
            let raw_path = change.get("path")?.as_str()?;
            Some(FileChangePreview {
                path: visible_text(raw_path),
                kind: change.get("kind")?.as_str()?.to_owned(),
                // The diff of a secret file is left out, the path and kind stay.
                diff: redact::redact_diff(
                    raw_path,
                    &visible_text(change.get("diff")?.as_str()?),
                ),
            })
        })
        .collect()
}
