//! Why a connection to another machine failed, told from ssh's exit status and from whether
//! the far side ever spoke, not from ssh's wording: its words change with version and locale.
//! `classify` is the only place that reads ssh's text, and only for the few tokens that mark a
//! login ssh could not finish alone, a host key ssh refused, or a machine that hung up before
//! ssh could sign in.
//!
//! `sentence` is the only place that words a failure: one sentence that names the machine and
//! says what to do. The terminal app and the desktop app both show it, so they never disagree
//! (ADR 0017).

use crate::machine_target::{split_target, valid_host};
use crate::{APP_COMMAND, NO_DAEMON_EXIT, other_version};
use maitty_shared::brand::APP_NAME;

/// Exit status ssh gives when it could not connect or log in, and its own errors.
const SSH_ERROR: i32 = 255;
/// Exit status a POSIX shell gives when the command is not on the PATH.
const COMMAND_NOT_FOUND: i32 = 127;

/// ssh's words for a login it could not finish without a person.
const LOGIN_TOKENS: [&str; 2] = ["Permission denied", "Too many authentication failures"];
/// ssh's banner for a host key that is not the one on record. Only this means the key changed.
const HOST_KEY_CHANGED: &str = "REMOTE HOST IDENTIFICATION HAS CHANGED";
/// ssh's words for any host key it refused. Without the banner the key is one it has never seen,
/// refused because the person's own config is strict (`StrictHostKeyChecking=yes`, which Maiker
/// keeps) or because the ssh client is too old for `accept-new` and could not ask.
const HOST_KEY_REFUSED: &str = "Host key verification failed";
/// The option that makes ssh show a new host key's fingerprint and ask, whatever the person's
/// config says: on the command line it comes before the config, and ssh keeps the first value.
/// It still refuses a key that changed.
const ASK_FOR_NEW_KEY: &str = "-o StrictHostKeyChecking=ask";
/// ssh's word for a login whose first method (the key) worked and which wants another.
const PARTIAL_SUCCESS: &str = "partial success";
/// The method name ssh lists in `Permission denied (publickey,password)` when a key may log in.
const KEY_METHOD: &str = "publickey";
/// ssh's last line when the far side took the connection and then ended it, before or during
/// the hello: `Connection closed by <host> port <n>`, or `reset` when it did not wait to read.
/// This is what sshd's `MaxStartups` and `PerSourcePenalties` (OpenSSH 9.8+) look like from here.
const HUNG_UP: [&str; 2] = ["Connection closed by ", "Connection reset by "];
/// The host ssh names in `HUNG_UP` when it reached the machine through a proxy or a jump host:
/// the hang-up is then the proxy's, which also hangs up when the machine behind it is down.
const PROXY_PEER: &str = "UNKNOWN";
/// ssh's own line about a hello the far side never sent, the only line that may come before
/// `HUNG_UP` for a machine that ended the connection at once (`ssh_` before OpenSSH 8.0).
const HELLO_EXCHANGE: [&str; 2] = ["kex_exchange_identification:", "ssh_exchange_identification:"];
/// ssh's port when none is given; `known_hosts` names a host on another port `[host]:port`.
const DEFAULT_SSH_PORT: u16 = 22;
/// On Windows there is no `ssh-copy-id`; the key is the one `ssh-keygen` makes by default.
const WINDOWS_PUBLIC_KEY: &str = r"$env:USERPROFILE\.ssh\id_ed25519.pub";

/// Longest reason kept: ssh's last line is shown on screen.
const MOST_WHY_CHARS: usize = 200;

/// What ssh ended with, carried on the error `open_to` returns.
#[derive(Debug)]
pub struct SshEnd {
    /// ssh's exit status; `None` while it was still running, or when a signal ended it.
    pub code: Option<i32>,
    /// Everything ssh wrote to stderr.
    pub said: String,
    /// The far side sent its stream marker or a frame before the end.
    pub streamed: bool,
    /// The text shown for the failure.
    pub message: String,
    /// The machine is reached through its own `via` program, not ssh: ssh's words and its
    /// exit status 255 mean nothing from it.
    pub custom: bool,
}

impl std::fmt::Display for SshEnd {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SshEnd {}

/// What to do about a failed connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FailureClass {
    /// The machine would not take this computer's key. Carries ssh's own last line.
    KeyRefused(String),
    /// The login wants a password or a second code (Duo, a one-time code), which only a person
    /// can give. Carries ssh's own last line.
    NeedsPerson(String),
    /// The machine's host key is not the one on record, so ssh refused it. Carries the host as
    /// `known_hosts` names it, when ssh said so.
    HostKeyChanged { known_as: Option<String> },
    /// ssh has never seen the machine's host key and the person's own settings do not let it
    /// record one without asking, so it refused it. Nothing about the key is wrong.
    HostKeyUnknown,
    /// The far side runs an older version of the app.
    Update,
    /// The far side runs a newer version of the app than this computer.
    UpdateHere,
    /// The far side has no app on its PATH.
    Install,
    /// Putting the app there, or starting it, failed, with why.
    InstallFailed(String),
    /// The app is installed there but its daemon is not running.
    NoDaemon,
    /// The machine did not answer, with why.
    Unreachable(String),
    /// The machine took the connection and ended it before ssh could sign in: it may be
    /// refusing new connections for a while (after failed sign-ins, or too many at once).
    RefusingConnections,
    /// The window turned the machine away (a different machine answers at its name), with why.
    Refused(String),
}

