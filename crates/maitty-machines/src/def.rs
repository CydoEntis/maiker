//! A machine of the local config (`[[machines]]`) and the checks that refuse a bad entry.

use anyhow::Result;
use serde::{Deserialize, Serialize};

/// Longest machine name; it is typed on the command line and shown in the sidebar.
pub const MACHINE_NAME_MAX: usize = 32;

/// The name of this machine in `machine/id` addresses; no `[[machines]]` entry may take it.
pub const LOCAL_MACHINE: &str = "local";

/// Another machine, reached over ssh (`[[machines]]`). Read only from the local config, never
/// the synced one: where it points is this computer's business.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MachineDef {
    /// How the machine is addressed (`--on name`, `name/3`).
    pub name: String,
    /// The ssh destination: a host, `user@host`, or a `Host` alias from ssh's own config.
    pub target: String,
    /// Extra arguments for ssh, one list entry each (`["-p", "2222"]`); never split on spaces.
    pub ssh_args: Vec<String>,
    /// A private key file for ssh to sign in with (`-i`). Only its path is kept here: the file is
    /// never read by this app. Unset, ssh uses its own config and agent.
    pub identity_file: Option<String>,
    /// The app's command on the far side; unset, the app's own name from the remote PATH.
    pub remote_cmd: Option<String>,
    /// A command that carries stdin and stdout unchanged in place of ssh (`["fly", "ssh",
    /// "console", "-C", "{command}"]`): a program and its arguments, never a shell line. The
    /// element `{command}` is replaced by the remote command; without one it is appended last.
    /// It is code this app runs, so it is read only from the local config.
    pub via: Option<Vec<String>>,
    /// Let this machine's panes write to this computer's clipboard. On unless the entry says
    /// `clipboard = false`: a machine you added is one you chose, and a copy made there should
    /// reach the paste here without any setting.
    pub clipboard: bool,
    /// Let this machine raise notices.
    pub notices: bool,
    /// Let this machine play sounds.
    pub sounds: bool,
    /// Let an agent in a pane here reach this machine through its MCP tools (`machine` argument
    /// or a `name/id`), within that pane's own grants.
    pub mcp: bool,
}

impl Default for MachineDef {
    fn default() -> MachineDef {
        MachineDef {
            name: String::new(),
            target: String::new(),
            ssh_args: Vec::new(),
            identity_file: None,
            remote_cmd: None,
            via: None,
            clipboard: true,
            notices: false,
            sounds: false,
            mcp: false,
        }
    }
}

impl MachineDef {
    /// The arguments ssh is given for this entry, in order: `ssh_args`, then `-i <identity_file>`.
    /// Each is one argv entry, so a path with spaces needs no quoting.
    pub fn ssh_arguments(&self) -> Vec<String> {
        let mut args = self.ssh_args.clone();
        if let Some(file) = &self.identity_file {
            args.extend(["-i".to_string(), file.clone()]);
        }
        args
    }
}

/// Refuse a `[[machines]]` entry that could not name or reach a machine, so the mistake shows
/// when the config loads. Each message names the machine and what to change.
pub fn validate_machines(machines: &[MachineDef]) -> Result<()> {
    validate_machines_on(machines, cfg!(windows))
}

/// `validate_machines` for a given platform, so the Windows refusal of `via` is testable anywhere.
pub fn validate_machines_on(machines: &[MachineDef], windows: bool) -> Result<()> {
    for (i, m) in machines.iter().enumerate() {
        let n = i + 1;
        validate_machine_name(n, &m.name)?;
        anyhow::ensure!(
            !machines[..i]
                .iter()
                .any(|o| o.name.eq_ignore_ascii_case(&m.name)),
            "[[machines]] #{n}: another machine is already named `{}`; names differ by more than case",
            m.name
        );
        validate_machine_route(&m.name, m)?;
        validate_machine_via(&m.name, m, windows)?;
    }
    Ok(())
}

