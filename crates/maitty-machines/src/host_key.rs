//! A read-only look at a machine's ssh host key: the key it offers (`ssh-keyscan`), its SHA256
//! fingerprint worked out the way ssh prints it, and where it stands against what `known_hosts`
//! already holds for that host. Nothing here writes `known_hosts`: a key ssh has not seen is
//! recorded by ssh itself on the first connection (`new_host_keys`, ADR 0017). The look is what
//! the password-once key setup (`key_login`) checks before it sends anything, and `ssh -G`'s
//! output is read here for `reach` too.
//!
//! `ssh-keyscan` and `ssh-keygen` come with OpenSSH, which is also what Windows 10 and later give
//! as the optional OpenSSH Client; a computer without them gets the reason.

use crate::link_failure::clean;
use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long each of the tools may take.
pub const TOOL_LIMIT: Duration = Duration::from_secs(12);
const MOST_OUTPUT_BYTES: u64 = 64 * 1024;
const POLL: Duration = Duration::from_millis(25);
const DEFAULT_SSH_PORT: u16 = 22;
/// The key types the look asks for and accepts, best first (the order ssh itself prefers).
const KEY_TYPES: [&str; 5] = [
    "ssh-ed25519",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
    "ssh-rsa",
];

/// A public host key: its type and its body as base64, as `known_hosts` writes them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKey {
    pub key_type: String,
    pub body: String,
}

impl HostKey {
    /// `SHA256:` and the base64 of the hash of the key, without padding: exactly what ssh shows.
    pub fn fingerprint(&self) -> String {
        let bytes = STANDARD.decode(&self.body).unwrap_or_default();
        format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(bytes)))
    }
}

/// A key from a `known_hosts` or `ssh-keyscan` line: `host keytype body [comment]`. A line is
/// kept only when the type is one we ask for, the body is base64, and the body names that type.
pub(crate) fn key_of(line: &str) -> Option<HostKey> {
    if line.starts_with('#') {
        return None;
    }
    let mut words = line.split_whitespace();
    let (_host, key_type, body) = (words.next()?, words.next()?, words.next()?);
    if !KEY_TYPES.contains(&key_type) {
        return None;
    }
    let bytes = STANDARD.decode(body).ok()?;
    let named = bytes.get(..4).and_then(|len| {
        let len = u32::from_be_bytes(len.try_into().ok()?) as usize;
        bytes.get(4..4 + len)
    })?;
    (named == key_type.as_bytes()).then(|| HostKey {
        key_type: key_type.to_string(),
        body: body.to_string(),
    })
}

/// The keys in `ssh-keyscan`'s or `ssh-keygen -F`'s output.
pub fn parse_keys(output: &str) -> Vec<HostKey> {
    output.lines().filter_map(key_of).collect()
}

/// The key ssh would prefer to see: the best type among the offered.
pub fn preferred(keys: &[HostKey]) -> Option<&HostKey> {
    KEY_TYPES
        .iter()
        .find_map(|kind| keys.iter().find(|key| key.key_type == *kind))
}

/// Where the offered key stands against what is already known for the host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Standing {
    /// Nothing known of this type: ssh records it on the first connection.
    Unknown,
    /// This very key is already in `known_hosts`.
    Trusted,
    /// A key of the same type is known and it is different: ssh refuses it.
    Changed { known_fingerprint: String },
}

pub fn standing(offered: &HostKey, known: &[HostKey]) -> Standing {
    if known.iter().any(|key| key == offered) {
        return Standing::Trusted;
    }
    match known.iter().find(|key| key.key_type == offered.key_type) {
        Some(other) => Standing::Changed {
            known_fingerprint: other.fingerprint(),
        },
        None => Standing::Unknown,
    }
}

