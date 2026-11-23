//! The named hosts in `~/.ssh/config`, for choosing a machine to add (ADR 0007).
//!
//! v1 lists names only. Settings before the first `Host` line or under a pattern such as
//! `Host *` are not merged into the hosts listed, and `Match` blocks are ignored. An
//! `Include` pulls in the other file's `Host` lines as if they stood at the top level; the
//! including file's current block carries on after it. Nothing here interprets a value:
//! aliases, host names and users are display data.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

/// ssh's own limit on nested `Include`s: the file you start from is level 0.
const MAX_INCLUDE_DEPTH: usize = 16;
const MAX_HOSTS: usize = 1000;
/// Bounds the fan-out of globs inside includes.
const MAX_FILES: usize = 256;
const MAX_LINE_BYTES: usize = 4096;
const MAX_FILE_BYTES: u64 = 1 << 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshHost {
    pub alias: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
}

/// How the parser reaches files, so tests need no real `~/.ssh`.
pub trait ConfigFiles {
    /// The file's text; `None` when it is missing or unreadable.
    fn read(&self, path: &Path) -> Option<String>;
    /// Every file matching a pattern with `*` or `?` in it, in any order.
    fn glob(&self, pattern: &Path) -> Vec<PathBuf>;
}

/// The folders `~` and a relative `Include` mean. ssh resolves relative includes in the user
/// config against `~/.ssh`.
pub struct Dirs<'a> {
    pub home: &'a Path,
    pub ssh: &'a Path,
}

pub fn parse(root: &Path, dirs: &Dirs, files: &dyn ConfigFiles) -> Vec<SshHost> {
    let mut walk = Walk {
        home: norm(dirs.home).trim_end_matches('/').to_string(),
        base: norm(dirs.ssh).trim_end_matches('/').to_string(),
        files,
        hosts: Vec::new(),
        seen: HashSet::new(),
        active: Vec::new(),
        reads: 0,
    };
    walk.file(&norm(root), 0);
    walk.hosts
}

pub fn user_hosts() -> Vec<SshHost> {
    let Some(dirs) = directories::BaseDirs::new() else {
        return Vec::new();
    };
    let home = dirs.home_dir();
    let ssh = home.join(".ssh");
    parse(&ssh.join("config"), &Dirs { home, ssh: &ssh }, &FsFiles)
}

struct Walk<'a> {
    home: String,
    base: String,
    files: &'a dyn ConfigFiles,
    hosts: Vec<SshHost>,
    seen: HashSet<String>,
    /// The files being read right now, so an include cycle ends.
    active: Vec<String>,
    reads: usize,
}

impl Walk<'_> {
    fn file(&mut self, path: &str, depth: usize) {
        let spent = depth > MAX_INCLUDE_DEPTH || self.reads >= MAX_FILES;
        if spent || self.active.iter().any(|p| p == path) {
            return;
        }
        self.reads += 1;
        let Some(text) = self.files.read(Path::new(path)) else {
            return;
        };
        self.active.push(path.to_string());
        let mut block: Vec<usize> = Vec::new();
        for line in text.lines() {
            if self.hosts.len() >= MAX_HOSTS {
                break;
            }
            let Some((key, args)) = split_line(line) else {
                continue;
            };
            match key.as_str() {
                "host" => block = self.add_hosts(&args),
                "match" => block.clear(),
                "hostname" => self.set(&block, args.first(), |h| &mut h.host_name),
                "user" => self.set(&block, args.first(), |h| &mut h.user),
                "include" => args.iter().for_each(|a| self.include(a, depth)),
                _ => {}
            }
        }
        self.active.pop();
    }

    /// The hosts this line added: patterns, unsafe names and repeats are not hosts.
    fn add_hosts(&mut self, aliases: &[String]) -> Vec<usize> {
        let mut added = Vec::new();
        for alias in aliases {
            let named = !is_pattern(alias) && clean(alias).is_some();
            if !named || self.hosts.len() >= MAX_HOSTS || !self.seen.insert(alias.clone()) {
                continue;
            }
            added.push(self.hosts.len());
            self.hosts.push(SshHost {
                alias: alias.clone(),
                host_name: None,
                user: None,
            });
        }
        added
    }

    /// The first value in a block wins, as in ssh.
    fn set(
        &mut self,
        block: &[usize],
        value: Option<&String>,
        field: fn(&mut SshHost) -> &mut Option<String>,
    ) {
        let Some(value) = value.and_then(|v| clean(v)) else {
            return;
        };
        for &i in block {
            let slot = field(&mut self.hosts[i]);
            if slot.is_none() {
                *slot = Some(value.clone());
            }
        }
    }

    fn include(&mut self, arg: &str, depth: usize) {
        let resolved = self.resolve(arg);
        let mut paths = if has_wildcard(&resolved) {
            self.files
                .glob(Path::new(&resolved))
                .iter()
                .map(|p| norm(p))
                .collect()
        } else {
            vec![resolved]
        };
        paths.sort();
        for path in paths {
            self.file(&path, depth + 1);
        }
    }

    /// `~` is home and a relative path is under the ssh folder. Environment variables are
    /// left alone: ssh does not expand them in an `Include` either.
    fn resolve(&self, arg: &str) -> String {
        let arg = arg.replace('\\', "/");
        if arg == "~" || arg.starts_with("~/") {
            format!("{}{}", self.home, &arg[1..])
        } else if is_absolute(&arg) {
            arg
        } else {
            format!("{}/{}", self.base, arg)
        }
    }
}