/// The element of `via` that is replaced by the remote command.
pub const VIA_PLACEHOLDER: &str = "{command}";

/// Why a `via` machine is refused on Windows, at load and at connect.
pub const VIA_NOT_ON_WINDOWS: &str =
    "a custom transport (`via`) is not supported on Windows in v1; use ssh";

fn validate_machine_via(name: &str, m: &MachineDef, windows: bool) -> Result<()> {
    let Some(via) = &m.via else { return Ok(()) };
    anyhow::ensure!(!windows, "[[machines]] `{name}`: {VIA_NOT_ON_WINDOWS}");
    anyhow::ensure!(
        m.ssh_args.is_empty(),
        "[[machines]] `{name}`: `ssh_args` has no effect with `via` (it is not ssh); remove one of them"
    );
    let Some(program) = via.first() else {
        anyhow::bail!(
            "[[machines]] `{name}`: `via` is empty; give the program and its arguments, or remove the key"
        );
    };
    anyhow::ensure!(
        !program.is_empty() && !program.starts_with('-') && program != VIA_PLACEHOLDER,
        "[[machines]] `{name}`: the first `via` entry is the program to run (got {program:?})"
    );
    for word in via {
        anyhow::ensure!(
            !word.chars().any(char::is_control),
            "[[machines]] `{name}`: each `via` entry is one argument without control characters (got {word:?})"
        );
        anyhow::ensure!(
            !word.contains(VIA_PLACEHOLDER) || word == VIA_PLACEHOLDER,
            "[[machines]] `{name}`: `{VIA_PLACEHOLDER}` must be an entry of its own in `via` (got {word:?})"
        );
    }
    anyhow::ensure!(
        via.iter().filter(|w| *w == VIA_PLACEHOLDER).count() <= 1,
        "[[machines]] `{name}`: `via` has more than one `{VIA_PLACEHOLDER}`"
    );
    Ok(())
}

fn validate_machine_name(n: usize, name: &str) -> Result<()> {
    anyhow::ensure!(!name.is_empty(), "[[machines]] #{n} needs a `name`");
    anyhow::ensure!(
        !name.eq_ignore_ascii_case(LOCAL_MACHINE),
        "[[machines]] #{n}: `{name}` is reserved for this computer; choose another `name`"
    );
    anyhow::ensure!(
        !name.chars().all(|c| c.is_ascii_digit()),
        "[[machines]] `{name}`: a name of only digits reads as a pane id; add a letter to `name`"
    );
    let starts_ok = name.starts_with(|c: char| c.is_ascii_alphanumeric());
    let chars_ok = name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    anyhow::ensure!(
        starts_ok && chars_ok && name.len() <= MACHINE_NAME_MAX,
        "[[machines]] `{name}`: `name` is up to {MACHINE_NAME_MAX} letters, digits, `-`, `_` or `.`, starting with a letter or digit"
    );
    Ok(())
}

