//! A machine's host key is trusted on first connection, without a question (ADR 0017): the lines
//! Maiker runs carry OpenSSH's own `StrictHostKeyChecking=accept-new`, so ssh itself records a key
//! it has not seen in the person's `known_hosts` and still refuses one that differs from the key on
//! record. Maiker writes no key itself.
//!
//! The option only replaces ssh's default. It is left out when the person's own setup says how to
//! treat host keys (their `ssh_args` or `~/.ssh/config`, as `ssh -G` resolves them for the target),
//! and when the ssh client is not OpenSSH 7.6 or later: an older one does not know `accept-new` and
//! would refuse every line that carried it. Left out, ssh behaves as it did before.

use crate::{ssh_command, ssh_run};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// The setting Maiker adds. Never `no`: that would also accept a changed key.
pub(crate) const ACCEPT_NEW: &str = "StrictHostKeyChecking=accept-new";

/// The first OpenSSH release that knows `accept-new`, as (major, minor).
const FIRST_RELEASE: (u32, u32) = (7, 6);

/// How OpenSSH starts its version line (`OpenSSH_9.6p1 ...`), and the word Windows' build adds
/// (`OpenSSH_for_Windows_9.5p1 ...`).
const OPENSSH: &str = "OpenSSH_";
const FOR_WINDOWS: &str = "for_Windows_";

/// How `ssh -G` names the setting, and the value it prints when nothing set it: ssh's default.
const SETTING: &str = "stricthostkeychecking";
const SSH_DEFAULT: &str = "ask";

/// How long ssh may take to print its version or the config it resolves. Neither contacts the
/// machine, so this is only a bound on a client that hangs.
const LOOK_LIMIT: Duration = Duration::from_secs(3);

/// Whether the lines to `target` through `ssh` (the program, then the person's arguments) carry
/// `ACCEPT_NEW`. Blocks briefly: `ssh -V` runs once per program, `ssh -G` on every call so a change
/// to the person's config counts at once. Run it off the UI thread.
pub(crate) fn applies(ssh: &[String], target: &str) -> bool {
    // A target the line would refuse runs nothing, not even a look at ssh.
    let Some(program) = ssh.first().filter(|_| ssh_command::validate_target(target).is_ok()) else {
        return false;
    };
    knows_accept_new(program) && leaves_default(ssh, target)
}

/// The program and the person's arguments, then the setting when `accept_new`. It goes after
/// theirs: ssh keeps the first value it is given, so their own `-o StrictHostKeyChecking=` wins.
pub(crate) fn with_setting(ssh: &[String], accept_new: bool) -> Vec<String> {
    let mut line = ssh.to_vec();
    if accept_new {
        line.extend(["-o".to_string(), ACCEPT_NEW.to_string()]);
    }
    line
}

/// Whether `program` is an OpenSSH that knows `accept-new`, asked once per program. A program that
/// could not be started is not remembered, so installing ssh later still counts.
fn knows_accept_new(program: &str) -> bool {
    static KNOWN: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(answer) = known.lock().ok().and_then(|map| map.get(program).copied()) {
        return answer;
    }
    let Ok(ran) = ssh_run::run(&[program.to_string(), "-V".to_string()], None, LOOK_LIMIT) else {
        return false;
    };
    let answer = ran.code == Some(0) && version_knows_accept_new(&format!("{}\n{}", ran.stderr, ran.stdout));
    if let Ok(mut map) = known.lock() {
        map.insert(program.to_string(), answer);
    }
    answer
}

/// Whether the config ssh resolves for `target` leaves the setting at ssh's default.
fn leaves_default(ssh: &[String], target: &str) -> bool {
    let mut argv = ssh.to_vec();
    argv.extend(["-G".to_string(), "--".to_string(), target.to_string()]);
    ssh_run::run(&argv, None, LOOK_LIMIT)
        .is_ok_and(|ran| ran.code == Some(0) && setting_is_default(&ran.stdout))
}

/// Whether `ssh -V`'s words name OpenSSH 7.6 or later. Anything else (another client, a wrapper,
/// an older release) keeps ssh's own behaviour.
pub(crate) fn version_knows_accept_new(said: &str) -> bool {
    openssh_release(said).is_some_and(|release| release >= FIRST_RELEASE)
}