impl FailureClass {
    /// A login ssh could not finish alone: dials wait for a person instead of carrying on.
    pub fn is_login(&self) -> bool {
        matches!(
            self,
            FailureClass::KeyRefused(_)
                | FailureClass::NeedsPerson(_)
                | FailureClass::HostKeyChanged { .. }
                | FailureClass::HostKeyUnknown
        )
    }

    /// ssh's own last line, for a login it could not finish.
    pub fn said(&self) -> Option<&str> {
        match self {
            FailureClass::KeyRefused(said) | FailureClass::NeedsPerson(said) => Some(said),
            _ => None,
        }
    }

    /// One stable word per class, for a window that picks its button by it.
    pub fn kind(&self) -> &'static str {
        match self {
            FailureClass::KeyRefused(_) => "key-refused",
            FailureClass::NeedsPerson(_) => "needs-person",
            FailureClass::HostKeyChanged { .. } => "host-key-changed",
            FailureClass::HostKeyUnknown => "host-key-unknown",
            FailureClass::Update => "update",
            FailureClass::UpdateHere => "update-here",
            FailureClass::Install => "install",
            FailureClass::InstallFailed(_) => "install-failed",
            FailureClass::NoDaemon => "not-running",
            FailureClass::Unreachable(_) => "unreachable",
            FailureClass::RefusingConnections => "refusing-connections",
            FailureClass::Refused(_) => "refused",
        }
    }
}

pub fn classify(error: &anyhow::Error) -> FailureClass {
    if let Some(theirs) = other_version(error) {
        return if theirs > maitty_shared::protocol::PROTOCOL_VERSION {
            FailureClass::UpdateHere
        } else {
            FailureClass::Update
        };
    }
    let Some(end) = error.downcast_ref::<SshEnd>() else {
        return FailureClass::Unreachable(clean(&format!("{error:#}")));
    };
    let from_ssh = end.code == Some(SSH_ERROR) && !end.custom && !end.streamed;
    match end.code {
        Some(COMMAND_NOT_FOUND) => FailureClass::Install,
        Some(NO_DAEMON_EXIT) => FailureClass::NoDaemon,
        _ if from_ssh && end.said.contains(HOST_KEY_CHANGED) => FailureClass::HostKeyChanged {
            known_as: known_hosts_name(&end.said),
        },
        _ if from_ssh && end.said.contains(HOST_KEY_REFUSED) => FailureClass::HostKeyUnknown,
        _ if from_ssh && says_any(&end.said, &LOGIN_TOKENS) => {
            if needs_a_person(&end.said) {
                FailureClass::NeedsPerson(last_line(end))
            } else {
                FailureClass::KeyRefused(last_line(end))
            }
        }
        _ if from_ssh && hung_up_at_once(&end.said) => FailureClass::RefusingConnections,
        _ => FailureClass::Unreachable(last_line(end)),
    }
}

/// The far side took the connection and ended it with nothing else said: ssh's last line is
/// `HUNG_UP` naming the machine itself (not a proxy), and only ssh's line about the hello may
/// come before it. A line that a host key was added, or any other, means the hello got further.
/// A firewall ban (fail2ban's usual one) is not this: it refuses or drops the connection, which
/// reads as any machine that is off or unreachable.
fn hung_up_at_once(said: &str) -> bool {
    let lines: Vec<&str> = said.lines().map(str::trim).filter(|line| !line.is_empty()).collect();
    let Some((last, before)) = lines.split_last() else {
        return false;
    };
    let names_the_machine = HUNG_UP
        .iter()
        .find_map(|words| last.strip_prefix(words))
        .and_then(|rest| rest.rsplit_once(" port "))
        .is_some_and(|(host, port)| {
            !host.is_empty() && !host.contains(' ') && host != PROXY_PEER && port.parse::<u16>().is_ok()
        });
    names_the_machine
        && before
            .iter()
            .all(|line| HELLO_EXCHANGE.iter().any(|prefix| line.starts_with(prefix)))
}

fn says_any(said: &str, tokens: &[&str]) -> bool {
    tokens.iter().any(|token| said.contains(token))
}

/// A login that a key alone cannot finish: the key worked and another method is wanted (a
/// second code), or the machine offers no key login at all (`Permission denied (password)`).
fn needs_a_person(said: &str) -> bool {
    if said.contains(PARTIAL_SUCCESS) {
        return true;
    }
    let Some((_, after)) = said.rsplit_once("Permission denied (") else {
        return false;
    };
    let methods = after.split(')').next().unwrap_or_default();
    !methods.split(',').any(|method| method.trim() == KEY_METHOD)
}

