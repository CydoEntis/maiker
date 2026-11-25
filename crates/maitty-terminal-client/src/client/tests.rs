//! The client's tests: rendering through TestBackend, keys and clicks.

use super::*;
use crate::brand::APP_COMMAND;

/// Settings on `cat`, with the keys in its rows.
fn open_settings_on(app: &mut App, cat: modal::Cat) {
    app.act(Action::Settings);
    let Mode::ScreenSettings(v) = &mut app.mode else {
        panic!("Settings is open")
    };
    v.cat = modal::Cat::ALL.iter().position(|c| *c == cat).expect("a page");
    v.in_rows = true;
}

mod secret_prompt_tests {
    use super::*;
    use crate::protocol::SecretRequest;
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

    fn request(app: &mut App) {
        app.snap.secret_requests.push(SecretRequest {
            id: 41,
            term: 1,
            label: "API key".into(),
            reason: "Needed to continue".into(),
        });
    }

    #[test]
    fn new_secret_request_opens_once_and_protects_existing_typing() {
        let (_, mut app) = design_tests::render_with(120, 40);
        request(&mut app);
        app.mode = Mode::Normal;

        app.auto_open_secret();
        assert!(matches!(
            app.mode,
            Mode::Secret {
                term: ClientTerm {
                    machine: MachineId::LOCAL,
                    term: 1
                },
                id: 41,
                side: false
            }
        ));

        app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
        assert!(app.screen.secret_typed.0.is_empty());
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert_eq!(app.mode, Mode::Normal);

        app.auto_open_secret();
        assert_eq!(
            app.mode,
            Mode::Normal,
            "the declined request is not offered again"
        );
    }

    #[test]
    fn a_secret_request_waits_while_another_prompt_is_open() {
        let (_, mut app) = design_tests::render_with(120, 40);
        request(&mut app);
        app.mode = Mode::Prompt {
            kind: PromptKind::ConfirmRemoveWorktree(1),
            input: String::new(),
        };
        let mode = app.mode.clone();

        app.auto_open_secret();

        assert_eq!(app.mode, mode);
        assert!(app.screen.secret_offered.is_empty());
    }
}

mod design_tests {
    use super::*;
    use crate::layout::{Dir, Node};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn entry(path: &str, branch: &str, main: bool) -> WorktreeEntry {
        WorktreeEntry {
            path: PathBuf::from(path),
            branch: branch.into(),
            main,
            repo: "shop-api".into(),
        }
    }

    fn term(id: TermId, agent: Option<&str>, status: Status, cwd: &str) -> TermInfo {
        TermInfo {
            conversation_id: None,
            status_why: String::new(),
            why_hook: String::new(),
            why_hook_at: 0,
            why_screen: String::new(),
            why_screen_at: 0,
            why_process_at: 0,
            quiet_since: None,
            repeats: None,
            pid: 0,
            name: String::new(),
            label: String::new(),
            pinned: false,
            archived: false,
            snoozed_until: None,
            model: String::new(),
            mem: 0,
            cpu: 0.0,
            bell: false,
            id,
            cols: 80,
            rows: 20,
            title: String::new(),
            process: if agent.is_some() {
                "node".into()
            } else {
                "pwsh".into()
            },
            agent: agent.map(String::from),
            hooked: true,
            hook_problem: None,
            status,
            cwd: PathBuf::from(cwd),
            summary: String::new(),
            said: String::new(),
            last_lines: String::new(),
            branch: None,
            linked: false,
            diff_added: 0,
            diff_removed: 0,
            diff_files: 0,
            subagents: Vec::new(),
            subagent_activity: Vec::new(),
            session: None,
            effort: None,
            started_by: None,
            tab_of: None,
            helper_ask: Vec::new(),
            started_by_chat: None,
            pr: None,
            queued: Vec::new(),
            waiting_for_slot: false,
            own_turn_over: false,
            root: None,
            top: None,
            since: 0,
            asleep: false,
            win32_input: false,
            remote: None,
            popup: false,
            usage: Default::default(),
            resume_at: None,
            checks: Vec::new(),
            asking: String::new(),
            interrupted: None,
            exit: None,
            ask: None,
            timeline: Vec::new(),
            began_as_agent: false,
        }
    }

    /// The main screen with a few projects and agents, rendered as text.
    pub(super) fn render_with(w: u16, h: u16) -> (String, App) {
        let (tx, _rx) = mpsc::unbounded_channel();
        let (bg_tx, _bg_rx) = mpsc::unbounded_channel();
        let mut cfg = Config::default();
        // The reference's own glyphs: its tests read a state by shape. `dots` is the default.
        cfg.ui.glyphs = "unicode".into();
        // The reference has no padding round the screen; its frames are compared cell for cell.
        cfg.ui.padding = "0".into();
        let mut app = App::new(cfg, tx, None, bg_tx);
        app.splash = false;
        let layout = Node::Leaf(1);
        // A project folder in this platform's own style (tests run on Windows and Linux).
        let base = std::path::Path::new(if cfg!(windows) { r"C:\code" } else { "/code" });
        let root_buf = base.join("shop-api");
        let rate_buf = root_buf.join(".wt").join("rate");
        let orders_buf = root_buf.join(".wt").join("orders");
        let root = root_buf.to_str().unwrap();
        app.snap.workspaces.push(WorkspaceInfo {
            id: 10,
            name: "shop-api".into(),
            cwd: PathBuf::from(root),
            tabs: vec![
                TabInfo {
                    id: 11,
                    name: String::new(),
                    layout,
                    focus: 1,
                },
                TabInfo {
                    id: 12,
                    name: String::new(),
                    layout: Node::Leaf(2),
                    focus: 2,
                },
                TabInfo {
                    id: 13,
                    name: String::new(),
                    layout: Node::Leaf(3),
                    focus: 3,
                },
            ],
            active_tab: 11,
            git: Some(GitInfo {
                repo: "shop-api".into(),
                branch: "main".into(),
                dirty: 2,
                linked: false,
                root: PathBuf::from(root),
                worktrees: vec![
                    entry(root, "main", true),
                    entry(rate_buf.to_str().unwrap(), "rate-limit", false),
                    entry(orders_buf.to_str().unwrap(), "orders-migration", false),
                ],
                ahead: 0,
            }),
            worktree: false,
            color: 0,
            is_new: false,
            group: None,
        });
        app.snap.active_ws = Some(10);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let rate = rate_buf.to_str().unwrap();
        let mut claude = term(1, Some("claude"), Status::Blocked, root);
        claude.branch = Some("main".into());
        claude.subagents = vec![
            "Explore".into(),
            "planner".into(),
            "builder".into(),
            "reviewer".into(),
        ];
        claude.summary = "Fix flaky checkout test".into();
        claude.root = Some(PathBuf::from(root));
        claude.top = Some(PathBuf::from(root));
        claude.since = now - 180;
        let mut codex = term(2, Some("codex"), Status::Working, rate);
        codex.branch = Some("rate-limit".into());
        codex.linked = true;
        codex.summary = "Rate limit /login".into();
        codex.root = Some(PathBuf::from(root));
        codex.top = Some(PathBuf::from(rate));
        codex.since = now - 120;
        let mut shell = term(3, None, Status::None, root);
        shell.root = Some(PathBuf::from(root));
        shell.top = Some(PathBuf::from(root));
        shell.branch = Some("main".into());
        app.snap.terms.insert(1, claude);
        app.snap.terms.insert(2, codex);
        app.snap.terms.insert(3, shell);
        app.screen_sync();
        let mut p = vt100::Parser::new(20, 80, 0);
        p.process(b"> fix the flaky checkout test\r\n\r\nRun npm test -- checkout?\r\n\x1b[1m\xe2\x9d\xaf 1. Yes\x1b[0m\r\n  2. Yes, and always allow\r\n  3. No");
        app.parsers.insert(ClientTerm::local(1), p);
        app.parsers
            .insert(ClientTerm::local(2), vt100::Parser::new(20, 80, 0));
        app.parsers
            .insert(ClientTerm::local(3), vt100::Parser::new(20, 80, 0));
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let mut out = String::new();
        for y in 0..h {
            let mut line = String::new();
            for x in 0..w {
                line.push_str(buf[(x, y)].symbol());
            }
            out.push_str(line.trim_end());
            out.push('\n');
        }
        (out, app)
    }

    #[test]
    fn sync_restores_nested_split_layout_from_daemon_snapshot() {
        let (_, mut app) = render_with(160, 45);
        let mut layout = Node::Leaf(1);
        layout.split(1, Dir::Right, 2);
        layout.split(2, Dir::Down, 3);
        app.snap.workspaces[0].tabs = vec![TabInfo {
            id: 11,
            name: String::new(),
            layout,
            focus: 1,
        }];
        app.screen.tabs.clear();
        app.screen.last_focus = None;
        app.screen_sync();
        let tab = &app.screen.tabs[app.screen.tab];
        assert_eq!(
            tab.layout.leaves(),
            vec![1, 2, 3],
            "the UI must retain all restored panes"
        );
        let rects = tab.layout.rects(ratatui::layout::Rect::new(0, 0, 120, 40));
        let rect = |id| rects.iter().find(|(term, _)| *term == id).unwrap().1;
        assert_eq!(rect(3).x, rect(2).x, "split-down stays in pane 2's column");
        assert!(
            rect(3).y > rect(2).y,
            "split-down places pane 3 below pane 2"
        );
        let mut terminal = Terminal::new(TestBackend::new(160, 45)).unwrap();
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        let rendered = |id| {
            app.screen
                .leaf_rects
                .iter()
                .find(|(term, _)| *term == id)
                .unwrap()
                .1
        };
        assert_eq!(
            rendered(ClientTerm::local(3)).x,
            rendered(ClientTerm::local(2)).x,
            "the screen renderer preserves the nested column"
        );
        assert!(
            rendered(ClientTerm::local(3)).y > rendered(ClientTerm::local(2)).y,
            "the screen renderer places the pane below its sibling"
        );
    }
}

mod screen_tests {
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn draw(app: &mut App, w: u16, h: u16) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect()
    }

    fn show(s: &str) {
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("{s}");
        }
    }

    /// Every key of the overlay's map, as (label, key text), for the current bindings.
    fn all_rows(app: &App) -> Vec<(String, String)> {
        screen::keymap_all_rows(app)
    }

    #[test]
    fn all_keys_lists_every_binding_and_custom_bindings_without_disabled_keys() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        for (key, action) in &app.keymap.prefixed {
            let keys = all_rows(&app)
                .into_iter()
                .filter(|(_, k)| k.split_whitespace().any(|p| p == design::pretty_key(key)))
                .count();
            assert!(
                keys > 0 || matches!(action, Action::None | Action::SendPrefix),
                "leader {key} is listed ({})",
                action.describe()
            );
        }
        // Duplicate keys are gone: one key per action.
        for dropped in [
            "M", "Z", "H", "J", "K", "L", "X", "F", "B", "W", "R", "V", "N", "{", "}", ":",
        ] {
            let spec: crate::keys::KeySpec = dropped.parse().unwrap();
            assert!(
                !app.keymap.prefixed.contains_key(&spec),
                "{dropped} is no longer a leader key"
            );
        }
        app.cfg.prefix = "ctrl+a".into();
        app.cfg.keys.prefix.insert("v".into(), "split-right".into());
        app.cfg.keys.prefix.insert("g".into(), "workflows".into());
        app.cfg
            .keys
            .global
            .insert("alt+0".into(), "spawn-tab:my-agent --review".into());
        app.keymap = app.cfg.keymap();
        assert_eq!(
            app.keymap.prefixed.get(&"v".parse().unwrap()),
            Some(&Action::SplitRight),
            "a user's own binding still loads"
        );
        let rows = all_rows(&app);
        assert!(
            rows.iter().any(|(label, keys)| label == "Search commands"
                && keys.split("  ").any(|set| set.split(' ').any(|k| k == "g"))),
            "{rows:?}"
        );
        assert!(
            rows.iter()
                .any(|(label, keys)| label.contains("my-agent --review") && keys == "Alt+0"),
            "{rows:?}"
        );
        app.cfg.keys.replace_defaults = true;
        app.keymap = app.cfg.keymap();
        assert!(
            !all_rows(&app)
                .iter()
                .any(|(label, keys)| label == "Inbox" && !keys.is_empty()),
            "no default key survives replace_defaults"
        );
    }

    #[test]
    fn the_key_overlay_opens_as_a_map_searches_lists_all_and_runs_keys() {
        for (w, h) in [(80, 24), (100, 30), (160, 45)] {
            let (_, mut app) = super::design_tests::render_with(w, h);
            let (tx, mut rx) = mpsc::unbounded_channel();
            app.out = tx;
            let key = |app: &mut App, c: KeyCode| app.on_key(KeyEvent::new(c, KeyModifiers::NONE));
            // Ctrl+Space, then a pause: the map, with its banner and groups.
            app.open_keymap(None);
            let o = draw(&mut app, w, h);
            show(&o);
            assert!(
                o.contains("goes after the leader") && o.contains("= split") && o.contains("Esc"),
                "{w}x{h}\n{o}"
            );
            for g in ["SESSIONS", "PANES", "SIDEBAR", "TOOLS", crate::brand::APP_HEADING] {
                assert!(o.contains(g), "{w}x{h}: the map has {g}");
            }
            assert!(
                o.contains("run it") && o.contains("show all") && !o.contains("[Esc]"),
                "{o}"
            );
            // ? is the keys help: every key as bound now, with what it does.
            key(&mut app, KeyCode::Char('?'));
            assert!(matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::All));
            let o = draw(&mut app, w, h);
            show(&o);
            for words in ["keys", "esc close", "sessions", "panes", "New shell here", "Split right"] {
                assert!(o.contains(words), "{w}x{h}: the keys help has {words}\n{o}");
            }
            if w >= 100 {
                assert!(o.contains("Keys only work in key mode"), "{w}x{h}\n{o}");
            }
            // Typing from there searches; Tab goes back to the map.
            key(&mut app, KeyCode::Char('s'));
            assert!(
                matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::Search && km.query == "s")
            );
            for c in "idebar".chars() {
                key(&mut app, KeyCode::Char(c));
            }
            let o = draw(&mut app, w, h);
            show(&o);
            assert!(
                o.contains("Collapse sidebar") && o.contains("Hide sidebar"),
                "{w}x{h}\n{o}"
            );
            key(&mut app, KeyCode::Tab);
            assert!(matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::Map));
            key(&mut app, KeyCode::Esc);
            assert_eq!(app.mode, Mode::Normal);
            assert!(
                rx.try_recv().map(|o| o.msg).is_err(),
                "looking at keys sends nothing"
            );
        }
    }

    #[test]
    fn space_searches_every_command_and_enter_runs_it() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        let lead = KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL);
        app.on_key(lead);
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::NONE));
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::Search && km.query.is_empty()),
            "Space opens the search"
        );
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("Commands") && o.contains("New chat"),
            "nothing typed shows the short list of commands\n{o}"
        );
        // Every command the old palette listed can be found by name.
        for a in app.palette_commands() {
            let label = a.describe();
            let found = screen::keymap_actions(
                &app,
                &screen::KeyMap {
                    query: label.to_lowercase(),
                    ..screen::KeyMap::new(screen::KeyView::Search, None)
                },
            );
            let direct = app.keymap.global.values().any(|g| *g == a);
            assert!(
                found.contains(&Some(a.clone())) || label.contains('`') || direct,
                "{label} is found by search"
            );
        }
        // A command with no key is found and runs.
        for c in "clean up".chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
        }
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("Clean up worktrees") && o.contains("Commands"),
            "{o}"
        );
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(
            !matches!(app.mode, Mode::KeyMap(_)),
            "Enter runs it and closes the overlay"
        );
        assert_eq!(
            app.screen.saved.recent.first().map(String::as_str),
            Some("tidy-worktrees"),
            "and it is recent now"
        );
        let _ = rx.try_recv().map(|o| o.msg);
    }

    #[test]
    fn active_sidebar_selection_survives_hover_and_keyboard_browsing() {
        let (_, mut app) = super::design_tests::render_with(120, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.screen_focus(ClientTerm::local(1));
        app.mode = Mode::Normal;
        let mut terminal = Terminal::new(TestBackend::new(120, 30)).unwrap();
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        let x = app.screen.side_rect.x;
        let active_y = app.screen.row_y[&ClientTerm::local(1)];
        let hover_y = app.screen.row_y[&ClientTerm::local(2)];
        let active_bg = terminal.backend().buffer()[(x + 8, active_y)].bg;
        for (column, row) in [(x + 10, hover_y), (x + 4, 3), (x + 4, 27), (80, 20)] {
            app.on_mouse(MouseEvent {
                kind: MouseEventKind::Moved,
                column,
                row,
                modifiers: KeyModifiers::NONE,
            });
            terminal.draw(|f| render::draw(&mut app, f)).unwrap();
            assert_eq!(
                app.focused(),
                Some(ClientTerm::local(1)),
                "hover never changes the active pane"
            );
            if !(active_y..active_y + 3).contains(&row) {
                assert_eq!(
                    terminal.backend().buffer()[(x + 8, active_y)].bg,
                    active_bg,
                    "pointing elsewhere leaves the open row as it is"
                );
            }
        }
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column: x + 10,
            row: hover_y,
            modifiers: KeyModifiers::NONE,
        });
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        assert_ne!(
            terminal.backend().buffer()[(x + 8, hover_y)].bg,
            active_bg,
            "hover has its own quieter style"
        );
        app.screen_side_set(screen::SideItem::Sess(ClientSession::local(
            SessionKey::Pane(2),
        )));
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Moved,
            column: 100,
            row: 20,
            modifiers: KeyModifiers::NONE,
        });
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        let buf = terminal.backend().buffer();
        assert_eq!(
            buf[(x + 8, hover_y)].bg,
            app.theme.sel_bg(),
            "while the keyboard browses, its row is the selected one"
        );
        assert_eq!(
            buf[(x + 8, active_y)].bg,
            app.theme.sel_bg(),
            "and the session open in the workspace keeps its row ground (the same neutral)"
        );
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: x + 10,
            row: hover_y,
            modifiers: KeyModifiers::NONE,
        });
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Up(MouseButton::Left),
            column: x + 10,
            row: hover_y,
            modifiers: KeyModifiers::NONE,
        });
        assert!(
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
                .any(|m| matches!(m, ClientMsg::Command(Command::FocusPane { term: 2 })))
        );
        app.snap.workspaces[0].tabs[0].focus = 2;
        app.screen_sync();
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        assert_eq!(app.focused(), Some(ClientTerm::local(2)));
        assert_eq!(
            terminal.backend().buffer()[(x + 8, hover_y)].bg,
            app.theme.sel_bg(),
            "the session now open has the row ground"
        );
    }

    #[test]
    fn installing_an_update_keeps_the_window_and_sessions_running() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        let focused = app.focused();
        app.got_state = true;
        app.snap.daemon_version = "0.36.11".into();
        app.updating = true;
        app.update_available = Some("9.9.9".into());
        app.update_installed("9.9.9".into());
        assert!(!app.updating && app.update_available.is_none());
        assert_eq!(app.installed_version, Some(Ok("9.9.9".into())));
        assert!(app.quit.is_none() && app.restart_pending());
        assert_eq!(app.focused(), focused);
        assert!(
            rx.try_recv().map(|o| o.msg).is_err(),
            "install completion sends no session commands"
        );
        assert!(app.notice.as_ref().is_some_and(|(text, ..)| {
            text.contains("restart automatically when no sessions are open")
        }));
    }

    #[test]
    fn installing_an_update_restarts_the_daemon_when_no_sessions_are_open() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.got_state = true;
        app.snap.terms.clear();
        app.snap.daemon_version = "0.36.11".into();
        app.update_installed("0.36.12".into());

        assert!(matches!(
            rx.try_recv().map(|o| o.msg),
            Ok(ClientMsg::Command(Command::KillServer { forget: false }))
        ));
    }

    #[test]
    fn daemon_update_waits_until_the_last_session_closes() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.installed_version = Some(Ok("0.36.12".into()));
        app.snap.daemon_version = "0.36.11".into();
        assert!(
            rx.try_recv().map(|o| o.msg).is_err(),
            "open sessions must not be interrupted"
        );

        let mut snapshot = app.snap.clone();
        snapshot.terms.clear();
        app.on_server(ServerMsg::State(snapshot));

        assert!(matches!(
            rx.try_recv().map(|o| o.msg),
            Ok(ClientMsg::Command(Command::KillServer { forget: false }))
        ));
    }

    #[test]
    fn a_matching_daemon_version_completes_the_automatic_restart() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.installed_version = Some(Ok(env!("APP_VERSION").into()));
        app.daemon_restart_requested = true;
        app.daemon_restart_reconnect = true;
        let mut snapshot = app.snap.clone();
        snapshot.daemon_version = env!("APP_VERSION").into();

        app.on_server(ServerMsg::State(snapshot));

        assert!(!app.daemon_restart_requested && !app.daemon_restart_reconnect);
        assert!(
            rx.try_recv().map(|o| o.msg).is_err(),
            "a current daemon must not be restarted again"
        );
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(text, ..)| text.contains("daemon restarted with the update"))
        );
    }
    #[test]
    fn planned_daemon_restart_keeps_the_window_open_for_reconnect() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.daemon_restart_requested = true;

        app.on_server(ServerMsg::Bye);

        assert!(app.quit.is_none());
        assert!(app.daemon_restart_reconnect);
    }

    #[test]
    fn versions_distinguish_installed_window_and_running_daemon() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.installed_version = Some(Ok("9.9.9".into()));
        app.snap.daemon_version = "0.20.0".into();
        open_settings_on(&mut app, modal::Cat::About);
        let output = draw(&mut app, 100, 30);
        show(&output);
        assert!(output.contains("Installed here: 9.9.9") && output.contains("This window:"));
        assert!(output.contains("Running daemon: 0.20.0") && output.contains("Restart pending"));
        app.update_available = Some("9.9.9".into());
        app.update_checked_now(true, Ok(None), Vec::new());
        assert!(
            app.update_available.is_none(),
            "a release already installed is not offered again"
        );
        assert!(app.restart_pending());
        app.installed_version = Some(Ok(env!("APP_VERSION").into()));
        app.snap.daemon_version = env!("APP_VERSION").into();
        assert!(!app.restart_pending());
        app.installed_version = Some(Err("unreadable executable".into()));
        assert!(draw(&mut app, 80, 24).contains("unavailable"));
    }

    #[test]
    fn a_status_mark_has_no_click_target_of_its_own() {
        let (_, mut app) = super::design_tests::render_with(120, 30);
        app.mode = Mode::Side;
        draw(&mut app, 120, 30);
        let row = app
            .hits
            .iter()
            .find_map(|(r, h)| matches!(h, Hit::Screen(screen::ScreenHit::Session(_))).then_some(*r))
            .expect("a session row");
        // The mark is two cells into its row.
        let mark = ratatui::layout::Position::new(row.x + 2, row.y);
        assert!(
            matches!(
                app.hover_hit(mark),
                Some((_, Hit::Screen(screen::ScreenHit::Session(_))))
            ),
            "a click on the mark is the row's click"
        );
    }

    #[test]
    #[ignore = "opt-in release-mode performance measurement; no wall-clock CI threshold"]
    fn session_interactions_under_heavy_output() {
        const PANES: u32 = 8;
        const CYCLES: usize = 120;
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let base_ws = app.snap.workspaces[0].clone();
        let base_term = app.snap.terms[&2].clone();
        app.snap.workspaces.clear();
        app.snap.terms.clear();
        app.parsers.clear();
        app.screen.tabs.clear();
        for id in 1..=PANES {
            let mut info = base_term.clone();
            info.id = id;
            info.status = Status::Working;
            let mut ws = base_ws.clone();
            ws.id = 100 + id;
            ws.tabs.truncate(1);
            ws.tabs[0].id = 200 + id;
            ws.tabs[0].layout = crate::layout::Node::Leaf(id);
            ws.tabs[0].focus = id;
            ws.active_tab = 200 + id;
            app.snap.workspaces.push(ws);
            app.snap.terms.insert(id, info);
            app.parsers
                .insert(ClientTerm::local(id), app.new_parser(30, 100));
        }
        app.snap.active_ws = Some(101);
        app.screen_fresh();
        app.screen_focus(ClientTerm::local(1));
        let mut terminal = Terminal::new(TestBackend::new(160, 45)).unwrap();
        terminal.draw(|f| render::draw(&mut app, f)).unwrap();
        app.sync_sizes();
        let mut timings: [Vec<f64>; 4] = std::array::from_fn(|_| Vec::new());
        let mut bytes = 0;
        let mut scrolled = false;
        for cycle in 0..CYCLES {
            let payload = format!("\x1b[32mstress-{cycle:03}\x1b[0m output with enough text to wrap at narrow widths\r\n").repeat(64).into_bytes();
            let began = Instant::now();
            for id in 1..=PANES {
                bytes += payload.len();
                app.on_server(ServerMsg::Output {
                    term: id,
                    data: payload.clone(),
                });
            }
            timings[3].push(began.elapsed().as_secs_f64() * 1000.0);
            app.mode = Mode::Normal;
            let began = Instant::now();
            let action = cycle % 3;
            let wanted = (cycle / 3) as u32 % PANES + 1;
            match action {
                0 => {
                    app.screen_focus(ClientTerm::local(wanted));
                    let mut acknowledged = app.snap.clone();
                    acknowledged.active_ws = Some(100 + wanted);
                    app.on_server(ServerMsg::State(acknowledged));
                }
                1 => {
                    let r = app.panes[0].1;
                    app.on_mouse(MouseEvent {
                        kind: MouseEventKind::ScrollUp,
                        column: r.x + 1,
                        row: r.y + 1,
                        modifiers: KeyModifiers::NONE,
                    });
                    scrolled |= app.focused().is_some_and(|id| app.history(id).0 > 0);
                }
                _ => {
                    let (width, height) = if cycle % 2 == 0 { (100, 30) } else { (160, 45) };
                    terminal.backend_mut().resize(width, height);
                    app.on_event(event::Event::Resize(width, height));
                }
            }
            terminal.draw(|f| render::draw(&mut app, f)).unwrap();
            app.sync_sizes();
            timings[action].push(began.elapsed().as_secs_f64() * 1000.0);
            if action == 0 {
                assert_eq!(app.focused(), Some(ClientTerm::local(wanted)));
            }
            let area = terminal.backend().buffer().area;
            assert!(
                app.panes
                    .iter()
                    .all(|(_, r)| r.right() <= area.right() && r.bottom() <= area.bottom())
            );
        }
        assert!(scrolled, "the benchmark really exercised scrollback");
        assert!(
            app.parsers[&ClientTerm::local(PANES)]
                .screen()
                .contents()
                .contains("stress-"),
            "output survived switching and rewrapping"
        );
        println!(
            "{PANES} panes, {} output messages, {bytes} bytes",
            CYCLES * PANES as usize
        );
        for (label, mut samples) in ["switch", "scroll", "resize", "output burst"]
            .into_iter()
            .zip(timings)
        {
            samples.sort_by(f64::total_cmp);
            println!(
                "{label}: p50={:.3}ms p95={:.3}ms max={:.3}ms",
                samples[samples.len() / 2],
                samples[(samples.len() * 95 / 100).min(samples.len() - 1)],
                samples[samples.len() - 1]
            );
        }
    }

    /// The splash at the design's three sizes: the tagline, the cards with Resume chosen and its
    /// last place under it until the window is short, the hints, the version bottom right.
    #[test]
    fn the_splash_keeps_its_start_box_at_smaller_sizes() {
        for (w, h) in [(120u16, 34u16), (80, 24)] {
            let (_, mut app) = super::design_tests::render_with(w, h);
            app.splash = true;
            let o = draw(&mut app, w, h);
            show(&o);
            let lines: Vec<&str> = o.lines().collect();
            let row = |needle: &str| {
                lines
                    .iter()
                    .position(|l| l.contains(needle))
                    .unwrap_or_else(|| panic!("{w}x{h}: no {needle:?}\n{o}"))
            };
            let (start, resume, new, open) = (
                row(" START "),
                row("Resume where you left off"),
                row("New session"),
                row("Open a project…"),
            );
            assert!(
                start < resume && resume < new && new < open,
                "{w}x{h}: top to bottom"
            );
            assert!(
                !o.contains("WHILE YOU WERE AWAY"),
                "{w}x{h}: no room for the away box"
            );
            // What the away box would say is a line over START: who needs you is never dropped.
            assert!(
                row("need you") < start && lines[row("need you")].contains("still working"),
                "{w}x{h}: the counts"
            );
            // The wordmark and its tagline give way in a short window.
            assert_eq!(
                o.contains(concat!(env!("APP_TAGLINE"), ".")),
                h >= 34,
                "{w}x{h}: the wordmark"
            );
            assert!(!o.contains("switch box"), "{w}x{h}: no row of key hints");
        }
    }

    #[test]
    fn tab_moves_the_wide_splash_between_its_boxes_and_enter_opens_the_chosen_row() {
        let (_, mut app) = super::design_tests::render_with(172, 56);
        let key = |c: KeyCode| KeyEvent::new(c, KeyModifiers::NONE);
        app.splash = true;
        draw(&mut app, 172, 56);
        assert!(!app.screen.splash_away);
        app.on_key(key(KeyCode::Tab));
        assert!(app.screen.splash_away, "Tab goes to the away box");
        app.on_key(key(KeyCode::Tab));
        assert!(!app.screen.splash_away, "and back");
        // The projects are rows after the choices.
        let choices = screen::splash_options(&app).len();
        for _ in 0..choices {
            app.on_key(key(KeyCode::Down));
        }
        assert_eq!(app.screen.splash_sel, choices, "the first project");
        app.on_key(key(KeyCode::Enter));
        assert!(!app.splash, "a project opens");
        assert_eq!(app.mode, Mode::Normal, "the keys go to the session it opened");
    }

    #[test]
    fn a_working_subagent_does_not_animate_when_its_parent_is_idle() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        for term in app.snap.terms.values_mut() {
            term.status = Status::None;
        }
        let pane = app.snap.terms.get_mut(&1).unwrap();
        pane.subagent_activity = vec![SubagentActivity {
            id: "child-live".into(),
            name: "worker".into(),
            parent: None,
            state: SubagentState::Working,
            task: None,
            model: None,
            effort: None,
            started_at: None,
            updated_at: 0,
            latest_activity: None,
            result: None,
        }];
        assert!(
            !app.any_working(),
            "child rows have no spinner to animate when the parent is idle"
        );
    }

    #[test]
    fn no_answer_buttons_without_a_question_on_screen() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // Still "needs you", but what asked is gone (auto mode settled it).
        let mut p = vt100::Parser::new(40, 120, 0);
        p.process(b"* Waiting for 1 dynamic workflow to finish");
        app.parsers.insert(ClientTerm::local(1), p);
        let o = draw(&mut app, 160, 45);
        assert!(
            !o.contains("● answer") && !o.contains(" Yes 1 "),
            "no buttons that would only type a digit"
        );
    }

    #[test]
    fn the_inbox_answers_from_where_you_are() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // claude (pane 1) asks a numbered question (on its screen in the fixture); codex finished.
        let t = app.snap.terms.get_mut(&2).unwrap();
        (t.status, t.said) = (Status::Done, "All 14 tests pass now.".into());
        app.screen_fresh();
        app.act(Action::Jump);
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("INBOX")
                && o.contains("NEEDS YOU  1")
                && o.contains("FINISHED  1")
                && !o.contains("EVERYTHING"),
            "the Inbox sheet: what needs you, what finished"
        );
        assert!(
            o.contains("Run npm test -- checkout?")
                && o.contains("Reply m")
                && o.contains("Open o"),
            "the question and what to do about it"
        );
        assert!(
            o.contains("↑↓") && o.contains("select") && o.contains("Esc") && o.contains("close"),
            "the sheet's keys"
        );
        // It floats over the workspace from the sidebar's side, 62 columns wide.
        assert_eq!(app.screen.sheet_rect.width, 62);
        // 2 answers the selected question without going there.
        app.on_key(KeyEvent::new(KeyCode::Char('2'), KeyModifiers::NONE));
        assert!(matches!(app.mode, Mode::GoTo { .. }), "still in the Inbox");
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(m, ..)| m.contains("Always")),
            "{:?}",
            app.notice
        );
        // Typing finds any session instead (numbers too, once you're typing).
        for ch in "rate".chars() {
            app.on_key(KeyEvent::new(KeyCode::Char(ch), KeyModifiers::NONE));
        }
        let o = draw(&mut app, 160, 45);
        assert!(
            o.contains("FOUND  1") && !o.contains("NEEDS YOU"),
            "searching: just what matches"
        );
        // j closes it again, and opens it afresh.
        app.act(Action::Jump);
        assert!(app.mode == Mode::Normal, "j closes the Inbox");
        app.act(Action::Jump);
        assert!(matches!(&app.mode, Mode::GoTo { query, .. } if query.is_empty()));
    }

    #[test]
    fn wheel_scrolls_history() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // The terminal is as big as the card's inside (the app sizes it so).
        let (_, inside) = app.panes[0];
        let mut p = vt100::Parser::new(inside.height, inside.width, 1000);
        for i in 1..=100 {
            p.process(
                format!(
                    "line {i}
"
                )
                .as_bytes(),
            );
        }
        app.parsers.insert(ClientTerm::local(1), p);
        let o = draw(&mut app, 160, 45);
        assert!(
            o.contains("line 100") && !o.contains("line 40 "),
            "bottom first"
        );
        let (_, inner) = app.panes[0];
        for _ in 0..10 {
            app.on_mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: inner.x + 5,
                row: inner.y + 5,
                modifiers: KeyModifiers::NONE,
            });
        }
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            !o.contains("line 100"),
            "scrolled up: {:?}",
            app.history(ClientTerm::local(1))
        );
        assert!(
            o.contains("↓ Back to bottom · 30 lines up"),
            "and it says so, with a way back"
        );
        app.on_key(KeyEvent::new(KeyCode::PageDown, KeyModifiers::SHIFT));
        app.on_key(KeyEvent::new(KeyCode::PageDown, KeyModifiers::SHIFT));
        let o = draw(&mut app, 160, 45);
        assert!(
            o.contains("line 100") && !o.contains("lines up"),
            "Shift+PageDown back to the bottom"
        );
    }

    /// Where the "Back to bottom" button was drawn for `term`, if it was.
    fn to_bottom_at(app: &App, term: TermId) -> Option<Rect> {
        app.hits
            .iter()
            .find(|(_, h)| *h == Hit::Screen(screen::ScreenHit::ToBottom(ClientTerm::local(term))))
            .map(|(r, _)| *r)
    }

    #[test]
    fn back_to_bottom_is_a_click_away_in_apps_history() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (_, inside) = app.panes[0];
        let mut p = vt100::Parser::new(inside.height, inside.width, 1000);
        for i in 1..=100 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        assert!(to_bottom_at(&app, 1).is_none(), "at the bottom: no button");
        app.scroll_to(ClientTerm::local(1), 30);
        draw(&mut app, 160, 45);
        let at = to_bottom_at(&app, 1).expect("scrolled up: a button");
        let (_, inner) = app.panes[0];
        assert_eq!(at.y, inner.bottom() - 1, "at the bottom of the pane");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: at.x + 1,
            row: at.y,
            modifiers: KeyModifiers::NONE,
        });
        assert_eq!(
            app.history(ClientTerm::local(1)).0,
            0,
            "one click: back at the newest line"
        );
    }

    #[test]
    fn back_to_bottom_pages_an_agent_that_scrolls_itself_back_down() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let mut p = vt100::Parser::new(40, 120, 1000);
        p.process(b"\x1b[?1049h");
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        let (_, inner) = app.panes[0];
        for _ in 0..3 {
            app.wheel_page = None;
            app.on_mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: inner.x + 5,
                row: inner.y + 5,
                modifiers: KeyModifiers::NONE,
            });
        }
        while rx.try_recv().map(|o| o.msg).is_ok() {}
        let o = draw(&mut app, 160, 45);
        assert!(o.contains("↓ Back to bottom"), "{o}");
        let at = to_bottom_at(&app, 1).expect("a button");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: at.x + 1,
            row: at.y,
            modifiers: KeyModifiers::NONE,
        });
        let sent: Vec<u8> = std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .filter_map(|m| {
                if let ClientMsg::Input { term: 1, data } = m {
                    Some(data)
                } else {
                    None
                }
            })
            .flatten()
            .collect();
        assert_eq!(
            sent,
            b"\x1b[6~".repeat(3),
            "three pages up, three back down"
        );
        assert!(
            !draw(&mut app, 160, 45).contains("Back to bottom"),
            "and the button goes"
        );
    }

    #[test]
    fn typing_to_an_agent_clears_its_back_to_bottom() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let mut p = vt100::Parser::new(40, 120, 1000);
        p.process(b"\x1b[?1049h");
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        let (_, inner) = app.panes[0];
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: inner.x + 5,
            row: inner.y + 5,
            modifiers: KeyModifiers::NONE,
        });
        assert!(draw(&mut app, 160, 45).contains("Back to bottom"));
        app.on_key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE));
        assert!(
            !draw(&mut app, 160, 45).contains("Back to bottom"),
            "the agent scrolls to its prompt itself"
        );
    }

    #[test]
    fn wheel_scrolls_history_even_when_the_program_takes_the_mouse() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // An agent printing into the normal screen (its history above) that also asked for
        // the mouse: the wheel is still for scrolling back.
        let mut p = vt100::Parser::new(40, 120, 1000);
        for i in 1..=100 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        p.process(b"\x1b[?1000h\x1b[?1006h");
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        let (_, inner) = app.panes[0];
        for _ in 0..5 {
            app.on_mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: inner.x + 5,
                row: inner.y + 5,
                modifiers: KeyModifiers::NONE,
            });
        }
        assert_eq!(
            app.history(ClientTerm::local(1)).0,
            15,
            concat!(env!("APP_COMMAND"), " scrolled its history")
        );
        // A full-screen program (no history of its own here) gets the wheel itself.
        let mut p = vt100::Parser::new(40, 120, 1000);
        p.process(b"\x1b[?1049h\x1b[?1000h\x1b[?1006h");
        app.parsers.insert(ClientTerm::local(1), p);
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::ScrollUp,
            column: inner.x + 5,
            row: inner.y + 5,
            modifiers: KeyModifiers::NONE,
        });
        assert_eq!(
            app.history(ClientTerm::local(1)).0,
            0,
            "the program scrolls itself"
        );
    }

    #[test]
    fn a_normal_screen_agent_with_no_history_gets_the_wheel_as_a_mouse_report_or_a_page_up() {
        use crossterm::event::{MouseEvent, MouseEventKind};
        // With mouse capture on, the program gets an SGR wheel report; with it off, PageUp.
        for (screen, want) in [
            (&b"\x1b[?1000h\x1b[?1006h"[..], &b"\x1b[<64;6;6M"[..]),
            (&b""[..], &b"\x1b[5~"[..]),
        ] {
            let (_, mut app) = super::design_tests::render_with(160, 45);
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
            app.out = tx;
            let mut p = vt100::Parser::new(40, 120, 1000);
            p.process(screen);
            app.parsers.insert(ClientTerm::local(1), p);
            draw(&mut app, 160, 45);
            let (_, pane) = app.panes[0];

            app.on_mouse(MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: pane.x + 5,
                row: pane.y + 5,
                modifiers: KeyModifiers::NONE,
            });

            assert!(
                matches!(rx.try_recv().map(|o| o.msg), Ok(crate::protocol::ClientMsg::Input { term: 1, data }) if data == want),
                "screen set up with {screen:?}"
            );
        }
    }

    #[test]
    fn page_up_reaches_a_normal_screen_agent_when_history_is_empty() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        app.parsers
            .insert(ClientTerm::local(1), vt100::Parser::new(40, 120, 1000));

        app.on_key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE));

        assert!(
            matches!(rx.try_recv().map(|o| o.msg), Ok(crate::protocol::ClientMsg::Input { term: 1, data }) if data == b"\x1b[5~")
        );
    }

    #[test]
    fn behaves_like_a_terminal() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let mut p = vt100::Parser::new(40, 120, 1000);
        for i in 1..=100 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        // PageUp at a prompt scrolls history; a scrollbar shows where you are.
        app.on_key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE));
        assert!(
            app.history(ClientTerm::local(1)).0 > 10,
            "PageUp scrolled: {:?}",
            app.history(ClientTerm::local(1))
        );
        let o = draw(&mut app, 160, 45);
        assert!(o.contains("┃"), "scrollbar thumb");
        app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));
        assert_eq!(
            app.history(ClientTerm::local(1)).0,
            0,
            "typing goes back to the bottom"
        );
        // A full-screen program keeps PageUp for itself.
        if let Some(p) = app.parsers.get_mut(&ClientTerm::local(1)) {
            p.process(b"\x1b[?1049h");
        }
        app.on_key(KeyEvent::new(KeyCode::PageUp, KeyModifiers::NONE));
        assert_eq!(
            app.history(ClientTerm::local(1)).0,
            0,
            "PageUp went to the program"
        );
        // Synchronized output holds drawing until it ends.
        app.on_server(ServerMsg::Output {
            term: 1,
            data: b"\x1b[?2026hhalf a frame".to_vec(),
        });
        assert!(app.sync_hold_until().is_some(), "held mid update");
        app.on_server(ServerMsg::Output {
            term: 1,
            data: b"rest\x1b[?2026l".to_vec(),
        });
        assert!(app.sync_hold_until().is_none(), "drawn once it's whole");
        // Focus reporting.
        app.on_server(ServerMsg::Output {
            term: 1,
            data: b"\x1b[?1004h".to_vec(),
        });
        assert!(app.focus_report.contains(&ClientTerm::local(1)));
        // A program's clipboard copy reaches the user (and says so).
        app.on_server(ServerMsg::Clipboard {
            term: 1,
            text: "hello".into(),
        });
        assert!(
            app.notice_card
                .as_ref()
                .is_some_and(|c| c.detail.contains("5 characters")),
            "the same card as a copy made here"
        );
    }

    #[test]
    fn rewraps_on_resize_and_follows_the_cursor_style() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // A plain shell: text re-wraps; an agent paints its own screen (next test).
        app.snap.terms.get_mut(&1).unwrap().agent = None;
        // Narrow pane: a long line wraps over several rows.
        let long = "word ".repeat(40);
        app.sizes.insert(ClientTerm::local(1), (40, 20));
        app.shown_panes.insert(ClientTerm::local(1));
        app.parsers
            .insert(ClientTerm::local(1), vt100::Parser::new(20, 40, 1000));
        app.on_server(ServerMsg::Output {
            term: 1,
            data: format!("{long}\r\nend\x1b[5 q").into_bytes(),
        });
        let rows_of = |app: &App| {
            let sc = app.parsers[&ClientTerm::local(1)].screen();
            sc.rows(0, sc.size().1)
                .filter(|l| l.contains("word"))
                .count()
        };
        let rows_narrow = rows_of(&app);
        assert!(rows_narrow >= 5, "wrapped narrow: {rows_narrow}");
        // Wider: the same text re-wraps into fewer rows instead of being cut.
        app.panes = vec![(
            ClientTerm::local(1),
            Rect {
                x: 0,
                y: 0,
                width: 120,
                height: 20,
            },
        )];
        app.sync_sizes();
        let rows_wide = rows_of(&app);
        assert!(
            rows_wide < rows_narrow && rows_wide >= 1,
            "re-wrapped: {rows_wide} rows (was {rows_narrow})"
        );
        assert!(
            app.parsers[&ClientTerm::local(1)]
                .screen()
                .contents()
                .contains("end")
        );
        // The program asked for a blinking bar.
        assert_eq!(app.cursor_style.get(&ClientTerm::local(1)), Some(&5));
    }

    #[test]
    fn an_agent_pane_is_only_resized_never_replayed_into_a_screen_of_another_width() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        assert!(
            app.snap.terms[&1].agent.is_some(),
            "the fixture's pane 1 is an agent"
        );
        let long = "word ".repeat(40);
        app.sizes.insert(ClientTerm::local(1), (40, 20));
        app.parsers
            .insert(ClientTerm::local(1), vt100::Parser::new(20, 40, 1000));
        app.on_server(ServerMsg::Output {
            term: 1,
            data: format!("{long}\r\nend").into_bytes(),
        });
        let rows_of = |app: &App| {
            let sc = app.parsers[&ClientTerm::local(1)].screen();
            sc.rows(0, sc.size().1)
                .filter(|l| l.contains("word"))
                .count()
        };
        let before = rows_of(&app);
        app.panes = vec![(
            ClientTerm::local(1),
            Rect {
                x: 0,
                y: 0,
                width: 120,
                height: 20,
            },
        )];
        app.sync_sizes();
        assert_eq!(
            rows_of(&app),
            before,
            "its screen was not rebuilt from the old output; the program redraws on the new size"
        );
        assert_eq!(app.parsers[&ClientTerm::local(1)].screen().size(), (20, 120));
    }

    #[test]
    fn a_pane_shown_again_has_its_size_told_to_the_daemon_afresh() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let term = ClientTerm::local(1);
        let rect = Rect {
            x: 0,
            y: 0,
            width: 100,
            height: 30,
        };
        let resizes = |rx: &mut tokio::sync::mpsc::UnboundedReceiver<Outgoing>| {
            std::iter::from_fn(|| rx.try_recv().ok())
                .filter(|o| matches!(o.msg, ClientMsg::Resize { .. }))
                .count()
        };
        app.panes = vec![(term, rect)];
        app.sync_sizes();
        assert_eq!(resizes(&mut rx), 1, "told once when first shown");
        app.sync_sizes();
        assert_eq!(resizes(&mut rx), 0, "not again while nothing changed");
        // Another tab for a while, then back: another window on the daemon may have set a size.
        app.panes.clear();
        app.sync_sizes();
        app.panes = vec![(term, rect)];
        app.sync_sizes();
        assert_eq!(resizes(&mut rx), 1, "told again on coming back into view");
    }

    #[test]
    fn saves_pasted_images_as_png() {
        let p = std::env::temp_dir().join(format!(
            concat!(env!("APP_COMMAND"), "-paste-{}.png"),
            std::process::id()
        ));
        let px: Vec<u8> = (0..4 * 3 * 2).map(|i| i as u8).collect();
        super::write_png(&p, 3, 2, &px).unwrap();
        let bytes = std::fs::read(&p).unwrap();
        assert_eq!(
            &bytes[..8],
            &[0x89, b'P', b'N', b'G', 13, 10, 26, 10],
            "a real PNG"
        );
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn task_box_starts_an_agent_on_a_task() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let key = |c: KeyCode| KeyEvent::new(c, KeyModifiers::NONE);
        let cmd = super::screen::np_command(&app, "claude", 1, "fix the login bug").unwrap();
        assert!(
            cmd.starts_with("claude --dangerously-skip-permissions --model fable ")
                && cmd.contains("fix the login bug"),
            "{cmd}"
        );
        assert_eq!(
            super::screen::np_command(&app, "claude", 0, "  ").as_deref(),
            Some("claude --dangerously-skip-permissions")
        );
        assert_eq!(super::screen::np_command(&app, "shell", 0, "x"), None);
        app.screen_new(0, false);
        for c in "add tests".chars() {
            app.on_key(key(KeyCode::Char(c)));
        }
        app.on_key(key(KeyCode::Down));
        app.on_key(key(KeyCode::Down));
        app.on_key(key(KeyCode::Right));
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("TASK") && o.contains("add tests"),
            "the task row shows what you typed"
        );
        assert!(
            o.contains("Runs: claude --dangerously-skip-permissions --model fable"),
            "and what will run"
        );
        app.on_key(key(KeyCode::Esc));
        app.screen_new(0, false);
        assert!(
            matches!(&app.mode, Mode::ScreenPane(np) if np.task == "add tests"),
            "Esc keeps the task as a draft"
        );
    }

    #[test]
    fn switching_sessions_is_not_held_by_the_previous_panes_update() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let old = app.focused().unwrap();
        app.sync_hold.insert(old, Instant::now());
        assert!(app.sync_hold_until().is_some());
        app.snap.workspaces[0].tabs[0].focus = 2;
        app.snap.active_ws = Some(10);
        app.panes.retain(|(id, _)| *id == old);
        assert!(
            app.sync_hold_until().is_none(),
            "navigation draws immediately instead of waiting for the old pane"
        );
        app.snap.workspaces[0].tabs[0].focus = old.term;
        app.mode = Mode::Actions { sel: 0 };
        assert!(
            app.sync_hold_until().is_none(),
            "opening a control is not delayed by the child's frame either"
        );
    }

    #[test]
    fn history_keeps_status_changes_without_terminal_bells() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let mut next = app.snap.clone();
        let (a, b) = {
            let mut ids = next
                .terms
                .iter()
                .filter(|(_, t)| t.status != Status::Done)
                .map(|(id, _)| *id);
            (ids.next().unwrap(), ids.next().unwrap())
        };
        next.terms.get_mut(&a).unwrap().status = Status::Done;
        next.terms.get_mut(&a).unwrap().said = "Fixed it.\nMore".into();
        next.terms.get_mut(&b).unwrap().bell = true;
        next.terms.get_mut(&b).unwrap().status = Status::Blocked;
        app.got_state = true;
        app.on_server(ServerMsg::State(next));
        let texts: Vec<&str> = app.history.iter().map(|h| h.3.as_str()).collect();
        assert!(
            texts.iter().any(|t| t.ends_with("finished: Fixed it.")),
            "{texts:?}"
        );
        assert!(texts.iter().any(|t| t.ends_with("needs you")), "{texts:?}");
        assert!(
            !texts.iter().any(|t| t.ends_with("rang the bell")),
            "bell output is not an attention event: {texts:?}"
        );
        app.act(Action::History);
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(o.contains("What happened") && o.contains("needs you") && !o.contains('♪'));
    }

    /// Three panes in one tab, `a` focused: a beside b, c under b.
    fn three_panes(app: &mut App) -> [ClientTerm; 3] {
        let a = app.focused().unwrap();
        let others: Vec<ClientTerm> = app
            .snap
            .terms
            .keys()
            .map(|t| ClientTerm::local(*t))
            .filter(|t| *t != a)
            .collect();
        let (b, c) = (others[0], others[1]);
        app.screen.tabs.clear();
        app.screen_place(a, None);
        app.screen.pending_split = Some((a, Instant::now()));
        app.screen_place(b, Some(a));
        app.screen.pending_split = Some((b, Instant::now()));
        app.screen.split_dir = Some(crate::layout::Dir::Down);
        app.screen_place(c, Some(b));
        app.screen.tabs[0].focus = a;
        [a, b, c]
    }

    #[test]
    fn a_narrow_title_keeps_its_status_glyph_last_in_every_look() {
        let mut failures = Vec::new();
        let layout = "floating";
        for split in [false, true] {
            for (mode, update) in [
                ("off", false),
                ("lit", false),
                ("held", false),
                ("off", true),
                ("lit", true),
                ("held", true),
            ] {
                for w in 56..=110u16 {
                    let (_, mut app) = super::design_tests::render_with(w, 24);
                    (app.cfg.ui.layout, app.cfg.ui.rounded, app.cfg.ui.which_key) =
                        (layout.into(), crate::config::Rounding::Full, false);
                    app.cfg.ui.fold_retired_layout();
                    app.update_available = update.then(|| "0.44.0".into());
                    if split {
                        let [_, b, _] = three_panes(&mut app);
                        app.snap.terms.get_mut(&b.term).unwrap().status = Status::Blocked;
                    }
                    if mode != "off" {
                        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
                    }
                    if mode == "held" {
                        tap(&mut app, ',');
                    }
                    let buf = drawn(&mut app, w, 24);
                    // The panes along the top: the modal covers any below.
                    let top = app.pane_frames.iter().map(|(_, r)| r.y).min().unwrap_or(0);
                    let blocked: Vec<Rect> = app
                        .pane_frames
                        .iter()
                        .filter(|(id, r)| {
                            r.y == top && app.snap.terms[&id.term].status == Status::Blocked
                        })
                        .map(|(_, r)| *r)
                        .collect();
                    assert!(!blocked.is_empty(), "{layout} {w}: a blocked pane is drawn");
                    for r in blocked {
                        let row: String =
                            (r.x..r.right()).map(|x| buf[(x, r.y)].symbol()).collect();
                        // A modal (Settings, held open) can lie over the title: nothing to read there.
                        // A pane has no title: its tab shows the state, and a split's edge goes amber
                        // while it needs you (a held modal dims everything behind it).
                        if !split || mode != "off" || !row.starts_with(['┌', '╭']) {
                            continue;
                        }
                        if ![app.theme.blocked, app.theme.accent, app.theme.acc_ink].contains(&buf[(r.x + 3, r.y)].fg)
                        {
                            failures.push(format!("{layout} split {split} {mode} update {update} {w}: {row} {:?} want {:?}", buf[(r.x + 3, r.y)].fg, app.theme.blocked));
                        }
                    }
                    // Typing says so on the mode bar at every width: the bar is always up.
                    if mode == "off" {
                        let (_, bar) = bar_text(&app, &buf);
                        if !bar.contains(" pane ") {
                            failures.push(format!("{layout} split {split} {mode} update {update} {w}: no pane on the bar: {bar}"));
                        }
                    }
                }
            }
        }
        assert!(
            failures.is_empty(),
            "the status glyph is on the title:\n{}",
            failures.join("\n")
        );
    }

    fn drawn(app: &mut App, w: u16, h: u16) -> ratatui::buffer::Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    /// Where `word` last starts on row `y` between `from` and `to`.
    fn last_at(
        buf: &ratatui::buffer::Buffer,
        word: &str,
        y: u16,
        from: u16,
        to: u16,
    ) -> Option<u16> {
        let n = word.chars().count() as u16;
        (from..to.saturating_sub(n))
            .rev()
            .find(|&x| (0..n).map(|i| buf[(x + i, y)].symbol()).collect::<String>() == word)
    }

    #[test]
    fn every_close_asks_first_an_idle_shell_too() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // Closing from the sidebar acts on the row the cursor is on.
        let shell = *app
            .snap
            .terms
            .iter()
            .find(|(_, t)| t.agent.is_none())
            .map(|(id, _)| id)
            .expect("a shell");
        app.snap.terms.get_mut(&shell).unwrap().process = "pwsh.exe".into();
        app.screen.cursor = Some(ClientSession::local(SessionKey::Pane(shell)));
        app.mode = Mode::Side;
        app.act(Action::ClosePane);
        assert!(matches!(app.mode, Mode::Confirm(_)), "an idle shell asks too");
        assert_eq!(app.closing.last_closed(), None, "nothing is closed before the answer");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.closing.last_closed(),
            Some(ClientTerm::local(shell)),
            "accepted, an idle shell closes, with an undo"
        );
        let agent = *app
            .snap
            .terms
            .iter()
            .find(|(_, t)| t.agent.is_some())
            .map(|(id, _)| id)
            .expect("an agent");
        app.snap.terms.get_mut(&agent).unwrap().status = Status::Working;
        app.screen.cursor = Some(ClientSession::local(SessionKey::Pane(agent)));
        app.mode = Mode::Side;
        app.act(Action::ClosePane);
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.title == "Stop session" && c.note.contains("stops it")),
            "a working agent asks, and says closing stops it"
        );
        assert_ne!(app.closing.last_closed(), Some(ClientTerm::local(agent)), "the agent is not closed before the answer");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.closing.last_closed(),
            Some(ClientTerm::local(agent)),
            "accepted, it closes"
        );
    }

    #[test]
    fn alt_letters_run_the_everyday_actions_without_the_leader_only_when_turned_on() {
        let alt = |c: char| {
            crate::keys::KeySpec::from_event(&KeyEvent::new(KeyCode::Char(c), KeyModifiers::ALT))
        };
        let mut cfg = Config::default();
        cfg.ui.alt_keys = true;
        let on = cfg.keymap();
        for (c, want) in [
            ('n', Action::ShellHere),
            ('a', Action::PickSession),
            ('x', Action::ClosePane),
            ('s', Action::SplitRight),
            ('d', Action::SplitDown),
        ] {
            assert_eq!(on.global.get(&alt(c)), Some(&want), "Alt+{c}");
        }
        for c in ['v', 't'] {
            assert!(!on.global.contains_key(&alt(c)), "Alt+{c} is Claude Code's");
        }
        assert!(!Config::default().ui.alt_keys, "opt-in by default");
        assert!(
            !Config::default().keymap().global.contains_key(&alt('x')),
            "off: Alt+x goes to the program"
        );
    }

    #[test]
    fn alt_x_in_the_sidebar_asks_before_it_closes_the_selected_session_and_says_a_working_agent_stops() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let focused = app.focused();
        let agent = app
            .snap
            .terms
            .iter()
            .find(|(id, t)| t.agent.is_some() && Some(ClientTerm::local(**id)) != focused)
            .map(|(id, _)| ClientTerm::local(*id))
            .expect("an agent not in focus");
        app.screen_side_set(screen::SideItem::Sess(ClientSession::local(
            SessionKey::Pane(agent.term),
        )));
        app.mode = Mode::Side;
        app.snap.terms.get_mut(&agent.term).unwrap().status = Status::Working;
        // Alt+letters are opt-in.
        app.cfg.ui.alt_keys = true;
        app.keymap = app.cfg.keymap();
        app.on_key(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::ALT));
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.title == "Stop session"),
            "a working agent asks before it closes: {:?}",
            app.mode
        );
        assert_eq!(app.focused(), focused, "it doesn't go into the pane");
    }

    #[test]
    fn new_agent_defaults_to_its_own_worktree() {
        let pane = screen::NewPaneHy::new(0, false);
        assert_eq!(
            pane.place_for("claude", true),
            0,
            "agents default to a new worktree"
        );
        assert_eq!(
            pane.place_for("codex", true),
            0,
            "the default applies across providers"
        );
        assert_eq!(
            pane.place_for("shell", true),
            2,
            "plain shells stay in the project checkout"
        );
        assert_eq!(
            pane.place_for("claude", false),
            2,
            "the opt-out setting is respected"
        );
        assert_eq!(
            pane.place_for("claude", true),
            0,
            "starting a new chooser does not retain a prior location"
        );
    }

    #[test]
    fn a_split_s_new_session_stays_off_the_sidebar_until_it_is_placed() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.screen.tabs.clear();
        app.screen_place(ClientTerm::local(1), None);
        let rows = |app: &App| app.screen_model().iter().flat_map(|p| p.sessions()).count();
        let before = rows(&app);

        app.begin_split(ClientTerm::local(1));
        app.snap.terms.insert(4, app.snap.terms[&3].clone());
        let fresh = app.snap.terms.get_mut(&4).unwrap();
        fresh.id = 4;
        // Its own session, not the copy of another's conversation (which the sidebar leaves out).
        fresh.conversation_id = None;
        app.snap.workspaces[0].tabs.push(TabInfo {
            id: 99,
            name: String::new(),
            layout: crate::layout::Node::Leaf(4),
            focus: 4,
        });
        *app.screen.model_cache.borrow_mut() = None;
        assert_eq!(rows(&app), before, "the new session is not a row while the split waits for it");

        // Without the hold it would be a row of its own for a moment, which is the jump.
        let pending = app.screen.pending_split.take();
        *app.screen.model_cache.borrow_mut() = None;
        assert_eq!(rows(&app), before + 1, "that is what the hold keeps off the sidebar");
        app.screen.pending_split = pending;

        app.screen_place(ClientTerm::local(4), Some(ClientTerm::local(1)));
        assert!(app.screen.pending_split.is_none(), "placing it ends the wait");
    }

    #[test]
    fn splitting_left_or_up_puts_the_new_pane_before_the_one_split() {
        for (dir, horizontal) in [
            (crate::layout::Dir::Left, true),
            (crate::layout::Dir::Up, false),
        ] {
            let (_, mut app) = super::design_tests::render_with(160, 45);
            app.screen.tabs.clear();
            app.screen_place(ClientTerm::local(1), None);
            app.menu_do(menu::Act::Split(ClientTerm::local(1), dir));
            app.snap.terms.insert(4, app.snap.terms[&3].clone());
            app.snap.terms.get_mut(&4).unwrap().id = 4;
            app.screen_place(ClientTerm::local(4), Some(ClientTerm::local(1)));
            let layout = &app.screen.tabs[app.screen.tab].layout;
            let crate::layout::Node::Split {
                horizontal: got,
                a,
                ..
            } = layout
            else {
                panic!("a split expected for {dir:?}");
            };
            assert_eq!(*got, horizontal, "{dir:?} runs the way its name says");
            assert!(
                matches!(**a, crate::layout::Node::Leaf(4)),
                "{dir:?}: the new pane is first"
            );
        }
    }

    #[test]
    fn split_intent_survives_the_focus_change_to_its_target_pane() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.screen.tabs.clear();
        app.screen_place(ClientTerm::local(1), None);

        app.menu_do(menu::Act::Split(
            ClientTerm::local(2),
            crate::layout::Dir::Down,
        ));
        app.screen_place(ClientTerm::local(2), Some(ClientTerm::local(1)));
        assert!(
            app.screen.pending_split.is_some(),
            "focusing the pane chosen in the context menu must not consume the pending split"
        );

        app.snap.terms.insert(4, app.snap.terms[&3].clone());
        app.snap.terms.get_mut(&4).unwrap().id = 4;
        app.screen_place(ClientTerm::local(4), Some(ClientTerm::local(2)));
        let layout = &app.screen.tabs[app.screen.tab].layout;
        assert!(
            matches!(
                layout,
                crate::layout::Node::Split {
                    horizontal: false,
                    ..
                }
            ),
            "Split down must remain vertical after the focus event"
        );
        assert_eq!(layout.leaves(), vec![2, 4]);
    }

    #[test]
    fn the_new_tab_key_starts_a_shell_in_the_fleet_you_are_in() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.act(Action::NewTab);
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
        assert!(
            sent.iter()
                .any(|o| matches!(&o.msg, ClientMsg::Command(Command::NewShip { cmd: None, .. }))),
            "a shell joins the fleet as a tab: {sent:?}"
        );
    }

    #[test]
    fn picking_a_session_shows_its_own_tab_not_the_shell_you_were_last_on() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, _rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.screen.tabs.clear();
        app.screen_place(ClientTerm::local(1), None);
        // Claude has a shell tab of its own.
        app.screen
            .tabs
            .push(screen::ScreenTab::single(ClientTerm::local(3), ClientTerm::local(1)));
        app.screen.tab = app.screen.tabs.len() - 1;
        app.screen_place(ClientTerm::local(3), Some(ClientTerm::local(1)));
        assert_eq!(
            app.screen.tabs[app.screen.tab].focus,
            ClientTerm::local(3),
            "on claude's shell tab"
        );
        // Its row is picked in the sidebar: the session itself shows, not the shell.
        app.screen_focus(ClientTerm::local(1));
        app.screen_place(ClientTerm::local(1), Some(ClientTerm::local(3)));
        assert_eq!(
            app.screen.tabs[app.screen.tab].focus,
            ClientTerm::local(1),
            "the picked session is the one on screen"
        );
        assert!(app.screen.tabs[app.screen.tab].layout.contains(1));
    }

    #[test]
    fn the_wheel_scrolls_an_agents_full_screen_view() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let (term, r) = app.pane_frames[0];
        let at = (r.x + 10, r.y + 10);
        let mouse = |app: &mut App, kind: MouseEventKind| {
            app.on_mouse(MouseEvent {
                kind,
                column: at.0,
                row: at.1,
                modifiers: KeyModifiers::NONE,
            })
        };
        // A drag whose release never came is over once the mouse moves with no button held.
        app.screen.drag = Some(screen::Drag::Side);
        mouse(&mut app, MouseEventKind::Moved);
        assert!(
            app.screen.drag.is_none(),
            "a stuck drag doesn't keep the mouse from the panes"
        );
        // Claude Code's full-screen view, not taking the mouse: the wheel pages it.
        assert!(app.snap.terms[&term.term].agent.is_some());
        app.feed(term, b"\x1b[?1049h");
        assert!(app.parsers[&term].screen().alternate_screen());
        mouse(&mut app, MouseEventKind::ScrollUp);
        assert!(
            app.wheel_page.is_some(),
            "paged (PgUp), not arrow keys into its prompt history"
        );
    }
    #[test]
    fn codex_output_above_its_input_box_can_be_scrolled_back() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let (term, _) = app.pane_frames[0];
        // A pane's screen as the app makes it (the fixture's keep no history).
        let p = app.new_parser(40, 100);
        app.parsers.insert(term, p);
        // Codex: a scroll region over the rows above its input box, and each finished line
        // printed at the region's bottom, pushing the ones above it up and off the top.
        let mut out = b"\x1b[1;30r\x1b[30;1H".to_vec();
        for i in 0..60 {
            out.extend(format!("\r\nline {i}").bytes());
        }
        out.extend(b"\x1b[r");
        app.feed(term, &out);
        app.scroll_by(term, 20);
        assert!(
            app.history(term).0 > 0,
            "lines pushed off the top are history"
        );
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("line 10") && !o.contains("line 59"),
            "and show when scrolled back (20 lines up)"
        );
    }

    #[test]
    fn a_pane_rewraps_once_a_drag_ends() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let focused = app.focused().unwrap();
        app.snap.terms.get_mut(&focused.term).unwrap().agent = None;
        draw(&mut app, 160, 45);
        app.sync_sizes();
        let (term, _) = app.pane_frames[0];
        app.keep_raw(term, b"some output\r\n", true);
        // Mid-drag, a new width just resizes the screen; it re-wraps after.
        app.screen.drag = Some(screen::Drag::Side);
        app.screen.saved.side_w = Some(50);
        draw(&mut app, 160, 45);
        app.sync_sizes();
        assert!(
            app.rewrap.contains(&term),
            "re-wrap waits for the drag to end"
        );
        app.screen.drag = None;
        app.sync_sizes();
        assert!(!app.rewrap.contains(&term), "and happens once it has");
    }

    #[test]
    fn renaming_names_the_row() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let id = *app
            .snap
            .terms
            .iter()
            .find(|(_, t)| t.agent.as_deref() == Some("codex"))
            .unwrap()
            .0;
        app.snap.terms.get_mut(&id).unwrap().label = "Doing something".into();
        app.screen_fresh();
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("Doing something"),
            "the name is on the row itself"
        );
        assert_eq!(
            o.matches("Doing something").count(),
            1,
            "on its row, not in a second line"
        );
    }

    #[test]
    fn close_acts_on_the_focused_pane_after_leaving_the_sidebar() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let focused = app.focused().unwrap();
        let other = *app
            .snap
            .terms
            .keys()
            .find(|t| **t != focused.term)
            .expect("a second session");
        // A click that takes the keys back from the sidebar must not leave its cursor behind:
        // close would act on that row, not on what you're in.
        app.screen_side_set(screen::SideItem::Sess(ClientSession::local(
            SessionKey::Pane(other),
        )));
        let (_, r) = app.pane_frames[0];
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: r.x + 10,
            row: r.y + 10,
            modifiers: KeyModifiers::NONE,
        });
        assert!(
            matches!(app.mode, Mode::Normal) && app.screen.cursor.is_none(),
            "the cursor goes with the keys"
        );
        app.act(Action::ClosePane);
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if matches!(&c.act, menu::Act::End(ts) if ts == &vec![focused])),
            "close asks about the focused pane"
        );
        app.mode = Mode::Normal;
        app.closing = Default::default();
        // Even a cursor left behind in normal mode is not a target.
        app.mode = Mode::Normal;
        app.screen.cursor = Some(ClientSession::local(SessionKey::Pane(other)));
        app.act(Action::ClosePane);
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if matches!(&c.act, menu::Act::End(ts) if ts == &vec![focused])),
            "only the sidebar's own keys use its cursor"
        );
    }

    #[test]
    fn changes_outside_git_offers_git_init() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let dir = maitty_test_support::TempFolder::new("nogit");
        app.open_changes(dir.to_path_buf());
        let o = draw(&mut app, 160, 45);
        show(&o);
        let cap = screen::ends(app.theme.btn).0.0.to_string();
        // The sentence starts with the temp folder's path, which on Windows is long enough to wrap
        // the sentence across lines, so it is read from the dialog; the screen still shows the buttons.
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.what.ends_with("isn't a git repository yet."))
                && o.contains(&format!("{cap}Make it a git repo g"))
                && o.contains(&format!("{cap}Cancel Esc"))
        );
    }

    #[test]
    fn jumps_between_commands_in_history() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let term = 1;
        app.parsers
            .insert(ClientTerm::local(term), vt100::Parser::new(20, 80, 1000));
        app.marks.remove(&ClientTerm::local(term));
        // Three commands, each with output long enough to scroll away.
        for n in 1..=3 {
            app.feed(
                ClientTerm::local(term),
                format!("\x1b]133;A\x07$ cmd{n}\r\n").as_bytes(),
            );
            for i in 0..30 {
                app.feed(
                    ClientTerm::local(term),
                    format!("cmd{n} line {i}\r\n").as_bytes(),
                );
            }
        }
        app.feed(ClientTerm::local(term), b"\x1b]133;A\x07$ ");
        let top = |app: &App| {
            let p = app.parsers.get(&ClientTerm::local(term)).unwrap();
            let (_, cols) = p.screen().size();
            p.screen()
                .rows(0, cols)
                .next()
                .unwrap_or_default()
                .trim_end()
                .to_string()
        };
        app.jump_prompt(ClientTerm::local(term), true);
        assert_eq!(top(&app), "$ cmd3", "back to the last command");
        app.jump_prompt(ClientTerm::local(term), true);
        assert_eq!(top(&app), "$ cmd2");
        app.jump_prompt(ClientTerm::local(term), false);
        assert_eq!(top(&app), "$ cmd3", "and forward again");
        // A history that fills up and drops its oldest lines: still the right command.
        app.parsers
            .insert(ClientTerm::local(term), vt100::Parser::new(20, 80, 50));
        app.marks.remove(&ClientTerm::local(term));
        for n in 1..=4 {
            app.feed(
                ClientTerm::local(term),
                format!("\x1b]133;A\x07$ job{n}\r\n").as_bytes(),
            );
            for i in 0..30 {
                app.feed(
                    ClientTerm::local(term),
                    format!("job{n} line {i}\r\n").as_bytes(),
                );
            }
        }
        app.jump_prompt(ClientTerm::local(term), true);
        assert_eq!(top(&app), "$ job4", "found though the history shifted");
        app.jump_prompt(ClientTerm::local(term), true);
        assert_eq!(top(&app), "$ job3");
    }

    #[test]
    fn a_popup_floats_over_everything_and_takes_the_keys() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let mut pop = app.snap.terms[&3].clone();
        (pop.id, pop.popup, pop.process) = (9, true, "fzf".into());
        app.snap.terms.insert(9, pop);
        let mut p = vt100::Parser::new(30, 120, 0);
        p.process(b"> pick a file");
        app.parsers.insert(ClientTerm::local(9), p);
        let o = draw(&mut app, 160, 45);
        assert!(o.contains("> pick a file"), "drawn over the rest");
        assert_eq!(
            app.typing_to(),
            Some(ClientTerm::local(9)),
            "typing goes to it"
        );
        assert_ne!(
            app.focused(),
            Some(ClientTerm::local(9)),
            "the pane you're on stays yours underneath"
        );
        app.snap.terms.remove(&9);
        assert_eq!(app.typing_to(), app.focused(), "closed: typing goes back");
    }

    #[test]
    fn drag_copies_what_is_under_the_mouse_after_output_while_scrolled_up() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let term = app.focused().unwrap();
        let (_, r) = *app.panes.iter().find(|(t, _)| *t == term).unwrap();
        let mut p = vt100::Parser::new(r.height, r.width, 1000);
        for i in 0..80 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        app.parsers.insert(term, p);
        draw(&mut app, 160, 45);
        // Scrolled up, then the agent prints more: vt100 keeps the view where it was.
        app.scroll_by(term, 10);
        app.parsers
            .get_mut(&term)
            .unwrap()
            .process(b"more 1\r\nmore 2\r\nmore 3\r\n");
        draw(&mut app, 160, 45);
        let rows: Vec<String> = app.parsers[&term].screen().rows(0, r.width).collect();
        let row_of = |s: &str| rows.iter().position(|l| l == s).unwrap() as u16;
        let (from, to) = (row_of("line 61"), row_of("line 68"));
        let mouse = |app: &mut App, kind: MouseEventKind, y: u16| {
            app.on_mouse(MouseEvent {
                kind,
                column: r.x,
                row: r.y + y,
                modifiers: KeyModifiers::NONE,
            });
            draw(app, 160, 45);
        };
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), from + 1);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), to);
        let Mode::Copy(c) = &app.mode else {
            panic!("dragging selects")
        };
        let picked = c.selected_text();
        assert!(
            picked.starts_with("line 61\n") && picked.ends_with("\nl"),
            "{picked:?}"
        );
    }

    #[test]
    fn a_click_or_drag_in_a_pane_scrolled_back_leaves_it_where_it_is() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let term = app.focused().unwrap();
        let (_, r) = *app.panes.iter().find(|(t, _)| *t == term).unwrap();
        let mut p = vt100::Parser::new(r.height, r.width, 1000);
        // A program that asks for the mouse, with history above its screen.
        p.process(b"\x1b[?1000h\x1b[?1006h");
        for i in 0..80 {
            p.process(format!("line {i}\r\n").as_bytes());
        }
        app.parsers.insert(term, p);
        draw(&mut app, 160, 45);
        app.scroll_by(term, 10);
        let before = app.parsers[&term].screen().scrollback();
        assert_eq!(before, 10);
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Drag(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: r.x + 2,
                row: r.y + 3,
                modifiers: KeyModifiers::NONE,
            });
            draw(&mut app, 160, 45);
        }
        assert_eq!(
            app.parsers[&term].screen().scrollback(),
            before,
            "selecting while scrolled back never snaps the view to the bottom"
        );
    }

    #[test]
    fn the_leader_lights_up_and_its_key_map_runs_or_searches() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.cfg.ui.which_key = false;
        let lead = KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL);
        let key = |app: &mut App, c: KeyCode| app.on_key(KeyEvent::new(c, KeyModifiers::NONE));
        // Armed: the KEYS chip on the bar, the focused card's border in the same orange.
        app.on_key(lead);
        let mut term = Terminal::new(TestBackend::new(160, 45)).unwrap();
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let top = app.pane_frames[0].1.y;
        assert_eq!(
            (buf[(159, top)].symbol(), buf[(159, top)].fg),
            ("╮", app.theme.blocked),
            "the focused border turns the KEYS orange"
        );
        let (row, text) = bar_text(&app, &buf);
        assert!(
            text.starts_with("  keys  ") && buf[(row.x + 2, row.y)].bg == app.theme.blocked,
            "the bar's keys chip, a column in: {text}"
        );
        // The delayed overview groups common commands; ? opens the full reference instead.
        app.open_keymap(None);
        assert!(matches!(app.mode, Mode::KeyMap(_)));
        let o = draw(&mut app, 160, 45);
        show(&o);
        for g in ["SESSIONS", "PANES", "SIDEBAR", "TOOLS", crate::brand::APP_HEADING] {
            assert!(o.contains(g), "the key map has {g}");
        }
        assert!(
            o.contains("Inbox") && o.contains("Undo close"),
            "the rows of the map"
        );
        // Tab, then words: a search over every leader key.
        key(&mut app, KeyCode::Tab);
        for c in "sidebar".chars() {
            key(&mut app, KeyCode::Char(c));
        }
        let o = draw(&mut app, 160, 45);
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.query == "sidebar") && o.contains("sidebar"),
            "a search for the sidebar"
        );
        // A key with › opens its second step; Backspace goes back.
        app.mode = Mode::Normal;
        app.on_key(lead);
        app.open_keymap(Some(screen::Step::Worktrees));
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.step == Some(screen::Step::Worktrees)),
            "Worktrees › opens its step"
        );
        assert!(
            o.contains("WORKTREES IN SHOP-API")
                && o.contains("New worktree")
                && o.contains("Merge into main")
                && o.contains("the path so far")
        );
        key(&mut app, KeyCode::Backspace);
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.step.is_none()),
            "back to the key map"
        );
        key(&mut app, KeyCode::Esc);
        assert_eq!(app.mode, Mode::Normal);
    }

    #[test]
    fn actions_list_every_command_with_its_key() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let o = draw(&mut app, 160, 45);
        assert!(o.lines().any(|l| l.contains("│ menu")), "the sidebar's menu button");
        let at = app
            .hits
            .iter()
            .find_map(|(r, h)| {
                (*h == Hit::Screen(screen::ScreenHit::Actions)).then_some((r.x, r.y))
            })
            .expect("a actions is clickable");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: at.0,
            row: at.1,
            modifiers: KeyModifiers::NONE,
        });
        assert!(matches!(app.mode, Mode::ScreenMenu(_)), "the chip's own menu");
        app.mode = Mode::Normal;
        app.act(Action::Menu);
        assert!(matches!(app.mode, Mode::Actions { sel: 0 }));
        let o = draw(&mut app, 160, 45);
        show(&o);
        // Each section says what its rows are for, and the tools are among them: the rail that
        // also opens them is hidden unless it is asked for.
        let rows: Vec<&str> = o.lines().collect();
        // The tab row's own Files and Changes chips are above the Menu's card.
        let card = rows
            .iter()
            .position(|l| l.contains("─ Menu "))
            .unwrap_or_else(|| panic!("no Menu card:\n{o}"));
        let row = |text: &str| {
            card + rows[card..]
                .iter()
                .position(|l| l.contains(text))
                .unwrap_or_else(|| panic!("no {text} in the Menu:\n{o}"))
        };
        for (title, first) in [
            ("NEW", "Shell here"),
            ("TOOLS", "Files"),
            ("FIND", "Inbox"),
            ("SIDEBAR", "Collapse sidebar"),
        ] {
            assert_eq!(
                row(first),
                row(title) + 1,
                "{title} is the title over its rows"
            );
        }
        for tool in ["Files", "Changes", "Branch", "References"] {
            assert!(row(tool) > row("TOOLS") && row(tool) < row("FIND"), "{tool}");
        }
        assert!(
            o.contains("─ Menu ")
                && o.contains("Pane beside this")
                && o.contains("Inbox ● 1")
                && o.contains("Search commands"),
            "{o}"
        );

        // A short window keeps every row that does something: the blank rows and then the
        // titles give way first.
        let short = draw(&mut app, 100, 24);
        for (label, _) in screen::action_items() {
            let shown = match label {
                "Collapse sidebar" => short.contains(label) || short.contains("Expand sidebar"),
                "Hide sidebar" => short.contains(label) || short.contains("Show sidebar"),
                _ => short.contains(label),
            };
            assert!(shown, "{label} is cut from a short Menu:\n{short}");
        }
        draw(&mut app, 160, 45);
        assert!(!o.contains("then a key works anywhere"), "no leader hint");
        let shell = o
            .lines()
            .find(|l| l.contains("Shell here"))
            .expect("Shell here");
        assert!(
            !shell.trim_end_matches(['│', ' ']).ends_with(" n"),
            "no bare letter beside a row: {shell}"
        );
        assert!(
            !o.contains("Start a fleet") && !o.contains("All commands"),
            "the fleet row and the old palette row are gone"
        );
        // A row's leader key runs it here, unshown: z collapses the sidebar.
        assert!(app.sidebar);
        app.on_key(KeyEvent::new(KeyCode::Char('b'), KeyModifiers::NONE));
        assert!(
            !app.sidebar && app.mode == Mode::Normal,
            "b: the sidebar collapses"
        );
    }

    #[test]
    fn mouse_can_reach_agent_sheets_and_every_palette_command_without_sidebar() {
        for (w, h) in [(80, 24), (100, 30), (160, 45)] {
            let (_, mut app) = super::design_tests::render_with(w, h);
            app.sidebar = false;
            draw(&mut app, w, h);
            let click = |app: &mut App, hit| {
                let (r, _) = app
                    .hits
                    .iter()
                    .rev()
                    .find(|(_, target)| *target == Hit::Screen(hit))
                    .expect("visible mouse control");
                let (column, row) = (r.x, r.y);
                app.on_mouse(MouseEvent {
                    kind: MouseEventKind::Down(MouseButton::Left),
                    column,
                    row,
                    modifiers: KeyModifiers::NONE,
                });
            };
            // Hidden, the sidebar leaves its `»` chip: that brings it back, and its menu chip.
            click(&mut app, screen::ScreenHit::ExpandSidebar);
            assert!(app.sidebar, "» brings the sidebar back");
            draw(&mut app, w, h);
            click(&mut app, screen::ScreenHit::Actions);
            let Mode::ScreenMenu(menu) = &app.mode else {
                panic!("the menu chip opens its menu: {:?}", std::mem::discriminant(&app.mode))
            };
            let labels: Vec<&str> = menu.items.iter().map(|(l, _)| l.as_str()).collect();
            assert_eq!(labels, ["Filter sessions", "Add machine…", "Inbox", "Put away…", "Usage and cost", "Updates and release notes", "Settings", "Keys"]);
            // The full Menu is the leader's `.`; its rows are clickable.
            app.act(Action::Menu);
            assert!(matches!(app.mode, Mode::Actions { .. }));
            let screen = draw(&mut app, w, h);
            show(&screen);
            let index = screen::action_items()
                .iter()
                .position(|(_, a)| *a == Action::Palette)
                .expect("all commands are discoverable");
            assert!(
                app.hits
                    .iter()
                    .any(|(_, target)| *target == Hit::Screen(screen::ScreenHit::ActionRow(index)))
            );
            click(&mut app, screen::ScreenHit::ActionRow(index));
            assert!(
                matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::Search),
                "Search commands opens the search"
            );
            // Every command is a row the mouse can reach: scroll the list so the last one is selected.
            let all = screen::keymap_actions(
                &app,
                &screen::KeyMap {
                    query: "e".into(),
                    ..screen::KeyMap::new(screen::KeyView::Search, None)
                },
            )
            .len();
            for sel in [0, all / 2, all.saturating_sub(1)] {
                app.mode = Mode::KeyMap(Box::new(screen::KeyMap {
                    query: "e".into(),
                    sel,
                    ..screen::KeyMap::new(screen::KeyView::Search, None)
                }));
                draw(&mut app, w, h);
                assert!(
                    app.hits
                        .iter()
                        .any(|(_, target)| *target == Hit::Screen(screen::ScreenHit::KeyRow(sel))),
                    "{w}x{h}: row {sel} of {all} can be scrolled into view"
                );
            }
            app.mode = Mode::KeyMap(Box::new(screen::KeyMap::new(screen::KeyView::Map, None)));
            draw(&mut app, w, h);
            let help =
                screen::keymap_actions(&app, &screen::KeyMap::new(screen::KeyView::Map, None))
                    .iter()
                    .position(|a| *a == Some(Action::Help))
                    .expect("All keys is on the map");
            click(&mut app, screen::ScreenHit::KeyRow(help));
            assert!(matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::All));
            app.act(Action::AgentStatusSetup);
            let screen = draw(&mut app, w, h);
            show(&screen);
            assert!(
                screen.contains("Connect Codex")
                    && screen.contains("Connect Pi")
                    && screen.contains("Connect OpenCode")
            );
            for index in 0..2 {
                assert!(
                    app.hits
                        .iter()
                        .any(|(_, hit)| *hit == Hit::Screen(screen::ScreenHit::MenuPick(index)))
                );
            }
            app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            assert_eq!(app.mode, Mode::Normal);
        }
    }

    fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<Command> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .filter_map(|m| match m {
                ClientMsg::Command(c) => Some(c),
                _ => None,
            })
            .collect()
    }

    fn leader(app: &mut App, c: char) {
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }


    fn click_new_chip(app: &mut App) {
        let at = app
            .hits
            .iter()
            .find_map(|(r, h)| {
                matches!(h, Hit::Screen(screen::ScreenHit::MachinePlus(_))).then_some((r.x + 1, r.y))
            })
            .expect("the machine plus is clickable");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: at.0,
            row: at.1,
            modifiers: KeyModifiers::NONE,
        });
    }

    #[test]
    fn the_new_chip_and_leader_t_start_a_shell_in_the_fleet_you_are_in_at_once() {
        for cursor in [None, Some(2)] {
            for by_mouse in [false, true] {
                let (_, mut app) = super::design_tests::render_with(140, 30);
                let (tx, mut rx) = mpsc::unbounded_channel();
                app.out = tx;
                app.screen.cursor = cursor.map(|id| ClientSession::local(SessionKey::Pane(id)));
                app.mode = if cursor.is_some() {
                    Mode::Side
                } else {
                    Mode::Normal
                };
                // The machine's own plus is on its heading, which only the by-machine grouping has.
                app.screen.saved.group_machine = by_mouse;
                let screen = draw(&mut app, 140, 30);
                show(&screen);
                if by_mouse {
                    assert!(screen.contains(" + "), "a visible plus chip");
                    click_new_chip(&mut app);
                } else {
                    leader(&mut app, 't');
                }
                assert!(
                    matches!(app.mode, Mode::Normal | Mode::Side),
                    "a shell opens no form: {:?}",
                    app.mode
                );
                let commands = sent(&mut rx);
                assert!(
                    matches!(
                        commands.as_slice(),
                        [Command::NewShip {
                            ws: 10,
                            cwd: Some(_),
                            cmd: None
                        }]
                    ),
                    "one plain shell in the fleet, no agent and no worktree: {commands:?}"
                );
            }
        }
    }
    #[test]
    fn the_menu_starts_a_shell_and_t_and_n_are_shell_keys() {
        let rows = screen::action_items();
        let labels: Vec<&str> = rows.iter().take(3).map(|(l, _)| *l).collect();
        assert_eq!(
            labels,
            ["Shell here", "Pane beside this", "Clone a repository…"],
            "Shell first, and no dialog row: New session is a shell too"
        );
        assert!(!rows.iter().any(|(l, _)| *l == "Session..."));
        assert!(
            rows.iter()
                .any(|(l, a)| *l == "Shell here" && *a == Action::ShellHere)
        );
        let key = |c: &str| c.parse::<crate::keys::KeySpec>().unwrap();
        let (_, app) = super::design_tests::render_with(100, 30);
        assert_eq!(app.keymap.prefixed.get(&key("t")), Some(&Action::ShellHere));
        assert_eq!(app.keymap.prefixed.get(&key("n")), Some(&Action::PickSession), "n is New session, which starts a shell at once");
        assert_eq!(app.keymap.prefixed.get(&key("j")), Some(&Action::NextSession));
        assert_eq!(app.keymap.global.get(&key("ctrl+t")), None, "Ctrl+T goes to the program");
        assert_eq!(app.keymap.global.get(&key("ctrl+tab")), None, "Ctrl+Tab goes to the program");
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        leader(&mut app, 't');
        let cmds = sent(&mut rx);
        assert!(
            matches!(
                cmds.as_slice(),
                [Command::NewShip {
                    cwd: Some(_),
                    cmd: None,
                    ..
                }]
            ),
            "a plain shell: {cmds:?}"
        );
        // In the Menu, the leader key shown beside a row runs it.
        app.mode = Mode::Actions { sel: 0 };
        app.on_key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::NONE));
        let cmds = sent(&mut rx);
        assert!(
            matches!(cmds.as_slice(), [Command::NewShip { cmd: None, .. }]),
            "Menu key t: {cmds:?}"
        );
    }

    #[test]
    fn caps_lock_t_after_the_leader_starts_a_shell() {
        use ratatui::crossterm::event::{KeyEventKind, KeyEventState};

        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        let caps_state = if cfg!(windows) {
            KeyEventState::NONE
        } else {
            KeyEventState::CAPS_LOCK
        };
        app.on_key(KeyEvent::new_with_kind_and_state(
            KeyCode::Char('T'),
            KeyModifiers::NONE,
            KeyEventKind::Press,
            caps_state,
        ));

        assert_eq!(
            app.mode,
            Mode::Normal,
            "Caps Lock must not open What happened; the new shell has the keys"
        );
        assert!(
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).any(|message| matches!(
                message,
                ClientMsg::Command(Command::NewShip { cmd: None, .. })
            )),
            "leader + Caps Lock + t starts a shell"
        );
    }

    #[test]
    fn a_bare_x_in_the_sidebar_does_not_close_the_session() {
        use ratatui::crossterm::event::{KeyEventKind, KeyEventState};

        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.act(Action::BrowseTree);
        let term = app.screen.cursor.expect("sidebar is on a session");
        let caps_state = if cfg!(windows) {
            KeyEventState::NONE
        } else {
            KeyEventState::CAPS_LOCK
        };
        app.on_key(KeyEvent::new_with_kind_and_state(
            KeyCode::Char('X'),
            KeyModifiers::NONE,
            KeyEventKind::Press,
            caps_state,
        ));

        assert!(
            !matches!(&app.mode, Mode::Confirm(_)),
            "x does not even ask to close session {term:?}"
        );
    }

    #[test]
    fn settings_open_from_the_actions_menu_by_mouse_and_keyboard() {
        for by_mouse in [false, true] {
            let (_, mut app) = super::design_tests::render_with(100, 30);
            app.act(Action::Menu);
            let screen = draw(&mut app, 100, 30);
            show(&screen);
            assert!(
                screen.contains("Settings"),
                "Settings is visible in Actions"
            );
            let index = screen::action_items()
                .iter()
                .position(|(_, action)| *action == Action::Settings)
                .unwrap();
            if by_mouse {
                let at = app
                    .hits
                    .iter()
                    .find_map(|(r, h)| {
                        (*h == Hit::Screen(screen::ScreenHit::ActionRow(index)))
                            .then_some((r.x, r.y))
                    })
                    .expect("Settings is clickable");
                app.on_mouse(MouseEvent {
                    kind: MouseEventKind::Down(MouseButton::Left),
                    column: at.0,
                    row: at.1,
                    modifiers: KeyModifiers::NONE,
                });
            } else {
                for _ in 0..index {
                    app.on_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
                }
                app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            }
            assert!(
                matches!(app.mode, Mode::ScreenSettings(_)),
                "Settings opens from Actions"
            );
            let screen = draw(&mut app, 100, 30);
            show(&screen);
            assert!(screen.contains("General") && screen.contains("Appearance"));
            app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            assert_eq!(app.mode, Mode::Normal);
        }
    }

    #[test]
    fn settings_open_as_a_centered_modal_without_reflow_and_tabs_are_mouse_reachable() {
        for (width, height) in [(80, 24), (100, 30), (160, 45)] {
            let (_, mut app) = super::design_tests::render_with(width, height);
            let before = screen::grid(&app, Rect::new(0, 0, width, height));
            app.act(Action::Settings);
            let screen = draw(&mut app, width, height);
            show(&screen);
            let grid = screen::grid(&app, Rect::new(0, 0, width, height));
            assert_eq!(
                grid.sheet.width, 0,
                "Settings does not create a side sheet at {width}x{height}"
            );
            assert_eq!(
                grid.panes, before.panes,
                "Settings leaves the workspace geometry unchanged at {width}x{height}"
            );
            assert!(
                screen.contains(" settings ") && screen.contains("General"),
                "Settings renders in the centered modal at {width}x{height}"
            );
        }

        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.act(Action::Settings);
        draw(&mut app, 100, 30);
        let (x, y) = app
            .hits
            .iter()
            .find_map(|(r, hit)| {
                (*hit == Hit::Screen(screen::ScreenHit::SetTab(2))).then_some((r.x, r.y))
            })
            .expect("Appearance tab is clickable");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: x,
            row: y,
            modifiers: KeyModifiers::NONE,
        });
        assert!(
            matches!(&app.mode, Mode::ScreenSettings(view) if view.cat == 2),
            "mouse opens Appearance without closing the modal"
        );
    }

    #[test]
    fn the_commander_is_gone_from_every_place_it_was_offered() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        assert!(
            !screen::action_items()
                .iter()
                .any(|(label, ..)| label.to_lowercase().contains("commander")),
            "not in the Menu"
        );
        assert!(
            !app.palette_commands()
                .iter()
                .any(|a| a.describe().to_lowercase().contains("commander")),
            "not in search"
        );
        assert!(
            app.session_items(ClientTerm::local(1))
                .unwrap()
                .1
                .iter()
                .all(|(l, _)| !l.to_lowercase().contains("commander")),
            "not on an agent's row menu"
        );
        // A binding written for it long ago is harmless, not an error.
        assert_eq!("start-fleet".parse::<Action>().unwrap(), Action::None);
        for (w, h) in [(160, 45), (100, 30)] {
            app.act(Action::NewSession);
            let o = draw(&mut app, w, h);
            assert!(
                !o.to_lowercase().contains("commander") && !o.contains("GOAL"),
                "at {w}x{h}: {o}"
            );
            app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        }
    }

    #[test]
    fn a_goal_survives_each_shells_quoting() {
        let said = "fix `login` & \"signup\" for $5, it's urgent\nthen the tests".to_string();
        for (shell, open, apostrophe) in [("pwsh.exe", "'", "''"), ("bash", "'", r"'\''")] {
            let cfg = Config {
                shell: Some(shell.into()),
                ..Config::default()
            };
            let q = cfg.quote_for_shell(&said);
            // Single-quoted, so $, backticks, double quotes and the newline are literal; only
            // the apostrophe needs its escape.
            assert!(q.starts_with(open) && q.ends_with(open), "{shell}: {q}");
            assert_eq!(
                q[1..q.len() - 1].replace(apostrophe, "'"),
                said,
                "{shell}: back to what was typed"
            );
        }
    }

    #[test]
    fn clicking_the_sidebar_gives_it_the_keys() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        draw(&mut app, 160, 45);
        let side = app.screen.side_rect;
        // Empty space near the bottom of the sidebar card, above its foot.
        let at = (side.x + 4, side.bottom() - 7);
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: at.0,
            row: at.1,
            modifiers: KeyModifiers::NONE,
        });
        assert_eq!(app.mode, Mode::Side, "the sidebar has the keys");
    }

    #[test]
    fn copy_from_several_panes_at_once() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let (a, b) = (ClientTerm::local(1), ClientTerm::local(2));
        app.screen.tabs.clear();
        app.screen_place(a, None);
        app.screen.pending_split = Some((a, Instant::now()));
        app.screen_place(b, Some(a));
        for (t, word) in [(a, "alpha"), (b, "beta")] {
            let mut p = vt100::Parser::new(20, 80, 100);
            p.process(format!("ERROR {word} failed\r\nok\r\n").as_bytes());
            app.parsers.insert(t, p);
        }
        draw(&mut app, 200, 50);
        assert!(app.enter_copy(a));
        let key = |app: &mut App, c: KeyCode| app.on_key(KeyEvent::new(c, KeyModifiers::NONE));
        // Search, select the line, Tab to the other pane: the selection is kept and the
        // same search runs there.
        key(&mut app, KeyCode::Char('/'));
        for ch in "ERROR".chars() {
            key(&mut app, KeyCode::Char(ch));
        }
        key(&mut app, KeyCode::Enter);
        key(&mut app, KeyCode::Char('V'));
        key(&mut app, KeyCode::Tab);
        assert_eq!(app.copy_set.len(), 1, "a's piece kept");
        assert!(
            app.copy_set[0].1.contains("ERROR alpha failed"),
            "{:?}",
            app.copy_set
        );
        let Mode::Copy(c) = &app.mode else {
            panic!("still copying")
        };
        assert_eq!(
            (c.term, c.query.as_deref()),
            (b, Some("ERROR")),
            "on b, the same search"
        );
        assert_eq!(
            c.lines[c.cur.0].trim_end(),
            "ERROR beta failed",
            "at its match"
        );
        // How it reads once copied together.
        let joined = copy::join_pieces(&[
            ("claude".into(), "ERROR alpha failed".into()),
            ("codex".into(), "ERROR beta failed\n".into()),
        ]);
        assert_eq!(
            joined,
            "── claude ──\nERROR alpha failed\n\n── codex ──\nERROR beta failed"
        );
        // Esc: nothing kept.
        key(&mut app, KeyCode::Esc);
        assert!(app.copy_set.is_empty());
    }

    #[test]
    fn a_session_moves_to_the_group_of_its_state() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let rows = |app: &mut App, codex: Status| {
            app.snap.terms.get_mut(&1).unwrap().status = Status::Idle;
            app.snap.terms.get_mut(&2).unwrap().status = codex;
            app.screen_fresh();
            let model = app.screen_model();
            screen::side_keys(app, &model)
                .into_iter()
                .filter_map(|key| app.session_term(key))
                .filter(|t| *t != ClientTerm::local(3))
                .take(2)
                .collect::<Vec<_>>()
        };
        // claude (1) stays idle; the shell (3) isn't counted. The groups run needs you, working, done, idle.
        let moved = [ClientTerm::local(2), ClientTerm::local(1)];
        assert_eq!(rows(&mut app, Status::Working), moved, "starting work moves it above the idle one");
        assert_eq!(rows(&mut app, Status::Done), moved, "finishing puts it in Done, above Idle");
        assert_eq!(rows(&mut app, Status::Blocked), moved, "needing you puts it first");
    }

    #[test]
    fn an_update_appears_at_the_sidebars_foot_only_when_available() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let initial = draw(&mut app, 160, 45);
        assert!(
            !initial.contains("menu▪") && !initial.contains("menu•") && initial.lines().any(|l| l.contains("│ menu")),
            "actions stay in the sidebar, no update mark when current"
        );
        assert!(
            app.hits
                .iter()
                .any(|(_, hit)| *hit == Hit::Screen(screen::ScreenHit::Actions))
        );
        app.update_available = Some("9.9.9".into());
        app.update_notes = vec!["Fixed: copying".into(), "New: update button".into()];
        let updated = draw(&mut app, 160, 45);
        assert!(
            updated.contains("menu▪") || updated.contains("menu•"),
            "the sidebar's foot marks its menu for an available update"
        );
        // One notice in the working area: the Menu's Settings row carries no dot for it.
        app.act(Action::Menu);
        let menu = draw(&mut app, 160, 45);
        let settings_row = menu
            .lines()
            .find(|l| l.contains("Settings"))
            .unwrap_or_default();
        assert!(
            !settings_row.contains('●'),
            "the Menu does not repeat the update: {settings_row}"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        draw(&mut app, 160, 45);
        assert!(
            app.palette_commands().contains(&Action::Update),
            "and remains in the command palette"
        );
        let (x, y) = app
            .hits
            .iter()
            .find_map(|(rect, hit)| {
                (*hit == Hit::Screen(screen::ScreenHit::Actions)).then_some((rect.x, rect.y))
            })
            .expect("the update chip is clickable");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: x,
            row: y,
            modifiers: KeyModifiers::NONE,
        });
        // Its menu opens with the update first.
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let confirm = draw(&mut app, 160, 45);
        assert!(matches!(&app.mode, Mode::Confirm(c) if c.act == menu::Act::Update));
        assert!(
            confirm.contains("9.9.9")
                && confirm.contains("What's new")
                && confirm.contains("Update now")
                && confirm.contains("Cancel")
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            app.mode == Mode::Normal && !app.updating,
            "cancel does not install"
        );
    }

    #[test]
    fn closing_asks_then_sends_a_close_with_undo_and_the_undo_key_undoes_it() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.menu_act(menu::Act::End(vec![ClientTerm::local(3)]));
        assert!(matches!(app.mode, Mode::Confirm(_)), "closing asks first");
        let sent = |rx: &mut mpsc::UnboundedReceiver<Outgoing>| -> Vec<crate::protocol::Command> {
            std::iter::from_fn(|| rx.try_recv().ok())
                .filter_map(|o| match o.msg {
                    crate::protocol::ClientMsg::Command(c) => Some(c),
                    _ => None,
                })
                .collect()
        };
        assert!(sent(&mut rx).is_empty(), "nothing is sent before the answer");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(app.mode, Mode::Normal, "the question is answered");
        assert!(sent(&mut rx).iter().any(|c| matches!(c, Command::CloseSession { term: 3 })));
        let banner = app.closing_banner().expect("the undo offer").text;
        assert!(banner.ends_with("undo 6s") && banner.contains("Ctrl+Space then Ctrl+Z"), "{banner}");
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Char('z'), KeyModifiers::CONTROL));
        assert!(
            matches!(sent(&mut rx).as_slice(), [Command::UndoClose { term: 3 }]),
            "the leader then Ctrl+Z undoes it"
        );
        assert!(app.closing_banner().is_none(), "and the offer goes");
    }

    #[test]
    fn a_session_on_another_machine_stays_with_its_folder_and_is_named_by_the_machine() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // The shell ssh's into a machine; a second shell sits in another folder.
        let t = app.snap.terms.get_mut(&3).unwrap();
        (t.process, t.remote) = ("ssh".into(), Some("build-box".into()));
        let mut notes = app.snap.terms[&3].clone();
        (
            notes.id,
            notes.process,
            notes.remote,
            notes.root,
            notes.top,
            notes.branch,
        ) = (4, "bash".into(), None, None, None, None);
        notes.cwd = PathBuf::from(if cfg!(windows) { r"C:\notes" } else { "/notes" });
        app.snap.terms.insert(4, notes);
        let mut ws = app.snap.workspaces[0].clone();
        ws.id = 30;
        ws.tabs = vec![crate::protocol::TabInfo {
            id: 31,
            name: String::new(),
            layout: crate::layout::Node::Leaf(4),
            focus: 4,
        }];
        ws.active_tab = 31;
        app.snap.workspaces.push(ws);
        app.screen_fresh();
        let model = app.screen_model();
        let names: Vec<String> = model.iter().map(|p| p.name.clone()).collect();
        assert_eq!(
            names,
            ["shop-api", "notes"],
            "no group of its own for the other machine"
        );
        let ssh = model
            .iter()
            .flat_map(|p| p.sessions())
            .find(|s| s.native_term == Some(ClientTerm::local(3)))
            .expect("the ssh session");
        assert_eq!(ssh.name, "build-box", "its row says which machine");
        assert!(
            model[0]
                .sessions()
                .any(|s| s.native_term == Some(ClientTerm::local(3))),
            "it stays with the folder it was started in"
        );
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(!o.contains("SSH"), "no SSH heading: {o}");
    }

    #[test]
    fn a_session_is_grouped_by_where_it_is_now() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        // The shell cd's out of shop-api into a folder that isn't a repo.
        let elsewhere = PathBuf::from(if cfg!(windows) { r"C:\notes" } else { "/notes" });
        let t = app.snap.terms.get_mut(&3).unwrap();
        (t.cwd, t.root, t.top, t.branch) = (elsewhere.clone(), None, None, None);
        app.screen_fresh();
        let model = app.screen_model();
        let group_of = |term: TermId| {
            model
                .iter()
                .find(|p| {
                    p.sessions()
                        .any(|s| s.native_term.unwrap() == ClientTerm::local(term))
                })
                .map(|p| p.name.clone())
        };
        assert_eq!(
            group_of(3).as_deref(),
            Some("notes"),
            "it moved to where it is"
        );
        assert_eq!(group_of(1).as_deref(), Some("shop-api"), "the others stay");
    }

    #[test]
    fn a_click_on_a_note_over_a_program_that_wants_the_mouse_is_the_notes() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.cfg.ui.motion = false;
        app.mode = Mode::Normal;
        // The focused pane's program asks for the mouse, as Claude Code's full-screen view does.
        let focused = app.focused().expect("a focused pane");
        app.parsers
            .get_mut(&focused)
            .expect("its screen")
            .process(b"\x1b[?1000h\x1b[?1006h");
        let term = app
            .snap
            .terms
            .keys()
            .copied()
            .find(|t| *t != focused.term)
            .expect("a session that is not on screen");
        app.notify("codex finished".into(), false);
        app.notice_term = Some(ClientTerm::local(term));
        draw(&mut app, 160, 45);
        let r = app
            .hits
            .iter()
            .rev()
            .find_map(|(r, h)| {
                (*h == Hit::Screen(screen::ScreenHit::Session(ClientSession::local(
                    SessionKey::Pane(term),
                ))) && r.width > 20
                    && r.height >= 3)
                    .then_some(*r)
            })
            .expect("the toast's click area");
        let at = (r.x + 6, r.y + 2);
        assert!(
            app.panes
                .iter()
                .any(|(_, p)| p.contains(ratatui::layout::Position::new(at.0, at.1))),
            "the note sits over the pane's text"
        );
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: at.0,
                row: at.1,
                modifiers: KeyModifiers::NONE,
            });
        }
        let sent: Vec<_> = std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect();
        assert!(
            sent.iter().any(
                |m| matches!(m, ClientMsg::Command(Command::FocusPane { term: t }) if *t == term)
            ),
            "the click went to session {term}: {sent:?}"
        );
        assert!(
            !sent.iter().any(|m| matches!(m, ClientMsg::Input { .. })),
            "and none of it reached the program: {sent:?}"
        );
    }

    #[test]
    fn closing_a_split_pane_leaves_the_other() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let a = app.focused().unwrap();
        let others: Vec<ClientTerm> = app
            .snap
            .terms
            .keys()
            .map(|t| ClientTerm::local(*t))
            .filter(|t| *t != a)
            .collect();
        let (b, c) = (others[0], others[1]);
        app.screen.tabs.clear();
        app.screen_place(a, None);
        app.screen.pending_split = Some((a, Instant::now()));
        app.screen_place(b, Some(a));
        assert_eq!(app.screen.tabs[0].layout.leaves().len(), 2);
        // b is closed; the server then focuses some other session, c.
        app.snap.terms.remove(&b.term);
        app.screen_place(c, Some(b));
        assert_eq!(
            app.screen.tabs[0].layout,
            crate::layout::Node::Leaf(a.term),
            "a takes the room; c doesn't slide into b's place"
        );
        // Closing from the ✕ takes it out of the split first.
        app.screen.pending_split = Some((a, Instant::now()));
        app.snap
            .terms
            .insert(b.term, app.snap.terms[&c.term].clone());
        app.screen_place(b, Some(a));
        app.menu_do(menu::Act::End(vec![b]));
        assert_eq!(app.screen.tabs[0].layout, crate::layout::Node::Leaf(a.term));
    }

    /// The frame as a buffer, for looking at single cells.
    fn frame(app: &mut App, w: u16, h: u16) -> ratatui::buffer::Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    fn row_text(buf: &ratatui::buffer::Buffer, y: u16) -> String {
        (0..buf.area.width)
            .map(|x| buf[(x, y)].symbol().to_string())
            .collect::<String>()
            .trim_end()
            .to_string()
    }

    #[test]
    fn a_long_toast_title_drops_to_a_second_line_instead_of_being_cut() {
        const SENTENCE: &str =
            "Files is local-only in v1: the files are on kingdom, not on this computer.";
        let (_, mut app) = super::design_tests::render_with(70, 30);
        app.notify(SENTENCE.into(), true);
        let buf = frame(&mut app, 70, 30);
        let r = app.screen.toast_rect;
        assert!(
            r.height >= 4,
            "the box grew a row for the second line: {r:?}"
        );
        let rows: Vec<String> = (r.y + 1..r.bottom() - 1)
            .map(|y| {
                (r.x + 2..r.right() - 1)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .filter(|row| !row.is_empty())
            .collect();
        assert!(
            rows.len() >= 2,
            "the sentence is on more than one line: {rows:?}"
        );
        assert_eq!(
            rows.join(" "),
            SENTENCE,
            "every word shows, in order, none cut: {rows:?}"
        );
    }

    const DETAIL: &str = "A connection to kingdom was lost while the task was running, so nothing it \
                          wrote since the last save could be kept on this computer";
    const PREVIEW: &str = "error: the remote end hung up unexpectedly while receiving the last of \
                           the pack data from kingdom";

    /// The text of each row inside a toast's box, below its title row, blank rows left out.
    fn below_title(buf: &ratatui::buffer::Buffer, r: Rect, from_x: u16) -> Vec<String> {
        (r.y + 2..r.bottom() - 1)
            .map(|y| {
                (from_x..r.right() - 1)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .filter(|row| !row.is_empty())
            .collect()
    }

    #[test]
    fn a_long_detail_and_preview_wrap_inside_a_taller_box_and_draw_nothing_outside_it() {
        for (w, h) in [(70, 30), (160, 45)] {
            let (_, mut app) = super::design_tests::render_with(w, h);
            let bare = frame(&mut app, w, h);
            app.notify_card(
                "Copied to clipboard".into(),
                DETAIL.into(),
                Some(PREVIEW.into()),
                false,
            );
            let buf = frame(&mut app, w, h);
            let r = app.screen.toast_rect;
            let rows = below_title(&buf, r, r.x + 2);
            assert!(
                r.height >= if w == 70 { 7 } else { 5 },
                "{w}x{h}: the box grew with its text: {r:?}"
            );
            assert_eq!(
                rows.join(" "),
                format!("{DETAIL} {PREVIEW}"),
                "{w}x{h}: every word shows, in order: {rows:?}"
            );
            assert!(r.right() <= w && r.bottom() <= h);
            for y in 0..h {
                for x in 0..w {
                    let inside = x >= r.x && x < r.right() && y >= r.y && y < r.bottom();
                    assert!(
                        inside || buf[(x, y)] == bare[(x, y)],
                        "{w}x{h}: ({x},{y}) outside the box changed"
                    );
                }
            }
        }
    }

    #[test]
    fn a_toast_clears_after_its_time_or_with_the_close_or_esc() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.notify("Copied".into(), false);
        let past = |app: &mut App, ms: u64| {
            app.notice.as_mut().unwrap().1 = Instant::now() - Duration::from_millis(ms)
        };
        past(&mut app, 2300);
        assert!(
            draw(&mut app, 160, 45).contains("Copied"),
            "still there just before 2.4 s"
        );
        past(&mut app, 2500);
        assert!(
            !draw(&mut app, 160, 45).contains("Copied"),
            "gone after 2.4 s"
        );
        // The close.
        app.notify("Copied".into(), false);
        draw(&mut app, 160, 45);
        let r = app
            .hits
            .iter()
            .rev()
            .find_map(|(r, h)| (*h == Hit::Screen(screen::ScreenHit::ToastClose)).then_some(*r))
            .expect("a close");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: r.x,
            row: r.y,
            modifiers: KeyModifiers::NONE,
        });
        assert!(app.notice.is_none(), "✕ clears it");
        // Esc clears it and still goes to the pane.
        app.notify("Copied".into(), false);
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.notice.is_none(), "Esc clears it");
    }

    #[test]
    fn selecting_tints_sky_with_hints_and_copying_glows_accent_with_a_toast() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let mut p = vt100::Parser::new(20, 80, 100);
        p.process(b"alpha beta gamma\r\nsecond line\r\n");
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        assert!(app.enter_copy(ClientTerm::local(1)));
        let r = app
            .panes
            .iter()
            .find(|(t, _)| *t == ClientTerm::local(1))
            .map(|(_, r)| *r)
            .unwrap();
        if let Mode::Copy(c) = &mut app.mode {
            c.cur = (0, 6);
            c.anchor = Some((0, 0));
        }
        let buf = frame(&mut app, 160, 45);
        let t = app.theme.clone();
        let sky = render::blend(t.bg, t.sky(), 0.38);
        assert_eq!(
            (
                buf[(r.x, r.y)].symbol(),
                buf[(r.x, r.y)].bg,
                buf[(r.x, r.y)].fg
            ),
            ("a", sky, t.strong),
            "the selection is sky with strong text"
        );
        assert_eq!(buf[(r.x + 6, r.y)].bg, sky, "through the cursor's cell");
        assert_ne!(buf[(r.x + 8, r.y)].bg, sky, "and no further");
        let line = row_text(&buf, r.y);
        assert!(
            line.contains(" copy · ")
                && line.contains(" cancel")
                && line.contains('y')
                && line.contains("Esc"),
            "{line}"
        );
        // y copies: the same cells glow accent, and the toast says what was copied.
        app.on_key(KeyEvent::new(KeyCode::Char('y'), KeyModifiers::NONE));
        assert!(matches!(app.mode, Mode::Normal) && app.copy_flash.is_some());
        let buf = frame(&mut app, 160, 45);
        let glow = render::blend(t.bg, t.accent, 0.34);
        assert_eq!(
            (buf[(r.x, r.y)].bg, buf[(r.x, r.y)].fg),
            (glow, t.strong),
            "copied: accent-tinted"
        );
        let o: String = (0..45).map(|y| row_text(&buf, y) + "\n").collect();
        show(&o);
        assert!(
            o.contains("Copied to clipboard") && o.contains("7 characters · 1 line"),
            "{o}"
        );
        assert!(o.contains("\"alpha b\""), "the preview quotes the text");
        assert_eq!(
            copy::LAST_COPY.with(|c| c.borrow().clone()).as_deref(),
            Some("alpha b"),
            "what reached the clipboard (recorded, never the real one)"
        );
        app.copy_flash.as_mut().unwrap().at = Instant::now() - copy::FLASH_FOR;
        let buf = frame(&mut app, 160, 45);
        assert_ne!(buf[(r.x, r.y)].bg, glow, "the glow ends");
    }

    #[test]
    fn idle_and_completed_sessions_stay_visible_without_snooze_actions() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.snap.terms.get_mut(&2).unwrap().status = Status::Idle;
        app.snap.terms.get_mut(&3).unwrap().status = Status::Done;
        for id in [2, 3] {
            app.snap.terms.get_mut(&id).unwrap().agent = Some("claude".into());
        }
        app.screen_fresh();
        let model = app.screen_model();
        let rows = screen::side_keys(&app, &model);
        assert!(
            rows.contains(&ClientSession::local(SessionKey::Pane(2)))
                && rows.contains(&ClientSession::local(SessionKey::Pane(3))),
            "resting sessions remain in the sidebar"
        );
        let screen = draw(&mut app, 160, 45);
        assert!(!screen.contains("settled ?") && !screen.contains("Snooze"));
        for term in [2, 3] {
            let items = app.session_items(ClientTerm::local(term)).unwrap().1;
            assert!(
                !items
                    .iter()
                    .any(|(label, _)| label.contains("Snooze") || label == "Bring back")
            );
        }
    }

    #[test]
    fn a_snapshot_is_restored_from_the_list_only_once_you_say_so() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let dir = std::path::PathBuf::from("/code/dsa-tool");
        let kept: Vec<crate::snapshot::Snapshot> = (0..12)
            .map(|i| crate::snapshot::Snapshot {
                commit: format!("c{i}"),
                at: now - 120 * (i + 1),
                why: "before claude's turn".into(),
            })
            .collect();
        // None yet: it says when there will be, and opens nothing.
        app.snapshots_menu(dir.clone(), ClientTerm::local(1), Vec::new(), (30, 6));
        assert!(!matches!(app.mode, Mode::ScreenMenu(_)));
        // Newest first, numbered, and no more than have a number to press.
        app.snapshots_menu(dir.clone(), ClientTerm::local(1), kept, (30, 6));
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("1  2m ago")
                && o.contains("before claude's turn")
                && o.contains("9  18m ago")
                && !o.contains("20m ago"),
            "the list"
        );
        // Picking one asks first, and says what happens to what's there now.
        app.on_key(KeyEvent::new(KeyCode::Char('2'), KeyModifiers::NONE));
        let Mode::Confirm(c) = &app.mode else {
            panic!("it asks: {:?}", app.mode)
        };
        assert_eq!(
            c.act,
            crate::client::menu::Act::Restore(
                dir,
                "c1".into(),
                "4m ago · before claude's turn".into(),
                ClientTerm::local(1)
            )
        );
        assert!(c.note.contains("kept as a snapshot first") && c.yes == "Restore");
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(o.contains("Restore snapshot") && o.contains("dsa-tool"));
    }

    fn one_snapshot(app: &mut App) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let kept = vec![crate::snapshot::Snapshot {
            commit: "c0".into(),
            at: now - 120,
            why: "before claude's turn".into(),
        }];
        app.snapshots_menu(
            std::path::PathBuf::from("/code/dsa-tool"),
            ClientTerm::local(1),
            kept,
            (30, 6),
        );
    }

    #[test]
    fn a_snapshot_is_not_restored_while_its_agent_works() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.snap.terms.get_mut(&1).unwrap().status = Status::Working;
        one_snapshot(&mut app);
        app.on_key(KeyEvent::new(KeyCode::Char('1'), KeyModifiers::NONE));
        assert!(
            !matches!(app.mode, Mode::Confirm(_)),
            "nothing to confirm: {:?}",
            app.mode
        );
        assert_eq!(
            app.notice.as_ref().map(|n| n.0.as_str()),
            Some(crate::client::menu::RESTORE_WHILE_WORKING)
        );
    }

    #[test]
    fn a_restore_confirmed_before_the_agent_started_working_is_still_refused() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.snap.terms.get_mut(&1).unwrap().status = Status::Idle;
        one_snapshot(&mut app);
        app.on_key(KeyEvent::new(KeyCode::Char('1'), KeyModifiers::NONE));
        assert!(matches!(app.mode, Mode::Confirm(_)), "idle: it asks first");
        app.snap.terms.get_mut(&1).unwrap().status = Status::Working;
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(
            app.notice.as_ref().map(|n| n.0.as_str()),
            Some(crate::client::menu::RESTORE_WHILE_WORKING)
        );
    }

    /// What the client sent as helper answers, in order.
    fn helper_answers(
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<Outgoing>,
    ) -> Vec<(TermId, crate::protocol::HelperChoice)> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .filter_map(|m| match m {
                crate::protocol::ClientMsg::Command(crate::protocol::Command::AnswerHelpers {
                    term,
                    choice,
                }) => Some((term, choice)),
                _ => None,
            })
            .collect()
    }

    /// Session 2 asks for helpers: needs you, with three tasks.
    fn asking_for_helpers() -> (App, tokio::sync::mpsc::UnboundedReceiver<Outgoing>) {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let t = app.snap.terms.get_mut(&2).unwrap();
        t.status = Status::Blocked;
        t.helper_ask = vec![
            "fix the login test".into(),
            "port the footer".into(),
            "update the docs".into(),
        ];
        app.screen_fresh();
        (app, rx)
    }

    #[test]
    fn the_inbox_opens_the_helper_question_and_goes_back_to_it() {
        let (mut app, mut rx) = asking_for_helpers();
        app.act(Action::Jump);
        let at = |app: &App| {
            screen::goto_rows(&app.screen_model(), "", screen::heads_up(app).len())
                .iter()
                .position(|r| matches!(r, screen::GoRow::Ask(ClientTerm { term: 2, .. })))
                .expect("the asking session is in the Inbox")
        };
        for key in [KeyCode::Enter, KeyCode::Char('1')] {
            let sel = at(&app);
            app.mode = Mode::GoTo {
                query: String::new(),
                sel,
            };
            app.on_key(KeyEvent::new(key, KeyModifiers::NONE));
            assert_eq!(
                app.mode,
                Mode::Helpers {
                    term: ClientTerm::local(2),
                    side: false
                },
                "{key:?} on the row opens the question, not a message box or a typed number"
            );
            let o = draw(&mut app, 160, 45);
            assert!(
                o.contains("START HELPERS?") && o.contains("INBOX"),
                "the question over the Inbox:\n{o}"
            );
            app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            assert_eq!(
                app.mode,
                Mode::GoTo {
                    query: String::new(),
                    sel
                },
                "Esc: back in the Inbox, on the same row"
            );
        }
        assert!(
            helper_answers(&mut rx).is_empty(),
            "nothing was answered, and no number reached the agent"
        );
        // Answering from there goes back to the Inbox too.
        let sel = at(&app);
        app.mode = Mode::GoTo {
            query: String::new(),
            sel,
        };
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        app.on_key(KeyEvent::new(KeyCode::Char('3'), KeyModifiers::NONE));
        assert_eq!(
            helper_answers(&mut rx),
            [(2, crate::protocol::HelperChoice::No)]
        );
        assert!(
            matches!(app.mode, Mode::GoTo { .. }),
            "answered: back in the Inbox"
        );
    }

    #[test]
    fn a_bare_m_in_the_sidebar_opens_its_menu_and_the_leaders_m_the_full_one() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.screen_side_set(screen::SideItem::Sess(ClientSession::local(
            SessionKey::Pane(2),
        )));
        assert_eq!(app.mode, Mode::Side);
        app.on_key(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::NONE));
        assert!(
            matches!(&app.mode, Mode::ScreenMenu(m) if m.title == "menu"),
            "a bare m opens the sidebar's own menu"
        );
        app.mode = Mode::Normal;
        app.screen.cursor = None;
        app.act(Action::Menu);
        assert!(
            matches!(app.mode, Mode::Actions { .. }),
            "the leader's m does"
        );
        // And no row's menu item is ever handed a key the sidebar already uses.
        let items: Vec<(String, crate::client::menu::Act)> =
            ["Archive", "Ask", "Mark", "Inspect", "Jump", "Keep"]
                .iter()
                .map(|l| {
                    (
                        l.to_string(),
                        crate::client::menu::Act::RenamePane(ClientTerm::local(1)),
                    )
                })
                .collect();
        let keys = crate::client::menu::menu_chars(&app, &items);
        assert!(
            keys.iter()
                .flatten()
                .all(|k| !['a', 'm', 'i', 'j', 'k'].contains(k)),
            "{keys:?}"
        );
    }

    #[test]
    fn a_finish_right_after_a_needs_you_does_not_ring_a_second_time() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let others: Vec<TermId> = app
            .snap
            .terms
            .keys()
            .copied()
            .filter(|t| *t != 1)
            .take(2)
            .collect();
        let [asking, finishing] = others[..] else {
            panic!("two sessions besides the one you are on")
        };
        let said = |app: &mut App, term: TermId, status: Status| {
            app.snap.terms.get_mut(&term).unwrap().status = status;
            app.on_server(crate::protocol::ServerMsg::Attention { term, status });
            app.settling.get_mut(&ClientTerm::local(term)).unwrap().1 =
                Instant::now() - Duration::from_millis(1);
            app.settle_alerts();
        };
        said(&mut app, asking, Status::Blocked);
        assert!(app.alerted.contains_key(&ClientTerm::local(asking)), "it rings");

        said(&mut app, finishing, Status::Done);

        assert!(
            !app.alerted.contains_key(&ClientTerm::local(finishing)),
            "a second sound inside the quiet spell is held back"
        );
        assert!(
            app.toasts.iter().any(|t| t.title.ends_with("finished")),
            "the toast still says it finished"
        );
        assert_eq!(
            app.last_alert.map(|(kind, _)| kind),
            Some(crate::alert::Kind::Needs),
            "the last thing heard is still the needs-you"
        );
    }

    #[test]
    fn finished_is_only_said_once_it_has_stayed_finished() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let attention = |app: &mut App, term: TermId, status: Status| {
            app.snap.terms.get_mut(&term).unwrap().status = status;
            app.on_server(crate::protocol::ServerMsg::Attention { term, status });
        };
        let due = |app: &mut App, term: TermId| {
            app.settling.get_mut(&ClientTerm::local(term)).unwrap().1 =
                Instant::now() - Duration::from_millis(1);
            app.settle_alerts();
        };
        // codex (2), not the session you're on.
        app.toasts.clear();
        attention(&mut app, 2, Status::Done);
        assert!(
            app.toasts.is_empty() && app.settling.contains_key(&ClientTerm::local(2)),
            "finished: nothing yet, it waits"
        );
        // It went back to work by itself: nothing is ever said.
        app.snap.terms.get_mut(&2).unwrap().status = Status::Working;
        due(&mut app, 2);
        assert!(
            app.toasts.is_empty() && !app.alerted.contains_key(&ClientTerm::local(2)),
            "it carried on: no note, no sound"
        );
        // Finished and still finished when the wait is over: now it's said.
        attention(&mut app, 2, Status::Done);
        due(&mut app, 2);
        assert!(
            app.toasts.iter().any(|t| t.title.ends_with("finished"))
                && app.alerted.contains_key(&ClientTerm::local(2))
                && app
                    .last_alert
                    .is_some_and(|(kind, _)| kind == crate::alert::Kind::Done),
            "a background completion uses the soft sound"
        );
        // A stable question replaces the pending finish, without ringing twice.
        app.toasts.clear();
        attention(&mut app, 2, Status::Done);
        attention(&mut app, 2, Status::Blocked);
        assert!(app.toasts.is_empty());
        due(&mut app, 2);
        assert!(
            app.toasts.iter().any(|t| t.title.ends_with("needs you"))
                && app.alerted.contains_key(&ClientTerm::local(2))
                && !app.settling.contains_key(&ClientTerm::local(2))
        );
        // A session another agent started: its finish is that agent's news, not yours.
        app.toasts.clear();
        app.snap.terms.get_mut(&2).unwrap().started_by = Some(1);
        attention(&mut app, 2, Status::Done);
        assert!(
            app.toasts.is_empty() && !app.settling.contains_key(&ClientTerm::local(2)),
            "a helper's finish is never said"
        );
        // But it still says when it needs you.
        app.alerted.clear();
        app.last_alert = None;
        attention(&mut app, 2, Status::Blocked);
        due(&mut app, 2);
        assert!(app.toasts.iter().any(|t| t.title.ends_with("needs you")));
        // Its starter gone: it's yours again.
        app.notice = None;
        app.snap.terms.get_mut(&2).unwrap().started_by = Some(999);
        attention(&mut app, 2, Status::Done);
        assert!(app.settling.contains_key(&ClientTerm::local(2)));
    }

    #[test]
    fn transient_or_stale_blockers_never_ring_while_working() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.notice = None;
        app.snap.terms.get_mut(&2).unwrap().status = Status::Blocked;
        app.on_server(ServerMsg::Attention {
            term: 2,
            status: Status::Blocked,
        });
        assert!(
            !app.alerted.contains_key(&ClientTerm::local(2)) && app.notice.is_none(),
            "a transient ask must settle before ringing"
        );
        let mut working = app.snap.clone();
        working.terms.get_mut(&2).unwrap().status = Status::Working;
        app.on_server(ServerMsg::State(working));
        app.settle_alerts();
        assert!(!app.alerted.contains_key(&ClientTerm::local(2)) && app.notice.is_none());
        // Attention can arrive after a newer working snapshot.
        app.on_server(ServerMsg::Attention {
            term: 2,
            status: Status::Blocked,
        });
        let due = app.settling.get_mut(&ClientTerm::local(2)).unwrap();
        due.1 = Instant::now() - Duration::from_millis(1);
        app.settle_alerts();
        assert!(
            !app.alerted.contains_key(&ClientTerm::local(2)) && app.notice.is_none(),
            "stale attention must agree with the snapshot"
        );
    }

    #[test]
    fn a_failed_check_rings_for_a_pane_whose_turn_has_ended() {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        app.notice = None;
        let pane = app.snap.terms.get_mut(&2).unwrap();
        pane.status = Status::Done;
        pane.checks = vec![crate::protocol::CheckInfo {
            state: crate::protocol::CheckState::Failed,
            ..Default::default()
        }];
        let term = ClientTerm::local(2);
        app.on_server(ServerMsg::Attention {
            term: 2,
            status: Status::Blocked,
        });
        // The next state the daemon sends still shows the pane done: the alert must outlive it.
        app.on_server(ServerMsg::State(app.snap.clone()));
        app.settling.get_mut(&term).expect("still waiting to ring").1 =
            Instant::now() - Duration::from_millis(1);
        app.settle_alerts();
        assert!(
            app.alerted.contains_key(&term),
            "a failed check needs you, though the pane reads done"
        );

        // With the check passed it is only a finished pane: a stale needs-you says nothing.
        app.alerted.clear();
        app.last_alert = None;
        app.snap.terms.get_mut(&2).unwrap().checks[0].state = crate::protocol::CheckState::Passed;
        app.on_server(ServerMsg::Attention {
            term: 2,
            status: Status::Blocked,
        });
        app.settling.get_mut(&term).unwrap().1 = Instant::now() - Duration::from_millis(1);
        app.settle_alerts();
        assert!(!app.alerted.contains_key(&term));
    }

    #[test]
    fn a_blocker_in_the_pane_you_are_looking_at_makes_no_sound() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let id = app.focused().unwrap();
        app.window_focused = true;
        app.on_server(ServerMsg::Attention {
            term: id.term,
            status: Status::Blocked,
        });
        app.settling.get_mut(&id).unwrap().1 = Instant::now() - Duration::from_millis(1);
        app.settle_alerts();
        assert!(
            !app.alerted.contains_key(&id),
            "you are looking at it: no sound"
        );
    }

    #[test]
    fn the_same_question_asked_again_soon_stays_quiet() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let id = app.focused().unwrap();
        app.window_focused = false;
        let ask = |app: &mut App| {
            app.on_server(ServerMsg::Attention {
                term: id.term,
                status: Status::Blocked,
            });
            let mut blocked = app.snap.clone();
            blocked.terms.get_mut(&id.term).unwrap().status = Status::Blocked;
            app.on_server(ServerMsg::State(blocked));
            app.settling.get_mut(&id).unwrap().1 = Instant::now() - Duration::from_millis(1);
            app.settle_alerts();
        };
        ask(&mut app);
        let first = app.alerted[&id].1;
        app.last_alert = Some((
            crate::alert::Kind::Needs,
            Instant::now() - Duration::from_secs(5),
        ));
        let mut next = app.snap.clone();
        next.terms.get_mut(&id.term).unwrap().status = Status::Working;
        app.on_server(ServerMsg::State(next));
        ask(&mut app);
        assert_eq!(
            app.alerted[&id].1, first,
            "asking again within two minutes does not ring again"
        );
    }

    #[test]
    fn a_closed_worktree_with_work_only_there_asks_and_enter_keeps_it() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        let key = |c: KeyCode| KeyEvent::new(c, KeyModifiers::NONE);
        let ask = |app: &mut App| {
            app.mode = Mode::Normal;
            app.on_server(ServerMsg::AskRemoveWorktree {
                path: PathBuf::from("/wt/task"),
                name: "task".into(),
                why: "not merged anywhere".into(),
            });
        };
        let removals = |rx: &mut tokio::sync::mpsc::UnboundedReceiver<Outgoing>| {
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
                .filter_map(|m| match m {
                    crate::protocol::ClientMsg::Command(
                        crate::protocol::Command::TidyWorktrees { items, .. },
                    ) => Some(items),
                    _ => None,
                })
                .collect::<Vec<_>>()
        };
        ask(&mut app);
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.what == "task" && c.note.contains("not merged anywhere") && c.danger),
            "it asks, and says why"
        );
        let o = draw(&mut app, 100, 30);
        assert!(
            o.contains("Keep worktree?") && o.contains("Remove folder"),
            "{o}"
        );
        app.on_key(key(KeyCode::Enter));
        assert!(
            matches!(app.mode, Mode::Normal) && removals(&mut rx).is_empty(),
            "Enter keeps the folder and sends nothing"
        );
        ask(&mut app);
        app.on_key(key(KeyCode::Esc));
        assert!(removals(&mut rx).is_empty(), "Esc keeps it too");
        ask(&mut app);
        app.on_key(key(KeyCode::Char('r')));
        assert_eq!(
            removals(&mut rx),
            [vec![(PathBuf::from("/wt/task"), false)]],
            "only the button's key removes it, and never forces"
        );
        // Another dialog is open: the question waits as a notice, nothing is replaced.
        app.mode = Mode::Prompt {
            kind: PromptKind::NewWorkspace,
            input: String::new(),
        };
        app.on_server(ServerMsg::AskRemoveWorktree {
            path: PathBuf::from("/wt/task"),
            name: "task".into(),
            why: "not merged anywhere".into(),
        });
        assert!(
            matches!(app.mode, Mode::Prompt { .. }),
            "the open dialog stays"
        );
    }

    #[test]
    fn you_can_ask_for_an_update_check_and_are_told_what_it_found() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let said = |app: &App| {
            app.notice
                .as_ref()
                .map(|(m, _, err)| (m.clone(), *err))
                .unwrap()
        };
        assert!(
            app.palette_commands().contains(&Action::CheckUpdate),
            "in the palette"
        );
        // Settings: About's version row, when no newer one is known; no other page shows it.
        let about = modal::Cat::ALL.iter().position(|c| *c == modal::Cat::About).unwrap();
        let version_row = design::settings_rows(modal::Cat::About)
            .iter()
            .position(|r| matches!(r, design::SRow::Version))
            .expect("About has a Version row");
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: about,
            sel: version_row,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        let o = draw(&mut app, 160, 45);
        show(&o);
        let line = o
            .lines()
            .find(|l| l.contains(concat!(env!("APP_COMMAND"), " ", env!("APP_VERSION"))))
            .unwrap_or_else(|| {
                panic!(
                    "the Version row
{o}"
                )
            });
        assert!(
            line.contains(&format!(
                concat!(env!("APP_COMMAND"), " {}"),
                env!("APP_VERSION")
            )) && line.contains("up to date")
                && line.contains("u check now"),
            "{line}"
        );
        let keys = modal::Cat::ALL
            .iter()
            .position(|c| *c == modal::Cat::Keys)
            .unwrap();
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: keys,
            sel: 0,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        assert!(
            !draw(&mut app, 160, 45).contains("up to date"),
            "not at the top of every tab"
        );
        // While it's asking, the row says so.
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: about,
            sel: version_row,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        app.update_checking = true;
        let o = draw(&mut app, 160, 45);
        assert!(
            o.lines()
                .any(|l| l.contains(env!("APP_COMMAND")) && l.contains("checking…")),
            "{o}"
        );
        // Nothing newer: you asked, so it says so. A check the app made itself stays quiet.
        app.notice = None;
        app.update_checked_now(false, Ok(None), Vec::new());
        assert!(
            app.notice.is_none(),
            "its own checks say nothing when there's nothing new"
        );
        app.update_checked_now(true, Ok(None), Vec::new());
        assert!(
            !app.update_checking
                && said(&app)
                    == (
                        format!(
                            concat!("Installed ", env!("APP_COMMAND"), " {} is the latest"),
                            env!("APP_VERSION")
                        ),
                        false
                    )
        );
        app.update_checked_now(
            true,
            Err("couldn't reach GitHub: timed out".into()),
            Vec::new(),
        );
        assert!(
            said(&app).1 && said(&app).0.contains("Couldn't check for updates"),
            "{:?}",
            said(&app)
        );
        // A newer one: the Update button takes the place of the check.
        app.update_checked_now(
            true,
            Ok(Some("9.9.9".into())),
            vec!["New: something".into()],
        );
        assert_eq!(app.update_available.as_deref(), Some("9.9.9"));
        let o = draw(&mut app, 160, 45);
        let line = o
            .lines()
            .find(|l| l.contains("9.9.9 is ready"))
            .unwrap_or_else(|| panic!("{o}"));
        assert!(
            line.contains("i install") && !line.contains("check now"),
            "{line}"
        );
    }

    #[test]
    fn legacy_sleep_recovery_keeps_the_saved_screen_without_a_wake_overlay() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.got_state = true;
        app.snap.terms.get_mut(&1).unwrap().asleep = true;
        app.parsers
            .get_mut(&ClientTerm::local(1))
            .unwrap()
            .process(b"Saved terminal contents\r\n");
        let o = draw(&mut app, 160, 45);
        assert!(
            o.contains("Saved terminal contents"),
            "the last screen remains readable"
        );
        assert!(
            !o.contains("waking up") && !o.contains("to wake it"),
            "there is no wake screen or animation"
        );
    }

    #[test]
    fn a_needs_you_toast_offers_answer_and_later_on_its_bottom_border() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.notify("pane-one needs you".into(), false);
        app.notice_term = Some(ClientTerm::local(1));
        let buf = frame(&mut app, 160, 45);
        let r = app.screen.toast_rect;
        let bottom: String = (r.x..r.right())
            .map(|x| buf[(x, r.bottom() - 1)].symbol())
            .collect();
        assert!(
            bottom.contains(" Answer ") && bottom.contains(" Later esc "),
            "the two answers sit on the border: {bottom}"
        );
        let closes: Vec<Rect> = app
            .hits
            .iter()
            .filter(|(_, h)| *h == Hit::Screen(screen::ScreenHit::ToastClose))
            .map(|(r, _)| *r)
            .collect();
        assert!(
            closes.iter().any(|c| c.y == r.bottom() - 1),
            "Later is a click that dismisses: {closes:?}"
        );
        app.notify("Copied".into(), false);
        let buf = frame(&mut app, 160, 45);
        let r = app.screen.toast_rect;
        let bottom: String = (r.x..r.right())
            .map(|x| buf[(x, r.bottom() - 1)].symbol())
            .collect();
        assert!(
            !bottom.contains("Answer"),
            "only a question waiting on you asks for an answer: {bottom}"
        );
    }

    #[test]
    fn go_to_a_project_or_session() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let key = |c: KeyCode| KeyEvent::new(c, KeyModifiers::NONE);
        app.act(Action::Jump);
        let o = draw(&mut app, 160, 45);
        show(&o);
        // claude needs you in the fixture: the Inbox; the search shows once you type.
        assert!(o.contains("INBOX") && !o.contains("type to find any session"));
        for c in "rate".chars() {
            app.on_key(key(KeyCode::Char(c)));
        }
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("FOUND  1")
                && o.contains("› rate█")
                && o.contains("rate · codex · shop-api"),
            "typing finds what matches"
        );
        let Mode::GoTo { query, sel } = app.mode.clone() else {
            panic!("still open")
        };
        let rows = screen::goto_rows(&app.screen_model(), &query, 0);
        assert!(
            matches!(rows[sel], screen::GoRow::Sess(..)),
            "it lands on the matching session"
        );
        app.on_key(key(KeyCode::Enter));
        assert!(matches!(app.mode, Mode::Normal), "Enter goes there");
    }

    #[test]
    fn up_and_down_on_the_spinner_row_move_without_closing_settings() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let cat = modal::Cat::ALL.iter().position(|c| *c == modal::Cat::Appearance).unwrap();
        let rows = design::settings_rows(modal::Cat::Appearance);
        let spinner = rows
            .iter()
            .position(|r| matches!(r, design::SRow::Setting(s) if s.kind == modal::Kind::Spinner))
            .unwrap();
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat,
            sel: spinner,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        app.on_key(KeyEvent::new(KeyCode::Up, KeyModifiers::NONE));
        let Mode::ScreenSettings(v) = &app.mode else { panic!("Up closed Settings: {:?}", app.mode) };
        assert_eq!(v.sel, spinner - 1);
        app.on_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        app.on_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert!(matches!(app.mode, Mode::ScreenSettings(_)), "Down closed Settings");
    }

    #[test]
    fn folders_and_programs_are_picked_not_typed() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let rows = design::settings_rows(modal::Cat::General);
        let row_of = |p: &str| {
            rows.iter()
                .position(|r| matches!(r, design::SRow::Setting(s) if s.path == p))
                .unwrap()
        };
        // Editor and shell: chips of what's installed, "default" first.
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: 0,
            sel: row_of("editor"),
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        let o = draw(&mut app, 160, 45);
        show(&o);
        let line = o.lines().find(|l| l.contains("Editor")).unwrap();
        assert!(line.contains("default"), "a choice, not a text box: {line}");
        let editor = modal::SETTINGS.iter().find(|s| s.path == "editor").unwrap();
        let opts = modal::program_options(modal::EDITORS, "");
        if opts.len() > 1 {
            assert_eq!(
                modal::step(&app.cfg, editor, 1)
                    .and_then(|v| v.as_str().map(String::from))
                    .as_deref(),
                Some(opts[1].as_str()),
                "→ picks the next installed one"
            );
        }
        // The start folder: Enter opens the folder browser for it; Esc goes back to the row.
        let sf = row_of("ui.start_dir");
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: 0,
            sel: sf,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(
            matches!(&app.mode, Mode::Finder(fd) if fd.for_setting == Some("ui.start_dir")),
            "the folder browser, picking for the setting"
        );
        let o = draw(&mut app, 160, 45);
        assert!(o.contains("Choose the start folder"));
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            matches!(&app.mode, Mode::ScreenSettings(v) if v.sel == sf),
            "Esc: back to Settings, on that row"
        );
    }

    #[test]
    fn overlapping_files_stay_in_the_inbox_instead_of_cluttering_the_sidebar() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let model = app.screen_model();
        let p = model
            .iter()
            .find(|p| p.git && p.wts.len() >= 2)
            .expect("a repo with a worktree")
            .clone();
        let names: Vec<String> = p.wts.iter().map(|w| w.name.clone()).collect();
        let shared = |n: usize| {
            (0..n)
                .map(|i| crate::client::overlap::Overlap {
                    file: format!("src/file{i}.ts"),
                    checkouts: names.clone(),
                })
                .collect::<Vec<_>>()
        };
        // Sixty overlapping changes remain available in the Inbox without crowding the sidebar.
        app.screen.overlaps.insert(p.path.clone(), shared(60));
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            !o.contains("shared files") && !o.contains("file0.ts"),
            "sidebar stays focused on sessions"
        );
        let lines = screen::side_keys(&app, &app.screen_model());
        assert!(
            lines.len() < 20,
            "the sidebar stays short: {} lines",
            lines.len()
        );
        // A couple are still available through the Inbox.
        app.screen.overlaps.insert(p.path.clone(), shared(2));
        let o = draw(&mut app, 160, 45);
        assert!(!o.contains("file0.ts") && !o.contains("file1.ts"));
        // In the Inbox they come after what needs you and what finished, however many.
        app.screen.overlaps.insert(p.path.clone(), shared(60));
        let rows = screen::goto_rows(&app.screen_model(), "", screen::heads_up(&app).len());
        let heads: Vec<&str> = rows
            .iter()
            .filter_map(|r| {
                if let screen::GoRow::Head(h) = r {
                    Some(*h)
                } else {
                    None
                }
            })
            .collect();
        assert!(
            heads.first() == Some(&"NEEDS YOU") && heads.last() == Some(&"HEADS UP"),
            "{heads:?}"
        );
    }

    #[test]
    fn heads_up_and_review_from_the_inbox() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let key = |app: &mut App, c: char| {
            app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE))
        };
        // The fixture's repo and its two checkouts (the main folder, rate-limit).
        let model = app.screen_model();
        let p = model
            .iter()
            .find(|p| p.git && p.wts.len() >= 2)
            .expect("a repo with a worktree")
            .clone();
        let names: Vec<String> = p.wts.iter().map(|w| w.name.clone()).collect();
        let o = crate::client::overlap::Overlap {
            file: "src/checkout.ts".into(),
            checkouts: names.clone(),
        };
        app.screen.overlaps.insert(p.path.clone(), vec![o]);
        app.screen_fresh();
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            !o.contains("checkout.ts"),
            "worktree overlap labels stay out of the sidebar"
        );
        // In the Inbox: HEADS UP, with what you can do about it.
        app.act(Action::Jump);
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("HEADS UP")
                && o.contains("both changed checkout.ts")
                && o.contains("both diffs")
                && o.contains(" dismiss"),
            "the heads-up row"
        );
        let Mode::GoTo { query, .. } = app.mode.clone() else {
            panic!("the Inbox")
        };
        let rows = screen::goto_rows(&app.screen_model(), &query, 1);
        let at = rows
            .iter()
            .position(|r| matches!(r, screen::GoRow::Heads(_)))
            .unwrap();
        app.mode = Mode::GoTo {
            query: String::new(),
            sel: at,
        };
        // d: both diffs in the sheet.
        key(&mut app, 'd');
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            matches!(app.view, Some(View::Both(_)))
                && o.contains("─ Changes ")
                && o.contains("reading both diffs"),
            "both diffs, docked"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(app.view.is_none());
        // k: dismissed (and the tag goes with it).
        app.mode = Mode::GoTo {
            query: String::new(),
            sel: at,
        };
        key(&mut app, 'k');
        app.mode = Mode::Normal;
        let o = draw(&mut app, 160, 45);
        assert!(!o.contains("⇆ checkout.ts"), "dismissed: not said again");
        // A finished worktree: merge is asked in its row; Esc backs out.
        let t = app.snap.terms.get_mut(&2).unwrap();
        t.status = Status::Done;
        app.screen_fresh();
        app.act(Action::Jump);
        let rows = screen::goto_rows(&app.screen_model(), "", 0);
        let done = rows
            .iter()
            .position(|r| matches!(r, screen::GoRow::Done(_)))
            .expect("a finished row");
        app.mode = Mode::GoTo {
            query: String::new(),
            sel: done,
        };
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("FINISHED  1") && !o.contains("finished · not seen"),
            "what it finished, under a heading that already says so"
        );
        key(&mut app, 'M');
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("Merge into main, then remove the worktree and branch?")
                && o.contains("Cancel"),
            "asked in the row"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            app.screen.inbox_confirm.is_none() && matches!(app.mode, Mode::GoTo { .. }),
            "Esc: not merged, still in the Inbox"
        );
    }

    #[test]
    fn the_sheet_and_sidebar_draw_at_every_width_a_slide_passes() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.act(Action::Jump);
        let t = app.theme.clone();
        let model = app.screen_model();
        let col = Rect {
            x: 40,
            y: 4,
            width: 118,
            height: 40,
        };
        for step in 0..=20 {
            let frac = step as f32 / 20.0;
            let (sheet, panes) =
                screen::split_for_sheet(160, col, screen::Look::of(&app.cfg.ui), frac, 72);
            assert!(
                panes.width + sheet.width <= col.width,
                "they share the column at {frac}"
            );
            let mut buf = ratatui::buffer::Buffer::empty(Rect::new(0, 0, 160, 45));
            if sheet.width >= screen::SHEET_DRAWN_FROM {
                screen::draw_sheet(&mut app, &mut buf, sheet, screen::SheetKind::Inbox, &t);
            }
        }
        for w in 12..=40 {
            let mut buf = ratatui::buffer::Buffer::empty(Rect::new(0, 0, 160, 45));
            screen::draw_side(
                &mut app,
                &mut buf,
                Rect {
                    x: 1,
                    y: 1,
                    width: w,
                    height: 43,
                },
                &model,
                &t,
            );
        }
    }

    #[test]
    fn a_finished_toast_names_the_session_you_named_wherever_it_runs() {
        // (the name you gave it, where it runs)
        for (label, place) in [
            ("Checkout rewrite", "the fixture's folder"),
            ("Checkout rewrite", "a worktree"),
            ("Notes", "no repository"),
        ] {
            let (_, mut app) = super::design_tests::render_with(160, 45);
            {
                let t = app.snap.terms.get_mut(&2).unwrap();
                t.label = label.into();
                match place {
                    "a worktree" => {
                        t.root = Some(std::path::PathBuf::from("/code/shop-api"));
                        t.top = Some(std::path::PathBuf::from(
                            "/code/shop-api-worktrees/grey-wolf",
                        ));
                        t.branch = Some("fix/early-alerts".into());
                    }
                    "no repository" => {
                        (t.root, t.top, t.branch) = (None, None, None);
                        t.cwd = std::path::PathBuf::from("/home/me/notes");
                    }
                    _ => {}
                }
                t.status = Status::Done;
            }
            app.screen_fresh();
            app.on_server(crate::protocol::ServerMsg::Attention {
                term: 2,
                status: Status::Done,
            });
            app.settling.get_mut(&ClientTerm::local(2)).unwrap().1 =
                Instant::now() - Duration::from_millis(1);
            app.settle_alerts();
            let said = app.toasts.last().map(|t| t.title.clone()).unwrap_or_default();
            assert_eq!(
                said,
                format!("{label} finished"),
                "{place}: the name you gave it, not its agent or folder"
            );
        }
    }

    #[test]
    fn the_split_line_drags_again_and_again() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let a = app.focused().unwrap();
        let b = app
            .snap
            .terms
            .keys()
            .map(|t| ClientTerm::local(*t))
            .find(|t| *t != a)
            .unwrap();
        app.screen.tabs.clear();
        app.screen_place(a, None);
        app.screen.pending_split = Some((a, Instant::now()));
        app.screen_place(b, Some(a));
        let mouse = |app: &mut App, kind: MouseEventKind, x: u16, y: u16| {
            app.on_mouse(MouseEvent {
                kind,
                column: x,
                row: y,
                modifiers: KeyModifiers::NONE,
            });
            draw(app, 200, 50);
        };
        // The grab area is the gutter, the line its middle column.
        let line_x = |app: &App| {
            app.hits.iter().find_map(|(r, h)| {
                matches!(h, Hit::Screen(screen::ScreenHit::Divider(_))).then_some(r.x + 1)
            })
        };
        // Both programs want the mouse (full-screen agents do).
        for t in [a, b] {
            let mut p = vt100::Parser::new(40, 90, 0);
            p.process(b"\x1b[?1002h\x1b[?1006h");
            app.parsers.insert(t, p);
        }
        draw(&mut app, 200, 50);
        let mut at = line_x(&app).expect("a divider");
        // Grab it on the line, just right of it, just left of it: all of the gutter takes it.
        for (n, (to, off)) in [(at - 30, 0i32), (at + 20, 1), (at - 10, -1)]
            .into_iter()
            .enumerate()
        {
            let y = 20;
            mouse(
                &mut app,
                MouseEventKind::Down(MouseButton::Left),
                (at as i32 + off) as u16,
                y,
            );
            mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), to, y);
            mouse(&mut app, MouseEventKind::Up(MouseButton::Left), to, y);
            let now = line_x(&app).expect("still a divider");
            assert_eq!(now, to, "drag {n}: the line is under the pointer");
            at = now;
        }
    }

    #[test]
    fn only_the_part_with_the_keys_looks_focused() {
        let (_, mut app) = super::design_tests::render_with(120, 30);
        // The colour of the focused card's top-right corner, and the sidebar card's left edge.
        let borders = |app: &mut App| {
            let mut term = Terminal::new(TestBackend::new(120, 30)).unwrap();
            term.draw(|f| render::draw(app, f)).unwrap();
            let buf = term.backend().buffer().clone();
            let y = app.pane_frames[0].1.y;
            let x = 119;
            let side = (1..29)
                .filter(|&y| buf[(0u16, y)].fg == app.theme.text)
                .count();
            (buf[(x, y)].fg, side)
        };
        let (pane, side) = borders(&mut app);
        assert_eq!(
            pane, app.theme.text,
            "the focused pane's border is the bright neutral"
        );
        assert_eq!(side, 0, "the sidebar's isn't");
        app.act(Action::BrowseTree);
        let (pane, side) = borders(&mut app);
        assert_ne!(pane, app.theme.text, "not while the sidebar has the keys");
        assert!(side > 10, "the sidebar card is lit instead: {side} rows");
    }

    #[test]
    fn leader_then_a_key_does_it() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.cfg.ui.which_key = false;
        let lead = KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL);
        for (c, what) in [('i', "inbox"), ('.', "menu"), (',', "settings")] {
            app.mode = Mode::Normal;
            app.on_key(lead);
            assert!(matches!(app.mode, Mode::Prefix { .. }), "leader waits");
            assert_eq!(
                shortcut_tag(&mut app).map(|(tag, _)| tag).as_deref(),
                Some("keys"),
                "the mode bar says so"
            );
            app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
            assert!(
                !matches!(app.mode, Mode::Normal | Mode::Prefix { .. }),
                "leader + {c} opens {what}: {:?}",
                std::mem::discriminant(&app.mode)
            );
        }
    }

    #[test]
    fn the_bar_row_is_always_there_so_opening_a_menu_moves_nothing() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let buf = drawn(&mut app, 160, 45);
        let bar = screen::mode_bar_row(&app, buf.area);
        assert!(screen::bar_has_words(&app), "the bar speaks even while keys go to the pane");
        assert_eq!(bar.height, 1, "the row is kept");
        let frames_end = app.pane_frames.iter().map(|(_, r)| r.bottom()).max().expect("a frame");
        let before = frames_end;
        assert!(bar_text(&app, &buf).1.trim_start().starts_with("pane"), "typing says so");

        // Key mode changes the row's words; the frames stay exactly where they were.
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        let buf = drawn(&mut app, 160, 45);
        assert!(buf_text(&buf).contains("keys"), "the bar speaks in key mode");
        let after = app.pane_frames.iter().map(|(_, r)| r.bottom()).max().expect("a frame");
        assert_eq!(after, before, "the frames did not move");
    }

    fn shortcut_mode() -> App {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.cfg.ui.which_key = false;
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app
    }

    fn tap(app: &mut App, c: char) {
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }

    /// From shortcut mode, open a popup that takes the keys: a message to the focused session,
    /// which only an agent takes.
    fn hold(app: &mut App) {
        if let Some(info) = app
            .focused()
            .and_then(|focus| app.snap.terms.get_mut(&focus.term))
        {
            info.agent.get_or_insert_with(|| "claude".into());
        }
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    }

    #[test]
    fn a_view_opened_from_shortcut_mode_takes_the_keys_and_closing_it_brings_the_mode_back() {
        let (mut app, mut rx) = super::check_settings_tests::app_with_channel();
        app.cfg.ui.which_key = false;
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        tap(&mut app, 'f');
        assert!(matches!(app.view, Some(View::Files(_))), "f opened Files");
        assert!(
            matches!(app.mode, Mode::Normal),
            "Files has the keys, not shortcut mode: {:?}",
            std::mem::discriminant(&app.mode)
        );
        while rx.try_recv().map(|o| o.msg).is_ok() {}
        // k moves in Files; in shortcut mode it would stop the agent (Ctrl+C into its pane).
        tap(&mut app, 'k');
        let sent: Vec<ClientMsg> =
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect();
        assert!(
            !sent.iter().any(|m| matches!(m, ClientMsg::Input { .. })),
            "nothing typed into a pane: {sent:?}"
        );
        assert!(matches!(app.view, Some(View::Files(_))), "still in Files");
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            app.view.is_none() && matches!(app.mode, Mode::Prefix { .. }),
            "Esc closed Files and shortcut mode is back"
        );
    }

    #[test]
    fn shortcut_mode_stays_for_the_next_key() {
        let mut app = shortcut_mode();
        tap(&mut app, 'b');
        assert!(
            matches!(app.mode, Mode::Prefix { acted: true, .. }),
            "still in shortcut mode after one"
        );
        tap(&mut app, 'b');
        assert!(
            matches!(app.mode, Mode::Prefix { .. }),
            "and after two, with one leader press"
        );
        tap(&mut app, 'j');
        assert!(
            matches!(app.mode, Mode::Prefix { .. }),
            "a key with no action does nothing and the mode stays"
        );
    }

    #[test]
    fn esc_or_the_leader_again_goes_back_to_typing() {
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(matches!(app.mode, Mode::Normal), "Esc");
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        assert!(matches!(app.mode, Mode::Normal), "the leader again");
    }

    #[test]
    fn a_new_pane_ends_shortcut_mode_and_the_next_key_types_into_it() {
        for c in ['t', 's', 'S', '_', '\\'] {
            let mut app = shortcut_mode();
            let (tx, mut rx) = mpsc::unbounded_channel();
            app.out = tx;
            let before = app.focused().unwrap();
            tap(&mut app, c);
            assert_eq!(app.mode, Mode::Normal, "{c} ends shortcut mode");
            assert!(
                !app.shortcut_held,
                "{c}: nothing holds the mode to come back"
            );
            assert!(
                sent(&mut rx).iter().any(|m| matches!(
                    m,
                    Command::NewWorkspace { .. }
                        | Command::NewTab { .. }
                        | Command::NewShip { .. }
                        | Command::Split { .. }
                        | Command::NewWorktree { .. }
                )),
                "{c} started a pane"
            );
            // The daemon focuses the pane it made; another of the fixture's panes stands in.
            let new = app
                .snap
                .terms
                .keys()
                .copied()
                .find(|t| *t != before.term)
                .unwrap();
            let mut next = app.snap.clone();
            let (ws, tab) = next.locate(new).map(|(w, t)| (w.id, t.id)).unwrap();
            next.active_ws = Some(ws);
            for w in next.workspaces.iter_mut().filter(|w| w.id == ws) {
                w.active_tab = tab;
                for t in w.tabs.iter_mut().filter(|t| t.id == tab) {
                    t.focus = new;
                }
            }
            app.on_server(ServerMsg::State(next));
            assert_eq!(
                app.focused(),
                Some(ClientTerm::local(new)),
                "{c}: the new pane has the focus"
            );
            assert_eq!(app.mode, Mode::Normal, "{c}: and the mode stays ended");
            tap(&mut app, 'a');
            let typed: Vec<ClientMsg> =
                std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect();
            assert!(
                typed.iter().any(
                    |m| matches!(m, ClientMsg::Input { term, data } if *term == new && data == b"a")
                ),
                "{c}: the next key went to the new pane: {typed:?}"
            );
        }
    }

    /// Shortcut mode on, as a popup it opened had closed: the loop's `keep_shortcut_mode` runs.
    fn ended_after(app: &mut App, what: &str) {
        app.keep_shortcut_mode();
        assert!(
            app.mode == Mode::Normal && !app.shortcut_held,
            "{what} ends shortcut mode: {:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn every_way_into_a_new_pane_ends_shortcut_mode() {
        let mut app = shortcut_mode();
        app.keymap
            .prefixed
            .insert("w".parse().unwrap(), Action::SpawnTab("lazygit".into()));
        tap(&mut app, 'w');
        ended_after(&mut app, "spawn-tab");

        let mut app = shortcut_mode();
        let ws = app.active_ws().unwrap().id;
        let entry = WorktreeEntry {
            path: PathBuf::from("/elsewhere/wt"),
            branch: "feature".into(),
            main: false,
            repo: "shop-api".into(),
        };
        app.mode = Mode::Worktrees {
            ws,
            cmd: None,
            items: Some(vec![entry]),
            branches: None,
            query: String::new(),
            sel: 0,
        };
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        ended_after(&mut app, "a row of the worktree picker");

        let mut app = shortcut_mode();
        app.mode = Mode::Worktrees {
            ws,
            cmd: None,
            items: Some(Vec::new()),
            branches: None,
            query: "fresh".into(),
            sel: 0,
        };
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        ended_after(&mut app, "the picker's create row");

        let mut app = shortcut_mode();
        app.mode = Mode::Prompt {
            kind: PromptKind::NewWorkspace,
            input: String::new(),
        };
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        ended_after(&mut app, "the new pane prompt");

        let mut app = shortcut_mode();
        let t = app.focused().unwrap();
        app.menu_do(menu::Act::Split(t, crate::layout::Dir::Right));
        ended_after(&mut app, "the pane menu's split");
    }

    #[test]
    fn opening_a_project_ends_shortcut_mode_whether_it_starts_a_session_or_not() {
        let mut app = shortcut_mode();
        let running = app
            .screen_model()
            .iter()
            .find(|p| p.sessions().next().is_some())
            .map(|p| p.path.clone())
            .unwrap();
        app.screen_open_project(running);
        ended_after(&mut app, "a project already running");
        let mut app = shortcut_mode();
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        let fresh = std::env::temp_dir().join(format!(
            "{APP_COMMAND}-fresh-project-{}",
            std::process::id()
        ));
        app.screen_open_project(fresh);
        assert!(
            sent(&mut rx)
                .iter()
                .any(|c| matches!(c, Command::NewWorkspace { .. })),
            "a new project starts a shell"
        );
        ended_after(&mut app, "a new project");
    }

    #[test]
    fn the_shell_that_replaces_the_last_closed_session_keeps_shortcut_mode() {
        let mut app = shortcut_mode();
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.screen.last_focus = app.focused();
        let mut gone = app.snap.clone();
        (gone.terms, gone.workspaces, gone.active_ws) = (Default::default(), Vec::new(), None);
        app.on_server(ServerMsg::State(gone));
        assert!(
            sent(&mut rx)
                .iter()
                .any(|c| matches!(c, Command::NewWorkspace { cmd: None, .. })),
            "a home shell takes the last session's place"
        );
        assert!(
            matches!(app.mode, Mode::Prefix { .. }) && app.shortcut_held,
            "nobody asked for it: shortcut mode stays"
        );
    }

    #[test]
    fn a_popup_takes_the_keys_and_closing_it_goes_back_to_shortcut_mode() {
        let mut app = shortcut_mode();
        tap(&mut app, 'i');
        assert!(
            matches!(app.mode, Mode::GoTo { .. }),
            "the Inbox has the keys"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            matches!(app.mode, Mode::Prefix { acted: true, .. }),
            "closed: shortcut mode is back"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            matches!(app.mode, Mode::Normal),
            "a second Esc goes back to typing"
        );
    }

    #[test]
    fn a_click_leaves_shortcut_mode_even_under_a_popup() {
        let mut app = shortcut_mode();
        tap(&mut app, 'i');
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        });
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(
            matches!(app.mode, Mode::Normal),
            "after a click, closing the popup goes back to typing"
        );
    }

    /// The mode bar's row on `buf`, and its words.
    fn bar_text(app: &App, buf: &ratatui::buffer::Buffer) -> (Rect, String) {
        let row = screen::mode_bar_row(app, buf.area);
        let text = (row.x..row.right())
            .flat_map(|x| buf[(x, row.y)].symbol().chars().next())
            .collect();
        (row, text)
    }

    /// The mode bar's tag unless typing: `keys` while lit, else the name of what has the
    /// keys (`settings`, `files`, …), and its chip's ground, drawn at 160×45.
    fn shortcut_tag(app: &mut App) -> Option<(String, ratatui::style::Color)> {
        let buf = drawn(app, 160, 45);
        if !screen::bar_has_words(app) {
            return None;
        }
        let (row, text) = bar_text(app, &buf);
        let tag = text.trim().split("  ").next().unwrap_or_default();
        (tag != "pane").then(|| (tag.into(), buf[(row.x + 2, row.y)].bg))
    }

    /// Something other than the panes with the keys, reached as a user would where a key or
    /// action gets there; `held` starts from shortcut mode, else from typing.
    const WHO: [(&str, bool, &str); 34] = [
        (
            "check page first time",
            false,
            "SETTINGS  · type a command · Enter edit · Ctrl+S save · Tab section · Esc close",
        ),
        (
            "check page no project",
            false,
            "SETTINGS  · Tab section · Esc close",
        ),
        (
            "project check",
            false,
            "CHECK SETTINGS  · Ctrl+S save · ↑↓ move · r run now · Esc cancel",
        ),
        (
            "project check first time",
            false,
            "CHECK SETTINGS  · type a command · Enter edit · Ctrl+S save · Esc cancel",
        ),
        (
            "check page",
            false,
            "SETTINGS  · ↑↓ move · Enter edit · Ctrl+S save · r run now · Del remove · Tab section · Esc close",
        ),
        (
            "check page timeout",
            false,
            "SETTINGS  · ↑↓ move · ←→ change · Ctrl+S save · r run now · Del remove · Tab section · Esc close",
        ),
        (
            "check page typing",
            false,
            "SETTINGS  · type a command · Enter done · Ctrl+S save · Tab section · Esc close",
        ),
        (
            "project check typing",
            false,
            "CHECK SETTINGS  · type a command · Enter done · Ctrl+S save · Esc cancel",
        ),
        (
            "inbox merge",
            true,
            "INBOX  · Enter merge · shortcut mode waits · Esc don't",
        ),
        (
            "inbox throw away",
            true,
            "INBOX  · Enter throw away · shortcut mode waits · Esc don't",
        ),
        (
            "settings capture",
            false,
            "SETTINGS  · press the new key · Esc cancel",
        ),
        (
            "settings edit",
            false,
            "SETTINGS  · type · Enter save · Esc cancel",
        ),
        (
            "copy",
            false,
            "COPY  · v select · y copy · / search · Esc leave",
        ),
        (
            "copy search",
            false,
            "COPY  · type to search · Enter find · Esc cancel",
        ),
        ("copy selection", false, "COPY  · y copy · J copy as one line · Esc clear"),
        (
            "key map step",
            true,
            "KEY MAP  · a letter picks · ↑↓ choose · Enter run · Backspace back · Esc close",
        ),
        (
            "folder for a setting",
            false,
            "OPEN FOLDER  · type a path · Tab complete · Enter open · Esc back",
        ),
        (
            "sidebar",
            true,
            "SIDEBAR  · ↑↓ move · Enter open · n new · shortcut mode waits · Esc back",
        ),
        (
            "sidebar",
            false,
            "SIDEBAR  · ↑↓ move · Enter open · n new · Esc back",
        ),
        (
            "settings",
            true,
            "SETTINGS  · ↑↓ page · Enter open · shortcut mode waits · Esc close",
        ),
        (
            "settings",
            false,
            "SETTINGS  · ↑↓ page · Enter open · Esc close",
        ),
        (
            "files",
            true,
            "FILES  · / filter · i edit · Enter insert path · shortcut mode waits · Esc close",
        ),
        (
            "files",
            false,
            "FILES  · / filter · i edit · Enter insert path · Esc close",
        ),
        (
            "inbox",
            true,
            "INBOX  · ↑↓ select · y yes · a session · n no · Enter open · shortcut mode waits · Esc close",
        ),
        (
            "changes",
            true,
            "CHANGES  · ↑↓ file · space pick · m message · ctrl+enter commit · p PR · shortcut mode waits · Esc close",
        ),
        (
            "changes",
            false,
            "CHANGES  · ↑↓ file · space pick · m message · ctrl+enter commit · p PR · Esc close",
        ),
        (
            "branch",
            true,
            "BRANCH  · ↑↓ choose · Enter open · shortcut mode waits · Esc close",
        ),
        (
            "key map search",
            true,
            "PALETTE  · type to search · ↑↓ move · Enter run · Esc close",
        ),
        (
            "confirm",
            true,
            "CONFIRM  · y yes · shortcut mode waits · n no",
        ),
        ("confirm", false, "CONFIRM  · y yes · n no"),
        (
            "prompt",
            true,
            "NAME  · type · Enter save · shortcut mode waits · Esc cancel",
        ),
        ("prompt", false, "NAME  · type · Enter save · Esc cancel"),
        (
            "compose",
            true,
            "MESSAGE  · Enter send · Shift+Enter new line · shortcut mode waits · Esc keep draft",
        ),
        (
            "compose",
            false,
            "MESSAGE  · Enter send · Shift+Enter new line · Esc keep draft",
        ),
    ];

    /// The project Settings' Check page edits: the active workspace's repository.
    fn settings_project(app: &App) -> PathBuf {
        let ws = app.snap.active().expect("a workspace");
        ws.git
            .as_ref()
            .map_or_else(|| ws.cwd.clone(), |g| g.root.clone())
    }

    /// `app` with `what` holding the keys, from shortcut mode when `held`.
    fn give_keys(app: &mut App, what: &str, held: bool) {
        app.cfg.ui.which_key = false;
        let leader = |app: &mut App, c: char| {
            app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
            tap(app, c);
        };
        match (what, held) {
            ("sidebar", true) => {
                app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
                app.on_key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
            }
            ("sidebar", false) => app.mode = Mode::Side,
            ("settings", true) => leader(app, ','),
            ("settings", false) => app.act(Action::Settings),
            ("files", true) => leader(app, 'f'),
            ("files", false) => app.act(Action::Files),
            ("inbox", _) => leader(app, 'i'),
            ("changes", _) => {
                if held {
                    leader(app, 'b');
                    app.mode = Mode::Normal;
                }
                app.show_view(View::Changes(Box::new(views::ChangesView {
                    extra: Default::default(),
                    dir: PathBuf::from("/repo"),
                    review: None,
                    error: None,
                    agent: String::new(),
                    said: String::new(),
                    term: None,
                    ws: None,
                    reviewed: Default::default(),
                    linked: false,
                    confirm: None,
                })));
            }
            ("branch", _) => leader(app, 'v'),
            ("key map search", _) => {
                leader(app, 'b');
                app.mode =
                    Mode::KeyMap(Box::new(screen::KeyMap::new(screen::KeyView::Search, None)));
            }
            // Closing several panes at once is the one close that still asks.
            ("confirm", true) => {
                leader(app, 'b');
                app.menu_act(menu::Act::End(vec![ClientTerm::local(1), ClientTerm::local(2)]));
            }
            ("confirm", false) => {
                app.menu_act(menu::Act::End(vec![ClientTerm::local(1), ClientTerm::local(2)]))
            }
            ("prompt", true) => {
                leader(app, 'b');
                app.act(Action::RenameTab);
            }
            ("prompt", false) => app.act(Action::RenameTab),
            ("compose", true) => {
                app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
                app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            }
            ("compose", false) => app.act(Action::Message),
            ("inbox merge" | "inbox throw away", _) => {
                give_keys(app, "inbox", true);
                let term = *app.snap.terms.keys().next().expect("a session");
                app.screen.inbox_confirm =
                    Some((ClientTerm::local(term), what == "inbox merge", false));
            }
            ("settings capture" | "settings edit", _) => {
                app.act(Action::Settings);
                let Mode::ScreenSettings(v) = &mut app.mode else {
                    panic!("Settings is open")
                };
                if what == "settings capture" {
                    v.capturing = true;
                } else {
                    v.editing = Some(String::new());
                }
            }
            ("copy" | "copy search" | "copy selection", _) => {
                let term = app.focused().expect("a pane");
                assert!(app.enter_copy(term), "copy mode");
                let Mode::Copy(c) = &mut app.mode else {
                    panic!("copy mode")
                };
                match what {
                    "copy search" => c.input = Some(String::new()),
                    "copy selection" => c.anchor = Some(c.cur),
                    _ => {}
                }
            }
            ("key map step", _) => {
                leader(app, 'b');
                app.mode = Mode::KeyMap(Box::new(screen::KeyMap::new(
                    screen::KeyView::Map,
                    Some(screen::Step::Worktrees),
                )));
            }
            ("folder for a setting", _) => {
                let mut fd = screen::Finder::new(&PathBuf::from("."));
                fd.for_setting = Some("start.folder");
                app.mode = Mode::Finder(Box::new(fd));
            }
            (
                "check page"
                | "check page timeout"
                | "check page typing"
                | "check page first time"
                | "check page no project",
                _,
            ) => {
                use crate::client::modal::Cat;
                use screen::check_settings::{CheckDraft, DraftRow};
                let project = settings_project(app);
                if what != "check page first time" {
                    app.cfg.check = vec![crate::config::CheckDef {
                        project: project.clone(),
                        name: None,
                        command: "cargo test".into(),
                        timeout_s: 600,
                    }];
                }
                app.act(Action::Settings);
                let Mode::ScreenSettings(v) = &mut app.mode else {
                    panic!("Settings is open")
                };
                v.cat = Cat::ALL
                    .iter()
                    .position(|c| *c == Cat::Check)
                    .expect("a Check page");
                v.in_rows = true;
                let draft = CheckDraft::new(project);
                app.screen.check_page = match what {
                    "check page timeout" => Some(CheckDraft {
                        row: DraftRow::Timeout,
                        ..draft
                    }),
                    "check page typing" => Some(CheckDraft {
                        editing: true,
                        ..draft
                    }),
                    _ => None,
                };
                if what == "check page no project" {
                    app.snap.active_ws = None;
                }
            }
            ("project check" | "project check first time" | "project check typing", _) => {
                let project = settings_project(app);
                if what == "project check" {
                    app.cfg.check = vec![crate::config::CheckDef {
                        project: project.clone(),
                        name: None,
                        command: "cargo test".into(),
                        timeout_s: 600,
                    }];
                }
                let draft = screen::check_settings::CheckDraft::new(project);
                app.mode = Mode::ProjectCheck(Box::new(screen::check_settings::CheckDraft {
                    editing: what == "project check typing",
                    ..draft
                }));
            }
            _ => unreachable!("{what}"),
        }
    }

    #[test]
    fn a_click_on_the_bar_under_whatever_has_the_keys_does_nothing() {
        for (what, held, _) in WHO {
            let (mut app, _rx) = super::check_settings_tests::app_with_channel();
            give_keys(&mut app, what, held);
            let buf = drawn(&mut app, 160, 45);
            let row = screen::mode_bar_row(&app, buf.area);
            // A click anywhere leaves shortcut mode and the sidebar (as before this bar); what
            // must hold is the popup or view and what was typed in it.
            let keeps = app.mode != Mode::Side;
            let before = (
                std::mem::discriminant(&app.mode),
                app.view.as_ref().map(std::mem::discriminant),
            );
            for x in [row.x + 3, row.x + row.width / 2, row.right() - 2] {
                let at = format!("{what} held {held} at {x}");
                let words_only =
                    app.shortcut_held || !matches!(app.mode, Mode::Normal | Mode::Side);
                let hit = app
                    .hits
                    .iter()
                    .rev()
                    .find(|(r, _)| r.contains(Position::new(x, row.y)))
                    .map(|(_, h)| *h);
                if words_only {
                    assert_eq!(
                        hit,
                        Some(Hit::Screen(screen::ScreenHit::Noop)),
                        "{at}: an indicator only"
                    );
                } else {
                    assert_eq!(hit, None, "{at}: no click on its words");
                }
                if !keeps {
                    break;
                }
                click_at(&mut app, x, row.y);
                let after = (
                    std::mem::discriminant(&app.mode),
                    app.view.as_ref().map(std::mem::discriminant),
                );
                assert_eq!(after, before, "{at}: the keys stay where they were");
                drawn(&mut app, 160, 45);
            }
        }
    }

    /// Background work closing whatever popup is open, with no key pressed.
    fn close_by_itself(app: &mut App) {
        app.on_bg(Bg::Then(Box::new(|app: &mut App| app.mode = Mode::Normal)));
    }

    #[test]
    fn shortcut_mode_returns_when_a_popup_closes_by_itself() {
        let mut app = shortcut_mode();
        tap(&mut app, 'i');
        assert!(
            matches!(app.mode, Mode::GoTo { .. }),
            "the Inbox has the keys"
        );
        close_by_itself(&mut app);
        assert!(
            matches!(app.mode, Mode::Prefix { acted: true, .. }),
            "back at once: {:?}",
            std::mem::discriminant(&app.mode)
        );
        assert_eq!(
            shortcut_tag(&mut app),
            Some(("keys".into(), app.theme.blocked)),
            "and the pill lit"
        );
    }

    /// A key shortcut mode has no action for: every lower-case letter is a leader key now, so a
    /// capital or a digit.
    fn dead_letter(app: &App) -> char {
        ('a'..='z')
            .chain('A'..='Z')
            .chain('0'..='9')
            .find(|c| {
                !app.keymap
                    .prefixed
                    .contains_key(&KeySpec::from_event(&KeyEvent::new(
                        KeyCode::Char(*c),
                        KeyModifiers::NONE,
                    )))
            })
            .expect("an unbound letter")
    }

    fn notice(app: &App) -> Option<String> {
        app.notice.as_ref().map(|(title, ..)| title.clone())
    }

    #[test]
    fn the_dead_key_hint_shows_once_while_keys_are_mashed() {
        let mut app = shortcut_mode();
        let dead = dead_letter(&app);
        tap(&mut app, dead);
        let first = app.notice.as_ref().map(|(_, at, _)| *at);
        tap(&mut app, dead);
        assert_eq!(
            app.notice.as_ref().map(|(_, at, _)| *at),
            first,
            "a second key doesn't restart it"
        );
        app.notice = None;
        tap(&mut app, dead);
        assert_eq!(notice(&app), None, "nor bring it back soon after");
        app.dead_key_hint = Some(crate::clock::ago(std::time::Duration::from_secs(7)));
        tap(&mut app, dead);
        assert_eq!(
            notice(&app).as_deref(),
            Some("Shortcut mode — Esc to type"),
            "a while later, it says so again"
        );
    }

    #[test]
    fn a_dead_key_does_not_cover_another_toast() {
        let mut app = shortcut_mode();
        app.notify("worktree created".into(), false);
        let dead = dead_letter(&app);
        tap(&mut app, dead);
        assert_eq!(notice(&app).as_deref(), Some("worktree created"));
    }

    #[test]
    fn a_bound_key_in_shortcut_mode_shows_no_hint() {
        let mut app = shortcut_mode();
        tap(&mut app, 'b');
        assert_eq!(notice(&app), None, "b toggled the sidebar quietly");
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        let dead = dead_letter(&app);
        tap(&mut app, dead);
        assert_eq!(notice(&app), None, "typing: the key went to the pane");
    }

    #[test]
    fn shortcut_mode_returns_when_a_server_message_closes_a_popup() {
        let mut app = shortcut_mode();
        tap(&mut app, 'i');
        app.mode = Mode::Normal;
        let snap = app.snap.clone();
        app.on_server(ServerMsg::State(snap));
        assert!(
            matches!(app.mode, Mode::Prefix { acted: true, .. }),
            "back with the message: {:?}",
            std::mem::discriminant(&app.mode)
        );
        assert_eq!(
            shortcut_tag(&mut app),
            Some(("keys".into(), app.theme.blocked)),
            "and the pill lit"
        );
    }

    #[test]
    fn a_popup_closing_by_itself_does_not_bring_back_a_mode_you_left() {
        let mut app = shortcut_mode();
        tap(&mut app, 'i');
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        });
        close_by_itself(&mut app);
        assert_eq!(app.mode, Mode::Normal, "a click left it");
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        close_by_itself(&mut app);
        assert_eq!(app.mode, Mode::Normal, "Esc left it");
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        close_by_itself(&mut app);
        assert_eq!(app.mode, Mode::Normal, "the leader left it");
    }

    /// The window in one look, padding and sidebar, in shortcut mode, at 160×45.
    fn framed_app(layout: &str, padding: &str, side: &str) -> App {
        let mut app = shortcut_mode();
        (app.cfg.ui.layout, app.cfg.ui.padding, app.cfg.ui.motion) =
            (layout.into(), padding.into(), false);
        app.cfg.ui.fold_retired_layout();
        match side {
            "right" => app.cfg.ui.sidebar_position = "right".into(),
            "hidden" => app.sidebar = false,
            _ => {}
        }
        app
    }

    const LOOKS: [&str; 3] = ["floating", "tiled", "grid"];
    const SIDES: [&str; 3] = ["left", "right", "hidden"];

    fn buf_text(buf: &ratatui::buffer::Buffer) -> String {
        (0..buf.area.height)
            .map(|y| {
                (0..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
                    + "\n"
            })
            .collect()
    }

    /// `app` put in `mode`: typing, lit (after the leader) or held (why open from it).
    fn into_mode(app: &mut App, mode: &str) {
        app.cfg.ui.which_key = false;
        if mode != "typing" {
            app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        }
        if mode == "held" {
            hold(app);
        }
    }

    /// What the bar starts with in each mode.
    fn bar_words(mode: &str) -> &'static str {
        match mode {
            "typing" => "pane",
            "lit" => "keys",
            _ => "message",
        }
    }

    /// Where `words` sits on the mode bar.
    fn on_bar(app: &App, buf: &ratatui::buffer::Buffer, words: &str) -> Option<u16> {
        let row = screen::mode_bar_row(app, buf.area);
        last_at(buf, words, row.y, row.x, row.right() + 1)
    }

    /// Where `words` first starts on the mode bar: its chip, not a hint that says the same word.
    fn first_on_bar(app: &App, buf: &ratatui::buffer::Buffer, words: &str) -> Option<u16> {
        let row = screen::mode_bar_row(app, buf.area);
        let n = words.chars().count() as u16;
        (row.x..row.right().saturating_sub(n))
            .find(|&x| (0..n).map(|i| buf[(x + i, row.y)].symbol()).collect::<String>() == words)
    }

    fn click_at(app: &mut App, x: u16, y: u16) {
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: x,
            row: y,
            modifiers: KeyModifiers::NONE,
        });
    }

    #[test]
    fn the_mode_bar_holds_in_every_look_sidebar_padding_rounding_and_size() {
        use crate::config::Rounding;
        let mut failures = Vec::new();
        for layout in LOOKS {
            for side in SIDES {
                for padding in ["small", "medium", "large"] {
                    for rounded in [Rounding::Off, Rounding::Corners, Rounding::Full] {
                        for (w, h) in [(80, 24), (120, 36), (200, 50)] {
                            for mode in ["typing", "lit", "held"] {
                                let mut app = framed_app(layout, padding, side);
                                app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
                                app.cfg.ui.rounded = rounded;
                                into_mode(&mut app, mode);
                                let buf = drawn(&mut app, w, h);
                                let at = format!(
                                    "{layout} {side} padding {padding} {rounded:?} {w}x{h} {mode}"
                                );
                                let (row, bar) = bar_text(&app, &buf);
                                let (rows, cols): (u16, u16) = match padding {
                                    "small" => (0, 0),
                                    "medium" => (1, 2),
                                    _ => (2, 4),
                                };
                                if (row.x, row.y, row.width) != (cols, h - 1 - rows, w - 2 * cols) {
                                    failures.push(format!("{at}: the bar at {row:?}"));
                                }
                                let plain = |s: &str| {
                                    s.replace(screen::CAP_L, " ")
                                        .replace(screen::CAP_R, " ")
                                        .split_whitespace()
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                };
                                if !plain(&bar).starts_with(&plain(bar_words(mode))) {
                                    failures.push(format!("{at}: {bar}"));
                                }
                                let cards = app
                                    .pane_frames
                                    .iter()
                                    .map(|(_, r)| *r)
                                    .chain([app.screen.side_rect, app.screen.sheet_rect]);
                                if cards.into_iter().any(|r| r.intersects(row)) {
                                    failures.push(format!("{at}: a card reaches the bar"));
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("\n"));
    }

    /// The key mode hints in the order they are dropped last to first; `esc back` goes last.
    const SUGGESTED: [&str; 6] = [
        "n new",
        "s split",
        "x close",
        "tab pane",
        "? help",
        "esc back",
    ];

    #[test]
    fn the_lit_bar_suggests_keys_from_the_keymap() {
        let mut app = shortcut_mode();
        let buf = drawn(&mut app, 160, 45);
        let (_, bar) = bar_text(&app, &buf);
        let at: Vec<usize> = SUGGESTED
            .iter()
            .map(|s| bar.find(s).unwrap_or_else(|| panic!("{s}: {bar}")))
            .collect();
        assert!(at.is_sorted(), "in order: {bar}");
        app.cfg.keys.prefix.insert("s".into(), "none".into());
        app.cfg.keys.prefix.insert("w".into(), "split-right".into());
        app.keymap = app.cfg.keymap();
        let buf = drawn(&mut app, 160, 45);
        let (_, bar) = bar_text(&app, &buf);
        assert!(
            bar.contains("w split") && !bar.contains("s split"),
            "the rebound key: {bar}"
        );
        let key = on_bar(&app, &buf, "w split").expect("w split");
        let y = screen::mode_bar_row(&app, buf.area).y;
        let bold = |x: u16| {
            buf[(x, y)]
                .modifier
                .contains(ratatui::style::Modifier::BOLD)
        };
        assert!(
            bold(key) && !bold(key + 2),
            "the key in bold, its label plain"
        );
        app.cfg.keys.prefix.insert("w".into(), "none".into());
        app.keymap = app.cfg.keymap();
        let buf = drawn(&mut app, 160, 45);
        let (_, bar) = bar_text(&app, &buf);
        assert!(
            !bar.contains("split"),
            "an unbound action is not suggested: {bar}"
        );
    }

    #[test]
    fn a_click_on_a_suggestion_presses_its_key_in_shortcut_mode() {
        let mut app = shortcut_mode();
        let buf = drawn(&mut app, 160, 45);
        let y = screen::mode_bar_row(&app, buf.area).y;
        let new = on_bar(&app, &buf, "n new").expect("n new");
        click_at(&mut app, new + 2, y);
        assert_eq!(app.mode, Mode::Normal, "n starts a shell at once, so there is no dialog and the mode ends");
        let mut app = shortcut_mode();
        let buf = drawn(&mut app, 160, 45);
        let split = on_bar(&app, &buf, "s split").expect("s split");
        click_at(&mut app, split, y);
        assert_eq!(
            app.mode,
            Mode::Normal,
            "a new pane is typed into: the mode ends"
        );
        let mut app = shortcut_mode();
        let buf = drawn(&mut app, 160, 45);
        let help = on_bar(&app, &buf, "? help").expect("? help");
        click_at(&mut app, help + 3, y);
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::All),
            "? opens the keys help: {:?}",
            std::mem::discriminant(&app.mode)
        );
        let mut app = shortcut_mode();
        let buf = drawn(&mut app, 160, 45);
        let esc = on_bar(&app, &buf, "esc back").expect("esc back");
        click_at(&mut app, esc + 4, y);
        assert_eq!(app.mode, Mode::Normal, "Esc goes back to typing");
        assert_eq!(shortcut_tag(&mut app), None, "and the bar says typing");
    }

    #[test]
    fn a_click_on_typing_starts_shortcut_mode_but_not_over_a_popup() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.cfg.ui.which_key = false;
        let buf = drawn(&mut app, 160, 45);
        let y = screen::mode_bar_row(&app, buf.area).y;
        let x = screen::mode_bar_row(&app, buf.area).x + 3;
        assert!(bar_text(&app, &buf).1.trim_start().starts_with("pane"), "the pane chip is first");
        click_at(&mut app, x, y);
        assert!(
            matches!(app.mode, Mode::Prefix { .. }),
            "it starts key mode: {:?}",
            std::mem::discriminant(&app.mode)
        );
        assert_eq!(
            shortcut_tag(&mut app).map(|(tag, _)| tag).as_deref(),
            Some("keys")
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        let buf = drawn(&mut app, 160, 45);
        let x = on_bar(&app, &buf, "^space keys").expect("the hint");
        click_at(&mut app, x, y);
        assert!(matches!(app.mode, Mode::Prefix { .. }), "so does its hint");
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        app.act(Action::Settings);
        drawn(&mut app, 160, 45);
        assert!(
            !app.hits
                .iter()
                .any(|(_, h)| *h == Hit::Screen(screen::ScreenHit::ShortcutMode)),
            "under Settings, typing is only words"
        );
    }

    #[test]
    fn the_key_map_s_search_keeps_its_query_when_the_bar_is_clicked() {
        let mut app = shortcut_mode();
        app.mode = Mode::KeyMap(Box::new(screen::KeyMap {
            query: "fil".into(),
            ..screen::KeyMap::new(screen::KeyView::Search, None)
        }));
        let buf = drawn(&mut app, 160, 45);
        let (row, bar) = bar_text(&app, &buf);
        assert!(
            bar.trim().starts_with("palette") && bar.contains("type to search"),
            "the search has the keys: {bar}"
        );
        assert!(
            !app.hits.iter().any(
                |(r, h)| r.y == row.y && matches!(h, Hit::Screen(screen::ScreenHit::BarKey(_)))
            ),
            "nothing on the bar to press there"
        );
        let x = on_bar(&app, &buf, "type to search").expect("its hint");
        click_at(&mut app, x, row.y);
        assert!(
            matches!(&app.mode, Mode::KeyMap(km) if km.query == "fil"),
            "the search and its text survive: {:?}",
            std::mem::discriminant(&app.mode)
        );
        assert!(app.view.is_none(), "and Files did not open");
    }

    #[test]
    fn the_bar_takes_no_click_from_a_pane_in_any_look() {
        for layout in LOOKS {
            for mode in ["typing", "lit"] {
                let (_, mut app) = super::design_tests::render_with(160, 45);
                app.cfg.ui.layout = layout.into();
                app.cfg.ui.fold_retired_layout();
                three_panes(&mut app);
                into_mode(&mut app, mode);
                let buf = drawn(&mut app, 160, 45);
                let row = screen::mode_bar_row(&app, buf.area);
                let at = format!("{layout} {mode}");
                for (r, h) in &app.hits {
                    if r.intersects(row) {
                        assert_eq!(
                            (r.y, r.height),
                            (row.y, 1),
                            "{at}: only the bar's own hits on its row: {h:?}"
                        );
                        assert!(
                            matches!(
                                h,
                                Hit::Screen(
                                    screen::ScreenHit::BarKey(_)
                                        | screen::ScreenHit::Leader
                                        | screen::ScreenHit::ShortcutMode
                                )
                            ),
                            "{at}: {h:?}"
                        );
                    }
                }
                let lowest = app.panes.iter().map(|(_, r)| r.bottom()).max().unwrap_or(0);
                for (term, inner) in app
                    .panes
                    .clone()
                    .into_iter()
                    .filter(|(_, r)| r.bottom() == lowest)
                {
                    let hit = app
                        .hits
                        .iter()
                        .rev()
                        .find(|(r, _)| r.contains(Position::new(inner.x, inner.bottom() - 1)))
                        .map(|(_, h)| *h);
                    assert_eq!(
                        hit,
                        Some(Hit::Pane(term)),
                        "{at}: the last row of a pane above the bar is still the pane's"
                    );
                }
            }
        }
    }

    #[test]
    fn every_bar_chip_follows_the_rounding_and_its_click_covers_it() {
        use crate::config::Rounding;
        use screen::ScreenHit as S;
        type SetUp = fn(&mut App);
        let states: [(&str, Option<S>, SetUp); 3] = [
            ("pane", Some(S::ShortcutMode), |app| {
                app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
            }),
            ("keys", Some(S::Leader), |_| {}),
            ("inbox", None, |app| tap(app, 'i')),
        ];
        for (words, kind, set_up) in states {
            for rounded in [Rounding::Off, Rounding::Corners, Rounding::Full] {
                let mut app = shortcut_mode();
                app.cfg.ui.rounded = rounded;
                set_up(&mut app);
                let at = format!("{words} {rounded:?}");
                let buf = drawn(&mut app, 160, 45);
                let y = screen::mode_bar_row(&app, buf.area).y;
                let caps = u16::from(rounded == Rounding::Full);
                let n = words.chars().count() as u16;
                let start = first_on_bar(&app, &buf, words).unwrap_or_else(|| panic!("the chip: {at}"));
                let r = Rect {
                    x: start - 1 - caps,
                    y,
                    width: n + 2 + 2 * caps,
                    height: 1,
                };
                match kind {
                    Some(kind) => {
                        let click = app
                            .hits
                            .iter()
                            .rev()
                            .find(|(h, k)| {
                                h.contains(Position::new(start, y)) && *k == Hit::Screen(kind)
                            })
                            .map(|(h, _)| *h);
                        assert_eq!(click, Some(r), "the click covers the whole chip: {at}");
                    }
                    None => assert!(
                        app.hits
                            .iter()
                            .rev()
                            .find(|(h, _)| h.contains(Position::new(start, y)))
                            .is_some_and(|(_, k)| *k == Hit::Screen(S::Noop)),
                        "an indicator: {at}"
                    ),
                }
                let (l, e, inside) = (
                    &buf[(r.x, y)],
                    &buf[(r.right() - 1, y)],
                    buf[(r.x + 1, y)].bg,
                );
                if caps == 1 {
                    assert_eq!(
                        (l.symbol(), e.symbol()),
                        (screen::CAP_L, screen::CAP_R),
                        "pill: {at}"
                    );
                } else {
                    assert_eq!(
                        (l.symbol(), l.bg, e.symbol(), e.bg),
                        (" ", inside, " ", inside),
                        "square: {at}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_click_on_the_bar_under_a_message_keeps_it_and_what_was_typed() {
        let mut app = shortcut_mode();
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(
            matches!(app.mode, Mode::Compose(_)),
            "Enter opened the message box: {:?}",
            std::mem::discriminant(&app.mode)
        );
        for c in "hold on".chars() {
            tap(&mut app, c);
        }
        assert_eq!(
            shortcut_tag(&mut app).map(|(w, _)| w),
            Some("message".into())
        );
        let buf = drawn(&mut app, 160, 45);
        let x = on_bar(&app, &buf, "message").expect("the tag");
        let y = screen::mode_bar_row(&app, buf.area).y;
        click_at(&mut app, x + 2, y);
        assert!(
            matches!(&app.mode, Mode::Compose(c) if c.text == "hold on"),
            "the draft survives: {:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn the_sheet_s_close_stays_clickable_while_held() {
        let (mut app, _rx) = super::check_settings_tests::app_with_channel();
        app.cfg.ui.which_key = false;
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        tap(&mut app, 'f');
        assert!(matches!(app.view, Some(View::Files(_))), "f opened Files");
        let buf = drawn(&mut app, 160, 45);
        let sheet = app.screen.sheet_rect;
        let close = (sheet.x..sheet.right())
            .rev()
            .find(|&x| buf[(x, sheet.y)].symbol() == "✕")
            .expect("the panel's ✕");
        assert!(close + 5 >= sheet.right(), "at the corner");
        click_at(&mut app, close, sheet.y);
        assert!(app.view.is_none(), "a click on it closes Files");
    }

    #[test]
    fn the_key_map_opens_on_a_pause_only_before_the_first_shortcut() {
        let mut app = shortcut_mode();
        app.cfg.ui.which_key = true;
        app.mode = Mode::Prefix {
            since: crate::clock::ago(std::time::Duration::from_secs(10)),
            acted: false,
        };
        let unbound = dead_letter(&app);
        tap(&mut app, unbound);
        assert!(
            matches!(app.mode, Mode::KeyMap(_)),
            "before any shortcut, a letter with the map up searches it"
        );
        app.mode = Mode::Prefix {
            since: crate::clock::ago(std::time::Duration::from_secs(10)),
            acted: true,
        };
        tap(&mut app, unbound);
        assert!(
            matches!(app.mode, Mode::Prefix { .. }),
            "after one, the mode just stays"
        );
        assert!(
            !draw(&mut app, 160, 45).contains("SEARCH"),
            "and no key map covers the screen"
        );
    }

    #[test]
    fn a_click_into_a_pane_goes_back_to_typing() {
        let mut app = shortcut_mode();
        draw(&mut app, 160, 45);
        let (_, inner) = *app.panes.first().expect("a pane on screen");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: inner.x + 2,
            row: inner.y + 2,
            modifiers: KeyModifiers::NONE,
        });
        assert!(
            matches!(app.mode, Mode::Normal),
            "{:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn every_popup_fits_a_tiny_window() {
        use crate::layout::Dir;
        let actions = [
            Action::Palette,
            Action::Help,
            Action::Settings,
            Action::Jump,
            Action::Files,
            Action::Find(0),
            Action::Find(1),
            Action::Changes,
            Action::Branches,
            Action::History,
            Action::RenameWorkspace,
            Action::BrowseTree,
            Action::SplitRight,
            Action::Focus(Dir::Left),
        ];
        for (w, h) in [(20, 6), (1, 1), (80, 3), (40, 10), (40, 15), (60, 12)] {
            for a in &actions {
                let (_, mut app) = super::design_tests::render_with(160, 45);
                app.act(a.clone());
                let _ = draw(&mut app, w, h);
                // And a right-click menu, and a question.
                app.mode = Mode::Normal;
                app.menu_for_session(
                    ClientTerm::local(1),
                    (w.saturating_sub(1), h.saturating_sub(1)),
                );
                let _ = draw(&mut app, w, h);
                app.menu_act(menu::Act::End(vec![ClientTerm::local(1)]));
                let _ = draw(&mut app, w, h);
            }
        }
    }

    #[test]
    fn options_come_from_the_screen() {
        let mut p = vt100::Parser::new(10, 60, 0);
        p.process(b"Question: use WebKit or Safari?\r\n  1. WebKit build\r\n  2. Safari driver");
        assert_eq!(
            screen::options(Some(&p)),
            vec!["WebKit build".to_string(), "Safari driver".to_string()]
        );
        assert_eq!(screen::options(None), vec!["Yes", "Always", "No"]);
    }
}

#[cfg(test)]
mod settings_v8_tests {
    use super::*;
    use crate::client::modal::Cat;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn draw(app: &mut App, w: u16, h: u16) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let frame: String = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        frame.replace(|c| ('\u{e000}'..='\u{f8ff}').contains(&c), "")
    }

    fn open(app: &mut App, cat: Cat, sel: usize) {
        let cat = Cat::ALL.iter().position(|c| *c == cat).unwrap();
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat,
            sel,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
    }

    fn row_of(cat: Cat, label: &str) -> usize {
        design::settings_rows(cat)
            .iter()
            .position(|r| match r {
                design::SRow::Setting(s) => s.label == label,
                design::SRow::Agent(a) => a.label() == label,
                _ => false,
            })
            .unwrap_or_else(|| panic!("{label} is on the page"))
    }

    #[test]
    fn an_old_config_with_team_keys_still_opens_settings() {
        let cfg: Config = toml::from_str("[team]\nfamily = \"codex\"\n").unwrap();
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.cfg = cfg;
        open(&mut app, Cat::Agents, 0);
        assert!(!draw(&mut app, 160, 45).contains("TEAM"));
    }

    #[test]
    fn no_label_is_wider_than_the_label_column_and_every_help_fits_two_lines() {
        for s in modal::SETTINGS {
            assert!(
                s.label.chars().count() <= usize::from(screen::SETTINGS_LABEL_COLS),
                "{} is too long for the label column",
                s.label
            );
            let lines = screen::wrap_two(s.help, 64);
            assert!(
                lines.len() <= 2 && !lines.iter().any(|l| l.ends_with('…')),
                "{}: help needs more than two lines: {:?}",
                s.path,
                lines
            );
        }
    }

    #[test]
    fn switching_dark_or_light_is_a_search_only_command_with_no_default_key() {
        assert_eq!(
            Action::ToggleAppearance.to_config().as_deref(),
            Some("toggle-appearance")
        );
        let (_, app) = super::design_tests::render_with(160, 45);
        assert!(
            app.palette_commands().contains(&Action::ToggleAppearance),
            "it is in the key overlay's search"
        );
        assert!(
            !crate::keys::DEFAULT_PREFIX_KEYS
                .iter()
                .chain(crate::keys::DEFAULT_GLOBAL_KEYS)
                .any(|(_, action)| *action == "toggle-appearance"),
            "and has no key of its own"
        );
    }

    #[test]
    fn the_codex_row_says_when_its_hooks_still_need_your_trust() {
        use maitty_provider_codex::HooksState;
        let (_, mut app) = super::design_tests::render_with(160, 45);
        open(&mut app, Cat::Agents, 0);
        for (state, want) in [
            (None, "checking…"),
            (
                Some(HooksState::NeedsTrust),
                "hooks installed · trust them in Codex /hooks",
            ),
            (Some(HooksState::Trusted), "✓ hooks installed and trusted"),
        ] {
            app.codex_hooks = state;
            let o = draw(&mut app, 160, 45);
            assert!(o.contains(want), "{state:?} reads {want}: {o}");
        }
    }

    #[test]
    fn agents_page_shows_status_and_the_subagent_toggle_and_set_up_opens_the_list() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.codex_hooks = Some(maitty_provider_codex::HooksState::NotInstalled);
        open(&mut app, Cat::Agents, 0);
        let o = draw(&mut app, 160, 45);
        for want in [
            "AGENT STATUS",
            "Claude Code",
            "Codex",
            "✓ read from the process and screen",
            "Connect agents…",
            "HELPERS",
            "Sessions may start helpers",
            "Subagents in the sidebar",
            "LIMITS",
        ] {
            assert!(o.contains(want), "Agents shows {want}: {o}");
        }
        // Further down, past the fold at this size.
        assert!(
            design::settings_rows(Cat::Agents)
                .iter()
                .any(|r| design::settings_group(r) == "AGENTS TALKING TO AGENTS"),
            "agents talking to agents is on the page"
        );
        app.claude_hooks = Some(true);
        let o = draw(&mut app, 160, 45);
        super::check_settings_tests::show(&o);
        assert!(o.contains("✓ hooks installed"));
        open(&mut app, Cat::Agents, row_of(Cat::Agents, "Codex"));
        let o = draw(&mut app, 160, 45);
        super::check_settings_tests::show(&o);
        assert!(
            o.contains("Connect agents installs them") && !o.contains("No hooks needed"),
            "Codex's help is true: {o}"
        );
        open(
            &mut app,
            Cat::Agents,
            row_of(Cat::Agents, "Connect agents…"),
        );
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(
            !matches!(app.mode, Mode::ScreenSettings(_)),
            "the Connect agents list opened"
        );
    }

    #[test]
    fn connect_agents_lists_every_status_integration_and_each_one_installs() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        app.act(Action::AgentStatusSetup);
        let o = draw(&mut app, 160, 45);
        super::check_settings_tests::show(&o);
        let Mode::ScreenMenu(menu) = &app.mode else {
            panic!("Connect agents opens a menu")
        };
        let labels: Vec<&str> = menu.items.iter().map(|(label, _)| label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "Connect Claude Code",
                "Connect Codex",
                "Connect Gemini CLI",
                "Connect Qwen Code",
                "Connect OpenCode",
                "Connect Pi",
                "Connect OMP",
                "Connect Kilo",
                "Connect Kimi",
                "Connect Mastra Code",
            ]
        );
        for (label, act) in &menu.items {
            assert!(o.contains(label.as_str()), "{label} is on screen: {o}");
            let menu::Act::InstallStatus(agent) = act else {
                panic!("{label} installs a status integration")
            };
            assert!(
                crate::cli::integrations::status_installer(agent).is_ok(),
                "{label}: the installer accepts {agent}"
            );
        }
    }

    #[test]
    fn labels_show_whole_at_80_by_24() {
        let (_, mut app) = super::design_tests::render_with(80, 24);
        for (cat, label) in [
            (Cat::General, "Alt+arrows move between panes"),
            (Cat::General, "Leader waits for next key"),
            (Cat::Agents, "Sessions may start helpers"),
            (Cat::General, "Restore chats when Maiker starts"),
            (Cat::Alerts, "Phone: say what it's doing"),
            (Cat::Agents, "Subagents in the sidebar"),
        ] {
            open(&mut app, cat, row_of(cat, label));
            let o = draw(&mut app, 80, 24);
            assert!(o.contains(label), "{label} is whole at 80x24: {o}");
            let help = modal::SETTINGS
                .iter()
                .find(|s| s.label == label)
                .unwrap()
                .help;
            assert!(
                help.split_whitespace().all(|w| o.contains(w)),
                "its help is whole at 80x24: {o}"
            );
        }
    }
}

mod shots {
    //! Not a check: writes the screens the README shows, cell by cell, for the image step.
    //! `<APP>_SHOTS=<dir> cargo test write_the_readme_screens -- --ignored`
    use super::design_tests::render_with;
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    fn cells(app: &mut App, w: u16, h: u16, name: &str, dir: &std::path::Path) {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let mut rows = Vec::new();
        for y in 0..h {
            let row: Vec<serde_json::Value> = (0..w)
                .map(|x| {
                    let c = &buf[(x, y)];
                    let col = |c: ratatui::style::Color| match c {
                        ratatui::style::Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
                        _ => String::new(),
                    };
                    serde_json::json!([
                        c.symbol(),
                        col(c.fg),
                        col(c.bg),
                        c.modifier.contains(ratatui::style::Modifier::BOLD)
                    ])
                })
                .collect();
            rows.push(row);
        }
        std::fs::write(
            dir.join(format!("{name}.json")),
            serde_json::to_string(&rows).unwrap(),
        )
        .unwrap();
    }

    #[test]
    #[ignore]
    fn write_the_readme_screens() {
        let dir = std::path::PathBuf::from(
            maitty_shared::brand::env_var("SHOTS").expect(concat!(
                "set ",
                env!("APP_ENV"),
                "_SHOTS"
            )),
        );
        std::fs::create_dir_all(&dir).unwrap();
        let (_, mut app) = render_with(160, 45);
        cells(&mut app, 160, 45, "02-main", &dir);
        // The agent beside a shell in the same tab.
        let (_, mut app) = render_with(160, 45);
        let mut split = crate::layout::Node::Leaf(1);
        split.split(1, crate::layout::Dir::Right, 3);
        app.screen.tabs[0].layout = split;
        app.screen.tabs[0].focus = ClientTerm::local(1);
        cells(&mut app, 160, 45, "05-split", &dir);
        let (_, mut app) = render_with(160, 45);
        app.mode = Mode::GoTo {
            query: String::new(),
            sel: 0,
        };
        cells(&mut app, 160, 45, "03-go-to", &dir);
        let (_, mut app) = render_with(160, 45);
        app.mode = Mode::Actions { sel: 0 };
        cells(&mut app, 160, 45, "04-palette", &dir);
        let (_, mut app) = render_with(160, 45);
        app.act(crate::keys::Action::Settings);
        cells(&mut app, 160, 45, "07-settings", &dir);
        let (_, mut app) = render_with(160, 45);
        app.open_keymap(None);
        cells(&mut app, 160, 45, "06-keys", &dir);
        let (_, mut app) = render_with(160, 45);
        app.splash = true;
        cells(&mut app, 160, 45, "01-splash", &dir);
    }
}

mod check_row_tests {
    use super::*;
    use crate::layout::Node;
    use crate::protocol::{CheckInfo, CheckState};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;

    const SIZES: [(u16, u16); 3] = [(80, 24), (100, 30), (160, 45)];
    /// (ui.layout, ui.panes): Cards floating and Cards tiled, as older files wrote them.
    const LAYOUTS: [(&str, &str); 2] = [("cards", "floating"), ("cards", "tiled")];
    const NAME: &str = "t-row";
    const COMMAND: &str = "just ci";

    struct Case {
        state: CheckState,
        exit: Option<i32>,
    }

    /// Each state's glyph (Unicode, ASCII) and the start of its line, short enough for the
    /// 80-column sidebar.
    const CASES: [Case; 8] = [
        Case {
            state: CheckState::Checking,
            exit: None,
        },
        Case {
            state: CheckState::Passed,
            exit: Some(0),
        },
        Case {
            state: CheckState::Failed,
            exit: Some(1),
        },
        Case {
            state: CheckState::Overridden,
            exit: Some(1),
        },
        Case {
            state: CheckState::CouldNotRun,
            exit: Some(127),
        },
        Case {
            state: CheckState::Stale,
            exit: Some(0),
        },
        Case {
            state: CheckState::Never,
            exit: None,
        },
        Case {
            state: CheckState::NeedsApproval,
            exit: None,
        },
    ];

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn info(state: CheckState, exit: Option<i32>) -> CheckInfo {
        CheckInfo {
            name: "ci".into(),
            command: COMMAND.into(),
            state,
            exit_code: exit,
            started_at: now() - 180,
            duration_ms: 14_200,
            ..Default::default()
        }
    }

    /// The shop-api scene plus one finished agent per entry of `extra`, each with its check.
    fn scene(
        w: u16,
        h: u16,
        layout: (&str, &str),
        extra: &[(&str, Status, Option<CheckInfo>)],
    ) -> App {
        let (_, mut app) = super::design_tests::render_with(w, h);
        (app.cfg.ui.layout, app.cfg.ui.panes) = (layout.0.into(), layout.1.into());
        app.cfg.ui.fold_retired_layout();
        for (i, (label, status, check)) in extra.iter().enumerate() {
            let id = 20 + i as TermId;
            let mut t = app.snap.terms[&2].clone();
            (t.id, t.label, t.status, t.checks) = (
                id,
                (*label).into(),
                *status,
                check.clone().into_iter().collect(),
            );
            app.snap.terms.insert(id, t);
            app.snap.workspaces[0].tabs.push(TabInfo {
                id: 30 + id,
                name: String::new(),
                layout: Node::Leaf(id),
                focus: id,
            });
            app.parsers
                .insert(ClientTerm::local(id), vt100::Parser::new(20, 80, 0));
        }
        app.screen.tabs.clear();
        app.screen.last_focus = None;
        app.screen_sync();
        app.screen.cursor = None;
        app
    }

    fn one(w: u16, h: u16, layout: (&str, &str), c: &Case) -> App {
        scene(
            w,
            h,
            layout,
            &[(NAME, Status::Done, Some(info(c.state, c.exit)))],
        )
    }

    fn render(app: &mut App, w: u16, h: u16) -> ratatui::buffer::Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        // The sessions a test adds sit below the reference world's in the Local half, which only
        // holds a few cards at small sizes: scroll until one of them is on screen.
        let added: Vec<String> = app
            .snap
            .terms
            .values()
            .filter(|t| t.id >= 20)
            .map(|t| t.label.clone())
            .take(1)
            .collect();
        app.screen.side_scroll = 0;
        loop {
            term.draw(|f| render::draw(app, f)).unwrap();
            let buf = term.backend().buffer().clone();
            let r = app.screen.side_rect;
            let text =
                |y: u16| -> String { (r.x..r.right()).map(|x| buf[(x, y)].symbol()).collect() };
            let seen = (r.y..r.bottom().saturating_sub(3)).any(|y| {
                added.iter().any(|n| text(y).contains(n.as_str()))
                    && !text(y + 1).contains("REMOTE")
                    && !text(y + 1).contains("REMOTE")
            });
            if seen || added.is_empty() || app.screen.side_scroll > 60 {
                return buf;
            }
            app.screen.side_scroll += 3;
        }
    }

    fn show(buf: &Buffer, title: &str) {
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("--- {title}");
            for y in 0..buf.area.height {
                println!(
                    "{}",
                    (0..buf.area.width)
                        .map(|x| buf[(x, y)].symbol())
                        .collect::<String>()
                        .trim_end()
                );
            }
        }
    }

    fn label(layout: (&str, &str), w: u16, h: u16) -> String {
        format!("{}/{} {w}x{h}", layout.0, layout.1)
    }

    /// The home screen's counters line.
    fn away_line(buf: &Buffer) -> String {
        let rows = (0..buf.area.height).map(|y| {
            (0..buf.area.width)
                .map(|x| buf[(x, y)].symbol())
                .collect::<String>()
        });
        rows.map(|r| r.trim().to_string())
            .find(|r| r.contains("need you") && r.contains("still working"))
            .expect("the counters line")
    }

    fn splash_line(
        w: u16,
        h: u16,
        layout: (&str, &str),
        extra: &[(&str, Status, Option<CheckInfo>)],
    ) -> String {
        let mut app = scene(w, h, layout, extra);
        app.splash = true;
        // The wide splash counts in chips; the counters line is the compact one's.
        let buf = render(&mut app, w.min(139), h);
        show(&buf, &format!("splash {}", label(layout, w, h)));
        away_line(&buf)
    }

    #[test]
    fn the_home_counters_do_not_call_a_checking_or_failed_session_finished() {
        let extra = [
            (
                "t-failed",
                Status::Done,
                Some(info(CheckState::Failed, Some(1))),
            ),
            (
                "t-running",
                Status::Done,
                Some(info(CheckState::Checking, None)),
            ),
            (
                "t-passed",
                Status::Done,
                Some(info(CheckState::Passed, Some(0))),
            ),
            ("t-plain", Status::Done, None),
        ];
        for layout in LAYOUTS {
            for (w, h) in SIZES {
                let line = splash_line(w, h, layout, &extra);
                let at = format!("{}: {line}", label(layout, w, h));
                assert!(
                    line.contains("2 finished"),
                    "only the passed and the unchecked finished: {at}"
                );
                assert!(line.contains("1 check failed"), "{at}");
                assert!(
                    line.contains("1 need you") && line.contains("1 still working"),
                    "{at}"
                );
                assert!(
                    unicode_width::UnicodeWidthStr::width(line.as_str()) <= w as usize,
                    "{at}"
                );
            }
        }
    }

    #[test]
    fn the_home_counters_count_an_approval_as_needs_you_and_stale_or_never_as_finished() {
        let extra = [
            (
                "t-approve",
                Status::Done,
                Some(info(CheckState::NeedsApproval, None)),
            ),
            (
                "t-stale",
                Status::Done,
                Some(info(CheckState::Stale, Some(0))),
            ),
            ("t-never", Status::Done, Some(info(CheckState::Never, None))),
        ];
        for layout in LAYOUTS {
            let line = splash_line(160, 45, layout, &extra);
            assert!(
                line.contains("2 need you")
                    && line.contains("2 finished")
                    && !line.contains("check"),
                "{}: {line}",
                label(layout, 160, 45)
            );
        }
    }

    #[test]
    fn a_running_check_keeps_the_redraw_tick_going() {
        let mut app = one(160, 45, LAYOUTS[0], &CASES[0]);
        assert!(app.any_checking(), "a check in progress animates its ring");
        for c in &CASES[1..] {
            app = one(160, 45, LAYOUTS[0], c);
            assert!(
                !app.any_checking(),
                "{:?} is finished and needs no tick",
                c.state
            );
        }
        assert!(!scene(160, 45, LAYOUTS[0], &[(NAME, Status::Done, None)]).any_checking());
    }
}

mod check_sheet_tests {
    use super::*;
    use crate::protocol::{CheckInfo, CheckState, Query, Reply};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;

    const SIZES: [(u16, u16); 3] = [(80, 24), (100, 30), (160, 45)];
    const TERM: TermId = 1;
    const PANE: ClientTerm = ClientTerm::local(TERM);
    const SHEET_W: u16 = 72;
    const SHORT_OUTPUT: &str = "✓ renders the footer\n✓ links resolve\n✗ keeps the sticky footer\nError: expected 3 got 2\n";

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn check(state: CheckState, exit_code: Option<i32>) -> CheckInfo {
        CheckInfo {
            command: "npm test".into(),
            state,
            exit_code,
            started_at: now() - 600,
            duration_ms: 14_200,
            after_turn_ended_at: now() - 620,
            first_failing_line: "Error: expected 3 got 2".into(),
            ..Default::default()
        }
    }

    type Layout = fn(&mut App);

    fn layouts() -> [(&'static str, Layout); 2] {
        [
            ("cards floating", |a| a.cfg.ui.panes = "floating".into()),
            ("cards tiled", |a| a.cfg.ui.gap = "0".into()),
        ]
    }

    /// Session 1 finished, with `check`; its sheet open and its output arrived.
    fn open(w: u16, h: u16, layout: Layout, info: CheckInfo, output: Option<&str>) -> App {
        let (_, mut app) = super::design_tests::render_with(w, h);
        layout(&mut app);
        let term = app.snap.terms.get_mut(&TERM).unwrap();
        (term.status, term.said, term.checks) = (Status::Done, "tests pass".into(), vec![info]);
        app.screen_sync();
        app.open_check_sheet(PANE);
        if let Some(text) = output {
            app.on_server(ServerMsg::Reply(Reply::Text(text.into())));
        }
        app
    }

    fn render(app: &mut App, w: u16, h: u16) -> ratatui::buffer::Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    fn frame(buf: &Buffer) -> String {
        let a = buf.area;
        let text: String = (0..a.height)
            .map(|y| {
                (0..a.width)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        // Keycap edges are private-use glyphs a reader doesn't see.
        text.replace(|c| ('\u{e000}'..='\u{f8ff}').contains(&c), "")
    }

    fn draw(app: &mut App, w: u16, h: u16) -> String {
        let o = frame(&render(app, w, h));
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("{o}");
        }
        o
    }

    /// Flat pads keycaps with spaces where cards use edge glyphs.
    fn words(o: &str) -> String {
        o.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// Only the sheet's columns, read top to bottom, so a line it wrapped reads whole and the
    /// sidebar beside it does not interleave.
    fn sheet_words(app: &mut App, w: u16, h: u16) -> String {
        let o = draw(app, w, h);
        let g = screen::grid(app, Rect::new(0, 0, w, h));
        let cols: String = o
            .lines()
            .map(|l| {
                l.chars()
                    .skip(g.sheet.x as usize)
                    .take(g.sheet.width as usize)
                    .collect::<String>()
                    + "\n"
            })
            .collect();
        words(&cols.replace(['▕', '▏', '▁', '▔', '│', '┃', '▎'], " "))
    }

    fn press(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<ClientMsg> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect()
    }

    fn long_output(n: usize) -> String {
        (1..=n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn a_long_checkpoint_name_truncates_the_sheet_title_once_in_every_layout_at_every_size() {
        let checkpoint = "echo start; then echo ok; echo more output here; and keep going until the line is far wider than the sheet";
        for (name, layout) in layouts() {
            for (w, h) in SIZES {
                let at = format!("{name} {w}x{h}");
                let mut info = check(CheckState::Failed, Some(1));
                info.name = checkpoint.into();
                let mut app = open(w, h, layout, info, Some(SHORT_OUTPUT));
                let o = draw(&mut app, w, h);
                let g = screen::grid(&app, Rect::new(0, 0, w, h));
                let header = o
                    .lines()
                    .map(|l| {
                        l.chars()
                            .skip(g.sheet.x as usize)
                            .take(g.sheet.width as usize)
                            .collect::<String>()
                    })
                    .find(|l| l.contains("CHECK"))
                    .unwrap_or_else(|| panic!("{at}: no title row in\n{o}"));
                let (head, tail) = header.split_once('…').unwrap_or_else(|| {
                    panic!("{at}: the title is cut, so it ends in …: {header:?}")
                });
                assert!(
                    head.contains("· claude › echo start;"),
                    "{at}: the checkpoint's start follows the session: {header:?}"
                );
                assert!(!tail.contains('…'), "{at}: one ellipsis: {header:?}");
                let edge = |c: char| c == ' ' || "─╮┐".contains(c);
                assert!(
                    tail.trim_matches(edge) == "×",
                    "{at}: only the close follows the ellipsis, got {tail:?} in {header:?}"
                );
            }
        }
    }

    #[test]
    fn long_output_shows_the_tail_that_fits_and_f_opens_all_of_it() {
        for (name, layout) in layouts() {
            for (w, h) in SIZES {
                let at = format!("{name} {w}x{h}");
                let mut app = open(
                    w,
                    h,
                    layout,
                    check(CheckState::Failed, Some(1)),
                    Some(&long_output(200)),
                );
                let o = draw(&mut app, w, h);
                let text = sheet_words(&mut app, w, h);
                assert!(
                    text.contains("of 200 lines")
                        && text.contains("last ")
                        && text.contains("f full output"),
                    "{at}: the tail header in\n{o}"
                );
                assert!(
                    text.contains("200 line 200"),
                    "{at}: the end is shown, numbered"
                );
                assert!(!text.contains(" 1 line 1 "), "{at}: the start is not");
                press(&mut app, KeyCode::Char('f'));
                let full = draw(&mut app, w, h);
                assert!(
                    words(&full).contains("1 line 1 "),
                    "{at}: f shows from the top:\n{full}"
                );
                assert!(!words(&full).contains("200 line 200"), "{at}: and scrolls");
                assert!(
                    sheet_words(&mut app, w, h).contains("lines 1–"),
                    "{at}: it says which lines"
                );
                press(&mut app, KeyCode::PageDown);
                press(&mut app, KeyCode::Down);
                let moved = draw(&mut app, w, h);
                assert!(
                    !words(&moved).contains(" 1 line 1 "),
                    "{at}: ↓ and PageDown scroll"
                );
                assert!(moved.contains('▲'), "{at}: more above once scrolled");
                press(&mut app, KeyCode::Up);
                press(&mut app, KeyCode::PageUp);
                assert!(
                    sheet_words(&mut app, w, h).contains("1 line 1 "),
                    "{at}: ↑ and PageUp come back"
                );
                for _ in 0..40 {
                    press(&mut app, KeyCode::PageDown);
                }
                assert!(
                    sheet_words(&mut app, w, h).contains("200 line 200"),
                    "{at}: scrolling stops at the end"
                );
                press(&mut app, KeyCode::Char('f'));
                assert!(
                    sheet_words(&mut app, w, h).contains("last "),
                    "{at}: f again is the tail"
                );
            }
        }
    }

    #[test]
    fn an_arrow_on_the_tail_scrolls_from_where_the_tail_starts() {
        let mut app = open(
            100,
            30,
            |_| {},
            check(CheckState::Failed, Some(1)),
            Some(&long_output(200)),
        );
        draw(&mut app, 100, 30);
        press(&mut app, KeyCode::Up);
        let o = sheet_words(&mut app, 100, 30);
        assert!(
            o.contains("200 line 200") || o.contains("199 line 199"),
            "one line up from the tail still shows nearly the end: {o}"
        );
        assert!(!o.contains(" 1 line 1 "));
    }

    #[test]
    fn could_not_run_says_it_is_not_a_test_failure() {
        for (name, layout) in layouts() {
            for (w, h) in SIZES {
                let mut info = check(CheckState::CouldNotRun, Some(127));
                info.command = "pnpm test".into();
                let mut app = open(w, h, layout, info, Some("sh: pnpm: not found\n"));
                let text = sheet_words(&mut app, w, h);
                for want in [
                    "? could not run",
                    "exit 127",
                    "command not found",
                    "Not a test failure.",
                    "Fix the command in settings",
                    "sh: pnpm: not found",
                ] {
                    assert!(
                        text.contains(want),
                        "{name} {w}x{h}: missing {want:?} in {text}"
                    );
                }
                if w >= 100 {
                    for want in [
                        "Not a test failure. The work hasn't been checked.",
                        "install pnpm, then r.",
                    ] {
                        assert!(
                            text.contains(want),
                            "{name} {w}x{h}: missing {want:?} in {text}"
                        );
                    }
                }
                assert!(
                    !text.contains("× failed") && !text.contains("Override… O"),
                    "{name} {w}x{h}"
                );
            }
        }
    }

    #[test]
    fn the_sheet_takes_the_pane_column_below_140_columns_and_is_72_wide_beside() {
        for (name, layout) in layouts() {
            let sheet = |w: u16, h: u16| {
                let mut app = open(
                    w,
                    h,
                    layout,
                    check(CheckState::Failed, Some(1)),
                    Some(SHORT_OUTPUT),
                );
                draw(&mut app, w, h);
                let g = screen::grid(&app, Rect::new(0, 0, w, h));
                (g.sheet.width, g.panes.width)
            };
            let (narrow, left) = sheet(100, 30);
            assert!(
                narrow > 0 && left == 0,
                "{name}: at 100 columns the sheet is the pane column"
            );
            assert_eq!(sheet(160, 45).0, SHEET_W, "{name}");
            assert_eq!(sheet(200, 50).0, SHEET_W, "{name}");
            let mut app = open(
                100,
                30,
                layout,
                check(CheckState::Failed, Some(1)),
                Some(SHORT_OUTPUT),
            );
            draw(&mut app, 100, 30);
            press(&mut app, KeyCode::Esc);
            assert!(app.view.is_none(), "{name}: Esc returns");
            let g = screen::grid(&app, Rect::new(0, 0, 100, 30));
            assert!(
                g.sheet.width == 0 && g.panes.width > 0,
                "{name}: the panes are back"
            );
        }
    }

    #[test]
    fn a_key_the_sheet_does_not_offer_leaves_it_as_it_is() {
        let mut app = open(
            160,
            45,
            |_| {},
            check(CheckState::Failed, Some(1)),
            Some(&long_output(100)),
        );
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        draw(&mut app, 160, 45);
        for c in ['u', 'x', 'z'] {
            press(&mut app, KeyCode::Char(c));
            assert!(
                matches!(app.view, Some(View::Check(_))) && app.mode == Mode::Normal,
                "{c} leaves the sheet as it is"
            );
        }
        assert!(sent(&mut rx).is_empty(), "and sends nothing");
        press(&mut app, KeyCode::Esc);
        assert!(app.view.is_none());
    }

    #[test]
    fn every_button_and_the_close_are_clickable() {
        let mut info = check(CheckState::Failed, Some(1));
        info.line_count = 1284;
        let mut app = open(160, 45, |_| {}, info, Some(&long_output(100)));
        draw(&mut app, 160, 45);
        let has = |app: &App, h: Hit| app.hits.iter().any(|(_, x)| *x == h);
        for key in ['r', 'O', 'o', 'f'] {
            assert!(
                has(&app, Hit::Button(Btn::ViewKey(key))),
                "{key} is a button"
            );
        }
        assert!(
            has(&app, Hit::Screen(screen::ScreenHit::ViewClose)),
            "the ✕"
        );
        app.on_button(Hit::Button(Btn::ViewKey('f')), false);
        assert!(
            sheet_words(&mut app, 160, 45).contains("1185 line 1 "),
            "clicking full output opens it, numbered as the whole"
        );
        app.on_hy_hit(screen::ScreenHit::ViewClose, false);
        assert!(app.view.is_none());
    }

    #[test]
    fn the_buttons_follow_the_result() {
        let buttons = |state, code| {
            let mut app = open(160, 45, |_| {}, check(state, code), Some(SHORT_OUTPUT));
            draw(&mut app, 160, 45);
            [
                ('r', Btn::ViewKey('r')),
                ('O', Btn::ViewKey('O')),
                ('u', Btn::ViewKey('u')),
            ]
            .map(|(_, b)| app.hits.iter().any(|(_, x)| *x == Hit::Button(b)))
        };
        assert_eq!(buttons(CheckState::Failed, Some(1)), [true, true, false]);
        assert_eq!(
            buttons(CheckState::Overridden, Some(1)),
            [true, false, true]
        );
        assert_eq!(
            buttons(CheckState::CouldNotRun, Some(127)),
            [true, false, false]
        );
        assert_eq!(buttons(CheckState::Passed, Some(0)), [true, false, false]);
    }

    #[test]
    fn opening_asks_the_daemon_for_the_output_and_a_new_run_asks_again() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        let term = app.snap.terms.get_mut(&TERM).unwrap();
        (term.status, term.checks) = (Status::Done, vec![check(CheckState::Failed, Some(1))]);
        app.open_check_sheet(PANE);
        let asks = |rx: &mut mpsc::UnboundedReceiver<Outgoing>| {
            sent(rx)
                .into_iter()
                .filter(|m| {
                    matches!(
                        m,
                        ClientMsg::Query(Query::CheckOutput {
                            term: TERM,
                            name: None
                        })
                    )
                })
                .count()
        };
        assert_eq!(asks(&mut rx), 1, "one query on open");
        app.on_server(ServerMsg::Reply(Reply::Text("first run\n".into())));
        assert!(
            matches!(&app.view, Some(View::Check(v)) if v.output.as_deref() == Some("first run\n"))
        );
        let mut next = app.snap.clone();
        let again = next
            .terms
            .get_mut(&TERM)
            .unwrap()
            .checks
            .first_mut()
            .unwrap();
        (again.started_at, again.exit_code) = (now(), Some(2));
        app.on_server(ServerMsg::State(next.clone()));
        assert!(
            matches!(&app.view, Some(View::Check(v)) if v.output.is_none()),
            "the old output is about an older run"
        );
        assert_eq!(asks(&mut rx), 1, "so it asks again");
        app.on_server(ServerMsg::State(next));
        assert_eq!(asks(&mut rx), 0, "an unchanged snapshot asks nothing");
    }

    #[test]
    fn the_sheet_closes_when_its_check_goes_away() {
        let mut app = open(
            160,
            45,
            |_| {},
            check(CheckState::Failed, Some(1)),
            Some(SHORT_OUTPUT),
        );
        let mut next = app.snap.clone();
        next.terms.get_mut(&TERM).unwrap().checks.clear();
        app.on_server(ServerMsg::State(next));
        assert!(app.view.is_none());
    }

    fn enter_on_row(state: Option<CheckState>, status: Status) -> App {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        let term = app.snap.terms.get_mut(&TERM).unwrap();
        (term.status, term.checks) = (
            status,
            state.map(|s| check(s, Some(1))).into_iter().collect(),
        );
        app.screen_sync();
        draw(&mut app, 160, 45);
        app.mode = Mode::Side;
        app.screen.cursor = Some(ClientSession::local(SessionKey::Pane(TERM)));
        press(&mut app, KeyCode::Enter);
        app
    }

    #[test]
    fn enter_opens_the_sheet_only_for_a_result_that_needs_a_look() {
        for state in [
            CheckState::Failed,
            CheckState::CouldNotRun,
            CheckState::Overridden,
        ] {
            let app = enter_on_row(Some(state), Status::Done);
            assert!(
                matches!(&app.view, Some(View::Check(v)) if v.term == PANE),
                "{state:?} opens the sheet"
            );
        }
        for state in [None, Some(CheckState::Passed), Some(CheckState::Checking)] {
            let app = enter_on_row(state, Status::Done);
            assert!(app.view.is_none(), "{state:?} focuses the session as today");
        }
        let working = enter_on_row(Some(CheckState::Failed), Status::Working);
        assert!(
            working.view.is_none(),
            "an old result under a working agent is not shown, so not opened"
        );
    }

    #[test]
    fn what_a_command_printed_cannot_restyle_or_move_the_screen() {
        let mut app = open(
            160,
            45,
            |_| {},
            check(CheckState::Failed, Some(1)),
            Some(
                "\x1b[31mred\x1b[0m text\x1b]0;title\x07\nprogress 10%\rprogress 100%\n\x1b[2J\x07bell\tTab\n",
            ),
        );
        let buf = render(&mut app, 160, 45);
        let o = frame(&buf);
        assert!(
            !o.contains('\u{1b}') && !o.contains('\u{7}') && !o.contains('\r'),
            "no control character reaches the screen"
        );
        let text = sheet_words(&mut app, 160, 45);
        assert!(
            text.contains("1 red text 2")
                && text.contains("2 progress 100%")
                && text.contains("3 bell Tab"),
            "{text}"
        );
        assert!(
            !text.contains("title")
                && !text.contains("10%")
                && !text.contains("[31m")
                && !text.contains("[2J"),
            "{text}"
        );
    }
}

mod check_inbox_tests {
    use super::*;
    use crate::layout::Node;
    use crate::protocol::{CheckInfo, CheckState};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;

    const SIZES: [(u16, u16); 3] = [(80, 24), (100, 30), (160, 45)];
    /// (ui.layout, ui.panes): Cards floating and Cards tiled, as older files wrote them.
    const LAYOUTS: [(&str, &str); 2] = [("cards", "floating"), ("cards", "tiled")];
    const COMMAND: &str = "just ci";
    const FAILING_LINE: &str = "FAIL footer.test.ts";
    const QUESTION: &str = "Run npm test -- checkout?";
    const FAILED: &str = "FAILED CHECKS";
    const NOT_RUN: &str = "COULD NOT RUN";
    const FINISHED: &str = "FINISHED";

    type Extra = (&'static str, Status, Option<CheckInfo>);

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    fn info(state: CheckState, exit: Option<i32>) -> CheckInfo {
        let first_failing_line = if state == CheckState::Failed {
            FAILING_LINE.into()
        } else {
            String::new()
        };
        CheckInfo {
            command: COMMAND.into(),
            state,
            exit_code: exit,
            started_at: now() - 180,
            duration_ms: 14_200,
            first_failing_line,
            ..Default::default()
        }
    }

    fn failed() -> Option<CheckInfo> {
        Some(info(CheckState::Failed, Some(1)))
    }

    fn not_run() -> Option<CheckInfo> {
        Some(info(CheckState::CouldNotRun, Some(127)))
    }

    /// The shop-api scene (claude asks) plus one agent per entry of `extra`, from term 20 up.
    fn scene(w: u16, h: u16, layout: (&str, &str), extra: &[Extra]) -> App {
        let (_, mut app) = super::design_tests::render_with(w, h);
        (app.cfg.ui.layout, app.cfg.ui.panes) = (layout.0.into(), layout.1.into());
        app.cfg.ui.fold_retired_layout();
        for (i, (label, status, check)) in extra.iter().enumerate() {
            let id = 20 + i as TermId;
            let mut t = app.snap.terms[&2].clone();
            (t.id, t.label, t.status, t.checks) = (
                id,
                (*label).into(),
                *status,
                check.clone().into_iter().collect(),
            );
            app.snap.terms.insert(id, t);
            app.snap.workspaces[0].tabs.push(TabInfo {
                id: 30 + id,
                name: String::new(),
                layout: Node::Leaf(id),
                focus: id,
            });
            app.parsers
                .insert(ClientTerm::local(id), vt100::Parser::new(20, 80, 0));
        }
        app.screen.tabs.clear();
        app.screen.last_focus = None;
        app.screen_sync();
        app.screen.cursor = None;
        app
    }

    fn buffer(app: &mut App, w: u16, h: u16) -> ratatui::buffer::Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    /// One string per screen line, keycap edge glyphs removed, columns from `from` on.
    fn lines(buf: &Buffer, from: u16) -> Vec<String> {
        (0..buf.area.height)
            .map(|y| {
                (from..buf.area.width)
                    .map(|x| buf[(x, y)].symbol())
                    .collect::<String>()
                    .replace(|c| ('\u{e000}'..='\u{f8ff}').contains(&c), "")
                    .trim_end()
                    .to_string()
            })
            .collect()
    }

    fn inbox(app: &mut App, w: u16, h: u16) -> Vec<String> {
        app.act(Action::Jump);
        let buf = buffer(app, w, h);
        // The Inbox only: the sidebar beside it lists the same sessions.
        let out = lines(&buf, app.screen.side_rect.right());
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!(
                "--- {w}x{h} {}/{}\n{}",
                app.cfg.ui.layout,
                app.cfg.ui.panes,
                out.join("\n")
            );
        }
        out
    }

    fn at(frame: &[String], needle: &str) -> Option<usize> {
        frame.iter().position(|l| l.contains(needle))
    }

    fn rows(app: &App) -> Vec<screen::GoRow> {
        screen::goto_rows(&app.screen_model(), "", 0)
    }

    fn heads(rows: &[screen::GoRow]) -> Vec<&'static str> {
        rows.iter()
            .filter_map(|r| {
                if let screen::GoRow::Head(h) = r {
                    Some(*h)
                } else {
                    None
                }
            })
            .collect()
    }

    fn label(layout: (&str, &str), w: u16, h: u16) -> String {
        format!("{}/{} {w}x{h}", layout.0, layout.1)
    }

    #[test]
    fn groups_come_in_order_and_a_failed_check_is_never_finished() {
        let extra: [Extra; 7] = [
            ("f-done", Status::Done, failed()),
            ("n-done", Status::Done, not_run()),
            (
                "passed",
                Status::Done,
                Some(info(CheckState::Passed, Some(0))),
            ),
            ("plain", Status::Done, None),
            (
                "overridden",
                Status::Done,
                Some(info(CheckState::Overridden, Some(1))),
            ),
            ("f-seen", Status::Idle, failed()),
            ("n-seen", Status::Idle, not_run()),
        ];
        let app = scene(160, 45, LAYOUTS[0], &extra);
        let rows = rows(&app);
        assert_eq!(heads(&rows), ["NEEDS YOU", FAILED, NOT_RUN, FINISHED]);
        use screen::GoRow::*;
        let section = |head: &str| {
            let from = rows
                .iter()
                .position(|r| matches!(r, Head(h) if *h == head))
                .unwrap()
                + 1;
            rows[from..]
                .iter()
                .take_while(|r| !matches!(r, Head(_)))
                .cloned()
                .collect::<Vec<_>>()
        };
        assert_eq!(section("NEEDS YOU"), [Ask(ClientTerm::local(1))]);
        assert_eq!(
            section(FAILED),
            [Failed(ClientTerm::local(20)), Failed(ClientTerm::local(25))],
            "a failure stays listed once it has been looked at"
        );
        assert_eq!(
            section(NOT_RUN),
            [NotRun(ClientTerm::local(21))],
            "unchecked work is listed until it is looked at"
        );
        assert_eq!(
            section(FINISHED),
            [
                Done(ClientTerm::local(22)),
                Done(ClientTerm::local(24)),
                Done(ClientTerm::local(23))
            ],
            "passed and overridden (checked first), then no check, still just finished"
        );
    }

    /// One row per check state of a Done session: whether it counts as finished, in the Inbox
    /// and on the home screen alike.
    fn finished_table() -> [(&'static str, Option<CheckInfo>, bool); 6] {
        [
            ("no check", None, true),
            ("checking", Some(info(CheckState::Checking, None)), false),
            ("passed", Some(info(CheckState::Passed, Some(0))), true),
            ("failed", failed(), false),
            ("could not run", not_run(), false),
            (
                "overridden",
                Some(info(CheckState::Overridden, Some(1))),
                true,
            ),
        ]
    }

    fn home_finished(app: &mut App, w: u16, h: u16) -> usize {
        app.splash = true;
        // The wide splash counts in chips; the counters line is the compact one's.
        let buf = buffer(app, w.min(139), h);
        let line = lines(&buf, 0)
            .into_iter()
            .find(|l| l.contains("need you") && l.contains("still working"))
            .expect("the counters line");
        let words: Vec<&str> = line.split_whitespace().collect();
        let at = words
            .iter()
            .position(|w| *w == "finished")
            .expect("a finished count");
        words[at - 1].parse().expect("a number")
    }

    #[test]
    fn finished_means_the_same_in_the_inbox_and_on_the_home_screen() {
        for layout in LAYOUTS {
            for (w, h) in SIZES {
                for (what, check, finished) in finished_table() {
                    let at_ = format!("{} {what}", label(layout, w, h));
                    let extra: [Extra; 1] = [("sub", Status::Done, check)];
                    let mut app = scene(w, h, layout, &extra);
                    let listed = rows(&app).contains(&screen::GoRow::Done(ClientTerm::local(20)));
                    assert_eq!(listed, finished, "{at_}: listed under JUST FINISHED");
                    inbox(&mut app, w, h);
                    let mut home = scene(w, h, layout, &extra);
                    assert_eq!(
                        home_finished(&mut home, w, h),
                        usize::from(finished),
                        "{at_}: counted on the home screen"
                    );
                }
            }
        }
    }

    #[test]
    fn a_session_the_agent_is_working_on_or_asking_about_is_not_listed_for_its_old_check() {
        let extra: [Extra; 2] = [
            ("busy", Status::Working, failed()),
            ("asks", Status::Blocked, failed()),
        ];
        let app = scene(160, 45, LAYOUTS[0], &extra);
        let rows = rows(&app);
        assert_eq!(
            heads(&rows),
            ["NEEDS YOU"],
            "the old result is about an older turn, and an empty group is left out"
        );
        assert!(
            rows.contains(&screen::GoRow::Ask(ClientTerm::local(21)))
                && !rows.iter().any(|r| matches!(r, screen::GoRow::Failed(_)))
        );
    }

    #[test]
    fn a_failed_row_shows_the_line_the_daemon_picked_from_real_output() {
        let line = maitty_core::first_failing_line("running\nFAIL tests/foo: boom\n");
        let result = CheckInfo {
            first_failing_line: line.clone(),
            ..info(CheckState::Failed, Some(1))
        };
        let (w, h) = SIZES[1];
        let mut app = scene(
            w,
            h,
            LAYOUTS[0],
            &[("fix-footer", Status::Done, Some(result))],
        );
        let frame = inbox(&mut app, w, h);
        let row = at(&frame, "× fix-footer").expect("the failed row");
        assert_eq!(line, "FAIL tests/foo: boom");
        assert!(
            frame[row + 2].contains(&line),
            "the failing line under the result: {:?}",
            frame[row + 2]
        );
    }

    #[test]
    fn a_question_is_never_pushed_below_a_failed_check() {
        let many: Vec<Extra> = ["a", "b", "c", "d", "e", "f"]
            .iter()
            .map(|n| (*n, Status::Done, failed()))
            .collect();
        for layout in LAYOUTS {
            for (w, h) in SIZES {
                let at_ = label(layout, w, h);
                let mut app = scene(w, h, layout, &many);
                let rows = rows(&app);
                let first = |p: fn(&screen::GoRow) -> bool| rows.iter().position(p).unwrap();
                assert!(
                    first(|r| matches!(r, screen::GoRow::Ask(_)))
                        < first(|r| matches!(r, screen::GoRow::Failed(_))),
                    "{at_}: rows"
                );
                let frame = inbox(&mut app, w, h);
                let (q, f) = (at(&frame, QUESTION), at(&frame, FAILED));
                assert!(
                    q.is_some() && f.is_some() && q < f,
                    "{at_}: the question is above the failures\n{}",
                    frame.join("\n")
                );
            }
        }
    }

    #[test]
    fn the_selected_row_scrolls_into_whole_view_even_when_it_is_the_last_failure() {
        let many: Vec<Extra> = ["a1", "b2", "c3", "d4", "e5", "f6"]
            .iter()
            .map(|n| (*n, Status::Done, failed()))
            .collect();
        for layout in LAYOUTS {
            let mut app = scene(80, 24, layout, &many);
            let last = rows(&app)
                .iter()
                .rposition(|r| matches!(r, screen::GoRow::Failed(_)))
                .unwrap();
            app.act(Action::Jump);
            app.mode = Mode::GoTo {
                query: String::new(),
                sel: last,
            };
            let buf = buffer(&mut app, 80, 24);
            let frame = lines(&buf, app.screen.side_rect.right());
            let row = at(&frame, "× f6").unwrap_or_else(|| {
                panic!(
                    "{}: the last failure\n{}",
                    label(layout, 80, 24),
                    frame.join("\n")
                )
            });
            assert!(
                frame[row + 1].contains("failed: just ci") && frame[row + 2].contains(FAILING_LINE),
                "{}: whole, not cut\n{}",
                label(layout, 80, 24),
                frame.join("\n")
            );
        }
    }

    #[test]
    fn empty_groups_stay_out_and_typing_still_finds_a_failure() {
        for layout in LAYOUTS {
            let at_ = label(layout, 100, 30);
            // Only a failure: nothing waits, nothing else finished.
            let mut app = scene(100, 30, layout, &[("fix-footer", Status::Done, failed())]);
            app.snap.terms.get_mut(&1).unwrap().status = Status::Idle;
            let text = inbox(&mut app, 100, 30).join("\n");
            assert!(
                text.contains("FAILED CHECKS  1"),
                "{at_}: the failure's group\n{text}"
            );
            for absent in ["NEEDS YOU", NOT_RUN, FINISHED] {
                assert!(
                    !text.contains(absent),
                    "{at_}: no group without rows: {absent}\n{text}"
                );
            }
            // A failure reached by typing is still found as a session.
            let rows = screen::goto_rows(&app.screen_model(), "fix-footer", 0);
            assert!(
                matches!(
                    rows.as_slice(),
                    [
                        screen::GoRow::Head("FOUND"),
                        screen::GoRow::Sess(_, ClientTerm { term: 20, .. })
                    ]
                ),
                "{at_}: {rows:?}"
            );
        }
    }

    #[test]
    fn up_and_down_land_on_check_rows_and_skip_their_headings() {
        let extra: [Extra; 2] = [
            ("f-one", Status::Done, failed()),
            ("n-one", Status::Done, not_run()),
        ];
        let mut app = scene(100, 30, LAYOUTS[0], &extra);
        app.act(Action::Jump);
        let Mode::GoTo { sel: start, .. } = app.mode.clone() else {
            panic!("the Inbox")
        };
        let mut seen = vec![rows(&app)[start].clone()];
        for _ in 0..2 {
            app.on_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
            let Mode::GoTo { sel, .. } = app.mode.clone() else {
                panic!("still in the Inbox")
            };
            seen.push(rows(&app)[sel].clone());
        }
        assert_eq!(
            seen,
            [
                screen::GoRow::Ask(ClientTerm::local(1)),
                screen::GoRow::Failed(ClientTerm::local(20)),
                screen::GoRow::NotRun(ClientTerm::local(21))
            ]
        );
    }
}

mod check_settings_tests {
    use super::*;
    use crate::client::screen::check_settings::{CheckEdit, step_timeout};
    use crate::config::{CHECK_TIMEOUT_S_DEFAULT, CheckDef};
    use crate::protocol::{CheckInfo, CheckState};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    pub(super) fn project() -> PathBuf {
        PathBuf::from(if cfg!(windows) {
            r"C:\code\shop-api"
        } else {
            "/code/shop-api"
        })
    }

    pub(super) fn draw(app: &mut App, w: u16, h: u16) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let frame: String = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        frame.replace(|c| ('\u{e000}'..='\u{f8ff}').contains(&c), "")
    }

    pub(super) fn show(s: &str) {
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("{s}");
        }
    }

    fn check_page() -> usize {
        modal::Cat::ALL
            .iter()
            .position(|c| *c == modal::Cat::Check)
            .unwrap()
    }

    fn open_check_page(app: &mut App, sel: usize) {
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat: check_page(),
            sel,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
    }

    fn with_check(app: &mut App, command: &str, timeout_s: u64) {
        app.cfg.check = vec![CheckDef {
            project: project(),
            name: None,
            command: command.into(),
            timeout_s,
        }];
    }

    fn result(state: CheckState, exit_code: Option<i32>) -> CheckInfo {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        CheckInfo {
            command: "npm test".into(),
            state,
            exit_code,
            started_at: now - 120,
            duration_ms: 14_200,
            ..Default::default()
        }
    }

    pub(super) fn words(o: &str) -> String {
        o.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn the_status_row_names_each_result_by_shape_and_word() {
        let cases = [
            (None, "never run"),
            (Some(result(CheckState::Passed, Some(0))), "passed"),
            (Some(result(CheckState::Failed, Some(1))), "failed"),
            (Some(result(CheckState::Checking, None)), "checking"),
            (Some(result(CheckState::Overridden, Some(1))), "overridden"),
            (
                Some(result(CheckState::CouldNotRun, Some(127))),
                "could not run",
            ),
        ];
        for (info, want) in cases {
            let (_, mut app) = super::design_tests::render_with(160, 45);
            with_check(&mut app, "npm test", CHECK_TIMEOUT_S_DEFAULT);
            app.snap.terms.get_mut(&1).unwrap().checks = info.into_iter().collect();
            open_check_page(&mut app, 0);
            let o = draw(&mut app, 160, 45);
            assert!(words(&o).contains(want), "{want}: in\n{o}");
        }
    }

    #[test]
    fn the_timeout_steps_through_round_values_and_clamps() {
        assert_eq!(step_timeout(600, 1), 900);
        assert_eq!(step_timeout(600, -1), 300);
        assert_eq!(step_timeout(30, -1), 30, "the shortest stays");
        assert_eq!(step_timeout(3600, 1), 3600, "the longest stays");
        assert_eq!(
            step_timeout(90, 1),
            120,
            "a hand-edited value steps to the next round one"
        );
        assert_eq!(step_timeout(90, -1), 60);
    }

    fn edited(before: &str, edit: CheckEdit) -> (String, crate::config::Config) {
        let mut doc: toml_edit::DocumentMut = before.parse().unwrap();
        edit.apply(&mut doc).unwrap();
        let out = doc.to_string();
        let cfg: crate::config::Config = toml::from_str(&out).unwrap();
        (out, cfg)
    }

    fn set(command: &str, timeout_s: u64) -> CheckEdit {
        CheckEdit::Set {
            project: project(),
            name: Some("test".into()),
            command: command.into(),
            timeout_s,
        }
    }

    #[test]
    fn saving_a_check_writes_its_table_in_place_and_keeps_the_comments() {
        let before = "# my notes\ntheme = \"tokyo-night\"\n\n[ui]\n# my ui notes\nsidebar = true\n";
        let (out, cfg) = edited(before, set("npm test", 600));
        assert!(
            out.contains("# my notes") && out.contains("# my ui notes"),
            "{out}"
        );
        assert!(out.contains("[[check]]"), "{out}");
        assert_eq!(
            cfg.check,
            vec![CheckDef {
                project: project(),
                name: None,
                command: "npm test".into(),
                timeout_s: 600
            }]
        );

        let with_note = format!(
            "{out}\n# why this one\n[[check]]\nproject = \"/code/lib\"\ncommand = \"cargo test\"\n"
        );
        let (out, cfg) = edited(&with_note, set("pnpm test", 900));
        assert!(
            out.contains("# why this one") && out.contains("# my notes"),
            "{out}"
        );
        assert_eq!(
            cfg.check.len(),
            2,
            "the same project is updated, not added twice: {out}"
        );
        let mine = cfg
            .check
            .iter()
            .find(|c| crate::config::same_path(&c.project, &project()))
            .unwrap();
        assert_eq!((mine.command.as_str(), mine.timeout_s), ("pnpm test", 900));
        assert!(
            cfg.check.iter().any(|c| c.command == "cargo test"),
            "the other project is untouched"
        );
    }

    #[test]
    fn removing_a_check_deletes_only_its_table() {
        let two = "# top\n[[check]]\nproject = \"/code/lib\"\ncommand = \"cargo test\"\n\n[[check]]\nproject = \"/code/shop-api\"\ncommand = \"npm test\"\n";
        let two = two.replace(
            "/code/shop-api",
            &project().to_string_lossy().replace('\\', "\\\\"),
        );
        let remove = |project: PathBuf| CheckEdit::Remove {
            project,
            name: "test".into(),
        };
        let (out, cfg) = edited(&two, remove(project()));
        assert!(out.contains("# top"), "{out}");
        assert_eq!(cfg.check.len(), 1);
        assert_eq!(cfg.check[0].command, "cargo test");
        let (out, cfg) = edited(&out, remove(PathBuf::from("/code/lib")));
        assert!(
            cfg.check.is_empty() && !out.contains("check"),
            "the last one takes the key with it: {out}"
        );
        let (_, cfg) = edited("theme = \"tokyo-night\"\n", remove(project()));
        assert!(cfg.check.is_empty(), "removing what is not there is fine");
    }

    #[test]
    fn a_check_list_written_another_way_is_refused_not_overwritten() {
        let mut doc: toml_edit::DocumentMut = "check = 3\n".parse().unwrap();
        assert!(set("npm test", 600).apply(&mut doc).is_err());
    }

    pub(super) fn app_with_channel() -> (App, mpsc::UnboundedReceiver<Outgoing>) {
        let (_, mut app) = super::design_tests::render_with(100, 30);
        let (tx, rx) = mpsc::unbounded_channel();
        app.out = tx;
        (app, rx)
    }

    #[test]
    fn a_done_pane_is_marked_seen_only_while_a_focused_window_shows_it() {
        use crate::protocol::{ClientMsg, Command, Status};
        let (mut app, mut rx) = app_with_channel();
        let front = app.focused().expect("a pane is in front");
        app.snap.terms.get_mut(&front.term).unwrap().status = Status::Done;
        let mut marked = |app: &mut App| {
            app.mark_looked_pane_seen();
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).any(|m| {
                matches!(m, ClientMsg::Command(Command::MarkSeen { term }) if term == front.term)
            })
        };
        app.window_focused = false;
        let away = marked(&mut app);
        app.window_focused = true;
        let looking = marked(&mut app);
        app.snap.terms.get_mut(&front.term).unwrap().status = Status::Working;
        let working = marked(&mut app);
        assert!(!away, "a window in the background is not looking");
        assert!(looking, "a focused window showing a done pane has seen it");
        assert!(!working, "only a done pane is marked");
    }

    #[test]
    fn reloading_agents_restarts_the_idle_ones_that_missed_their_hooks_and_leaves_a_working_one() {
        use crate::protocol::{ClientMsg, Command, Status};
        let (mut app, mut rx) = app_with_channel();
        let front = app.focused().expect("a pane is in front").term;
        let template = app.snap.terms[&front].clone();
        for (id, status) in [(front, Status::Idle), (901, Status::Working)] {
            let mut t = template.clone();
            (t.id, t.agent, t.hooked, t.status) = (id, Some("claude".into()), false, status);
            t.exit = None;
            t.asleep = false;
            app.snap.terms.insert(id, t);
        }

        app.act(Action::ReloadAgents);

        let reloaded: Vec<_> = std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .filter_map(|m| match m {
                ClientMsg::Command(Command::ReloadAgent { term }) => Some(term),
                _ => None,
            })
            .collect();
        assert_eq!(reloaded, [front], "the working agent keeps its turn");
    }

    fn draft(app: &App) -> Option<&crate::client::screen::check_settings::CheckDraft> {
        app.screen.check_page.as_ref()
    }

    #[test]
    fn a_failed_save_keeps_the_draft_and_says_why() {
        let (mut app, _rx) = app_with_channel();
        open_check_page(&mut app, 0);
        app.on_key(KeyEvent::new(KeyCode::Char('p'), KeyModifiers::NONE));
        app.check_saved(Err(anyhow::anyhow!("disk full")), "Saved.", true);
        assert!(matches!(&app.mode, Mode::ScreenSettings(_)));
        assert!(
            draft(&app).is_some_and(|d| d.command.as_deref() == Some("p") && !d.saving),
            "the draft is still there"
        );
        let (msg, _, error) = app.notice.clone().expect("a toast");
        assert!(
            error && msg.contains("couldn't save") && msg.contains("disk full"),
            "{msg}"
        );
        assert!(app.cfg.check.is_empty(), "nothing was applied");
    }

    #[test]
    fn a_saved_check_reaches_the_daemon() {
        let (mut app, mut rx) = app_with_channel();
        open_check_page(&mut app, 0);
        app.on_key(KeyEvent::new(KeyCode::Char('n'), KeyModifiers::NONE));
        let mut cfg = app.cfg.clone();
        cfg.check = vec![CheckDef {
            project: project(),
            name: None,
            command: "npm test".into(),
            timeout_s: 600,
        }];
        app.check_saved(Ok(cfg), "Saved. Runs after the next turn ends.", true);
        assert_eq!(app.cfg.check.len(), 1);
        let mut sent = Vec::new();
        while let Ok(m) = rx.try_recv().map(|o| o.msg) {
            sent.push(m);
        }
        assert!(
            sent.iter()
                .any(|m| matches!(m, ClientMsg::Command(Command::ReloadConfig))),
            "the daemon is told to reload"
        );
        assert!(draft(&app).is_none(), "a saved draft is no longer a draft");
        assert_eq!(
            app.notice.clone().expect("a toast").0,
            "Saved. Runs after the next turn ends."
        );
    }

    #[test]
    fn keys_on_the_check_page_edit_the_draft_and_esc_drops_it() {
        let (mut app, _rx) = app_with_channel();
        with_check(&mut app, "npm test", 600);
        open_check_page(&mut app, 0);
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(
            draft(&app).is_some_and(|d| d.editing && d.command.as_deref() == Some("npm test")),
            "Enter edits the command"
        );
        assert!(
            draw(&mut app, 100, 30).contains("npm test█"),
            "the draft shows with its cursor"
        );
        app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        assert!(draft(&app).is_none(), "Esc drops the draft");
        assert_eq!(app.cfg.check[0].command, "npm test");
    }

    #[test]
    fn with_no_check_the_arrows_and_delete_write_nothing() {
        let (mut app, _rx) = app_with_channel();
        open_check_page(&mut app, 0);
        for code in [KeyCode::Down, KeyCode::Right, KeyCode::Delete] {
            app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
        }
        assert!(app.notice.is_none(), "nothing to change, nothing said");
        assert!(draft(&app).is_some_and(|d| !d.saving));
    }

    #[test]
    fn without_a_project_open_the_command_cannot_be_edited() {
        let (mut app, _rx) = app_with_channel();
        app.snap.workspaces.clear();
        app.snap.active_ws = None;
        open_check_page(&mut app, 0);
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(matches!(&app.mode, Mode::ScreenSettings(_)) && draft(&app).is_none());
        let (msg, _, _) = app.notice.clone().expect("a toast");
        assert!(msg.contains("project"), "{msg}");
    }
}

mod check_wiring_tests {
    use super::*;
    use crate::client::menu::{Act, menu_chars};
    use crate::protocol::{CheckInfo, CheckState, ClientMsg, Command};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    const TERM: TermId = 1;
    const PANE: ClientTerm = ClientTerm::local(TERM);
    const COMMAND: &str = "npm test";
    /// Keys a sidebar row already uses; a menu item must not take one (x is Close's).
    const TAKEN: [char; 5] = ['j', 'k', 'a', 'm', 'i'];
    const ALL_STATES: [CheckState; 5] = [
        CheckState::Checking,
        CheckState::Passed,
        CheckState::Failed,
        CheckState::Overridden,
        CheckState::CouldNotRun,
    ];
    type Rx = mpsc::UnboundedReceiver<Outgoing>;
    type Layout = fn(&mut App);

    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn info(state: CheckState) -> CheckInfo {
        let exit_code = match state {
            CheckState::Checking
            | CheckState::Pending
            | CheckState::NeedsApproval
            | CheckState::Never => None,
            CheckState::Passed | CheckState::Stale => Some(0),
            CheckState::CouldNotRun => Some(127),
            CheckState::Failed | CheckState::Overridden => Some(1),
        };
        let overridden = state == CheckState::Overridden;
        CheckInfo {
            command: COMMAND.into(),
            state,
            exit_code,
            started_at: now() - 180,
            duration_ms: 14_200,
            after_turn_ended_at: now() - 200,
            first_failing_line: "Error: expected 3 got 2".into(),
            overridden_at: overridden.then(|| now() - 30),
            ..Default::default()
        }
    }

    /// The shop-api scene with session 1 finished (or as `status`) and carrying `check`.
    fn rig(w: u16, h: u16, layout: Layout, check: Option<CheckInfo>, status: Status) -> (App, Rx) {
        let (_, mut app) = super::design_tests::render_with(w, h);
        layout(&mut app);
        let (tx, rx) = mpsc::unbounded_channel();
        app.out = tx;
        let t = app.snap.terms.get_mut(&TERM).unwrap();
        (t.status, t.said, t.checks) = (status, "tests pass".into(), check.into_iter().collect());
        app.screen_sync();
        (app, rx)
    }

    fn done(state: CheckState) -> (App, Rx) {
        rig(100, 30, |_| {}, Some(info(state)), Status::Done)
    }

    fn sent(rx: &mut Rx) -> Vec<ClientMsg> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect()
    }

    fn commands(rx: &mut Rx) -> Vec<Command> {
        sent(rx)
            .into_iter()
            .filter_map(|m| {
                if let ClientMsg::Command(c) = m {
                    Some(c)
                } else {
                    None
                }
            })
            .collect()
    }

    fn draw(app: &mut App, w: u16, h: u16) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let frame: String = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        let frame = frame.replace(|c| ('\u{e000}'..='\u{f8ff}').contains(&c), "");
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!(
                "--- {w}x{h} {}/{}\n{frame}",
                app.cfg.ui.layout, app.cfg.ui.panes
            );
        }
        frame
    }

    fn words(o: &str) -> String {
        o.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    fn press(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn typed(app: &mut App, text: &str) {
        for c in text.chars() {
            press(app, KeyCode::Char(c));
        }
    }

    /// Click the topmost control whose hit is `want`, drawing first so it exists.
    pub(super) fn click(app: &mut App, w: u16, h: u16, want: Hit) {
        draw(app, w, h);
        let (r, _) = app
            .hits
            .iter()
            .rev()
            .find(|(_, hit)| *hit == want)
            .unwrap_or_else(|| panic!("no control for {want:?}"));
        let (column, row) = (r.x, r.y);
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column,
                row,
                modifiers: KeyModifiers::NONE,
            });
        }
    }

    fn viewkey(c: char) -> Hit {
        Hit::Button(Btn::ViewKey(c))
    }

    fn toast(app: &App) -> (String, bool) {
        let (msg, _, error) = app.notice.clone().expect("a toast");
        (msg, error)
    }

    fn rerun_of(cmds: &[Command]) -> usize {
        cmds.iter()
            .filter(|c| matches!(c, Command::RerunCheck { term: TERM, .. }))
            .count()
    }

    fn overrides(cmds: &[Command]) -> Vec<String> {
        cmds.iter()
            .filter_map(|c| {
                if let Command::OverrideCheck {
                    term: TERM,
                    name: None,
                    reason,
                } = c
                {
                    Some(reason.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    fn labels(app: &App) -> Vec<String> {
        app.project_items(PANE)
            .into_iter()
            .map(|(l, _)| l)
            .collect()
    }

    // ---- the row menu ------------------------------------------------------------------

    #[test]
    fn the_row_menu_offers_a_check_item_only_where_it_applies() {
        let offered = |state: Option<CheckState>| {
            let (app, _) = rig(100, 30, |_| {}, state.map(info), Status::Done);
            let l = labels(&app);
            [
                "Check output",
                "Re-run check",
                "Override check…",
                "Undo override",
            ]
            .map(|want| l.iter().any(|x| x == want))
        };
        assert_eq!(
            offered(None),
            [false, false, false, false],
            "no check, no items"
        );
        assert_eq!(
            offered(Some(CheckState::Checking)),
            [true, false, false, false],
            "running: its output, not a second run"
        );
        assert_eq!(
            offered(Some(CheckState::Passed)),
            [true, true, false, false]
        );
        assert_eq!(
            offered(Some(CheckState::CouldNotRun)),
            [true, true, false, false]
        );
        assert_eq!(
            offered(Some(CheckState::Overridden)),
            [true, true, false, true],
            "an override is not overridden twice, but can be taken back"
        );
        assert_eq!(offered(Some(CheckState::Failed)), [true, true, true, false]);
    }

    /// `state`'s session under the sidebar's keyboard cursor.
    fn on_its_row(state: CheckState) -> (App, Rx) {
        let (mut app, rx) = done(state);
        app.mode = Mode::Side;
        app.screen.cursor = Some(ClientSession::local(SessionKey::Pane(TERM)));
        (app, rx)
    }

    #[test]
    fn the_sidebar_keys_act_on_the_rows_check_and_say_why_when_they_cant() {
        // No bare letter acts from the sidebar: r, O and u are typing, so they
        // re-run, override and undo nothing.
        for (state, key) in [
            (CheckState::Failed, KeyCode::Char('r')),
            (CheckState::Failed, KeyCode::Char('O')),
            (CheckState::Overridden, KeyCode::Char('u')),
        ] {
            let (mut app, mut rx) = on_its_row(state);
            app.on_key(KeyEvent::new(key, KeyModifiers::NONE));
            assert!(
                !matches!(&app.mode, Mode::Confirm(_)),
                "{key:?} asks nothing: {:?}",
                app.mode
            );
            assert!(commands(&mut rx).is_empty(), "{key:?} sends no command");
        }
        for state in [
            CheckState::Failed,
            CheckState::CouldNotRun,
            CheckState::Overridden,
            CheckState::Stale,
            CheckState::Never,
        ] {
            let (mut app, _) = on_its_row(state);
            press(&mut app, KeyCode::Enter);
            assert!(
                matches!(&app.view, Some(View::Check(v)) if v.term == PANE),
                "{state:?}: Enter opens its evidence"
            );
        }
        let (mut app, _) = on_its_row(CheckState::Passed);
        press(&mut app, KeyCode::Enter);
        assert!(
            app.view.is_none(),
            "a pass is not worth a look: Enter goes to the session"
        );
    }

    #[test]
    fn the_menu_tells_override_from_output_by_case() {
        let (mut app, mut rx) = done(CheckState::Failed);
        app.menu_for_project_tools(PANE, (20, 10));
        app.on_key(KeyEvent::new(KeyCode::Char('O'), KeyModifiers::SHIFT));
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if matches!(c.act, Act::OverrideCheck(PANE, ..))),
            "O overrides: {:?}",
            app.mode
        );
        assert!(commands(&mut rx).is_empty());
    }

    #[test]
    fn the_check_items_never_take_a_letter_the_project_menu_already_uses() {
        for state in ALL_STATES {
            for status in [Status::Done, Status::Working, Status::Idle] {
                let (app, _) = rig(100, 30, |_| {}, Some(info(state)), status);
                let items = app.project_items(PANE);
                let keys = menu_chars(&app, &items);
                let mut seen = Vec::new();
                for ((label, act), key) in items.iter().zip(&keys) {
                    // A long menu runs out of letters: an item without one is picked by arrows.
                    let Some(key) = *key else { continue };
                    if matches!(act, Act::End(_)) {
                        assert_eq!(key, 'x');
                    } else {
                        assert!(
                            !TAKEN.contains(&key),
                            "{state:?} {status:?}: {label} took {key}"
                        );
                    }
                    assert!(
                        !seen.contains(&key),
                        "{state:?} {status:?}: {label} repeats {key}"
                    );
                    seen.push(key);
                }
            }
        }
    }

    fn pick(app: &mut App, label: &str) {
        app.menu_for_project_tools(PANE, (20, 10));
        let (items, keys) = match &app.mode {
            Mode::ScreenMenu(m) => (m.items.clone(), menu_chars(app, &m.items)),
            other => panic!("no menu: {other:?}"),
        };
        let i = items
            .iter()
            .position(|(l, _)| l == label)
            .unwrap_or_else(|| panic!("no {label} in {items:?}"));
        press(app, KeyCode::Char(keys[i].unwrap()));
    }

    #[test]
    fn the_menus_rerun_item_asks_the_daemon_and_says_so() {
        let (mut app, mut rx) = done(CheckState::Failed);
        pick(&mut app, "Re-run check");
        assert_eq!(rerun_of(&commands(&mut rx)), 1);
        let (msg, error) = toast(&app);
        assert!(
            msg.contains("Re-running")
                && msg.contains(COMMAND)
                && msg.contains("'s worktree…")
                && !error,
            "{msg}"
        );
        assert_eq!(app.mode, Mode::Normal);
    }

    #[test]
    fn the_menus_output_item_opens_the_evidence_sheet() {
        for state in ALL_STATES {
            let (mut app, mut rx) = done(state);
            pick(&mut app, "Check output");
            assert!(
                matches!(&app.view, Some(View::Check(v)) if v.term == PANE),
                "{state:?}"
            );
            assert!(
                sent(&mut rx).iter().any(|m| matches!(
                    m,
                    ClientMsg::Query(crate::protocol::Query::CheckOutput {
                        term: TERM,
                        name: None
                    })
                )),
                "{state:?}: the output is asked for"
            );
        }
    }

    #[test]
    fn the_menus_override_item_asks_first_and_sends_the_reason_on_yes() {
        let (mut app, mut rx) = done(CheckState::Failed);
        pick(&mut app, "Override check…");
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.danger && matches!(c.act, Act::OverrideCheck(PANE, ..))),
            "{:?}",
            app.mode
        );
        assert!(
            commands(&mut rx).is_empty(),
            "nothing is sent until it is confirmed"
        );
        typed(&mut app, "flaky on CI");
        press(&mut app, KeyCode::Enter);
        assert_eq!(app.mode, Mode::Normal);
        assert_eq!(overrides(&commands(&mut rx)), ["flaky on CI"]);
    }

    #[test]
    fn a_result_that_is_no_longer_failed_is_not_overridden_from_a_stale_menu() {
        let (mut app, mut rx) = done(CheckState::Failed);
        app.menu_for_project_tools(PANE, (20, 10));
        app.snap.terms.get_mut(&TERM).unwrap().checks = vec![info(CheckState::Passed)];
        app.screen_sync();
        app.menu_act(Act::OverrideCheck(PANE, String::new(), None));
        assert!(
            commands(&mut rx).is_empty() && !matches!(app.mode, Mode::Confirm(_)),
            "{:?}",
            app.mode
        );
        assert!(toast(&app).0.contains("failed"), "it says why");
    }

    // ---- the override confirm ----------------------------------------------------------

    fn ask_override(app: &mut App) {
        press(app, KeyCode::Char('O'));
    }

    #[test]
    fn the_reason_is_optional_editable_and_bounded() {
        let (mut app, mut rx) = done(CheckState::Failed);
        app.open_check_sheet(PANE);
        ask_override(&mut app);
        press(&mut app, KeyCode::Enter);
        assert_eq!(
            overrides(&commands(&mut rx)),
            [""],
            "an empty reason is fine"
        );
        app.open_check_sheet(PANE);
        ask_override(&mut app);
        typed(&mut app, "abc");
        press(&mut app, KeyCode::Backspace);
        app.on_paste("\u{e9}d\nsecond line".into());
        press(&mut app, KeyCode::Enter);
        assert_eq!(
            overrides(&commands(&mut rx)),
            ["ab\u{e9}d"],
            "backspace edits, a paste takes its first line"
        );
        app.open_check_sheet(PANE);
        ask_override(&mut app);
        typed(&mut app, &"x".repeat(400));
        press(&mut app, KeyCode::Enter);
        let reason = overrides(&commands(&mut rx)).remove(0);
        assert_eq!(
            reason.chars().count(),
            crate::protocol::OVERRIDE_REASON_MAX_CHARS,
            "the daemon would refuse a longer one"
        );
    }

    #[test]
    fn the_override_button_is_clickable_and_so_is_cancel() {
        let (mut app, mut rx) = done(CheckState::Failed);
        app.open_check_sheet(PANE);
        ask_override(&mut app);
        click(&mut app, 100, 30, Hit::Screen(screen::ScreenHit::ConfirmNo));
        assert_eq!(
            (app.mode.clone(), commands(&mut rx).len()),
            (Mode::Normal, 0),
            "Cancel"
        );
        assert!(
            matches!(app.view, Some(View::Check(_))),
            "the sheet is still open behind it"
        );
        ask_override(&mut app);
        typed(&mut app, "by mouse");
        click(
            &mut app,
            100,
            30,
            Hit::Screen(screen::ScreenHit::ConfirmYes),
        );
        assert_eq!(overrides(&commands(&mut rx)), ["by mouse"]);
        assert!(toast(&app).0.contains("overridden"));
    }

    // ---- the evidence sheet ------------------------------------------------------------

    #[test]
    fn the_sheets_keys_do_what_their_buttons_say_and_only_where_they_apply() {
        // (state, r re-runs, O asks, u undoes)
        let table = [
            (CheckState::Failed, true, true, false),
            (CheckState::Passed, true, false, false),
            (CheckState::CouldNotRun, true, false, false),
            (CheckState::Overridden, true, false, true),
            (CheckState::Checking, false, false, false),
        ];
        for (state, rerun, over, undo) in table {
            let (mut app, mut rx) = done(state);
            app.open_check_sheet(PANE);
            sent(&mut rx);
            press(&mut app, KeyCode::Char('r'));
            let cmds = commands(&mut rx);
            assert_eq!(rerun_of(&cmds) == 1, rerun, "{state:?}: r");
            press(&mut app, KeyCode::Char('O'));
            assert_eq!(matches!(app.mode, Mode::Confirm(_)), over, "{state:?}: O");
            app.mode = Mode::Normal;
            press(&mut app, KeyCode::Char('u'));
            assert_eq!(
                commands(&mut rx)
                    .iter()
                    .filter(|c| matches!(
                        c,
                        Command::UndoOverride {
                            term: TERM,
                            name: None
                        }
                    ))
                    .count()
                    == 1,
                undo,
                "{state:?}: u"
            );
            assert!(
                matches!(app.view, Some(View::Check(_))),
                "{state:?}: the sheet stays open"
            );
        }
    }

    #[test]
    fn the_sheets_buttons_click_through_to_the_same_actions() {
        let (mut app, mut rx) = done(CheckState::Failed);
        app.open_check_sheet(PANE);
        click(&mut app, 100, 30, viewkey('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1, "Re-run");
        click(&mut app, 100, 30, viewkey('O'));
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if matches!(c.act, Act::OverrideCheck(PANE, ..))),
            "Override…"
        );
        app.mode = Mode::Normal;
        let (mut app, mut rx) = done(CheckState::Overridden);
        app.open_check_sheet(PANE);
        click(&mut app, 100, 30, viewkey('u'));
        assert!(
            commands(&mut rx).iter().any(|c| matches!(
                c,
                Command::UndoOverride {
                    term: TERM,
                    name: None
                }
            )),
            "Undo override"
        );
        assert!(toast(&app).0.contains("failed again"));
    }

    #[test]
    fn a_queued_re_run_says_queued_in_the_toast_and_the_sheet_and_is_not_sent_twice() {
        let (mut app, mut rx) = rig(
            100,
            30,
            |_| {},
            Some(info(CheckState::Failed)),
            Status::Working,
        );
        app.open_check_sheet(PANE);
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1);
        assert!(toast(&app).0.contains("queued"), "{}", toast(&app).0);
        app.snap
            .terms
            .get_mut(&TERM)
            .unwrap()
            .checks
            .first_mut()
            .unwrap()
            .rerun_queued = true;
        app.screen_sync();
        assert!(
            words(&draw(&mut app, 100, 30)).contains("re-run queued"),
            "the sheet says it too"
        );
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(
            rerun_of(&commands(&mut rx)),
            0,
            "already queued: nothing more is sent"
        );
        assert!(toast(&app).0.contains("queued"));
    }

    #[test]
    fn a_re_run_toasts_and_the_sheet_offers_no_second_run_while_it_runs() {
        let (mut app, mut rx) = rig(
            160,
            45,
            |_| {},
            Some(info(CheckState::Failed)),
            Status::Done,
        );
        app.open_check_sheet(PANE);
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1);
        assert!(
            words(&draw(&mut app, 160, 45)).contains("Re-running npm test in"),
            "the toast shows"
        );
        let mut running = info(CheckState::Checking);
        running.exit_code = None;
        app.snap.terms.get_mut(&TERM).unwrap().checks = vec![running];
        app.screen_sync();
        app.open_check_sheet(PANE);
        press(&mut app, KeyCode::Esc);
        app.open_check_sheet(PANE);
        press(&mut app, KeyCode::Char('r'));
        assert!(
            commands(&mut rx).is_empty(),
            "the sheet offers no r while it runs"
        );
        with_command(&mut app);
        check_page(&mut app, 0);
        press(&mut app, KeyCode::Char('r'));
        assert!(
            commands(&mut rx).is_empty() && toast(&app).0.contains("already running"),
            "Run now does not start it twice"
        );
    }

    // ---- the why popover ---------------------------------------------------------------

    // ---- the Inbox ---------------------------------------------------------------------

    fn goto_failed(app: &mut App) {
        if !matches!(app.mode, Mode::GoTo { .. }) {
            app.act(Action::Jump);
        }
        for _ in 0..8 {
            let Mode::GoTo { sel, .. } = &app.mode else {
                panic!("no inbox: {:?}", app.mode)
            };
            let rows = screen::goto_rows(&app.screen_model(), "", 0);
            if matches!(
                rows.get(*sel),
                Some(screen::GoRow::Failed(ClientTerm { term: TERM, .. }))
            ) {
                return;
            }
            press(app, KeyCode::Down);
        }
        panic!("the failed row never got the selection");
    }

    #[test]
    fn the_inbox_buttons_and_their_keys_act() {
        let (mut app, mut rx) = done(CheckState::Failed);
        goto_failed(&mut app);
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1, "r");
        assert!(
            matches!(app.mode, Mode::GoTo { .. }),
            "the Inbox stays open"
        );
        draw(&mut app, 100, 30);
        click(
            &mut app,
            100,
            30,
            Hit::Screen(screen::ScreenHit::InboxKey('r')),
        );
        assert_eq!(rerun_of(&commands(&mut rx)), 1, "the Re-run button");
        press(&mut app, KeyCode::Char('O'));
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if matches!(c.act, Act::OverrideCheck(PANE, ..))),
            "O"
        );
        press(&mut app, KeyCode::Esc);
        goto_failed(&mut app);
        click(
            &mut app,
            100,
            30,
            Hit::Screen(screen::ScreenHit::InboxKey('O')),
        );
        assert!(matches!(app.mode, Mode::Confirm(_)), "the Override… button");
        press(&mut app, KeyCode::Esc);
        goto_failed(&mut app);
        click(
            &mut app,
            100,
            30,
            Hit::Screen(screen::ScreenHit::InboxKey('\n')),
        );
        assert!(
            matches!(&app.view, Some(View::Check(v)) if v.term == PANE) && app.mode == Mode::Normal,
            "the Output button"
        );
        app.view = None;
        goto_failed(&mut app);
        press(&mut app, KeyCode::Char('o'));
        assert!(
            app.view.is_none() && app.mode == Mode::Normal,
            "o opens the session"
        );
        assert!(
            commands(&mut rx)
                .iter()
                .any(|c| matches!(c, Command::FocusPane { term } if *term == TERM)),
            "o focuses it"
        );
    }

    #[test]
    fn enter_in_the_inbox_opens_a_failure_s_output_and_typing_a_search_still_searches() {
        let (mut app, mut rx) = done(CheckState::Failed);
        goto_failed(&mut app);
        press(&mut app, KeyCode::Enter);
        assert!(
            app.mode == Mode::Normal && matches!(&app.view, Some(View::Check(v)) if v.term == PANE),
            "Enter is the first button: Output"
        );
        app.view = None;
        assert!(
            commands(&mut rx)
                .iter()
                .all(|c| !matches!(c, Command::RerunCheck { .. }))
        );
        app.act(Action::Jump);
        assert!(matches!(app.mode, Mode::GoTo { .. }), "{:?}", app.mode);
        typed(&mut app, "sh");
        assert!(
            matches!(&app.mode, Mode::GoTo { query, .. } if query == "sh"),
            "other letters still search"
        );
        assert_eq!(rerun_of(&commands(&mut rx)), 0);
        typed(&mut app, "r");
        assert!(
            matches!(&app.mode, Mode::GoTo { query, .. } if query == "shr"),
            "and once a search has begun, r is part of it"
        );
    }

    // ---- Settings > Check --------------------------------------------------------------

    fn check_page(app: &mut App, sel: usize) {
        let cat = modal::Cat::ALL
            .iter()
            .position(|c| *c == modal::Cat::Check)
            .unwrap();
        app.mode = Mode::ScreenSettings(Box::new(design::SettingsView {
            cat,
            sel,
            editing: None,
            capturing: false,
            scroll: 0,
            in_rows: true,
        }));
    }

    fn with_command(app: &mut App) {
        let project = PathBuf::from(if cfg!(windows) {
            r"C:\code\shop-api"
        } else {
            "/code/shop-api"
        });
        app.cfg.check = vec![crate::config::CheckDef {
            project,
            name: None,
            command: COMMAND.into(),
            timeout_s: 600,
        }];
    }

    #[test]
    fn run_now_re_runs_the_latest_session_by_key_and_click() {
        let (mut app, mut rx) = done(CheckState::Passed);
        with_command(&mut app);
        check_page(&mut app, 0);
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1, "r on the page");
        click(
            &mut app,
            100,
            30,
            Hit::Screen(screen::ScreenHit::CheckDraft(
                screen::check_settings::DraftHit::RunNow,
            )),
        );
        assert_eq!(rerun_of(&commands(&mut rx)), 1, "a click on the button");
        assert!(
            matches!(app.mode, Mode::ScreenSettings(_)),
            "Settings stays open"
        );
    }

    #[test]
    fn r_on_the_check_page_is_typed_into_the_command_when_no_check_is_set_or_it_is_being_edited() {
        // (a check is set, Enter first to edit it, the command after r)
        for (set, edit, want) in [(false, false, "r"), (true, true, "npm testr")] {
            let (mut app, mut rx) = done(CheckState::Passed);
            if set {
                with_command(&mut app);
            }
            check_page(&mut app, 0);
            if edit {
                press(&mut app, KeyCode::Enter);
            }
            press(&mut app, KeyCode::Char('r'));
            assert_eq!(
                app.screen
                    .check_page
                    .as_ref()
                    .and_then(|d| d.command.as_deref()),
                Some(want),
                "set {set}, editing {edit}"
            );
            assert!(
                commands(&mut rx).is_empty(),
                "set {set}, editing {edit}: r runs nothing"
            );
        }
    }

    #[test]
    fn run_now_while_the_agent_works_queues_and_says_so() {
        let (mut app, mut rx) = rig(
            100,
            30,
            |_| {},
            Some(info(CheckState::Failed)),
            Status::Working,
        );
        with_command(&mut app);
        check_page(&mut app, 0);
        press(&mut app, KeyCode::Char('r'));
        assert_eq!(rerun_of(&commands(&mut rx)), 1);
        assert!(toast(&app).0.contains("queued"));
    }
}

mod restart_tests {
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    const SIZES: [(u16, u16); 3] = [(80, 24), (100, 30), (160, 45)];
    /// (ui.layout, ui.panes): Cards floating and Cards tiled, as older files wrote them.
    const LAYOUTS: [(&str, &str); 2] = [("cards", "floating"), ("cards", "tiled")];
    const OLD_DAEMON: &str = "0.36.11";
    const INSTALLED: &str = "9.9.9";

    /// The shop-api scene (3 sessions, 1 waiting for you) whose daemon is older than the installed the app.
    /// Its working session waits for you instead: a restart stops waiting sessions after asking, but waits for working ones.
    fn scene(w: u16, h: u16, layout: (&str, &str)) -> (App, mpsc::UnboundedReceiver<Outgoing>) {
        let (_, mut app) = super::design_tests::render_with(w, h);
        for t in app.snap.terms.values_mut().filter(|t| t.status == Status::Working) {
            t.status = Status::Blocked;
        }
        (app.cfg.ui.layout, app.cfg.ui.panes) = (layout.0.into(), layout.1.into());
        app.cfg.ui.fold_retired_layout();
        let (tx, rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.got_state = true;
        app.installed_version = Some(Ok(INSTALLED.into()));
        app.snap.daemon_version = OLD_DAEMON.into();
        (app, rx)
    }

    fn draw(app: &mut App, w: u16, h: u16) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let out: String = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        if maitty_shared::brand::env_var("SHOW").is_ok() {
            println!("{out}");
        }
        out
    }

    /// The mode bar's row on a screen `h` rows tall.
    fn bar_y(app: &App, h: u16) -> u16 {
        screen::mode_bar_row(app, ratatui::layout::Rect::new(0, 0, 1, h)).y
    }

    /// Whether `r` is the Restart pill: on the mode bar, or at the sidebar's foot.
    fn is_pill(app: &App, h: u16, r: &ratatui::layout::Rect) -> bool {
        let side = app.screen.side_rect;
        r.y == bar_y(app, h)
            || (r.y + 4 == side.bottom() && side.contains(ratatui::layout::Position::new(r.x, r.y)))
    }

    /// The Restart buttons of the toast and Settings, not the persistent pill.
    fn restart_hit(app: &App, h: u16) -> Option<ratatui::layout::Rect> {
        app.hits.iter().find_map(|(r, k)| {
            (*k == Hit::Screen(screen::ScreenHit::Restart) && !is_pill(app, h, r)).then_some(*r)
        })
    }

    fn click(app: &mut App, r: ratatui::layout::Rect) {
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: r.x + r.width / 2,
            row: r.y,
            modifiers: KeyModifiers::NONE,
        });
    }

    fn key(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<ClientMsg> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect()
    }

    fn is_restart(act: &menu::Act) -> bool {
        *act == menu::Act::RestartDaemon
    }

    #[test]
    fn settings_offers_restart_now_in_every_layout_and_size() {
        for layout in LAYOUTS {
            for (w, h) in SIZES {
                let (mut app, mut rx) = scene(w, h, layout);
                open_settings_on(&mut app, modal::Cat::About);
                let out = draw(&mut app, w, h);
                assert!(out.contains("Restart now"), "{layout:?} {w}x{h}\n{out}");
                let r = restart_hit(&app, h)
                    .unwrap_or_else(|| panic!("{layout:?} {w}x{h}: the button is clickable"));
                assert!(
                    r.right() <= w && r.bottom() <= h,
                    "{layout:?} {w}x{h}: the button fits {r:?}"
                );
                click(&mut app, r);
                assert!(
                    matches!(&app.mode, Mode::Confirm(c) if is_restart(&c.act)),
                    "{layout:?} {w}x{h}"
                );
                assert!(sent(&mut rx).is_empty(), "choosing it only asks");
            }
        }
    }

    #[test]
    fn the_restart_button_works_over_a_program_that_wants_the_mouse() {
        for layout in LAYOUTS {
            let (mut app, _rx) = scene(160, 45, layout);
            let focused = app.focused().expect("a focused pane");
            app.parsers
                .get_mut(&focused)
                .expect("its screen")
                .process(b"\x1b[?1000h\x1b[?1006h");
            app.update_installed(INSTALLED.into());
            app.notify("installed".into(), false);
            app.notice_restart = true;
            draw(&mut app, 160, 45);
            let r = restart_hit(&app, 45).unwrap_or_else(|| panic!("{layout:?}: the toast button"));
            assert!(
                app.panes.iter().any(
                    |(_, p)| p.contains(ratatui::layout::Position::new(r.x + r.width / 2, r.y))
                ),
                "{layout:?}: the button sits over the pane's text"
            );
            for kind in [
                MouseEventKind::Down(MouseButton::Left),
                MouseEventKind::Up(MouseButton::Left),
            ] {
                app.on_mouse(MouseEvent {
                    kind,
                    column: r.x + r.width / 2,
                    row: r.y,
                    modifiers: KeyModifiers::NONE,
                });
            }
            assert!(
                matches!(&app.mode, Mode::Confirm(c) if is_restart(&c.act)),
                "{layout:?}: the click asked to restart: {:?}",
                app.mode
            );
        }
    }

    #[test]
    fn a_later_toast_does_not_keep_the_restart_button() {
        let (mut app, _rx) = scene(160, 45, LAYOUTS[0]);
        app.update_installed(INSTALLED.into());
        app.notify("Copied".into(), false);
        let out = draw(&mut app, 160, 45);
        assert!(
            out.contains("Copied")
                && !out.contains("Restart now")
                && restart_hit(&app, 45).is_none()
        );
    }

    #[test]
    fn a_restart_with_working_chats_waits_for_them_instead_of_asking() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.terms.get_mut(&1).unwrap().status = Status::Working;
        app.ask_restart();
        assert!(app.restart_waiting && matches!(app.mode, Mode::Normal), "no question, it waits");
        assert!(sent(&mut rx).is_empty(), "nothing was stopped");
        app.snap.terms.get_mut(&1).unwrap().status = Status::Idle;
        app.release_tick();
        assert!(!app.restart_waiting, "the wait is over");
        assert!(matches!(&app.mode, Mode::Confirm(c) if is_restart(&c.act)), "the chat waiting for you is still asked about");
    }

    #[test]
    fn idle_sessions_restart_without_asking() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.terms.retain(|id, _| *id == 3);
        assert_ne!(app.snap.terms[&3].status, Status::Working);
        app.ask_restart();
        assert_eq!(app.mode, Mode::Normal, "nothing is mid-turn: no question");
        assert!(matches!(
            sent(&mut rx).as_slice(),
            [ClientMsg::Command(Command::KillServer { forget: false })]
        ));
    }

    #[test]
    fn a_session_waiting_for_you_asks_once_and_is_counted() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.terms.retain(|id, _| *id == 3);
        app.snap.terms.get_mut(&3).unwrap().status = Status::Blocked;
        app.ask_restart();
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if is_restart(&c.act) && c.what == "1 session stops and resumes, 1 waiting for you"),
            "{:?}",
            app.mode
        );
        assert!(sent(&mut rx).is_empty());
        key(&mut app, KeyCode::Enter);
        assert!(
            matches!(
                sent(&mut rx).as_slice(),
                [ClientMsg::Command(Command::KillServer { forget: false })]
            ),
            "Enter is the one keypress"
        );
    }

    #[test]
    fn with_restoring_off_the_restart_asks_and_says_sessions_close() {
        let (mut app, _rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.terms.retain(|id, _| *id == 3);
        app.cfg.restore.enabled = false;
        app.ask_restart();
        assert!(
            matches!(&app.mode, Mode::Confirm(c) if c.note.contains("close for good") && c.danger),
            "{:?}",
            app.mode
        );
    }

    #[test]
    fn an_old_window_gives_way_to_the_installed_app_when_the_server_stops() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        assert!(
            app.window_stale(),
            "the installed version is newer than this window"
        );
        app.ask_restart();
        key(&mut app, KeyCode::Enter);
        assert!(matches!(
            sent(&mut rx).as_slice(),
            [ClientMsg::Command(Command::KillServer { forget: false })]
        ));
        app.on_server(ServerMsg::Bye);
        assert!(
            app.relaunch && app.quit.is_some(),
            concat!(
                "the window closes so the installed ",
                env!("APP_COMMAND"),
                " opens in its place"
            )
        );
        assert!(
            !app.daemon_restart_reconnect,
            "an old window never reconnects to the new server"
        );
    }

    #[test]
    fn when_only_the_window_is_old_restart_swaps_the_window_and_leaves_the_server() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.daemon_version = INSTALLED.into();
        assert!(!app.daemon_restartable() && app.restart_needed());
        app.ask_restart();
        assert!(app.relaunch && app.quit.is_some());
        assert!(
            sent(&mut rx).is_empty(),
            "the server and every session keep running"
        );
    }

    #[test]
    fn the_pill_is_drawn_and_clicking_it_restarts() {
        for layout in LAYOUTS {
            let (mut app, mut rx) = scene(100, 30, layout);
            app.snap.terms.retain(|id, _| *id == 3);
            let out = draw(&mut app, 100, 30);
            assert!(out.contains("menu▪") || out.contains("menu•"), "the menu carries the update mark: {layout:?}\n{out}");
            let r = app
                .hits
                .iter()
                .find_map(|(r, k)| (*k == Hit::Screen(screen::ScreenHit::Actions)).then_some(*r))
                .expect("the chip at the sidebar's foot is clickable");
            click(&mut app, r);
            let Mode::ScreenMenu(menu) = &app.mode else {
                panic!("the chip opens its menu: {:?}", app.mode)
            };
            assert_eq!(menu.items[0].0, "Restart to finish update");
            app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
            assert!(
                matches!(
                    sent(&mut rx).as_slice(),
                    [ClientMsg::Command(Command::KillServer { forget: false })]
                ),
                "{layout:?}"
            );
        }
    }

    #[test]
    fn restart_is_in_the_palette_and_says_so_when_there_is_nothing_to_do() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.terms.retain(|id, _| *id == 3);
        app.act(Action::Restart);
        assert!(matches!(
            sent(&mut rx).as_slice(),
            [ClientMsg::Command(Command::KillServer { .. })]
        ));
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.daemon_version = env!("APP_VERSION").into();
        app.installed_version = Some(Ok(env!("APP_VERSION").into()));
        app.act(Action::Restart);
        assert!(sent(&mut rx).is_empty());
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(t, ..)| t.contains("already running the installed version"))
        );
        assert_eq!(Action::Restart.to_config().as_deref(), Some("restart"));
    }

    #[test]
    fn cancel_changes_nothing() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.ask_restart();
        key(&mut app, KeyCode::Esc);
        assert_eq!(app.mode, Mode::Normal);
        assert!(
            sent(&mut rx).is_empty()
                && !app.daemon_restart_requested
                && !app.daemon_restart_reconnect
        );
        app.ask_restart();
        draw(&mut app, 100, 30);
        let cancel = app
            .hits
            .iter()
            .rev()
            .filter(|(_, h)| *h == Hit::Screen(screen::ScreenHit::ConfirmNo))
            .map(|(r, _)| *r)
            .min_by_key(|r| r.width)
            .unwrap();
        click(&mut app, cancel);
        assert_eq!(app.mode, Mode::Normal);
        assert!(sent(&mut rx).is_empty() && !app.daemon_restart_requested);
    }

    #[test]
    fn restarting_stops_the_daemon_and_the_window_reconnects_to_the_new_one() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        // A window already on the installed version has nothing to swap but the server.
        app.installed_version = Some(Ok(env!("APP_VERSION").into()));
        app.snap.daemon_version = "0.1.0".into();
        app.ask_restart();
        key(&mut app, KeyCode::Enter);
        assert!(matches!(
            sent(&mut rx).as_slice(),
            [ClientMsg::Command(Command::KillServer { forget: false })]
        ));
        assert!(app.daemon_restart_requested);

        app.on_server(ServerMsg::Bye);
        assert!(
            app.quit.is_none() && app.daemon_restart_reconnect,
            "the window stays open for the reconnect"
        );

        let mut snapshot = app.snap.clone();
        snapshot.daemon_version = env!("APP_VERSION").into();
        app.on_server(ServerMsg::State(snapshot));
        assert!(!app.daemon_restart_requested && !app.daemon_restart_reconnect);
        assert_eq!(app.snap.terms.len(), 3, "the restored sessions are back");
        assert!(
            !app.daemon_restartable(),
            "the daemon now matches the install"
        );
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(text, ..)| text.contains("daemon restarted with the update"))
        );
    }

    #[test]
    fn nothing_restarts_when_the_daemon_is_not_older() {
        let (mut app, mut rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.daemon_version = INSTALLED.into();
        app.ask_restart();
        assert_eq!(app.mode, Mode::Normal);
        assert!(sent(&mut rx).is_empty() && !app.daemon_restart_requested);
    }

    #[test]
    fn capital_r_in_settings_asks_to_restart() {
        let (mut app, _rx) = scene(100, 30, LAYOUTS[0]);
        app.act(Action::Settings);
        key(&mut app, KeyCode::Char('R'));
        assert!(matches!(&app.mode, Mode::Confirm(c) if is_restart(&c.act)));
        let (mut app, _rx) = scene(100, 30, LAYOUTS[0]);
        app.snap.daemon_version = INSTALLED.into();
        app.act(Action::Settings);
        key(&mut app, KeyCode::Char('R'));
        assert!(
            matches!(app.mode, Mode::ScreenSettings(_)),
            "nothing to restart: Settings stays"
        );
    }
}

mod inbox_search_tests {
    use super::*;

    /// An empty Inbox: type a letter (sessions match), Backspace it. The selection from the
    /// matches must not outlive them, or drawing the empty list reads past its end.
    #[test]
    fn backspacing_the_last_letter_in_an_empty_inbox_keeps_it_open() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        for t in app.snap.terms.values_mut() {
            t.status = crate::protocol::Status::Idle;
        }
        app.snap.questions.clear();
        app.screen_fresh();
        app.open_goto();
        let mut term = ratatui::Terminal::new(ratatui::backend::TestBackend::new(160, 45)).unwrap();
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        app.on_key(KeyEvent::new(KeyCode::Char('a'), KeyModifiers::NONE));
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        app.on_key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        assert!(
            matches!(&app.mode, Mode::GoTo { query, .. } if query.is_empty()),
            "the Inbox stays open, its search empty"
        );
    }
}

mod side_panel_width_tests {
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    /// The Changes drawer open on a screen `w` columns wide, drawn once.
    fn inbox_open(w: u16, h: u16) -> App {
        let (_, mut app) = super::design_tests::render_with(w, h);
        app.show_view(changes_view());
        draw(&mut app, w, h);
        app
    }

    fn draw(app: &mut App, w: u16, h: u16) {
        let mut term = Terminal::new(TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
    }

    fn key(app: &mut App, c: char) {
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }

    fn edge(app: &App) -> Option<Rect> {
        app.hits
            .iter()
            .find(|(_, h)| *h == Hit::Screen(screen::ScreenHit::SheetEdge))
            .map(|(r, _)| *r)
    }

    #[test]
    fn brackets_narrow_and_widen_the_sheet_and_equals_puts_its_default_back() {
        let mut app = inbox_open(200, 50);
        assert_eq!(app.screen.sheet_rect.width, 52, "Changes starts 52 wide");
        key(&mut app, '[');
        draw(&mut app, 200, 50);
        assert_eq!(app.screen.sheet_rect.width, 48, "[ narrows it 4");
        key(&mut app, ']');
        key(&mut app, ']');
        draw(&mut app, 200, 50);
        assert_eq!(app.screen.sheet_rect.width, 56, "] widens it 4 each");
        assert_eq!(
            app.screen.saved.sheet_w.get("changes"),
            Some(&56),
            "kept in the saved UI state"
        );
        key(&mut app, '=');
        draw(&mut app, 200, 50);
        assert_eq!(app.screen.sheet_rect.width, 52, "= puts the default back");
    }

    #[test]
    fn dragging_the_sheets_edge_resizes_it() {
        let mut app = inbox_open(200, 50);
        let at = edge(&app).expect("an edge to drag beside the panes");
        let mouse = |kind, column| MouseEvent {
            kind,
            column,
            row: at.y + 5,
            modifiers: KeyModifiers::NONE,
        };
        app.on_mouse(mouse(MouseEventKind::Down(MouseButton::Left), at.x));
        app.on_mouse(mouse(MouseEventKind::Drag(MouseButton::Left), at.x - 10));
        app.on_mouse(mouse(MouseEventKind::Up(MouseButton::Left), at.x - 10));
        draw(&mut app, 200, 50);
        assert_eq!(
            app.screen.sheet_rect.width,
            app.screen.sheet_rect.right() - (at.x - 10),
            "the sheet's edge follows the pointer"
        );
        assert!(app.screen.sheet_rect.width > 60, "wider than before");
    }

    #[test]
    fn on_a_narrow_screen_the_keys_leave_your_width_alone() {
        let mut app = inbox_open(80, 24);
        key(&mut app, ']');
        key(&mut app, '[');
        assert!(
            app.screen.saved.sheet_w.is_empty(),
            "taking the whole column, there is no width to change: {:?}",
            app.screen.saved.sheet_w
        );
    }

    #[test]
    fn keys_step_from_the_chosen_width_not_the_drawn_one() {
        let mut app = inbox_open(200, 50);
        // Mid-slide, or left from another view: the drawn rectangle says nothing about the width.
        app.screen.sheet_rect.width = 22;
        key(&mut app, '[');
        assert_eq!(app.screen.saved.sheet_w.get("changes"), Some(&48));
    }

    #[test]
    fn widths_survive_a_save_and_load() {
        let mut saved = screen::Saved::default();
        saved.sheet_w.insert("changes".into(), 90);
        let back: screen::Saved =
            serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
        assert_eq!(back.sheet_w.get("changes"), Some(&90));
    }

    fn changes_view() -> View {
        View::Changes(Box::new(views::ChangesView {
            extra: Default::default(),
            dir: PathBuf::from("/repo"),
            review: None,
            error: None,
            agent: String::new(),
            said: String::new(),
            term: None,
            ws: None,
            reviewed: Default::default(),
            linked: false,
            confirm: None,
        }))
    }

    fn click(app: &mut App, x: u16, y: u16) {
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: x,
                row: y,
                modifiers: KeyModifiers::NONE,
            });
        }
    }

    /// Whether `c` typed now reaches a pane (an `Input` goes out), drained afterwards.
    fn typed_into_a_pane(
        app: &mut App,
        rx: &mut mpsc::UnboundedReceiver<Outgoing>,
        c: char,
    ) -> bool {
        while rx.try_recv().map(|o| o.msg).is_ok() {}
        key(app, c);
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .any(|m| matches!(m, ClientMsg::Input { .. }))
    }

    #[test]
    fn a_click_into_a_pane_gives_it_the_keys_and_the_view_stays_open() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.view = Some(changes_view());
        draw(&mut app, 200, 50);
        assert!(
            !typed_into_a_pane(&mut app, &mut rx, 'm'),
            "Changes has the keys first"
        );
        let (_, pane) = *app.pane_frames.first().expect("a pane beside the sheet");
        click(&mut app, pane.x + pane.width / 2, pane.y + pane.height / 2);
        draw(&mut app, 200, 50);
        assert!(
            typed_into_a_pane(&mut app, &mut rx, 'm'),
            "after a click into the pane, typing goes there"
        );
        assert!(
            matches!(app.view, Some(View::Changes(_))),
            "and Changes is still open"
        );
        let sheet = app.screen.sheet_rect;
        click(
            &mut app,
            sheet.x + sheet.width / 2,
            sheet.y + sheet.height / 2,
        );
        assert!(
            !typed_into_a_pane(&mut app, &mut rx, 'm'),
            "a click in the sheet gives Changes the keys back"
        );
    }

    #[test]
    fn after_leader_t_beside_a_panel_the_next_key_goes_to_the_new_pane() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.cfg.ui.which_key = false;
        app.show_view(changes_view());
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        key(&mut app, 't');
        assert!(
            matches!(app.view, Some(View::Changes(_))),
            "Changes stays open beside it"
        );
        let mut term = Terminal::new(TestBackend::new(200, 50)).unwrap();
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        let buf = term.backend().buffer();
        let bar = screen::mode_bar_row(&app, buf.area);
        let text: String = (bar.x..bar.right())
            .map(|x| buf[(x, bar.y)].symbol().to_string())
            .collect();
        assert!(
            text.trim_start().starts_with("pane"),
            "the bar says pane, not changes: {text}"
        );
        assert!(
            typed_into_a_pane(&mut app, &mut rx, 'm'),
            "the next key types into the pane, not Changes"
        );
    }

    fn leader_x(app: &mut App) {
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        key(app, 'x');
    }

    /// A Changes sheet open beside a pane that is still working.
    fn changes_beside_a_working_pane() -> App {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let focused = app.focused().unwrap();
        app.snap.terms.get_mut(&focused.term).unwrap().status = Status::Working;
        app.show_view(changes_view());
        draw(&mut app, 200, 50);
        app
    }

    #[test]
    fn leader_x_closes_the_side_panel_that_has_the_keys_not_the_pane_behind_it() {
        let mut app = changes_beside_a_working_pane();
        leader_x(&mut app);
        assert!(app.view.is_none(), "x closed Changes");
        assert!(
            !matches!(app.mode, Mode::Confirm(_)),
            "and asked nothing about the pane behind it: {:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn leader_x_closes_the_pane_when_a_click_set_the_panel_aside() {
        let mut app = changes_beside_a_working_pane();
        let focused = app.focused().unwrap();
        let (_, pane) = *app
            .pane_frames
            .iter()
            .find(|(t, _)| *t == focused)
            .expect("the focused pane beside the sheet");
        click(&mut app, pane.x + pane.width / 2, pane.y + pane.height / 2);
        leader_x(&mut app);
        assert!(matches!(app.mode, Mode::Confirm(_)), "the pane has the keys: x asks to close it");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let banner = app.closing_banner().expect("closed").text;
        assert!(banner.starts_with("Closed "), "it closes the focused pane: {banner}");
        assert!(
            matches!(app.view, Some(View::Changes(_))),
            "Changes stays open beside it"
        );
        let _ = focused;
    }

    #[test]
    fn leader_x_in_the_sidebar_closes_the_cursor_s_row_not_the_panel() {
        let mut app = changes_beside_a_working_pane();
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
        let row = app
            .screen
            .cursor
            .expect("leader ← put the cursor on a sidebar row");
        app.snap
            .terms
            .get_mut(&app.session_term(row).unwrap().term)
            .unwrap()
            .status = Status::Working;
        leader_x(&mut app);
        assert!(matches!(app.mode, Mode::Confirm(_)), "x asks to close the row");
        app.on_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let banner = app.closing_banner().expect("closed").text;
        assert!(banner.starts_with("Closed "), "it closes the cursor's session: {banner}");
        let _ = row;
        assert!(
            matches!(app.view, Some(View::Changes(_))),
            "Changes stays open"
        );
    }

    /// Files open in the sheet, set aside by a click into the pane beside it.
    fn files_set_aside() -> App {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        app.show_view(View::Files(Box::new(views::FilesTree::new(
            std::env::temp_dir(),
            None,
        ))));
        draw(&mut app, 200, 50);
        let (_, pane) = *app.pane_frames.first().unwrap();
        click(&mut app, pane.x + 4, pane.y + pane.height / 2);
        assert!(!app.view_has_keys(), "set aside");
        app
    }

    #[test]
    fn the_pane_with_the_keys_shows_its_cursor() {
        let mut app = files_set_aside();
        let mut term = Terminal::new(TestBackend::new(200, 50)).unwrap();
        term.draw(|f| render::draw(&mut app, f)).unwrap();
        let at = term.get_cursor_position().unwrap();
        let (_, pane) = *app.pane_frames.first().unwrap();
        assert!(
            pane.contains(at),
            "the caret is in the pane that has the keys: {at:?} not in {pane:?}"
        );
    }

    #[test]
    fn f_hands_a_set_aside_files_view_the_keys_and_the_leader_leaves_you_in_it() {
        let mut app = files_set_aside();
        app.act(Action::Files);
        assert!(
            matches!(app.view, Some(View::Files(_))) && app.view_has_keys(),
            "f gave Files the keys back, not closed it"
        );
        // Through the leader in shortcut mode, too: the keys go to Files, not back to the leader.
        let mut app = files_set_aside();
        app.cfg.ui.which_key = false;
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        key(&mut app, 'f');
        assert!(
            app.view_has_keys() && matches!(app.mode, Mode::Normal),
            "in Files: {:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn a_new_view_opened_any_way_has_the_keys() {
        let mut app = files_set_aside();
        app.open_files(std::env::temp_dir());
        assert!(
            app.view_has_keys(),
            "open_files (as Ctrl+click on a path does) gives the new view the keys"
        );
    }

    #[test]
    fn a_check_sheet_set_aside_stays_aside_when_its_run_updates() {
        use crate::protocol::{CheckInfo, CheckState};
        let run = |started_at| CheckInfo {
            command: "npm test".into(),
            state: CheckState::Failed,
            exit_code: Some(1),
            started_at,
            ..Default::default()
        };
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.snap.terms.get_mut(&1).unwrap().checks = vec![run(100)];
        app.open_check_sheet(ClientTerm::local(1));
        draw(&mut app, 200, 50);
        let (_, pane) = *app.pane_frames.first().unwrap();
        click(&mut app, pane.x + pane.width / 2, pane.y + pane.height / 2);
        // The check runs again: the sheet is brought up to date in place.
        app.snap.terms.get_mut(&1).unwrap().checks = vec![run(200)];
        app.check_view_sync();
        assert!(
            matches!(app.view, Some(View::Check(_))),
            "the sheet is still open"
        );
        assert!(
            typed_into_a_pane(&mut app, &mut rx, 'o'),
            "typing still reaches the pane, not the sheet"
        );
    }

    #[test]
    fn a_view_opened_again_has_the_keys() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.view = Some(changes_view());
        draw(&mut app, 200, 50);
        let (_, pane) = *app.pane_frames.first().unwrap();
        click(&mut app, pane.x + pane.width / 2, pane.y + pane.height / 2);
        app.view = None;
        draw(&mut app, 200, 50);
        app.view = Some(changes_view());
        draw(&mut app, 200, 50);
        assert!(
            !typed_into_a_pane(&mut app, &mut rx, 'm'),
            "the reopened view has the keys"
        );
    }
}

mod files_panel_tests {
    use super::check_settings_tests::{draw, show};
    use super::*;
    use std::path::Path;

    /// A folder with `src/main.rs` (60 numbered lines) and `notes.txt`, unique to `name`.
    fn project(name: &str) -> PathBuf {
        let dir = maitty_test_support::TempFolder::new(&format!("files-{name}")).until_test_ends();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let body: String = (1..=60).map(|i| format!("let line_{i} = {i};\n")).collect();
        std::fs::write(dir.join("src").join("main.rs"), body).unwrap();
        std::fs::write(dir.join("notes.txt"), "remember the milk\n").unwrap();
        dir
    }

    /// The main screen `w`×`h` with the focused pane running in `dir`.
    fn screen_in(dir: &Path, w: u16, h: u16) -> App {
        let (_, mut app) = super::design_tests::render_with(w, h);
        let pane = app.snap.terms.get_mut(&1).expect("the focused pane");
        pane.cwd = dir.to_path_buf();
        pane.top = Some(dir.to_path_buf());
        pane.root = Some(dir.to_path_buf());
        // These tests read the whole panel, so it is as wide as the docked one used to be.
        app.screen
            .saved
            .sheet_w
            .insert("drawer".into(), w * 55 / 100);
        app
    }

    /// The tree read, as the background scan would hand it back.
    fn tree_read(app: &mut App, root: &Path) {
        app.on_bg(Bg::Tree(
            root.to_path_buf(),
            views::scan_tree(root),
            views::git_marks(root),
        ));
        preview_read(app);
    }

    /// The selected file read, as the background read would hand it back.
    fn preview_read(app: &mut App) {
        let Some(View::Files(v)) = &mut app.view else {
            return;
        };
        let Some(path) = v.preview_wanted.take() else {
            return;
        };
        let (root, lines) = (v.root.clone(), files::preview(&path));
        app.on_bg(Bg::FilesPreview(root, path, lines));
    }

    fn files(app: &App) -> &views::FilesTree {
        match &app.view {
            Some(View::Files(v)) => v,
            _ => panic!("Files is open"),
        }
    }

    fn key(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
        preview_read(app);
    }

    fn select(app: &mut App, name: &str) {
        let Some(View::Files(v)) = &mut app.view else {
            panic!("Files is open")
        };
        v.expanded.insert(v.root.join("src"));
        v.sel = v
            .visible()
            .iter()
            .position(|(_, n)| n.label == name)
            .expect("the file is listed");
        v.refresh_preview();
        preview_read(app);
    }

    #[test]
    fn a_files_lines_arrive_after_it_is_selected_and_a_late_read_of_another_is_dropped() {
        let dir = project("late-read");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        let Some(View::Files(v)) = &mut app.view else {
            panic!("Files is open")
        };
        v.expanded.insert(v.root.join("src"));
        v.sel = v
            .visible()
            .iter()
            .position(|(_, n)| n.label == "main.rs")
            .expect("the file is listed");
        v.refresh_preview();
        let main = dir.join("src").join("main.rs");
        assert_eq!(v.preview, Some((main.clone(), Vec::new())), "nothing is read on selecting");
        assert_eq!(v.preview_wanted, Some(main.clone()));
        let notes = dir.join("notes.txt");
        app.on_bg(Bg::FilesPreview(dir.clone(), notes.clone(), files::preview(&notes)));
        assert_eq!(files(&app).preview, Some((main.clone(), Vec::new())));
        preview_read(&mut app);
        let shown = files(&app).preview.as_ref().expect("a preview");
        assert_eq!(shown.1.first().map(String::as_str), Some("let line_1 = 1;"));
        assert_eq!(files(&app).preview_wanted, None, "read once");
    }

    #[test]
    fn a_double_click_on_a_file_only_selects_it_and_leaves_the_panel_open() {
        let dir = project("double");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        draw(&mut app, 160, 45);
        let (row, index) = app
            .hits
            .iter()
            .find_map(|(r, h)| match h {
                Hit::Button(Btn::Row(i))
                    if files(&app)
                        .visible()
                        .iter()
                        .any(|(vi, n)| vi == i && n.label == "notes.txt") =>
                {
                    Some((*r, *i))
                }
                _ => None,
            })
            .expect("notes.txt is a row");
        for _ in 0..2 {
            app.on_mouse(crossterm::event::MouseEvent {
                kind: crossterm::event::MouseEventKind::Down(crossterm::event::MouseButton::Left),
                column: row.x + 4,
                row: row.y,
                modifiers: KeyModifiers::NONE,
            });
        }
        assert!(
            matches!(app.view, Some(View::Files(_))),
            "a double-click neither inserts the path nor closes the panel"
        );
        assert_eq!(files(&app).sel, index, "it is the selected file");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn brackets_are_text_while_the_filter_or_the_editor_takes_it() {
        let dir = project("text");
        let mut app = screen_in(&dir, 200, 50);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        key(&mut app, KeyCode::Char('/'));
        key(&mut app, KeyCode::Char('['));
        assert_eq!(files(&app).filter, "[", "the filter took it");
        key(&mut app, KeyCode::Esc);
        select(&mut app, "notes.txt");
        key(&mut app, KeyCode::Char('i'));
        key(&mut app, KeyCode::Char(']'));
        let ed = files(&app).edit.as_ref().expect("editing in place");
        assert!(
            ed.lines[0].starts_with(']'),
            "the editor took it: {:?}",
            ed.lines[0]
        );
        assert!(
            !app.screen.saved.sheet_w.contains_key("files"),
            "the panel kept its width"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_narrow_panel_gives_the_opened_file_the_whole_panel_with_a_way_back() {
        let dir = project("narrow");
        let mut app = screen_in(&dir, 80, 24);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "main.rs");
        let o = draw(&mut app, 80, 24);
        show(&o);
        assert!(
            app.screen.sheet_rect.width < 60,
            "{:?}",
            app.screen.sheet_rect
        );
        assert!(
            o.contains("notes.txt") && !o.contains("let line_1"),
            "the tree alone:\n{o}"
        );
        key(&mut app, KeyCode::Right);
        let o = draw(&mut app, 80, 24);
        show(&o);
        assert!(
            o.contains("let line_1 = 1;") && o.contains('‹') && !o.contains("notes.txt"),
            "the file alone, with ‹ back:\n{o}"
        );
        let back = app
            .hits
            .iter()
            .rev()
            .find(|(_, h)| *h == Hit::Button(Btn::ViewKey('h')))
            .map(|(r, _)| *r)
            .expect("‹ is clickable");
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: back.x,
            row: back.y,
            modifiers: KeyModifiers::NONE,
        });
        app.on_mouse(MouseEvent {
            kind: MouseEventKind::Up(MouseButton::Left),
            column: back.x,
            row: back.y,
            modifiers: KeyModifiers::NONE,
        });
        let o = draw(&mut app, 80, 24);
        assert!(
            o.contains("notes.txt") && !o.contains("let line_1"),
            "‹ goes back to the tree:\n{o}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn click(app: &mut App, at: Rect, modifiers: KeyModifiers) {
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: at.x,
                row: at.y,
                modifiers,
            });
        }
        preview_read(app);
    }

    /// Where a row of the tree is drawn, by its text.
    fn row_at(app: &App, frame: &str, name: &str) -> Rect {
        let y = frame
            .lines()
            .position(|l| l.contains(name))
            .expect("the row is drawn") as u16;
        app.hits
            .iter()
            .rev()
            .find(|(r, _)| r.y == y && r.x >= app.screen.sheet_rect.x)
            .map(|(r, _)| *r)
            .expect("the row is clickable")
    }

    #[test]
    fn ctrl_click_on_a_path_in_a_pane_opens_files_and_again_while_it_is_open() {
        let dir = project("mouse");
        let mut app = screen_in(&dir, 160, 45);
        let mut p = vt100::Parser::new(20, 80, 0);
        p.process(b"see src/main.rs:40\r\nand notes.txt:1\r\n");
        app.parsers.insert(ClientTerm::local(1), p);
        draw(&mut app, 160, 45);
        let (_, inner) = *app
            .panes
            .iter()
            .find(|(t, _)| *t == ClientTerm::local(1))
            .expect("the pane is drawn");
        click(
            &mut app,
            Rect {
                x: inner.x + 6,
                y: inner.y,
                width: 1,
                height: 1,
            },
            KeyModifiers::CONTROL,
        );
        let root = files(&app).root.clone();
        tree_read(&mut app, &root);
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert!(
            o.contains("let line_40 = 40;"),
            "Files opened at that line:\n{o}"
        );
        let (_, inner) = *app
            .panes
            .iter()
            .find(|(t, _)| *t == ClientTerm::local(1))
            .expect("the pane is still beside the panel");
        click(
            &mut app,
            Rect {
                x: inner.x + 6,
                y: inner.y + 1,
                width: 1,
                height: 1,
            },
            KeyModifiers::CONTROL,
        );
        tree_read(&mut app, &dir);
        let o = draw(&mut app, 160, 45);
        show(&o);
        assert_eq!(
            files(&app).preview.as_ref().map(|(p, _)| p.clone()),
            Some(dir.join("notes.txt")),
            "retargeted to the second path"
        );
        assert!(o.contains("remember the milk"), "{o}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn in_a_narrow_panel_a_click_on_the_selected_file_or_a_double_click_opens_it() {
        let dir = project("narrowclick");
        let mut app = screen_in(&dir, 80, 24);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "main.rs");
        let o = draw(&mut app, 80, 24);
        let at = row_at(&app, &o, "main.rs");
        click(&mut app, at, KeyModifiers::NONE);
        let o = draw(&mut app, 80, 24);
        assert!(
            o.contains("let line_1 = 1;") && app.view.is_some(),
            "the selected file opens in the panel:\n{o}"
        );
        key(&mut app, KeyCode::Left);
        let o = draw(&mut app, 80, 24);
        let at = row_at(&app, &o, "notes.txt");
        click(&mut app, at, KeyModifiers::NONE);
        let o = draw(&mut app, 80, 24);
        let at = row_at(&app, &o, "notes.txt");
        click(&mut app, at, KeyModifiers::NONE);
        let o = draw(&mut app, 80, 24);
        show(&o);
        assert!(
            o.contains("remember the milk") && app.view.is_some(),
            "a double-click opens it, not inserts it:\n{o}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn filtering_from_a_file_in_a_narrow_panel_shows_the_tree() {
        let dir = project("filterback");
        let mut app = screen_in(&dir, 80, 24);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "main.rs");
        key(&mut app, KeyCode::Right);
        assert!(files(&app).in_preview, "reading the file");
        key(&mut app, KeyCode::Char('/'));
        assert!(
            files(&app).filtering && !files(&app).in_preview,
            "the filter shows the tree, not the file"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Every block markdown has, then a list of 60 so it scrolls and has a line 42.
    const GUIDE: &str = "# Guide\n\nSome *odd* and **bold** words with `code`.\n\n## Lists\n\n- one\n  - inner\n\n1. first\n2. second\n\n> quoted words\n\n```\nfn main() {}\n```\n\n| name | n |\n|:--|--:|\n| alpha | 1 |\n| b | 200 |\n\nSee [the docs](https://x.dev).\n\n---\n";

    /// `project` plus `GUIDE.md`.
    fn project_with_guide(name: &str) -> PathBuf {
        let dir = project(name);
        let tail: String = (1..=60).map(|i| format!("- para {i}\n")).collect();
        std::fs::write(dir.join("GUIDE.md"), format!("{GUIDE}\n{tail}")).unwrap();
        dir
    }

    fn guide_open(name: &str) -> (PathBuf, App) {
        let dir = project_with_guide(name);
        let mut app = screen_in(&dir, 200, 50);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "GUIDE.md");
        (dir, app)
    }

    /// The frame as text and its cells, for styles.
    fn frame(app: &mut App, w: u16, h: u16) -> (String, ratatui::buffer::Buffer) {
        app.screen_fresh();
        let mut term = ratatui::Terminal::new(ratatui::backend::TestBackend::new(w, h)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        let text = (0..h)
            .map(|y| {
                (0..w)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    .trim_end()
                    .to_string()
                    + "\n"
            })
            .collect();
        (text, buf)
    }

    /// Where `word` starts inside the preview.
    fn at(app: &App, buf: &ratatui::buffer::Buffer, word: &str) -> (u16, u16) {
        let r = app.screen.preview_rect;
        for y in r.top()..r.bottom() {
            let row: String = (r.left()..r.right())
                .map(|x| buf[(x, y)].symbol().to_string())
                .collect();
            if let Some(i) = row.find(word) {
                return (r.left() + row[..i].chars().count() as u16, y);
            }
        }
        panic!("{word} is in the preview")
    }

    fn cell_of<'b>(
        app: &App,
        buf: &'b ratatui::buffer::Buffer,
        word: &str,
    ) -> &'b ratatui::buffer::Cell {
        &buf[at(app, buf, word)]
    }

    #[test]
    fn a_markdown_file_edits_as_its_text_and_scrolls_both_ways() {
        let (dir, mut app) = guide_open("mdedit");
        frame(&mut app, 200, 50);
        key(&mut app, KeyCode::PageDown);
        let (o, _) = frame(&mut app, 200, 50);
        assert!(
            files(&app).scroll > 0 && !o.contains("Guide") && o.contains("• para"),
            "the drawn file pages down:\n{o}"
        );
        key(&mut app, KeyCode::Char('i'));
        let ed = files(&app).edit.as_ref().expect("editing in place");
        assert_eq!(
            ed.lines[0], "# Guide",
            "the editor has the text, not the drawing"
        );
        let (o, _) = frame(&mut app, 200, 50);
        assert!(o.contains("   1  # Guide"), "from the top:\n{o}");
        key(&mut app, KeyCode::Esc);
        let (o, _) = frame(&mut app, 200, 50);
        assert!(
            files(&app).scroll == 0 && o.contains("Guide") && !o.contains("# Guide"),
            "the edit's row isn't taken for a drawn line:\n{o}"
        );
        key(&mut app, KeyCode::Char('m'));
        key(&mut app, KeyCode::PageDown);
        let (o, _) = frame(&mut app, 200, 50);
        assert!(
            files(&app).scroll > 0 && !o.contains("# Guide"),
            "the raw text pages down too:\n{o}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drawn_markdown_is_laid_out_once_and_again_for_a_new_width_or_file() {
        let (dir, mut app) = guide_open("mdcache");
        frame(&mut app, 200, 50);
        // A line the renderer never makes: still there means the last layout was reused.
        let mark = |app: &mut App| {
            let Some(View::Files(v)) = &mut app.view else {
                panic!("Files is open")
            };
            v.drawn_cache.as_mut().expect("laid out").lines.insert(
                0,
                vec![design::seg("SENTINEL", ratatui::style::Style::default())],
            );
        };
        mark(&mut app);
        key(&mut app, KeyCode::PageDown);
        key(&mut app, KeyCode::PageUp);
        let (o, _) = frame(&mut app, 200, 50);
        assert!(
            o.contains("SENTINEL"),
            "the same file, width and theme reuse it:\n{o}"
        );
        let (o, _) = frame(&mut app, 150, 50);
        assert!(
            !o.contains("SENTINEL"),
            "a new width lays it out again:\n{o}"
        );
        mark(&mut app);
        select(&mut app, "notes.txt");
        select(&mut app, "GUIDE.md");
        let (o, _) = frame(&mut app, 150, 50);
        assert!(
            !o.contains("SENTINEL") && o.contains("Guide"),
            "a new preview lays it out again:\n{o}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn e_opens_a_markdown_file_in_your_editor() {
        let (dir, mut app) = guide_open("mdeditor");
        // A terminal editor opens in a new pane: a message to the daemon, not a process here.
        app.cfg.editor = "nvim".into();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        app.out = tx;
        key(&mut app, KeyCode::Char('e'));
        let mut opened = None;
        while let Ok(msg) = rx.try_recv().map(|o| o.msg) {
            use crate::protocol::{ClientMsg, Command};
            if let ClientMsg::Command(
                Command::NewWorkspace { cmd, .. }
                | Command::NewTab { cmd, .. }
                | Command::Split { cmd, .. },
            ) = msg
            {
                opened = cmd;
            }
        }
        assert!(
            opened
                .as_ref()
                .is_some_and(|c| c.starts_with("nvim") && c.contains("GUIDE.md")),
            "{opened:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ctrl_click_on_a_markdown_path_and_line_opens_it_raw_at_that_line() {
        let dir = project_with_guide("mdreveal");
        let mut app = screen_in(&dir, 160, 45);
        app.open_path_from(ClientTerm::local(1), "GUIDE.md", Some(42));
        let root = files(&app).root.clone();
        tree_read(&mut app, &root);
        let (o, _) = frame(&mut app, 160, 45);
        show(&o);
        let source = std::fs::read_to_string(dir.join("GUIDE.md")).unwrap();
        let want = format!("{:>4}  {}", 42, source.lines().nth(41).unwrap());
        assert!(
            want.contains("- para"),
            "line 42 is a line of the list: {want:?}"
        );
        assert!(o.contains(&want), "line 42 is shown with its number:\n{o}");
        assert!(
            !files(&app).drawn(),
            "raw, since drawn lines have no numbers"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// `src/main.rs` open in the editor at 160×45, drawn once so the preview has its place.
    fn editing(name: &str) -> (PathBuf, App) {
        let dir = project(name);
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "main.rs");
        key(&mut app, KeyCode::Char('i'));
        frame(&mut app, 160, 45);
        (dir, app)
    }

    fn edit(app: &App) -> &views::Edit {
        files(app).edit.as_ref().expect("editing")
    }

    fn press(app: &mut App, code: KeyCode, mods: KeyModifiers) {
        app.on_key(KeyEvent::new(code, mods));
        preview_read(app);
    }

    fn mouse(app: &mut App, kind: MouseEventKind, (column, row): (u16, u16)) {
        app.on_mouse(MouseEvent {
            kind,
            column,
            row,
            modifiers: KeyModifiers::NONE,
        });
        preview_read(app);
    }

    #[test]
    fn shift_and_the_arrows_select_in_the_editor_and_typing_replaces_it() {
        let (dir, mut app) = editing("shiftsel");
        for _ in 0..3 {
            press(&mut app, KeyCode::Right, KeyModifiers::SHIFT);
        }
        assert_eq!(
            edit(&app).selection(),
            Some(((0, 0), (0, 3))),
            "three characters"
        );
        let (o, buf) = frame(&mut app, 160, 45);
        show(&o);
        let selected = render::select_style(&app.theme).bg.expect("a ground");
        assert_eq!(
            cell_of(&app, &buf, "let line_1").bg,
            selected,
            "drawn in the selection colour"
        );
        assert_ne!(
            cell_of(&app, &buf, "line_1").bg,
            selected,
            "only what is selected"
        );
        press(&mut app, KeyCode::Char('X'), KeyModifiers::SHIFT);
        assert_eq!(
            edit(&app).lines[0],
            "X line_1 = 1;",
            "typing replaces the selection"
        );
        assert_eq!(edit(&app).selection(), None);
        press(&mut app, KeyCode::Down, KeyModifiers::SHIFT);
        press(&mut app, KeyCode::End, KeyModifiers::SHIFT);
        press(&mut app, KeyCode::Backspace, KeyModifiers::NONE);
        assert_eq!(
            edit(&app).lines[..2],
            ["X", "let line_3 = 3;"],
            "Backspace removes a selection across lines"
        );
        press(&mut app, KeyCode::Left, KeyModifiers::SHIFT);
        press(&mut app, KeyCode::Right, KeyModifiers::NONE);
        assert_eq!(
            edit(&app).selection(),
            None,
            "a move without Shift drops it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ctrl_a_selects_the_whole_file() {
        let (dir, mut app) = editing("selall");
        press(&mut app, KeyCode::Char('a'), KeyModifiers::CONTROL);
        assert_eq!(
            edit(&app).selection(),
            Some(((0, 0), (59, "let line_60 = 60;".len())))
        );
        press(&mut app, KeyCode::Char('z'), KeyModifiers::NONE);
        assert_eq!(edit(&app).lines, ["z"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_mouse_selects_in_the_editor_and_a_click_moves_the_cursor() {
        let (dir, mut app) = editing("mousesel");
        let (_, buf) = frame(&mut app, 160, 45);
        let (from, to) = (at(&app, &buf, "line_1"), at(&app, &buf, "= 3;"));
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), to);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), to);
        assert_eq!(
            edit(&app).selection(),
            Some(((0, 4), (2, 11))),
            "dragged from line 1 to line 3"
        );
        let click = at(&app, &buf, "line_2");
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), click);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), click);
        assert_eq!(
            (edit(&app).row, edit(&app).col, edit(&app).selection()),
            (1, 4, None),
            "a click moves the cursor"
        );
        let word = at(&app, &buf, "line_4");
        for _ in 0..2 {
            mouse(&mut app, MouseEventKind::Down(MouseButton::Left), word);
            mouse(&mut app, MouseEventKind::Up(MouseButton::Left), word);
        }
        assert_eq!(
            edit(&app).selection(),
            Some(((3, 4), (3, 10))),
            "a double-click takes the word"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn last_copy() -> Option<String> {
        copy::LAST_COPY.with(|c| c.borrow().clone())
    }

    /// Ctrl+V, and the clipboard read it starts in the background handed back.
    fn ctrl_v(app: &mut App, rx: &mut mpsc::UnboundedReceiver<Bg>) {
        press(app, KeyCode::Char('v'), KeyModifiers::CONTROL);
        let read = super::branch_view_tests::next_bg(rx);
        app.on_bg(read);
    }

    #[test]
    fn the_folder_picker_lists_a_folder_after_it_is_typed_and_drops_a_late_listing() {
        let dir = project("picker");
        std::fs::create_dir_all(dir.join("src").join(".git")).unwrap();
        let mut fd = screen::Finder::new(&dir);
        assert_eq!(fd.wanted.as_deref(), Some(dir.as_path()));
        assert!(fd.list.is_empty(), "nothing is listed on typing");
        let names = |fd: &screen::Finder| fd.rows().into_iter().map(|(n, _, repo)| (n, repo)).collect::<Vec<_>>();
        assert_eq!(names(&fd), [(".".to_string(), false), ("..".to_string(), false)]);
        let (elsewhere, _) = screen::Finder::list_folders(&dir.join("src"));
        assert!(!fd.listed(&dir.join("src"), elsewhere, true), "another folder's listing");
        let (list, repo) = screen::Finder::list_folders(&dir);
        assert!(fd.listed(&dir, list, repo));
        assert_eq!(
            names(&fd),
            [(".".to_string(), false), ("..".to_string(), false), ("src".to_string(), true)]
        );
    }

    #[test]
    fn ctrl_s_writes_the_file_off_the_ui_thread_and_keeps_what_was_typed_meanwhile() {
        let (dir, mut app) = editing("save");
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.bg = tx;
        let file = dir.join("src").join("main.rs");
        press(&mut app, KeyCode::Char('a'), KeyModifiers::NONE);
        press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
        press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
        press(&mut app, KeyCode::Char('b'), KeyModifiers::NONE);
        let written = super::branch_view_tests::next_bg(&mut rx);
        assert!(rx.try_recv().is_err(), "one save at a time");
        app.on_bg(written);
        assert!(
            std::fs::read_to_string(&file).unwrap().starts_with("alet line_1"),
            "what was there at Ctrl+S is on disk"
        );
        assert!(edit(&app).dirty, "the letter typed while it saved is not");
        assert!(matches!(&app.notice, Some((said, _, _)) if said == "saved main.rs"));
        press(&mut app, KeyCode::Char('s'), KeyModifiers::CONTROL);
        let written = super::branch_view_tests::next_bg(&mut rx);
        app.on_bg(written);
        assert!(std::fs::read_to_string(&file).unwrap().starts_with("ablet line_1"));
        assert!(!edit(&app).dirty && !edit(&app).conflict);
    }

    #[test]
    fn copy_cut_and_paste_round_trip_in_the_editor() {
        let (dir, mut app) = editing("clip");
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.bg = tx;
        for _ in 0..3 {
            press(&mut app, KeyCode::Right, KeyModifiers::SHIFT);
        }
        press(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            last_copy().as_deref(),
            Some("let"),
            "Ctrl+C copies the selection"
        );
        press(&mut app, KeyCode::End, KeyModifiers::NONE);
        ctrl_v(&mut app, &mut rx);
        assert_eq!(
            edit(&app).lines[0],
            "let line_1 = 1;let",
            "Ctrl+V pastes at the cursor"
        );
        press(&mut app, KeyCode::Down, KeyModifiers::NONE);
        press(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
        assert_eq!(
            last_copy().as_deref(),
            Some("let line_2 = 2;\n"),
            "Ctrl+X with nothing selected cuts the line"
        );
        assert_eq!(edit(&app).lines[1], "let line_3 = 3;");
        press(&mut app, KeyCode::Home, KeyModifiers::NONE);
        ctrl_v(&mut app, &mut rx);
        assert_eq!(
            edit(&app).lines[1..3],
            ["let line_2 = 2;", "let line_3 = 3;"],
            "the line comes back whole"
        );
        press(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            last_copy().as_deref(),
            Some("let line_3 = 3;\n"),
            "Ctrl+C with nothing selected copies the line"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_terminals_paste_goes_into_the_editor_as_text() {
        let (dir, mut app) = editing("bracketed");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        for _ in 0..3 {
            press(&mut app, KeyCode::Right, KeyModifiers::SHIFT);
        }
        app.on_event(Event::Paste("one\r\ntwo".into()));
        assert_eq!(
            edit(&app).lines[..2],
            ["one", "two line_1 = 1;"],
            "the paste replaces the selection, its lines kept"
        );
        assert_eq!(
            (edit(&app).row, edit(&app).col),
            (1, 3),
            "the cursor after it"
        );
        app.on_event(Event::Paste(String::new()));
        assert_eq!(
            app.notice.as_ref().map(|(m, _, err)| (m.as_str(), *err)),
            Some((copy::NO_TEXT, true)),
            "an empty paste is no image paste"
        );
        assert!(
            out.try_recv().map(|o| o.msg).is_err(),
            "nothing reached the pane"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ctrl_c_in_the_editor_never_reaches_the_pane() {
        let (dir, mut app) = editing("noint");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        for code in ['c', 'x', 'v', 'a'] {
            press(&mut app, KeyCode::Char(code), KeyModifiers::CONTROL);
        }
        while let Ok(msg) = out.try_recv().map(|o| o.msg) {
            assert!(
                !matches!(msg, ClientMsg::Input { .. }),
                "a key went to the agent: {msg:?}"
            );
        }
        assert!(files(&app).edit.is_some(), "still editing");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dragging_over_the_shown_file_selects_it_and_ctrl_c_copies_it() {
        let dir = project("readsel");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "main.rs");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        let (_, buf) = frame(&mut app, 160, 45);
        let (from, to) = (at(&app, &buf, "line_1"), at(&app, &buf, "= 2;"));
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), to);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), to);
        let (o, buf) = frame(&mut app, 160, 45);
        show(&o);
        let selected = render::select_style(&app.theme).bg.expect("a ground");
        assert_eq!(
            cell_of(&app, &buf, "line_1").bg,
            selected,
            "drawn in the selection colour"
        );
        assert_ne!(
            cell_of(&app, &buf, "= 2;").bg,
            selected,
            "it ends where the drag let go"
        );
        press(&mut app, KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(
            last_copy().as_deref(),
            Some("line_1 = 1;\nlet line_2 "),
            "Ctrl+C copies the selection"
        );
        assert!(
            out.try_recv().map(|o| o.msg).is_err(),
            "Ctrl+C reached no pane"
        );
        key(&mut app, KeyCode::Char('y'));
        assert_eq!(
            last_copy(),
            Some(dir.join("src").join("main.rs").display().to_string()),
            "y still copies the path"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ctrl_z_undoes_a_run_of_typing_at_once_and_ctrl_y_redoes_it() {
        let (dir, mut app) = editing("undo");
        for c in "abc".chars() {
            press(&mut app, KeyCode::Char(c), KeyModifiers::NONE);
        }
        press(&mut app, KeyCode::End, KeyModifiers::NONE);
        press(&mut app, KeyCode::Backspace, KeyModifiers::NONE);
        press(&mut app, KeyCode::Backspace, KeyModifiers::NONE);
        app.on_event(Event::Paste("!".into()));
        assert_eq!(edit(&app).lines[0], "abclet line_1 = !");
        let undo = |app: &mut App| press(app, KeyCode::Char('z'), KeyModifiers::CONTROL);
        undo(&mut app);
        assert_eq!(
            edit(&app).lines[0],
            "abclet line_1 = ",
            "the paste is a step of its own"
        );
        undo(&mut app);
        assert_eq!(
            edit(&app).lines[0],
            "abclet line_1 = 1;",
            "both Backspaces at once"
        );
        undo(&mut app);
        assert_eq!(
            edit(&app).lines[0],
            "let line_1 = 1;",
            "the whole word typed"
        );
        undo(&mut app);
        assert_eq!(
            app.notice.as_ref().map(|(m, _, _)| m.as_str()),
            Some("nothing to undo")
        );
        press(&mut app, KeyCode::Char('y'), KeyModifiers::CONTROL);
        assert_eq!(
            edit(&app).lines[0],
            "abclet line_1 = 1;",
            "Ctrl+Y puts it back"
        );
        press(&mut app, KeyCode::Char('q'), KeyModifiers::NONE);
        press(&mut app, KeyCode::Char('y'), KeyModifiers::CONTROL);
        assert_eq!(
            app.notice.as_ref().map(|(m, _, _)| m.as_str()),
            Some("nothing to redo"),
            "a new change forgets what was undone"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn click_hit(app: &mut App, want: Hit) {
        let r = app
            .hits
            .iter()
            .find_map(|(r, h)| (*h == want).then_some(*r))
            .expect("the button is drawn");
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            mouse(app, kind, (r.x + 1, r.y));
        }
    }

    #[test]
    fn the_editor_has_its_own_buttons_and_they_type_nothing() {
        let (dir, mut app) = editing("buttons");
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.bg = tx;
        let (o, _) = frame(&mut app, 160, 45);
        show(&o);
        let row = o
            .lines()
            .find(|l| l.contains("Save"))
            .expect("the action row");
        for label in [
            "^S", "Save", "^C", "Copy", "^V", "Paste", "^Z", "Undo", "Esc", "Done",
        ] {
            assert!(row.contains(label), "{label} in {row}");
        }
        assert!(
            !o.contains("Edit here") && !o.contains("Insert path"),
            "no file-browser buttons while editing:\n{o}"
        );
        let ctrl = |c: char| Hit::Button(Btn::ViewChord(KeyCode::Char(c), KeyModifiers::CONTROL));
        click_hit(&mut app, ctrl('c'));
        assert_eq!(
            last_copy().as_deref(),
            Some("let line_1 = 1;\n"),
            "Copy copies"
        );
        assert_eq!(edit(&app).lines[0], "let line_1 = 1;", "and types nothing");
        click_hit(&mut app, ctrl('v'));
        let read = super::branch_view_tests::next_bg(&mut rx);
        app.on_bg(read);
        assert_eq!(
            edit(&app).lines[..2],
            ["let line_1 = 1;", "let line_1 = 1;"],
            "Paste pastes"
        );
        click_hit(&mut app, ctrl('z'));
        assert_eq!(
            edit(&app).lines[..2],
            ["let line_1 = 1;", "let line_2 = 2;"],
            "Undo undoes"
        );
        assert!(edit(&app).dirty, "an undo marks the file changed");
        click_hit(&mut app, ctrl('s'));
        let written = super::branch_view_tests::next_bg(&mut rx);
        app.on_bg(written);
        assert!(!edit(&app).dirty, "Save saves");
        assert_eq!(
            std::fs::read_to_string(dir.join("src").join("main.rs"))
                .unwrap()
                .lines()
                .next(),
            Some("let line_1 = 1;")
        );
        click_hit(
            &mut app,
            Hit::Button(Btn::ViewChord(KeyCode::Esc, KeyModifiers::NONE)),
        );
        assert!(files(&app).edit.is_none(), "Done leaves the editor");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// What the next message to the server types into a pane, if anything.
    fn typed(out: &mut mpsc::UnboundedReceiver<Outgoing>) -> Option<String> {
        std::iter::from_fn(|| out.try_recv().map(|o| o.msg).ok()).find_map(|m| match m {
            ClientMsg::Input { data, .. } => Some(String::from_utf8_lossy(&data).into_owned()),
            _ => None,
        })
    }

    /// An empty paste started an image paste: its background read came back and said so.
    fn image_paste_tried(app: &mut App, rx: &mut mpsc::UnboundedReceiver<Bg>) -> bool {
        let read = super::branch_view_tests::next_bg(rx);
        app.on_bg(read);
        app.notice
            .as_ref()
            .is_some_and(|(m, _, _)| m == "there's no image on the clipboard")
    }

    #[test]
    fn pastes_still_reach_the_pane_whenever_files_does_not_have_the_keys() {
        let (dir, mut app) = editing("pastepane");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        let (btx, mut bg) = mpsc::unbounded_channel();
        app.bg = btx;
        let pane = app
            .pane_frames
            .iter()
            .find(|(t, _)| *t == ClientTerm::local(1))
            .map(|(_, r)| *r)
            .expect("the pane beside the panel");
        // The panel floats over the pane's right side: click on its left.
        let inside = (pane.x + 3, pane.y + pane.height / 2);
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), inside);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), inside);
        assert!(!app.view_has_keys(), "the click set the editor aside");
        app.on_event(Event::Paste("x".into()));
        assert_eq!(
            typed(&mut out).as_deref(),
            Some("x"),
            "set aside: the pane gets it"
        );
        app.on_event(Event::Paste(String::new()));
        assert!(
            image_paste_tried(&mut app, &mut bg),
            "set aside: an empty paste is the pane's image paste"
        );
        click_hit(
            &mut app,
            Hit::Button(Btn::ViewChord(KeyCode::Esc, KeyModifiers::NONE)),
        );
        assert!(
            app.view_has_keys() && files(&app).edit.is_none(),
            "Esc left the editor; Files has the keys"
        );
        app.on_event(Event::Paste("x".into()));
        assert_eq!(
            typed(&mut out),
            None,
            "Files with the keys keeps a paste from the pane"
        );
        key(&mut app, KeyCode::Esc);
        assert!(app.view.is_none(), "Files closed");
        app.on_event(Event::Paste("x".into()));
        assert_eq!(
            typed(&mut out).as_deref(),
            Some("x"),
            "closed: the pane gets it"
        );
        app.on_event(Event::Paste(String::new()));
        assert!(
            image_paste_tried(&mut app, &mut bg),
            "closed: an empty paste is the image paste"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_paste_while_files_filters_goes_into_the_filter() {
        let dir = project("pastefilter");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        key(&mut app, KeyCode::Char('/'));
        app.on_event(Event::Paste("notes\nsecond line".into()));
        assert_eq!(files(&app).filter, "notes", "its first line");
        assert_eq!(
            files(&app).preview.as_ref().map(|(p, _)| p.clone()),
            Some(dir.join("notes.txt")),
            "the match is shown"
        );
        app.on_event(Event::Paste(String::new()));
        assert_eq!(typed(&mut out), None, "nothing reached the pane");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Keys as the Windows console hands them over in one read: a press and a release each.
    pub(super) fn burst(s: &str) -> Vec<Event> {
        s.chars()
            .flat_map(|c| {
                let press = KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE);
                [
                    Event::Key(press),
                    Event::Key(KeyEvent {
                        kind: ratatui::crossterm::event::KeyEventKind::Release,
                        ..press
                    }),
                ]
            })
            .collect()
    }

    #[test]
    fn a_short_paste_read_as_keys_runs_no_files_command() {
        let dir = project("shortpaste");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "notes.txt");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        // `r/` rather than the `eyo` of the report: run as keys, those would launch an editor
        // and an app and write the clipboard; these only change Files.
        app.on_burst(burst("r/"));
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(m, _, _)| m.starts_with("Files has the keys")),
            "taken as a paste"
        );
        assert!(
            !files(&app).recent && !files(&app).filtering,
            "not run as r and /"
        );
        assert_eq!(typed(&mut out), None, "nothing reached the pane");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_held_key_read_in_one_burst_still_moves_in_files() {
        let dir = project("heldkey");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "src");
        let from = files(&app).sel;
        app.on_burst(burst("jj"));
        assert_eq!(files(&app).sel, from + 2, "two moves down, not a paste");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_release_outside_the_window_ends_the_selection_drag() {
        let (dir, mut app) = editing("staledrag");
        let (_, buf) = frame(&mut app, 160, 45);
        let from = at(&app, &buf, "line_1");
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
        assert!(files(&app).dragging);
        mouse(&mut app, MouseEventKind::Moved, (0, 0));
        assert!(!files(&app).dragging, "moving with no button held ends it");
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), (0, 44));
        assert!(!files(&app).dragging, "a press elsewhere ends it");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn below_the_last_line_the_pointer_means_the_end_of_the_file() {
        let dir = project("pastend");
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "notes.txt");
        key(&mut app, KeyCode::Char('i'));
        let (_, buf) = frame(&mut app, 160, 45);
        let below = (app.screen.preview_rect.x + 2, app.screen.preview_rect.y + 5);
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), below);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), below);
        assert_eq!(
            (edit(&app).row, edit(&app).col),
            (0, "remember the milk".len()),
            "a click below a short file: its end"
        );
        let word = at(&app, &buf, "the milk");
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), word);
        let past = (word.0, app.screen.preview_rect.bottom() + 1);
        mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), past);
        assert_eq!(
            edit(&app).selection(),
            Some(((0, 9), (0, 17))),
            "a drag past the end takes the rest of the last line"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn undo_treats_typing_over_a_selection_and_a_line_cut_as_one_step_each() {
        let (dir, mut app) = editing("undosteps");
        for _ in 0..3 {
            press(&mut app, KeyCode::Right, KeyModifiers::SHIFT);
        }
        for c in "var".chars() {
            press(&mut app, KeyCode::Char(c), KeyModifiers::NONE);
        }
        assert_eq!(edit(&app).lines[0], "var line_1 = 1;");
        press(&mut app, KeyCode::Char('z'), KeyModifiers::CONTROL);
        assert_eq!(
            edit(&app).lines[0],
            "let line_1 = 1;",
            "one Ctrl+Z undoes the replacing and the typing"
        );
        press(&mut app, KeyCode::Down, KeyModifiers::NONE);
        press(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press(&mut app, KeyCode::Right, KeyModifiers::NONE);
        press(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
        press(&mut app, KeyCode::Char('z'), KeyModifiers::CONTROL);
        assert_eq!(
            (edit(&app).lines[1].as_str(), edit(&app).row, edit(&app).col),
            ("let line_2 = 2;", 1, 5),
            "the line back, the cursor where it was"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ctrl_x_in_an_empty_file_does_nothing() {
        let dir = project("emptycut");
        std::fs::write(dir.join("empty.txt"), "").unwrap();
        let mut app = screen_in(&dir, 160, 45);
        app.act(Action::Files);
        tree_read(&mut app, &dir);
        select(&mut app, "empty.txt");
        key(&mut app, KeyCode::Char('i'));
        app.notice = None;
        press(&mut app, KeyCode::Char('x'), KeyModifiers::CONTROL);
        assert!(
            app.notice.is_none() && !edit(&app).dirty,
            "no cut, no toast"
        );
        press(&mut app, KeyCode::Char('z'), KeyModifiers::CONTROL);
        assert_eq!(
            app.notice.as_ref().map(|(m, _, _)| m.as_str()),
            Some("nothing to undo"),
            "and no undo step"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

mod branch_view_tests {
    use super::check_settings_tests::{draw, show};
    use super::*;
    use crate::client::menu::Act;

    const BACKGROUND_RESULT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

    fn leader(app: &mut App, c: char) {
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }

    fn key(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn sheet(app: &App) -> Option<&screen::BranchSheet> {
        match &app.view {
            Some(View::Branch(v)) => Some(v),
            _ => None,
        }
    }

    /// A repo on `main` with a commit, on a feature branch one commit ahead, with a snapshot.
    fn repo(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "{APP_COMMAND}-branch-view-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| crate::proc::git(&dir, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(dir.join("a.txt"), "1").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "start the shop"]);
        git(&["switch", "-qc", "fix-footer"]);
        std::fs::write(dir.join("a.txt"), "2").unwrap();
        git(&["commit", "-qam", "fix the footer links"]);
        std::fs::write(dir.join("a.txt"), "3").unwrap();
        crate::snapshot::take(&dir, "before claude's turn").unwrap();
        dir
    }

    /// Background work the app queues comes here instead of being dropped.
    fn catch_bg(app: &mut App) -> mpsc::UnboundedReceiver<Bg> {
        let (tx, rx) = mpsc::unbounded_channel();
        app.bg = tx;
        app.run_background_jobs_inline = true;
        rx
    }

    /// The next background result, waited for on the channel itself. The limit only turns a
    /// job that never answers into a failure; a busy machine running tests in parallel can take
    /// seconds to finish a git read.
    pub(super) fn next_bg(rx: &mut mpsc::UnboundedReceiver<Bg>) -> Bg {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("a runtime to wait on the channel")
            .block_on(async { tokio::time::timeout(BACKGROUND_RESULT_TIMEOUT, rx.recv()).await })
            .expect("no background work was queued")
            .expect("the app keeps its end of the background channel")
    }

    /// The app with session 1 in `dir` and its Branch view open, git's answer landed from the
    /// background task.
    fn opened(dir: &std::path::Path, w: u16, h: u16) -> (App, mpsc::UnboundedReceiver<Bg>) {
        let (_, mut app) = super::design_tests::render_with(w, h);
        let mut rx = catch_bg(&mut app);
        app.snap.terms.get_mut(&1).unwrap().top = Some(dir.to_path_buf());
        leader(&mut app, 'v');
        assert!(
            sheet(&app).is_some_and(|v| v.dir == dir && v.facts.is_none()),
            "the leader's v opens the Branch view, reading git"
        );
        let b = next_bg(&mut rx);
        app.on_bg(b);
        assert!(
            matches!(
                sheet(&app).and_then(|v| v.facts.as_ref()),
                Some(screen::Facts::Repo(_))
            ),
            "git's answer landed"
        );
        (app, rx)
    }

    #[test]

    fn v_opens_branch_in_the_side_panel_and_v_or_esc_closes_it() {
        let (_, mut app) = super::design_tests::render_with(200, 50);
        leader(&mut app, 'v');
        assert!(
            sheet(&app).is_some() && app.mode == Mode::Normal,
            "the view has the keys: {:?}",
            app.mode
        );
        let o = draw(&mut app, 200, 50);
        show(&o);
        assert!(
            o.lines().any(|l| l.contains("│  branch")) && o.contains("Switch branch…"),
            "in the side panel"
        );
        assert_eq!(app.screen.sheet_rect.width, 60, "30% of the screen");
        key(&mut app, KeyCode::Char(']'));
        assert_eq!(
            app.screen.saved.sheet_w.get("drawer"),
            Some(&64),
            "its width is remembered for the tools panel, which Branches shares with Files and Changes"
        );
        key(&mut app, KeyCode::Char('v'));
        assert!(
            sheet(&app).is_none() && matches!(app.mode, Mode::Prefix { .. }),
            "v closes it, back to shortcut mode"
        );
        key(&mut app, KeyCode::Char('v'));
        assert!(sheet(&app).is_some(), "the leader's v opens it again");
        key(&mut app, KeyCode::Esc);
        assert!(
            sheet(&app).is_none() && matches!(app.mode, Mode::Prefix { .. }),
            "Esc closes it, back to shortcut mode"
        );
    }

    #[test]
    fn opened_from_shortcut_mode_its_keys_reach_it_and_k_types_nothing() {
        let (mut app, mut out) = super::check_settings_tests::app_with_channel();
        leader(&mut app, 'v');
        while out.try_recv().map(|o| o.msg).is_ok() {}
        // k is the leader's stop-the-agent: here it moves up, and nothing goes to a pane.
        key(&mut app, KeyCode::Char('k'));
        let sent: Vec<ClientMsg> =
            std::iter::from_fn(|| out.try_recv().map(|o| o.msg).ok()).collect();
        assert!(
            !sent.iter().any(|m| matches!(m, ClientMsg::Input { .. })),
            "nothing typed into a pane: {sent:?}"
        );
        key(&mut app, KeyCode::Down);
        key(&mut app, KeyCode::Enter);
        assert!(
            matches!(app.mode, Mode::Branch(_)),
            "Enter on Switch branch… opens the switcher: {:?}",
            std::mem::discriminant(&app.mode)
        );
    }

    #[test]
    fn an_answer_for_another_folder_is_dropped_and_a_switch_or_restore_reads_again() {
        let dir = repo("reload");
        let (mut app, mut rx) = opened(&dir, 160, 45);
        let before = sheet(&app).unwrap().facts.clone();
        app.branch_facts_arrived(&dir.join("elsewhere"), screen::Facts::NotGit);
        assert_eq!(sheet(&app).unwrap().facts, before, "not this view's folder");
        app.on_bg(Bg::Switched(Ok("now on main".into())));
        let b = next_bg(&mut rx);
        app.on_bg(b);
        let Some(screen::Facts::Repo(r)) = &sheet(&app).unwrap().facts else {
            panic!("a repo")
        };
        assert_eq!(r.branch, "fix-footer", "read again after the switch");
        let s = r.snapshots[0].clone();
        std::fs::write(dir.join("a.txt"), "4").unwrap();
        app.menu_do(Act::Restore(
            dir.clone(),
            s.commit,
            "now".into(),
            ClientTerm::local(1),
        ));
        let restored = next_bg(&mut rx);
        app.on_bg(restored);
        let b = next_bg(&mut rx);
        app.on_bg(b);
        let Some(screen::Facts::Repo(r)) = &sheet(&app).unwrap().facts else {
            panic!("a repo")
        };
        assert_eq!(
            r.snapshots.len(),
            2,
            "read again after the restore: it kept one before it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enter_on_its_first_row_opens_the_switcher_and_on_a_snapshot_asks_to_restore() {
        let dir = repo("enter");
        let (mut app, _rx) = opened(&dir, 160, 45);
        draw(&mut app, 160, 45);
        key(&mut app, KeyCode::Enter);
        assert!(
            matches!(&app.mode, Mode::Branch(v) if v.dir == dir),
            "the switcher: {:?}",
            app.mode
        );
        key(&mut app, KeyCode::Esc);
        assert!(
            app.mode == Mode::Normal && sheet(&app).is_some(),
            "Esc leaves the switcher for the Branch view"
        );
        key(&mut app, KeyCode::Down);
        key(&mut app, KeyCode::Enter);
        let Mode::Confirm(c) = &app.mode else {
            panic!("a restore asks first: {:?}", app.mode)
        };
        let Act::Restore(at, _, when, term) = &c.act else {
            panic!("{:?}", c.act)
        };
        assert!(
            at == &dir
                && *term == ClientTerm::local(1)
                && when.ends_with("ago · before claude's turn")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

mod leader_key_tests {
    use super::*;

    fn leader(app: &mut App, code: KeyCode, mods: KeyModifiers) {
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(code, mods));
    }

    /// A fresh git repo the focused pane runs in.
    fn in_repo(app: &mut App, tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("{APP_COMMAND}-leader-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        crate::proc::git(&dir, &["init", "-q"]).unwrap();
        let pane = app.snap.terms.get_mut(&1).expect("the focused pane");
        pane.cwd = dir.clone();
        pane.top = Some(dir.clone());
        dir
    }

    #[test]
    fn a_key_after_the_leader_does_its_job_and_an_unbound_one_does_nothing() {
        type Want = fn(&App) -> bool;
        let all_keys: Want =
            |app| matches!(&app.mode, Mode::KeyMap(km) if km.view == screen::KeyView::All);
        let nothing: Want = |app| app.view.is_none() && matches!(app.mode, Mode::Prefix { .. });
        let changes: Want = |app| matches!(app.view, Some(View::Changes(_)));
        // (key, modifiers, needs a git repo, what it should do, check)
        let cases: [(KeyCode, KeyModifiers, bool, &str, Want); 5] = [
            (KeyCode::Char('c'), KeyModifiers::NONE, true, "c opens Changes", changes),
            (KeyCode::Char('?'), KeyModifiers::SHIFT, false, "? with Shift opens all keys", all_keys),
            (KeyCode::Char('?'), KeyModifiers::NONE, false, "? without Shift opens all keys", all_keys),
            (KeyCode::F(1), KeyModifiers::NONE, false, "F1 is unbound", nothing),
            (KeyCode::Char('d'), KeyModifiers::NONE, false, "d is unbound", nothing),
        ];
        for (code, mods, repo, what, want) in cases {
            let (_, mut app) = super::design_tests::render_with(160, 45);
            let dir = repo.then(|| in_repo(&mut app, "c"));
            leader(&mut app, code, mods);
            assert!(want(&app), "{what}: {:?}", app.mode);
            if let Some(dir) = dir {
                let _ = std::fs::remove_dir_all(&dir);
            }
        }
    }

    #[test]
    fn copy_mode_has_a_key_and_search_commands_still_finds_it() {
        let (_, app) = super::design_tests::render_with(160, 45);
        assert!(
            app.keymap.prefixed.values().any(|a| *a == Action::CopyMode),
            "leader y"
        );
        let km = screen::KeyMap {
            query: "select text".into(),
            ..screen::KeyMap::new(screen::KeyView::Search, None)
        };
        assert!(
            screen::keymap_actions(&app, &km).contains(&Some(Action::CopyMode)),
            "Search commands lists it"
        );
    }

    #[test]
    fn an_old_config_binding_keys_by_action_name_still_loads() {
        let (_, mut app) = super::design_tests::render_with(160, 45);
        for (key, action) in [("d", "changes"), ("f1", "help"), ("y", "copy-mode")] {
            app.cfg.keys.prefix.insert(key.into(), action.into());
        }
        app.keymap = app.cfg.keymap();
        let bound = |k: &str| app.keymap.prefixed.get(&k.parse().unwrap()).cloned();
        assert_eq!(bound("d"), Some(Action::Changes));
        assert_eq!(bound("f1"), Some(Action::Help));
        assert_eq!(bound("y"), Some(Action::CopyMode));
    }
}

/// The drawer that floats over the terminal.
mod drawer_tests {
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;

    const W: u16 = 172;
    const H: u16 = 56;

    /// The main screen with the drawer floating, and the focused pane in a git repo.
    fn app() -> App {
        let (_, mut app) = super::design_tests::render_with(W, H);
        let dir = maitty_test_support::TempFolder::new("rail").until_test_ends();
        crate::proc::git(&dir, &["init", "-q"]).unwrap();
        std::fs::write(dir.join("notes.txt"), "remember the milk\n").unwrap();
        let pane = app.snap.terms.get_mut(&1).expect("the focused pane");
        pane.cwd = dir.clone();
        pane.top = Some(dir.clone());
        pane.root = Some(dir);
        app
    }

    fn draw(app: &mut App) -> Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(W, H)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    fn click(app: &mut App, r: Rect) {
        for kind in [
            MouseEventKind::Down(MouseButton::Left),
            MouseEventKind::Up(MouseButton::Left),
        ] {
            app.on_mouse(MouseEvent {
                kind,
                column: r.x + 1,
                row: r.y,
                modifiers: KeyModifiers::NONE,
            });
        }
    }

    #[test]
    fn a_click_on_a_session_row_opens_it_and_leaves_the_keys_in_its_pane() {
        let mut app = app();
        draw(&mut app);
        let row = app
            .hits
            .iter()
            .find_map(|(r, h)| matches!(h, Hit::Screen(screen::ScreenHit::Session(_))).then_some(*r))
            .expect("a session row");
        click(&mut app, row);
        assert!(
            matches!(app.mode, Mode::Normal),
            "as a click on a tab's row does: no sidebar mode, {:?}",
            std::mem::discriminant(&app.mode)
        );
        assert_eq!(app.screen.cursor, None, "the sidebar holds no cursor");
    }
}

mod drawer_tab_tests {
    use super::branch_view_tests::next_bg;
    use super::*;
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::buffer::Buffer;

    const W: u16 = 200;
    const H: u16 = 50;

    /// The main screen with the focused pane in a fresh git repo of its own.
    fn in_repo(tag: &str) -> (App, PathBuf) {
        let (_, mut app) = super::design_tests::render_with(W, H);
        let dir =
            std::env::temp_dir().join(format!("{APP_COMMAND}-drawer-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        crate::proc::git(&dir, &["init", "-q"]).unwrap();
        std::fs::write(dir.join("notes.txt"), "remember the milk\n").unwrap();
        let pane = app.snap.terms.get_mut(&1).expect("the focused pane");
        pane.cwd = dir.clone();
        pane.top = Some(dir.clone());
        pane.root = Some(dir.clone());
        (app, dir)
    }

    fn draw(app: &mut App) -> Buffer {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(W, H)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        term.backend().buffer().clone()
    }

    fn text(buf: &Buffer) -> String {
        (0..H)
            .map(|y| {
                (0..W)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    + "\n"
            })
            .collect()
    }

    fn open(app: &App) -> Option<screen::SheetKind> {
        screen::open_sheet(app)
    }

    fn key(app: &mut App, code: KeyCode, mods: KeyModifiers) {
        app.on_key(KeyEvent::new(code, mods));
    }

    #[test]
    fn tab_and_shift_tab_cycle_files_changes_branch_and_references() {
        let (mut app, dir) = in_repo("cycle");
        app.act(Action::Files);
        use screen::SheetKind::{Branch, Changes, Files, References};
        for want in [Changes, Branch, References, Files] {
            key(&mut app, KeyCode::Tab, KeyModifiers::NONE);
            assert_eq!(open(&app), Some(want), "Tab");
            assert!(app.view_has_keys(), "the new view has the keys");
        }
        for want in [References, Branch, Changes, Files] {
            key(&mut app, KeyCode::BackTab, KeyModifiers::SHIFT);
            assert_eq!(open(&app), Some(want), "Shift+Tab");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tab_is_text_while_files_filters_or_edits() {
        let (mut app, dir) = in_repo("typing");
        app.act(Action::Files);
        let Some(View::Files(v)) = &mut app.view else {
            panic!("Files is open")
        };
        v.filtering = true;
        key(&mut app, KeyCode::Tab, KeyModifiers::NONE);
        assert_eq!(
            open(&app),
            Some(screen::SheetKind::Files),
            "the filter keeps it"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Nothing typed into a pane since the last look.
    fn no_input(out: &mut mpsc::UnboundedReceiver<Outgoing>) -> bool {
        std::iter::from_fn(|| out.try_recv().map(|o| o.msg).ok())
            .all(|m| !matches!(m, ClientMsg::Input { .. }))
    }

    #[test]
    fn a_burst_in_changes_stays_its_keys_and_never_reaches_the_pane() {
        let (mut app, dir) = in_repo("burst");
        crate::proc::git(&dir, &["add", "."]).unwrap();
        crate::proc::git(
            &dir,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "-m",
                "first",
            ],
        )
        .unwrap();
        for f in ["a.txt", "b.txt", "c.txt"] {
            std::fs::write(dir.join(f), "new\n").unwrap();
        }
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        let (btx, mut bg) = mpsc::unbounded_channel();
        app.bg = btx;
        app.act(Action::Changes);
        let sel = |app: &App| match &app.view {
            Some(View::Changes(v)) => (v.order(), v.review.as_ref().map(|r| r.sel)),
            _ => panic!("Changes is open"),
        };
        // Other background work may come back first.
        while sel(&app).1.is_none() {
            let read = super::branch_view_tests::next_bg(&mut bg);
            app.on_bg(read);
        }
        let (order, first) = sel(&app);
        assert!(
            order.len() >= 3 && first == Some(order[0]),
            "the files are read: {order:?}"
        );
        app.on_burst(super::files_panel_tests::burst("jjk"));
        assert_eq!(sel(&app).1, Some(order[1]), "down, down, up: run as keys");
        assert!(no_input(&mut out), "nothing typed into the pane");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_paste_with_branch_open_never_reaches_the_pane() {
        let (mut app, dir) = in_repo("bpaste");
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        app.act(Action::Branches);
        assert_eq!(open(&app), Some(screen::SheetKind::Branch));
        app.on_event(Event::Paste("jk\n".into()));
        assert!(no_input(&mut out), "nothing typed into the pane");
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(m, _, _)| m.starts_with("the side panel has the keys")),
            "it says why"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn r_switches_files_to_recent_files_and_back() {
        let (mut app, dir) = in_repo("recent");
        app.act(Action::Files);
        key(&mut app, KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(
            matches!(&app.view, Some(View::Files(v)) if v.recent),
            "r shows recent files"
        );
        assert!(
            text(&draw(&mut app)).contains("r project"),
            "the hint says r"
        );
        key(&mut app, KeyCode::Char('r'), KeyModifiers::NONE);
        assert!(
            matches!(&app.view, Some(View::Files(v)) if !v.recent),
            "r again shows the project"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn d_in_files_does_not_open_changes() {
        let (mut app, dir) = in_repo("nod");
        app.act(Action::Files);
        key(&mut app, KeyCode::Char('d'), KeyModifiers::NONE);
        assert_eq!(
            open(&app),
            Some(screen::SheetKind::Files),
            "Changes is c, not d"
        );
        assert!(
            !text(&draw(&mut app)).contains("Show diff"),
            "no button offers it either"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Changes open on a repo with one commit and one new file, its review read.
    fn changes_with_a_new_file(tag: &str) -> (App, PathBuf, mpsc::UnboundedReceiver<Bg>) {
        let (mut app, dir) = in_repo(tag);
        let git = |args: &[&str]| crate::proc::git(&dir, args).unwrap();
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        git(&["add", "."]);
        git(&["commit", "-qm", "start"]);
        std::fs::write(dir.join("new.txt"), "fresh\n").unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.bg = tx;
        app.act(Action::Changes);
        let b = next_bg(&mut rx);
        app.on_bg(b);
        assert!(
            matches!(&app.view, Some(View::Changes(v)) if v.review.is_some()),
            "Changes read the repo"
        );
        (app, dir, rx)
    }

    fn commits(dir: &std::path::Path) -> usize {
        crate::proc::git(dir, &["rev-list", "--count", "HEAD"])
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    #[test]
    fn ctrl_enter_in_changes_commits_the_picked_files_with_the_message_shown() {
        let (mut app, dir, mut rx) = changes_with_a_new_file("commit");
        let shown = text(&draw(&mut app));
        let suggested = match &app.view {
            Some(View::Changes(v)) => v.message_text(),
            _ => String::new(),
        };
        assert!(!suggested.is_empty(), "the message is written for you");
        assert!(
            shown.contains("Commit 1 of 1") && shown.contains(&suggested),
            "the message and what it commits are on screen: {shown}"
        );
        key(&mut app, KeyCode::Char('m'), KeyModifiers::NONE);
        key(&mut app, KeyCode::Char('!'), KeyModifiers::NONE);
        assert!(rx.try_recv().is_err() && commits(&dir) == 1, "nothing is committed yet");
        key(&mut app, KeyCode::Enter, KeyModifiers::CONTROL);
        let b = next_bg(&mut rx);
        app.on_bg(b);
        assert_eq!(commits(&dir), 2, "Ctrl+Enter commits");
        let subject = crate::proc::git(&dir, &["log", "-1", "--format=%s"]).unwrap();
        assert_eq!(subject.trim(), format!("{suggested}!"), "with the message as written");
        assert_eq!(app.notice.as_ref().map(|(m, ..)| m.starts_with("Committed 1 file on ")), Some(true));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tab_answers_no_to_a_changes_question_instead_of_switching() {
        let (mut app, dir, mut rx) = changes_with_a_new_file("ask-tab");
        // Writing the message, Tab is not a drawer key; Esc stops editing.
        key(&mut app, KeyCode::Char('m'), KeyModifiers::NONE);
        key(&mut app, KeyCode::Tab, KeyModifiers::NONE);
        assert!(
            matches!(&app.view, Some(View::Changes(v)) if v.extra.message.is_some()),
            "still writing in Changes"
        );
        key(&mut app, KeyCode::Esc, KeyModifiers::NONE);
        key(&mut app, KeyCode::Char('M'), KeyModifiers::NONE);
        key(&mut app, KeyCode::Tab, KeyModifiers::NONE);
        assert!(
            matches!(&app.view, Some(View::Changes(v)) if v.confirm.is_none() && v.extra.message.is_none()),
            "still Changes, the question answered no"
        );
        assert!(
            rx.try_recv().is_err() && commits(&dir) == 1,
            "nothing is committed"
        );
        key(&mut app, KeyCode::Tab, KeyModifiers::NONE);
        assert_eq!(
            open(&app),
            Some(screen::SheetKind::Branch),
            "with no question, Tab switches"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod references_view_tests {
    use super::branch_view_tests::next_bg;
    use super::check_settings_tests::{draw, show};
    use super::*;

    fn leader(app: &mut App, c: char) {
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
    }

    fn key(app: &mut App, code: KeyCode) {
        app.on_key(KeyEvent::new(code, KeyModifiers::NONE));
    }

    fn sheet(app: &App) -> Option<&screen::ReferencesSheet> {
        match &app.view {
            Some(View::References(v)) => Some(v),
            _ => None,
        }
    }

    /// A folder outside git for session 1, with `files` in its references (name, seconds old).
    fn project(tag: &str, files: &[(&str, u64)]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "{APP_COMMAND}-refs-view-{tag}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let refs = crate::references::folder(&dir);
        std::fs::create_dir_all(&refs).unwrap();
        for (name, ago) in files {
            let p = refs.join(name);
            std::fs::write(&p, vec![0u8; 2048]).unwrap();
            let at = std::time::SystemTime::now() - std::time::Duration::from_secs(*ago);
            std::fs::File::options()
                .write(true)
                .open(&p)
                .unwrap()
                .set_modified(at)
                .unwrap();
        }
        dir
    }

    /// The app at w✕h with session 1 in `dir` and References open, the folder read.
    fn opened(dir: &std::path::Path, w: u16, h: u16) -> (App, mpsc::UnboundedReceiver<Bg>) {
        let (_, mut app) = super::design_tests::render_with(w, h);
        let (tx, mut rx) = mpsc::unbounded_channel();
        app.bg = tx;
        let pane = app.snap.terms.get_mut(&1).unwrap();
        pane.cwd = dir.to_path_buf();
        pane.top = Some(dir.to_path_buf());
        // Unknown to the snapshot: the background read finds the project from the folder.
        pane.root = None;
        leader(&mut app, 'e');
        assert!(
            sheet(&app).is_some_and(|v| v.list.is_none()),
            "e opens References, reading the folder"
        );
        let b = next_bg(&mut rx);
        app.on_bg(b);
        (app, rx)
    }

    fn names(app: &App) -> Vec<String> {
        match sheet(app).and_then(|v| v.list.clone()) {
            Some(Ok(l)) => l.items.into_iter().map(|r| r.name).collect(),
            other => panic!("a list: {other:?}"),
        }
    }

    #[test]
    fn references_are_listed_newest_first_with_kind_size_and_age() {
        let dir = project(
            "list",
            &[
                ("old-home.png", 7200),
                ("checkout.fig", 120),
                ("brief.pdf", 5),
            ],
        );
        let (mut app, _rx) = opened(&dir, 160, 45);
        assert_eq!(names(&app), ["brief.pdf", "checkout.fig", "old-home.png"]);
        let o = draw(&mut app, 160, 45);
        show(&o);
        let row = |name: &str| {
            o.lines()
                .find(|l| l.contains(name))
                .unwrap_or_else(|| panic!("{name}:\n{o}"))
                .to_string()
        };
        let old = row("old-home.png");
        assert!(
            old.contains("image") && old.contains("2 KB") && old.contains(" 2h"),
            "{old}"
        );
        assert!(row("checkout.fig").contains("design"));
        assert!(
            o.find("brief.pdf").unwrap() < o.find("old-home.png").unwrap(),
            "newest on top"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_asks_first_then_deletes_the_file() {
        let dir = project("remove", &[("a.png", 10), ("b.png", 20)]);
        let (mut app, mut rx) = opened(&dir, 160, 45);
        key(&mut app, KeyCode::Down);
        key(&mut app, KeyCode::Char('d'));
        let Mode::Confirm(c) = &app.mode else {
            panic!("asked first: {:?}", std::mem::discriminant(&app.mode))
        };
        assert!(c.danger && c.what == "b.png", "{c:?}");
        assert!(
            crate::references::folder(&dir).join("b.png").exists(),
            "nothing gone before the answer"
        );
        key(&mut app, KeyCode::Enter);
        let done = next_bg(&mut rx);
        app.on_bg(done);
        assert!(
            !crate::references::folder(&dir).join("b.png").exists(),
            "removed"
        );
        let reread = next_bg(&mut rx);
        app.on_bg(reread);
        assert_eq!(names(&app), ["a.png"], "the list reads again");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn n_copies_a_typed_or_dropped_file_in() {
        let dir = project("add", &[]);
        let src = dir.join("hero shot.png");
        std::fs::write(&src, "png").unwrap();
        let (mut app, mut rx) = opened(&dir, 160, 45);
        key(&mut app, KeyCode::Char('n'));
        assert!(
            matches!(
                app.mode,
                Mode::Prompt {
                    kind: PromptKind::AddReference(..),
                    ..
                }
            ),
            "n asks for a path"
        );
        app.on_event(Event::Paste(format!("\"{}\"", src.display())));
        key(&mut app, KeyCode::Enter);
        let added = next_bg(&mut rx);
        app.on_bg(added);
        let reread = next_bg(&mut rx);
        app.on_bg(reread);
        assert_eq!(names(&app), ["hero shot.png"]);
        assert!(src.exists(), "copied, not moved");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn references_takes_its_own_paste_and_a_burst_stays_keys_never_reaching_the_pane() {
        let dir = project("ownpaste", &[]);
        let src = dir.join("mock.png");
        std::fs::write(&src, "png").unwrap();
        let (mut app, mut rx) = opened(&dir, 160, 45);
        let (tx, mut out) = mpsc::unbounded_channel();
        app.out = tx;
        app.on_burst(super::files_panel_tests::burst("jk"));
        assert!(
            app.notice.is_none(),
            "a short burst is keys here, not a paste"
        );
        app.on_event(Event::Paste(src.display().to_string()));
        let added = next_bg(&mut rx);
        app.on_bg(added);
        let reread = next_bg(&mut rx);
        app.on_bg(reread);
        assert_eq!(
            names(&app),
            ["mock.png"],
            "References added it, not the side-panel guard"
        );
        let typed = std::iter::from_fn(|| out.try_recv().map(|o| o.msg).ok())
            .filter(|m| matches!(m, ClientMsg::Input { .. }))
            .count();
        assert_eq!(typed, 0, "nothing typed into the pane");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn pasted_text_that_names_no_file_adds_nothing_and_is_never_shown() {
        let dir = project("text", &[]);
        let (mut app, mut rx) = opened(&dir, 160, 45);
        app.on_event(Event::Paste("sk-secret-token\nsecond line".into()));
        let shown = app
            .notice
            .as_ref()
            .map(|(t, ..)| t.clone())
            .unwrap_or_default();
        assert!(
            shown.contains("References has the keys") && !shown.contains("sk-secret"),
            "{shown}"
        );
        assert!(rx.try_recv().is_err(), "nothing to add for several lines");
        app.notice = None;
        app.on_event(Event::Paste("sk-secret-token".into()));
        let b = next_bg(&mut rx);
        app.on_bg(b);
        let shown = app
            .notice
            .as_ref()
            .map(|(t, ..)| t.clone())
            .unwrap_or_default();
        assert!(
            shown.contains("References has the keys") && !shown.contains("sk-secret"),
            "{shown}"
        );
        assert_eq!(names(&app), Vec::<String>::new());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_paste_with_no_image_says_so_and_makes_no_folder() {
        let dir = std::env::temp_dir().join(format!(
            "{APP_COMMAND}-refs-view-noimg-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let (mut app, mut rx) = opened(&dir, 160, 45);
        key(&mut app, KeyCode::Char('p'));
        let b = next_bg(&mut rx);
        app.on_bg(b);
        assert!(
            app.notice
                .as_ref()
                .is_some_and(|(t, ..)| t.contains("no image")),
            "{:?}",
            app.notice
        );
        assert!(
            !crate::references::folder(&dir).exists(),
            "no image, no folder"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_session_in_a_worktree_sees_the_main_checkouts_references() {
        let main = project("wt", &[("shared.png", 10)]);
        let git = |args: &[&str]| crate::proc::git(&main, args).unwrap();
        git(&["init", "-q", "-b", "main"]);
        git(&["config", "user.email", "t@t"]);
        git(&["config", "user.name", "t"]);
        std::fs::write(main.join("a.txt"), "a").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-qm", "first"]);
        let wt = main.with_extension("feat");
        let _ = std::fs::remove_dir_all(&wt);
        git(&["worktree", "add", "-q", "-b", "feat", wt.to_str().unwrap()]);
        let (app, _rx) = opened(&wt, 160, 45);
        assert_eq!(
            names(&app),
            ["shared.png"],
            "the worktree lists the main checkout's set"
        );
        assert_eq!(
            sheet(&app).unwrap().root.canonicalize().unwrap(),
            main.canonicalize().unwrap()
        );
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&main);
    }

    #[test]
    fn y_copies_the_chosen_files_absolute_path() {
        let dir = project("copy", &[("a.png", 10)]);
        let (mut app, _rx) = opened(&dir, 160, 45);
        key(&mut app, KeyCode::Char('y'));
        let copied = crate::client::copy::LAST_COPY
            .with(|c| c.borrow().clone())
            .unwrap();
        assert_eq!(
            PathBuf::from(&copied),
            crate::references::folder(&dir).join("a.png")
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

mod pane_swap_tests {
    use super::*;
    use crate::layout::{Dir, Node};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use ratatui::layout::{Position, Rect};

    const LAYOUTS: [&str; 4] = ["floating", "tiled", "grid", "hairline"];
    /// Wide enough that Compact splits too.
    const W: u16 = 200;
    const H: u16 = 45;

    /// Panes 1 and 2 side by side in one tab, as the server keeps them, drawn in `layout`;
    /// and what the app sends.
    fn side_by_side(layout: &str) -> (App, mpsc::UnboundedReceiver<Outgoing>) {
        let (_, mut app) = super::design_tests::render_with(W, H);
        let (tx, rx) = mpsc::unbounded_channel();
        app.out = tx;
        app.cfg.ui.layout = layout.into();
        app.cfg.ui.fold_retired_layout();
        let mut split = Node::Leaf(1);
        split.split(1, Dir::Right, 2);
        app.snap.workspaces[0].tabs = vec![
            TabInfo {
                id: 11,
                name: String::new(),
                layout: split,
                focus: 1,
            },
            TabInfo {
                id: 13,
                name: String::new(),
                layout: Node::Leaf(3),
                focus: 3,
            },
        ];
        app.screen.tabs.clear();
        app.screen.last_focus = None;
        app.screen_sync();
        draw(&mut app);
        (app, rx)
    }

    fn draw(app: &mut App) -> String {
        app.screen_fresh();
        let mut term = Terminal::new(TestBackend::new(W, H)).unwrap();
        term.draw(|f| render::draw(app, f)).unwrap();
        let buf = term.backend().buffer().clone();
        (0..H)
            .map(|y| {
                (0..W)
                    .map(|x| buf[(x, y)].symbol().to_string())
                    .collect::<String>()
                    + "\n"
            })
            .collect()
    }

    fn mouse(app: &mut App, kind: MouseEventKind, at: Position) {
        app.on_mouse(MouseEvent {
            kind,
            column: at.x,
            row: at.y,
            modifiers: KeyModifiers::NONE,
        });
    }

    fn frame_of(app: &App, term: TermId) -> Rect {
        app.pane_frames
            .iter()
            .find(|(id, _)| *id == ClientTerm::local(term))
            .map(|(_, r)| *r)
            .expect("the pane is drawn")
    }

    /// A cell of `term`'s title row that none of its title's controls take, nearest the middle.
    fn title_spot(app: &App, term: TermId) -> Position {
        let r = frame_of(app, term);
        let free = |x: u16| {
            let at = Position::new(x, r.y);
            matches!(
                app.hits
                    .iter()
                    .rev()
                    .find(|(h, _)| h.contains(at))
                    .map(|(_, h)| *h),
                None | Some(Hit::Pane(_))
            )
        };
        let mid = r.x + r.width / 2;
        let x = (r.x..r.right())
            .filter(|x| free(*x))
            .min_by_key(|x| x.abs_diff(mid))
            .expect("blank title space");
        Position::new(x, r.y)
    }

    fn middle(app: &App, term: TermId) -> Position {
        let r = frame_of(app, term);
        Position::new(r.x + r.width / 2, r.y + r.height / 2)
    }

    fn swaps_sent(rx: &mut mpsc::UnboundedReceiver<Outgoing>) -> Vec<(TermId, TermId)> {
        std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok())
            .filter_map(|m| match m {
                ClientMsg::Command(Command::SwapPanes { a, b }) => Some((a, b)),
                _ => None,
            })
            .collect()
    }

    fn shown(app: &App) -> Vec<TermId> {
        app.screen.tabs[app.screen.tab].layout.leaves()
    }

    #[test]
    fn dragging_a_title_onto_another_pane_swaps_them_in_every_layout() {
        for layout in LAYOUTS {
            let (mut app, mut rx) = side_by_side(layout);
            assert_eq!(shown(&app), [1, 2], "{layout}");
            let (from, onto) = (title_spot(&app, 1), middle(&app, 2));
            mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
            mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), onto);
            let screen = draw(&mut app);
            if maitty_shared::brand::env_var("SHOW").is_ok() {
                println!("{layout}\n{screen}");
            }
            assert!(
                screen.contains("swap here"),
                "{layout}: the drop target shows\n{screen}"
            );
            mouse(&mut app, MouseEventKind::Up(MouseButton::Left), onto);
            assert_eq!(shown(&app), [2, 1], "{layout}: they traded places");
            assert_eq!(
                swaps_sent(&mut rx),
                [(1, 2)],
                "{layout}: the server's tab follows"
            );
            assert!(app.screen.drag.is_none(), "{layout}");
        }
    }

    #[test]
    fn a_title_drag_let_go_on_itself_outside_the_panes_or_after_esc_moves_nothing() {
        let (mut app, mut rx) = side_by_side("floating");
        let (from, own, other, sidebar) = (
            title_spot(&app, 1),
            middle(&app, 1),
            middle(&app, 2),
            Position::new(1, 5),
        );
        let ends: [&dyn Fn(&mut App); 4] = [
            &|app| mouse(app, MouseEventKind::Up(MouseButton::Left), own),
            &|app| mouse(app, MouseEventKind::Up(MouseButton::Left), sidebar),
            &|app| mouse(app, MouseEventKind::Moved, other),
            &|app| {
                app.on_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
                mouse(app, MouseEventKind::Up(MouseButton::Left), other);
            },
        ];
        for end in ends {
            mouse(&mut app, MouseEventKind::Down(MouseButton::Left), from);
            mouse(&mut app, MouseEventKind::Drag(MouseButton::Left), other);
            end(&mut app);
            assert!(app.screen.drag.is_none());
            assert_eq!(shown(&app), [1, 2]);
        }
        assert!(swaps_sent(&mut rx).is_empty());
    }

    #[test]
    fn a_press_on_a_title_still_focuses_its_pane() {
        let (mut app, mut rx) = side_by_side("tiled");
        let at = title_spot(&app, 2);
        mouse(&mut app, MouseEventKind::Down(MouseButton::Left), at);
        mouse(&mut app, MouseEventKind::Up(MouseButton::Left), at);
        let sent: Vec<ClientMsg> =
            std::iter::from_fn(|| rx.try_recv().map(|o| o.msg).ok()).collect();
        assert!(
            sent.iter()
                .any(|m| matches!(m, ClientMsg::Command(Command::FocusPane { term: 2 }))),
            "{sent:?}"
        );
        assert!(
            !sent
                .iter()
                .any(|m| matches!(m, ClientMsg::Command(Command::SwapPanes { .. })))
        );
    }

    #[test]
    fn leader_alt_arrow_swaps_with_the_neighbour_that_way() {
        let (mut app, mut rx) = side_by_side("tiled");
        app.on_key(KeyEvent::new(KeyCode::Char(' '), KeyModifiers::CONTROL));
        app.on_key(KeyEvent::new(KeyCode::Left, KeyModifiers::ALT));
        assert_eq!(shown(&app), [1, 2], "nothing left of pane 1");
        assert!(
            matches!(app.mode, Mode::Prefix { .. }),
            "shortcut mode stays on"
        );
        app.on_key(KeyEvent::new(KeyCode::Right, KeyModifiers::ALT));
        assert_eq!(shown(&app), [2, 1]);
        assert_eq!(
            app.focused(),
            Some(ClientTerm::local(1)),
            "the keys stay with the pane that moved"
        );
        assert_eq!(swaps_sent(&mut rx), [(1, 2)]);
    }

    #[test]
    fn panes_split_here_only_swap_here() {
        let (mut app, mut rx) = side_by_side("tiled");
        app.snap.workspaces[0].tabs[0].layout = Node::Leaf(1);
        app.snap.workspaces[0].tabs.push(TabInfo {
            id: 12,
            name: String::new(),
            layout: Node::Leaf(2),
            focus: 2,
        });
        assert!(app.swap_panes(ClientTerm::local(1), ClientTerm::local(2)));
        assert_eq!(shown(&app), [2, 1]);
        assert!(
            swaps_sent(&mut rx).is_empty(),
            "the server keeps them apart: nothing to tell it"
        );
        assert!(
            !app.swap_panes(ClientTerm::local(1), ClientTerm::local(3)),
            "3 isn't shown beside them"
        );
    }
}
