//! Status reports an agent's hook could not hand to the server. A hook runs inside the agent's
//! turn and must never fail it or print, so a report that cannot be read, or that cannot reach a
//! busy or restarting server in time, used to vanish without a trace. The hook notes the pane in a
//! small file beside the server's socket instead, and the server reads it (`take`), logs it, and
//! says on the pane that its status is not confirmed until its next report arrives.

use crate::protocol::TermId;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The most the file grows to: a server that never reads it (one that is gone) must not let
/// hooks fill a disk. One line per lost report, a few bytes each.
const MAX_BYTES: u64 = 64 * 1024;

/// The file for this server (`<APP>_SOCKET` picks it).
pub fn file() -> PathBuf {
    crate::config::data_dir().join(format!("{}.hook-drops", crate::ipc::socket_id()))
}

/// Note one lost report for pane `term`. Best effort by design: the hook that calls this is
/// already failing quietly, and nothing it does may stop the agent's turn.
pub fn record(path: &Path, term: TermId) -> std::io::Result<()> {
    if std::fs::metadata(path).is_ok_and(|m| m.len() >= MAX_BYTES) {
        return Ok(());
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    // One write per line, so lines from hooks running at once do not interleave.
    file.write_all(format!("{term}\n").as_bytes())
}

/// How many reports each pane lost since the last call, and the file emptied. It is moved aside
/// first, so a hook writing meanwhile starts a new file rather than losing its line.
pub fn take(path: &Path) -> std::io::Result<BTreeMap<TermId, u32>> {
    let taken = path.with_extension("hook-drops.taken");
    match std::fs::rename(path, &taken) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e),
    }
    let text = std::fs::read_to_string(&taken)?;
    std::fs::remove_file(&taken)?;
    Ok(counted(&text))
}

/// Lines that are not a pane number (a torn write) are not counted.
fn counted(text: &str) -> BTreeMap<TermId, u32> {
    let mut lost = BTreeMap::new();
    for term in text.lines().filter_map(|line| line.trim().parse::<TermId>().ok()) {
        *lost.entry(term).or_insert(0) += 1;
    }
    lost
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-hook-drops-{}-{}"),
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lost_reports_are_counted_per_pane_once() {
        let dir = folder("count");
        let path = dir.join("s.hook-drops");
        assert!(take(&path).unwrap().is_empty(), "no file is nothing lost");
        for term in [3, 3, 7] {
            record(&path, term).unwrap();
        }
        std::fs::OpenOptions::new().append(true).open(&path).unwrap().write_all(b"9x\n").unwrap();
        assert_eq!(take(&path).unwrap(), BTreeMap::from([(3, 2), (7, 1)]), "a torn line is not counted");
        assert!(take(&path).unwrap().is_empty(), "each is said once");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_file_stops_growing_when_nobody_reads_it() {
        let dir = folder("cap");
        let path = dir.join("s.hook-drops");
        std::fs::write(&path, "1\n".repeat((MAX_BYTES / 2) as usize)).unwrap();
        record(&path, 2).unwrap();
        assert!(!take(&path).unwrap().contains_key(&2));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
