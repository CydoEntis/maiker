//! Key login set up once with a password: for a machine whose ssh only takes a password, the
//! person types the account password a single time, this installs their PUBLIC key in the
//! machine's `authorized_keys`, and every connection after that uses the key.
//!
//! How the password is kept out of harm's way:
//! - It is a `Secret`: no `Debug`, `Clone` or `Serialize`, overwritten when dropped, held only for
//!   the one operation.
//! - It never goes in ssh's arguments, a file, a log or an error. ssh gets it through
//!   `SSH_ASKPASS` (with `SSH_ASKPASS_REQUIRE=force`, OpenSSH 8.4 and later): a small helper script
//!   with no secret in it prints the password from an environment variable that is set on that one
//!   short-lived ssh process and nothing else. Every text that leaves here is scrubbed of it.
//! - Host-key checking is on (`StrictHostKeyChecking=yes`): the host key must already be trusted.
//!   Nothing here turns it off.
//!
//! The askpass helper is a shell script, so setting up from a Windows computer is not supported
//! here (`unavailable_reason`): that computer uses the terminal. A Windows machine as the far side
//! is supported (its OS and whether the account is an administrator are asked with fixed commands).

use crate::host_key::{HostKey, key_of};
use crate::link_failure::clean;
use anyhow::{Context, Result, bail};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// How long each ssh step may take.
pub const STEP_LIMIT: Duration = Duration::from_secs(25);
/// The most a password can be; a longer one is refused at the boundary.
pub const MOST_PASSWORD_BYTES: usize = 256;
/// Wrong passwords allowed in a row before further tries are refused.
pub const MOST_WRONG: u32 = 3;
const MOST_OUTPUT_BYTES: u64 = 64 * 1024;
const POLL: Duration = Duration::from_millis(25);
/// Printed by the install scripts so success is told by a word, not by guessing from silence.
const ADDED: &str = "MAIKER_KEY_ADDED";
const PRESENT: &str = "MAIKER_KEY_PRESENT";
const SECRET_ENV: &str = "MAIKER_ASKPASS_SECRET";
/// The key files tried, best first.
const KEY_FILES: [&str; 3] = ["id_ed25519", "id_ecdsa", "id_rsa"];
const NEW_KEY_FILE: &str = "id_ed25519";
const NEW_KEY_COMMENT: &str = "maiker";
const WINDOWS_ADMIN_GROUP_SID: &str = "S-1-5-32-544";

/// Why the password step cannot run on this computer, if it cannot.
pub fn unavailable_reason() -> Option<&'static str> {
    cfg!(windows).then_some(
        "Setting up a key from a Windows computer is not supported here: the password is handed to ssh through a shell script. Use the terminal once (ssh-copy-id is not on Windows; add your public key to the machine's authorized_keys).",
    )
}

/// An account password held for one operation.
pub struct Secret(Vec<u8>);

impl Secret {
    /// Take a password; one that is empty, too long or has a control character is refused.
    pub fn new(mut text: String) -> Result<Secret> {
        let bytes = std::mem::take(&mut text).into_bytes();
        let bad = bytes.is_empty()
            || bytes.len() > MOST_PASSWORD_BYTES
            || bytes.iter().any(|b| b.is_ascii_control());
        if bad {
            let mut bytes = bytes;
            bytes.fill(0);
            bail!("type the account password (up to {MOST_PASSWORD_BYTES} characters, no control characters)");
        }
        Ok(Secret(bytes))
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0).into_owned()
    }

    /// `text` with every copy of the password replaced, for anything that may be shown.
    pub fn scrub(&self, text: &str) -> String {
        text.replace(&self.text(), "[password]")
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.fill(0);
        std::hint::black_box(&self.0);
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// A public key, ready to be written to a machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicKey {
    pub key: HostKey,
    pub comment: String,
}

impl PublicKey {
    /// The `authorized_keys` line: type, body, comment.
    pub fn line(&self) -> String {
        format!("{} {} {}", self.key.key_type, self.key.body, self.comment)
    }
    pub fn fingerprint(&self) -> String {
        self.key.fingerprint()
    }
}

/// Read the first line of a `.pub` file. Only the type and body are trusted; the comment is kept
/// when it is plain, so it cannot carry anything into the remote script.
pub fn parse_public_key(text: &str) -> Option<PublicKey> {
    let line = text.lines().next()?.trim();
    let key = key_of(&format!("x {line}"))?;
    let comment = line
        .split_whitespace()
        .nth(2)
        .filter(|c| c.len() <= 64 && c.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '@' | '.' | '_' | '+' | '-')))
        .unwrap_or(NEW_KEY_COMMENT)
        .to_string();
    Some(PublicKey { key, comment })
}

