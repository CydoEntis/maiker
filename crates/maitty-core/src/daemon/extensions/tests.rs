//! Whole requests against fake `claude` and `codex` programs and isolated files. The programs
//! are shell scripts, so these run where there is a shell; the argument lists they are given are
//! also checked in `write.rs` on every platform.

use super::*;
use crate::daemon::persist::scratch_dir;
use maitty_shared::extensions::{ExtAgent, ExtKind, ExtScope, ExtTarget, McpRun};

const INSTALLED: &str = include_str!("samples/claude-installed-plugins.json");
const MARKETS: &str = include_str!("samples/claude-known-marketplaces.json");
const SETTINGS: &str = include_str!("samples/claude-settings.json");
const CODEX_CONFIG: &str = include_str!("samples/codex-config.toml");
const OK: &str = include_str!("samples/claude-plugin-install-ok.json");

fn put(root: &Path, file: &str, text: &str) {
    let path = root.join(file);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn target(agent: ExtAgent, kind: ExtKind, id: &str) -> ExtTarget {
    ExtTarget { agent, kind, id: id.into(), scope: ExtScope::User, project: None }
}

#[test]
fn a_request_that_is_not_fit_is_refused_before_anything_is_read_or_started() {
    let previews = Previews::default();
    let env = Env {
        homes: Homes { claude_dir: "/no/claude".into(), claude_json: "/no/c.json".into(), codex_dir: "/no/codex".into(), pin_env: true },
        programs: Programs { claude: "/no/claude-program".into(), codex: "/no/codex-program".into() },
        previews: &previews,
    };
    let refused = |request| perform(&env, request).unwrap_err();
    assert_eq!(refused(ExtRequest::Add { token: "made-up".into() }), ExtError::NeedsConfirmation);
    assert!(matches!(refused(ExtRequest::Remove { target: target(ExtAgent::Claude, ExtKind::Skill, "../x") }), ExtError::Invalid(_)));
    assert!(matches!(refused(ExtRequest::List { project: Some("relative".into()) }), ExtError::Invalid(_)));
    assert!(matches!(refused(ExtRequest::List { project: Some("/no/such/folder".into()) }), ExtError::Invalid(_)));
    let bad = ExtAdd::Marketplace { agent: ExtAgent::Claude, source: "--dangerous".into() };
    assert!(matches!(refused(ExtRequest::PreviewAdd { add: bad }), ExtError::Invalid(_)));
    let missing = target(ExtAgent::Claude, ExtKind::Plugin, "a@b");
    assert_eq!(refused(ExtRequest::Remove { target: missing }), ExtError::NotFound, "only something listed can be removed");
}

#[cfg(unix)]
mod with_programs {
    use super::*;
    use crate::daemon::extensions::cli::fake;

    struct Fixture {
        root: crate::daemon::persist::ScratchDir,
        previews: Previews,
    }

    impl Fixture {
        fn new() -> Fixture {
            let root = scratch_dir();
            let path = root.path();
            put(path, "claude/plugins/installed_plugins.json", INSTALLED);
            put(path, "claude/plugins/known_marketplaces.json", MARKETS);
            put(path, "claude/settings.json", SETTINGS);
            put(path, "codex/config.toml", CODEX_CONFIG);
            Fixture { root, previews: Previews::default() }
        }

        fn env(&self) -> Env<'_> {
            let path = self.root.path();
            Env {
                homes: Homes { claude_dir: path.join("claude"), claude_json: path.join("claude.json"), codex_dir: path.join("codex"), pin_env: true },
                programs: Programs { claude: fake::program(path, "claude"), codex: fake::program(path, "codex") },
                previews: &self.previews,
            }
        }
    }

    fn claude_calls(env: &Env) -> Vec<Vec<String>> {
        fake::calls(&env.programs.claude)
    }

    #[test]
    fn an_add_runs_once_and_only_with_the_token_its_preview_gave() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let add = ExtAdd::Mcp { agent: ExtAgent::Claude, name: "docs".into(), run: McpRun::Url { url: "https://mcp.example.com/sse".into() }, scope: ExtScope::User, project: None };
        let Ok(ExtReply::Preview(shown)) = perform(&env, ExtRequest::PreviewAdd { add }) else { panic!("a preview") };
        assert!(claude_calls(&env).is_empty(), "nothing ran for the preview");
        assert_eq!(perform(&env, ExtRequest::Add { token: "0".repeat(32) }), Err(ExtError::NeedsConfirmation));
        assert!(claude_calls(&env).is_empty(), "a token nobody was given runs nothing");
        assert_eq!(perform(&env, ExtRequest::Add { token: shown.token.clone() }), Ok(ExtReply::Done("docs added".into())));
        assert_eq!(claude_calls(&env), [["mcp", "add", "--scope", "user", "--transport", "http", "docs", "https://mcp.example.com/sse"]]);
        assert_eq!(perform(&env, ExtRequest::Add { token: shown.token }), Err(ExtError::NeedsConfirmation), "a second go with the same token");
        assert_eq!(claude_calls(&env).len(), 1);
    }

    #[test]
    fn a_plugin_is_added_in_the_project_folder_and_what_the_agent_says_is_typed() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let project = fixture.root.path().join("my project");
        std::fs::create_dir_all(&project).unwrap();
        put(fixture.root.path(), "mk/.claude-plugin/marketplace.json", include_str!("samples/claude-marketplace.json"));
        let markets = MARKETS.replace("/home/me/sample/mk", &fixture.root.path().join("mk").to_string_lossy());
        put(fixture.root.path(), "claude/plugins/known_marketplaces.json", &markets);
        let add = ExtAdd::Plugin { agent: ExtAgent::Claude, plugin: "hello@local-mk".into(), scope: ExtScope::Project, project: Some(project.to_string_lossy().into_owned()) };
        let Ok(ExtReply::Preview(shown)) = perform(&env, ExtRequest::PreviewAdd { add: add.clone() }) else { panic!("a preview") };
        fake::say(&env.programs.claude, OK, 0);
        assert_eq!(perform(&env, ExtRequest::Add { token: shown.token }), Ok(ExtReply::Done("hello@local-mk added".into())));
        assert_eq!(claude_calls(&env), [["plugin", "install", "hello@local-mk", "--scope", "project", "--json"]]);
        let ran_in = std::fs::read_to_string(env.programs.claude.with_file_name("cwd.txt")).unwrap();
        assert_eq!(std::fs::canonicalize(ran_in).unwrap(), std::fs::canonicalize(&project).unwrap());

        let Ok(ExtReply::Preview(again)) = perform(&env, ExtRequest::PreviewAdd { add }) else { panic!("a preview") };
        fake::say(&env.programs.claude, include_str!("samples/claude-plugin-install-failed.json"), 1);
        assert_eq!(perform(&env, ExtRequest::Add { token: again.token }), Err(ExtError::NotFound));
    }

    #[test]
    fn a_server_that_is_already_there_is_not_added_again() {
        let fixture = Fixture::new();
        let env = fixture.env();
        put(fixture.root.path(), "claude.json", include_str!("samples/claude-json.json"));
        let add = ExtAdd::Mcp { agent: ExtAgent::Claude, name: "srv".into(), run: McpRun::Command { command: "echo".into(), args: vec![] }, scope: ExtScope::User, project: None };
        let Ok(ExtReply::Preview(shown)) = perform(&env, ExtRequest::PreviewAdd { add }) else { panic!("a preview") };
        assert_eq!(perform(&env, ExtRequest::Add { token: shown.token }), Err(ExtError::AlreadyInstalled));
        assert!(claude_calls(&env).is_empty());
    }

    #[test]
    fn a_claude_plugin_is_switched_and_removed_by_claude() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let plugin = target(ExtAgent::Claude, ExtKind::Plugin, "hello@local-mk");
        fake::say(&env.programs.claude, OK, 0);
        assert_eq!(perform(&env, ExtRequest::SetEnabled { target: plugin.clone(), enabled: true }), Ok(ExtReply::Done("hello@local-mk turned on".into())));
        assert_eq!(perform(&env, ExtRequest::Remove { target: plugin }), Ok(ExtReply::Done("hello@local-mk removed".into())));
        assert_eq!(claude_calls(&env), [["plugin", "enable", "hello@local-mk", "--scope", "user", "--json"], ["plugin", "uninstall", "hello@local-mk", "--scope", "user", "--json"]]);
        let market = target(ExtAgent::Claude, ExtKind::Marketplace, "local-mk");
        assert_eq!(perform(&env, ExtRequest::Remove { target: market }), Ok(ExtReply::Done("local-mk removed".into())));
        assert_eq!(claude_calls(&env)[2], ["plugin", "marketplace", "remove", "local-mk", "--json"]);
    }

    #[test]
    fn only_a_plugin_has_a_switch() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let server = target(ExtAgent::Codex, ExtKind::McpServer, "srv");
        assert!(matches!(perform(&env, ExtRequest::SetEnabled { target: server, enabled: false }), Err(ExtError::Invalid(_))));
    }

    #[test]
    fn a_codex_plugin_is_switched_in_the_config_and_removal_is_checked_against_the_listing() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let plugin = target(ExtAgent::Codex, ExtKind::Plugin, "hello@local-mk");
        assert!(perform(&env, ExtRequest::SetEnabled { target: plugin.clone(), enabled: false }).is_ok());
        let config = std::fs::read_to_string(fixture.root.path().join("codex/config.toml")).unwrap();
        assert!(config.contains("[plugins.\"hello@local-mk\"]\nenabled = false"), "{config}");
        assert!(fake::calls(&env.programs.codex).is_empty(), "Codex has no command for it");
        // The fake exits 0 and removes nothing, as Codex does for what it cannot find.
        assert_eq!(perform(&env, ExtRequest::Remove { target: plugin }), Err(ExtError::Failed("Codex did not remove it".into())));
        assert_eq!(fake::calls(&env.programs.codex), [["plugin", "remove", "hello@local-mk"]]);
        let never = target(ExtAgent::Codex, ExtKind::Plugin, "ghost@local-mk");
        assert_eq!(perform(&env, ExtRequest::Remove { target: never }), Err(ExtError::NotFound));
        assert_eq!(fake::calls(&env.programs.codex).len(), 1, "a plugin that is not listed is never asked about");
    }

    #[test]
    fn a_skill_is_removed_by_deleting_its_listed_folder_and_nothing_else() {
        let fixture = Fixture::new();
        let env = fixture.env();
        let root = fixture.root.path();
        put(root, "claude/skills/notes/SKILL.md", "---\nname: Notes\n---\n");
        put(root, "claude/skills/notes/extra/file.txt", "x");
        put(root, "claude/skills/keep/SKILL.md", "---\nname: Keep\n---\n");
        put(root, "claude/skills/loose/readme.txt", "not a skill");
        put(root, "outside/SKILL.md", "---\nname: Outside\n---\n");
        std::os::unix::fs::symlink(root.join("outside"), root.join("claude/skills/linked")).unwrap();
        let skill = |name: &str| target(ExtAgent::Claude, ExtKind::Skill, name);
        assert_eq!(perform(&env, ExtRequest::Remove { target: skill("notes") }), Ok(ExtReply::Done("notes removed".into())));
        assert!(!root.join("claude/skills/notes").exists());
        assert!(root.join("claude/skills/keep/SKILL.md").exists());
        assert_eq!(perform(&env, ExtRequest::Remove { target: skill("loose") }), Err(ExtError::NotFound), "a folder without a skill file is not one the app showed");
        assert!(root.join("claude/skills/loose/readme.txt").exists());
        assert_eq!(perform(&env, ExtRequest::Remove { target: skill("linked") }), Ok(ExtReply::Done("linked removed".into())));
        assert!(!root.join("claude/skills/linked").exists());
        assert!(root.join("outside/SKILL.md").exists(), "a link is removed, never what it points at");
        assert!(claude_calls(&env).is_empty());
    }

    #[test]
    fn an_agent_that_is_not_installed_is_a_missing_cli() {
        let fixture = Fixture::new();
        let mut env = fixture.env();
        env.programs = Programs { claude: fixture.root.path().join("none/claude"), codex: fixture.root.path().join("none/codex") };
        let plugin = target(ExtAgent::Claude, ExtKind::Plugin, "hello@local-mk");
        assert_eq!(perform(&env, ExtRequest::Remove { target: plugin }), Err(ExtError::CliMissing(ExtAgent::Claude)));
    }
}
