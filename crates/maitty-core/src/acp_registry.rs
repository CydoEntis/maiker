//! Installing agents from the ACP registry (ADR 0021), so an agent run over ACP needs no
//! hand-written `[[agents]]` entry and no manual install.
//!
//! The registry is one public JSON file. Everything in it is untrusted input: an entry is used
//! only when every part of it passes the checks here, and what is downloaded is run only after
//! its checksum matched. Nothing here runs on the daemon's thread: the command line does the
//! downloading (`agents install`), and the daemon only reads the small file that says what is
//! installed.

use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

/// The registry's index. Fixed in code: no setting or input names another.
pub const REGISTRY_URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const MAX_INDEX_BYTES: u64 = 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 1024 * 1024 * 1024;
const INDEX_SECONDS: &str = "30";
const DOWNLOAD_SECONDS: &str = "1200";
const MAX_LISTED: usize = 512;
const MAX_NAME: usize = 160;
const MAX_DESCRIPTION: usize = 1024;
const MAX_VERSION: usize = 64;
const MAX_URL: usize = 2048;
const MAX_WORDS: usize = 32;
const MAX_WORD: usize = 4096;
const SHA256_HEX: usize = 64;

/// Registry entries that only wrap an agent this app runs through its own adapter (ADR 0020).
const NATIVE_HELPERS: [&str; 2] = ["claude-acp", "codex-acp"];

#[derive(Deserialize)]
struct Index {
    agents: Vec<serde_json::Value>,
}

/// One agent as the registry lists it, already checked for shape.
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Listed {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    distribution: Distribution,
}

#[derive(Deserialize, Clone, Debug, Default, PartialEq, Eq)]
struct Distribution {
    #[serde(default)]
    binary: BTreeMap<String, BinaryTarget>,
    npx: Option<Package>,
    uvx: Option<serde_json::Value>,
}

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
struct BinaryTarget {
    archive: String,
    cmd: String,
    sha256: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
struct Package {
    package: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

/// How an agent gets onto this computer.
#[derive(Debug, PartialEq, Eq)]
pub enum Source {
    /// A download whose checksum the registry gives.
    Binary { url: String, sha256: String, command: PathBuf, args: Vec<String>, env: BTreeMap<String, String> },
    /// An npm package at one exact version, installed with this computer's npm.
    Npm { name: String, version: String, args: Vec<String>, env: BTreeMap<String, String> },
}

impl Source {
    /// `binary` or `npm`, for a list to say.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Binary { .. } => "binary",
            Self::Npm { .. } => "npm",
        }
    }
}

/// An agent this app installed: what the daemon runs for its name.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Installed {
    pub name: String,
    pub version: String,
    pub command: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/// The agents of an index, in its order. An entry that is not well formed is left out rather
/// than failing the list, and so are the helpers of agents that have their own adapter.
pub fn parse_index(text: &str) -> Result<Vec<Listed>> {
    let index: Index = serde_json::from_str(text).context("The ACP registry's list is not readable")?;
    Ok(index
        .agents
        .into_iter()
        .take(MAX_LISTED)
        .filter_map(|entry| serde_json::from_value::<Listed>(entry).ok())
        .filter(|listed| !NATIVE_HELPERS.contains(&listed.id.as_str()))
        .filter_map(well_formed)
        .collect())
}

fn well_formed(mut listed: Listed) -> Option<Listed> {
    let named = maitty_shared::conversation::acp_agent_name(&listed.id)
        && plain(&listed.name, MAX_NAME)
        && !listed.name.trim().is_empty()
        && version_like(&listed.version);
    // A description is only shown, so it is cleaned instead of costing the entry.
    listed.description = listed.description.chars().filter(|c| !c.is_control()).take(MAX_DESCRIPTION).collect();
    named.then_some(listed)
}

fn plain(text: &str, max: usize) -> bool {
    text.len() <= max && !text.chars().any(char::is_control)
}

/// A version is part of a folder name and of a package spec, so it is letters, digits and `._+-`
/// only, and never starts with a dot.
fn version_like(text: &str) -> bool {
    text.len() <= MAX_VERSION
        && text.chars().next().is_some_and(|first| first.is_ascii_alphanumeric())
        && text.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '+' | '-'))
}

