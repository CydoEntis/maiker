//! A status written anywhere but its one writer skipped the log that traces a wrong alert, and
//! often the turn's bookkeeping too: that bug came back many times. This reads the daemon's own
//! source and fails on any other write. Tests may set a status up directly.

use std::path::{Path, PathBuf};

/// The writers: a pane's (`Term::write_status`) and a chat's (`State::set_status`).
const WRITERS: [&str; 2] = ["term.rs", "conversation/mod.rs"];

fn sources(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        if path.is_dir() {
            if name != "tests" && name != "fixtures" {
                sources(&path, found);
            }
        } else if name.ends_with(".rs") && !name.ends_with("tests.rs") && name != "status_writers.rs" {
            found.push(path);
        }
    }
}

/// The file without its test module, which comes last.
fn without_tests(text: &str) -> &str {
    text.find("\n#[cfg(test)]\nmod ")
        .or_else(|| text.find("\n#[cfg(test)]\nmod"))
        .map_or(text, |at| &text[..at])
}

#[test]
fn every_status_goes_through_its_one_writer() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/daemon");
    let mut files = Vec::new();
    sources(&root, &mut files);
    assert!(files.len() > 20, "the daemon's source was not found under {}", root.display());
    let write = regex::Regex::new(r"\.status\s*=[^=]").unwrap();
    let mut found = Vec::new();
    for file in files {
        let shown = file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        let text = std::fs::read_to_string(&file).unwrap();
        for (n, line) in without_tests(&text).lines().enumerate() {
            let code = line.split("//").next().unwrap_or("");
            if write.is_match(code) && !(WRITERS.contains(&shown.as_str()) && code.contains("self.status = new")) {
                found.push(format!("{shown}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    assert!(found.is_empty(), "write these through `Term::write_status` or `State::set_status`:\n{}", found.join("\n"));
}
