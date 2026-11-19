//! The parts of a machine's ssh destination as a form takes them (user, host, port), checked at
//! the boundary and put together as the config keeps it: `user@host` in `target`, a port as
//! `["-p", "2222"]` in `ssh_args`. An entry written earlier as one string still reads: it is
//! split on its last `@`.

/// Longest user name or host kept; ssh's own limits are about these.
const MOST_USER_CHARS: usize = 64;
const MOST_HOST_CHARS: usize = 253;

/// A user name ssh can take after `@`, with none that could be read as an option or a shell word.
/// `\` stays for a Windows `DOMAIN\user`.
pub fn valid_user(user: &str) -> bool {
    !user.is_empty()
        && user.chars().count() <= MOST_USER_CHARS
        && !user.starts_with('-')
        && user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '\\' | '+'))
}

/// A host name, address or ssh-config alias: letters, digits, `.`, `-`, `_`, and `:` or `%` for
/// an IPv6 address. Never one that starts with `-`, which ssh would read as an option.
pub fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.chars().count() <= MOST_HOST_CHARS
        && !host.starts_with('-')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':' | '%'))
}

/// The user and the host of a stored `target`: split on the last `@`.
pub fn split_target(target: &str) -> (Option<&str>, &str) {
    match target.rsplit_once('@') {
        Some((user, host)) => (Some(user).filter(|user| !user.is_empty()), host),
        None => (None, target),
    }
}

/// `user@host`, or `host` when the user is blank. An error is words for the person.
pub fn build_target(user: &str, host: &str) -> Result<String, String> {
    let (user, host) = (user.trim(), host.trim());
    if !valid_host(host) {
        return Err(format!(
            "{host:?} is not a host name or address: use letters, digits, dots and dashes, and do not start with a dash"
        ));
    }
    if user.is_empty() {
        return Ok(host.to_string());
    }
    if !valid_user(user) {
        return Err(format!(
            "{user:?} is not a user name: use letters, digits, dots, dashes and underscores, and do not start with a dash"
        ));
    }
    Ok(format!("{user}@{host}"))
}

/// A stored or typed `target` checked as a whole (the user and the host, each by its own rule).
pub fn check_target(target: &str) -> Result<(), String> {
    let (user, host) = split_target(target);
    build_target(user.unwrap_or(""), host).map(|_| ())
}

/// ssh's arguments for a port; none for the default port or none given.
pub fn port_args(port: Option<u16>) -> Result<Vec<String>, String> {
    match port {
        None | Some(22) => Ok(Vec::new()),
        Some(0) => Err("A port is a number from 1 to 65535".to_string()),
        Some(port) => Ok(vec!["-p".to_string(), port.to_string()]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_target_is_built_from_its_fields_and_split_back() {
        assert_eq!(build_target("dev", "100.78.214.15").unwrap(), "dev@100.78.214.15");
        assert_eq!(build_target("", "kingdom").unwrap(), "kingdom");
        assert_eq!(split_target("dev@100.78.214.15"), (Some("dev"), "100.78.214.15"));
        assert_eq!(split_target("kingdom"), (None, "kingdom"));
        assert_eq!(split_target("a@b@host"), (Some("a@b"), "host"));
    }

    #[test]
    fn a_value_ssh_would_read_as_an_option_is_refused_in_either_field() {
        for bad in ["-oProxyCommand=x", "-p"] {
            assert!(build_target("", bad).is_err(), "{bad}");
            assert!(build_target(bad, "box").is_err(), "{bad}");
        }
        for bad in ["a b", "a;b", "a\nb", "a'b", "a$(x)", "", "a@b"] {
            assert!(build_target("", bad).is_err(), "host {bad:?}");
        }
        for bad in ["a b", "a;b", "a@b", "a`b`"] {
            assert!(build_target(bad, "box").is_err(), "user {bad:?}");
        }
        assert!(check_target("-x@box").is_err());
        assert!(check_target("me@-box").is_err());
    }

    #[test]
    fn ipv6_and_windows_domain_users_are_allowed() {
        assert_eq!(build_target("me", "fe80::1%eth0").unwrap(), "me@fe80::1%eth0");
        assert_eq!(build_target("CORP\\me", "box").unwrap(), "CORP\\me@box");
    }

    #[test]
    fn a_port_becomes_ssh_arguments_and_the_default_adds_none() {
        assert_eq!(port_args(None).unwrap(), Vec::<String>::new());
        assert_eq!(port_args(Some(22)).unwrap(), Vec::<String>::new());
        assert_eq!(port_args(Some(2222)).unwrap(), ["-p", "2222"]);
        assert!(port_args(Some(0)).is_err());
    }
}
