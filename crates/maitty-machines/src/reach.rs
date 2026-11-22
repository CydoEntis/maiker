//! How long a machine takes to be reached, apart from the login and the question put to it: a plain
//! TCP connect to where ssh would go. It runs ssh only to read its own config (`-G`), which
//! contacts nothing. A machine behind a jump host or proxy has no time to give. Host keys are not
//! looked at here: ssh records a key it has not seen on the first connection and refuses a changed
//! one (`new_host_keys`, ADR 0017).

use anyhow::{Context, Result, bail};
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const DEFAULT_SSH_PORT: u16 = 22;

/// What `ssh -G` resolved for a target: the host and port it really connects to.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Resolved {
    host: String,
    port: u16,
}

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
    let resolved = parse_resolved(&String::from_utf8_lossy(&output.stdout)).ok()?;
    connect_ms(&resolved.host, resolved.port, limit)
}

/// Read `ssh -G`'s output. A machine reached through a jump host or a proxy command is refused:
/// ssh does not connect to the host and port it names, so a connect from here would time the
/// wrong machine.
fn parse_resolved(output: &str) -> Result<Resolved> {
    let (mut host, mut port) = (None, DEFAULT_SSH_PORT);
    for line in output.lines() {
        let Some((key, value)) = line.split_once(' ') else { continue };
        let value = value.trim();
        match key {
            "hostname" => host = Some(value.to_string()),
            "port" => port = value.parse().context("ssh gave a port that is not a number")?,
            "proxyjump" | "proxycommand" if value != "none" => {
                bail!("it is reached through a jump host or a proxy command, so where it connects cannot be told from here")
            }
            _ => {}
        }
    }
    let host = host.context("ssh did not say where it connects")?;
    if !crate::machine_target::valid_host(&host) {
        bail!("ssh resolved the host to {host:?}, which is not a host name or address");
    }
    Ok(Resolved { host, port })
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
    fn ssh_g_gives_the_real_host_and_port_and_refuses_a_jump() {
        let out = "user me\nhostname 100.78.214.15\nport 2222\nuserknownhostsfile ~/.ssh/known_hosts ~/.ssh/known_hosts2\nproxyjump none\n";
        assert_eq!(parse_resolved(out).unwrap(), Resolved { host: "100.78.214.15".into(), port: 2222 });
        assert_eq!(parse_resolved("hostname box\n").unwrap().port, DEFAULT_SSH_PORT);
        assert!(parse_resolved("hostname box\nproxyjump gate\n").is_err());
        assert!(parse_resolved("hostname box\nproxycommand nc %h %p\n").is_err());
        assert!(parse_resolved("hostname -oProxyCommand=x\n").is_err());
        assert!(parse_resolved("port 22\n").is_err(), "no host, no guess");
    }

    #[test]
    fn a_listening_port_answers_with_a_time_and_a_closed_one_gives_none() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(connect_ms("127.0.0.1", port, Duration::from_secs(2)).is_some());
        drop(listener);
        assert_eq!(connect_ms("127.0.0.1", port, Duration::from_secs(2)), None);
    }

    #[test]
    fn a_target_ssh_would_read_as_an_option_runs_nothing() {
        let never = vec!["definitely-not-an-ssh-program".to_string()];
        assert_eq!(reach_ms(&never, "-oProxyCommand=x", Duration::from_secs(1)), None);
    }
}