/// How `known_hosts` names a host: bare on port 22, `[host]:port` on any other.
pub fn known_hosts_name(host: &str, port: u16) -> String {
    if port == DEFAULT_SSH_PORT {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// What `ssh -G` resolved for a target: where it really goes, and the file it keeps host keys in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub host: String,
    pub port: u16,
    pub known_hosts: Option<PathBuf>,
}

/// Read `ssh -G`'s output. A machine reached through a jump host or a proxy command is refused:
/// its key is not the one on this computer's path to it, so a scan from here would show the wrong
/// machine's key.
pub fn parse_resolved(output: &str, home: Option<&Path>) -> Result<Resolved> {
    let (mut host, mut port, mut files) = (None, DEFAULT_SSH_PORT, None);
    for line in output.lines() {
        let Some((key, value)) = line.split_once(' ') else { continue };
        let value = value.trim();
        match key {
            "hostname" => host = Some(value.to_string()),
            "port" => port = value.parse().context("ssh gave a port that is not a number")?,
            "userknownhostsfile" => files = value.split_whitespace().next().map(str::to_string),
            "proxyjump" | "proxycommand" if value != "none" => {
                bail!("it is reached through a jump host or a proxy command, so its key cannot be fetched from here")
            }
            _ => {}
        }
    }
    let host = host.context("ssh did not say where it connects")?;
    if !crate::machine_target::valid_host(&host) {
        bail!("ssh resolved the host to {host:?}, which is not a host name or address");
    }
    Ok(Resolved {
        host,
        port,
        known_hosts: files.and_then(|file| known_hosts_file(&file, home)),
    })
}

/// The file named by `UserKnownHostsFile`: `~` is the home folder; for `none`, `/dev/null` and
/// anything with an ssh `%` token the usual file is read instead.
fn known_hosts_file(setting: &str, home: Option<&Path>) -> Option<PathBuf> {
    if setting == "none" || setting == "/dev/null" || setting.contains('%') {
        return default_known_hosts(home);
    }
    match setting.strip_prefix("~/") {
        Some(rest) => home.map(|home| home.join(rest)),
        None => Some(PathBuf::from(setting)),
    }
}

fn default_known_hosts(home: Option<&Path>) -> Option<PathBuf> {
    home.map(|home| home.join(".ssh").join("known_hosts"))
}

/// What a look found: where the machine is, the key it offers and its standing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inspection {
    pub host: String,
    pub port: u16,
    pub key: HostKey,
    pub fingerprint: String,
    pub standing: Standing,
}

/// The programs the look runs. `ssh` is the machine's own program with its leading arguments.
#[derive(Debug, Clone)]
pub struct Tools {
    pub keyscan: String,
    pub keygen: String,
}

impl Default for Tools {
    fn default() -> Tools {
        Tools {
            keyscan: "ssh-keyscan".to_string(),
            keygen: "ssh-keygen".to_string(),
        }
    }
}

fn home() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf())
}

/// Look at the machine reached by `ssh` (program and leading arguments) and `target`.
pub fn inspect(ssh: &[String], target: &str, tools: &Tools, limit: Duration) -> Result<Inspection> {
    inspect_at(ssh, target, tools, limit, home().as_deref())
}

fn inspect_at(
    ssh: &[String],
    target: &str,
    tools: &Tools,
    limit: Duration,
    home: Option<&Path>,
) -> Result<Inspection> {
    crate::machine_target::check_target(target).map_err(anyhow::Error::msg)?;
    let (program, leading) = ssh.split_first().context("no ssh program")?;
    let mut args: Vec<String> = leading.to_vec();
    args.extend(["-G".to_string(), "--".to_string(), target.to_string()]);
    let resolved = run(program, &args, limit).context("asking ssh where it connects")?;
    let resolved = parse_resolved(&resolved.out, home)?;
    let known_hosts = resolved
        .known_hosts
        .clone()
        .context("could not tell which known_hosts file ssh uses")?;

    let scan_args = vec![
        "-T".to_string(),
        limit.as_secs().min(30).to_string(),
        "-p".to_string(),
        resolved.port.to_string(),
        "-t".to_string(),
        "ed25519,ecdsa,rsa".to_string(),
        "--".to_string(),
        resolved.host.clone(),
    ];
    let scanned = run(&tools.keyscan, &scan_args, limit)
        .with_context(|| format!("running {} (is the OpenSSH client installed?)", tools.keyscan))?;
    let offered = parse_keys(&scanned.out);
    let key = preferred(&offered)
        .cloned()
        .context("the machine did not offer a host key (is its ssh server running?)")?;

    let known = known_keys(tools, &known_hosts, &resolved, limit)?;
    Ok(Inspection {
        fingerprint: key.fingerprint(),
        standing: standing(&key, &known),
        host: resolved.host,
        port: resolved.port,
        key,
    })
}

