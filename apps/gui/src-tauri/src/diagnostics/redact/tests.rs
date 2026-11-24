use super::{Context, clean, unsafe_to_clean};

// Every secret here is made up for the test.
const FAKE_KEY: &str = "FAKEKEYfakekey0123456789ABCDEFGHIJ";

fn context() -> Context {
    Context { home: Some("/home/tester".into()), host: Some("tester-box".into()) }
}

fn cleaned(line: &str) -> String {
    clean(line, &context())
}

#[test]
fn key_value_secrets_lose_their_value_and_keep_their_name() {
    assert_eq!(cleaned("SERVICE_TOKEN=abc123 started"), "SERVICE_TOKEN=[redacted] started");
    assert_eq!(cleaned("password: hunter2, next"), "password: [redacted], next");
    assert_eq!(cleaned(r#"{"api_key": "not-a-real-key", "ok": true}"#), r#"{"api_key": "[redacted]", "ok": true}"#);
    assert_eq!(cleaned("GET /x?token=abc&page=2"), "GET /x?token=[redacted]&page=2");
    assert_eq!(cleaned("mode=fast"), "mode=fast");
}

#[test]
fn bearer_and_basic_tokens_are_hidden() {
    let line = cleaned("Authorization: Bearer fake.token.value");
    assert!(!line.contains("fake"), "{line}");
    assert!(!cleaned("header Basic ZmFrZTpmYWtl done").contains("ZmFr"));
}

#[test]
fn a_url_loses_its_credentials_and_its_host() {
    let line = cleaned("cloning https://someone:fakepass@git.example.com/org/repo.git now");
    assert!(!line.contains("fakepass") && !line.contains("someone"), "{line}");
    assert!(!line.contains("example.com"), "{line}");
    assert!(line.contains("/org/repo.git"), "{line}");
}

#[test]
fn well_known_key_shapes_are_hidden_without_a_key_name() {
    for shape in [
        "sk-ant-api03-FAKEFAKEFAKEFAKE",
        "ghp_FAKEFAKEFAKEFAKEFAKE0123",
        "github_pat_FAKEFAKEFAKE0123",
        "AKIAFAKEFAKEFAKEFAKE",
        "eyJhbGciOiJGQUtFIn0.eyJmYWtlIjoxfQ.ZmFrZXNpZw",
        FAKE_KEY,
    ] {
        let line = cleaned(&format!("saw {shape} in output"));
        assert!(!line.contains(&shape[..12]), "{shape} -> {line}");
        assert!(line.contains("[redacted]"), "{line}");
    }
}

#[test]
fn private_key_blocks_are_removed_whole() {
    let text = "before\n-----BEGIN OPENSSH PRIVATE KEY-----\nZmFrZWZha2VmYWtl\nbm90cmVhbA==\n-----END OPENSSH PRIVATE KEY-----\nafter";
    let out = cleaned(text);
    assert!(!out.contains("ZmFrZ") && !out.contains("bm90"), "{out}");
    assert!(out.starts_with("before") && out.ends_with("after"), "{out}");
}

#[test]
fn home_folders_and_the_computers_name_become_placeholders() {
    assert_eq!(cleaned("opened /home/tester/work/app"), "opened ~/work/app");
    assert_eq!(cleaned("opened /home/someone/else"), "opened /home/[user]/else");
    assert_eq!(cleaned(r"opened C:\Users\Someone\proj"), r"opened C:\Users\[user]\proj");
    assert_eq!(cleaned("macOS /Users/someone/Library"), "macOS /Users/[user]/Library");
    assert_eq!(cleaned("host tester-box up"), "host [this-computer] up");
}

#[test]
fn addresses_and_host_names_are_hidden_but_versions_and_files_are_not() {
    assert_eq!(cleaned("peer 192.168.1.44:2222 gone"), "peer [ip] gone");
    assert_eq!(cleaned("peer fe80::1ff:fe23:4567:890a lost"), "peer [ip] lost");
    assert_eq!(cleaned("ssh deploy@build.example.com failed"), "ssh [user]@[host] failed");
    assert_eq!(cleaned("version 0.84.0 reading config.local.toml at 10:20:30"), "version 0.84.0 reading config.local.toml at 10:20:30");
    assert_eq!(cleaned("session 8f14e45f-ceea-467a-9575-0bb2f1e2c0a1"), "session 8f14e45f-ceea-467a-9575-0bb2f1e2c0a1");
}

#[test]
fn text_that_is_not_plain_is_refused_not_cleaned() {
    assert!(unsafe_to_clean(b"line\nline\n").is_none());
    assert!(unsafe_to_clean(b"a\0b").is_some());
    assert!(unsafe_to_clean(&[0xff, 0xfe, 0xfd, b'a']).is_some());
}

#[test]
fn cleaning_twice_changes_nothing_more() {
    let once = cleaned("token=abc https://u:p@h.example.com /home/other/x");
    assert_eq!(cleaned(&once), once);
}
