//! Adding a machine from the window: the hosts `~/.ssh/config` offers, and the look at a machine
//! before anything is written. The look logs in with what ssh already has and never asks anyone
//! anything (the shared `machine_probe`); a login that needs a person is the caller's to open.
//! Nothing here touches the config file or the hub: it decides, and the command acts.

use maitty_machines::MachineDef;
use maitty_machines::link_failure::FailureClass;
use maitty_machines::host_key::{self, TOOL_LIMIT, Tools};
use maitty_machines::key_file::check_key_file;
use maitty_machines::machine_config::{refusal_of, refusal_with, suggest_name};
use maitty_machines::machine_probe::Probe;
use maitty_machines::ssh_hosts::SshHost;
use maitty_machines::Machine;
use maitty_machines::machine_config::add_machine_keyed as write_entry;
use maitty_machines::machine_probe;
use maitty_machines::reach::reach_ms as measure_reach;
use crate::machine_access::{HostKeyReport, is_fingerprint, report_of};
use tauri::Manager;
use maitty_machines::local_machines::{config_path, machines_beside};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long ssh may take to answer before the look ends, whatever ssh does.
pub const PROBE_LIMIT: Duration = Duration::from_secs(12);

/// How long the plain connect to a machine may take before it is left out of the result.
const REACH_LIMIT: Duration = Duration::from_secs(3);

/// A name no machine has, for telling a bad target from a bad name.
const SPARE_NAME: &str = "machine-to-add";

/// A host of `~/.ssh/config` as the window is given it: the alias to connect with, and where it
/// points, for reading.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct HostChoice {
    pub alias: String,
    pub detail: String,
    /// The host is already a machine's target: it stays in the list, marked, so it never vanishes unexplained.
    pub added: bool,
}

/// The hosts to offer: all of them, those already a machine's target marked `added`.
pub fn host_choices(hosts: &[SshHost], existing: &[MachineDef]) -> Vec<HostChoice> {
    hosts
        .iter()
        .map(|host| HostChoice {
            added: existing
                .iter()
                .any(|machine| machine.target.eq_ignore_ascii_case(&host.alias)),
            alias: host.alias.clone(),
            detail: match (&host.user, &host.host_name) {
                (Some(user), Some(name)) => format!("{user}@{name}"),
                (None, Some(name)) => name.clone(),
                (Some(user), None) => format!("{user}@{}", host.alias),
                (None, None) => String::new(),
            },
        })
        .collect()
}

/// How a machine that was looked at is to be brought up.
#[derive(Debug, PartialEq, Eq)]
pub enum How {
    /// Dial it now. `version` is what the app there said, when it answered; `reach` is how far the look got.
    Connect { version: Option<String>, reach: Reach },
    /// ssh needs a person: write the entry and open ssh where prompts can be answered.
    /// `said` is ssh's own last line, why it could not log in.
    Login { said: String },
}

/// How far the look got on a machine ssh could log in to: the app answered, or why it did not.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Reach {
    Answered,
    /// No app on its PATH.
    Missing,
    /// An older app than this computer's.
    Older,
    /// A newer app than this computer's.
    NewerHere,
    /// The app is there but its daemon is not running.
    NotRunning,
}

#[derive(Debug, PartialEq)]
pub enum Prepare {
    Ready { def: MachineDef, how: How },
    /// No usable name can be made from the target: ask for one.
    NeedsName,
    Cancelled,
}

/// What the window asked to add. `identity_file` is already checked to be a file that exists.
pub struct Request<'a> {
    pub target: &'a str,
    pub name: Option<&'a str>,
    pub ssh_args: &'a [String],
    pub identity_file: Option<&'a str>,
}