/// Whether a private key file needs a passphrase.
#[derive(Debug, PartialEq, Eq)]
pub enum Protection {
    None,
    Passphrase,
    /// The file is not in a form this can read.
    Unknown,
}

/// Tell from a private key's text whether it is encrypted, without needing the passphrase.
pub fn protection_of(private: &str) -> Protection {
    if private.contains("ENCRYPTED") {
        return Protection::Passphrase;
    }
    const BEGIN: &str = "-----BEGIN OPENSSH PRIVATE KEY-----";
    const END: &str = "-----END OPENSSH PRIVATE KEY-----";
    const MAGIC: &[u8] = b"openssh-key-v1\0";
    let Some(body) = private.split(BEGIN).nth(1).and_then(|rest| rest.split(END).next()) else {
        return Protection::Unknown;
    };
    let joined: String = body.split_whitespace().collect();
    let Ok(bytes) = STANDARD.decode(joined) else { return Protection::Unknown };
    let Some(rest) = bytes.strip_prefix(MAGIC) else { return Protection::Unknown };
    let cipher = rest.get(..4).and_then(|len| {
        let len = u32::from_be_bytes(len.try_into().ok()?) as usize;
        rest.get(4..4 + len)
    });
    match cipher {
        Some(b"none") => Protection::None,
        Some(_) => Protection::Passphrase,
        None => Protection::Unknown,
    }
}

/// What this computer has to offer.
#[derive(Debug, PartialEq, Eq)]
pub enum LocalKey {
    /// Usable: its public key and where it is.
    Ready { path: PathBuf, key: PublicKey },
    /// The private key has a passphrase; this ticket does not handle those.
    Encrypted { path: PathBuf },
    /// No key at all; one can be created at `path`.
    Missing { path: PathBuf },
    /// Something is there that cannot be used or safely replaced.
    Blocked { reason: String },
}

/// `~/.ssh` of the person running the app.
pub fn default_ssh_dir() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".ssh"))
}

/// Look in `ssh_dir` (usually `~/.ssh`) for the key to install.
pub fn local_key(ssh_dir: &Path) -> LocalKey {
    for name in KEY_FILES {
        let private = ssh_dir.join(name);
        let public = ssh_dir.join(format!("{name}.pub"));
        match (private.exists(), public.exists()) {
            (false, false) => continue,
            (true, true) => {}
            _ => {
                return LocalKey::Blocked {
                    reason: format!("{name} and {name}.pub are not both in {}; fix that, or use the terminal", ssh_dir.display()),
                };
            }
        }
        let private_text = match std::fs::read_to_string(&private) {
            Ok(text) => text,
            Err(e) => return LocalKey::Blocked { reason: format!("could not read {}: {e}", private.display()) },
        };
        match protection_of(&private_text) {
            Protection::Passphrase => return LocalKey::Encrypted { path: private },
            Protection::Unknown => {
                return LocalKey::Blocked { reason: format!("{} is not in a form Maiker can check for a passphrase", private.display()) };
            }
            Protection::None => {}
        }
        return match std::fs::read_to_string(&public).ok().as_deref().and_then(parse_public_key) {
            Some(key) => LocalKey::Ready { path: private, key },
            None => LocalKey::Blocked { reason: format!("{} is not a public key Maiker understands", public.display()) },
        };
    }
    LocalKey::Missing { path: ssh_dir.join(NEW_KEY_FILE) }
}

/// Create an ed25519 key with no passphrase at `private` (only when nothing is there).
pub fn create_key(keygen: &str, private: &Path, limit: Duration) -> Result<()> {
    if private.exists() || private.with_extension("pub").exists() || PathBuf::from(format!("{}.pub", private.display())).exists() {
        bail!("a key is already at {}; Maiker will not replace it", private.display());
    }
    if let Some(folder) = private.parent() {
        make_private_dir(folder)?;
    }
    let args = [
        "-q".to_string(),
        "-t".to_string(),
        "ed25519".to_string(),
        "-N".to_string(),
        String::new(),
        "-C".to_string(),
        NEW_KEY_COMMENT.to_string(),
        "-f".to_string(),
        private.display().to_string(),
    ];
    let done = capture(keygen, &args, &[], None, limit).with_context(|| format!("running {keygen} (is the OpenSSH client installed?)"))?;
    if done.code != Some(0) {
        bail!("{keygen} could not create the key: {}", clean(&done.err));
    }
    Ok(())
}