fn validate_machine_route(name: &str, m: &MachineDef) -> Result<()> {
    anyhow::ensure!(
        !m.target.is_empty(),
        "[[machines]] `{name}` needs a `target`"
    );
    anyhow::ensure!(
        !m.target.starts_with('-'),
        "[[machines]] `{name}`: `target` {:?} starts with `-`, which ssh would read as an option; give a host",
        m.target
    );
    anyhow::ensure!(
        !m.target
            .chars()
            .any(|c| c.is_whitespace() || c.is_control()),
        "[[machines]] `{name}`: `target` {:?} has whitespace or a control character; give a host, or put options in `ssh_args`",
        m.target
    );
    for arg in &m.ssh_args {
        anyhow::ensure!(
            !arg.is_empty() && !arg.chars().any(char::is_control),
            "[[machines]] `{name}`: each `ssh_args` entry is one non-empty argument without control characters (got {arg:?})"
        );
    }
    if let Some(file) = &m.identity_file {
        anyhow::ensure!(
            !file.trim().is_empty() && !file.starts_with('-') && !file.chars().any(char::is_control),
            "[[machines]] `{name}`: `identity_file` is empty, starts with `-` or has a control character; give the path of a key file, or remove the key"
        );
        anyhow::ensure!(
            m.via.is_none(),
            "[[machines]] `{name}`: `identity_file` has no effect with `via` (it is not ssh); remove one of them"
        );
    }
    if let Some(cmd) = &m.remote_cmd {
        anyhow::ensure!(
            !cmd.trim().is_empty() && !cmd.chars().any(char::is_control),
            "[[machines]] `{name}`: `remote_cmd` is empty or has a control character; give the command, or remove the key"
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{MachineDef, validate_machines, validate_machines_on};

    fn machine(name: &str, target: &str) -> MachineDef {
        MachineDef {
            name: name.into(),
            target: target.into(),
            ..MachineDef::default()
        }
    }

    fn with(edit: impl FnOnce(&mut MachineDef)) -> MachineDef {
        let mut m = machine("box", "h");
        edit(&mut m);
        m
    }

    fn via_machine(via: &[&str]) -> MachineDef {
        let mut m = machine("box", "box");
        m.via = Some(via.iter().map(|w| w.to_string()).collect());
        m
    }

    fn read(toml_text: &str) -> MachineDef {
        toml::from_str(toml_text).unwrap()
    }

    #[test]
    fn a_machine_reads_with_clipboard_on_and_the_other_opt_ins_and_lists_off_unless_set() {
        let m = read("name = 'box'\ntarget = 'me@box'");
        assert_eq!(m, machine("box", "me@box"));
        assert!(m.clipboard, "a copy made there reaches the paste here");
        assert!(!(m.notices || m.sounds || m.mcp), "an agent reaches it only when it says mcp");
        assert!(m.ssh_args.is_empty() && m.via.is_none());
        validate_machines(&[m]).unwrap();
        assert!(!read("name = 'box'\ntarget = 'me@box'\nclipboard = false").clipboard);
        assert!(read("name = 'box'\ntarget = 'me@box'\nmcp = true").mcp);
        let m = read("name = 'b'\ntarget = 'h'\nssh_args = ['-p', '2222', '-i', 'my key']");
        assert_eq!(m.ssh_args, ["-p", "2222", "-i", "my key"]);
        let m = read("name = 'box'\ntarget = 'box'\nvia = ['fly', 'ssh', 'console', '-C', '{command}']");
        assert_eq!(
            m.via.as_deref(),
            Some(&["fly", "ssh", "console", "-C", "{command}"].map(String::from)[..])
        );
    }

    #[test]
    fn an_entry_written_before_key_files_still_loads_and_adds_no_ssh_arguments() {
        let old = read("name = 'box'\ntarget = 'me@box'\nssh_args = ['-p', '2222']");
        assert_eq!(old.identity_file, None);
        assert_eq!(old.ssh_arguments(), ["-p", "2222"]);
    }

    #[test]
    fn a_key_file_becomes_one_dash_i_pair_after_the_other_arguments() {
        let m = read(
            "name = 'b'\ntarget = 'h'\nssh_args = ['-p', '2222']\nidentity_file = 'C:\\Users\\me\\my key'",
        );
        assert_eq!(m.ssh_arguments(), ["-p", "2222", "-i", "C:\\Users\\me\\my key"]);
        validate_machines(&[m]).unwrap();
    }

    /// Each entry ssh could misread, or that clashes with another, is refused, naming what is wrong.
    #[test]
    fn an_entry_ssh_could_misread_or_that_clashes_is_refused() {
        let named = |name: &str| machine(name, "h");
        let key_file = |file: &str| with(|m| m.identity_file = Some(file.into()));
        let remote_cmd = |cmd: &str| with(|m| m.remote_cmd = Some(cmd.into()));
        let mut cases: Vec<(Vec<MachineDef>, bool, &str)> = vec![
            (vec![machine("box", "a"), machine("BOX", "b")], false, "`BOX`"),
            (vec![named("local")], false, "reserved"),
            (vec![named("LOCAL")], false, "reserved"),
            (vec![named("Local")], false, "reserved"),
            (vec![named("12")], false, "pane id"),
            (vec![machine("box", "")], false, "`target`"),
            (vec![with(|m| m.ssh_args = vec!["-p".into(), String::new()])], false, "`ssh_args`"),
            (vec![with(|m| m.ssh_args = vec!["-o\nProxyCommand=x".into()])], false, "`ssh_args`"),
            (vec![remote_cmd("")], false, "`remote_cmd`"),
            (vec![remote_cmd("  ")], false, "`remote_cmd`"),
            (vec![remote_cmd("maiker\nrm -rf ~")], false, "`remote_cmd`"),
            (vec![via_machine(&[])], false, "`via` is empty"),
            (vec![via_machine(&[""])], false, "program"),
            (vec![via_machine(&["-oProxyCommand=x"])], false, "program"),
            (vec![via_machine(&["relay", "{command}", "{command}"])], false, "more than one"),
            (vec![via_machine(&["relay", "x{command}"])], false, "entry of its own"),
            (vec![via_machine(&["relay", "--cmd={command}"])], false, "entry of its own"),
            (
                vec![{
                    let mut m = via_machine(&["relay"]);
                    m.ssh_args = vec!["-p".into(), "22".into()];
                    m
                }],
                false,
                "`ssh_args`",
            ),
            (
                vec![{
                    let mut m = key_file("/k");
                    m.via = Some(vec!["fly".into()]);
                    m
                }],
                false,
                "",
            ),
            (vec![via_machine(&["relay", "{command}"])], true, "not supported on Windows"),
        ];
        for target in ["-oProxyCommand=x", "-p", "--"] {
            cases.push((vec![machine("box", target)], false, "starts with `-`"));
        }
        for target in ["a b", "a\tb", "host\n", "a\u{7}b", "a\u{0}b", "a\u{a0}b"] {
            cases.push((vec![machine("box", target)], false, "whitespace or a control character"));
        }
        for via in [&["relay\n"][..], &["relay", "a\u{7}b"], &["relay", "x\ty"]] {
            cases.push((vec![via_machine(via)], false, "control characters"));
        }
        for file in ["", "  ", "-oProxyCommand=x", "a\nb"] {
            cases.push((vec![key_file(file)], false, ""));
        }
        let too_long = "a".repeat(33);
        for name in ["", "-box", ".box", "my box", "bo/x", "bo:x", "\u{e9}", &too_long] {
            cases.push((vec![named(name)], false, ""));
        }
        for (machines, windows, names) in cases {
            let err = validate_machines_on(&machines, windows)
                .expect_err(&format!("{machines:?}"))
                .to_string();
            assert!(err.contains(names), "{names:?} not in {err}");
        }
    }

    #[test]
    fn a_plain_entry_with_a_name_a_via_or_a_remote_cmd_that_fits_is_accepted() {
        let longest = "a".repeat(32);
        let mut machines: Vec<MachineDef> =
            ["a", "box-1", "web_2.prod", "12b", &longest].iter().map(|name| machine(name, "h")).collect();
        machines.extend(
            [&["relay"][..], &["relay", "--to", "box", "{command}"], &["relay", "{command}", "-x"]]
                .into_iter()
                .map(via_machine),
        );
        machines.push(with(|m| m.remote_cmd = Some("~/.cargo/bin/maiker".into())));
        for m in machines {
            validate_machines_on(std::slice::from_ref(&m), false).unwrap_or_else(|e| panic!("{m:?}: {e}"));
        }
        validate_machines_on(&[machine("box", "box")], true).expect("ssh is fine on Windows");
    }
}