/// The registry's name for the kind of computer this is.
pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

/// How `listed` is installed on `platform`, or why it cannot be, in words for the person.
pub fn source(listed: &Listed, platform: &str) -> Result<Source, String> {
    // Windows on ARM runs x86_64 programs, and a Linux build for musl runs where glibc is too.
    let fallbacks: &[&str] = match platform {
        "windows-aarch64" => &["windows-x86_64"],
        "linux-x86_64" => &["linux-x86_64-musl"],
        "linux-aarch64" => &["linux-aarch64-musl"],
        _ => &[],
    };
    let binary = std::iter::once(platform)
        .chain(fallbacks.iter().copied())
        .find_map(|key| listed.distribution.binary.get(key));
    if let Some(target) = binary {
        return binary_source(target);
    }
    if let Some(package) = &listed.distribution.npx {
        return npm_source(package);
    }
    Err(if !listed.distribution.binary.is_empty() {
        "has no download for this kind of computer".into()
    } else if listed.distribution.uvx.is_some() {
        "is a Python package, which is not installed from here yet".into()
    } else {
        "names no way to install it".into()
    })
}

fn binary_source(target: &BinaryTarget) -> Result<Source, String> {
    if !https_url(&target.archive) {
        return Err("names a download that is not a plain https address".into());
    }
    let sha256 = target
        .sha256
        .as_deref()
        .filter(|sum| sum.len() == SHA256_HEX && sum.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("publishes no checksum for its download, so it is not installed from here")?
        .to_ascii_lowercase();
    let command = relative_path(&target.cmd).ok_or("names a program outside its own folder")?;
    words(&target.args, &target.env)?;
    Ok(Source::Binary { url: target.archive.clone(), sha256, command, args: target.args.clone(), env: target.env.clone() })
}

fn npm_source(package: &Package) -> Result<Source, String> {
    // `name@1.2.3` or `@scope/name@1.2.3`: the last `@` splits them, and a version is required.
    let (name, version) = package
        .package
        .rsplit_once('@')
        .filter(|(name, _)| !name.is_empty())
        .ok_or("names an npm package with no exact version")?;
    let named = name.len() <= MAX_NAME
        && !name.starts_with(['-', '.'])
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '@' | '/' | '.' | '_' | '-'))
        && name.matches('/').count() == usize::from(name.starts_with('@'));
    if !named || !version_like(version) || !version.starts_with(|c: char| c.is_ascii_digit()) {
        return Err("names an npm package this app does not take".into());
    }
    words(&package.args, &package.env)?;
    Ok(Source::Npm { name: name.into(), version: version.into(), args: package.args.clone(), env: package.env.clone() })
}

/// The arguments and variables an entry gives its program, held to what a config entry may give.
fn words(args: &[String], env: &BTreeMap<String, String>) -> Result<(), String> {
    let plain_words = args.len() <= MAX_WORDS
        && env.len() <= MAX_WORDS
        && args.iter().chain(env.values()).all(|word| plain(word, MAX_WORD));
    let named = env.keys().all(|name| {
        name.chars().next().is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
            && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            // The daemon's own identity is never a provider's to hold.
            && !crate::ipc::is_identity_env(name)
    });
    if plain_words && named { Ok(()) } else { Err("gives its program arguments or variables this app does not take".into()) }
}

fn https_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
    url.len() <= MAX_URL
        && !host.is_empty()
        // No name and password in the address, and nothing a command line could misread.
        && !host.contains('@')
        && url.chars().all(|c| c.is_ascii_graphic())
}

/// `text` as a path that stays inside the folder it is joined to: no root, no drive, no `..`.
fn relative_path(text: &str) -> Option<PathBuf> {
    if !plain(text, MAX_WORD) || text.contains(':') || text.contains('\\') {
        return None;
    }
    let path: PathBuf = Path::new(text)
        .components()
        .filter(|part| !matches!(part, Component::CurDir))
        .map(|part| match part {
            Component::Normal(name) => Some(name),
            _ => None,
        })
        .collect::<Option<_>>()?;
    (!path.as_os_str().is_empty()).then_some(path)
}

