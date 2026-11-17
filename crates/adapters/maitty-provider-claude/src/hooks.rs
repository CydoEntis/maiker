use jsonc_parser::cst::{CstInputValue, CstObject, CstObjectProp};
use serde_json::Value;
use std::path::Path;

/// Claude Code hook events used for native session status reporting.
pub const STATUS_EVENTS: &[(&str, Option<&str>)] = &[
    ("UserPromptSubmit", None),
    ("PreToolUse", None),
    ("PostToolUse", None),
    ("PermissionRequest", None),
    ("Notification", None),
    ("Stop", None),
    ("SubagentStart", None),
    ("SubagentStop", None),
    ("SessionStart", None),
    ("SessionEnd", None),
];

/// The shell Claude Code runs a hook or status-line command line through: `sh` on macOS and
/// Linux; on Windows Git Bash, or PowerShell when Git Bash isn't installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookShell {
    Posix,
    GitBash,
    PowerShell,
}

/// A program path every shell runs as it is written: no space, quote or character a shell
/// reads specially (forward slashes, which Git Bash does not read as escapes).
fn plain_path(executable: &str) -> bool {
    !executable.is_empty()
        && executable
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '\\' | '.' | '_' | '-' | ':' | '~' | '+'))
}

/// The command line that runs `executable` with `args` through `shell`. On Windows a plain path
/// is written bare, so it runs whether Claude Code has Git Bash or not. A quoted path followed by
/// a word is a parse error in PowerShell, which needs the call operator: `& "C:/…" args`.
pub fn command_line(executable: &str, args: &str, shell: HookShell) -> String {
    match shell {
        HookShell::GitBash | HookShell::PowerShell if plain_path(executable) => format!("{executable} {args}"),
        HookShell::PowerShell => format!("& \"{executable}\" {args}"),
        HookShell::Posix | HookShell::GitBash => format!("\"{executable}\" {args}"),
    }
}

/// Inputs for building a hook group in Claude-compatible settings JSON.
pub struct JsonHookGroupOptions<'a> {
    pub command_name: &'a str,
    pub executable: &'a str,
    pub agent: &'a str,
    pub timeout: u64,
    pub matcher: Option<&'a str>,
    pub shell: HookShell,
}

/// Builds one tagged command hook group for a Claude-compatible settings file.
pub fn json_hook_group(options: JsonHookGroupOptions<'_>) -> Value {
    let JsonHookGroupOptions {
        command_name,
        executable,
        agent,
        timeout,
        matcher,
        shell,
    } = options;
    let command = command_line(executable, &format!("hook {agent}"), shell);
    let mut hook = serde_json::json!({ "type": "command", "command": command, "timeout": timeout });
    // A call-operator line is PowerShell's: say so, so a Git Bash installed later does not run it.
    if command.starts_with('&') {
        hook["shell"] = serde_json::json!("powershell");
    }
    let mut group = serde_json::Map::new();
    group.insert(format!("_{command_name}"), serde_json::json!(true));
    group.insert("hooks".into(), serde_json::json!([hook]));
    if let Some(matcher) = matcher {
        group.insert("matcher".into(), serde_json::json!(matcher));
    }
    Value::Object(group)
}

/// Replaces this app's group for one event, leaving every other group untouched.
pub fn replace_json_hook_group(
    hooks: &CstObject,
    event: &str,
    group: Option<CstInputValue>,
    app_names: &[&str],
) {
    let groups = match hooks.get(event) {
        Some(property) => match property.array_value() {
            Some(groups) => groups,
            None => return,
        },
        None if group.is_none() => return,
        None => hooks
            .append(event, CstInputValue::Array(Vec::new()))
            .array_value_or_set(),
    };
    for existing in groups.elements() {
        if existing
            .to_serde_value()
            .is_some_and(|value| is_our_hook_group(&value, app_names))
        {
            existing.remove();
        }
    }
    if let Some(group) = group {
        groups.append(group);
    }
    if groups.elements().is_empty() {
        hooks.get(event).into_iter().for_each(CstObjectProp::remove);
    }
}

/// File changes the caller must make after updating Claude's status-line setting.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct StatusLineFileChange {
    pub previous_command_to_save: Option<String>,
    pub remove_previous_command: bool,
}

/// Whether `command` invokes this app's status-line wrapper, including renamed installs.
pub fn is_our_statusline(command: &str, app_names: &[&str]) -> bool {
    app_names.iter().any(|name| command.contains(name))
        && command.trim_end().ends_with(" statusline")
}