/// What `known_hosts` already holds for the host, asked of `ssh-keygen -F` so hashed entries work.
fn known_keys(tools: &Tools, file: &Path, resolved: &Resolved, limit: Duration) -> Result<Vec<HostKey>> {
    if !file.exists() {
        return Ok(Vec::new());
    }
    let args = vec![
        "-F".to_string(),
        known_hosts_name(&resolved.host, resolved.port),
        "-f".to_string(),
        file.display().to_string(),
    ];
    let found = run(&tools.keygen, &args, limit)
        .with_context(|| format!("running {} (is the OpenSSH client installed?)", tools.keygen))?;
    Ok(parse_keys(&found.out))
}

/// What a tool printed.
struct Ran {
    out: String,
}

/// Run a program to its end within `limit`, with nothing on its stdin. A status other than 0 or 1
/// is an error carrying its cleaned stderr (`ssh-keygen -F` says 1 for "not found").
fn run(program: &str, args: &[String], limit: Duration) -> Result<Ran> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().with_context(|| format!("starting {program}"))?;
    let out = drain(child.stdout.take());
    let err = drain(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait().context("waiting for the program")? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            bail!("{program} did not answer in {} seconds", limit.as_secs());
        }
        std::thread::sleep(POLL);
    };
    let out = out.join().unwrap_or_default();
    let err = err.join().unwrap_or_default();
    match status.code() {
        Some(0 | 1) => Ok(Ran { out }),
        _ => bail!("{program} failed: {}", clean(&err)),
    }
}

