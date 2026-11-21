//! Adding a machine from the window: the hosts `~/.ssh/config` offers, and the look at a machine
//! before anything is written. The look logs in with what ssh already has and never asks anyone
//! anything (the shared `machine_probe`): a host key ssh has not seen is recorded by ssh itself, a
//! changed one is refused and nothing is added; a login that needs a person is the caller's to
//! open. Nothing here touches the config file or the hub: it decides, and the command acts.

use maitty_machines::MachineDef;
use maitty_machines::link_failure::{ClientOs, FailureClass, Subject, clean, fix_command, sentence_here};
use maitty_machines::key_file::check_key_file;
use maitty_machines::machine_config::{refusal_of, refusal_with, suggest_name};
use maitty_machines::machine_probe::Probe;
use maitty_machines::ssh_hosts::SshHost;
use maitty_machines::Machine;
use maitty_machines::machine_config::add_machine_keyed as write_entry;
use maitty_machines::machine_probe;
use maitty_machines::reach::reach_ms as measure_reach;
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
    /// ssh could not log in alone (`FailureClass::is_login`): write the entry and let the window
    /// say why and what to do.
    Login { failure: FailureClass },
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
    /// ssh could not reach the machine, or refused its changed host key: nothing is to be added,
    /// and `failure` is what the window says instead.
    Refused { def: MachineDef, failure: FailureClass },
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
/// person: a target or name the loader refuses. A machine ssh cannot reach is `Refused`.
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
        // A host key ssh refused, changed or not yet known, means the machine would never connect:
        // nothing is added, and the sentence says how to clear the old key once the change is
        // confirmed, or how to accept a new one in a terminal.
        Probe::Failed(
            failure @ (FailureClass::Unreachable(_)
            | FailureClass::HostKeyChanged { .. }
            | FailureClass::HostKeyUnknown),
        ) => Ok(Prepare::Refused { def, failure }),
        Probe::Failed(failure) if failure.is_login() => Ok(Prepare::Ready {
            def,
            how: How::Login { failure },
        }),
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
        _ => Reach::NotRunning,
    }
}