/// Check the request (and its name, or one made from the target) against the machines already
/// there, then look at the machine with `probe`. Writes nothing. An error is words for the
/// person: a target or name the loader refuses, or a machine ssh cannot reach (nothing is to be
/// added then).
pub fn prepare(
    existing: &[MachineDef],
    request: &Request<'_>,
    probe: &dyn Fn(&MachineDef) -> Probe,
) -> Result<Prepare, String> {
    let target = request.target.trim();
    let (name, ssh_args) = (request.name, request.ssh_args);
    if let Some(why) = refusal_with(existing, SPARE_NAME, target, ssh_args) {
        return Err(why);
    }
    let name = match name.map(str::trim).filter(|name| !name.is_empty()) {
        Some(name) => name.to_owned(),
        None => {
            let taken: Vec<String> = existing.iter().map(|m| m.name.clone()).collect();
            match suggest_name(target, &taken) {
                Some(name) => name,
                None => return Ok(Prepare::NeedsName),
            }
        }
    };
    if let Some(taken) = existing.iter().find(|m| m.name.eq_ignore_ascii_case(&name)) {
        return Err(format!(
            "You already have a machine called {}. Remove it in Remote machines, or pick another name.",
            taken.name
        ));
    }
    let def = MachineDef {
        name,
        target: target.to_owned(),
        ssh_args: ssh_args.to_vec(),
        identity_file: request.identity_file.map(str::to_owned),
        ..MachineDef::default()
    };
    if let Some(why) = refusal_of(existing, &def) {
        return Err(why);
    }
    match probe(&def) {
        Probe::Cancelled => Ok(Prepare::Cancelled),
        Probe::Ready { version } => Ok(Prepare::Ready {
            def,
            how: How::Connect {
                version: Some(version).filter(|v| !v.is_empty()),
                reach: Reach::Answered,
            },
        }),
        Probe::Failed(FailureClass::Login(said)) => Ok(Prepare::Ready {
            def,
            how: How::Login { said },
        }),
        Probe::Failed(FailureClass::Unreachable(why)) => Err(format!("{}: {why}", def.target)),
        // Reached, but the app is missing, old or not running: said here so the window can ask
        // about it at once, and the connection's own state carries on once it dials.
        Probe::Failed(class) => Ok(Prepare::Ready {
            def,
            how: How::Connect { version: None, reach: reach_of(&class) },
        }),
    }
}


fn reach_of(class: &FailureClass) -> Reach {
    match class {
        FailureClass::Install => Reach::Missing,
        FailureClass::Update => Reach::Older,
        FailureClass::UpdateHere => Reach::NewerHere,
        FailureClass::NoDaemon | FailureClass::Login(_) | FailureClass::Unreachable(_) => Reach::NotRunning,
    }
}

/// The look in flight, so the window can end it.
#[derive(Default)]
pub struct AddProbe(Mutex<Option<Arc<AtomicBool>>>);

/// What came of installing the helper (the app on the far side) as a step of adding the machine.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct HelperInstall {
    pub installed: bool,
    /// The install's last line when it worked, or why it did not.
    pub said: String,
}

/// What adding a machine came to. A machine that could not be added is an error with the words
/// to show instead.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
pub enum Outcome {
    /// Written and dialling. `version` is what the app there answered, when it did; `reach` says
    /// how far the look got. `reach_ms` is how long the machine took to be reached (a plain
    /// connect), `took_ms` how long it took to log in and ask, `key` the file name of the key that
    /// signed in. `helper_install` is set when the app was missing and the window asked for it to
    /// be installed as part of adding.
    Added {
        name: String,
        version: Option<String>,
        reach: Reach,
        took_ms: u64,
        reach_ms: Option<u64>,
        key: Option<String>,
        helper_install: Option<HelperInstall>,
    },
    /// Written and dialling, but ssh could not log in without a person. Nothing is opened: the
    /// window shows `said` (ssh's own words), and the way forward (the host key card, or the
    /// user to fix). `command` is the same login to run in any terminal, when the machine has one.
    Login { name: String, target: String, said: String, command: Option<String> },
    /// No name could be made from the target.
    NeedsName,
    Cancelled,
}

/// The hosts of `~/.ssh/config`, minus the ones that are already machines. Read off the UI thread.
#[tauri::command]
pub async fn list_ssh_hosts() -> Result<Vec<HostChoice>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let existing = machines_beside(&config_path()).machines;
        host_choices(&maitty_machines::ssh_hosts::user_hosts(), &existing)
    })
    .await
    .map_err(|error| format!("Could not read ~/.ssh/config: {error}"))
}