/// The host as `known_hosts` names it, from ssh's own `ssh-keygen ... -R <host>` advice; None
/// when ssh gave none, or one that is not a plain host.
fn known_hosts_name(said: &str) -> Option<String> {
    let line = said.lines().rev().find(|line| line.contains(" -R "))?;
    let (_, after) = line.rsplit_once(" -R ")?;
    let host = after.trim().trim_matches(|c| c == '\'' || c == '"');
    plain_known_host(host).then(|| host.to_string())
}

/// A host, or `[host]:port`, with nothing a shell could read as more than a word.
fn plain_known_host(host: &str) -> bool {
    match host.strip_prefix('[').and_then(|rest| rest.split_once("]:")) {
        Some((name, port)) => valid_host(name) && port.parse::<u16>().is_ok(),
        None => valid_host(host),
    }
}

/// ssh's last non-empty line, cleaned for the screen; the message when ssh said nothing.
fn last_line(end: &SshEnd) -> String {
    end.said
        .lines()
        .rev()
        .map(clean)
        .find(|line| !line.is_empty())
        .unwrap_or_else(|| clean(&end.message))
}

/// The system the person reads the sentence on: a fix command must run in its shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientOs {
    Windows,
    Unix,
}

impl ClientOs {
    /// The system this app runs on.
    pub const fn this() -> ClientOs {
        if cfg!(windows) {
            ClientOs::Windows
        } else {
            ClientOs::Unix
        }
    }
}

/// The machine a sentence is about, as the person knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Subject<'a> {
    pub name: &'a str,
    /// How it is reached over ssh (`user@host`, a host, or an alias); None for a custom
    /// transport, which has no ssh command to give.
    pub target: Option<&'a str>,
    /// The ssh port, when it is not the default.
    pub port: Option<u16>,
}

