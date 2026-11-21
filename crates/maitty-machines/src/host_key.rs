//! Where ssh really connects for a target, read from `ssh -G`'s output, for `reach`. Host keys are
//! not looked at here: ssh records a key it has not seen on the first connection and refuses a
//! changed one (`new_host_keys`, ADR 0017).

use anyhow::{Context, Result, bail};

const DEFAULT_SSH_PORT: u16 = 22;

/// What `ssh -G` resolved for a target: the host and port it really connects to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub host: String,
    pub port: u16,
}

/// Read `ssh -G`'s output. A machine reached through a jump host or a proxy command is refused:
/// ssh does not connect to the host and port it names, so a connect from here would time the
/// wrong machine.
pub fn parse_resolved(output: &str) -> Result<Resolved> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