#[cfg(unix)]
fn make_private_dir(folder: &Path) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(folder).with_context(|| format!("making {}", folder.display()))
}

#[cfg(not(unix))]
fn make_private_dir(folder: &Path) -> Result<()> {
    std::fs::create_dir_all(folder).with_context(|| format!("making {}", folder.display()))
}

/// The machine's system, told by fixed commands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Remote {
    Unix,
    Windows { admin: bool },
}

/// How a run came out.
#[derive(Debug, PartialEq, Eq)]
pub enum Installed {
    /// Added now, or already there; verified by a key login.
    Done { added: bool },
    WrongPassword,
    /// Could not do it safely: the reason and the steps to do it by hand.
    Manual { reason: String, steps: String },
    /// Installed, but the key login did not work after.
    NotVerified { message: String },
}

/// The captured end of a process.
struct Captured {
    code: Option<i32>,
    out: String,
    err: String,
}

/// Run a program within `limit` with `env` set on it alone and `stdin` fed to it, returning its
/// status and what it printed. Nothing here reads or logs `env`.
fn capture(program: &str, args: &[String], env: &[(&str, String)], stdin: Option<&str>, limit: Duration) -> Result<Captured> {
    let mut command = Command::new(program);
    command.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    command.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });
    for (key, value) in env {
        command.env(key, value);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().with_context(|| format!("starting {program}"))?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        // A write that fails is the program having exited early; its status says why.
        let _ = pipe.write_all(text.as_bytes());
    }
    let out = drain(child.stdout.take());
    let err = drain(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait().context("waiting for ssh")? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            bail!("{program} did not finish in {} seconds", limit.as_secs());
        }
        std::thread::sleep(POLL);
    };
    Ok(Captured {
        code: status.code(),
        out: out.join().unwrap_or_default(),
        err: err.join().unwrap_or_default(),
    })
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

/// The one-shot askpass helper: a folder only this user can open, holding a script that prints
/// the password from the environment. The script has no secret in it; the folder is removed when
/// this is dropped.
struct Askpass {
    dir: PathBuf,
    script: PathBuf,
}

impl Askpass {
    #[cfg(unix)]
    fn make() -> Result<Askpass> {
        use std::os::unix::fs::{OpenOptionsExt, DirBuilderExt};
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        let dir = std::env::temp_dir().join(format!("maiker-askpass-{}-{nonce}", std::process::id()));
        std::fs::DirBuilder::new().mode(0o700).create(&dir).context("making a private folder for ssh's password helper")?;
        let script = dir.join("askpass");
        let body = format!("#!/bin/sh\nprintf '%s\\n' \"${SECRET_ENV}\"\n");
        let written = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&script)
            .and_then(|mut file| file.write_all(body.as_bytes()));
        if let Err(e) = written {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(e).context("writing ssh's password helper");
        }
        Ok(Askpass { dir, script })
    }

    #[cfg(not(unix))]
    fn make() -> Result<Askpass> {
        bail!(unavailable_reason().unwrap_or("not supported on this computer"))
    }
}