impl<'a> Subject<'a> {
    pub fn of(machine: &'a crate::Machine) -> Subject<'a> {
        Subject {
            name: machine.name(),
            target: machine.target(),
            port: machine.ssh_parts().and_then(|(ssh, _)| crate::machine_target::port_in(ssh)),
        }
    }

    pub fn of_def(def: &'a crate::MachineDef) -> Subject<'a> {
        Subject {
            name: &def.name,
            target: def.via.is_none().then_some(def.target.as_str()),
            port: crate::machine_target::port_in(&def.ssh_args),
        }
    }

    /// The target, only when every character of it is safe in a command line to copy.
    fn plain_target(&self) -> Option<&'a str> {
        self.target
            .filter(|target| crate::machine_target::check_target(target).is_ok())
    }

    fn port_flag(&self) -> String {
        match self.port {
            Some(port) if port != DEFAULT_SSH_PORT => format!("-p {port} "),
            _ => String::new(),
        }
    }

    /// The host as `known_hosts` names it: `host`, or `[host]:port` on another port.
    fn known_host(&self) -> Option<String> {
        let (_, host) = split_target(self.plain_target()?);
        Some(match self.port {
            Some(port) if port != DEFAULT_SSH_PORT => format!("[{host}]:{port}"),
            _ => host.to_string(),
        })
    }
}

/// The one command the sentence of `failure` asks the person to run, for a Copy button; None
/// when the fix is not one command.
pub fn fix_command(failure: &FailureClass, subject: &Subject<'_>, os: ClientOs) -> Option<String> {
    let name = subject.name;
    match failure {
        FailureClass::KeyRefused(_) => {
            let target = subject.plain_target()?;
            let port = subject.port_flag();
            Some(match os {
                ClientOs::Unix => format!("ssh-copy-id {port}{target}"),
                ClientOs::Windows => format!(
                    "Get-Content {WINDOWS_PUBLIC_KEY} | ssh {port}{target} \"mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys\""
                ),
            })
        }
        FailureClass::HostKeyChanged { known_as } => {
            let host = known_as.clone().or_else(|| subject.known_host())?;
            // Quoted: `[host]:port` is a pattern to an unquoted shell word.
            Some(format!("ssh-keygen -R '{host}'"))
        }
        FailureClass::HostKeyUnknown => {
            let target = subject.plain_target()?;
            Some(format!("ssh {ASK_FOR_NEW_KEY} {}{target}", subject.port_flag()))
        }
        FailureClass::Install => Some(format!("{APP_COMMAND} machine update {name} --install")),
        FailureClass::Update => Some(format!("{APP_COMMAND} machine update {name}")),
        _ => None,
    }
}

/// What went wrong with reaching the machine and what to do, as one sentence that names it.
/// Never names an internal part of the app, and never offers to accept a changed host key.
pub fn sentence(failure: &FailureClass, subject: &Subject<'_>, os: ClientOs) -> String {
    let name = subject.name;
    let command = fix_command(failure, subject, os);
    match failure {
        FailureClass::Unreachable(why) => {
            let check = format!("Can't reach {name}: check the name or address, and that the machine is on");
            if why.is_empty() { format!("{check}.") } else { format!("{check} ({why}).") }
        }
        FailureClass::RefusingConnections => format!(
            "{name} may be refusing new connections for a while, after failed sign-ins or too many at once: wait a few minutes and try again, and if it keeps happening, check its sshd and fail2ban settings."
        ),
        FailureClass::KeyRefused(_) => match (command, os) {
            (Some(command), ClientOs::Unix) => {
                format!("{name} refused your key: run `{command}` in a terminal, then try again.")
            }
            (Some(command), ClientOs::Windows) => {
                format!("{name} refused your key: run `{command}` in PowerShell, then try again.")
            }
            (None, _) => format!(
                "{name} refused your key: add your public key to ~/.ssh/authorized_keys there, then try again."
            ),
        },
        FailureClass::NeedsPerson(_) => format!(
            "{name} asks for a password or a second code, which {APP_NAME} can't answer: set up a key, or sign in in a terminal."
        ),
        FailureClass::HostKeyChanged { .. } => {
            let remove = match command {
                Some(command) => format!("run `{command}` in a terminal"),
                None => "remove its old key from ~/.ssh/known_hosts".to_string(),
            };
            format!(
                "{name}'s host key has changed, so {APP_NAME} won't connect: confirm with whoever runs it that the change is expected, then {remove} and try again."
            )
        }
        // The same words on Windows: `ssh` runs as it is in PowerShell.
        FailureClass::HostKeyUnknown => {
            let connect = match command {
                Some(command) => format!("run `{command}` once in a terminal"),
                None => "connect to it once with ssh in a terminal".to_string(),
            };
            format!(
                "{name}'s host key isn't known yet and your ssh settings won't record a new one on their own: {connect}, check the fingerprint it shows and answer yes, then try again."
            )
        }
        FailureClass::Update => format!(
            "{name} runs an older {APP_NAME}: run `{}`, then try again.",
            command.unwrap_or_default()
        ),
        FailureClass::UpdateHere => format!(
            "{name} runs a newer {APP_NAME} than this computer: update {APP_NAME} here (`{APP_COMMAND} update`, or the desktop app's own update), then try again."
        ),
        FailureClass::Install => format!(
            "{APP_NAME} isn't installed on {name}: run `{}` (Linux and macOS machines only), then try again.",
            command.unwrap_or_default()
        ),
        FailureClass::InstallFailed(why) => format!(
            "{APP_NAME} could not be installed or started on {name} ({why}); only Linux and macOS machines are supported."
        ),
        FailureClass::NoDaemon => {
            format!("{APP_NAME} is not running on {name}: try again to start it there.")
        }
        FailureClass::Refused(why) => format!("{name} was turned away: {why}"),
    }
}

/// Whether `line` is a `sentence` about the machine called `name`, for a caller that was handed
/// the words alone. Told by each sentence's opening (up to its first `:` or `(`), so the shapes
/// stay here with the sentences.
pub fn is_failure_sentence(line: &str, name: &str) -> bool {
    let subject = Subject { name, target: None, port: None };
    let every = [
        FailureClass::Unreachable(String::new()),
        FailureClass::RefusingConnections,
        FailureClass::KeyRefused(String::new()),
        FailureClass::NeedsPerson(String::new()),
        FailureClass::HostKeyChanged { known_as: None },
        FailureClass::HostKeyUnknown,
        FailureClass::Update,
        FailureClass::UpdateHere,
        FailureClass::Install,
        FailureClass::InstallFailed(String::new()),
        FailureClass::NoDaemon,
        FailureClass::Refused(String::new()),
    ];
    every.iter().any(|failure| {
        let said = sentence(failure, &subject, ClientOs::Unix);
        let opening = said.split([':', '(']).next().unwrap_or_default();
        !opening.is_empty() && line.starts_with(opening)
    })
}

/// `sentence` for this computer's own system.
pub fn sentence_here(failure: &FailureClass, subject: &Subject<'_>) -> String {
    sentence(failure, subject, ClientOs::this())
}

/// Text from another machine, made safe to put on screen: no control characters (so no escape
/// sequence), trimmed and cut short.
pub fn clean(text: &str) -> String {
    let plain: String = text.chars().filter(|c| !c.is_control()).collect();
    plain.trim().chars().take(MOST_WHY_CHARS).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::OtherVersion;

    fn ssh_ended(code: Option<i32>, said: &str, streamed: bool) -> anyhow::Error {
        anyhow::anyhow!("closed").context(SshEnd {
            code,
            said: said.into(),
            streamed,
            message: format!("ssh box: {said}"),
            custom: false,
        })
    }

    fn class(code: Option<i32>, said: &str) -> FailureClass {
        classify(&ssh_ended(code, said, false))
    }

    fn is_unreachable(class: &FailureClass) -> bool {
        matches!(class, FailureClass::Unreachable(_))
    }

    #[test]
    fn a_key_the_machine_will_not_take_is_key_refused() {
        for said in [
            "box: Permission denied (publickey).",
            "dev@box: Permission denied (publickey,password,keyboard-interactive).",
            "Received disconnect: Too many authentication failures",
        ] {
            assert!(matches!(class(Some(255), said), FailureClass::KeyRefused(_)), "{said}");
        }
    }

    #[test]
    fn a_password_or_a_second_code_needs_a_person() {
        for said in [
            "dev@box: Permission denied (password).",
            "dev@box: Permission denied (keyboard-interactive).",
            "Authenticated using \"publickey\" with partial success.\ndev@box: Permission denied (keyboard-interactive).",
        ] {
            assert!(matches!(class(Some(255), said), FailureClass::NeedsPerson(_)), "{said}");
        }
    }

    #[test]
    fn a_changed_host_key_is_its_own_class_with_the_name_known_hosts_gives_it() {
        let said = "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n\
            @    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n\
            Offending ED25519 key in /home/dev/.ssh/known_hosts:12\n  \
            remove with:\n  ssh-keygen -f '/home/dev/.ssh/known_hosts' -R '[10.0.0.5]:2222'\n\
            Host key for [10.0.0.5]:2222 has changed and you have requested strict checking.\n\
            Host key verification failed.\n";
        assert_eq!(
            class(Some(255), said),
            FailureClass::HostKeyChanged { known_as: Some("[10.0.0.5]:2222".into()) }
        );
        assert_eq!(
            class(Some(255), "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed."),
            FailureClass::HostKeyChanged { known_as: None }
        );
    }

    #[test]
    fn a_new_host_key_a_strict_config_refused_has_not_changed() {
        // What OpenSSH says with `StrictHostKeyChecking=yes` and the key not in known_hosts.
        let strict = "No ED25519 host key is known for 10.0.0.5 and you have requested strict checking.\n\
            Host key verification failed.\n";
        assert_eq!(class(Some(255), strict), FailureClass::HostKeyUnknown);
        // An ssh too old for `accept-new` that could not ask says only the last line.
        assert_eq!(class(Some(255), "Host key verification failed.\r\n"), FailureClass::HostKeyUnknown);
        assert!(FailureClass::HostKeyUnknown.is_login(), "it waits for a person, it is not redialled");
    }

    #[test]
    fn a_host_name_from_ssh_that_is_not_plain_is_not_put_in_a_command() {
        let said = "REMOTE HOST IDENTIFICATION HAS CHANGED\n  ssh-keygen -R 'box; rm -rf ~'\nHost key verification failed.";
        assert_eq!(class(Some(255), said), FailureClass::HostKeyChanged { known_as: None });
    }

    #[test]
    fn a_login_failure_keeps_ssh_s_last_line_so_the_screen_can_show_it() {
        let said = "Warning: Permanently added '10.0.0.5' (ED25519) to the list of known hosts.\ndev@10.0.0.5: Permission denied (publickey).\n";
        assert_eq!(
            class(Some(255), said),
            FailureClass::KeyRefused("dev@10.0.0.5: Permission denied (publickey).".into())
        );
    }

    #[test]
    fn the_login_words_alone_do_not_decide_it() {
        assert!(is_unreachable(&classify(&ssh_ended(
            Some(255),
            "Permission denied",
            true
        ))));
        assert!(is_unreachable(&class(Some(1), "Permission denied")));
        assert!(is_unreachable(&class(None, "Permission denied")));
        assert!(is_unreachable(&class(Some(1), "Host key verification failed.")));
        assert!(is_unreachable(&class(Some(1), "REMOTE HOST IDENTIFICATION HAS CHANGED")));
    }

    #[test]
    fn a_custom_transport_is_never_a_login_whatever_it_prints() {
        let end = |code, said: &str| {
            anyhow::anyhow!("closed").context(SshEnd {
                code,
                said: said.into(),
                streamed: false,
                message: format!("box: {said}"),
                custom: true,
            })
        };
        let denied = "Permission denied (publickey).";
        assert_eq!(
            classify(&end(Some(255), denied)),
            FailureClass::Unreachable(denied.into())
        );
        assert_eq!(classify(&end(Some(127), "no such")), FailureClass::Install);
        assert_eq!(
            classify(&end(Some(1), "relay: down")),
            FailureClass::Unreachable("relay: down".into())
        );
        assert_eq!(
            classify(&end(Some(NO_DAEMON_EXIT), "")),
            FailureClass::NoDaemon
        );
    }

    #[test]
    fn another_version_needs_an_update() {
        let error = anyhow::Error::from(OtherVersion { daemon: 3 });
        assert_eq!(classify(&error), FailureClass::Update);
    }

    #[test]
    fn a_newer_version_there_means_updating_this_computer() {
        let newer = maitty_shared::protocol::PROTOCOL_VERSION + 1;
        let error = anyhow::Error::from(OtherVersion { daemon: newer });
        assert_eq!(classify(&error), FailureClass::UpdateHere);
    }

    #[test]
    fn exit_127_means_the_app_is_not_installed_whatever_was_said() {
        assert_eq!(
            class(Some(127), "bash: maiker: command not found"),
            FailureClass::Install
        );
        assert_eq!(
            class(Some(127), "auf Deutsch: Befehl nicht gefunden"),
            FailureClass::Install
        );
    }

    #[test]
    fn the_proxy_s_exit_code_means_no_daemon_is_running() {
        assert_eq!(class(Some(NO_DAEMON_EXIT), ""), FailureClass::NoDaemon);
    }

    #[test]
    fn anything_else_is_unreachable_with_ssh_s_last_line() {
        let said = "warning: something\nssh: connect to host box port 22: Connection refused\n";
        assert_eq!(
            class(Some(255), said),
            FailureClass::Unreachable("ssh: connect to host box port 22: Connection refused".into())
        );
    }

    #[test]
    fn a_machine_that_hangs_up_before_ssh_signs_in_may_be_refusing_connections() {
        // What OpenSSH 10.5 printed against sshd's MaxStartups and PerSourcePenalties, and what
        // older clients print for the same hang-up.
        for said in [
            "Connection closed by 10.0.0.5 port 22\n",
            "kex_exchange_identification: read: Connection reset by peer\r\nConnection reset by 10.0.0.5 port 22\r\n",
            "kex_exchange_identification: Connection closed by remote host\nConnection closed by box.lan port 2222\n",
            "ssh_exchange_identification: read: Connection reset by peer\nConnection reset by 2001:db8::5 port 22\n",
        ] {
            assert_eq!(class(Some(255), said), FailureClass::RefusingConnections, "{said}");
        }
        assert!(!FailureClass::RefusingConnections.is_login(), "it is dialled again, not left for a person");
    }

    #[test]
    fn a_machine_that_is_off_or_behind_a_proxy_is_never_read_as_refusing() {
        for said in [
            "ssh: connect to host 10.0.0.5 port 22: Connection refused",
            "ssh: connect to host 10.0.0.5 port 22: Connection timed out",
            "ssh: connect to host 10.0.0.5 port 22: No route to host",
            "ssh: Could not resolve hostname box: Name or service not known",
            // A proxy or jump host hangs up for a machine behind it that is down.
            "Connection closed by UNKNOWN port 65535",
            "ssh: connect to host 10.0.0.5 port 22: Connection refused\nConnection closed by UNKNOWN port 65535",
            "channel 0: open failed: connect failed: Connection refused\nstdio forwarding failed\nkex_exchange_identification: Connection closed by remote host\nConnection closed by UNKNOWN port 65535",
            // Not an ssh server, or one that never said hello.
            "kex_exchange_identification: banner line contains invalid characters\nbanner exchange: Connection to 10.0.0.5 port 22: invalid format",
            "Connection timed out during banner exchange\nConnection to 10.0.0.5 port 22 timed out",
            // The hello got further: the host key was taken, so it was not turned away at once.
            "Warning: Permanently added '10.0.0.5' (ED25519) to the list of known hosts.\nConnection closed by 10.0.0.5 port 22",
        ] {
            assert!(is_unreachable(&class(Some(255), said)), "{said}");
        }
        let hung_up = "Connection closed by 10.0.0.5 port 22";
        assert!(is_unreachable(&class(Some(1), hung_up)), "only ssh's own failure");
        assert!(is_unreachable(&classify(&ssh_ended(Some(255), hung_up, true))), "it streamed");
        let custom = anyhow::anyhow!("closed").context(SshEnd {
            code: Some(255),
            said: hung_up.into(),
            streamed: false,
            message: hung_up.into(),
            custom: true,
        });
        assert!(is_unreachable(&classify(&custom)), "a custom transport's words mean nothing");
    }

    #[test]
    fn what_ssh_said_is_cleaned_before_it_can_be_shown() {
        let said = "ssh: \u{1b}[31mred\u{1b}[0m \u{7}bell\r\n\u{1b}]0;title\u{7}\n";
        let FailureClass::Unreachable(why) = class(Some(255), said) else {
            panic!("not unreachable");
        };
        assert!(!why.chars().any(char::is_control), "{why:?}");
        assert_eq!(why, "]0;title");
        let long = "x".repeat(10 * MOST_WHY_CHARS);
        let FailureClass::Unreachable(why) = class(Some(255), &long) else {
            panic!("not unreachable");
        };
        assert_eq!(why.chars().count(), MOST_WHY_CHARS);
    }

    #[test]
    fn with_nothing_on_stderr_the_failure_says_so_itself() {
        let error = anyhow::anyhow!("closed").context(SshEnd {
            code: Some(255),
            said: String::new(),
            streamed: false,
            message: "couldn't reach maiker on box over ssh".into(),
            custom: false,
        });
        assert_eq!(
            classify(&error),
            FailureClass::Unreachable("couldn't reach maiker on box over ssh".into())
        );
    }

    #[test]
    fn an_error_that_is_not_from_ssh_is_unreachable_with_its_words() {
        let error = anyhow::anyhow!("running ssh (is OpenSSH installed?)");
        assert_eq!(
            classify(&error),
            FailureClass::Unreachable("running ssh (is OpenSSH installed?)".into())
        );
    }
}

/// One test per failure: the exact sentence each one reads as.
#[cfg(test)]
mod sentences {
    use super::*;