fn drain<R: Read + Send + 'static>(stream: Option<R>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut text = String::new();
        if let Some(stream) = stream {
            let _ = stream.take(MOST_OUTPUT_BYTES).read_to_string(&mut text);
        }
        text
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// GitHub's published ed25519 host key and the fingerprint ssh prints for it.
    const GITHUB_BODY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    const GITHUB_PRINT: &str = "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU";

    fn github() -> HostKey {
        HostKey { key_type: "ssh-ed25519".into(), body: GITHUB_BODY.into() }
    }

    /// A different but well-formed ed25519 body: the same type name, other key bytes.
    fn other() -> HostKey {
        let mut bytes = STANDARD.decode(GITHUB_BODY).unwrap();
        *bytes.last_mut().unwrap() ^= 0xff;
        HostKey { key_type: "ssh-ed25519".into(), body: STANDARD.encode(bytes) }
    }

    #[test]
    fn the_fingerprint_is_the_one_ssh_prints() {
        assert_eq!(github().fingerprint(), GITHUB_PRINT);
    }

    #[test]
    fn scan_output_gives_keys_and_skips_comments_and_other_types_and_bad_bodies() {
        let out = format!(
            "# box:22 SSH-2.0-OpenSSH_9.6\nbox ssh-ed25519 {GITHUB_BODY}\nbox ssh-dss AAAA\nbox ssh-ed25519 not-base64!\nbox ssh-rsa {GITHUB_BODY}\n"
        );
        // The last has a body that names ed25519, not rsa: it is not that key.
        assert_eq!(parse_keys(&out), vec![github()]);
    }

    #[test]
    fn the_best_type_offered_is_the_one_shown() {
        let rsa = HostKey { key_type: "ssh-rsa".into(), body: "x".into() };
        assert_eq!(preferred(&[rsa.clone(), github()]), Some(&github()));
        assert_eq!(preferred(std::slice::from_ref(&rsa)), Some(&rsa));
        assert_eq!(preferred(&[]), None);
    }

    #[test]
    fn a_key_is_unknown_trusted_or_changed_and_a_changed_one_names_the_old_print() {
        assert_eq!(standing(&github(), &[]), Standing::Unknown);
        assert_eq!(standing(&github(), &[github()]), Standing::Trusted);
        assert_eq!(
            standing(&github(), &[other()]),
            Standing::Changed { known_fingerprint: other().fingerprint() }
        );
        let rsa = HostKey { key_type: "ssh-rsa".into(), body: "x".into() };
        assert_eq!(standing(&github(), &[rsa]), Standing::Unknown);
    }

    #[test]
    fn known_hosts_names_a_port_other_than_22_in_brackets() {
        assert_eq!(known_hosts_name("box", 22), "box");
        assert_eq!(known_hosts_name("10.0.0.5", 2222), "[10.0.0.5]:2222");
    }

    #[test]
    fn ssh_g_gives_the_real_host_port_and_file_and_refuses_a_jump() {
        let home = Path::new("/home/me");
        let out = "user me\nhostname 100.78.214.15\nport 2222\nuserknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2\nproxyjump none\n";
        assert_eq!(
            parse_resolved(out, Some(home)).unwrap(),
            Resolved { host: "100.78.214.15".into(), port: 2222, known_hosts: Some(home.join(".ssh/known_hosts")) }
        );
        assert!(parse_resolved("hostname box\nproxyjump gate\n", Some(home)).is_err());
        assert!(parse_resolved("hostname box\nproxycommand nc %h %p\n", Some(home)).is_err());
        assert!(parse_resolved("hostname -oProxyCommand=x\n", Some(home)).is_err());
        let none = parse_resolved("hostname box\nuserknownhostsfile /dev/null\n", Some(home)).unwrap();
        assert_eq!(none.known_hosts, Some(home.join(".ssh/known_hosts")), "never the null file, never a guessed one");
    }

    /// Fake ssh, ssh-keyscan and ssh-keygen as shell scripts, so the whole look runs without a
    /// network.
    #[cfg(unix)]
    mod with_tools {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        struct Rig {
            dir: PathBuf,
            ssh: Vec<String>,
            tools: Tools,
            known_hosts: PathBuf,
        }

        fn script(path: &Path, body: &str) {
            std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        /// `scanned` is what the machine offers; `known` is what known_hosts holds (a line).
        fn rig(label: &str, scanned: &HostKey, known: Option<&HostKey>) -> Rig {
            let dir = std::env::temp_dir().join(format!("host-key-{label}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join(".ssh")).unwrap();
            let known_hosts = dir.join(".ssh").join("known_hosts");
            let ssh = dir.join("ssh");
            script(&ssh, &format!("echo hostname box.example\necho port 22\necho userknownhostsfile {}", known_hosts.display()));
            let keyscan = dir.join("ssh-keyscan");
            script(&keyscan, &format!("echo 'box.example {} {}'", scanned.key_type, scanned.body));
            let keygen = dir.join("ssh-keygen");
            match known {
                Some(key) => {
                    std::fs::write(&known_hosts, format!("box.example {} {}\n", key.key_type, key.body)).unwrap();
                    script(&keygen, &format!("echo '# Host box.example found: line 1'\necho 'box.example {} {}'", key.key_type, key.body));
                }
                None => script(&keygen, "exit 1"),
            }
            Rig {
                tools: Tools { keyscan: keyscan.display().to_string(), keygen: keygen.display().to_string() },
                ssh: vec![ssh.display().to_string()],
                known_hosts,
                dir,
            }
        }

        #[test]
        fn an_unknown_key_is_shown_and_the_look_writes_nothing() {
            let rig = rig("unknown", &github(), None);
            let seen = inspect_at(&rig.ssh, "dev@box.example", &rig.tools, Duration::from_secs(5), Some(&rig.dir)).unwrap();
            assert_eq!((seen.standing.clone(), seen.fingerprint.as_str()), (Standing::Unknown, GITHUB_PRINT));
            assert!(!rig.known_hosts.exists(), "nothing was added");
        }

        #[test]
        fn a_changed_key_is_shown_as_changed_and_known_hosts_is_left_as_it_was() {
            let rig = rig("changed", &github(), Some(&other()));
            let before = std::fs::read_to_string(&rig.known_hosts).unwrap();
            let seen = inspect_at(&rig.ssh, "dev@box.example", &rig.tools, Duration::from_secs(5), Some(&rig.dir)).unwrap();
            assert_eq!(seen.standing, Standing::Changed { known_fingerprint: other().fingerprint() });
            assert_eq!(std::fs::read_to_string(&rig.known_hosts).unwrap(), before);
        }

        #[test]
        fn a_key_already_trusted_is_reported_and_left_alone() {
            let rig = rig("trusted", &github(), Some(&github()));
            let seen = inspect_at(&rig.ssh, "box.example", &rig.tools, Duration::from_secs(5), Some(&rig.dir)).unwrap();
            assert_eq!(seen.standing, Standing::Trusted);
        }

        #[test]
        fn an_option_shaped_target_is_refused_before_any_program_runs() {
            let rig = rig("option", &github(), None);
            let error = inspect_at(&rig.ssh, "-oProxyCommand=x", &rig.tools, Duration::from_secs(5), Some(&rig.dir)).unwrap_err();
            assert!(format!("{error:#}").contains("not a host"), "{error:#}");
        }
    }
}