/// The failure a machine that was reached still has, said as the shared sentence: the app there
/// is missing, of another version or not running, or putting it there failed. None once it answered.
fn still_failing(reach: Reach, helper_install: Option<&HelperInstall>) -> Option<FailureClass> {
    if let Some(HelperInstall { installed: false, said }) = helper_install {
        return Some(FailureClass::InstallFailed(clean(said)));
    }
    match reach {
        Reach::Answered => None,
        Reach::Missing => Some(FailureClass::Install),
        Reach::Older => Some(FailureClass::Update),
        Reach::NewerHere => Some(FailureClass::UpdateHere),
        Reach::NotRunning => Some(FailureClass::NoDaemon),
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
    /// be installed as part of adding. `message` is the shared sentence for what is still wrong
    /// there, when something is.
    Added {
        name: String,
        version: Option<String>,
        reach: Reach,
        took_ms: u64,
        reach_ms: Option<u64>,
        key: Option<String>,
        helper_install: Option<HelperInstall>,
        message: Option<String>,
    },
    /// Written and dialling, but ssh could not log in alone. Nothing is opened: the window shows
    /// `message` (the shared sentence), with `said` (ssh's own words) beside it. `failure` is which
    /// login failure it is (`FailureClass::kind`), `fix_command` the command the sentence names,
    /// and `command` the same login to run in any terminal, when the machine has one.
    Login {
        name: String,
        target: String,
        said: String,
        message: String,
        failure: &'static str,
        fix_command: Option<String>,
        command: Option<String>,
    },
    /// Nothing was written: ssh could not reach the machine, or its host key changed. `message`
    /// is the shared sentence, `failure` which failure it is (`FailureClass::kind`) and
    /// `fix_command` the command the sentence names, for a Copy button.
    Failed {
        message: String,
        failure: &'static str,
        fix_command: Option<String>,
    },
    /// No name could be made from the target.
    NeedsName,
    Cancelled,
}

/// What the window is told of a machine that was not added: the same three things a machine's
/// own state carries, so both say a failure the same way.
fn refused(def: &MachineDef, failure: &FailureClass) -> Outcome {
    let subject = Subject::of_def(def);
    Outcome::Failed {
        message: sentence_here(failure, &subject),
        failure: failure.kind(),
        fix_command: fix_command(failure, &subject, ClientOs::this()),
    }
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
        Prepare::Refused { def, failure } => return Ok(refused(&def, &failure)),
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
            let message = still_failing(reach, helper_install.as_ref())
                .map(|failure| sentence_here(&failure, &Subject::of_def(&def)));
            Ok(Outcome::Added {
                message,
                name: def.name,
                version,
                reach,
                took_ms: looked.took_ms,
                reach_ms: looked.reach_ms,
                key: looked.key,
                helper_install,
            })
        }
        How::Login { failure } => {
            let subject = Subject::of_def(&def);
            Ok(Outcome::Login {
                command: Machine::from_def(&def, maitty_machines::SSH_PROGRAM).first_login_command().ok(),
                message: sentence_here(&failure, &subject),
                failure: failure.kind(),
                fix_command: fix_command(&failure, &subject, ClientOs::this()),
                said: failure.said().unwrap_or_default().to_owned(),
                name: def.name,
                target: def.target,
            })
        }
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
        through_shim_with(sandbox, mode, &[])
    }

    /// `through_shim` with more of the shim's own settings (its host key, the person's config).
    fn through_shim_with(sandbox: &Sandbox, mode: &str, more: &[String]) -> impl Fn(&MachineDef) -> Probe {
        let shim = fake_ssh().display().to_string();
        let mut args = sandbox.shim_args(mode);
        args.extend_from_slice(more);
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
        let Ok(Prepare::Ready { how: How::Login { failure }, .. }) = look("auth-fail") else {
            panic!("login");
        };
        let FailureClass::KeyRefused(said) = failure else {
            panic!("a refused key: {failure:?}");
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

    /// What the window is told of a look that refused the machine.
    fn refusal(looked: &Result<Prepare, String>) -> Outcome {
        let Ok(Prepare::Refused { def, failure }) = looked else {
            panic!("refused: {looked:?}");
        };
        refused(def, failure)
    }

    #[test]
    fn a_machine_ssh_cannot_reach_adds_nothing_and_says_why() {
        let Outcome::Failed { message, failure, fix_command } = refusal(&look("unreachable")) else {
            panic!("a failure");
        };
        assert!(message.starts_with("Can't reach build.example: check the name or address"), "{message}");
        assert_eq!((failure, fix_command), ("unreachable", None));
    }

    /// The ed25519 key the shim's machine offers, and another one on record for a changed key.
    const OFFERED_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    const OLD_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJm";

    /// The look at `build.example` through the shim with its known_hosts file holding `known`
    /// (nothing when `None`) and the person's config setting `config_strict`; what came of it and
    /// the file afterwards (`None` when there is none).
    fn look_with_keys(known: Option<&str>, config_strict: &str) -> (Result<Prepare, String>, Option<String>) {
        let sandbox = Sandbox::new();
        let known_hosts = sandbox.dir.join("known_hosts");
        if let Some(line) = known {
            std::fs::write(&known_hosts, line).unwrap();
        }
        let more = [
            format!("--known-hosts={}", known_hosts.display()),
            format!("--host-key={OFFERED_KEY}"),
            format!("--config-strict={config_strict}"),
        ];
        let looked = prepare(&[], &request("build.example", None), &through_shim_with(&sandbox, "proxy", &more));
        (looked, std::fs::read_to_string(&known_hosts).ok())
    }

    #[test]
    fn a_host_key_never_seen_is_recorded_by_ssh_and_the_machine_is_added_without_a_question() {
        let (looked, known_hosts) = look_with_keys(None, "ask");
        assert!(matches!(looked, Ok(Prepare::Ready { how: How::Connect { reach: Reach::Answered, .. }, .. })), "{looked:?}");
        assert_eq!(known_hosts, Some(format!("build.example ssh-ed25519 {OFFERED_KEY}\n")));
    }

    #[test]
    fn a_changed_host_key_is_refused_adds_nothing_and_leaves_known_hosts_as_it_was() {
        let on_record = format!("build.example ssh-ed25519 {OLD_KEY}\n");
        let (looked, known_hosts) = look_with_keys(Some(&on_record), "ask");
        let Outcome::Failed { message, failure, fix_command } = refusal(&looked) else {
            panic!("a failure");
        };
        assert!(message.starts_with("build.example's host key has changed"), "{message}");
        assert!(message.contains("ssh-keygen -R 'build.example'"), "the fix is named, never an accept: {message}");
        assert_eq!(failure, "host-key-changed", "never said to be unreachable");
        assert_eq!(fix_command.as_deref(), Some("ssh-keygen -R 'build.example'"));
        assert_eq!(known_hosts, Some(on_record));
    }

    #[test]
    fn a_config_that_refuses_new_host_keys_is_the_person_s_and_is_kept() {
        let (looked, known_hosts) = look_with_keys(None, "yes");
        let Outcome::Failed { message, failure, fix_command } = refusal(&looked) else {
            panic!("a failure");
        };
        assert!(message.starts_with("build.example's host key isn't known yet"), "{message}");
        assert!(!message.contains("changed") && !message.contains("ssh-keygen"), "a good key is never to be removed: {message}");
        assert_eq!(failure, "host-key-unknown");
        assert_eq!(fix_command.as_deref(), Some("ssh -o StrictHostKeyChecking=ask build.example"));
        assert_eq!(known_hosts, None, "nothing was written");
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
    fn the_outcome_names_reach_time_key_and_helper_step_for_the_window() {
        let added = Outcome::Added {
            name: "box".into(),
            version: None,
            reach: Reach::Missing,
            took_ms: 900,
            reach_ms: Some(38),
            key: Some("id_ed25519".into()),
            helper_install: Some(HelperInstall { installed: true, said: "done".into() }),
            message: None,
        };
        let json = serde_json::to_value(&added).unwrap();
        assert_eq!(json["outcome"], "added");
        assert_eq!((json["reach_ms"].as_u64(), json["took_ms"].as_u64()), (Some(38), Some(900)));
        assert_eq!(json["key"], "id_ed25519");
        assert_eq!(json["helper_install"]["installed"], true);
    }

    #[test]
    fn a_refusal_reaches_the_window_as_one_failed_outcome() {
        let failed = refused(&def("build", "build.example"), &FailureClass::HostKeyChanged { known_as: None });
        let json = serde_json::to_value(&failed).unwrap();
        assert_eq!(json["outcome"], "failed");
        assert_eq!(json["failure"], "host-key-changed");
        assert_eq!(json["fix_command"], "ssh-keygen -R 'build.example'");
        assert!(json["message"].as_str().is_some_and(|message| message.starts_with("build's host key has changed")), "{json}");
    }

    #[test]
    fn what_is_still_wrong_with_a_reached_machine_is_one_shared_failure() {
        assert_eq!(still_failing(Reach::Answered, None), None);
        assert_eq!(still_failing(Reach::Missing, None), Some(FailureClass::Install));
        assert_eq!(still_failing(Reach::Older, None), Some(FailureClass::Update));
        assert_eq!(still_failing(Reach::NewerHere, None), Some(FailureClass::UpdateHere));
        assert_eq!(still_failing(Reach::NotRunning, None), Some(FailureClass::NoDaemon));
        let failed = HelperInstall { installed: false, said: "no build for this system\n".into() };
        assert_eq!(
            still_failing(Reach::Missing, Some(&failed)),
            Some(FailureClass::InstallFailed("no build for this system".into()))
        );
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