/// Updates the in-memory Claude status-line setting and returns required file changes.
pub fn update_statusline(
    root: &mut Value,
    executable: &str,
    shell: HookShell,
    app_names: &[&str],
    uninstall: bool,
    previous_command: &str,
) -> anyhow::Result<StatusLineFileChange> {
    let current = root
        .get("statusLine")
        .and_then(|line| line.get("command"))
        .and_then(Value::as_str)
        .map(String::from);
    let is_ours = current
        .as_deref()
        .is_some_and(|command| is_our_statusline(command, app_names));
    let settings = root
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("settings.json is not an object"))?;
    if uninstall {
        if is_ours {
            match previous_command.trim() {
                "" => {
                    settings.remove("statusLine");
                }
                previous => settings["statusLine"]["command"] = serde_json::json!(previous),
            }
        }
        return Ok(StatusLineFileChange {
            previous_command_to_save: None,
            remove_previous_command: true,
        });
    }

    let previous_command_to_save = (!is_ours).then(|| current.unwrap_or_default());
    let line = settings
        .entry("statusLine")
        .or_insert_with(|| serde_json::json!({ "type": "command" }));
    if !line.is_object() {
        *line = serde_json::json!({ "type": "command" });
    }
    line["command"] = serde_json::json!(command_line(executable, "statusline", shell));
    Ok(StatusLineFileChange {
        previous_command_to_save,
        remove_previous_command: false,
    })
}

