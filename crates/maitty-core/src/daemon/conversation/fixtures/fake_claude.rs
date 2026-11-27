use std::io::{BufRead, Write};

/// One line in `<executable>.log`, so a test can tell which process took which message.
fn log(line: &str) {
    if let Ok(executable) = std::env::current_exe() {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(executable.with_extension("log"))
            .unwrap();
        file.write_all(format!("{line}\n").as_bytes()).unwrap();
    }
}

fn main() {
    // A test names another version, or a help without a flag, in a file beside the executable.
    let beside = |extension: &str| {
        std::env::current_exe()
            .ok()
            .and_then(|executable| std::fs::read_to_string(executable.with_extension(extension)).ok())
    };
    if std::env::args().any(|argument| argument == "--version") {
        println!("{}", beside("version").unwrap_or_else(|| "Claude Code 2.1.312".into()));
        return;
    }
    if std::env::args().any(|argument| argument == "--help") {
        print!(
            "{}",
            beside("help").unwrap_or_else(|| "--input-format <f>\n--output-format <f>\n--include-partial-messages\n--replay-user-messages\n--verbose\n--permission-mode <m>\n--session-id <uuid>\n--resume [id]\n--permission-prompts <t>  (--permission-prompt-tool)\n".into())
        );
        return;
    }

    let arguments: Vec<String> = std::env::args().skip(1).collect();
    log(&format!("start {} {}", std::process::id(), arguments.join(" ")));

    let stdin = std::io::stdin();
    let mut input = stdin.lock();
    let mut output = std::io::stdout().lock();
    let mut line = String::new();
    // A scenario comes from the environment, or from a file beside the executable when a test
    // goes through the daemon and cannot set the environment of the process it starts.
    let scenario = std::env::var("FAKE_CLAUDE_SCENARIO")
        .ok()
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|executable| std::fs::read_to_string(executable.with_extension("scenario")).ok())
        })
        .unwrap_or_default();

    input.read_line(&mut line).unwrap();
    if line.is_empty() {
        return;
    }
    assert_eq!(
        line.trim_end(),
        r#"{"request":{"hooks":null,"subtype":"initialize"},"request_id":"claude-initialize","type":"control_request"}"#
    );
    let session_id = std::env::args()
        .skip_while(|argument| argument != "--session-id")
        .nth(1)
        .or_else(|| {
            std::env::args()
                .find_map(|argument| argument.strip_prefix("--resume=").map(str::to_owned))
        })
        .expect("Claude session identity argument");
    // Every result names the session the daemon asked for, so a conversation it created itself
    // (with its own session id) reads back as well as the fixed one.
    // Claude Code 2.1.325 and later send `init` only after the message; this fake sends it early,
    // except in the scenario that has the late one name another session.
    if scenario != "late-init-other" {
        writeln!(
            output,
            "{{\"type\":\"system\",\"subtype\":\"init\",\"session_id\":\"{session_id}\"}}"
        )
        .unwrap();
    }
    writeln!(
        output,
        "{}",
        r#"{"response":{"request_id":"claude-initialize","subtype":"success"},"type":"control_response"}"#
    )
    .unwrap();
    output.flush().unwrap();

    line.clear();
    input.read_line(&mut line).unwrap();
    // A process started ahead for a message that never came is closed like Claude Code: input ends.
    if line.is_empty() {
        log(&format!("eof {}", std::process::id()));
        return;
    }
    log(&format!("message {}", std::process::id()));
    // Lets a test see which arguments the last message was started with.
    if let Ok(executable) = std::env::current_exe() {
        let _ = std::fs::write(executable.with_extension("args"), arguments.join("\n"));
        // Lets a test see who this process was told it is: the variables that name a chat or a pane.
        let mut told: Vec<String> = std::env::vars()
            .filter(|(name, _)| {
                ["_CONVERSATION_", "_TERM_ID", "_PANE_TOKEN"].iter().any(|part| name.contains(part))
            })
            .map(|(name, value)| format!("{name}={value}"))
            .collect();
        told.sort();
        let _ = std::fs::write(executable.with_extension("identity"), told.join("\n"));
    }
    // Claude Code keeps the message in the session's transcript, which the daemon watches.
    if let (Some(config), Ok(cwd)) = (std::env::var_os("CLAUDE_CONFIG_DIR"), std::env::current_dir()) {
        let folder: String = cwd
            .to_string_lossy()
            .trim_end_matches(['/', '\\'])
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let folder = std::path::Path::new(&config).join("projects").join(folder);
        std::fs::create_dir_all(&folder).unwrap();
        let mut transcript = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(folder.join(format!("{session_id}.jsonl")))
            .unwrap();
        writeln!(transcript, r#"{{"type":"user"}}"#).unwrap();
    }
    if scenario == "interrupt-any" {
        // The messages differ between turns: keep each one so a test can see which went out.
        let text = line
            .split(r#""text":""#)
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .unwrap_or_default()
            .to_owned();
        if let Ok(executable) = std::env::current_exe() {
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(executable.with_extension("messages"))
                .unwrap();
            writeln!(log, "{text}").unwrap();
        }
        // The first message starts a turn that runs until it is interrupted; any later one is
        // answered at once.
        let first = std::env::current_exe()
            .ok()
            .map(|executable| executable.with_extension("messages"))
            .and_then(|log| std::fs::read_to_string(log).ok())
            .is_some_and(|log| log.lines().count() == 1);
        if first {
            writeln!(output, r#"{{"isReplay":true,"message":{{"content":[{{"text":"{text}","type":"text"}}]}},"type":"user"}}"#).unwrap();
            output.flush().unwrap();
            line.clear();
            input.read_line(&mut line).unwrap();
            let request_id = line
                .split(r#""request_id":""#)
                .nth(1)
                .and_then(|rest| rest.split('"').next())
                .unwrap_or_default()
                .to_owned();
            assert!(line.contains(r#""subtype":"interrupt""#), "{line}");
            writeln!(output, r#"{{"response":{{"request_id":"{request_id}","response":{{"still_queued":[]}},"subtype":"success"}},"type":"control_response"}}"#).unwrap();
            writeln!(output, r#"{{"is_error":true,"session_id":"{session_id}","subtype":"error_during_execution","type":"result"}}"#).unwrap();
            output.flush().unwrap();
            return;
        }
    } else {
        assert_eq!(
            line.trim_end(),
            r#"{"message":{"content":[{"text":"hello fake Claude","type":"text"}],"role":"user"},"type":"user"}"#
        );
    }

    if scenario == "late-init-other" {
        writeln!(output, "{}", r#"{"session_id":"other-session","subtype":"init","type":"system"}"#).unwrap();
        output.flush().unwrap();
        // Holds the turn open until the daemon closes its input.
        line.clear();
        let _ = input.read_line(&mut line);
        return;
    }

    if scenario == "approval" || scenario == "approval-decline" {
        for frame in [
            r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#,
            r#"{"event":{"message":{"id":"approval-message","model":"fake-model"},"type":"message_start"},"type":"stream_event"}"#,
            r#"{"request_id":"tool-request","request":{"input":{"command":"echo hello"},"subtype":"can_use_tool","tool_name":"Bash"},"type":"control_request"}"#,
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();

        line.clear();
        input.read_line(&mut line).unwrap();
        let expected_response = match scenario.as_str() {
            "approval" => {
                r#"{"response":{"request_id":"tool-request","response":{"behavior":"allow","updatedInput":{"command":"echo hello"}},"subtype":"success"},"type":"control_response"}"#
            }
            "approval-decline" => {
                r#"{"response":{"request_id":"tool-request","response":{"behavior":"deny","message":"The user declined this action.","updatedInput":{"command":"echo hello"}},"subtype":"success"},"type":"control_response"}"#
            }
            _ => unreachable!(),
        };
        assert_eq!(line.trim_end(), expected_response);
        writeln!(output, r#"{{"is_error":false,"result":"tool decision processed","session_id":"{session_id}","type":"result"}}"#).unwrap();
        output.flush().unwrap();
        return;
    }

    // An Edit call as Claude streams it: the tool block with its input, then the permission
    // request naming the same tool use, then the result.
    if scenario == "tool-edit" {
        for frame in [
            r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#,
            r#"{"event":{"message":{"id":"edit-message","model":"fake-model"},"type":"message_start"},"type":"stream_event"}"#,
            r#"{"event":{"content_block":{"id":"toolu_edit","input":{},"name":"Edit","type":"tool_use"},"index":1,"type":"content_block_start"},"type":"stream_event"}"#,
            r#"{"event":{"delta":{"partial_json":"{\"file_path\":\"src/a.rs\",\"old_string\":\"old\",\"new_string\":\"new\"}","type":"input_json_delta"},"index":1,"type":"content_block_delta"},"type":"stream_event"}"#,
            r#"{"event":{"index":1,"type":"content_block_stop"},"type":"stream_event"}"#,
            r#"{"request_id":"edit-request","request":{"input":{"file_path":"src/a.rs","new_string":"new","old_string":"old"},"subtype":"can_use_tool","tool_name":"Edit","tool_use_id":"toolu_edit"},"type":"control_request"}"#,
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();

        line.clear();
        input.read_line(&mut line).unwrap();
        assert_eq!(
            line.trim_end(),
            r#"{"response":{"request_id":"edit-request","response":{"behavior":"allow","updatedInput":{"file_path":"src/a.rs","new_string":"new","old_string":"old"}},"subtype":"success"},"type":"control_response"}"#
        );
        for frame in [
            r#"{"message":{"content":[{"content":"edited","tool_use_id":"toolu_edit","type":"tool_result"}]},"type":"user"}"#.to_owned(),
            format!(r#"{{"is_error":false,"result":"done","session_id":"{session_id}","type":"result"}}"#),
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();
        return;
    }

    // A Write of a .env and a command that echoes a token. The agent must get its own input back
    // untouched (`updatedInput`); only Maiker's stored copy is masked. The token is built from
    // pieces so no secret-shaped literal sits in the source.
    if scenario == "tool-secret" {
        let token = format!("{}{}", "ghp_", "aB3d".repeat(9));
        let write_input = r#"{"content":"DB_PASSWORD=hunter2hunter2\n","file_path":"app/.env"}"#;
        for frame in [
            r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#.to_owned(),
            r#"{"event":{"message":{"id":"secret-message","model":"fake-model"},"type":"message_start"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"content_block":{"id":"toolu_write","input":{},"name":"Write","type":"tool_use"},"index":1,"type":"content_block_start"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"delta":{"partial_json":"{\"file_path\":\"app/.env\",\"content\":\"DB_PASSWORD=hunter2hunter2\\n\"}","type":"input_json_delta"},"index":1,"type":"content_block_delta"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"index":1,"type":"content_block_stop"},"type":"stream_event"}"#.to_owned(),
            format!(r#"{{"request_id":"write-request","request":{{"input":{write_input},"subtype":"can_use_tool","tool_name":"Write","tool_use_id":"toolu_write"}},"type":"control_request"}}"#),
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();

        line.clear();
        input.read_line(&mut line).unwrap();
        assert!(
            line.contains("hunter2hunter2"),
            "the agent gets its own input back unchanged: {line}"
        );
        for frame in [
            r#"{"message":{"content":[{"content":"created","tool_use_id":"toolu_write","type":"tool_result"}]},"type":"user"}"#.to_owned(),
            r#"{"event":{"content_block":{"id":"toolu_echo","input":{},"name":"Bash","type":"tool_use"},"index":2,"type":"content_block_start"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"delta":{"partial_json":"{\"command\":\"echo $TOKEN\"}","type":"input_json_delta"},"index":2,"type":"content_block_delta"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"index":2,"type":"content_block_stop"},"type":"stream_event"}"#.to_owned(),
            format!(r#"{{"message":{{"content":[{{"content":"token is {token}","tool_use_id":"toolu_echo","type":"tool_result"}}]}},"type":"user"}}"#),
            format!(r#"{{"is_error":false,"result":"done","session_id":"{session_id}","type":"result"}}"#),
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();
        return;
    }

    // A turn Claude fails on its own: with its reason as the result text, or with none at all.
    if scenario == "fail-with-reason" || scenario == "fail-silently" {
        writeln!(output, "{}", r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#).unwrap();
        let reason = if scenario == "fail-with-reason" { r#","result":"API Error: 400 model not found""# } else { "" };
        writeln!(output, r#"{{"is_error":true{reason},"session_id":"{session_id}","subtype":"success","type":"result"}}"#).unwrap();
        output.flush().unwrap();
        return;
    }

    // A newer Claude Code: an output frame and a control request this adapter has never seen.
    // The frame is skipped, the request is refused with an error, and the turn goes on.
    if scenario == "newer-release" {
        for frame in [
            r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#,
            r#"{"type":"future_status_frame","detail":"something new"}"#,
            r#"{"request_id":"future-request","request":{"subtype":"future_request_kind"},"type":"control_request"}"#,
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();
        line.clear();
        input.read_line(&mut line).unwrap();
        assert!(line.contains(r#""request_id":"future-request""#) && line.contains(r#""subtype":"error""#), "{line}");
    }

    // A helper started in the background, as Claude Code 2.1.332 streams it: the turn ends while
    // the helper runs, then the helper's end and the turn Claude starts by itself to read it.
    // Input closing before the helper ends would end it, as it does in Claude Code.
    if scenario == "background-helper" {
        let task = r#"{"task_id":"a-helper","task_type":"local_agent","description":"Find call sites"}"#;
        for frame in [
            r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#.to_owned(),
            format!(r#"{{"type":"system","subtype":"background_tasks_changed","tasks":[{task}]}}"#),
            format!(r#"{{"is_error":false,"result":"launched","session_id":"{session_id}","type":"result"}}"#),
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        log(&format!("helper done {}", std::process::id()));
        for frame in [
            r#"{"type":"system","subtype":"task_notification","task_id":"a-helper","status":"completed","summary":"Found 3 call sites","summary_is_report":true}"#.to_owned(),
            r#"{"type":"system","subtype":"background_tasks_changed","tasks":[]}"#.to_owned(),
            format!(r#"{{"type":"system","subtype":"init","session_id":"{session_id}"}}"#),
            r#"{"event":{"message":{"id":"news-message","model":"fake-model"},"type":"message_start"},"type":"stream_event"}"#.to_owned(),
            r#"{"event":{"delta":{"text":"The helper found 3.","type":"text_delta"},"index":0,"type":"content_block_delta"},"type":"stream_event"}"#.to_owned(),
            format!(r#"{{"is_error":false,"result":"The helper found 3.","session_id":"{session_id}","type":"result"}}"#),
        ] {
            writeln!(output, "{frame}").unwrap();
        }
        output.flush().unwrap();
        line.clear();
        if input.read_line(&mut line).unwrap_or_default() == 0 {
            log(&format!("eof {}", std::process::id()));
        }
        return;
    }

    if scenario == "interrupt" {
        writeln!(output, "{}", r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#).unwrap();
        output.flush().unwrap();

        line.clear();
        input.read_line(&mut line).unwrap();
        assert_eq!(
            line.trim_end(),
            r#"{"request":{"subtype":"interrupt"},"request_id":"interrupt-4","type":"control_request"}"#
        );
        // Claude Code 2.1.327's answer to an interrupt and the result that ends the stopped turn.
        writeln!(output, "{}", r#"{"response":{"request_id":"interrupt-4","response":{"still_queued":[]},"subtype":"success"},"type":"control_response"}"#).unwrap();
        writeln!(output, r#"{{"is_error":true,"session_id":"{session_id}","subtype":"error_during_execution","type":"result"}}"#).unwrap();
        output.flush().unwrap();
        return;
    }

    let result = format!(
        r#"{{"is_error":false,"result":"fake reply","session_id":"{session_id}","type":"result"}}"#
    );
    for frame in [
        r#"{"isReplay":true,"message":{"content":[{"text":"hello fake Claude","type":"text"}]},"type":"user"}"#,
        r#"{"event":{"message":{"id":"fake-message","model":"fake-model"},"type":"message_start"},"type":"stream_event"}"#,
        r#"{"event":{"delta":{"text":"fake reply","type":"text_delta"},"index":0,"type":"content_block_delta"},"type":"stream_event"}"#,
        result.as_str(),
    ] {
        writeln!(output, "{frame}").unwrap();
    }
    output.flush().unwrap();
}
