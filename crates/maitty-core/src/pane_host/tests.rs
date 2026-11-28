//! The host over a real pseudo-terminal: a pane keeps running after its daemon lets go, and the
//! next daemon gets its output and its input back.

use super::host::serve_for_test;
use super::link::{Event, Keep, Link};
use super::wire::ToHost;
use interprocess::local_socket::ConnectOptions;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Long enough for a cold PowerShell under ConPTY on a busy CI runner.
const WITHIN: Duration = Duration::from_secs(60);

type Seen = Arc<Mutex<Vec<Event>>>;

struct Host {
    name: interprocess::local_socket::Name<'static>,
    _dir: maitty_test_support::TempFolder,
}

fn host() -> Host {
    let dir = maitty_test_support::TempFolder::new("pane-host");
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let id = format!("{}-panes-test-{}-{n}", env!("APP_COMMAND"), std::process::id());
    let name = maitty_ipc_transport::socket_name(&id, Some(dir.path())).unwrap();
    serve_for_test(name.clone()).unwrap();
    Host { name, _dir: dir }
}

fn attach(host: &Host) -> (Link, Vec<super::HostedPane>, Seen) {
    let stream = ConnectOptions::new()
        .name(host.name.clone())
        .connect_sync()
        .unwrap();
    let seen: Seen = Arc::default();
    let into = seen.clone();
    let (link, panes) = Link::over(stream, move |event| into.lock().unwrap().push(event)).unwrap();
    (link, panes, seen)
}

fn output_of(seen: &Seen, id: u32) -> String {
    let bytes: Vec<u8> = seen
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            Event::Output(of, data) if *of == id => Some(data.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    String::from_utf8_lossy(&bytes).into_owned()
}

fn wait_until(what: &str, done: impl Fn() -> bool) {
    let started = Instant::now();
    while !done() {
        assert!(started.elapsed() < WITHIN, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Prints `first`, reads a line, prints `got-<line>`, and ends.
fn echo_back() -> portable_pty::CommandBuilder {
    #[cfg(windows)]
    let argv = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Write-Output first; $l = Read-Host; Write-Output \"got-$l\""];
    #[cfg(not(windows))]
    let argv = ["sh", "-c", "echo first; read l; echo got-$l"];
    portable_pty::CommandBuilder::from_argv(argv.iter().map(Into::into).collect())
}

fn keep() -> Keep {
    Keep { token: "secret".into(), process: "sh".into() }
}

#[test]
fn a_pane_outlives_its_daemon_and_the_next_one_gets_its_output_and_input() {
    let host = host();
    let (first, panes, seen_first) = attach(&host);
    assert!(panes.is_empty());
    first.spawn(7, &echo_back(), 24, 80, 64 * 1024, &keep()).unwrap();
    wait_until("the first line", || output_of(&seen_first, 7).contains("first"));
    // The daemon goes; the host keeps the pane and hands it to the next one.
    drop(first);
    let (next, panes, seen_next) = attach(&host);
    let pane = panes.iter().find(|p| p.id == 7).expect("the host still has the pane");
    assert_eq!(pane.exited, None, "the pane is still running");
    assert!(String::from_utf8_lossy(&pane.output).contains("first"), "its output was kept");
    let kept: Keep = rmp_serde::from_slice(&pane.keep).unwrap();
    assert_eq!(kept, keep());
    next.send(ToHost::Write { id: 7, data: b"yes\r".to_vec() });
    wait_until("the answer", || output_of(&seen_next, 7).contains("got-yes"));
    wait_until("the exit", || {
        seen_next.lock().unwrap().contains(&Event::Exited(7, false))
    });
    assert!(!output_of(&seen_first, 7).contains("got-yes"), "only the daemon that took over is told");
}

#[test]
fn a_forgotten_pane_is_ended_and_gone_from_the_list() {
    let host = host();
    let (link, _, seen) = attach(&host);
    link.spawn(3, &echo_back(), 24, 80, 1024, &keep()).unwrap();
    wait_until("the first line", || output_of(&seen, 3).contains("first"));
    link.send(ToHost::Forget { id: 3 });
    drop(link);
    let started = Instant::now();
    loop {
        let (_, panes, _) = attach(&host);
        if panes.is_empty() {
            break;
        }
        assert!(started.elapsed() < WITHIN, "the forgotten pane is still listed");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn a_program_that_cannot_start_is_an_error_and_no_pane() {
    let host = host();
    let (link, _, _) = attach(&host);
    let missing = portable_pty::CommandBuilder::new("no-such-program-anywhere-at-all");
    assert!(link.spawn(5, &missing, 24, 80, 1024, &keep()).is_err());
    let (_, panes, _) = attach(&host);
    assert!(panes.is_empty());
}

#[test]
fn a_pane_id_already_running_is_refused() {
    let host = host();
    let (link, _, seen) = attach(&host);
    link.spawn(9, &echo_back(), 24, 80, 1024, &keep()).unwrap();
    wait_until("the first line", || output_of(&seen, 9).contains("first"));
    assert!(link.spawn(9, &echo_back(), 24, 80, 1024, &keep()).is_err());
    link.send(ToHost::Forget { id: 9 });
}