/// Maps events from Claude-compatible native hook payloads to Maitty status.
pub fn status_from_hook(payload: &Value) -> Option<maitty_shared::protocol::HookStatus> {
    use maitty_shared::protocol::HookStatus;

    let event = payload
        .get("hook_event_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let tool = payload
        .get("tool_name")
        .and_then(Value::as_str)
        .unwrap_or("");
    Some(match event {
        "PreToolUse" if tool == "AskUserQuestion" => HookStatus::Blocked,
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "SubagentStart" => HookStatus::Working,
        "SubagentStop" => HookStatus::Same,
        "PermissionRequest" => HookStatus::Blocked,
        "Notification" => {
            let kind = payload
                .get("notification_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            let message = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            match kind {
                "permission_prompt" | "elicitation_dialog" | "ToolPermission" => {
                    HookStatus::Blocked
                }
                "idle_prompt" => HookStatus::Done,
                _ if message.contains("permission") => HookStatus::Blocked,
                _ => return None,
            }
        }
        "Stop" => HookStatus::Done,
        "SessionStart" => HookStatus::Idle,
        // `/clear` ends one session and starts the next in the same Claude: the agent is still
        // there, so it is not gone (its queue, its name and the saves all stay).
        "SessionEnd" if payload.get("reason").and_then(Value::as_str) == Some("clear") => HookStatus::Same,
        "SessionEnd" => HookStatus::Gone,
        _ => return None,
    })
}

pub fn is_our_name(program: &str, app_names: &[&str]) -> bool {
    app_names.contains(&program)
}

pub fn runs_our_hook(command: &str, app_names: &[&str]) -> bool {
    let (program, args) = split_command(command);
    let stem = Path::new(program)
        .file_stem()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    is_our_name(&stem, app_names) && args.starts_with("hook ")
}

pub fn is_our_hook_group(group: &Value, app_names: &[&str]) -> bool {
    let tagged = |name: &&str| {
        group
            .get(format!("_{name}").as_str())
            .and_then(Value::as_bool)
            == Some(true)
    };
    app_names.iter().any(tagged)
        || group
            .get("hooks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|hook| hook.get("command").and_then(Value::as_str))
            .any(|command| runs_our_hook(command, app_names))
}

pub fn stale_hooks(root: &Value, wanted: &str, app_names: &[&str]) -> Vec<String> {
    let mut stale: Vec<String> = root
        .get("hooks")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|hooks| hooks.values())
        .filter_map(Value::as_array)
        .flatten()
        .filter(|group| is_our_hook_group(group, app_names))
        .filter_map(|group| group.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter_map(|hook| hook.get("command").and_then(Value::as_str))
        .filter(|command| !same_command(command, wanted, cfg!(windows)))
        .map(String::from)
        .collect();
    stale.sort();
    stale.dedup();
    stale
}

/// Whether two hook commands run the same program with the same arguments. On Windows a path's
/// case does not matter (`C:\Users` and `c:\users` are one file); a command seen as different
/// there would be rewritten on every start.
fn same_command(a: &str, b: &str, paths_ignore_case: bool) -> bool {
    if a == b {
        return true;
    }
    let ((a_program, a_args), (b_program, b_args)) = (split_command(a), split_command(b));
    paths_ignore_case && a_args == b_args && a_program.eq_ignore_ascii_case(b_program) && {
        // Only the path may differ in case: quoting and the call operator must match too.
        let shape = |command: &str, program: &str| command.replacen(program, "", 1);
        shape(a, a_program) == shape(b, b_program)
    }
}

fn split_command(command: &str) -> (&str, &str) {
    let command = command.trim_start();
    // PowerShell's call operator before a quoted path (`command_line`).
    let command = command.strip_prefix("& ").map_or(command, str::trim_start);
    let (program, args) = match command.strip_prefix('"') {
        Some(rest) => rest.split_once('"').unwrap_or((rest, "")),
        None => command
            .split_once(char::is_whitespace)
            .unwrap_or((command, "")),
    };
    (program, args.trim_start())
}

#[cfg(test)]
mod tests {
    use super::{
        HookShell, JsonHookGroupOptions, command_line, is_our_hook_group, is_our_name, is_our_statusline, json_hook_group,
        replace_json_hook_group, runs_our_hook, same_command, stale_hooks, status_from_hook, update_statusline,
    };
    use jsonc_parser::cst::CstInputValue;
    use serde_json::json;

    const APP_NAMES: &[&str] = &["maitty", "seshi", "hydra", "drover"];

    #[test]
    fn recognizes_current_and_previous_hook_commands_and_tags() {
        assert!(is_our_name("hydra", APP_NAMES));
        assert!(runs_our_hook(
            "\"C:/Users/me/AppData/Local/Programs/seshi/seshi.exe\" hook claude",
            APP_NAMES
        ));
        assert!(!runs_our_hook("hydra-lint check", APP_NAMES));
        assert!(is_our_hook_group(
            &json!({ "_seshi": true, "hooks": [] }),
            APP_NAMES
        ));
    }

    #[test]
    fn stale_hook_projection_keeps_other_tools_and_deduplicates_old_app_hooks() {
        let wanted = "\"/home/me/.local/bin/maitty\" hook claude";
        let stale = "\"/home/me/.cargo/bin/hydra\" hook claude";
        let root = json!({ "hooks": {
            "Stop": [
                { "hooks": [{ "command": stale }] },
                { "hooks": [{ "command": stale }] },
                { "hooks": [{ "command": wanted }] },
                { "hooks": [{ "command": "someone-elses-hook" }] }
            ]
        }});

        assert_eq!(stale_hooks(&root, wanted, APP_NAMES), [stale]);
    }

    #[test]
    fn a_hook_path_differing_only_in_case_is_the_same_on_windows_only() {
        let wanted = "& \"C:/Users/Me/maitty.exe\" hook claude";
        let lower = "& \"c:/users/me/maitty.exe\" hook claude";
        assert!(same_command(lower, wanted, true));
        assert!(!same_command(lower, wanted, false));
        assert!(!same_command("& \"c:/users/me/maitty.exe\" hook codex", wanted, true));
        assert!(!same_command("\"c:/users/me/maitty.exe\" hook claude", wanted, true));
    }

    #[test]
    fn maps_claude_hook_events_and_leaves_unknown_notifications_unmapped() {
        use maitty_shared::protocol::HookStatus;

        assert_eq!(
            status_from_hook(
                &json!({"hook_event_name":"PreToolUse","tool_name":"AskUserQuestion"})
            ),
            Some(HookStatus::Blocked)
        );
        assert_eq!(
            status_from_hook(
                &json!({"hook_event_name":"Notification","notification_type":"permission_prompt"})
            ),
            Some(HookStatus::Blocked)
        );
        assert_eq!(
            status_from_hook(
                &json!({"hook_event_name":"Notification","notification_type":"unknown"})
            ),
            None
        );
        assert_eq!(
            status_from_hook(&json!({"hook_event_name":"SessionEnd"})),
            Some(HookStatus::Gone)
        );
        assert_eq!(
            status_from_hook(&json!({"hook_event_name":"SessionEnd","reason":"clear"})),
            Some(HookStatus::Same),
            "/clear starts the next session in the same agent"
        );
    }

    #[test]
    fn builds_tagged_hook_groups_with_optional_matchers() {
        let group = json_hook_group(JsonHookGroupOptions {
            command_name: "maitty",
            executable: "/home/user/Maitty App/maitty",
            agent: "claude",
            timeout: 5,
            matcher: Some("AskUserQuestion"),
            shell: HookShell::Posix,
        });

        assert_eq!(group["_maitty"], true);
        assert_eq!(group["matcher"], "AskUserQuestion");
        assert_eq!(group["hooks"][0]["type"], "command");
        assert_eq!(
            group["hooks"][0]["command"],
            "\"/home/user/Maitty App/maitty\" hook claude"
        );
        assert_eq!(group["hooks"][0]["timeout"], 5);
    }

    #[test]
    fn replaces_current_and_legacy_groups_without_removing_other_tools() {
        let document = jsonc_parser::cst::CstRootNode::parse(
            r#"{"hooks":{"Stop":[{"_hydra":true,"hooks":[]},{"hooks":[{"command":"other-tool"}]}]}}"#,
            &jsonc_parser::ParseOptions::default(),
        )
        .unwrap();
        let root = document.object_value().unwrap();
        let hooks = root.get("hooks").unwrap().object_value().unwrap();
        replace_json_hook_group(
            &hooks,
            "Stop",
            Some(CstInputValue::Object(vec![
                ("_maitty".into(), CstInputValue::Bool(true)),
                (
                    "hooks".into(),
                    CstInputValue::Array(vec![CstInputValue::Object(vec![(
                        "command".into(),
                        CstInputValue::String("\"/bin/maitty\" hook claude".into()),
                    )])]),
                ),
            ])),
            &["maitty", "hydra"],
        );

        let result = document.to_serde_value().unwrap();
        let groups = result["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0]["hooks"][0]["command"], "other-tool");
        assert_eq!(
            groups[1]["hooks"][0]["command"],
            "\"/bin/maitty\" hook claude"
        );
    }

    #[test]
    fn statusline_update_preserves_and_restores_the_users_previous_command() {
        let names = ["maitty", "hydra"];
        let mut settings = serde_json::json!({
            "statusLine": { "type": "command", "command": "my-statusline", "padding": 1 }
        });
        let install = update_statusline(&mut settings, "/apps/maitty", HookShell::Posix, &names, false, "").unwrap();
        assert_eq!(
            install.previous_command_to_save.as_deref(),
            Some("my-statusline")
        );
        assert_eq!(
            settings["statusLine"]["command"],
            "\"/apps/maitty\" statusline"
        );
        assert_eq!(settings["statusLine"]["padding"], 1);

        let repeated = update_statusline(
            &mut settings,
            "/apps/maitty-new",
            HookShell::Posix,
            &names,
            false,
            "my-statusline",
        )
        .unwrap();
        assert_eq!(repeated.previous_command_to_save, None);

        let uninstall = update_statusline(
            &mut settings,
            "/apps/maitty-new",
            HookShell::Posix,
            &names,
            true,
            "my-statusline",
        )
        .unwrap();
        assert!(uninstall.remove_previous_command);
        assert_eq!(settings["statusLine"]["command"], "my-statusline");
        assert!(is_our_statusline("\"/apps/hydra.exe\" statusline", &names));
        assert!(!is_our_statusline("my-statusline", &names));
    }

    /// Claude Code on Windows runs a command line through Git Bash, or PowerShell without it, and
    /// PowerShell reads `"C:/…/maitty.exe" statusline` as a string followed by a stray word.
    #[test]
    fn windows_command_lines_run_in_whichever_shell_claude_code_has() {
        let plain = "C:/Users/vox/.local/bin/maitty.exe";
        let spaced = "C:/Users/Vox Smith/.local/bin/maitty.exe";
        for shell in [HookShell::GitBash, HookShell::PowerShell] {
            assert_eq!(command_line(plain, "statusline", shell), format!("{plain} statusline"));
        }
        assert_eq!(command_line(spaced, "statusline", HookShell::GitBash), format!("\"{spaced}\" statusline"));
        assert_eq!(command_line(spaced, "statusline", HookShell::PowerShell), format!("& \"{spaced}\" statusline"));
        assert_eq!(command_line("/usr/bin/maitty", "hook claude", HookShell::Posix), "\"/usr/bin/maitty\" hook claude");

        let group = json_hook_group(JsonHookGroupOptions {
            command_name: "maitty",
            executable: spaced,
            agent: "claude",
            timeout: 5,
            matcher: None,
            shell: HookShell::PowerShell,
        });
        assert_eq!(group["hooks"][0]["shell"], "powershell");
        assert!(is_our_hook_group(&group, APP_NAMES), "a call-operator line is still known as ours");
        assert!(runs_our_hook(&format!("{plain} hook claude"), APP_NAMES));
        assert!(is_our_statusline(&command_line(spaced, "statusline", HookShell::PowerShell), APP_NAMES));
        let bare = json_hook_group(JsonHookGroupOptions { shell: HookShell::GitBash, executable: plain, command_name: "maitty", agent: "claude", timeout: 5, matcher: None });
        assert!(bare["hooks"][0].get("shell").is_none());
    }
}