impl Drop for Askpass {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// The options that make this ssh a one-password login and never a trust-on-first-use one.
/// They come first, so they win over any the machine's own arguments repeat (ssh keeps the first).
const PASSWORD_OPTIONS: [&str; 18] = [
    "-o", "BatchMode=no",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "NumberOfPasswordPrompts=1",
    "-o", "PubkeyAuthentication=no",
    "-o", "PreferredAuthentications=password,keyboard-interactive",
    "-o", "ConnectTimeout=15",
    "-o", "ForwardAgent=no",
    "-o", "ControlPath=none",
    "-o", "UpdateHostKeys=no",
];

/// The ssh line for one password step: `ssh <options> <the machine's own args> -a -T -- target command...`.
pub fn password_argv(ssh: &[String], target: &str, command: &[&str]) -> Result<Vec<String>> {
    crate::machine_target::check_target(target).map_err(anyhow::Error::msg)?;
    let (program, leading) = ssh.split_first().context("no ssh program")?;
    let mut argv = vec![program.clone()];
    argv.extend(PASSWORD_OPTIONS.iter().map(|word| word.to_string()));
    argv.extend(leading.iter().cloned());
    argv.extend(["-a".into(), "-T".into(), "--".into(), target.into()]);
    argv.extend(command.iter().map(|word| word.to_string()));
    Ok(argv)
}

/// The line that checks a key login works: no password allowed, a command that does nothing.
pub fn verify_argv(ssh: &[String], target: &str) -> Result<Vec<String>> {
    crate::machine_target::check_target(target).map_err(anyhow::Error::msg)?;
    let (program, leading) = ssh.split_first().context("no ssh program")?;
    let mut argv = vec![program.clone()];
    for word in [
        "-o", "BatchMode=yes",
        "-o", "PasswordAuthentication=no",
        "-o", "KbdInteractiveAuthentication=no",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=15",
        "-o", "ControlPath=none",
    ] {
        argv.push(word.to_string());
    }
    argv.extend(leading.iter().cloned());
    argv.extend(["-a".into(), "-T".into(), "--".into(), target.into(), "exit".into()]);
    Ok(argv)
}

/// Whether ssh's refusal says a password (or keyboard-interactive) login is on offer: the words of
/// `Permission denied (publickey,password).`
pub fn offers_password(said: &str) -> bool {
    said.lines().any(|line| {
        line.split_once("Permission denied (")
            .and_then(|(_, rest)| rest.split_once(')'))
            .is_some_and(|(methods, _)| methods.split(',').any(|m| m == "password" || m == "keyboard-interactive"))
    })
}

fn denied(said: &str) -> bool {
    said.contains("Permission denied")
}

/// The script (POSIX shell) that adds a key: the folder and file made with the right modes, the key
/// added when its body is not already in the file, and a word printed for what happened.
fn unix_script(key: &PublicKey) -> String {
    let body = &key.key.body;
    let line = key.line();
    format!(
        "umask 077\nmkdir -p \"$HOME/.ssh\" && chmod 700 \"$HOME/.ssh\" || exit 1\nf=\"$HOME/.ssh/authorized_keys\"\ntouch \"$f\" && chmod 600 \"$f\" || exit 1\nif grep -qF -- '{body}' \"$f\"; then echo {PRESENT}; else\n  if [ -s \"$f\" ] && [ \"$(tail -c1 \"$f\" | wc -l)\" -eq 0 ]; then echo >> \"$f\"; fi\n  printf '%s\\n' '{line}' >> \"$f\" && echo {ADDED}\nfi\n"
    )
}

/// The PowerShell that adds a key on a Windows machine: an administrator's own file is under
/// ProgramData with only Administrators and SYSTEM allowed, as sshd requires; anyone else uses
/// the profile's `.ssh\authorized_keys`.
fn windows_script(key: &PublicKey, admin: bool) -> String {
    let body = &key.key.body;
    let line = key.line();
    let (file, acl) = if admin {
        (
            "$f = Join-Path $env:ProgramData 'ssh\\administrators_authorized_keys'; $d = Split-Path $f".to_string(),
            "icacls.exe $f /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null;".to_string(),
        )
    } else {
        ("$d = Join-Path $env:USERPROFILE '.ssh'; $f = Join-Path $d 'authorized_keys'".to_string(), String::new())
    };
    format!(
        "$ErrorActionPreference = 'Stop'; {file}; if (-not (Test-Path $d)) {{ New-Item -ItemType Directory -Force $d | Out-Null }}; if (-not (Test-Path $f)) {{ New-Item -ItemType File $f | Out-Null }}; if (Select-String -LiteralPath $f -SimpleMatch -Pattern '{body}' -Quiet) {{ '{PRESENT}' }} else {{ Add-Content -LiteralPath $f -Value '{line}' -Encoding ascii; '{ADDED}' }}; {acl}\n"
    )
}

/// The exact steps for a person to follow when this cannot do it itself.
pub fn manual_steps(key: &PublicKey, remote: Option<&Remote>) -> String {
    let line = key.line();
    match remote {
        Some(Remote::Windows { admin: true }) => format!(
            "On the machine, in an administrator PowerShell:\n  Add-Content -Path $env:ProgramData\\ssh\\administrators_authorized_keys -Value '{line}'\n  icacls.exe $env:ProgramData\\ssh\\administrators_authorized_keys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F'"
        ),
        Some(Remote::Windows { admin: false }) => format!(
            "On the machine, in PowerShell:\n  New-Item -ItemType Directory -Force $env:USERPROFILE\\.ssh | Out-Null\n  Add-Content -Path $env:USERPROFILE\\.ssh\\authorized_keys -Value '{line}'"
        ),
        _ => format!(
            "On the machine, in a shell:\n  mkdir -p ~/.ssh && chmod 700 ~/.ssh\n  echo '{line}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys\n(If it is a Windows machine, add that line to %USERPROFILE%\\.ssh\\authorized_keys, or for an administrator to %ProgramData%\\ssh\\administrators_authorized_keys.)"
        ),
    }
}

fn password_env(secret: &Secret, askpass: &Askpass) -> Vec<(&'static str, String)> {
    vec![
        ("SSH_ASKPASS", askpass.script.display().to_string()),
        ("SSH_ASKPASS_REQUIRE", "force".to_string()),
        ("DISPLAY", "maiker:0".to_string()),
        (SECRET_ENV, secret.text()),
    ]
}

/// One password step. `Ok(None)` is a wrong password; an error is the failure, scrubbed.
fn step(ssh: &[String], target: &str, command: &[&str], stdin: Option<&str>, secret: &Secret, askpass: &Askpass) -> Result<Option<Captured>> {
    let argv = password_argv(ssh, target, command)?;
    let env = password_env(secret, askpass);
    let done = capture(&argv[0], &argv[1..], &env, stdin, STEP_LIMIT).map_err(|e| anyhow::anyhow!(secret.scrub(&format!("{e:#}"))))?;
    if done.code == Some(255) && denied(&done.err) {
        return Ok(None);
    }
    Ok(Some(done))
}

/// Ask the machine what it is, with fixed commands: `uname -s` for Unix; when that fails, a fixed
/// cmd line that names Windows and says whether the account is an administrator.
fn detect(ssh: &[String], target: &str, secret: &Secret, askpass: &Askpass) -> Result<Option<Option<Remote>>> {
    let Some(first) = step(ssh, target, &["uname", "-s"], None, secret, askpass)? else { return Ok(None) };
    if first.code == Some(0) {
        let system = first.out.trim();
        let plain = !system.is_empty() && system.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
        let unixy = plain && !["MINGW", "MSYS", "CYGWIN"].iter().any(|shell| system.starts_with(shell));
        return Ok(Some(unixy.then_some(Remote::Unix)));
    }
    let Some(second) = step(ssh, target, &["cmd /c \"echo %OS% & whoami /groups\""], None, secret, askpass)? else { return Ok(None) };
    if second.code != Some(0) || !second.out.contains("Windows_NT") {
        return Ok(Some(None));
    }
    let admin = second
        .out
        .lines()
        .any(|line| line.contains(WINDOWS_ADMIN_GROUP_SID) && !line.to_ascii_lowercase().contains("deny only"));
    Ok(Some(Some(Remote::Windows { admin })))
}

/// Install `key` on the machine reached by `ssh` and `target`, with the account `password`; then
/// check a key login works. The host key must already be trusted.
pub fn install(ssh: &[String], target: &str, secret: &Secret, key: &PublicKey) -> Result<Installed> {
    if let Some(reason) = unavailable_reason() {
        bail!("{reason}");
    }
    let askpass = Askpass::make()?;
    let remote = match detect(ssh, target, secret, &askpass)? {
        None => return Ok(Installed::WrongPassword),
        Some(None) => {
            return Ok(Installed::Manual {
                reason: "Maiker could not tell what system the machine runs, so it will not guess where to put the key.".into(),
                steps: manual_steps(key, None),
            });
        }
        Some(Some(remote)) => remote,
    };
    let (command, script): (Vec<&str>, String) = match &remote {
        Remote::Unix => (vec!["sh", "-s"], unix_script(key)),
        Remote::Windows { admin } => (vec!["powershell -NoProfile -NonInteractive -Command -"], windows_script(key, *admin)),
    };
    let Some(done) = step(ssh, target, &command, Some(&script), secret, &askpass)? else { return Ok(Installed::WrongPassword) };
    let said = done.out.trim();
    let added = if said.contains(ADDED) {
        true
    } else if said.contains(PRESENT) {
        false
    } else {
        return Ok(Installed::Manual {
            reason: secret.scrub(&format!("the machine did not confirm the key was added ({})", clean(&done.err))),
            steps: manual_steps(key, Some(&remote)),
        });
    };
    let verify = verify_argv(ssh, target)?;
    let checked = capture(&verify[0], &verify[1..], &[], None, STEP_LIMIT).map_err(|e| anyhow::anyhow!(secret.scrub(&format!("{e:#}"))))?;
    if checked.code == Some(0) {
        return Ok(Installed::Done { added });
    }
    Ok(Installed::NotVerified {
        message: secret.scrub(&format!(
            "the key was put on the machine, but logging in with it still failed ({}). Its ssh server may need its permissions or a restart; the steps by hand are shown",
            clean(&checked.err)
        )),
    })
}

/// How many wrong passwords have been typed for each machine, so a wrong one cannot be tried in
/// a loop. In memory only.
#[derive(Debug, Default)]
pub struct Attempts(std::collections::HashMap<String, u32>);

impl Attempts {
    /// Whether another try is allowed for `name`.
    pub fn allowed(&self, name: &str) -> bool {
        self.0.get(&name.to_ascii_lowercase()).copied().unwrap_or(0) < MOST_WRONG
    }
    /// Count a wrong password; how many tries are left.
    pub fn wrong(&mut self, name: &str) -> u32 {
        let count = self.0.entry(name.to_ascii_lowercase()).or_insert(0);
        *count += 1;
        MOST_WRONG.saturating_sub(*count)
    }
    pub fn forget(&mut self, name: &str) {
        self.0.remove(&name.to_ascii_lowercase());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

    fn key() -> PublicKey {
        parse_public_key(&format!("ssh-ed25519 {BODY} me@laptop")).unwrap()
    }

    #[test]
    fn a_public_key_is_read_and_its_comment_kept_only_when_plain() {
        assert_eq!(key().line(), format!("ssh-ed25519 {BODY} me@laptop"));
        let hostile = parse_public_key(&format!("ssh-ed25519 {BODY} x';rm -rf ~;'")).unwrap();
        assert_eq!(hostile.comment, NEW_KEY_COMMENT);
        assert!(parse_public_key("ssh-ed25519 not-base64 c").is_none());
        assert!(parse_public_key("ssh-dss AAAA c").is_none());
    }

    #[test]
    fn refusal_words_tell_whether_a_password_is_offered() {
        assert!(offers_password("dev@box: Permission denied (publickey,password)."));
        assert!(offers_password("Permission denied (publickey,keyboard-interactive)."));
        assert!(!offers_password("Permission denied (publickey)."));
        assert!(!offers_password("Host key verification failed."));
    }

    #[test]
    fn a_passphrase_on_a_private_key_is_seen_without_the_passphrase() {
        // An OpenSSH key whose cipher is `none`, and one whose cipher is aes256-ctr.
        let wrap = |cipher: &str| {
            let mut raw = b"openssh-key-v1\0".to_vec();
            raw.extend((cipher.len() as u32).to_be_bytes());
            raw.extend(cipher.as_bytes());
            format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n", STANDARD.encode(raw))
        };
        assert_eq!(protection_of(&wrap("none")), Protection::None);
        assert_eq!(protection_of(&wrap("aes256-ctr")), Protection::Passphrase);
        assert_eq!(protection_of("-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n"), Protection::Passphrase);
        assert_eq!(protection_of("garbage"), Protection::Unknown);
    }

    #[test]
    fn the_password_line_puts_the_safe_options_first_and_never_turns_host_checking_off() {
        let ssh = vec!["ssh".to_string(), "-o".into(), "BatchMode=yes".into(), "-p".into(), "2222".into()];
        let argv = password_argv(&ssh, "dev@box", &["uname", "-s"]).unwrap();
        let joined = argv.join(" ");
        assert!(joined.contains("StrictHostKeyChecking=yes") && !joined.contains("StrictHostKeyChecking=no"), "{joined}");
        let first = |word: &str| argv.iter().position(|w| w == word).unwrap();
        assert!(first("BatchMode=no") < first("BatchMode=yes"), "ssh keeps the first value, so ours must come first");
        assert!(argv.iter().position(|w| w == "--").unwrap() < first("dev@box"));
        assert!(password_argv(&ssh, "-oProxyCommand=x", &["true"]).is_err());
    }

    #[test]
    fn the_verify_line_allows_no_password() {
        let argv = verify_argv(&["ssh".to_string()], "dev@box").unwrap().join(" ");
        assert!(argv.contains("PasswordAuthentication=no") && argv.contains("BatchMode=yes"), "{argv}");
    }

    #[test]
    fn the_scripts_check_for_the_key_before_adding_it_and_set_the_modes() {
        let unix = unix_script(&key());
        assert!(unix.contains("chmod 700") && unix.contains("chmod 600") && unix.contains("grep -qF"), "{unix}");
        let admin = windows_script(&key(), true);
        assert!(admin.contains("administrators_authorized_keys") && admin.contains("icacls.exe") && admin.contains("Select-String"), "{admin}");
        let user = windows_script(&key(), false);
        assert!(user.contains("USERPROFILE") && !user.contains("administrators_authorized_keys"), "{user}");
    }

    #[test]
    fn wrong_passwords_are_counted_and_stop_after_three() {
        let mut attempts = Attempts::default();
        assert!(attempts.allowed("Box"));
        assert_eq!(attempts.wrong("box"), 2);
        assert_eq!(attempts.wrong("BOX"), 1);
        assert_eq!(attempts.wrong("box"), 0);
        assert!(!attempts.allowed("box"));
        attempts.forget("box");
        assert!(attempts.allowed("box"));
    }

    #[test]
    fn a_password_has_no_debug_text_and_is_scrubbed_from_what_is_shown() {
        let secret = Secret::new("hunter2-pass".to_string()).unwrap();
        assert!(!format!("{secret:?}").contains("hunter2"));
        assert_eq!(secret.scrub("the host said hunter2-pass back"), "the host said [password] back");
        for bad in ["", "a\nb", &"x".repeat(MOST_PASSWORD_BYTES + 1)] {
            assert!(Secret::new(bad.to_string()).is_err());
        }
    }

    #[test]
    fn a_local_key_is_found_and_a_passphrase_stops_it_and_none_can_be_created() {
        let dir = std::env::temp_dir().join(format!("key-login-local-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(matches!(local_key(&dir), LocalKey::Missing { .. }));
        let private = |cipher: &str| {
            let mut raw = b"openssh-key-v1\0".to_vec();
            raw.extend((cipher.len() as u32).to_be_bytes());
            raw.extend(cipher.as_bytes());
            format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{}\n-----END OPENSSH PRIVATE KEY-----\n", STANDARD.encode(raw))
        };
        std::fs::write(dir.join("id_ed25519"), private("aes256-ctr")).unwrap();
        std::fs::write(dir.join("id_ed25519.pub"), format!("ssh-ed25519 {BODY} me\n")).unwrap();
        assert!(matches!(local_key(&dir), LocalKey::Encrypted { .. }));
        std::fs::write(dir.join("id_ed25519"), private("none")).unwrap();
        assert!(matches!(local_key(&dir), LocalKey::Ready { .. }));
        std::fs::remove_file(dir.join("id_ed25519.pub")).unwrap();
        assert!(matches!(local_key(&dir), LocalKey::Blocked { .. }), "a private key alone is never replaced");
        assert!(create_key("ssh-keygen", &dir.join("id_ed25519"), Duration::from_secs(5)).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A fake ssh that behaves as a machine with a password: it asks the askpass helper for the
    /// password the way ssh does, refuses a wrong one, and logs its arguments and stdin to files.
    #[cfg(unix)]
    mod with_fake_ssh {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        const PASSWORD: &str = "correct horse 9";

        struct Rig {
            dir: PathBuf,
            ssh: Vec<String>,
        }

        /// `os` is what `uname -s` says ("" for a Windows machine: uname then fails).
        fn rig(label: &str, os: &str, key_works: bool, leak: bool) -> Rig {
            let dir = std::env::temp_dir().join(format!("key-login-{label}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let log = dir.join("calls.log");
            let ssh = dir.join("ssh");
            let leak_line = if leak { "echo \"echo of $PW\" >&2" } else { ":" };
            let body = format!(
                r#"#!/bin/sh
echo "ARGV: $*" >> '{log}'
case "$*" in
  *PasswordAuthentication=no*) {verify}; esac
PW=$("$SSH_ASKPASS" "password:")
if [ "$PW" != '{PASSWORD}' ]; then {leak_line}; echo "dev@box: Permission denied (publickey,password)." >&2; exit 255; fi
case "$*" in
  *"uname -s"*) {uname};;
  *"echo %OS%"*) printf 'Windows_NT \r\n  BUILTIN\Administrators  Alias  S-1-5-32-544  Mandatory group, Enabled by default, Enabled group, Group owner\r\n'; exit 0;;
  *"sh -s"*) cat > '{dir}/stdin.sh'; echo MAIKER_KEY_ADDED; exit 0;;
  *powershell*) cat > '{dir}/stdin.ps1'; echo MAIKER_KEY_ADDED; exit 0;;
esac
exit 0
"#,
                log = log.display(),
                dir = dir.display(),
                verify = if key_works { "exit 0" } else { "echo 'Permission denied (publickey).' >&2; exit 255" },
                uname = if os.is_empty() { "echo \"'uname' is not recognized\" >&2; exit 1".to_string() } else { format!("echo {os}; exit 0") },
            );
            std::fs::write(&ssh, body).unwrap();
            std::fs::set_permissions(&ssh, std::fs::Permissions::from_mode(0o755)).unwrap();
            Rig { ssh: vec![ssh.display().to_string(), "-p".into(), "2222".into()], dir }
        }

        fn run(rig: &Rig, password: &str) -> Result<Installed> {
            install(&rig.ssh, "dev@box", &Secret::new(password.to_string()).unwrap(), &key())
        }

        fn log(rig: &Rig) -> String {
            std::fs::read_to_string(rig.dir.join("calls.log")).unwrap_or_default()
        }

        #[test]
        fn a_unix_machine_gets_the_key_over_stdin_and_the_password_is_nowhere_in_the_arguments() {
            let rig = rig("unix", "Linux", true, false);
            assert_eq!(run(&rig, PASSWORD).unwrap(), Installed::Done { added: true });
            let calls = log(&rig);
            assert!(!calls.contains(PASSWORD) && !calls.contains("correct horse"), "the password was in an argument: {calls}");
            assert!(calls.contains("StrictHostKeyChecking=yes") && !calls.contains("StrictHostKeyChecking=no"));
            let script = std::fs::read_to_string(rig.dir.join("stdin.sh")).unwrap();
            assert!(script.contains(BODY) && !script.contains(PASSWORD));
        }

        #[test]
        fn the_password_helper_holds_no_secret_and_its_folder_is_private_and_removed() {
            let helper = Askpass::make().unwrap();
            let dir = helper.dir.clone();
            let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o700);
            let script = std::fs::read_to_string(&helper.script).unwrap();
            assert!(script.contains(SECRET_ENV) && !script.contains(PASSWORD));
            drop(helper);
            assert!(!dir.exists());
        }

        #[test]
        fn a_wrong_password_is_reported_plainly_after_one_try_and_nothing_is_installed() {
            let rig = rig("wrong", "Linux", true, false);
            assert_eq!(run(&rig, "not it").unwrap(), Installed::WrongPassword);
            assert_eq!(log(&rig).matches("ARGV:").count(), 1, "no second try with the same wrong password");
            assert!(!rig.dir.join("stdin.sh").exists());
        }

        #[test]
        fn a_windows_administrator_gets_the_administrators_file() {
            let rig = rig("windows", "", true, false);
            assert_eq!(run(&rig, PASSWORD).unwrap(), Installed::Done { added: true });
            let script = std::fs::read_to_string(rig.dir.join("stdin.ps1")).unwrap();
            assert!(script.contains("administrators_authorized_keys") && script.contains("icacls.exe"), "{script}");
        }

        #[test]
        fn a_machine_that_cannot_be_told_gets_manual_steps_not_a_guess() {
            let rig = rig("unknown", "MINGW64_NT-10.0", true, false);
            let Installed::Manual { steps, .. } = run(&rig, PASSWORD).unwrap() else { panic!("manual") };
            assert!(steps.contains("authorized_keys") && steps.contains(BODY) && !steps.contains(PASSWORD));
            assert!(!rig.dir.join("stdin.sh").exists());
        }

        #[test]
        fn a_key_that_still_does_not_log_in_is_said_plainly() {
            let rig = rig("unverified", "Linux", false, false);
            let Installed::NotVerified { message } = run(&rig, PASSWORD).unwrap() else { panic!("not verified") };
            assert!(message.contains("still failed") && !message.contains(PASSWORD));
        }

        #[test]
        fn a_host_that_echoes_the_password_back_does_not_get_it_into_any_message() {
            let rig = rig("leak", "Linux", true, true);
            // A wrong password makes the fake print the right one on stderr: an error would show it.
            let outcome = run(&rig, "not it").unwrap();
            assert_eq!(outcome, Installed::WrongPassword);
            let shown = format!("{outcome:?}");
            assert!(!shown.contains(PASSWORD));
        }
    }
}