fn openssh_release(said: &str) -> Option<(u32, u32)> {
    let rest = &said[said.find(OPENSSH)? + OPENSSH.len()..];
    let rest = rest.strip_prefix(FOR_WINDOWS).unwrap_or(rest);
    let (major, rest) = rest.split_once('.')?;
    let minor: String = rest.chars().take_while(char::is_ascii_digit).collect();
    Some((major.parse().ok()?, minor.parse().ok()?))
}

/// Whether `ssh -G`'s output leaves the setting at ssh's default. `ssh -G` cannot tell a default
/// from an `ask` the person wrote; under `BatchMode` the two refuse an unseen key alike, so both are
/// replaced. A dump without the setting is not ours to read, and keeps ssh's own behaviour.
pub(crate) fn setting_is_default(resolved: &str) -> bool {
    resolved
        .lines()
        .filter_map(|line| line.split_once(' '))
        .find(|(key, _)| key.eq_ignore_ascii_case(SETTING))
        .is_some_and(|(_, value)| value.trim() == SSH_DEFAULT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openssh_from_7_6_knows_accept_new_on_every_platform() {
        for said in [
            "OpenSSH_9.6p1 Ubuntu-3ubuntu13.5, OpenSSL 3.0.13 30 Jan 2024",
            "OpenSSH_for_Windows_9.5p1, LibreSSL 3.8.2",
            "OpenSSH_for_Windows_7.7p1, LibreSSL 2.6.5",
            "OpenSSH_7.6p1, LibreSSL 2.6.2",
            "OpenSSH_10.0p2, OpenSSL 3.5.0",
        ] {
            assert!(version_knows_accept_new(said), "{said}");
        }
    }

    #[test]
    fn an_older_or_unknown_client_keeps_ssh_s_own_behaviour() {
        for said in [
            "OpenSSH_7.4p1, OpenSSL 1.0.2k-fips  26 Jan 2017",
            "OpenSSH_for_Windows_7.5p1",
            "OpenSSH_6.6.1p1 Ubuntu-2ubuntu2",
            "Dropbear v2022.83",
            "plink: Release 0.81",
            "",
            "OpenSSH_",
        ] {
            assert!(!version_knows_accept_new(said), "{said}");
        }
    }

    #[test]
    fn only_ssh_s_default_is_replaced_never_a_setting_the_person_made() {
        let dump = |value: &str| format!("user me\nhostname box\nport 22\nstricthostkeychecking {value}\nbatchmode no\n");
        assert!(setting_is_default(&dump("ask")));
        for theirs in ["true", "false", "accept-new"] {
            assert!(!setting_is_default(&dump(theirs)), "{theirs}");
        }
        assert!(!setting_is_default("hostname box\nport 22\n"), "a dump without it is left alone");
    }

    #[test]
    fn the_setting_goes_after_the_person_s_arguments_so_theirs_win() {
        let ssh = ["ssh", "-o", "StrictHostKeyChecking=yes"].map(String::from);
        let line = with_setting(&ssh, true);
        let first = line.iter().position(|word| word.starts_with("StrictHostKeyChecking=")).unwrap();
        assert_eq!(line[first], "StrictHostKeyChecking=yes", "ssh keeps the first value: {line:?}");
        assert_eq!(line.last().map(String::as_str), Some(ACCEPT_NEW));
        assert_eq!(with_setting(&ssh, false), ssh);
    }

    #[test]
    fn host_key_checking_is_never_turned_off() {
        let value = ACCEPT_NEW.split_once('=').map(|(_, value)| value);
        assert_eq!(value, Some("accept-new"));
        for off in ["no", "off", "false"] {
            assert_ne!(value, Some(off));
        }
    }

    #[test]
    fn a_program_that_cannot_run_adds_nothing() {
        let never = ["definitely-not-an-ssh-program".to_string()];
        assert!(!applies(&never, "box"));
        assert!(!applies(&[], "box"));
        assert!(!applies(&["ssh".to_string()], "-oProxyCommand=x"), "a target that is an option runs nothing");
    }
}