    const BOX: Subject<'static> = Subject { name: "box", target: Some("dev@10.0.0.5"), port: None };

    fn unix(failure: &FailureClass) -> String {
        sentence(failure, &BOX, ClientOs::Unix)
    }

    #[test]
    fn unreachable_says_to_check_the_address_and_the_power() {
        assert_eq!(
            unix(&FailureClass::Unreachable("ssh: connect to host 10.0.0.5 port 22: Connection timed out".into())),
            "Can't reach box: check the name or address, and that the machine is on (ssh: connect to host 10.0.0.5 port 22: Connection timed out)."
        );
        assert_eq!(
            unix(&FailureClass::Unreachable(String::new())),
            "Can't reach box: check the name or address, and that the machine is on."
        );
    }

    #[test]
    fn a_machine_refusing_connections_says_to_wait_and_where_to_look_if_it_lasts() {
        let refusing = FailureClass::RefusingConnections;
        let said = unix(&refusing);
        assert_eq!(
            said,
            "box may be refusing new connections for a while, after failed sign-ins or too many at once: wait a few minutes and try again, and if it keeps happening, check its sshd and fail2ban settings."
        );
        assert_eq!(sentence(&refusing, &BOX, ClientOs::Windows), said);
        assert_eq!(fix_command(&refusing, &BOX, ClientOs::Unix), None);
        assert_eq!(refusing.kind(), "refusing-connections");
        assert!(!unix(&FailureClass::Unreachable(String::new())).contains("refusing"));
    }

