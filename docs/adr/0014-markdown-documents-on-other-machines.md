# 0014. Markdown documents are read and saved on other machines, by that machine's own daemon

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

[0007](0007-multiple-machines.md) kept everything that reads a disk local-only for a pane on another
machine: Changes, Files, Find, opening a path, and with them the markdown viewer and editor built for
MAITTY-409 (draw a README, open a document beside the chat, edit it, save it with a version check). The
reason was trust: another machine's daemon is untrusted input, and a window that read and wrote its
disk would need more than the chat's "data, cleaned before display" rule. The user has since decided
that documents must work for sessions on any machine, since the project, its README and its notes are
where the agent runs.

## Decision

This amends [0007](0007-multiple-machines.md) for markdown documents only; the rest of 0007 stands.

**What widens.** For a session on another machine the window may ask that machine's daemon for:

1. a folder's listing (`RepoRequest::Tree`), so the Files tab and the README lookup have names to show;
2. one markdown document with its version (`RepoRequest::FileStamped`);
3. a save of that document (`Command::SaveFile`), answered `Saved { version }` or `ChangedOnDisk`.

"Markdown" is decided by the file name (`.md`, `.markdown`, `.mdx`), by the window before it asks
(`maitty_machines::remote_repo::is_document_path`) and by the machine's own daemon again.

**What stays.** The window never touches a remote disk. The daemon on that machine does the read and the
write, inside its own project root: relative path, no `..`, no link followed at any step, not under
`.git`, an existing plain file only, text up to 256 KiB, a temporary file renamed over the original,
permissions kept, the version checked again just before the rename. Nothing crosses between the two
machines' disks; the window carries text and a version word. Reading any other file whole (`File`),
saving any other kind of file (`WriteFile`), branches, history, snapshots, references, find and opening a
path from the output stay local-only, and the Files tab says "Only Markdown documents open from
`<machine>`; its other files stay there."

**The remote daemon stays untrusted.** Every answer goes through `remote_repo::vet_repo_reply` /
`vet_save_reply` before anything reads it, and only the answer to what was asked passes:

- A listing's names are cleaned to one line each and its length capped.
- A document's text keeps its tabs, returns and line breaks (it is edited and saved back) and loses every
  other control or invisible character, so escape sequences and direction overrides never reach the
  screen. When any character had to go, the version is replaced with the empty word, which equals no real
  version: the window shows the text read-only ("This file has characters that cannot be shown safely, so
  it is read only here"), because saving the cleaned text would change the file. Text over 512 KiB, or a
  version longer than 64 characters, is refused; a version that is not letters, digits and dashes is not
  trusted for a save.
- A save's answer is `Saved` with a plausible version or `ChangedOnDisk`, and nothing else. Neither
  echoes a path or the content, so there is nothing further to clean.
- The path the window sends is the one it chose, a project path with `/` on every system (a Windows
  client included; a Windows remote stays out, 0007). A path with a backslash, a drive letter or a stream
  colon, a leading slash, an empty or `.`/`..` part, or a non-markdown name is refused before any line is
  opened.

**Version gate.** The three messages are the ones of protocol 116 (`FILE_EDIT_SINCE`); no message and no
`PROTOCOL_VERSION` or `COMPATIBLE_SINCE` change is needed. The desktop window dials every machine as
newest-only (`Dial::newest_only`), so a machine whose daemon is older than this app is turned away when
it connects and offers its update (0007), never asked for a document. Where a daemon answers a read
without a version anyway, the window shows Drawn and Source and says "This machine's service is older:
restart it to edit."

## Alternatives considered

- **Keep documents local-only:** rejected by the user; the README of the project an agent works on is
  the first thing a person wants beside the chat.
- **Read the file over the ssh line** (as files are pulled, 0007): rejected, a second reader and writer of
  the machine's disk would repeat the jail checks outside the daemon and could not do the version check.
- **Allow every `File` read and `WriteFile` too:** rejected as wider than the need: other files are read
  by agents and editors on that machine, and the vetting here is per kind of answer.

## Consequences

- A document on another machine is as current as the last read (when the window regains focus) and is
  saved only against the version read; a change made there meanwhile asks Reload or Overwrite.
- The Files tab of a remote session lists folders and opens markdown; Changes still shows the diff.
- `docs/SECURITY.md` (editing a project file), `docs/API_PATTERNS.md` and `docs/UI.md` carry the details.