/// ssh with only a port, for looking at a host that is not a machine yet.
fn bare_ssh(port: Option<u16>) -> Result<Vec<String>, String> {
    let mut ssh = vec![maitty_machines::SSH_PROGRAM.to_string()];
    ssh.extend(maitty_machines::machine_target::port_args(port)?);
    Ok(ssh)
}

/// Look at the host key a new machine offers and whether this computer knows it, before anything
/// is written: a new host asks to be trusted first, and Cancel leaves nothing behind. Read-only.
#[tauri::command]
pub async fn inspect_new_host(target: String, port: Option<u16>) -> Result<HostKeyReport, String> {
    let target = target.trim().to_owned();
    maitty_machines::machine_target::check_target(&target)?;
    let ssh = bare_ssh(port)?;
    let seen = tauri::async_runtime::spawn_blocking(move || host_key::inspect(&ssh, &target, &Tools::default(), TOOL_LIMIT))
        .await
        .map_err(|error| format!("Could not look at the host key: {error}"))?
        .map_err(|error| format!("{error:#}"))?;
    Ok(report_of(&seen))
}

/// Trust the key whose fingerprint the person was shown for a host that is not a machine yet: it
/// is fetched again and added to known_hosts only when it is still that key and is new.
#[tauri::command]
pub async fn trust_new_host(target: String, fingerprint: String, port: Option<u16>) -> Result<(), String> {
    if !is_fingerprint(&fingerprint) {
        return Err("That is not a fingerprint".to_string());
    }
    let target = target.trim().to_owned();
    maitty_machines::machine_target::check_target(&target)?;
    let ssh = bare_ssh(port)?;
    tauri::async_runtime::spawn_blocking(move || host_key::trust(&ssh, &target, &fingerprint, &Tools::default(), TOOL_LIMIT))
        .await
        .map_err(|error| format!("Could not trust the host key: {error}"))?
        .map_err(|error| format!("{error:#}"))
}

/// A key file the window named: blank means none; otherwise it must be a file that exists.
fn checked_key_file(key_file: Option<String>) -> Result<Option<String>, String> {
    match key_file.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => check_key_file(text).map(Some),
        None => Ok(None),
    }
}

/// Look at `target`, and when it holds up write it to `config.local.toml` and start dialling it.
/// Nothing is written when the machine cannot be reached or the look is cancelled. `key_file` is a
/// private key for ssh to sign in with (its path is kept, the file is never read). When the app is
/// missing on the machine and `install_helper` is true, it is installed as the last step.
#[tauri::command]
pub async fn add_machine(
    app: tauri::AppHandle,
    target: String,
    name: Option<String>,
    port: Option<u16>,
    key_file: Option<String>,
    install_helper: Option<bool>,
) -> Result<Outcome, String> {
    // The window checks these too; this is the boundary, so they are checked again here.
    maitty_machines::machine_target::check_target(target.trim())?;
    let ssh_args = maitty_machines::machine_target::port_args(port)?;
    let identity_file = checked_key_file(key_file)?;
    let handle = app.state::<crate::terminal_stream::Wire>().handle()?.clone();
    let probing = app.state::<AddProbe>();
    let cancel = Arc::new(AtomicBool::new(false));
    *probing.0.lock().map_err(|_| "Adding is busy".to_string())? = Some(cancel.clone());
    let file = config_path().with_file_name("config.local.toml");
    let looked = {
        let cancel = cancel.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let request = Request {
                target: &target,
                name: name.as_deref(),
                ssh_args: &ssh_args,
                identity_file: identity_file.as_deref(),
            };
            look_and_write(&file, &request, &cancel)
        })
        .await
        .map_err(|error| format!("Could not look at the machine: {error}"))
    };
    if let Ok(mut slot) = probing.0.lock() {
        *slot = None;
    }
    let looked = looked??;
    let (def, how) = match looked.prepared {
        Prepare::Cancelled => return Ok(Outcome::Cancelled),
        Prepare::NeedsName => return Ok(Outcome::NeedsName),
        Prepare::Ready { def, how } => (def, how),
    };
    handle.add(def.clone());
    match how {
        How::Connect { version, reach } => {
            let helper_install = match (reach, install_helper.unwrap_or(false)) {
                (Reach::Missing, true) => Some(install_helper_step(&app, &def.name).await),
                _ => None,
            };
            let reach = match &helper_install {
                Some(HelperInstall { installed: true, .. }) => Reach::Answered,
                _ => reach,
            };
            Ok(Outcome::Added {
                name: def.name,
                version,
                reach,
                took_ms: looked.took_ms,
                reach_ms: looked.reach_ms,
                key: looked.key,
                helper_install,
            })
        }
        How::Login { said } => Ok(Outcome::Login {
            command: Machine::from_def(&def, maitty_machines::SSH_PROGRAM).first_login_command().ok(),
            name: def.name,
            target: def.target,
            said,
        }),
    }
}