    #[test]
    fn a_refused_key_gives_ssh_copy_id_with_the_port() {
        let refused = FailureClass::KeyRefused("dev@10.0.0.5: Permission denied (publickey).".into());
        assert_eq!(
            unix(&refused),
            "box refused your key: run `ssh-copy-id dev@10.0.0.5` in a terminal, then try again."
        );
        let on_2222 = Subject { port: Some(2222), ..BOX };
        assert_eq!(
            fix_command(&refused, &on_2222, ClientOs::Unix).as_deref(),
            Some("ssh-copy-id -p 2222 dev@10.0.0.5")
        );
    }

    #[test]
    fn a_refused_key_on_windows_gives_the_powershell_line_that_does_what_ssh_copy_id_does() {
        let refused = FailureClass::KeyRefused(String::new());
        assert_eq!(
            sentence(&refused, &BOX, ClientOs::Windows),
            format!("box refused your key: run `Get-Content {WINDOWS_PUBLIC_KEY} | ssh dev@10.0.0.5 \"mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys\"` in PowerShell, then try again.")
        );
    }

    #[test]
    fn a_refused_key_with_no_ssh_target_gives_no_command() {
        let via = Subject { target: None, ..BOX };
        let refused = FailureClass::KeyRefused(String::new());
        assert_eq!(fix_command(&refused, &via, ClientOs::Unix), None);
        assert_eq!(
            sentence(&refused, &via, ClientOs::Unix),
            "box refused your key: add your public key to ~/.ssh/authorized_keys there, then try again."
        );
    }

