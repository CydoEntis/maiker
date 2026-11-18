//! What a new folder may be called (`Query::CreateFolder`). One rule for every system, so a folder
//! made on a Linux machine can still be opened from a Windows one: the strictest system's rule
//! applies everywhere. The daemon checks the name with this, whatever the window already checked.

use crate::hidden::sanitize;

/// The most bytes a name may take: what the common file systems allow.
pub const FOLDER_NAME_MAX_BYTES: usize = 255;

/// Characters no name may hold: the path separators, and what Windows refuses in a name.
const REFUSED_CHARS: [char; 9] = ['/', '\\', '<', '>', ':', '"', '|', '?', '*'];

/// Names Windows keeps for devices, with or without an extension after them.
const DEVICE_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Why `name` cannot be a new folder's name, in words to show next to the field; `None` when it can.
pub fn problem(name: &str) -> Option<String> {
    let first_dot = name.find('.').unwrap_or(name.len());
    let stem = &name[..first_dot];
    Some(
        if name.is_empty() {
            "Type a name for the folder."
        } else if name.len() > FOLDER_NAME_MAX_BYTES {
            "That name is too long."
        } else if name == "." || name == ".." {
            "A folder cannot be called . or .."
        } else if name.contains(['/', '\\']) {
            "A name cannot hold / or \\: it is one folder, not a path."
        } else if name.contains(REFUSED_CHARS) {
            "A name cannot hold any of < > : \" | ? *"
        } else if sanitize(name, false) != name {
            "A name cannot hold control or hidden characters."
        } else if name.starts_with(' ') || name.ends_with(' ') || name.ends_with('.') {
            "A name cannot start or end with a space, or end with a dot."
        } else if DEVICE_NAMES.iter().any(|device| stem.trim_end().eq_ignore_ascii_case(device)) {
            "Windows keeps that name for a device. Pick another."
        } else {
            return None;
        }
        .to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_names_pass() {
        for name in ["notes", "my project", "app-2", "v1.2", ".config", "ünï", "日本語", "a.b.c", "CONSOLE", "com10"] {
            assert_eq!(problem(name), None, "{name}");
        }
    }

    #[test]
    fn what_is_not_one_plain_name_is_refused_with_words() {
        let long = "a".repeat(FOLDER_NAME_MAX_BYTES + 1);
        for name in [
            "", ".", "..", "a/b", "a\\b", "../x", "a:b", "a*b", "a?b", "a\"b", "a|b", "a<b", "a>b", " a", "a ", "a.",
            "tab\there", "esc\u{1b}[2J", "zero\u{200b}width", "con", "NUL", "com1", "Lpt9.txt", "aux.log", long.as_str(),
        ] {
            assert!(problem(name).is_some(), "{name:?} should be refused");
        }
    }

    #[test]
    fn the_longest_name_still_passes() {
        assert_eq!(problem(&"a".repeat(FOLDER_NAME_MAX_BYTES)), None);
    }
}
