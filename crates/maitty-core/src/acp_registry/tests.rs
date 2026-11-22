use super::*;

const SUM: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn index(agents: &str) -> String {
    format!(r#"{{"version":"1.0.0","agents":[{agents}]}}"#)
}

fn binary(id: &str, target: &str) -> String {
    format!(r#"{{"id":"{id}","name":"Demo","version":"1.2.3","description":"d","distribution":{{"binary":{{"linux-x86_64":{target}}}}}}}"#)
}

fn npx(package: &str) -> String {
    format!(r#"{{"id":"demo","name":"Demo","version":"1.2.3","description":"d","distribution":{{"npx":{{"package":"{package}","args":["--acp"]}}}}}}"#)
}

fn only(text: &str) -> Listed {
    let mut agents = parse_index(text).unwrap();
    assert_eq!(agents.len(), 1, "{agents:?}");
    agents.remove(0)
}

/// A folder of this test's own, removed when it ends.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let folder = std::env::temp_dir().join(format!("maiker-acp-registry-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        Self(folder)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn an_index_lists_its_well_formed_agents_and_leaves_out_the_rest_and_adapter_helpers() {
    let good = binary("demo", &format!(r#"{{"archive":"https://example.com/a.tar.gz","cmd":"./demo","sha256":"{SUM}"}}"#));
    let bad_name = binary("Not A Name", r#"{"archive":"https://example.com/a.tar.gz","cmd":"demo"}"#);
    let bad_version = good.replace("1.2.3", "../1");
    let not_an_agent = r#"{"id":7}"#;

    let agents = parse_index(&index(&[good, bad_name, bad_version, not_an_agent.into()].join(","))).unwrap();

    assert_eq!(agents.iter().map(|agent| agent.id.as_str()).collect::<Vec<_>>(), ["demo"]);
    // An agent with its own adapter has no use for the registry's helper for it.
    let helper = binary("claude-acp", &format!(r#"{{"archive":"https://example.com/a.tar.gz","cmd":"x","sha256":"{SUM}"}}"#));
    assert!(parse_index(&index(&helper)).unwrap().is_empty());
}

#[test]
fn a_binary_with_a_checksum_is_installed_from_its_https_address() {
    let listed = only(&index(&binary(
        "demo",
        &format!(r#"{{"archive":"https://example.com/a.tar.gz","cmd":"./bin/demo","sha256":"{}","args":["acp"],"env":{{"MODE":"acp"}}}}"#, SUM.to_uppercase()),
    )));

    let source = source(&listed, "linux-x86_64").unwrap();

    assert_eq!(
        source,
        Source::Binary {
            url: "https://example.com/a.tar.gz".into(),
            sha256: SUM.into(),
            command: PathBuf::from("bin/demo"),
            args: vec!["acp".into()],
            env: BTreeMap::from([("MODE".into(), "acp".into())]),
        }
    );
}

#[test]
fn a_binary_is_refused_in_words_when_any_part_of_it_is_not_safe_to_use() {
    let cases = [
        (r#"{"archive":"https://example.com/a.tar.gz","cmd":"demo"}"#.to_owned(), "no checksum"),
        (format!(r#"{{"archive":"http://example.com/a.tar.gz","cmd":"demo","sha256":"{SUM}"}}"#), "https"),
        (format!(r#"{{"archive":"https://user:pw@example.com/a","cmd":"demo","sha256":"{SUM}"}}"#), "https"),
        (format!(r#"{{"archive":"https://example.com/a","cmd":"../demo","sha256":"{SUM}"}}"#), "outside"),
        (format!(r#"{{"archive":"https://example.com/a","cmd":"/bin/sh","sha256":"{SUM}"}}"#), "outside"),
        (format!(r#"{{"archive":"https://example.com/a","cmd":"C:\\demo.exe","sha256":"{SUM}"}}"#), "outside"),
        (format!(r#"{{"archive":"https://example.com/a","cmd":"demo","sha256":"{SUM}","env":{{"BAD NAME":"x"}}}}"#), "variables"),
    ];
    for (target, why) in cases {
        let refused = source(&only(&index(&binary("demo", &target))), "linux-x86_64").unwrap_err();

        assert!(refused.contains(why), "{target}: {refused}");
    }
}

#[test]
fn an_agent_with_no_download_for_this_computer_says_so_and_windows_on_arm_takes_x86_64() {
    let listed = only(&index(&binary("demo", &format!(r#"{{"archive":"https://example.com/a","cmd":"demo","sha256":"{SUM}"}}"#))));

    assert!(source(&listed, "darwin-aarch64").unwrap_err().contains("this kind of computer"));
    assert!(source(&listed, "linux-x86_64").is_ok());
    let windows = only(&index(&binary("demo", &format!(r#"{{"archive":"https://example.com/a","cmd":"demo","sha256":"{SUM}"}}"#)).replace("linux-x86_64", "windows-x86_64")));
    assert!(source(&windows, "windows-aarch64").is_ok());
}

#[test]
fn an_npm_package_is_taken_only_at_one_exact_version() {
    let scoped = source(&only(&index(&npx("@google/gemini-cli@0.70.0"))), "linux-x86_64").unwrap();

    assert_eq!(
        scoped,
        Source::Npm { name: "@google/gemini-cli".into(), version: "0.70.0".into(), args: vec!["--acp".into()], env: BTreeMap::new() }
    );
    for package in ["gemini-cli", "gemini-cli@latest", "@google/gemini-cli", "../x@1.0.0", "-g@1.0.0", "a b@1.0.0", "a/b@1.0.0"] {
        assert!(source(&only(&index(&npx(package))), "linux-x86_64").is_err(), "{package}");
    }
}

#[test]
fn a_download_whose_checksum_differs_is_refused() {
    let scratch = Scratch::new("checksum");
    let file = scratch.0.join("download");
    std::fs::write(&file, "test").unwrap();

    // The SHA-256 of the four letters `test`.
    assert!(verify(&file, SUM).is_ok());
    let refused = verify(&file, &"0".repeat(SHA256_HEX)).unwrap_err().to_string();
    assert!(refused.contains("nothing was installed"), "{refused}");
}

#[test]
fn an_archive_naming_a_file_outside_its_folder_is_not_unpacked() {
    assert!(entries_stay_inside("demo/\ndemo/bin/agent\nREADME.md\n"));
    for listing in ["../evil", "demo/../../evil", "/etc/passwd", "C:\\evil", "ok\n\\\\server\\share"] {
        assert!(!entries_stay_inside(listing), "{listing}");
    }
}

#[test]
fn the_kind_of_download_is_read_from_its_address() {
    assert_eq!(packing("https://example.com/a-linux.tar.gz"), Packing::Tar);
    assert_eq!(packing("https://example.com/a.TBZ2?token=1"), Packing::Tar);
    assert_eq!(packing("https://example.com/a-windows.zip#x"), Packing::Zip);
    assert_eq!(packing("https://example.com/a-linux-amd64"), Packing::Program);
}

#[test]
fn a_download_that_is_the_program_itself_is_placed_under_its_name() {
    let scratch = Scratch::new("program");
    let file = scratch.0.join("download");
    let folder = scratch.0.join("staging");
    std::fs::write(&file, "#!/bin/sh\n").unwrap();
    std::fs::create_dir_all(&folder).unwrap();

    let program = unpack(&file, Packing::Program, Path::new("bin/agent"), &folder).unwrap();

    assert_eq!(program, PathBuf::from("bin/agent"));
    assert!(folder.join(program).is_file());
}

#[cfg(unix)]
#[test]
fn a_program_that_is_a_link_out_of_its_folder_is_refused() {
    let scratch = Scratch::new("link");
    let folder = scratch.0.join("staging");
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(scratch.0.join("outside"), "x").unwrap();
    std::os::unix::fs::symlink(scratch.0.join("outside"), folder.join("agent")).unwrap();

    let refused = inside(&folder, &folder.join("agent")).unwrap_err().to_string();

    assert!(refused.contains("outside its own folder"), "{refused}");
}

#[test]
fn an_npm_package_runs_the_program_its_own_description_names() {
    let one = r#"{"name":"@google/gemini-cli","version":"0.70.0","bin":{"gemini":"./dist/index.js"}}"#;
    let named = r#"{"name":"demo","version":"1.0.0","bin":{"other":"o.js","demo":"bin/demo.js"}}"#;
    let plain = r#"{"name":"demo","version":"1.0.0","bin":"cli.js"}"#;

    assert_eq!(package_program(one, "@google/gemini-cli", "0.70.0").unwrap(), PathBuf::from("dist/index.js"));
    assert_eq!(package_program(named, "demo", "1.0.0").unwrap(), PathBuf::from("bin/demo.js"));
    assert_eq!(package_program(plain, "demo", "1.0.0").unwrap(), PathBuf::from("cli.js"));
    assert!(package_program(plain, "demo", "2.0.0").unwrap_err().to_string().contains("another package or version"));
    assert!(package_program(r#"{"name":"demo","version":"1.0.0","bin":"../../x.js"}"#, "demo", "1.0.0").is_err());
    assert!(package_program(r#"{"name":"demo","version":"1.0.0"}"#, "demo", "1.0.0").is_err());
}

#[test]
fn what_is_installed_is_kept_by_name_and_removed_with_its_files() {
    let scratch = Scratch::new("installed");
    let agent = Installed {
        name: "Demo".into(),
        version: "1.2.3".into(),
        command: scratch.0.join("acp-agents/demo/1.2.3/demo"),
        args: vec!["acp".into()],
        env: BTreeMap::new(),
    };
    std::fs::create_dir_all(root(&scratch.0).join("demo/1.2.3")).unwrap();

    assert!(installed(&scratch.0).is_empty());
    write_installed(&scratch.0, &BTreeMap::from([("demo".to_owned(), agent.clone())])).unwrap();
    assert_eq!(installed(&scratch.0).get("demo"), Some(&agent));

    assert!(remove("demo", &scratch.0).unwrap());
    assert!(installed(&scratch.0).is_empty());
    assert!(!root(&scratch.0).join("demo").exists());
    assert!(!remove("demo", &scratch.0).unwrap());
    assert!(remove("../demo", &scratch.0).is_err());
}
