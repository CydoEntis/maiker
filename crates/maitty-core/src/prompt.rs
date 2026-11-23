//! Reading the question an agent is stopped on, off its screen.

const OPTION_LOOKBACK_LINES: usize = 20;
const QUESTION_LINES: usize = 6;
const ASKING_LINES: usize = 12;
const BOX_CHARS: &str = "│┃ ";
const BORDER_CHARS: &str = "─━╭╮╰╯┌┐└┘";
/// The marks an agent puts on the choice under its cursor: Claude's `❯`, Codex's `›`, plain `>`.
const CURSORS: [char; 3] = ['❯', '›', '>'];

/// The numbered choices on a screen and the question above them.
pub fn prompt_on(screen: &str) -> (String, Vec<(u32, String)>) {
    let lines: Vec<&str> = screen.lines().collect();
    let (opts, first, _) = options_in(&lines);
    let question = lines[first.saturating_sub(QUESTION_LINES)..first].join(" ");
    (question, opts)
}

/// What a stopped agent is asking, for a card that has to show the exact command and not just the
/// last prompt: the lines above its numbered choices (the command, the file), then the choices.
/// Empty when the screen shows no numbered choices.
pub fn asking(screen: &str) -> String {
    let lines: Vec<&str> = screen.lines().collect();
    let (mut opts, mut first, mut cursor) = options_in(&lines);
    if opts.is_empty() {
        // Claude's newer menus (trust this folder) have no numbers, only a cursor and an `Enter to confirm` line.
        let Some((menu, at, picked)) = cursor_menu_in(&lines) else {
            return String::new();
        };
        opts = menu;
        first = at;
        cursor = Some(picked);
    }
    let above = lines[first.saturating_sub(ASKING_LINES)..first]
        .iter()
        .map(|line| {
            line.trim()
                .trim_matches(|c: char| BOX_CHARS.contains(c))
                .trim_end()
        })
        .map(|line| {
            if line.chars().all(|c| BORDER_CHARS.contains(c)) {
                ""
            } else {
                line
            }
        })
        .collect::<Vec<_>>();
    // Blank lines at the top and bottom are the box's padding.
    let start = above
        .iter()
        .position(|line| !line.is_empty())
        .unwrap_or(above.len());
    let end = above
        .iter()
        .rposition(|line| !line.is_empty())
        .map_or(start, |last| last + 1);
    let mut text = above[start..end].join("\n");
    for (index, (number, label)) in opts.iter().enumerate() {
        // The line the cursor is on says so, so a caller can move from it to the option it wants.
        let mark = if cursor == Some(index) { "❯ " } else { "" };
        text.push_str(&format!("\n{mark}{number}. {label}"));
    }
    text
}

/// A numbered-from-1 menu, the line it starts on, and the index of the choice under the cursor.
type CursorMenu = (Vec<(u32, String)>, usize, usize);

/// Options without numbers: the lines just above an `Enter to confirm` footer, one per line, the
/// cursor (`❯`) on the picked one. Returns them numbered from 1, where the first of them is, and
/// which is picked.
fn cursor_menu_in(lines: &[&str]) -> Option<CursorMenu> {
    let footer = lines.iter().rposition(|line| line.contains("Enter to confirm"))?;
    let clean = |line: &str| line.trim().trim_matches(|c: char| BOX_CHARS.contains(c)).trim().to_string();
    let mut end = footer;
    while end > 0 && clean(lines[end - 1]).is_empty() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && !clean(lines[start - 1]).is_empty() {
        start -= 1;
    }
    let rows = &lines[start..end];
    if rows.len() < 2 {
        return None;
    }
    let picked = rows.iter().position(|row| clean(row).starts_with(CURSORS)).unwrap_or(0);
    let opts = rows
        .iter()
        .enumerate()
        .map(|(i, row)| (i as u32 + 1, clean(row).trim_start_matches(CURSORS).trim().to_string()))
        .collect();
    Some((opts, start, picked))
}