    #[test]
    fn a_password_or_second_code_says_maiker_cannot_answer_it() {
        assert_eq!(
            unix(&FailureClass::NeedsPerson("dev@10.0.0.5: Permission denied (keyboard-interactive).".into())),
            format!("box asks for a password or a second code, which {APP_NAME} can't answer: set up a key, or sign in in a terminal.")
        );
    }

    #[test]
    fn a_changed_host_key_says_how_to_remove_it_and_never_to_accept_it() {
        let changed = FailureClass::HostKeyChanged { known_as: None };
        let said = unix(&changed);
        assert_eq!(
            said,
            format!("box's host key has changed, so {APP_NAME} won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R '10.0.0.5'` in a terminal and try again.")
        );
        assert!(!said.to_lowercase().contains("accept") && !said.to_lowercase().contains("trust"), "{said}");
        let named = FailureClass::HostKeyChanged { known_as: Some("[10.0.0.5]:2222".into()) };
        assert_eq!(fix_command(&named, &BOX, ClientOs::Unix).as_deref(), Some("ssh-keygen -R '[10.0.0.5]:2222'"));
        let on_2222 = Subject { port: Some(2222), ..BOX };
        assert_eq!(fix_command(&changed, &on_2222, ClientOs::Unix).as_deref(), Some("ssh-keygen -R '[10.0.0.5]:2222'"));
    }

