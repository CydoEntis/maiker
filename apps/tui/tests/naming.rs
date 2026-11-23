//! The app's name lives in `Cargo.toml` (ADR 0008): code, adapters and comments name their parts
//! by role and take the name from `brand`, so a rename is that file and the docs. Names the app
//! had before may appear only where it carries over what an old install left behind.

use std::path::{Path, PathBuf};

/// Files that read or rewrite what an old install left on disk, and their tests, which name it.
const CARRY_OVER_FILES: [&str; 5] = [
    "src/cli.rs",
    "src/config.rs",
    "src/project.rs",
    "src/theme.rs",
    "src/client/themes.rs",
];

/// Source the app is built from: Rust and the adapters it installs. Reference frames (`.txt`)
/// are fixtures that show the name and are updated by hand with a rename.
fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("readable source dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            sources(&path, out);
        } else if path
            .extension()
            .is_some_and(|e| e == "rs" || e == "js" || e == "mjs")
        {
            out.push(path);
        }
    }
}

/// Whether `line` holds `name` as a word: no letter right before or after it, so `_seshi` and
/// `seshi.exe` count and `hydrate` doesn't.
fn names_word(line: &str, name: &str) -> bool {
    line.match_indices(name).any(|(at, _)| {
        let before = line[..at].chars().next_back();
        let after = line[at + name.len()..].chars().next();
        !before.is_some_and(char::is_alphabetic) && !after.is_some_and(char::is_alphabetic)
    })
}

/// Every line of `src` holding one of `names` (any case), outside `skip`.
fn lines_naming(names: &[String], skip: &[&str]) -> Vec<String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    sources(&root.join("src"), &mut files);
    let mut hits = Vec::new();
    for file in files {
        let rel = file
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if skip.contains(&rel.as_str()) {
            continue;
        }
        let text = std::fs::read_to_string(&file).expect("utf-8 source");
        for (n, line) in text.lines().enumerate() {
            let lower = line.to_lowercase();
            // Workspace crate identifiers carry the product prefix by Cargo convention.
            let lower = [
                "maitty_shared",
                "maitty_desktop_client",
                "maitty_provider_codex",
                "maitty-provider-codex",
                "maitty_provider_claude",
                "maitty-provider-claude",
                "maitty_ipc_transport",
                "maitty-ipc-transport",
                "maitty_terminal_client",
                "maitty-terminal-client",
                "maitty_settings",
                "maitty-settings",
            ]
            .into_iter()
            .fold(lower, |line, crate_name| line.replace(crate_name, ""));
            if names.iter().any(|name| names_word(&lower, name)) {
                hits.push(format!("{rel}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    hits
}

#[test]
fn the_apps_name_is_never_written_out() {
    let names = [env!("APP_COMMAND"), env!("APP_NAME")]
        .map(str::to_lowercase)
        .to_vec();
    let hits = lines_naming(&names, &[]);
    assert!(
        hits.is_empty(),
        "take the name from brand (env!(\"APP_COMMAND\") and friends), not as text:\n{}",
        hits.join("\n")
    );
}

/// The installers run on their own (`curl … | sh`), so each names the app and the environment
/// prefix (and the one before it) once; each must be what `Cargo.toml` sets (ADR 0012).
#[test]
fn the_installers_name_what_cargo_toml_sets() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let old = env!("APP_ENV_PREVIOUS").split(',').next().unwrap_or_default();
    for (file, prefix, want) in [
        ("install.sh", "APP=", env!("APP_COMMAND")),
        ("install.ps1", "$app = ", env!("APP_COMMAND")),
        ("install.sh", "ENV_PREFIX=", env!("APP_ENV")),
        ("install.sh", "OLD_ENV_PREFIX=", old),
        ("install.ps1", "$envPrefix = ", env!("APP_ENV")),
        ("install.ps1", "$oldEnvPrefix = ", old),
    ] {
        let text = std::fs::read_to_string(root.join(file)).expect("installer readable");
        let named = text
            .lines()
            .find_map(|l| l.strip_prefix(prefix))
            .map(|v| v.trim().trim_matches(['"', '\'']).to_string());
        assert_eq!(named.as_deref(), Some(want), "{file}'s {prefix}");
    }
}

#[test]
fn names_the_app_had_before_stay_in_carry_over_code() {
    let previous: Vec<String> = env!("APP_PREVIOUS")
        .split(',')
        .filter(|p| !p.is_empty())
        .map(str::to_lowercase)
        .collect();
    let hits = lines_naming(&previous, &CARRY_OVER_FILES);
    assert!(
        hits.is_empty(),
        "name parts by role, not by a name the app had before:\n{}",
        hits.join("\n")
    );
}

/// Rust files of every crate and app, relative to the repository.
fn workspace_sources() -> Vec<(String, String)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    for top in ["crates", "apps/tui", "apps/gui/src-tauri"] {
        let mut found = Vec::new();
        sources(&root.join(top), &mut found);
        files.extend(found);
    }
    files
        .into_iter()
        .filter(|path| path.extension().is_some_and(|e| e == "rs"))
        .filter(|path| !path.components().any(|c| c.as_os_str() == "target"))
        .filter_map(|path| {
            let text = std::fs::read_to_string(&path).ok()?;
            let rel = path
                .strip_prefix(&root)
                .ok()?
                .to_string_lossy()
                .replace('\\', "/");
            Some((rel, text))
        })
        .collect()
}

/// The daemon's name and the variables' prefixes are set in `Cargo.toml` and read through
/// `maitty_shared::brand` (ADR 0012): a rename or a prefix change is that file, not a hunt.
#[test]
fn the_daemon_name_and_the_env_prefixes_are_never_written_out() {
    let daemon = env!("APP_DAEMON");
    let prefixes: Vec<String> = std::iter::once(env!("APP_ENV"))
        .chain(env!("APP_ENV_PREVIOUS").split(',').filter(|p| !p.is_empty()))
        .map(|prefix| format!("{prefix}_"))
        .collect();
    let mut hits = Vec::new();
    for (rel, text) in workspace_sources() {
        // The module that owns the names, and its tests, say them.
        if rel == "crates/maitty-shared/src/brand.rs" {
            continue;
        }
        for (n, line) in text.lines().enumerate() {
            let code = line.trim_start();
            if code.starts_with("//") {
                continue;
            }
            let spelled = line.contains(daemon)
                || prefixes
                    .iter()
                    .any(|prefix| line.contains(&format!("\"{prefix}")) || line.contains(&format!("'{prefix}")));
            if spelled {
                hits.push(format!("{rel}:{}: {}", n + 1, code));
            }
        }
    }
    assert!(
        hits.is_empty(),
        "read the daemon's name and the env prefixes from maitty_shared::brand, do not write them:\n{}",
        hits.join("\n")
    );
}