/// Install the app on a machine that was just added and has none, the same install as the Fix flow
/// (`maiker machine update <name> --install`), with its progress on `machine-update-progress`.
async fn install_helper_step(app: &tauri::AppHandle, name: &str) -> HelperInstall {
    match crate::machine_update::run_update(app.clone(), name.to_string(), true, false).await {
        Ok(said) => HelperInstall { installed: true, said },
        Err(said) => HelperInstall { installed: false, said },
    }
}

/// End the look that is running, if one is.
#[tauri::command]
pub fn cancel_add_machine(probing: tauri::State<'_, AddProbe>) {
    if let Ok(slot) = probing.0.lock()
        && let Some(cancel) = slot.as_ref()
    {
        cancel.store(true, Ordering::Relaxed);
    }
}

/// What the blocking part found: the decision, and the three things the window shows beside it.
struct Looked {
    prepared: Prepare,
    /// How long the login and the question took (not the connect).
    took_ms: u64,
    reach_ms: Option<u64>,
    key: Option<String>,
}

/// The blocking part: check, reach, look, name the key, and only then write the entry.
fn look_and_write(file: &std::path::Path, request: &Request<'_>, cancel: &AtomicBool) -> Result<Looked, String> {
    let listed = machines_beside(&config_path());
    if let Some(error) = listed.error {
        return Err(error);
    }
    let mut ssh = vec![maitty_machines::SSH_PROGRAM.to_string()];
    ssh.extend(request.ssh_args.iter().cloned());
    let reach_ms = measure_reach(&ssh, request.target.trim(), REACH_LIMIT);
    let look = |def: &MachineDef| {
        let machine = Machine::from_def(def, maitty_machines::SSH_PROGRAM);
        machine_probe::probe(&machine, PROBE_LIMIT, cancel)
    };
    let started = std::time::Instant::now();
    let prepared = prepare(&listed.machines, request, &look)?;
    let took_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let mut key = None;
    if let Prepare::Ready { def, how } = &prepared {
        if matches!(how, How::Connect { .. }) {
            let machine = Machine::from_def(def, maitty_machines::SSH_PROGRAM);
            key = machine_probe::signed_in_key(&machine, PROBE_LIMIT, cancel);
        }
        if cancel.load(Ordering::Relaxed) {
            return Ok(Looked { prepared: Prepare::Cancelled, took_ms, reach_ms, key: None });
        }
        write_entry(file, &def.name, &def.target, &def.ssh_args, def.identity_file.as_deref())
            .map_err(|error| format!("Could not add {}: {error:#}", def.name))?;
    }
    Ok(Looked { prepared, took_ms, reach_ms, key })
}

async fn start_login_session(app: &tauri::AppHandle, name: &str, command: String) -> Result<(), String> {
    let executable = crate::daemon_executable(app)?;
    maitty_desktop_client::start_command_session(command, format!("ssh {name}"), executable)
        .await
        .map(|_| ())
        .map_err(|error| format!("{error:#}"))
}