/// Where this app keeps the agents it installed, under its data folder.
pub fn root(data: &Path) -> PathBuf {
    data.join("acp-agents")
}

fn installed_file(data: &Path) -> PathBuf {
    root(data).join("installed.json")
}

/// The agents installed from the registry, by name. A file that is missing or unreadable is none.
pub fn installed(data: &Path) -> BTreeMap<String, Installed> {
    std::fs::read_to_string(installed_file(data))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_installed(data: &Path, agents: &BTreeMap<String, Installed>) -> Result<()> {
    let text = serde_json::to_string_pretty(agents)?;
    crate::config::write_atomic(&installed_file(data), text).context("writing the list of installed agents")
}

/// The registry's list, fetched now. When it cannot be fetched the last list fetched is used.
pub fn fetch_index(data: &Path) -> Result<Vec<Listed>> {
    let cache = root(data).join("registry.json");
    let fresh = root(data).join(format!(".registry-{}.json", std::process::id()));
    std::fs::create_dir_all(root(data)).context("making the agents folder")?;
    let fetched = download(REGISTRY_URL, &fresh, INDEX_SECONDS, MAX_INDEX_BYTES)
        .and_then(|()| std::fs::read_to_string(&fresh).context("reading the registry's list"))
        .and_then(|text| parse_index(&text).map(|agents| (text, agents)));
    let _ = std::fs::remove_file(&fresh);
    match fetched {
        Ok((text, agents)) => {
            // Kept for a time with no network; losing it costs nothing.
            let _ = crate::config::write_atomic(&cache, text);
            Ok(agents)
        }
        Err(error) => match std::fs::read_to_string(&cache) {
            Ok(text) => parse_index(&text),
            Err(_) => Err(error.context("The ACP registry could not be reached")),
        },
    }
}

/// Downloads `url` to `to` with the system's curl: https only, redirects included, bounded in
/// time and size. The address is one argument, never part of a shell line.
fn download(url: &str, to: &Path, seconds: &str, max_bytes: u64) -> Result<()> {
    crate::proc::run(
        crate::proc::system_tool("curl")
            .args(["-fsSL", "--proto", "=https", "--proto-redir", "=https", "--max-time", seconds])
            .args(["--max-filesize", &max_bytes.to_string(), "-o"])
            .arg(to)
            .arg("--")
            .arg(url),
    )
    .map_err(|why| anyhow!("downloading {url}: {why}"))?;
    let size = std::fs::metadata(to).context("the download is not there")?.len();
    // curl only refuses a size the server announced, so it is measured again.
    if size > max_bytes {
        bail!("the download is larger than this app takes");
    }
    Ok(())
}

fn sha256_of(file: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut hasher = Sha256::new();
    let mut input = std::fs::File::open(file).context("opening the download")?;
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = input.read(&mut buffer).context("reading the download")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Refuses a download that is not the one the registry described.
fn verify(file: &Path, sha256: &str) -> Result<()> {
    let found = sha256_of(file)?;
    if found != sha256 {
        bail!("the download's checksum is {found}, not the {sha256} the registry gives; nothing was installed");
    }
    Ok(())
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum Packing {
    Tar,
    Zip,
    /// The download is the program itself.
    Program,
}

fn packing(url: &str) -> Packing {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_ascii_lowercase();
    if [".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz"].iter().any(|end| path.ends_with(end)) {
        Packing::Tar
    } else if path.ends_with(".zip") {
        Packing::Zip
    } else {
        Packing::Program
    }
}

/// Whether every name an archive lists stays inside the folder it is unpacked into.
fn entries_stay_inside(listing: &str) -> bool {
    listing.lines().filter(|line| !line.trim().is_empty()).all(|entry| {
        let entry = entry.trim_end_matches('/');
        !entry.starts_with(['/', '\\'])
            && !entry.contains(':')
            && !entry.split(['/', '\\']).any(|part| part == "..")
    })
}

/// Puts the checked download into `folder` and answers the program's place in it.
fn unpack(file: &Path, packing: Packing, command: &Path, folder: &Path) -> Result<PathBuf> {
    // Windows' own tar reads zips; elsewhere a zip needs unzip.
    let unzip = packing == Packing::Zip && !cfg!(windows);
    match packing {
        Packing::Program => {
            let to = folder.join(command);
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).context("making the program's folder")?;
            }
            std::fs::copy(file, &to).context("placing the program")?;
        }
        Packing::Tar | Packing::Zip => {
            let listing = if unzip {
                crate::proc::run(Command::new("unzip").arg("-Z1").arg(file))
            } else {
                crate::proc::run(crate::proc::system_tool("tar").arg("-tf").arg(file))
            }
            .map_err(|why| anyhow!("reading the download's contents: {why}"))?;
            if !entries_stay_inside(&listing) {
                bail!("the download holds a file that would land outside its own folder; nothing was installed");
            }
            if unzip {
                crate::proc::run(Command::new("unzip").arg("-q").arg(file).arg("-d").arg(folder))
            } else {
                crate::proc::run(crate::proc::system_tool("tar").arg("-xf").arg(file).arg("-C").arg(folder))
            }
            .map_err(|why| anyhow!("unpacking the download: {why}"))?;
        }
    }
    inside(folder, &folder.join(command)).context("the download does not hold the program the registry names")
}

/// `file`'s real place, as a path relative to `folder`, when it is a file inside it.
fn inside(folder: &Path, file: &Path) -> Result<PathBuf> {
    let folder = std::fs::canonicalize(folder)?;
    let real = std::fs::canonicalize(file)?;
    let relative = real.strip_prefix(&folder).map_err(|_| anyhow!("it leads outside its own folder"))?;
    if !real.is_file() {
        bail!("it is not a file");
    }
    Ok(relative.to_path_buf())
}

#[cfg(unix)]
fn make_runnable(file: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o755)).context("making the program runnable")
}