fn norm(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn is_absolute(path: &str) -> bool {
    let b = path.as_bytes();
    path.starts_with('/') || (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':')
}

fn is_pattern(alias: &str) -> bool {
    alias.starts_with('!') || has_wildcard(alias)
}

fn has_wildcard(s: &str) -> bool {
    s.contains(['*', '?'])
}

/// A value fit to show: not empty, no control characters.
fn clean(value: &str) -> Option<String> {
    let ok = !value.is_empty() && !value.chars().any(char::is_control);
    ok.then(|| value.to_string())
}

/// `Keyword value`, `Keyword=value` or `Keyword = value` as a lowercase keyword and its
/// words. `None` for a line to skip: a comment, a blank, an oversize or NUL-bearing line, or
/// an unterminated quote.
fn split_line(line: &str) -> Option<(String, Vec<String>)> {
    if line.len() > MAX_LINE_BYTES || line.contains('\0') {
        return None;
    }
    let line = line.trim_start();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let key_end = line
        .find(|c: char| c.is_whitespace() || c == '=')
        .unwrap_or(line.len());
    let (key, rest) = line.split_at(key_end);
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim_start();
    Some((key.to_ascii_lowercase(), words(rest)?))
}

/// Splits on whitespace, honouring double quotes. A `#` that starts a word begins a comment.
fn words(s: &str) -> Option<Vec<String>> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let (mut in_word, mut quoted) = (false, false);
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                in_word = true;
            }
            c if quoted => cur.push(c),
            c if c.is_whitespace() => {
                if in_word {
                    out.push(std::mem::take(&mut cur));
                    in_word = false;
                }
            }
            '#' if !in_word => return Some(out),
            c => {
                cur.push(c);
                in_word = true;
            }
        }
    }
    if quoted {
        return None;
    }
    if in_word {
        out.push(cur);
    }
    Some(out)
}