/// Open ssh in a session on this computer for a machine that needs a login, so a person can
/// answer its prompts. The machine's own dial carries on; it connects once the login has worked.
#[tauri::command]
pub async fn open_machine_login(
    app: tauri::AppHandle,
    wire: tauri::State<'_, crate::terminal_stream::Wire>,
    machine: u16,
) -> Result<(), String> {
    let handle = wire.handle()?.clone();
    let id = maitty_machines::MachineId(machine);
    let route = handle
        .route(id)
        .ok_or_else(|| "That machine is no longer in the list".to_string())?;
    let command = route.first_login_command().map_err(|error| format!("{error:#}"))?;
    let name = handle.name_of(id).unwrap_or_else(|| format!("machine {machine}"));
    start_login_session(&app, &name, command).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use maitty_machines::machine_probe::probe;
    use maitty_machines::Machine;
    use maitty_test_support::{Sandbox, fake_ssh};
    use std::sync::atomic::AtomicBool;

    /// The real look, through the fake ssh in `mode`.
    fn through_shim(sandbox: &Sandbox, mode: &str) -> impl Fn(&MachineDef) -> Probe {
        let shim = fake_ssh().display().to_string();
        let args = sandbox.shim_args(mode);
        move |def: &MachineDef| {
            let def = MachineDef {
                ssh_args: args.clone(),
                ..def.clone()
            };
            let ssh = [shim.clone()];
            probe(
                &Machine::from_def_via(&def, &ssh),
                Duration::from_secs(10),
                &AtomicBool::new(false),
            )
        }
    }

    fn def(name: &str, target: &str) -> MachineDef {
        MachineDef {
            name: name.into(),
            target: target.into(),
            ..MachineDef::default()
        }
    }

    fn request<'a>(target: &'a str, name: Option<&'a str>) -> Request<'a> {
        Request { target, name, ssh_args: &[], identity_file: None }
    }

    fn look(mode: &str) -> Result<Prepare, String> {
        let sandbox = Sandbox::new();
        prepare(&[], &request("build.example", None), &through_shim(&sandbox, mode))
    }

    #[test]
    fn a_host_that_answers_is_added_with_the_version_it_gave() {
        let Ok(Prepare::Ready { def, how }) = look("proxy") else {
            panic!("ready");
        };
        assert_eq!((def.name.as_str(), def.target.as_str()), ("build.example", "build.example"));
        let How::Connect { version, reach } = how else {
            panic!("connect");
        };
        assert!(version.is_some_and(|v| !v.is_empty()));
        assert_eq!(reach, Reach::Answered);
    }

    #[test]
    fn a_login_ssh_cannot_do_is_added_and_left_to_a_person() {
        let Ok(Prepare::Ready { how: How::Login { said }, .. }) = look("auth-fail") else {
            panic!("login");
        };
        assert!(said.contains("Permission denied"), "ssh's own words reach the window: {said:?}");
    }

    #[test]
    fn an_app_that_is_not_installed_is_still_added_so_its_state_can_say_how_to_fix_it() {
        assert!(matches!(
            look("not-installed"),
            Ok(Prepare::Ready { how: How::Connect { version: None, reach: Reach::Missing }, .. })
        ));
    }

    #[test]
    fn a_machine_ssh_cannot_reach_adds_nothing_and_says_why() {
        let Err(why) = look("unreachable") else {
            panic!("an error");
        };
        assert!(why.starts_with("build.example: "), "{why}");
    }

    #[test]
    fn a_target_ssh_would_read_as_an_option_is_refused_before_anything_runs() {
        let never = |_: &MachineDef| -> Probe { panic!("nothing is to run") };
        assert!(prepare(&[], &request("-oProxyCommand=x", None), &never).is_err());
        assert!(prepare(&[], &request("a b", None), &never).is_err());
    }

    #[test]
    fn a_name_that_is_taken_is_refused_and_a_suggestion_steps_around_it() {
        let ok = |_: &MachineDef| Probe::Ready { version: "v".into() };
        let existing = [def("build", "other.example")];
        let Err(why) = prepare(&existing, &request("x.example", Some("BUILD")), &ok) else {
            panic!("refused");
        };
        assert!(why.starts_with("You already have a machine called build."), "{why}");
        let Ok(Prepare::Ready { def, .. }) = prepare(&existing, &request("build", None), &ok) else {
            panic!("ready");
        };
        assert_eq!(def.name, "build-2");
    }

    #[test]
    fn a_target_nothing_can_name_asks_for_a_name() {
        let ok = |_: &MachineDef| Probe::Ready { version: String::new() };
        assert_eq!(prepare(&[], &request("me@", None), &ok), Ok(Prepare::NeedsName));
        assert!(matches!(
            prepare(&[], &request("me@", Some("lab")), &ok),
            Ok(Prepare::Ready { .. })
        ));
    }

    #[test]
    fn a_key_file_rides_on_the_def_and_reaches_the_probe_as_dash_i() {
        let seen = std::cell::RefCell::new(Vec::new());
        let spy = |def: &MachineDef| {
            *seen.borrow_mut() = def.ssh_arguments();
            Probe::Ready { version: "v".into() }
        };
        let port = ["-p".to_string(), "2222".to_string()];
        let with_key = Request { target: "me@box", name: None, ssh_args: &port, identity_file: Some("/k/id") };
        let Ok(Prepare::Ready { def, .. }) = prepare(&[], &with_key, &spy) else {
            panic!("ready");
        };
        assert_eq!(def.identity_file.as_deref(), Some("/k/id"));
        assert_eq!(*seen.borrow(), ["-p", "2222", "-i", "/k/id"]);
    }

    #[test]
    fn a_key_file_ssh_would_read_as_an_option_is_refused_before_anything_runs() {
        let never = |_: &MachineDef| -> Probe { panic!("nothing is to run") };
        let bad = Request { target: "box", name: None, ssh_args: &[], identity_file: Some("-oProxyCommand=x") };
        assert!(prepare(&[], &bad, &never).is_err());
    }

    #[test]
    fn a_blank_key_file_is_none_and_a_missing_one_is_refused_in_words() {
        assert_eq!(checked_key_file(None), Ok(None));
        assert_eq!(checked_key_file(Some("  ".into())), Ok(None));
        assert!(checked_key_file(Some("/no/such/key-file-here".into())).is_err());
    }

    #[test]
    fn a_new_host_is_looked_at_through_ssh_with_only_its_port() {
        assert_eq!(bare_ssh(None).unwrap(), [maitty_machines::SSH_PROGRAM]);
        assert_eq!(bare_ssh(Some(2222)).unwrap(), [maitty_machines::SSH_PROGRAM, "-p", "2222"]);
        assert!(bare_ssh(Some(0)).is_err());
    }

    #[test]
    fn the_outcome_names_reach_time_key_and_helper_step_for_the_window() {
        let added = Outcome::Added {
            name: "box".into(),
            version: None,
            reach: Reach::Missing,
            took_ms: 900,
            reach_ms: Some(38),
            key: Some("id_ed25519".into()),
            helper_install: Some(HelperInstall { installed: true, said: "done".into() }),
        };
        let json = serde_json::to_value(&added).unwrap();
        assert_eq!(json["outcome"], "added");
        assert_eq!((json["reach_ms"].as_u64(), json["took_ms"].as_u64()), (Some(38), Some(900)));
        assert_eq!(json["key"], "id_ed25519");
        assert_eq!(json["helper_install"]["installed"], true);
    }

    #[test]
    fn a_cancelled_look_adds_nothing() {
        let cancelled = |_: &MachineDef| Probe::Cancelled;
        assert_eq!(prepare(&[], &request("build", None), &cancelled), Ok(Prepare::Cancelled));
    }

    #[test]
    fn the_hosts_offered_keep_machines_already_added_marked() {
        let host = |alias: &str| SshHost {
            alias: alias.into(),
            host_name: Some(format!("{alias}.example")),
            user: Some("me".into()),
        };
        let offered = host_choices(&[host("build"), host("box")], &[def("b", "BUILD")]);
        assert_eq!(
            offered,
            [
                HostChoice {
                    alias: "build".into(),
                    detail: "me@build.example".into(),
                    added: true
                },
                HostChoice {
                    alias: "box".into(),
                    detail: "me@box.example".into(),
                    added: false
                }
            ]
        );
    }
}