#[cfg(not(unix))]
fn make_runnable(_file: &Path) -> Result<()> {
    Ok(())
}

/// A program on the PATH a login shell would have, by any of `names`.
fn on_path(names: &[&str]) -> Option<PathBuf> {
    let path = crate::login_path::effective_path()?;
    std::env::split_paths(&path)
        .flat_map(|folder| names.iter().map(move |name| folder.join(name)))
        .find(|file| file.is_file())
}

/// What an npm package says runs it: its `bin`, checked against the name and version asked for.
fn package_program(manifest: &str, name: &str, version: &str) -> Result<PathBuf> {
    let manifest: serde_json::Value = serde_json::from_str(manifest).context("the package's description is not readable")?;
    if manifest["name"] != name || manifest["version"] != version {
        bail!("npm installed another package or version than the registry names");
    }
    let unscoped = name.rsplit('/').next().unwrap_or(name);
    let bin = match &manifest["bin"] {
        serde_json::Value::String(path) => Some(path.as_str()),
        serde_json::Value::Object(programs) => programs
            .get(unscoped)
            .or_else(|| programs.values().next())
            .and_then(serde_json::Value::as_str),
        _ => None,
    };
    bin.and_then(relative_path).ok_or_else(|| anyhow!("the package names no program to run"))
}

/// Installs an npm package into `folder` alone, and answers Node and the script to run with it.
fn install_npm(name: &str, version: &str, folder: &Path) -> Result<(PathBuf, PathBuf)> {
    let npm = on_path(if cfg!(windows) { &["npm.cmd"] } else { &["npm"] })
        .ok_or_else(|| anyhow!("this agent is an npm package, and npm (Node.js) is not installed on this computer"))?;
    let node = on_path(if cfg!(windows) { &["node.exe"] } else { &["node"] })
        .ok_or_else(|| anyhow!("this agent runs on Node.js, which is not installed on this computer"))?;
    let mut install = Command::new(npm);
    install
        .args(["install", "--global", "--no-fund", "--no-audit", "--loglevel=error", "--prefix"])
        .arg(folder)
        .arg(format!("{name}@{version}"));
    if let Some(path) = crate::login_path::effective_path() {
        install.env("PATH", path);
    }
    crate::proc::run(&mut install).map_err(|why| anyhow!("npm could not install {name}: {why}"))?;
    // npm keeps a prefix's packages under `lib` everywhere but Windows.
    let modules = if cfg!(windows) { folder.join("node_modules") } else { folder.join("lib").join("node_modules") };
    let package = name.split('/').fold(modules, |path, part| path.join(part));
    let manifest = std::fs::read_to_string(package.join("package.json")).context("npm did not install the package")?;
    let script = inside(folder, &package.join(package_program(&manifest, name, version)?))
        .context("the package's program is not in the package")?;
    Ok((node, script))
}