/// The numbered choices, the line the first is on, and which one the cursor mark is on, when one is marked.
fn options_in(lines: &[&str]) -> (Vec<(u32, String)>, usize, Option<usize>) {
    let mut opts = Vec::new();
    let mut marked = None;
    let mut first = lines.len();
    for (i, l) in lines.iter().enumerate().rev().take(OPTION_LOOKBACK_LINES) {
        let boxless = l.trim().trim_matches(|c: char| BOX_CHARS.contains(c));
        let t = boxless
            .trim_start_matches(|c: char| c == ' ' || CURSORS.contains(&c))
            .trim();
        let mut ch = t.chars();
        if let (Some(d), Some('.')) = (ch.next(), ch.next())
            && let Some(n) = d.to_digit(10)
        {
            if boxless.starts_with(CURSORS) {
                marked = Some(opts.len());
            }
            opts.push((n, ch.as_str().trim().to_string()));
            first = i;
        }
    }
    opts.reverse();
    // Counted from the bottom while walking up, so it is turned around with the list.
    let cursor = marked.map(|from_bottom| opts.len() - 1 - from_bottom);
    (opts, first, cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE_BASH_PROMPT: &str = "\
╭──────────────────────────────────────╮
│ Bash command                         │
│                                      │
│   rm -rf target/debug                │
│   Delete the build folder            │
│                                      │
│ Do you want to proceed?              │
│ ❯ 1. Yes                             │
│   2. Yes, and don't ask again        │
│   3. No, and tell Claude what to do  │
╰──────────────────────────────────────╯";

    #[test]
    fn the_choices_and_the_question_above_them_are_read() {
        let (question, options) = prompt_on(CLAUDE_BASH_PROMPT);
        assert!(question.contains("Do you want to proceed?"));
        assert_eq!(options.len(), 3);
        assert_eq!(options[0], (1, "Yes".to_string()));
    }

    #[test]
    fn codex_choices_under_its_cursor_are_read() {
        let (_, options) = prompt_on("Which environment?\n\u{203a} 1. Staging\n  2. Production\n");
        assert_eq!(options, [(1, "Staging".to_string()), (2, "Production".to_string())]);
    }

    #[test]
    fn asking_keeps_the_exact_command_and_the_choices_without_the_box() {
        let text = asking(CLAUDE_BASH_PROMPT);
        assert!(text.contains("\n❯ 1. Yes"), "{text}");
        assert!(text.contains("rm -rf target/debug"), "{text}");
        assert!(text.contains("3. No, and tell Claude what to do"), "{text}");
        assert!(!text.contains('│'), "{text}");
    }

    #[test]
    fn the_trust_menu_without_numbers_is_read_with_its_cursor() {
        let screen = "Accessing workspace:\n\n/home/vox\n\nQuick safety check: do you trust this folder?\n\n❯ No, exit\n  Yes, I trust this folder\n\nEnter to confirm · Esc to cancel";
        let text = asking(screen);
        assert!(text.contains("❯ 1. No, exit"), "{text}");
        assert!(text.contains("\n2. Yes, I trust this folder"), "{text}");
        assert!(text.starts_with("Accessing workspace:"), "{text}");
        assert_eq!(asking("just some output\nno menu here"), "");
    }

    /// Codex's wording is from its source, not a capture: the chat card only recognises exact words, so
    /// a different real screen just leaves the generic menu card.
    #[test]
    fn codex_trust_menu_is_read_with_the_folder_above_its_choices() {
        let screen = "> You are in /home/vox/app\n\n  Do you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n\n\u{203a} 1. Yes, continue\n  2. No, quit\n\n  Press enter to continue";
        let text = asking(screen);
        assert!(text.starts_with("> You are in /home/vox/app"), "{text}");
        assert!(text.contains("\n❯ 1. Yes, continue"), "{text}");
        assert!(text.ends_with("\n2. No, quit"), "{text}");
    }
}