    #[test]
    fn a_new_host_key_says_to_accept_it_once_with_ssh_and_never_to_remove_a_key() {
        let unknown = FailureClass::HostKeyUnknown;
        let said = unix(&unknown);
        assert_eq!(
            said,
            "box's host key isn't known yet and your ssh settings won't record a new one on their own: run `ssh -o StrictHostKeyChecking=ask dev@10.0.0.5` once in a terminal, check the fingerprint it shows and answer yes, then try again."
        );
        assert!(!said.contains("changed") && !said.contains("ssh-keygen"), "{said}");
        assert_eq!(sentence(&unknown, &BOX, ClientOs::Windows), said, "ssh runs as it is in PowerShell");
        let on_2222 = Subject { port: Some(2222), ..BOX };
        assert_eq!(
            fix_command(&unknown, &on_2222, ClientOs::Unix).as_deref(),
            Some("ssh -o StrictHostKeyChecking=ask -p 2222 dev@10.0.0.5")
        );
        let via = Subject { target: None, ..BOX };
        assert_eq!(fix_command(&unknown, &via, ClientOs::Unix), None);
        assert_eq!(
            sentence(&unknown, &via, ClientOs::Unix),
            "box's host key isn't known yet and your ssh settings won't record a new one on their own: connect to it once with ssh in a terminal, check the fingerprint it shows and answer yes, then try again."
        );
    }

    #[test]
    fn an_older_app_there_gives_the_update_command() {
        assert_eq!(
            unix(&FailureClass::Update),
            format!("box runs an older {APP_NAME}: run `{APP_COMMAND} machine update box`, then try again.")
        );
    }

    #[test]
    fn a_newer_app_there_says_to_update_this_computer() {
        assert_eq!(
            unix(&FailureClass::UpdateHere),
            format!("box runs a newer {APP_NAME} than this computer: update {APP_NAME} here (`{APP_COMMAND} update`, or the desktop app's own update), then try again.")
        );
        assert_eq!(fix_command(&FailureClass::UpdateHere, &BOX, ClientOs::Unix), None);
    }

    #[test]
    fn no_app_there_gives_the_install_command_and_the_systems_it_runs_on() {
        assert_eq!(
            unix(&FailureClass::Install),
            format!("{APP_NAME} isn't installed on box: run `{APP_COMMAND} machine update box --install` (Linux and macOS machines only), then try again.")
        );
    }

    #[test]
    fn a_failed_install_gives_the_reason_and_the_systems_it_runs_on() {
        assert_eq!(
            unix(&FailureClass::InstallFailed("no build for this system: windows-x86_64".into())),
            format!("{APP_NAME} could not be installed or started on box (no build for this system: windows-x86_64); only Linux and macOS machines are supported.")
        );
    }

    #[test]
    fn not_running_says_try_again_starts_it() {
        assert_eq!(
            unix(&FailureClass::NoDaemon),
            format!("{APP_NAME} is not running on box: try again to start it there.")
        );
    }

    #[test]
    fn a_refusal_keeps_its_own_reason() {
        assert_eq!(
            unix(&FailureClass::Refused("a different machine answers at box.".into())),
            "box was turned away: a different machine answers at box."
        );
    }

    #[test]
    fn a_sentence_is_told_from_other_words_by_its_opening() {
        for failure in [
            FailureClass::Unreachable("no route".into()),
            FailureClass::RefusingConnections,
            FailureClass::KeyRefused(String::new()),
            FailureClass::HostKeyUnknown,
            FailureClass::InstallFailed("x".into()),
            FailureClass::NoDaemon,
        ] {
            assert!(is_failure_sentence(&unix(&failure), "box"), "{failure:?}");
            assert!(!is_failure_sentence(&unix(&failure), "gpu"), "{failure:?}");
        }
        assert!(!is_failure_sentence("no session box/9", "box"));
        assert!(!is_failure_sentence("box sent a list that could not be made safe", "box"));
    }

    #[test]
    fn no_sentence_names_an_internal_part_of_the_app() {
        let all = [
            FailureClass::Unreachable("x".into()),
            FailureClass::RefusingConnections,
            FailureClass::KeyRefused("x".into()),
            FailureClass::NeedsPerson("x".into()),
            FailureClass::HostKeyChanged { known_as: None },
            FailureClass::HostKeyUnknown,
            FailureClass::Update,
            FailureClass::UpdateHere,
            FailureClass::Install,
            FailureClass::InstallFailed("x".into()),
            FailureClass::NoDaemon,
            FailureClass::Refused("x".into()),
        ];
        for os in [ClientOs::Unix, ClientOs::Windows] {
            for failure in &all {
                let said = sentence(failure, &BOX, os).to_lowercase();
                for word in ["helper", "probe", "daemon", "<name>"] {
                    assert!(!said.contains(word), "{word} in {said}");
                }
                assert!(said.contains("box"), "the machine is named: {said}");
            }
        }
    }
}