/// `*` and `?` over one path segment.
fn wildcard_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    let (mut pi, mut ni) = (0, 0);
    let (mut star, mut mark) = (None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

/// The real files.
struct FsFiles;

impl ConfigFiles for FsFiles {
    fn read(&self, path: &Path) -> Option<String> {
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .ok()?
            .take(MAX_FILE_BYTES)
            .read_to_end(&mut bytes)
            .ok()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn glob(&self, pattern: &Path) -> Vec<PathBuf> {
        let pattern = norm(pattern);
        let mut found = vec![String::new()];
        for (i, seg) in pattern.split('/').enumerate() {
            if i > 0 && seg.is_empty() {
                continue;
            }
            found = found
                .iter()
                .flat_map(|dir| extend_segment(dir, seg, i == 0))
                .take(MAX_FILES)
                .collect();
        }
        found.into_iter().map(PathBuf::from).collect()
    }
}

/// What a path becomes with one more segment, which may match many names.
fn extend_segment(dir: &str, seg: &str, first: bool) -> Vec<String> {
    let join = |name: &str| {
        if first {
            name.to_string()
        } else {
            format!("{dir}/{name}")
        }
    };
    if !has_wildcard(seg) {
        return vec![join(seg)];
    }
    let listing = if dir.is_empty() { "/" } else { dir };
    let Ok(entries) = std::fs::read_dir(listing) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| !name.starts_with('.') || seg.starts_with('.'))
        .filter(|name| wildcard_match(seg, name))
        .map(|name| join(&name))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    struct Mem(BTreeMap<String, String>);

    impl ConfigFiles for Mem {
        fn read(&self, path: &Path) -> Option<String> {
            self.0.get(&norm(path)).cloned()
        }

        fn glob(&self, pattern: &Path) -> Vec<PathBuf> {
            let pattern = norm(pattern);
            let (dir, seg) = pattern.rsplit_once('/').unwrap_or(("", &pattern));
            self.0
                .keys()
                .filter_map(|k| k.rsplit_once('/').map(|(d, name)| (k, d, name)))
                .filter(|(_, d, name)| *d == dir && wildcard_match(seg, name))
                .map(|(k, _, _)| PathBuf::from(k))
                .collect()
        }
    }

    fn mem(files: &[(&str, &str)]) -> Mem {
        Mem(files
            .iter()
            .map(|(p, t)| (p.to_string(), t.to_string()))
            .collect())
    }

    fn unix(files: &[(&str, &str)]) -> Vec<SshHost> {
        let (home, ssh) = (Path::new("/home/me"), Path::new("/home/me/.ssh"));
        parse(Path::new(ROOT), &Dirs { home, ssh }, &mem(files))
    }

    fn aliases(hosts: &[SshHost]) -> Vec<&str> {
        hosts.iter().map(|h| h.alias.as_str()).collect()
    }

    const ROOT: &str = "/home/me/.ssh/config";

    /// Config files by path, as `unix` takes them.
    type Files<'a> = &'a [(&'a str, &'a str)];

    fn host(alias: &str, host_name: Option<&str>, user: Option<&str>) -> SshHost {
        SshHost {
            alias: alias.into(),
            host_name: host_name.map(String::from),
            user: user.map(String::from),
        }
    }

    #[test]
    fn a_config_gives_each_named_host_its_first_host_name_and_user() {
        let malformed = format!(
            "Host\nUser\nHost \"open\nHost nul\0\nHost {}\n=\n\"\nHost ok\n  HostName 1.1.1.1\n",
            "x".repeat(MAX_LINE_BYTES + 1)
        );
        let cases: Vec<(&str, &str, Vec<SshHost>)> = vec![
            ("plain", "Host box\n  HostName 10.0.0.5\n  User ana\n", vec![host("box", Some("10.0.0.5"), Some("ana"))]),
            (
                "patterns are skipped, named aliases beside them stay",
                "Host *\nHost *.corp\nHost !x\nHost a b*\nHost c?\nHost d\n",
                vec![host("a", None, None), host("d", None, None)],
            ),
            (
                "settings under a pattern or before any host are not applied",
                "User root\nHost *\n  User wild\nHost box\n",
                vec![host("box", None, None)],
            ),
            ("equals with or without spaces", "Host=foo\nHostName = 1.2.3.4\nUser=bob\n", vec![host("foo", Some("1.2.3.4"), Some("bob"))]),
            ("keywords ignore case", "HOST box\nhostname h\nUSER u\n", vec![host("box", Some("h"), Some("u"))]),
            (
                "comments drop, a hash inside a word stays",
                "# Host hidden\n   # indented\nHost box # trailing\nUser a#b\nHostName \"h #1\"\n",
                vec![host("box", Some("h #1"), Some("a#b"))],
            ),
            ("malformed lines are skipped", malformed.as_str(), vec![host("ok", Some("1.1.1.1"), None)]),
            (
                "a repeated alias keeps the first",
                "Host box\nHostName first\nHost box\nHostName second\nUser late\n",
                vec![host("box", Some("first"), None)],
            ),
            ("the first value in a block wins", "Host box\nUser a\nUser b\nHostName x\nHostName y\n", vec![host("box", Some("x"), Some("a"))]),
            (
                "aliases on one line share settings",
                "Host a b\n  User shared\n",
                vec![host("a", None, Some("shared")), host("b", None, Some("shared"))],
            ),
            (
                "a match block ends the host and is ignored",
                "Host a\nUser one\nMatch host b\nUser two\nHostName nope\nHost c\n",
                vec![host("a", None, Some("one")), host("c", None, None)],
            ),
            (
                "an alias or value with a control character is dropped",
                "Host bad\u{1b}[31m ok\nHostName x\u{7}y\nUser fine\n",
                vec![host("ok", None, Some("fine"))],
            ),
        ];
        for (case, text, expected) in cases {
            assert_eq!(unix(&[(ROOT, text)]), expected, "{case}");
        }
    }

    #[test]
    fn includes_are_followed_from_the_ssh_folder_in_lexical_order() {
        let cases: [(&str, Files, &[&str]); 9] = [
            ("a chain", &[(ROOT, "Host a\nInclude /x/b\n"), ("/x/b", "Host b\nInclude /x/c\n"), ("/x/c", "Host c\n")], &["a", "b", "c"]),
            (
                "a glob, not into sub-folders",
                &[
                    (ROOT, "Include config.d/*\nHost last\n"),
                    ("/home/me/.ssh/config.d/20-b", "Host b\n"),
                    ("/home/me/.ssh/config.d/10-a", "Host a\n"),
                    ("/home/me/.ssh/config.d/sub/z", "Host z\n"),
                ],
                &["a", "b", "last"],
            ),
            (
                "a quoted path may hold spaces",
                &[(ROOT, "Include \"/my configs/extra\" /x/plain\n"), ("/my configs/extra", "Host spaced\n"), ("/x/plain", "Host plain\n")],
                &["spaced", "plain"],
            ),
            (
                "a relative path is under the ssh folder",
                &[(ROOT, "Include extra\n"), ("/home/me/.ssh/extra", "Host rel\n"), ("/home/me/extra", "Host wrong\n")],
                &["rel"],
            ),
            ("tilde means home", &[(ROOT, "Include ~/other/cfg\n"), ("/home/me/other/cfg", "Host tilde\n")], &["tilde"]),
            (
                "environment variables are not expanded",
                &[
                    (ROOT, "Include %USERPROFILE%/x $HOME/y\n"),
                    ("/home/me/.ssh/%USERPROFILE%/x", "Host a\n"),
                    ("/home/me/.ssh/$HOME/y", "Host b\n"),
                    ("/home/me/y", "Host c\n"),
                ],
                &["a", "b"],
            ),
            ("a missing include is skipped", &[(ROOT, "Include /nope\nInclude gone/*\nHost a\n")], &["a"]),
            ("a file including itself ends", &[(ROOT, "Host a\nInclude /home/me/.ssh/config\nHost b\n")], &["a", "b"]),
            ("a missing root gives no hosts", &[], &[]),
        ];
        for (case, files, expected) in cases {
            assert_eq!(aliases(&unix(files)), expected, "{case}");
        }
    }

    #[test]
    fn an_include_chain_of_twenty_stops_at_sixteen_levels() {
        let names: Vec<String> = (0..20).map(|i| format!("/chain/f{i}")).collect();
        let texts: Vec<String> = (0..20)
            .map(|i| format!("Host h{i}\nInclude /chain/f{}\n", i + 1))
            .collect();
        let mut files: Vec<(&str, &str)> = vec![(ROOT, "Include /chain/f0\n")];
        files.extend(
            names
                .iter()
                .zip(&texts)
                .map(|(n, t)| (n.as_str(), t.as_str())),
        );
        let hosts = unix(&files);
        assert_eq!(hosts.len(), MAX_INCLUDE_DEPTH);
        assert_eq!(hosts.last().map(|h| h.alias.as_str()), Some("h15"));
    }

    #[test]
    fn windows_paths_work_with_either_separator() {
        let (home, ssh) = (Path::new(r"C:\Users\me"), Path::new(r"C:\Users\me\.ssh"));
        let root = "Include C:/Users/me/.ssh/config.d/*\n\
                    Include C:\\Users\\me\\.ssh\\extra\n\
                    Include ~\\home.cfg\n\
                    Include rel\\one\n";
        let files = mem(&[
            ("C:/Users/me/.ssh/config", root),
            ("C:/Users/me/.ssh/config.d/a", "Host glob\n"),
            ("C:/Users/me/.ssh/extra", "Host back\n"),
            ("C:/Users/me/home.cfg", "Host tilde\n"),
            ("C:/Users/me/.ssh/rel/one", "Host rel\n"),
        ]);
        let hosts = parse(
            Path::new(r"C:\Users\me\.ssh\config"),
            &Dirs { home, ssh },
            &files,
        );
        assert_eq!(aliases(&hosts), ["glob", "back", "tilde", "rel"]);
    }

    #[test]
    fn the_host_list_is_capped() {
        let text: String = (0..MAX_HOSTS + 50)
            .map(|i| format!("Host h{i}\n"))
            .collect();
        assert_eq!(unix(&[(ROOT, &text)]).len(), MAX_HOSTS);
    }

    #[test]
    fn wildcards_match_within_a_segment() {
        assert!(wildcard_match("*", "anything"));
        assert!(wildcard_match("a*c", "abbbc"));
        assert!(wildcard_match("a?c", "abc"));
        assert!(!wildcard_match("a?c", "ac"));
        assert!(!wildcard_match("a*c", "abd"));
    }

    #[test]
    fn the_real_filesystem_reads_and_globs() {
        let dir = std::env::temp_dir().join(format!("ssh_hosts_{}", std::process::id()));
        let sub = dir.join("config.d");
        std::fs::create_dir_all(&sub).expect("make temp dir");
        std::fs::write(sub.join("b"), "Host b\n").expect("write");
        std::fs::write(sub.join("a"), "Host a\n").expect("write");
        std::fs::write(sub.join(".hidden"), "Host hidden\n").expect("write");
        std::fs::write(dir.join("config"), "Include config.d/*\n").expect("write");
        let dirs = Dirs {
            home: &dir,
            ssh: &dir,
        };
        let hosts = parse(&dir.join("config"), &dirs, &FsFiles);
        std::fs::remove_dir_all(&dir).expect("clean up");
        assert_eq!(aliases(&hosts), ["a", "b"]);
    }
}
