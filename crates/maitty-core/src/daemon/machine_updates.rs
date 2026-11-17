//! After this computer updates, bring each remote machine to the same version (`[updates] machines`).
//!
//! A version gap breaks a machine's link until someone clicks Update on it, and the person already chose to
//! update. So the first daemon of a new version runs `<app> machine update <name> --yes --agents-idle` for each
//! `[[machines]]` entry, in the background: it installs only over an older copy (never where the app is
//! missing; that still takes a click), and restarts the far daemon only once its sessions are saved and no
//! agent there is working or waiting, so nothing is lost. A machine that cannot be reached, or asks for a login,
//! fails quietly into the log and keeps its Update button.

use crate::config::Config;
use std::path::Path;
use std::process::{Command, Stdio};

/// The version whose remote updates were last started, so each new version starts them once.
const STAMP_FILE: &str = "machines-updated-for";

/// Whether this daemon should start the remote updates: the setting is on, there is a machine to update, it
/// runs a version whose updates were not started yet, and it is the installed app on the default service (a
/// development build or a service named apart, such as `scripts/dev.ps1`'s, never pushes itself to machines).
fn should_start(
    cfg: &Config,
    stamp: Option<&str>,
    ours: &str,
    installed_release_on_default_service: bool,
) -> bool {
    installed_release_on_default_service
        && cfg.updates.machines
        && !cfg.machines.is_empty()
        && stamp.map(str::trim) != Some(ours)
}

/// The machines worth asking: ones reached over plain ssh. A custom transport cannot be installed to.
fn updatable(cfg: &Config) -> Vec<String> {
    cfg.machines
        .iter()
        .filter(|machine| machine.via.is_none())
        .map(|machine| machine.name.clone())
        .collect()
}

/// Start the remote updates when this daemon is a new version (see the module comment). Returns at once; each
/// machine is updated on its own thread.
pub(super) fn start_after_update(cfg: &Config, data_dir: &Path) {
    let stamp_path = data_dir.join(STAMP_FILE);
    let stamp = std::fs::read_to_string(&stamp_path).ok();
    let default_service =
        std::env::var_os(concat!(env!("APP_ENV"), "_SOCKET")).is_none() && !cfg!(debug_assertions);
    if !should_start(cfg, stamp.as_deref(), env!("APP_VERSION"), default_service) {
        return;
    }
    let program = match crate::installed_executable::installed_executable() {
        Ok(program) => program,
        Err(e) => {
            tracing::warn!("updating remote machines: could not find this app's own file: {e:#}");
            return;
        }
    };
    // Written before the updates finish: one that fails is not tried again on every start; its Update button stays.
    if let Err(e) = std::fs::write(&stamp_path, env!("APP_VERSION")) {
        tracing::warn!("updating remote machines: could not note the version at {}: {e}", stamp_path.display());
    }
    for name in updatable(cfg) {
        let program = program.clone();
        let spawned = std::thread::Builder::new()
            .name(format!("update {name}"))
            .spawn(move || update_one(&program, &name));
        if let Err(e) = spawned {
            tracing::warn!("updating remote machines: could not start a thread: {e}");
        }
    }
}

fn update_one(program: &Path, name: &str) {
    let mut command = Command::new(program);
    command
        .args(["machine", "update", name, "--yes", "--agents-idle"])
        .stdin(Stdio::null());
    crate::proc::quiet(&mut command);
    match command.output() {
        Ok(out) if out.status.success() => {
            tracing::info!("updated {name}: {}", last_line(&out.stdout));
        }
        Ok(out) => tracing::info!(
            "left {name} as it was (its Update button stays): {}",
            last_line(&out.stderr)
        ),
        Err(e) => tracing::warn!("could not run the update for {name}: {e}"),
    }
}

fn last_line(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("no output")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::MachineDef;

    fn with_machines(names: &[&str]) -> Config {
        Config {
            machines: names
                .iter()
                .map(|name| MachineDef {
                    name: (*name).into(),
                    target: (*name).into(),
                    ..MachineDef::default()
                })
                .collect(),
            ..Config::default()
        }
    }

    #[test]
    fn a_new_version_of_the_installed_service_updates_its_machines_once() {
        let cfg = with_machines(&["box"]);
        assert!(should_start(&cfg, None, "0.80.0", true), "never started before");
        assert!(should_start(&cfg, Some("0.79.0\n"), "0.80.0", true), "a new version");
        assert!(!should_start(&cfg, Some("0.80.0"), "0.80.0", true), "already started for this one");
    }

    #[test]
    fn nothing_is_updated_when_switched_off_with_no_machines_or_from_a_development_service() {
        let mut off = with_machines(&["box"]);
        off.updates.machines = false;
        assert!(!should_start(&off, None, "0.80.0", true));
        assert!(!should_start(&with_machines(&[]), None, "0.80.0", true));
        assert!(!should_start(&with_machines(&["box"]), None, "0.80.0", false));
    }

    #[test]
    fn a_machine_behind_a_custom_transport_is_left_for_its_button() {
        let mut cfg = with_machines(&["box", "fly"]);
        cfg.machines[1].via = Some(vec!["fly".into(), "ssh".into()]);
        assert_eq!(updatable(&cfg), ["box"]);
    }

    #[test]
    fn the_log_keeps_the_last_line_said() {
        assert_eq!(last_line(b"probing\nbox: maitty 0.80.0 installed\n\n"), "box: maitty 0.80.0 installed");
        assert_eq!(last_line(b""), "no output");
    }
}
