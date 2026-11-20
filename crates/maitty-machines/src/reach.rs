//! How long a machine takes to be reached, apart from the login and the question put to it: a plain
//! TCP connect to where ssh would go. It runs ssh only to read its own config (`-G`), which
//! contacts nothing. A machine behind a jump host or proxy has no time to give.

use crate::host_key::parse_resolved;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Milliseconds to connect to the host and port `ssh -G` resolves `target` to, or `None` when it
/// cannot be told (a proxy, a name that does not resolve, nothing listening).
/// `ssh` is the program then its leading arguments. Blocks: run it off the UI thread.
pub fn reach_ms(ssh: &[String], target: &str, limit: Duration) -> Option<u64> {
    crate::machine_target::check_target(target).ok()?;
    let (program, leading) = ssh.split_first()?;
    let mut command = Command::new(program);
    command
        .args(leading)
        .args(["-G", "--", target])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(crate::CREATE_NO_WINDOW);
    }
    let output = command.output().ok().filter(|output| output.status.success())?;
    let resolved = parse_resolved(&String::from_utf8_lossy(&output.stdout), None).ok()?;
    connect_ms(&resolved.host, resolved.port, limit)
}

fn connect_ms(host: &str, port: u16, limit: Duration) -> Option<u64> {
    let address = (host, port).to_socket_addrs().ok()?.next()?;
    let started = Instant::now();
    TcpStream::connect_timeout(&address, limit).ok()?;
    u64::try_from(started.elapsed().as_millis()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn a_listening_port_answers_with_a_time() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(connect_ms("127.0.0.1", port, Duration::from_secs(2)).is_some());
    }

    #[test]
    fn a_port_nothing_listens_on_gives_no_time() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        assert_eq!(connect_ms("127.0.0.1", port, Duration::from_secs(2)), None);
    }

    #[test]
    fn a_target_ssh_would_read_as_an_option_runs_nothing() {
        let never = vec!["definitely-not-an-ssh-program".to_string()];
        assert_eq!(reach_ms(&never, "-oProxyCommand=x", Duration::from_secs(1)), None);
    }
}
