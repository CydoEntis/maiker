use super::redact::Context;
use super::{Facts, LOG_FILE, build};
use std::path::PathBuf;

fn folder(name: &str) -> PathBuf {
    let folder = std::env::temp_dir().join(format!("maitty-diagnostics-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&folder);
    std::fs::create_dir_all(&folder).unwrap();
    folder
}

fn facts() -> Facts {
    Facts {
        app_version: "1.2.3".into(),
        service_version: Some("1.2.0".into()),
        sessions: Some(2),
        reach: "not answering".into(),
        system: "TestOS 1, kernel 2, x86_64".into(),
        machines: vec!["build-box".into()],
    }
}

fn context() -> Context {
    Context { home: Some("/home/tester".into()), host: Some("tester-box".into()) }
}

#[test]
fn a_missing_log_leaves_its_parts_out_and_says_why_but_the_rest_is_there() {
    let data = folder("missing");
    let preview = build(&facts(), &data, &context());

    let left_out: Vec<_> = preview.parts.iter().filter(|p| !p.included).map(|p| p.title).collect();
    assert_eq!(left_out, ["Service log (recent)", "Recent warnings and errors", "Desktop app log"]);
    assert!(preview.parts.iter().any(|p| p.note.contains("no service log yet")));
    assert!(preview.text.contains("App version: 1.2.3"));
    assert!(preview.text.contains("Service version: 1.2.0"));
    assert!(preview.text.contains("build-box"));
    assert!(preview.text.contains("It does not hold: chats"));
    std::fs::remove_dir_all(&data).unwrap();
}

#[test]
fn the_log_goes_in_cleaned_and_its_problems_are_listed() {
    let data = folder("log");
    std::fs::write(
        data.join(LOG_FILE),
        "2026-01-01T00:00:00Z  INFO daemon: started in /home/tester/proj\n\
         2026-01-01T00:00:01Z  WARN daemon: login failed token=FAKESECRETVALUE peer 10.1.2.3\n\
         2026-01-01T00:00:02Z ERROR daemon: boom\n",
    )
    .unwrap();
    let preview = build(&facts(), &data, &context());

    assert!(!preview.text.contains("FAKESECRETVALUE") && !preview.text.contains("10.1.2.3"), "{}", preview.text);
    assert!(!preview.text.contains("/home/tester"), "{}", preview.text);
    assert!(preview.text.contains("started in ~/proj"));
    let problems = preview.text.split("===== Recent warnings and errors =====").nth(1).unwrap();
    assert!(problems.contains("WARN") && problems.contains("ERROR") && !problems.contains("INFO"));
    assert!(preview.summary.contains("recent warnings and errors: 2"), "{}", preview.summary);
    std::fs::remove_dir_all(&data).unwrap();
}

#[test]
fn a_log_that_is_not_text_is_left_out_whole() {
    let data = folder("binary");
    std::fs::write(data.join(LOG_FILE), [b'a', 0, b'b', b'\n']).unwrap();
    let preview = build(&facts(), &data, &context());

    let log = preview.parts.iter().find(|p| p.title == "Service log (recent)").unwrap();
    assert!(!log.included && log.note.contains("could not be cleaned"), "{}", log.note);
    std::fs::remove_dir_all(&data).unwrap();
}

#[test]
fn a_big_log_is_cut_to_its_end_and_a_long_line_is_cut() {
    let data = folder("big");
    let line = format!("{}\n", "x".repeat(5000));
    let mut log = "FIRSTLINE\n".to_string();
    log.push_str(&line.repeat(200));
    std::fs::write(data.join(LOG_FILE), log).unwrap();
    let preview = build(&facts(), &data, &context());

    assert!(!preview.text.contains("FIRSTLINE"));
    assert!(preview.text.len() < 2 * 1024 * 1024, "{}", preview.text.len());
    assert!(preview.text.contains("... (cut)"));
    std::fs::remove_dir_all(&data).unwrap();
}

#[test]
fn nothing_that_is_not_named_is_read_from_the_data_folder() {
    let data = folder("others");
    std::fs::write(data.join("session-default.json"), "CHATTEXT-SHOULD-NEVER-APPEAR").unwrap();
    std::fs::write(data.join("config.local.toml"), "password = \"FAKEPW\"").unwrap();
    std::fs::write(data.join(LOG_FILE), "2026-01-01T00:00:00Z  INFO ok\n").unwrap();
    let preview = build(&facts(), &data, &context());

    assert!(!preview.text.contains("CHATTEXT") && !preview.text.contains("FAKEPW"));
    std::fs::remove_dir_all(&data).unwrap();
}
