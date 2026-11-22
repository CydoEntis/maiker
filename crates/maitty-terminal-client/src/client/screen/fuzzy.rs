//! The in-order match the command search and the key map use.

/// The in-order, case-insensitive match of `query` in `text`: the char indices that matched.
pub(in crate::client) fn fuzzy_indices(query: &str, text: &str) -> Option<Vec<usize>> {
    let mut wanted = query.chars().flat_map(char::to_lowercase).peekable();
    let mut at = Vec::new();
    for (i, c) in text.chars().enumerate() {
        let Some(&next) = wanted.peek() else { break };
        if c.to_lowercase().next() == Some(next) {
            at.push(i);
            wanted.next();
        }
    }
    wanted.peek().is_none().then_some(at)
}

#[cfg(test)]
mod tests {
    use super::fuzzy_indices;

    #[test]
    fn letters_match_only_in_order_and_ignoring_case() {
        let cases: [(&str, &str, Option<Vec<usize>>); 5] = [
            ("spld", "Split down", Some(vec![0, 1, 2, 6])),
            ("SD", "split down", Some(vec![0, 6])),
            ("", "anything", Some(vec![])),
            ("ds", "split down", None),
            ("xyz", "split down", None),
        ];
        for (query, text, want) in cases {
            assert_eq!(fuzzy_indices(query, text), want, "{query:?} in {text:?}");
        }
    }
}