/// Installs `listed` under `data` and records it, replacing any version installed before.
/// Everything is made in a folder beside the final one, which only then takes its place, so a
/// failure leaves what was installed before as it was.
pub fn install(listed: &Listed, data: &Path) -> Result<Installed> {
    let source = source(listed, &platform()).map_err(|why| anyhow!("{} {why}", listed.name))?;
    let home = root(data).join(&listed.id);
    let target = home.join(&listed.version);
    let staging = home.join(format!(".staging-{}", std::process::id()));
    let fetched = home.join(format!(".download-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).context("making the agent's folder")?;
    let staged = stage(&source, &staging, &fetched);
    let _ = std::fs::remove_file(&fetched);
    let (command, mut args, env) = match staged {
        Ok(staged) => staged,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error.context(format!("{} was not installed", listed.name)));
        }
    };
    if target.exists() {
        std::fs::remove_dir_all(&target).context("removing the version installed before; stop the agent's chats first")?;
    }
    std::fs::rename(&staging, &target).context("placing the agent")?;
    let agent = match command {
        Staged::Program(program) => Installed { command: target.join(program), args, env, name: listed.name.clone(), version: listed.version.clone() },
        Staged::Script { node, script } => {
            args.insert(0, target.join(script).to_string_lossy().into_owned());
            Installed { command: node, args, env, name: listed.name.clone(), version: listed.version.clone() }
        }
    };
    let mut agents = installed(data);
    agents.insert(listed.id.clone(), agent.clone());
    write_installed(data, &agents)?;
    remove_other_versions(&home, &listed.version);
    Ok(agent)
}

enum Staged {
    Program(PathBuf),
    Script { node: PathBuf, script: PathBuf },
}

type StagedAgent = (Staged, Vec<String>, BTreeMap<String, String>);

fn stage(source: &Source, staging: &Path, fetched: &Path) -> Result<StagedAgent> {
    match source {
        Source::Binary { url, sha256, command, args, env } => {
            download(url, fetched, DOWNLOAD_SECONDS, MAX_ARCHIVE_BYTES)?;
            verify(fetched, sha256)?;
            let program = unpack(fetched, packing(url), command, staging)?;
            make_runnable(&staging.join(&program))?;
            Ok((Staged::Program(program), args.clone(), env.clone()))
        }
        Source::Npm { name, version, args, env } => {
            let (node, script) = install_npm(name, version, staging)?;
            Ok((Staged::Script { node, script }, args.clone(), env.clone()))
        }
    }
}

/// An older version is only disk space once the new one is recorded, so failing to remove one
/// (a chat still running it on Windows) is not a failed install.
fn remove_other_versions(home: &Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(home) else {
        return;
    };
    for entry in entries.flatten().filter(|entry| entry.file_name() != keep) {
        let _ = std::fs::remove_dir_all(entry.path());
    }
}

/// Takes an installed agent off this computer. Answers whether there was one.
pub fn remove(id: &str, data: &Path) -> Result<bool> {
    if !maitty_shared::conversation::acp_agent_name(id) {
        bail!("{id:?} is not an agent's name");
    }
    let mut agents = installed(data);
    let was = agents.remove(id).is_some();
    if was {
        write_installed(data, &agents)?;
    }
    let home = root(data).join(id);
    if home.is_dir() {
        std::fs::remove_dir_all(&home).context("removing the agent's files; stop its chats first")?;
    }
    Ok(was)
}

#[cfg(test)]
mod tests;
