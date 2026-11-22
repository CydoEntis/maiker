//! Wire protocol between the daemon and its clients (the TUI and one-shot CLI calls).
//!
//! Frames are length-delimited MessagePack. The daemon is the single source of truth for
//! the workspace / tab / pane tree; clients render `Snapshot`s and send `Command`s.

use crate::layout::{Dir, Node};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Bump when a message shape changes incompatibly (docs/API_PATTERNS.md, *Project-specific: API
/// style*). A client and a daemon on different versions talk only inside the window
/// `COMPATIBLE_SINCE` opens; outside it they refuse, and so do hooks.
pub const PROTOCOL_VERSION: u32 = 123;

/// The longest side question, in characters.
pub const SIDE_QUESTION_MAX_CHARS: usize = 4000;

/// The most of a side answer a reply carries, in bytes; the rest is cut.
pub const SIDE_ANSWER_MAX_BYTES: usize = 64 * 1024;

/// What `Query::SideAnswer` asks Claude Code, beside the conversation and without changing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SideAsk {
    /// A question answered from the conversation so far, with no tools: Claude Code's `/btw`.
    Question(String),
    /// One of Claude Code's commands that only reports, run with nothing after its name.
    Command(SideCommand),
}

/// The commands a side answer may run: each only reports, and none takes anything, so none can
/// change a setting (`/config key=value` and `/goal <condition>` would; those are never sent).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SideCommand {
    Context,
    Usage,
    SkillDoctor,
    Goal,
    Advisor,
    Config,
    Mcp,
}

impl SideCommand {
    /// The command as Claude Code reads it.
    pub fn typed(self) -> &'static str {
        match self {
            SideCommand::Context => "/context",
            SideCommand::Usage => "/usage",
            SideCommand::SkillDoctor => "/skill-doctor",
            SideCommand::Goal => "/goal",
            SideCommand::Advisor => "/advisor",
            SideCommand::Config => "/config",
            SideCommand::Mcp => "/mcp",
        }
    }
}

/// What `Query::SideAnswer` got back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SideAnswer {
    /// What Claude Code printed, at most `SIDE_ANSWER_MAX_BYTES`.
    Answered { text: String },
    /// The conversation is not a Claude one this daemon can answer beside.
    NotSupported,
    /// Claude Code could not answer, in words that carry nothing it printed.
    Failed { reason: String },
}

/// The most conversations one `Reply::SavedConversations` carries.
pub const SAVED_CONVERSATIONS_MAX: usize = 20;

/// The longest first message a saved conversation is listed with, in characters.
pub const SAVED_FIRST_MESSAGE_MAX_CHARS: usize = 200;

/// A conversation an agent saved on the daemon's computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedConversation {
    /// The agent's own id for it: what its resume option takes.
    pub id: String,
    /// The first thing the person typed, as one clean line of at most
    /// `SAVED_FIRST_MESSAGE_MAX_CHARS` characters.
    pub first_message: String,
    /// When its file was last written (unix seconds).
    pub last_active: u64,
}

/// What `Query::SavedConversations` found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SavedConversations {
    /// Newest first, at most `SAVED_CONVERSATIONS_MAX`; empty when the folder has none.
    Listed(Vec<SavedConversation>),
    /// The daemon reads no saved conversations for this agent.
    NotSupported,
}

/// The most closed sessions the daemon keeps and a list carries; the oldest go first.
pub const CLOSED_SESSIONS_MAX: usize = 50;

/// What a helper did, read from the provider's own file for it (ADR 0010). Display only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperRecord {
    pub term: TermId,
    /// The helper's id, as `SubagentActivity::id` names it.
    pub helper: String,
    /// Oldest first.
    pub entries: Vec<crate::conversation::history::Entry>,
    /// The file held more than this: its start is left out.
    pub start_missing: bool,
}

/// An agent session that closed for good or whose agent exited with an error: where it worked, so
/// it can be found again. It holds no message or terminal content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosedSession {
    /// The agent's name (`claude`, `codex`, ...).
    pub agent: String,
    /// The agent's own conversation id, the one it resumes by.
    pub session: String,
    /// The folder it worked in.
    pub cwd: PathBuf,
    /// The branch checked out there, when it was in git.
    pub branch: Option<String>,
    /// The name it was given, cleaned (`conversation::clean_title`).
    pub title: Option<String>,
    /// When it closed (unix seconds).
    pub at: u64,
    /// The top folder of the linked worktree it worked in, when it was in one.
    #[serde(default)]
    pub worktree: Option<PathBuf>,
    /// The main checkout of that worktree's repository: the only one it is ever made again in.
    #[serde(default)]
    pub repo: Option<PathBuf>,
}

/// The most files and lines one answer about a rule carries.
pub const GIT_RULE_FILES_MAX: usize = 4;
pub const GIT_RULE_LINES_MAX: usize = 16;


/// What a `Query::GitIdentityRule` does to a folder's rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitRuleChange {
    /// The lines that `Apply` would write, written nowhere.
    Preview { folder: String, identity: GitIdentity },
    /// Write the rule: `folder` (which must be there) commits as `identity` and signs in to
    /// github.com as its login, which must be signed in on the machine. A rule Maiker wrote for
    /// the folder before is replaced; one set outside Maiker is refused.
    Apply { folder: String, identity: GitIdentity },
    /// Take away the rule Maiker wrote for `folder`, named as `GitIdentityRule::folder` names it.
    Remove { folder: String },
}

/// Lines of one config file, each `key = value`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitConfigWrite {
    pub file: String,
    pub lines: Vec<String>,
}

/// The most folder rules one report carries.
pub const GIT_IDENTITY_RULES_MAX: usize = 100;
/// The longest name, email or folder a report carries, in characters.
pub const GIT_IDENTITY_TEXT_MAX_CHARS: usize = 1024;

/// What `Query::GitIdentities` found in the machine's global git config. Never a credential.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitIdentityReport {
    /// False when the machine has no git; the rest is then empty.
    pub installed: bool,
    /// The name and email commits carry where no rule applies; each is absent when not set.
    pub name: Option<String>,
    pub email: Option<String>,
    /// The folders whose checkouts use something else, in the order git reads them.
    pub rules: Vec<GitIdentityRule>,
    /// One line saying why the config could not be read, when it could not.
    pub problem: Option<String>,
}

/// One `includeIf "gitdir:<folder>/"` entry of the global git config.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitIdentityRule {
    /// The folder as the entry writes it, without the closing slash.
    pub folder: String,
    /// What the rule sets, when Maiker wrote it. `None` for a rule set outside Maiker: it is
    /// listed so it can be seen, and nothing of what it sets is read.
    pub identity: Option<GitIdentity>,
}

/// Who commits, and as which GitHub account git signs in, inside a folder with a rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitIdentity {
    pub name: String,
    pub email: String,
    pub login: String,
}

/// How long the daemon gives one commit, in seconds: the repository's own hooks run in it.
pub const GIT_COMMIT_LIMIT_SECS: u64 = 120;
/// The longest commit message taken, in bytes.
pub const GIT_COMMIT_MESSAGE_MAX_BYTES: usize = 16 * 1024;
/// The most that the paths of one commit may add up to, in bytes: they are passed to git as
/// arguments, and a command line only holds so much.
pub const GIT_COMMIT_PATHS_MAX_BYTES: usize = 24 * 1024;

/// How long the daemon gives one fetch, pull or push, in seconds.
pub const GIT_SYNC_LIMIT_SECS: u64 = 60;

/// What a `Query::Git` does to the checkout a pane is in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitRequest {
    /// Bring what is known of the remote up to date, dropping the branches it no longer has.
    Fetch,
    /// Fast-forward the branch to its upstream. A branch with commits of its own as well is left
    /// as it is: nothing is merged or rebased.
    Pull,
    /// Send the branch to its upstream, or to `origin` under its own name when it has none yet.
    /// Never forced.
    Push,
    /// Commit `paths` with `message`, or everything that changed when no paths are named. Each
    /// path is a file's name relative to the checkout, with `/` between its parts. Whatever else
    /// is staged stays out of a commit that names paths. The answer's line is the new commit's
    /// short id, a space and its subject.
    Commit {
        message: String,
        paths: Option<Vec<String>>,
    },
    /// Push the branch, then open a GitHub pull request for it with the machine's GitHub command
    /// line, titled and described from its commits. The answer's line is the pull request's
    /// address, always `https://github.com/<owner>/<repo>/pull/<number>`.
    PullRequest,
}

/// How long the daemon gives `gh` to list repositories or organisations.
pub const GITHUB_LIST_LIMIT_SECS: u64 = 30;

/// GitHub's own sign-in, as a terminal session runs it: the person finishes it there and in their
/// browser. Both clients start exactly this line; nothing a window sends is part of it.
pub const GITHUB_SIGN_IN_COMMAND: &str = "gh auth login --web --git-protocol https";

/// The longest sign-in link a reply carries, in bytes. A longer one is dropped, not cut.
pub const SIGN_IN_LINK_MAX_BYTES: usize = 2048;

/// The longest one-time code a reply carries, in characters.
pub const SIGN_IN_CODE_MAX_CHARS: usize = 24;

/// An agent whose account the daemon can sign in with the agent's own command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignInAgent {
    Claude,
    Codex,
    /// Named so the answer can say plainly that its command line has no sign-in to run.
    Gemini,
    /// GitHub's own command line (`gh auth login --web`), so a window shows the code instead of a terminal.
    /// `gh` keeps the token; the daemon never reads it (ADR 0006).
    Github,
}

/// What a client asks of an agent's sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignInRequest {
    /// Run the agent's own login in the background. Asked while one is already running, it
    /// answers with that one rather than starting a second.
    Start,
    /// Stop the login that is running. Nothing running is not an error.
    Cancel,
    /// Say where the sign-in stands, changing nothing.
    Read,
    /// Sign the account out with the program's own command. Only GitHub has one here: the answer is
    /// `SignedIn` when an account is still signed in afterwards, `Idle` when none is.
    SignOut,
}

/// Why a sign-in did not end signed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignInFailure {
    /// The agent's command line is not on this computer.
    NotInstalled,
    /// The agent's command line has no sign-in a program can run.
    Unsupported,
    /// The command could not be started.
    CouldNotStart,
    /// Nobody finished it in time.
    TimedOut,
    /// The command ended, or the agent still says it is signed out afterwards.
    Ended,
}

/// Where an agent's sign-in stands. Never a token: the link and the code are what the agent's
/// command printed for the person to use, and nothing else it printed is kept.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignInState {
    /// Nothing has been started since the daemon did.
    Idle,
    /// The command runs, waiting for the person. `link` is an `https://` address from its
    /// output and `code` the one-time code it asks to be entered there; each is absent until
    /// the command has printed it, and absent for good when it never does.
    Waiting {
        link: Option<String>,
        code: Option<String>,
    },
    /// The agent's own status command says it is signed in.
    SignedIn,
    Failed(SignInFailure),
}

/// Which part of a clone git is in, as its own progress lines name them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClonePhase {
    /// The remote counts what to send ("Counting objects").
    Counting,
    Compressing,
    /// Objects arrive: the long part of most clones ("Receiving objects").
    Receiving,
    Resolving,
    /// The files are written ("Updating files").
    CheckingOut,
}

/// The most branches of each kind (local, then remote-tracking) one folder listing carries.
pub const FOLDER_BRANCHES_MAX: usize = 500;
/// The most worktrees one folder listing carries.
pub const FOLDER_WORKTREES_MAX: usize = 100;
/// How long the daemon gives one command of a `Query::FolderGit`.
pub const FOLDER_GIT_LIMIT_SECS: u64 = 15;

/// What a `Query::FolderGit` does in a folder of this daemon's computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FolderGitRequest {
    /// The local and remote-tracking branches, and the worktrees.
    Branches,
    /// Switch to an existing local branch.
    Switch { branch: String },
    /// Make a branch from where the checkout is and switch to it.
    Create { branch: String },
    /// Switch to a local branch that follows a remote-tracking one: `remote_branch` is as listed,
    /// `origin/feature`, and the local branch is named `feature`. Refused when that name is taken.
    CheckoutRemote { remote_branch: String },
}

/// One branch of a folder's repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderBranch {
    /// A local branch's name, or a remote-tracking branch's with its remote in front (`origin/main`).
    pub name: String,
    pub current: bool,
    /// Unix seconds of its last commit.
    pub when: Option<i64>,
    /// A remote-tracking branch: what was last fetched, not a branch to commit to.
    pub remote: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderWorktree {
    pub path: String,
    pub branch: Option<String>,
    pub main: bool,
    pub when: Option<i64>,
}

/// A folder's branches and worktrees: local branches first, then remote-tracking ones, each newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderBranches {
    pub current: Option<String>,
    pub branches: Vec<FolderBranch>,
    pub worktrees: Vec<FolderWorktree>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FolderGitAnswer {
    /// The folder is not inside a git repository.
    NotARepo,
    Branches(FolderBranches),
    /// The checkout is now on this local branch.
    Switched { branch: String },
}

/// The most agents `MachineFacts` names.
pub const MACHINE_FACTS_AGENTS_MAX: usize = 16;

/// An agent program found on a machine's PATH.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentFact {
    /// The program's name (`claude`, `codex`).
    pub name: String,
    /// What its `--version` printed, when that held a version number.
    pub version: Option<String>,
}

/// What a machine's daemon says about the computer it runs on. Nothing here is a secret: no
/// paths, no environment, no logins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MachineFacts {
    /// The name the computer gives itself, when it has one.
    pub host_name: Option<String>,
    /// `windows`, `macos` or `linux`, as Rust names them.
    pub os: String,
    /// The system's own words for its version ("Windows 11 Home 24H2"), when it gives one.
    pub os_version: Option<String>,
    /// `x86_64` or `aarch64`, as Rust names them.
    pub arch: String,
    pub cpu_cores: u32,
    pub agents: Vec<AgentFact>,
}

/// How long a daemon lets one clone run before it stops it, in seconds. A client waits a little
/// longer than this for the answer.
pub const CLONE_LIMIT_SECS: u64 = 600;

/// A command a person approved "always in this project" for a chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AllowedCommand {
    /// The project's main checkout.
    pub project: PathBuf,
    /// The command as it was shown (secrets hidden).
    pub command: String,
    /// What the rule holds to; sent back to forget it.
    pub command_sha256: String,
    /// When it was approved (unix seconds).
    pub at: u64,
}

/// The oldest `PROTOCOL_VERSION` this build still talks to, in either role. It stays behind
/// `PROTOCOL_VERSION` only across changes an older peer can live with: a new message it is never
/// sent (`ServerMsg::introduced_in`), or a field it does not need. Set it to the current version
/// in the change that removes, renames or retypes anything an older peer reads or writes, or
/// that adds a value inside a message it is still sent (a new `Status`, say): such a peer would
/// misread, and that is refused. 121 added a provider (`Provider::Acp`, ADR 0019): a peer before
/// it cannot read a list of conversations that holds one. 122 added a start a daemon before it
/// cannot read (`StartTarget::Agent`), so a client would wait on a chat that never starts.
pub const COMPATIBLE_SINCE: u32 = 122;
/// Whether this build and a peer talk. The older of the two cannot know what came after it, so
/// the newer one decides: `peer_compatible_since` is what the peer said in the handshake (0 from
/// a build that says nothing, which then talks only to its own version).
pub fn speaks_with(peer_version: u32, peer_compatible_since: u32) -> bool {
    match peer_version.cmp(&PROTOCOL_VERSION) {
        std::cmp::Ordering::Equal => true,
        std::cmp::Ordering::Less => peer_version >= COMPATIBLE_SINCE,
        std::cmp::Ordering::Greater => {
            (1..=PROTOCOL_VERSION).contains(&peer_compatible_since)
        }
    }
}

/// The oldest `PROTOCOL_VERSION` whose daemon reads today's `Hook` and `Usage` reports. An
/// agent's hooks run the installed binary, which an update replaces while the old daemon keeps
/// running: refusing every report until that daemon restarted left each pane's status wrong for
/// as long. Set this to the current version in the change that makes either report unreadable
/// to an older daemon: a field removed, renamed or retyped, or a new `HookStatus`. The test
/// `todays_reports_are_read_by_the_oldest_daemon_they_are_sent_to` holds the shapes it promises.
pub const REPORTS_READ_SINCE: u32 = 76;

/// Whether a daemon at `daemon_version` reads this build's hook and usage reports: the same
/// version, or an older one the reports have not changed shape since. A newer daemon is refused,
/// as nothing here can know what it expects.
pub fn daemon_reads_reports(daemon_version: u32) -> bool {
    (REPORTS_READ_SINCE..=PROTOCOL_VERSION).contains(&daemon_version)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StructuredIdentity {
    pub conversation: crate::conversation::ConversationId,
    pub generation: u64,
    pub connection: u64,
    pub token: String,
}

impl std::fmt::Debug for StructuredIdentity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StructuredIdentity")
            .field("conversation", &self.conversation)
            .field("generation", &self.generation)
            .field("connection", &self.connection)
            .finish_non_exhaustive()
    }
}

pub type TermId = u32;
pub type WsId = u32;
pub type TabId = u32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum SessionKey {
    Pane(TermId),
    Conversation(crate::conversation::ConversationId),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: crate::conversation::ConversationId,
    pub generation: u64,
    pub provider: crate::conversation::Provider,
    #[serde(default)]
    pub execution: crate::conversation::ExecutionKind,
    pub cwd: PathBuf,
    pub worktree: Option<PathBuf>,
    pub state: crate::conversation::RecoveryState,
    pub status: Status,
    pub native_term: Option<TermId>,
    pub checks: Vec<CheckInfo>,
    /// Your name for it, shared by every client.
    #[serde(default)]
    pub title: Option<String>,
    /// Put away: hidden from the lists, still running.
    #[serde(default)]
    pub archived: bool,
    /// The main checkout of the repository the conversation works in, so a chat session sits with its
    /// project in a list (ADR 0003). Absent outside git.
    #[serde(default)]
    pub root: Option<PathBuf>,
    /// The branch checked out there.
    #[serde(default)]
    pub branch: Option<String>,
    /// The helpers the provider reported this conversation starting, at its current generation
    /// (ADR 0010). Display only. Empty from an older daemon.
    #[serde(default)]
    pub helpers: Vec<SubagentActivity>,
    /// The helpers this chat asked to start and is waiting on you for, one task each (ADR 0016). Not
    /// empty means it needs you, and `status` reads Blocked; `AnswerChatHelpers` answers it. Empty
    /// from an older daemon.
    #[serde(default)]
    pub helper_ask: Vec<String>,
    /// What the conversation's provider can do, as the daemon knows it. Absent for a conversation
    /// the daemon does not run (a followed pane) and from an older daemon; a client then falls
    /// back to what it knows about the agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<crate::conversation::capabilities::Capabilities>,
    /// The agent an ACP conversation runs, by its name in the daemon's config. Absent for every
    /// other provider, whose name is the agent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
}

impl ConversationSummary {
    /// The agent's name as a person reads it: the provider's, or an ACP agent's own.
    pub fn agent_label(&self) -> String {
        use crate::conversation::Provider;
        match (self.provider, &self.agent) {
            (Provider::Codex, _) => "Codex".into(),
            (Provider::Claude, _) => "Claude".into(),
            (Provider::Gemini, _) => "Gemini".into(),
            (Provider::Acp, Some(agent)) => agent.clone(),
            (Provider::Acp, None) => "Agent".into(),
        }
    }
}

/// How the service's refusal starts while a session's request to start helpers waits on the
/// person. The tool server looks for it to wait for the answer instead of failing the call.
pub const HELPERS_AWAIT_OK: &str = "Starting helpers needs the user's OK";

/// Which app a client is. A terminal session belongs to the app that started it, and only
/// that app may list, type into or resize it (ADR 0004). Clients that don't say are terminal
/// clients, which is what the terminal app has always been.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Surface {
    #[default]
    Terminal,
    Desktop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::large_enum_variant)]
pub enum ClientMsg {
    /// First frame of every connection. `attach` clients get live output and, with `replays`,
    /// every pane's replay up front; one that asks for panes as it shows them (the desktop
    /// window) sends `WantReplay` instead. `from`: the pane this request comes from (its id and
    /// secret), for a command run inside a pane (an agent); the server checks what that pane may do.
    Hello {
        version: u32,
        attach: bool,
        #[serde(default)]
        from: Option<(TermId, String)>,
        #[serde(default)]
        structured: Option<StructuredIdentity>,
        #[serde(default)]
        surface: Surface,
        #[serde(default = "replays_by_default")]
        replays: bool,
    },
    Command(Command),
    Input {
        term: TermId,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// An attached client wants one pane's replay now, on this connection, in order with its
    /// output.
    WantReplay {
        term: TermId,
    },
    Resize {
        term: TermId,
        cols: u16,
        rows: u16,
    },
    /// Lifecycle event reported by an agent's hook (`<app> hook ...`).
    Hook {
        term: TermId,
        agent: String,
        status: HookStatus,
        session: Option<String>,
        cwd: Option<PathBuf>,
        /// The prompt the user just gave the agent, for its card.
        prompt: Option<String>,
        /// The agent's last message (its summary of what it did).
        said: Option<String>,
        /// A subagent starting or stopping.
        subagent: Option<Subagent>,
        /// The hook event ("Stop", "Notification:permission_prompt", …).
        event: String,
        /// The reporting process; only reports from inside the pane's own process tree count.
        pid: u32,
        /// The pane's secret (<APP>_PANE_TOKEN), for when the process chain can't be traced
        /// (Git Bash on Windows hands each command to a fresh process).
        #[serde(default)]
        token: String,
        /// The agent's conversation file (Claude's transcript), for moving it elsewhere.
        transcript: Option<PathBuf>,
        /// The model it's answering with right now (from the transcript).
        model: Option<String>,
        /// The name you gave the conversation in the agent (Claude's /rename).
        name: Option<String>,
        /// Ids of the background tasks (shells, helpers) still running when a turn stopped, or a
        /// helper's turn did (`SubagentStop`). On a helper's tool report, the one background task
        /// that call started, so the daemon knows the helper waits on it.
        #[serde(default)]
        background: Vec<String>,
        /// Those of `background` that are helper agents. A helper always ends and wakes the
        /// agent, where a shell may be a server that never does, so only helpers hold a
        /// later stop as a pause.
        #[serde(default)]
        background_agents: Vec<String>,
        /// The agent listed its background tasks with this report, so `background` and
        /// `background_agents` are everything still running, not merely nothing said.
        #[serde(default)]
        background_reported: bool,
        /// The question a permission prompt asks, from the hook's own payload (a
        /// `PermissionRequest`). The daemon cleans it and decides `answerable` itself.
        #[serde(default)]
        ask: Option<PermissionAsk>,
        /// A fingerprint of the tool call that is starting (16 hex characters, from the tool's
        /// name and input), so the daemon can tell the same call repeating. Never the call itself.
        #[serde(default)]
        call: Option<String>,
    },
    /// What an agent in a pane has used (from Claude's status line), with the pane's secret.
    Usage {
        term: TermId,
        token: String,
        usage: Usage,
        limits: Vec<Limit>,
    },
    Query(Query),
}

/// The question an agent's permission prompt asks, as the agent's own hook reported it (never read
/// off the screen, ADR 0003). Only the tool and a one-line subject (the command, the file or the
/// address) are carried: not the content a tool would write, which can hold secrets.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionAsk {
    /// The tool that wants to run: "Bash", "Write", "WebFetch".
    pub tool: String,
    /// What it would run or touch, on one line, with secret-shaped text masked.
    pub detail: String,
    /// The daemon knows the key that answers this agent's prompt, so the chat view offers Approve and Deny.
    /// Set by the daemon; a hook cannot claim it.
    #[serde(default)]
    pub answerable: bool,
    /// The choices of a one-question multiple-choice prompt, in the order the agent numbers them, so
    /// the chat view can offer one button each. Empty for any other prompt.
    #[serde(default)]
    pub choices: Vec<String>,
    /// A prompt that asks several questions at once, each with one answer, in the order the agent
    /// shows them. The chat view offers each question's choices and answers them in that order.
    /// Empty for any other prompt.
    #[serde(default)]
    pub questions: Vec<AskQuestion>,
    /// A prompt with at least one question that takes several answers: every question it asks, in
    /// order, each saying whether it does (`AskQuestion::multi`). `questions` and `choices` stay
    /// empty for it, so a peer from before this field, which would answer each question with one
    /// key, leaves the prompt to the terminal instead. Empty for any other prompt.
    #[serde(default)]
    pub form: Vec<AskQuestion>,
}

/// One question of a prompt that asks several, and its choices as the agent numbers them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AskQuestion {
    pub question: String,
    pub choices: Vec<String>,
    /// The question takes any number of its choices (Claude's `multiSelect`); only ever set in
    /// `PermissionAsk::form`.
    #[serde(default)]
    pub multi: bool,
}

/// What an agent's session has used.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    /// How full its context is, 0–100.
    pub context: Option<f32>,
    /// What the session has cost so far at list price, in US dollars (Claude's estimate).
    pub cost: Option<f64>,
    /// Tokens the provider says the session has used (what it reports, never an estimate).
    #[serde(default)]
    pub tokens: Option<u64>,
    /// The input and output halves of `tokens`, as the provider reports them.
    #[serde(default)]
    pub tokens_in: Option<u64>,
    #[serde(default)]
    pub tokens_out: Option<u64>,
}

/// One of an agent's plan limits: how much is used and when it starts over.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Limit {
    /// Which window: "5h", "week".
    pub name: String,
    /// 0–100.
    pub used: f32,
    /// Unix seconds.
    pub resets_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Command {
    ConversationStart {
        target: crate::conversation::StartTarget,
        /// Start in a new checkout of the project at the target's folder, on this branch (a chat
        /// session on a branch, ADR 0003). Only a new conversation takes one. A peer that
        /// predates it would start in the main checkout instead, which is why the protocol
        /// version was raised with it.
        #[serde(default)]
        branch: Option<String>,
    },
    ConversationSend {
        id: crate::conversation::ConversationId,
        generation: u64,
        operation: u64,
        text: String,
        /// The model and reasoning effort for this message and the ones after it, when the user
        /// picked them. Absent from a peer that predates it, which keeps the chat's own.
        #[serde(default)]
        choice: Option<crate::conversation::TurnChoice>,
    },
    /// Take a message back out of the daemon's queue before it is delivered.
    ConversationDequeue {
        id: crate::conversation::ConversationId,
        generation: u64,
        operation: u64,
    },
    /// Send a queued message now instead of when the turn ends: steered into the running turn when
    /// the provider can, otherwise by stopping the turn and sending it next.
    ConversationSendNow {
        id: crate::conversation::ConversationId,
        generation: u64,
        operation: u64,
    },
    ConversationApprove {
        id: crate::conversation::ConversationId,
        generation: u64,
        request_id: crate::conversation::ProviderRequestId,
        decision: crate::conversation::ApprovalDecision,
    },
    ConversationAnswerInput {
        id: crate::conversation::ConversationId,
        generation: u64,
        request_id: crate::conversation::ProviderRequestId,
        answers: std::collections::BTreeMap<String, Vec<String>>,
    },
    ConversationCancel {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    /// Stop a chat conversation's agent. Its record stays, stopped, so history is kept.
    /// Close a chat with an undo window: it is hidden at once and ended for real when the window passes.
    ConversationClose {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    /// Bring back a chat closed with `ConversationClose` while its window is open.
    ConversationUndoClose {
        id: crate::conversation::ConversationId,
    },
    /// Approve a command request and remember the approval for the conversation's project: the same
    /// command, written the same, is then approved without asking (ADR 0005). Only a command request
    /// can be remembered.
    ConversationAllowAlways {
        id: crate::conversation::ConversationId,
        generation: u64,
        request_id: crate::conversation::ProviderRequestId,
    },
    /// Take back a command approved "always in this project".
    ForgetAllowedCommand {
        project: PathBuf,
        command_sha256: String,
    },
    ConversationEnd {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    /// Name a conversation for every client (empty: automatic).
    ConversationRename {
        id: crate::conversation::ConversationId,
        title: String,
    },
    /// Type into a terminal pane (human clients only).
    TerminalInput {
        term: TermId,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// Resize a terminal pane (human clients only).
    TerminalResize {
        term: TermId,
        cols: u16,
        rows: u16,
    },
    /// Put a conversation away or bring it back; it keeps running.
    ConversationArchive {
        id: crate::conversation::ConversationId,
        archived: bool,
    },
    ConversationTerminalInput {
        id: crate::conversation::ConversationId,
        generation: u64,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    ConversationTerminalResize {
        id: crate::conversation::ConversationId,
        generation: u64,
        cols: u16,
        rows: u16,
    },
    NewWorkspace {
        cwd: Option<PathBuf>,
        name: Option<String>,
        cmd: Option<String>,
    },
    CloseWorkspace {
        ws: WsId,
    },
    RenameWorkspace {
        ws: WsId,
        name: String,
    },
    SelectWorkspace {
        ws: WsId,
    },
    NewTab {
        ws: WsId,
        name: Option<String>,
        cmd: Option<String>,
    },
    CloseTab {
        ws: WsId,
        tab: TabId,
    },
    RenameTab {
        ws: WsId,
        tab: TabId,
        name: String,
    },
    SelectTab {
        ws: WsId,
        tab: TabId,
    },
    /// `term` is one of `owner`'s tabs (a session's second tab, a split in it); None: its own.
    /// Kept across restarts, so a session's tabs come back as its tabs.
    SetTabOf {
        term: TermId,
        owner: Option<TermId>,
    },
    /// `cwd`: where the new pane starts (default: where the split pane is).
    Split {
        term: TermId,
        dir: Dir,
        cmd: Option<String>,
        cwd: Option<PathBuf>,
    },
    ClosePane {
        term: TermId,
    },
    /// End a session with an undo window: it leaves the snapshot at once but its process runs
    /// on until `UNDO_WINDOW` passes, then it is closed as `ClosePane` closes it.
    CloseSession {
        term: TermId,
    },
    /// Bring back a session `CloseSession` hid, still inside the window. After the window, or
    /// for a session that isn't closing, it does nothing.
    UndoClose {
        term: TermId,
    },
    /// Focus a pane anywhere: switches workspace and tab as needed.
    FocusPane {
        term: TermId,
    },
    /// Focus a pane and bring the windows showing the app to the front (a notification for it
    /// was clicked).
    Reveal {
        term: TermId,
    },
    /// You've seen a finished agent (the cursor rested on it): done → idle.
    MarkSeen {
        term: TermId,
    },
    /// Name a pane yourself (empty: back to the automatic name).
    RenamePane {
        term: TermId,
        name: String,
    },
    /// Keep a pane at the top of its project (and its lead), or let it go back to its place.
    PinPane {
        term: TermId,
        pinned: bool,
    },
    /// Put a pane away from the project lists and tabs without stopping it, or bring it back.
    ArchivePane {
        term: TermId,
        archived: bool,
    },
    /// Snooze a pane until `until` (unix seconds, at most a week ahead), or wake it (`None`).
    SnoozePane {
        term: TermId,
        until: Option<u64>,
    },
    /// The agent in `term` moves into a new worktree of its repo: made now, and when its turn
    /// ends it restarts there, resumed (the agent runs `<app> worktree --move`).
    MoveToWorktree {
        term: TermId,
        branch: Option<String>,
    },
    /// Restart the agent in `term` where it is, resuming its conversation, so it loads hooks
    /// installed since it started. Stops what it is doing: a turn in flight is not replayed.
    ReloadAgent {
        term: TermId,
    },
    /// Grow (positive) or shrink the pane along `dir`'s axis by `delta` (fraction of parent).
    ResizePane {
        term: TermId,
        dir: Dir,
        delta: f32,
    },
    /// Trade the places of two panes of one tab; each takes the other's size. An error when
    /// they are in different tabs.
    /// Put the checkout `term` is in back as it was in a snapshot the daemon took (one that
    /// `RepoRequest::Snapshots` listed), after saving what is there now. Only you can, and not
    /// while the pane's agent works. The answer is `Reply::Repo { tag, Restored }`.
    RestoreSnapshot {
        term: TermId,
        tag: u64,
        commit: String,
    },
    SwapPanes {
        a: TermId,
        b: TermId,
    },
    /// Replace the text of one existing file of the checkout `term` is in (a path relative to its top, no
    /// links, not under `.git`, text of at most the preview limit). Only you can, and only a file that is
    /// already there: it makes none. The answer is `Reply::Repo { tag, Written }`.
    WriteFile {
        term: TermId,
        tag: u64,
        path: String,
        contents: String,
    },
    /// `WriteFile` for an editor: the file must still be the `version` that `RepoRequest::FileStamped` gave
    /// (`None`: write whatever is there, only after the person chose to overwrite). The answer is
    /// `Reply::Repo { tag, Saved }`, or `ChangedOnDisk` with nothing written.
    SaveFile {
        term: TermId,
        tag: u64,
        path: String,
        contents: String,
        version: Option<String>,
    },
    /// `git worktree add` next to the workspace's repo, then open it as a new workspace.
    /// `split`: open the worktree as a pane beside this one instead of as a workspace.
    /// `from`: the repo to branch from (default: the workspace's folder). With `from` a folder
    /// that exists, `ws` is not read, so a service with no workspace open can still be asked.
    /// `agent` / `prompt`: start a known agent preset in it with a first prompt, in place of
    /// `cmd` (naming both is an error). The daemon checks both and quotes the prompt itself.
    NewWorktree {
        ws: WsId,
        branch: String,
        base: Option<String>,
        cmd: Option<String>,
        split: Option<TermId>,
        from: Option<PathBuf>,
        #[serde(default)]
        agent: Option<String>,
        #[serde(default)]
        prompt: Option<String>,
    },
    /// A worktree of `project` on `branch` (an existing local or remote branch, else a new one
    /// from HEAD; a branch already checked out somewhere, which git cannot check out twice, gets a
    /// new branch with a made-up name cut from it), made the way every other worktree is: named by the `worktree.dir` template,
    /// trusted like its repo, the repo's setup hook run, and listed with the checkouts the app
    /// made so the usual tidy-up offers it. Replies with the new folder as text. For a window
    /// that has no pane to ask from (the new chat page). `project` must be one the daemon has
    /// been shown, so this cannot make worktrees, or run hooks, anywhere on disk.
    BranchWorktree {
        project: PathBuf,
        branch: String,
    },
    /// From a pane about to start an agent in `dir`: a new worktree for it when `dir` is
    /// in a repo's main checkout (and per-agent worktrees are on). Replies with the folder
    /// to start in, or empty text to start where it is.
    AgentWorktree {
        dir: PathBuf,
    },
    /// Put a pane in a sidebar group (None: take it out).
    SetGroup {
        ws: WsId,
        group: Option<String>,
    },
    /// Move a pane into another group (`to`), or into a new group named `name`.
    MovePane {
        term: TermId,
        to: Option<WsId>,
        name: Option<String>,
    },
    /// Put back the pane the last automatic workspace took.
    UndoAutoWorkspace,
    /// Close everything running in a linked worktree, remove it and delete its branch (a
    /// branch just merged).
    CloseWorktree {
        path: PathBuf,
    },
    /// Remove these worktrees, none of which has anything running in it: each a folder and
    /// whether to go ahead with uncommitted changes in it (they are lost). A branch is kept
    /// unless it's already merged.
    TidyWorktrees {
        items: Vec<(PathBuf, bool)>,
    },
    /// Close a worktree workspace and `git worktree remove` its checkout.
    /// `delete_branch`: also delete the worktree's branch (discarding a task).
    RemoveWorktree {
        ws: WsId,
        force: bool,
        delete_branch: bool,
    },
    /// Make a pane its own workspace, homed at the pane's current directory. A workspace's
    /// only pane re-homes the workspace instead.
    PaneToWorkspace {
        term: TermId,
    },
    /// Start a named fleet (a workspace) on this machine, holding one new shell in `cwd` (the
    /// home folder when absent or not a folder). Its colour is the first of `colors` (indexes
    /// into the workspace palette) that no workspace uses, else the first free colour of any
    /// index; `colors` empty means any.
    NewFleet {
        name: String,
        cwd: Option<PathBuf>,
        colors: Vec<u8>,
    },
    /// Start a new session in an existing fleet: a shell, or `cmd`, in `cwd` (the fleet's
    /// folder when absent or not a folder). It joins the fleet as a new tab.
    NewShip {
        ws: WsId,
        cwd: Option<PathBuf>,
        cmd: Option<String>,
    },
    /// Index into the configured workspace colour palette; an index past the palette is refused.
    SetWorkspaceColor {
        ws: WsId,
        color: u8,
    },
    ReloadConfig,
    /// Change one shared setting in config.toml (human clients only). The daemon checks the
    /// value, edits the file in place, reloads, and tells every client `SettingsChanged`.
    SetSetting {
        key: crate::settings_view::SettingKey,
        value: crate::settings_view::SettingValue,
    },
    /// The program running in `term` is an agent: add it to config (by its program, or by
    /// its script when node/python runs it) so its status shows.
    TeachAgent {
        term: TermId,
    },
    /// Run a command in a floating pane over everything; it closes when the command exits.
    Popup {
        cmd: String,
        cwd: Option<PathBuf>,
    },
    /// An agent asks you a question with these answers; the reply (the chosen answer) comes
    /// once you pick one.
    AskHuman {
        term: TermId,
        text: String,
        options: Vec<String>,
    },
    /// Your answer (index into its options) to question `id`.
    AnswerHuman {
        id: u64,
        choice: usize,
    },
    /// What a pane may do through the app (read, write, start, respond, admin); None goes back
    /// to the default from config. Only you can (not from inside a pane).
    Grant {
        term: TermId,
        grants: Option<Vec<String>>,
    },
    /// A follow-up for an agent that's working: typed into it when its turn is over.
    QueueFollowUp {
        term: TermId,
        text: String,
        /// Ahead of the ones already waiting: an agent's own command (`/model …`) picked while
        /// it works runs before the messages queued behind it.
        #[serde(default)]
        first: bool,
        /// Names this send, so a retry of it is acknowledged instead of queued twice; the same
        /// rule as `SendWhenReady::operation`.
        #[serde(default)]
        operation: Option<u64>,
    },
    /// Drop the follow-ups queued for a pane.
    ClearQueue {
        term: TermId,
    },
    /// Drop one queued follow-up: the one at `index`, and only while it still reads `text`. The
    /// queue moves when a turn ends, so a position alone could name a different message.
    DropQueued {
        term: TermId,
        index: u32,
        text: String,
    },
    /// A message for the agent that is starting in a pane: the daemon holds it and types it in
    /// once that agent takes input, so it is delivered even when the app that sent it has closed.
    SendWhenReady {
        term: TermId,
        text: String,
        /// Names this send: a random nonzero 64-bit nonce per send, never a counter, since two
        /// senders counting from the same start would collide on a pane. The same pane, operation
        /// and text again within ten minutes (as either command) is acknowledged and not typed,
        /// held or queued again; the same operation with other text, or zero, is refused. None is
        /// a send with no retry protection, as before.
        #[serde(default)]
        operation: Option<u64>,
    },
    /// Run the pane's checkpoint `name` again (None: all of them). While its agent is working
    /// the run waits for the turn to end.
    RerunCheck {
        term: TermId,
        name: Option<String>,
    },
    /// Accept a failed checkpoint as it is (None: the headline one); `reason` may be empty.
    /// Covers that one result only.
    OverrideCheck {
        term: TermId,
        name: Option<String>,
        reason: String,
    },
    /// Take an override back (None: the headline checkpoint): it reads as failed again.
    UndoOverride {
        term: TermId,
        name: Option<String>,
    },
    /// Your answer to a repo-supplied check command waiting for approval. Only you can (not
    /// from inside a pane). `command_sha256` (`command_hash`) is of the command you were
    /// shown: the answer is refused if a different one waits by then.
    ApproveCheck {
        term: TermId,
        name: String,
        choice: ApprovalChoice,
        command_sha256: String,
    },
    /// Drop a remembered Always or Never for a repo's checkpoint. Only you can.
    ForgetCheckApproval {
        project: PathBuf,
        name: String,
    },
    /// Your answer to a session that asked to start helpers (`TermInfo::helper_ask`). Only you
    /// can (not from inside a pane), and only while the request is pending.
    AnswerHelpers {
        term: TermId,
        choice: HelperChoice,
    },
    /// Your answer to a chat that asked to start helpers (`ConversationSummary::helper_ask`, ADR
    /// 0016). Only you can (not a pane, not a chat's own runtime), and only while it asks.
    AnswerChatHelpers {
        conversation: crate::conversation::ConversationId,
        choice: HelperChoice,
    },
    RequestSecret {
        term: TermId,
        label: String,
        reason: String,
    },
    AnswerSecret {
        id: u64,
        value: Option<SecretText>,
    },
    LinkPr {
        term: TermId,
        url: Option<String>,
    },
    SpendSecret {
        reference: String,
    },
    /// `forget`: also discard the saved session, so the next start is a clean slate.
    KillServer {
        forget: bool,
    },
    /// Start `cmd` in `cwd` ahead of its first message, hidden. The next `NewWorkspace` with the
    /// same command in the same folder is that agent, already running. One is kept at a time, and
    /// for ten minutes after it was last asked for: asking again for the same one keeps it.
    Prewarm {
        cwd: PathBuf,
        cmd: String,
    },
    /// Stop the agent `Prewarm` started, if no session took it.
    DropPrewarm,
    /// Start again the closed session the daemon keeps for `agent` and its conversation `session`
    /// (human clients only), resuming that conversation in a new session. A worktree folder that is
    /// gone is made again first, at the recorded path, from the recorded branch, in the recorded
    /// repository; nothing a client sends names a path or a branch.
    ReopenClosedSession {
        agent: String,
        session: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Query {
    /// The shared settings; answered with `Reply::Settings`.
    Settings,
    /// The commands approved "always in this project"; answered with `Reply::AllowedCommands`.
    AllowedCommands,
    ConversationRead {
        id: crate::conversation::ConversationId,
        cursor: Option<crate::conversation::history::Cursor>,
        limit: usize,
    },
    ConversationDiff {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    ConversationFiles {
        id: crate::conversation::ConversationId,
        generation: u64,
        path: Option<String>,
    },
    ConversationFileRead {
        id: crate::conversation::ConversationId,
        generation: u64,
        path: String,
    },
    ConversationTerminalScreen {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    ConversationTerminalReplay {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    /// A terminal pane's visible screen as ANSI text (human clients only).
    TerminalScreen {
        term: TermId,
    },
    /// A terminal pane's recent raw output, for scrollback (human clients only).
    TerminalReplay {
        term: TermId,
    },
    /// A read-only question about the repository `term` is in (human clients only). The
    /// answer echoes `tag`, so several can be in flight at once.
    Repo {
        term: TermId,
        tag: u64,
        request: crate::repo::RepoRequest,
    },
    /// Where `query` appears in what the panes this app owns have printed recently (human
    /// clients only; at most 100 hits, and 20 from any one pane).
    PaneSearch {
        query: String,
    },
    /// Provider-reported usage over a period, per session and per day (human clients only).
    UsageReport {
        period: crate::usage_report::UsagePeriod,
    },
    /// The folders inside `path` on this daemon's computer, for a client choosing where to start a
    /// session (human clients only). `path` is absolute or starts with `~`. The answer echoes
    /// `tag`, so a client typing a path can tell which of its questions this answers.
    ListFolders {
        path: String,
        tag: u64,
    },
    /// Make one new folder called `name` directly inside `parent` on this daemon's computer (human
    /// clients only). `parent` is absolute or starts with `~` and must already be a folder; `name`
    /// is one name, never a path. The daemon checks both again and creates nothing recursively. The
    /// answer is `Reply::FolderCreated` with the same `tag`.
    CreateFolder {
        parent: String,
        name: String,
        tag: u64,
    },
    /// Clone the git repository at `address` into a new folder, named after it, inside `parent`
    /// on this daemon's computer (human clients only). `address` is an `https://`, `ssh://` or
    /// `git://` address or the `user@host:path` form; `parent` is absolute or starts with `~`.
    /// The answer is `Reply::Cloned` with the same `tag`.
    CloneRepo {
        address: String,
        parent: String,
        tag: u64,
    },
    /// Read or change the branches of `folder` on this daemon's computer (human clients only).
    /// `folder` is absolute or starts with `~`. Unlike `Query::Git` it needs no pane. The answer is
    /// `Reply::FolderGit` with the same `tag`.
    FolderGit {
        folder: String,
        request: FolderGitRequest,
        tag: u64,
    },
    /// What this daemon's computer is: system, cores, host name and the agents installed (human
    /// clients only). The answer is `Reply::MachineFacts` with the same `tag`.
    MachineFacts {
        tag: u64,
    },
    /// Start, stop or read an agent's sign-in on this daemon's computer (human clients only).
    /// The answer is `Reply::AgentSignIn` with the same `tag`.
    AgentSignIn {
        agent: SignInAgent,
        request: SignInRequest,
        tag: u64,
    },
    /// Who is signed in to GitHub on this daemon's computer, as its GitHub command line (`gh`)
    /// says (human clients only). The answer is `Reply::GitHubAccounts` with the same `tag`.
    GitHubAccounts {
        tag: u64,
    },
    /// The repositories the account signed in on this daemon's computer can clone (human clients
    /// only): `owner`'s, or its own when none is named, narrowed to those matching `search` when
    /// there is one. The answer is `Reply::GitHubRepos` with the same `tag`.
    GitHubRepos {
        owner: Option<String>,
        search: Option<String>,
        tag: u64,
    },
    /// Whose repositories `GitHubRepos` can list: the signed-in account, then its organisations
    /// (human clients only). The answer is `Reply::GitHubOwners` with the same `tag`.
    GitHubOwners {
        tag: u64,
    },
    /// The slash commands and skills `agent` takes in `folder` on this daemon's computer (human
    /// clients only), asked of the agent's own program: its own, and the person's and the
    /// project's. The folder is used only when it is an absolute path to a folder that exists; the
    /// home folder otherwise. Only Claude and Codex have a list to ask for; Gemini answers an empty
    /// one. The answer is `Reply::AgentCommands` with the same `tag`.
    AgentCommands {
        agent: crate::conversation::Provider,
        folder: String,
        tag: u64,
    },
    /// The git repositories this daemon found on its computer, most recently used first (human
    /// clients only). With `rescan` the daemon searches again first; without it a search that has
    /// not finished once is waited for and an earlier one's list is answered at once. The answer
    /// is `Reply::Repositories` with the same `tag`.
    Repositories {
        rescan: bool,
        tag: u64,
    },
    /// Read or change the skills, plugins, MCP servers and marketplaces of Claude Code and Codex on
    /// this daemon's computer (human clients only). A list reads files and starts nothing. An add
    /// runs only with the one-time token a `PreviewAdd` gave, so what it will run was shown first.
    /// The answer is `Reply::Extensions` with the same `tag`.
    Extensions {
        request: crate::extensions::ExtRequest,
        tag: u64,
    },
    /// Which commit name and email git uses on this daemon's computer, and the folders where a
    /// rule gives another (human clients only). Nothing is written. The answer is
    /// `Reply::GitIdentities` with the same `tag`.
    GitIdentities {
        tag: u64,
    },
    /// Preview, write or remove a folder's rule (human clients only). The answer is
    /// `Reply::GitIdentityRuleDone` with the same `tag`.
    GitIdentityRule {
        change: GitRuleChange,
        tag: u64,
    },
    /// Do `request` to the checkout pane `term` is in (human clients only). The answer is
    /// `Reply::GitDone` with the same `tag`.
    Git {
        term: u32,
        request: GitRequest,
        tag: u64,
    },
    /// Discard the uncommitted changes of the one file `path` in the checkout pane `term` is in
    /// (human clients only). `path` is relative to the top of the repository, with `/` between
    /// its parts. The daemon asks git what kind of change it is and undoes that
    /// (`crate::discard::discard_file`): a file that is new is removed for good. The answer is
    /// `Reply::GitDone` with the same `tag`. Read since `DISCARD_FILE_SINCE`.
    DiscardFile {
        term: u32,
        path: String,
        tag: u64,
    },
    /// The conversations `agent` (`claude`, `codex`) saved for `folder` on this daemon's computer,
    /// newest first (human clients only). `folder` is absolute or starts with `~`. The answer
    /// echoes `tag`.
    SavedConversations {
        agent: String,
        folder: String,
        tag: u64,
    },
    /// Asks Claude Code about conversation `id` without adding to it (human clients only): the
    /// daemon starts a copy of the agent's session that is never saved and answers `ask` from it.
    /// The answer echoes `tag`.
    SideAnswer {
        id: crate::conversation::ConversationId,
        ask: SideAsk,
        tag: u64,
    },
    List,
    /// What one of a pane's helpers did, from its own record (human clients only; ADR 0010). The
    /// helper must be one the pane's verified reports named.
    HelperRead {
        term: TermId,
        helper: String,
    },
    /// The Claude Code and Codex agent files of a pane's project and of its user's home, read-only
    /// (human clients only; ADR 0010).
    Specialists {
        term: TermId,
    },
    /// Plain-text screen contents of a terminal (the visible screen).
    Read {
        term: TermId,
    },
    /// Every worktree of the repository a workspace is in.
    Worktrees {
        ws: WsId,
    },
    /// Where the linked worktree at `folder` stands on the daemon's computer (human clients
    /// only); answered with `Reply::WorktreeStanding`. `repo` is a folder of its repository (the
    /// main checkout), which must list `folder` as a worktree. Both are absolute.
    WorktreeStanding {
        repo: PathBuf,
        folder: PathBuf,
    },
    /// The tail of a pane's last output for checkpoint `name` (None: the headline one); the
    /// snapshot carries only a summary.
    CheckOutput {
        term: TermId,
        name: Option<String>,
    },
    /// The agent sessions that closed or crashed, newest first; answered with
    /// `Reply::ClosedSessions`.
    ClosedSessions,
}

/// What you chose when a session asked to start helpers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HelperChoice {
    /// This session may start helpers from now on.
    Allow,
    /// Every session in this session's project may; remembered across restarts.
    Always,
    /// Do it alone: this session's start requests are refused.
    No,
}

/// What you chose for a repo-supplied check command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApprovalChoice {
    Once,
    /// This exact command, until it changes.
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HookStatus {
    Working,
    Blocked,
    Done,
    Idle,
    /// The agent session ended; the pane is a plain shell again.
    Gone,
    /// Leave the status as it is (the event only carries other news, e.g. a subagent).
    Same,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Subagent {
    pub id: String,
    /// "Explore", "code-reviewer", …
    pub kind: String,
    pub start: bool,
    #[serde(default)]
    pub reported_at: u64,
    #[serde(default)]
    pub task: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub activity: Option<String>,
}

/// Lifecycle evidence for one provider-reported child agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubagentActivity {
    pub id: String,
    pub name: String,
    pub parent: Option<String>,
    pub state: SubagentState,
    pub task: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub started_at: Option<u64>,
    pub updated_at: u64,
    pub latest_activity: Option<String>,
    pub result: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubagentState {
    Starting,
    Working,
    WaitingForInput,
    AwaitingApproval,
    Completed,
    Failed,
    Cancelled,
    ConnectionLost,
}

impl SubagentState {
    pub fn active(self) -> bool {
        matches!(
            self,
            Self::Starting | Self::Working | Self::WaitingForInput | Self::AwaitingApproval
        )
    }
}

fn replays_by_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ServerMsg {
    /// `compatible_since`: the oldest version this daemon still talks to (`COMPATIBLE_SINCE`),
    /// so an older client can tell whether it is inside the window.
    Welcome {
        version: u32,
        #[serde(default)]
        compatible_since: u32,
    },
    State(Snapshot),
    /// Only some panes changed since the last `State` or `TermsChanged` on this connection:
    /// replace these and drop those. Everything else in the client's snapshot stands.
    TermsChanged {
        changed: Vec<TermInfo>,
        removed: Vec<TermId>,
        /// Why each of `removed` left. Empty from a daemon built before it.
        #[serde(default)]
        reasons: BTreeMap<TermId, RemovalReason>,
        /// See `Snapshot::revision`.
        #[serde(default)]
        revision: u64,
    },
    /// Sent per terminal on attach (or on `WantReplay`): the recent output ring, to rebuild
    /// scrollback.
    Replay {
        term: TermId,
        cols: u16,
        rows: u16,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    Output {
        term: TermId,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// An agent needs attention (blocked, or finished while unfocused).
    Attention {
        term: TermId,
        status: Status,
    },
    Reply(Reply),
    Error(String),
    /// Informational message for the status bar.
    Notice(String),
    /// You closed the last pane of a worktree that holds commits found nowhere else: ask
    /// whether its folder goes too (its branch stays either way).
    AskRemoveWorktree {
        path: PathBuf,
        name: String,
        why: String,
    },
    /// A program in a pane copied text (OSC 52): put it on the user's clipboard.
    Clipboard {
        term: TermId,
        text: String,
    },
    /// An agent started in a new repo, which became a workspace (undoable).
    AutoWorkspace(String),
    /// A shared setting changed (by either app); the settings as they are now.
    SettingsChanged(crate::settings_view::SharedSettings),
    /// Come to the front: a notification for one of this server's sessions was clicked.
    Raise,
    /// What a `ConversationRead` of this conversation answers has changed: read it again. Sent
    /// to the desktop app's attached clients, so an open chat need not ask several times a second.
    ConversationChanged {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    Bye,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Reply {
    Settings(crate::settings_view::SharedSettings),
    ConversationStarted {
        id: crate::conversation::ConversationId,
        generation: u64,
    },
    ConversationSent(crate::conversation::Receipt),
    /// The conversation was busy, so the message waits in the daemon's queue (see `ReadResult::queued`).
    ConversationQueued(crate::conversation::QueuedReceipt),
    ConversationRead(crate::conversation::ReadResult),
    ConversationDiff(crate::conversation::ConversationDiff),
    ConversationFiles(Vec<crate::conversation::ConversationFileEntry>),
    ConversationFile(String),
    TerminalReplay(#[serde(with = "serde_bytes")] Vec<u8>),
    Ok,
    AllowedCommands(Vec<AllowedCommand>),
    List(Snapshot),
    Text(String),
    Worktrees(Vec<WorktreeEntry>),
    /// None: git still lists the worktree but its folder is gone.
    WorktreeStanding(Option<WorktreeStanding>),
    Repo {
        tag: u64,
        reply: crate::repo::RepoReply,
    },
    Search(Vec<SearchHit>),
    UsageReport(crate::usage_report::UsageReport),
    Folders {
        tag: u64,
        listing: FolderListing,
    },
    /// How a `Query::CreateFolder` ended.
    FolderCreated {
        tag: u64,
        outcome: FolderCreated,
    },
    /// How a `Query::CloneRepo` ended: the new folder's path with `/` separators, or one line
    /// saying why nothing was cloned.
    Cloned {
        tag: u64,
        outcome: Result<String, String>,
    },
    /// Where a `Query::CloneRepo` has got to, sent any number of times before its `Cloned`. Only a
    /// client that reads it is sent it. `percent` is of `phase`, 0 to 100.
    CloneProgress {
        tag: u64,
        phase: ClonePhase,
        percent: u8,
    },
    /// How a `Query::FolderGit` ended: what it found or did, or one line saying why it did not.
    FolderGit {
        tag: u64,
        outcome: Result<FolderGitAnswer, String>,
    },
    MachineFacts {
        tag: u64,
        facts: MachineFacts,
    },
    AgentSignIn {
        tag: u64,
        agent: SignInAgent,
        state: SignInState,
    },
    GitHubAccounts {
        tag: u64,
        report: GitHubReport,
    },
    GitHubRepos {
        tag: u64,
        answer: GitHubAnswer<GitHubRepoList>,
    },
    GitHubOwners {
        tag: u64,
        answer: GitHubAnswer<Vec<String>>,
    },
    /// The commands a `Query::AgentCommands` found, or why the agent could not be asked (it is not
    /// installed there, it did not answer in time).
    AgentCommands {
        tag: u64,
        answer: Result<Vec<crate::agent_commands::AgentCommand>, String>,
    },
    /// The repositories a `Query::Repositories` found.
    Repositories {
        tag: u64,
        found: crate::repositories::RepositoryIndex,
    },
    /// What a `Query::Extensions` found or did, or why it did nothing.
    Extensions {
        tag: u64,
        answer: Result<crate::extensions::ExtReply, crate::extensions::ExtError>,
    },
    /// How a `Query::Git` or a `Query::DiscardFile` ended: one line saying what happened
    /// ("Pulled", "Pushed main"), or one line saying why nothing did.
    GitDone {
        tag: u64,
        outcome: Result<String, String>,
    },
    GitIdentities {
        tag: u64,
        report: GitIdentityReport,
    },
    /// How a `Query::GitIdentityRule` ended: the lines it would write, wrote or took away, by
    /// file, or one line saying why nothing was done.
    GitIdentityRuleDone {
        tag: u64,
        outcome: Result<Vec<GitConfigWrite>, String>,
    },
    SavedConversations {
        tag: u64,
        found: SavedConversations,
    },
    ClosedSessions(Vec<ClosedSession>),
    HelperRead(HelperRecord),
    Specialists(crate::specialists::SpecialistList),
    SideAnswer {
        tag: u64,
        answer: SideAnswer,
    },
}

/// The most repositories one answer carries.
pub const GITHUB_REPOS_MAX: usize = 200;
/// The most owners one answer carries.
pub const GITHUB_OWNERS_MAX: usize = 100;
/// The most characters of a repository's description that are passed on.
pub const GITHUB_DESCRIPTION_MAX_CHARS: usize = 300;

/// What a question that needs a signed-in GitHub command line found. Having no `gh`, and nobody
/// signed in, are answers a client shows a way out of, not errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum GitHubAnswer<T> {
    NotInstalled,
    NotSignedIn,
    /// One line saying why there is no list.
    Failed(String),
    Listed(T),
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubRepoList {
    pub repos: Vec<GitHubRepo>,
    /// True when there are more than `GITHUB_REPOS_MAX`: a search narrows them.
    pub more: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubRepo {
    /// `owner/name`.
    pub name: String,
    /// One line, empty when it has none.
    pub description: String,
    pub private: bool,
    /// When it was last pushed to, as GitHub writes a time; empty when unknown.
    pub pushed_at: String,
    /// The https address it is cloned from.
    pub clone_url: String,
}

/// The most GitHub accounts one report carries.
pub const GITHUB_ACCOUNTS_MAX: usize = 20;

/// What `Query::GitHubAccounts` found. Never a token: only who is signed in.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubReport {
    /// False when the machine has no GitHub command line; the rest is then empty.
    pub installed: bool,
    /// The accounts signed in to github.com whose sign-in works, the active one first. Empty when
    /// nobody is signed in, which is not a problem.
    pub accounts: Vec<GitHubAccount>,
    /// One line saying why the accounts could not be read, when they could not.
    pub problem: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitHubAccount {
    pub login: String,
    /// The account `gh` and git use when nothing says otherwise.
    pub active: bool,
}

/// The most folders one listing carries; a folder with more says so in `truncated`.
pub const FOLDERS_MAX: usize = 1000;

/// What `Query::ListFolders` found: the folders directly inside a folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderListing {
    /// The folder, absolute with `/` separators.
    pub path: String,
    /// False when there is no such folder or it cannot be read; `entries` is then empty.
    pub exists: bool,
    pub entries: Vec<FolderEntry>,
    pub truncated: bool,
    /// This daemon answers `Query::CreateFolder`. A daemon from before it leaves this out, which
    /// reads as false, so a window can say the service is older instead of asking it in vain.
    #[serde(default)]
    pub can_create: bool,
}

/// How a `Query::CreateFolder` ended. Every case says why; nothing is swallowed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FolderCreated {
    /// The folder is there now: its absolute path with `/` separators.
    Created { path: String },
    /// Something with that name is already in the parent (a folder, a file or a link).
    Exists,
    /// The daemon will not make it: the name or the parent is not one it accepts. One line of why.
    NotAllowed { reason: String },
    /// The disk refused (no permission, full, read-only, gone). One line of why.
    Failed { reason: String },
}

impl FolderListing {
    /// A listing of a folder that is not there.
    pub fn missing(path: &str) -> FolderListing {
        FolderListing {
            path: path.to_string(),
            exists: false,
            entries: Vec::new(),
            truncated: false,
            can_create: false,
        }
    }
}

/// One folder inside a listed folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderEntry {
    pub name: String,
    /// The branch it is on when it is a git checkout (a short commit for a detached HEAD).
    pub git: Option<String>,
    /// Whether it holds a folder worth browsing into (hidden ones do not count).
    pub has_children: bool,
}

/// One line of a pane's output that matched a search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SearchHit {
    pub term: TermId,
    /// Counted from the start of what the daemon kept, from 1.
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorktreeEntry {
    pub path: PathBuf,
    /// Branch name, or a short commit for a detached HEAD.
    pub branch: String,
    /// The repository's main checkout.
    pub main: bool,
    pub repo: String,
}

/// Where a worktree stands: what removing it would lose. Read with git: off the UI thread and
/// off the daemon's loop.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeStanding {
    /// Changed and new files that aren't committed.
    pub dirty: usize,
    /// Its branch (none: a detached HEAD).
    pub branch: Option<String>,
    /// Every commit it has is also on another branch or on a remote, or its pull request was
    /// merged at exactly this commit (a squash merge leaves the commits on no other branch):
    /// its own branch could go and nothing would be lost.
    pub merged: bool,
    /// When it last committed, as git says it ("3 days ago").
    pub last_commit: String,
    /// Whole days since its last commit and its newest file change, set when both are at least
    /// `worktree.inactive_days` old. It is only listed: nothing is removed for it.
    pub inactive_days: Option<u32>,
}

impl WorktreeStanding {
    /// Nothing here exists only here: it can be removed without asking.
    pub fn safe(&self) -> bool {
        self.dirty == 0 && self.merged
    }

    /// Why it's still around, in a few words.
    pub fn says(&self) -> String {
        let idle = self
            .inactive_days
            .map(|n| format!("inactive {n} day{} · ", if n == 1 { "" } else { "s" }))
            .unwrap_or_default();
        let ago = if self.last_commit.is_empty() {
            String::new()
        } else {
            format!(" · last commit {}", self.last_commit)
        };
        let state = match (self.dirty, self.merged) {
            (0, true) => "merged, nothing uncommitted".to_string(),
            (0, false) => "not merged anywhere".to_string(),
            (n, _) => format!("{n} uncommitted change{}", if n == 1 { "" } else { "s" }),
        };
        format!("{idle}{state}{ago}")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Status {
    #[default]
    None,
    Idle,
    Working,
    Blocked,
    /// Finished a turn and nobody has looked yet.
    Done,
}

impl Status {
    pub fn label(self) -> &'static str {
        match self {
            Status::None => "",
            Status::Idle => "idle",
            Status::Working => "working",
            Status::Blocked => "blocked",
            Status::Done => "done",
        }
    }
    /// Sort order for "what needs me": blocked first, then done, working, idle.
    pub fn urgency(self) -> u8 {
        match self {
            Status::Blocked => 0,
            Status::Done => 1,
            Status::Working => 2,
            Status::Idle => 3,
            Status::None => 4,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(default)]
    pub conversations: Vec<ConversationSummary>,
    #[serde(default)]
    pub daemon_version: String,
    /// Which daemon this is, random and kept across its restarts. Lets a window tell that a
    /// different machine now answers at a saved name. `None` from a daemon built before it;
    /// not a credential.
    #[serde(default)]
    pub daemon_id: Option<String>,
    pub workspaces: Vec<WorkspaceInfo>,
    pub active_ws: Option<WsId>,
    pub terms: BTreeMap<TermId, TermInfo>,
    /// Questions agents asked you (`<app> ask-human`), waiting for an answer.
    #[serde(default)]
    pub questions: Vec<HumanQuestion>,
    #[serde(default)]
    pub secret_requests: Vec<SecretRequest>,
    /// Plan limits by agent ("claude", "codex"), as last reported.
    #[serde(default)]
    pub limits: Vec<(String, Vec<Limit>)>,
    /// What Claude sessions in the app have cost over the last day, at list price.
    #[serde(default)]
    pub spent_today: f64,
    /// What each agent got done over the last day, by agent and folder.
    #[serde(default)]
    pub today: Vec<AgentDay>,
    /// How many `State` and `TermsChanged` messages the daemon has sent this surface's attached
    /// clients, counting the one that carries it: each is one more than the last, so a client that
    /// sees a gap missed an update. A snapshot sent to one client (on attach, `Reply::List`)
    /// carries the surface's current count. 0 from a daemon built before it, or one that has
    /// sent the surface nothing yet.
    #[serde(default)]
    pub revision: u64,
    /// The panes that left this surface's list since the message before this one, and why. Set
    /// only on a `State` sent to the surface's attached clients: it says what that one message
    /// dropped, so it is empty on attach, in `Reply::List`, and from a daemon built before it.
    #[serde(default)]
    pub removed: BTreeMap<TermId, RemovalReason>,
}

/// Why a pane left the list a surface is shown. A reason added later reads as `Unknown` to a
/// build from before it, and the rest of the message still decodes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RemovalReason {
    /// A person closed it. It may still be inside its undo window, and then comes back as changed.
    Closed,
    /// Its program ended without anyone closing it.
    Exited,
    /// Hidden from every list, still running in the daemon.
    PutAway,
    /// It belongs to another surface now.
    Moved,
    /// It ended after the daemon was told to stop. Best-effort: a stopping daemon sends `Bye`
    /// and no further update, so only a pane that ended before `Bye` is ever named this way.
    DaemonStopping,
    /// The daemon recorded no reason, or gave one this build does not know.
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SecretRequest {
    pub id: u64,
    pub term: TermId,
    pub label: String,
    pub reason: String,
}

#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretText(pub String);

impl std::fmt::Debug for SecretText {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretText(<hidden>)")
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PrInfo {
    pub number: u32,
    pub url: String,
    pub title: String,
    pub state: PrState,
    pub draft: bool,
    pub checks: PrChecks,
    pub review: PrReview,
    pub conflicting: bool,
    /// Commits on the branch after the merged pull request's last one: work goes on after the
    /// merge, which a plain "merged" would hide. 0 when it is not merged or not known.
    #[serde(default)]
    pub commits_after_merge: u32,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrTone {
    Bad,
    Waiting,
    Good,
    Plain,
}
impl PrInfo {
    pub fn headline(&self) -> String {
        let fails = self.checks.failed.len();
        let what = match self.state {
            PrState::Merged => match self.commits_after_merge {
                0 => "merged".to_string(),
                1 => "merged · 1 new commit".to_string(),
                n => format!("merged · {n} new commits"),
            },
            PrState::Closed => "closed".to_string(),
            PrState::Open if fails > 0 => format!("{fails} failing"),
            PrState::Open if self.conflicting => "conflict".into(),
            PrState::Open if self.review == PrReview::ChangesRequested => {
                "changes requested".into()
            }
            PrState::Open if self.checks.pending > 0 => "checking".into(),
            PrState::Open if self.review == PrReview::Approved => "approved".into(),
            PrState::Open if self.checks.passed > 0 => "passing".into(),
            PrState::Open => String::new(),
        };
        let draft = if self.draft && self.state == PrState::Open {
            " draft"
        } else {
            ""
        };
        format!(
            "#{}{}{what}{draft}",
            self.number,
            if what.is_empty() { "" } else { " " }
        )
    }
    pub fn tone(&self) -> PrTone {
        match self.state {
            PrState::Merged if self.commits_after_merge > 0 => PrTone::Waiting,
            PrState::Merged => PrTone::Good,
            PrState::Closed => PrTone::Bad,
            PrState::Open
                if !self.checks.failed.is_empty()
                    || self.conflicting
                    || self.review == PrReview::ChangesRequested =>
            {
                PrTone::Bad
            }
            PrState::Open if self.checks.pending > 0 => PrTone::Waiting,
            PrState::Open if self.review == PrReview::Approved || self.checks.passed > 0 => {
                PrTone::Good
            }
            PrState::Open => PrTone::Plain,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PrState {
    #[default]
    Open,
    Merged,
    Closed,
}
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct PrChecks {
    pub passed: u32,
    pub pending: u32,
    pub failed: Vec<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum PrReview {
    #[default]
    None,
    Required,
    Approved,
    ChangesRequested,
}

/// An agent's last day in one folder: turns it finished, time it spent working, its cost.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AgentDay {
    pub agent: String,
    pub place: String,
    pub turns: u32,
    pub working_secs: u64,
    pub cost: f64,
}

/// A question an agent asked you, with the answers it allows.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HumanQuestion {
    pub id: u64,
    /// The pane that asked.
    pub term: TermId,
    pub text: String,
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    pub id: WsId,
    pub name: String,
    pub cwd: PathBuf,
    pub tabs: Vec<TabInfo>,
    pub active_tab: TabId,
    pub git: Option<GitInfo>,
    /// A worktree the app created; offered for removal when closed.
    pub worktree: bool,
    /// Palette index for this workspace's colour (tint, borders, sidebar marker).
    pub color: u8,
    /// Created automatically and not looked at yet (shows a NEW chip).
    pub is_new: bool,
    /// The sidebar group it's in, if the user put it in one.
    pub group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GitInfo {
    pub repo: String,
    pub branch: String,
    /// Changed + untracked files.
    pub dirty: u32,
    /// A linked worktree rather than the main checkout.
    pub linked: bool,
    /// The repository's main checkout; workspaces sharing it are one repo.
    pub root: PathBuf,
    /// Every worktree of the repository, open in the app or not.
    pub worktrees: Vec<WorktreeEntry>,
    /// For a linked worktree: commits on its branch that the main checkout's branch lacks.
    pub ahead: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabInfo {
    pub id: TabId,
    pub name: String,
    pub layout: Node,
    pub focus: TermId,
}

/// What is wrong with the hooks of an agent that never reports in: its settings file, in words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookProblem {
    /// The settings file whose hooks are wrong; its folder is the agent's config folder.
    pub file: PathBuf,
    pub why: String,
    /// The daemon pointed them at this build already: only a restart of the agent loads the fix.
    #[serde(default)]
    pub repaired: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermInfo {
    #[serde(default)]
    pub conversation_id: Option<crate::conversation::ConversationId>,
    pub id: TermId,
    pub cols: u16,
    pub rows: u16,
    /// Title set by the program (OSC 0/2), if any.
    pub title: String,
    /// Name of the most interesting process running in the pane (the leaf of the tree).
    pub process: String,
    /// The machine an ssh (or mosh, …) client in the pane is connected to.
    #[serde(default)]
    pub remote: Option<String>,
    /// A floating pane over everything (`<app> popup`); gone when its command exits.
    #[serde(default)]
    pub popup: bool,
    /// Detected or hook-reported agent name.
    pub agent: Option<String>,
    /// Whether the agent's own hooks have reported for this pane. An agent started before its
    /// hooks were installed never does, which is what `Command::ReloadAgent` is for.
    #[serde(default)]
    pub hooked: bool,
    /// Why an agent's hooks never report, when the daemon looked and knows. An older daemon sends
    /// none, which reads as nothing known.
    #[serde(default)]
    pub hook_problem: Option<HookProblem>,
    pub status: Status,
    pub cwd: PathBuf,
    /// What the agent is on: the last prompt it was given (one line), if known.
    pub summary: String,
    /// What to call it: the name you gave it in the agent (/rename), else its first prompt.
    pub name: String,
    /// The name you gave the pane in the app (Rename pane), which wins over everything.
    #[serde(default)]
    pub label: String,
    /// Pinned to the top of its project.
    #[serde(default)]
    pub pinned: bool,
    /// Put away from the project lists; the process keeps running.
    #[serde(default)]
    pub archived: bool,
    /// Snoozed until this time (unix seconds). The daemon clears it then, or as soon as the pane
    /// needs you; it never changes the status.
    #[serde(default)]
    pub snoozed_until: Option<u64>,
    /// The model it's using, short ("opus 4.5"), if known.
    pub model: String,
    /// Memory used by what runs in it (bytes).
    #[serde(default)]
    pub mem: u64,
    /// CPU used by what runs in it, as a share of the whole machine (0 to 100).
    #[serde(default)]
    pub cpu: f32,
    /// It rang the bell and you haven't looked yet.
    #[serde(default)]
    pub bell: bool,
    /// The agent's last message, if hooks reported it.
    pub said: String,
    /// The last lines of text on the pane when its turn ended, for an agent whose hooks
    /// reported no last message. Empty while `said` has one.
    #[serde(default)]
    pub last_lines: String,
    /// The git branch the pane is on, if it's in a repo.
    pub branch: Option<String>,
    /// The pane is in a linked worktree.
    pub linked: bool,
    /// Lines added and removed in its checkout against HEAD (untracked files not counted); zero
    /// outside git. Shared by every pane in the same checkout.
    #[serde(default)]
    pub diff_added: u32,
    #[serde(default)]
    pub diff_removed: u32,
    /// Files changed in that checkout against HEAD (the number on the pane's `changes` chip).
    #[serde(default)]
    pub diff_files: u32,
    /// Subagents running right now (their kinds).
    pub subagents: Vec<String>,
    /// Persistent lifecycle records reported by the runtime.
    #[serde(default)]
    pub subagent_activity: Vec<SubagentActivity>,
    /// Provider conversation ID that owns these child records.
    #[serde(default)]
    pub session: Option<String>,
    /// The effort level the agent runs at (`low`, `medium`, `high`, ...), as its own files say; none when they do not.
    #[serde(default)]
    pub effort: Option<String>,
    /// The pane whose agent started this one, if one did.
    #[serde(default)]
    pub started_by: Option<TermId>,
    /// The chat whose agent started this one, if one did (ADR 0016); never set with `started_by`.
    /// None from an older daemon.
    #[serde(default)]
    pub started_by_chat: Option<crate::conversation::ConversationId>,
    /// The session whose tab this pane is in, when not its own (`Command::SetTabOf`).
    #[serde(default)]
    pub tab_of: Option<TermId>,
    /// The helpers this session asked to start and is waiting on you for, one task each. Not
    /// empty means the row needs you ("wants to start N helpers"); `AnswerHelpers` answers it.
    #[serde(default)]
    pub helper_ask: Vec<String>,
    #[serde(default)]
    pub pr: Option<PrInfo>,
    /// Follow-ups waiting for its turn to end, next first.
    #[serde(default)]
    pub queued: Vec<String>,
    /// The agent's own turn is over: it is at its prompt and takes a message, though helpers it
    /// started may keep the pane working. Absent from an older daemon, which reads as not over.
    #[serde(default)]
    pub own_turn_over: bool,
    /// The repository's main checkout, if the pane is in a repo.
    pub root: Option<PathBuf>,
    /// The checkout (main or a linked worktree) the pane is in.
    pub top: Option<PathBuf>,
    /// When its status last changed (unix seconds).
    pub since: u64,
    /// What set its status ("hook: Stop", "screen: matched `esc to interrupt`", "you looked").
    #[serde(default)]
    pub status_why: String,
    /// The last hook event and the last screen evidence, with when (unix seconds; 0: none).
    #[serde(default)]
    pub why_hook: String,
    #[serde(default)]
    pub why_hook_at: u64,
    #[serde(default)]
    pub why_screen: String,
    #[serde(default)]
    pub why_screen_at: u64,
    /// Last completed process observation (unix seconds; 0: not observed).
    #[serde(default)]
    pub why_process_at: u64,
    /// Working, but no output and no hook report since then (unix seconds) for long enough
    /// that it may be stuck. Its status stays working.
    #[serde(default)]
    pub quiet_since: Option<u64>,
    /// Working, and the agent's last calls are one call over and over or two taking turns: how
    /// many calls the repeat has reached. Its status stays working; nothing rings.
    #[serde(default)]
    pub repeats: Option<u32>,
    /// The process running in it (0: not known).
    #[serde(default)]
    pub pid: u32,
    /// Left asleep by an older daemon; focusing it (or typing) resumes its conversation.
    pub asleep: bool,
    /// Windows' console layer asked for native key records (win32-input-mode), so keys
    /// plain VT can't express (Ctrl+Shift+letter, Ctrl+Enter) can be sent exactly.
    pub win32_input: bool,
    /// Context and cost, when the agent reports them.
    #[serde(default)]
    pub usage: Usage,
    /// It hit a plan limit; the app says "continue" at this time (unix seconds).
    #[serde(default)]
    pub resume_at: Option<u64>,
    /// The latest result of each checkpoint the app runs after its turn ends, in project order.
    /// The output stays on the daemon. An older peer's single `check` reads as one checkpoint.
    #[serde(default, alias = "check", deserialize_with = "one_or_many_checks")]
    pub checks: Vec<CheckInfo>,
    /// What a stopped agent is asking, off its screen: the exact command or file and its choices.
    /// Empty unless the pane needs you and shows numbered choices.
    #[serde(default)]
    pub asking: String,
    /// The agent that was mid-turn when the daemon restarted, left as a plain shell for you to
    /// resume. Never resumed on its own; gone once an agent runs in the pane again.
    #[serde(default)]
    pub interrupted: Option<Interrupted>,
    /// The latest turn events, oldest first: what the agent's own reports and the shell's prompt
    /// marks (OSC 133) said happened, not what the screen looked like.
    #[serde(default)]
    pub timeline: Vec<TurnEvent>,
    /// The permission prompt the pane is stopped on, from its agent's own hook; `None` unless the
    /// pane needs you and the agent said what it asks.
    #[serde(default)]
    pub ask: Option<PermissionAsk>,
    /// How the last command in the pane ended, when it ended in failure. See [`ExitInfo`].
    #[serde(default)]
    pub exit: Option<ExitInfo>,
    /// The pane was started as an agent, not as a terminal. Once its agent is gone, a pane with
    /// this set that is still listed is the shell an agent left behind; a pane without it is a
    /// terminal someone opened. Absent from an older daemon, which reads as a terminal.
    #[serde(default)]
    pub began_as_agent: bool,
}

/// A command in a pane that ended in failure, as the shell reported it (OSC 133 D), never read
/// off the screen. Set only for a non-zero exit, so `Some` means "show the red exited-with-error
/// mark" and `None` means nothing failed: a running pane, a clean exit (code 0, which reads as
/// Done, not as a problem) or a shell that reported no code. It is cleared as soon as the next
/// command starts or the agent works again, and it is not kept across a daemon restart (the
/// restored pane is a fresh shell). A signal kill reaches the shell as a code above 128
/// (130 for Ctrl+C, 137 for SIGKILL), so it counts as an error too. Clients display it; only
/// the daemon sets it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExitInfo {
    /// The exit code the shell reported; `None` if a failure carried no code.
    pub code: Option<i32>,
    /// When it ended (unix seconds).
    pub at: u64,
}

/// An agent that was working when the daemon restarted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Interrupted {
    pub agent: String,
    /// The command that brings its conversation back (`codex resume --last`).
    pub resume: String,
}

/// One thing that happened in a pane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnEvent {
    /// Unix seconds.
    pub at: u64,
    pub kind: TurnKind,
    /// What reported it ("hook: Stop", "exit 1"); may be empty.
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TurnKind {
    /// The agent started working.
    Working,
    /// The agent stopped for you.
    NeedsYou,
    /// The agent finished its turn.
    Done,
    /// The agent is idle again.
    Idle,
    /// The shell showed a prompt (OSC 133 A).
    Prompt,
    /// A command started running (OSC 133 C).
    CommandStarted,
    /// A command finished (OSC 133 D); `detail` is its exit code when it reported one.
    CommandFinished,
}

pub fn one_or_many_checks<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Vec<CheckInfo>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Shape {
        Many(Vec<CheckInfo>),
        One(Option<Box<CheckInfo>>),
    }
    Ok(match Shape::deserialize(d)? {
        Shape::Many(checks) => checks,
        Shape::One(check) => check.map(|c| *c).into_iter().collect(),
    })
}

/// The longest reason an override may carry, in characters.
pub const OVERRIDE_REASON_MAX_CHARS: usize = 280;

/// What an approval of a repo's check command is tied to: its SHA-256, in lowercase hex.
pub fn command_hash(command: &str) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(command.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Where a check stands. `CouldNotRun` is not a failure: the work was never checked.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckState {
    Checking,
    Passed,
    Failed,
    /// A failed result the user chose to accept; `CheckInfo` still says what failed.
    Overridden,
    #[default]
    CouldNotRun,
    /// Waiting its turn behind another checkpoint in the same run.
    Pending,
    /// A repo-supplied command that nobody has approved yet.
    NeedsApproval,
    /// It passed, but the agent changed files after it ran.
    Stale,
    /// You chose never to run this repo's command.
    Never,
}

impl CheckState {
    /// The name scripts read in `<app> ls --json`.
    pub fn label(self) -> &'static str {
        match self {
            CheckState::Checking => "checking",
            CheckState::Passed => "passed",
            CheckState::Failed => "failed",
            CheckState::Overridden => "overridden",
            CheckState::CouldNotRun => "could_not_run",
            CheckState::Pending => "pending",
            CheckState::NeedsApproval => "needs_approval",
            CheckState::Stale => "stale",
            CheckState::Never => "never",
        }
    }

    /// Rank for the checkpoint a session is reported by: the lowest is the headline.
    fn headline_rank(self) -> u8 {
        match self {
            CheckState::Failed => 0,
            CheckState::CouldNotRun => 1,
            CheckState::NeedsApproval => 2,
            CheckState::Checking => 3,
            CheckState::Pending => 4,
            CheckState::Stale => 5,
            CheckState::Never => 6,
            CheckState::Overridden => 7,
            CheckState::Passed => 8,
        }
    }
}

/// Who named a check command.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckSource {
    /// You, in the app's settings.
    #[default]
    User,
    /// The repository's own file (`.<app>/checks.toml`), as of `commit` when it is committed.
    Repo {
        file: String,
        commit: Option<String>,
        committed_at: Option<u64>,
        uncommitted: bool,
    },
}

/// A file the agent changed after a check ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChangedFile {
    /// `M`, `A`, `D` or `R`, as git reports it.
    pub kind: char,
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct CheckInfo {
    pub command: String,
    pub state: CheckState,
    /// Absent while checking, or when the command never started or timed out.
    pub exit_code: Option<i32>,
    /// When it started (unix seconds).
    pub started_at: u64,
    pub duration_ms: u64,
    /// When the agent turn that triggered it ended (unix seconds).
    pub after_turn_ended_at: u64,
    /// The first output line that looks like a failure; empty when there is none.
    pub first_failing_line: String,
    /// Another turn ended while it ran, so it runs again when this one settles.
    pub rerun_queued: bool,
    /// When the user overrode a failure (unix seconds); only set on `Overridden`.
    pub overridden_at: Option<u64>,
    pub override_reason: String,
    /// The checkpoint's name (`test`, `build`).
    pub name: String,
    /// The folder it ran in.
    pub cwd: PathBuf,
    /// Which of the session's turns it checked.
    pub turn: u32,
    /// Lines of the full output, before the tail was capped.
    pub line_count: u64,
    /// When files changed after it passed (unix seconds); set on `Stale`.
    pub stale_since: Option<u64>,
    pub changed_files: Vec<ChangedFile>,
    /// Who overrode it; set on `Overridden`.
    pub overridden_by: String,
    pub source: CheckSource,
    /// On `NeedsApproval`: the command you had said Always to, before the repo changed it.
    pub previous_command: Option<String>,
}

/// The one rule for whether a check is reported beside a status, for the daemon's callers and
/// the client's rows alike.
pub fn reported_check(status: Status, check: Option<&CheckInfo>) -> Option<&CheckInfo> {
    check.filter(|_| !matches!(status, Status::Working | Status::Blocked))
}

/// The checkpoint a session is reported by: the worst state wins, the first in order on ties.
pub fn headline(checks: &[CheckInfo]) -> Option<&CheckInfo> {
    checks.iter().min_by_key(|c| c.state.headline_rank())
}

impl TermInfo {
    /// The headline checkpoint (see `headline`), if any ran or waits.
    pub fn check(&self) -> Option<&CheckInfo> {
        headline(&self.checks)
    }

    /// The check to report beside the status. While the agent works or asks, the last result is
    /// about an older turn, so none is reported.
    pub fn reported_check(&self) -> Option<&CheckInfo> {
        reported_check(self.status, self.check())
    }

    /// What to call this pane: the agent's name, else the folder a shell is sitting in, else
    /// the running program's title or name (`vim`, `lazygit`, `node`).
    pub fn display_name(&self) -> String {
        if let Some(a) = &self.agent {
            return a.clone();
        }
        if self.is_shell() && !self.cwd.as_os_str().is_empty() {
            return match self.cwd.file_name() {
                Some(n) => n.to_string_lossy().into_owned(),
                // A drive root like C:\ has no folder name; show it whole.
                None => self.cwd.display().to_string(),
            };
        }
        // Programs often title the window with their own exe path; that says nothing.
        let path_like =
            self.title.contains('\\') || self.title.contains('/') || self.title.ends_with(".exe");
        if !self.title.is_empty() && !path_like {
            return self.title.clone();
        }
        self.process.clone()
    }

    /// The pane is at a shell prompt (nothing else running in it).
    pub fn is_shell(&self) -> bool {
        matches!(
            self.process.to_ascii_lowercase().as_str(),
            "pwsh"
                | "powershell"
                | "cmd"
                | "bash"
                | "zsh"
                | "fish"
                | "nu"
                | "sh"
                | "dash"
                | "elvish"
                | "xonsh"
        )
    }
}

impl Snapshot {
    pub fn workspace(&self, id: WsId) -> Option<&WorkspaceInfo> {
        self.workspaces.iter().find(|w| w.id == id)
    }
    pub fn active(&self) -> Option<&WorkspaceInfo> {
        self.active_ws.and_then(|id| self.workspace(id))
    }
    /// (workspace, tab) containing a terminal.
    pub fn locate(&self, term: TermId) -> Option<(&WorkspaceInfo, &TabInfo)> {
        self.workspaces.iter().find_map(|w| {
            w.tabs
                .iter()
                .find(|t| t.layout.contains(term))
                .map(|t| (w, t))
        })
    }
}

impl WorkspaceInfo {
    pub fn tab(&self) -> Option<&TabInfo> {
        self.tabs
            .iter()
            .find(|t| t.id == self.active_tab)
            .or(self.tabs.first())
    }
}

impl ServerMsg {
    /// The first version whose client reads this message. The daemon does not send a message to
    /// a client older than that. A message added while `COMPATIBLE_SINCE` stays behind gets its
    /// own arm here; everything else is as old as the window. 122 moved the window, so every
    /// message there is today is as old as it.
    pub fn introduced_in(&self) -> u32 {
        COMPATIBLE_SINCE
    }
}

impl ClientMsg {
    /// The first version whose daemon reads this message: what a client checks before it sends
    /// a request to an older daemon, which would otherwise never answer it. A message added
    /// while `COMPATIBLE_SINCE` stays behind gets its own arm here.
    pub fn introduced_in(&self) -> u32 {
        match self {
            ClientMsg::Query(Query::DiscardFile { .. }) => DISCARD_FILE_SINCE,
            _ => COMPATIBLE_SINCE,
        }
    }
}

/// The first version whose daemon reads `Query::DiscardFile`. A daemon before it passes the
/// request over and never answers, so a client refuses in words instead of asking it.
pub const DISCARD_FILE_SINCE: u32 = 123;

pub fn encode<T: Serialize>(msg: &T) -> anyhow::Result<bytes::Bytes> {
    Ok(rmp_serde::to_vec_named(msg)?.into())
}

pub fn decode<'a, T: Deserialize<'a>>(buf: &'a [u8]) -> anyhow::Result<T> {
    Ok(rmp_serde::from_slice(buf)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_peer_talks_inside_the_window_and_is_refused_outside_it() {
        const { assert!(COMPATIBLE_SINCE <= PROTOCOL_VERSION) };
        assert!(speaks_with(PROTOCOL_VERSION, COMPATIBLE_SINCE));
        // The same version talks even when it says nothing about a window.
        assert!(speaks_with(PROTOCOL_VERSION, 0));
        assert!(speaks_with(COMPATIBLE_SINCE, 0));
        assert!(!speaks_with(COMPATIBLE_SINCE - 1, 0));
        // A newer peer decides: it talks when it says it still speaks this version.
        assert!(speaks_with(PROTOCOL_VERSION + 1, PROTOCOL_VERSION));
        assert!(speaks_with(PROTOCOL_VERSION + 5, COMPATIBLE_SINCE));
        assert!(!speaks_with(PROTOCOL_VERSION + 1, PROTOCOL_VERSION + 1));
        assert!(!speaks_with(PROTOCOL_VERSION + 1, 0));
    }

    /// A build from before the window sends a Welcome with the version alone.
    #[test]
    fn a_welcome_without_a_window_still_decodes() {
        #[derive(Serialize)]
        enum Old {
            Welcome { version: u32 },
        }
        let bytes = encode(&Old::Welcome { version: 77 }).unwrap();
        match decode::<ServerMsg>(&bytes).unwrap() {
            ServerMsg::Welcome {
                version,
                compatible_since,
            } => assert_eq!((version, compatible_since), (77, 0)),
            other => panic!("{other:?}"),
        }
    }

    /// Encoding what was decoded gives the same bytes: nothing is lost on the way.
    fn round_trips<T: Serialize + for<'a> Deserialize<'a>>(msg: &T) {
        let bytes = encode(msg).unwrap();
        let back: T = decode(&bytes).unwrap();
        assert_eq!(encode(&back).unwrap(), bytes);
    }

    /// A peer built before `msg` existed cannot read it, while this build can: a new variant is
    /// why a version that adds one has to move the window or give it its own `introduced_in` arm.
    fn unreadable_before<Old: for<'a> Deserialize<'a>, T: Serialize + for<'a> Deserialize<'a>>(msg: &T) {
        let bytes = encode(msg).unwrap();
        assert!(decode::<Old>(&bytes).is_err(), "an older peer misread a newer message");
        assert!(decode::<T>(&bytes).is_ok());
    }

    fn every_client_message() -> Vec<ClientMsg> {
        use crate::conversation::ConversationId;
        use crate::settings_view::{SettingKey, SettingValue, WindowStyle};
        let id = ConversationId(47);
        let repo = |request| ClientMsg::Query(Query::Repo { term: 3, tag: 9, request });
        let mut clients = vec![
            ClientMsg::Hello {
                version: PROTOCOL_VERSION,
                attach: true,
                from: Some((3, "00ff".into())),
                structured: None,
                surface: Surface::Terminal,
                replays: true,
            },
            ClientMsg::Input {
                term: 3,
                data: b"ls\r".to_vec(),
            },
            ClientMsg::WantReplay { term: 3 },
            ClientMsg::Resize {
                term: 3,
                cols: 120,
                rows: 40,
            },
            ClientMsg::Hook {
                term: 3,
                agent: "claude".into(),
                status: HookStatus::Blocked,
                session: Some("abc-123".into()),
                cwd: Some(PathBuf::from("/code/api")),
                prompt: Some("fix it".into()),
                said: Some("done".into()),
                subagent: Some(Subagent {
                    id: "s1".into(),
                    kind: "Explore".into(),
                    start: true,
                    reported_at: 0,
                    task: None,
                    model: None,
                    effort: None,
                    activity: None,
                }),
                event: "PreToolUse".into(),
                pid: 42,
                token: "00ff".into(),
                transcript: Some(PathBuf::from("/t.jsonl")),
                model: Some("opus".into()),
                name: Some("api work".into()),
                background: vec!["b1".into()],
                background_agents: vec![],
                background_reported: false,
                ask: Some(PermissionAsk {
                    tool: "Bash".into(),
                    detail: "cargo test".into(),
                    answerable: true,
                    choices: vec![],
                    questions: Vec::new(),
                    form: Vec::new(),
                }),
                call: Some("00112233445566ff".into()),
            },
            ClientMsg::Query(Query::List),
            ClientMsg::Query(Query::Read { term: 3 }),
            ClientMsg::Query(Query::Worktrees { ws: 1 }),
            ClientMsg::Query(Query::PaneSearch {
                query: "error".into(),
            }),
            repo(crate::repo::RepoRequest::DiffRange {
                from: "main".into(),
                to: "HEAD".into(),
                path: Some("src/lib.rs".into()),
            }),
            repo(crate::repo::RepoRequest::Snapshots),
            repo(crate::repo::RepoRequest::RestoreCount {
                commit: "abc123".into(),
            }),
            repo(crate::repo::RepoRequest::FindFiles {
                query: "main".into(),
                limit: 20,
            }),
            ClientMsg::Query(Query::CheckOutput {
                term: 3,
                name: None,
            }),
            ClientMsg::Query(Query::CheckOutput {
                term: 3,
                name: Some("build".into()),
            }),
            ClientMsg::Query(Query::ConversationTerminalReplay { id, generation: 2 }),
            ClientMsg::Query(Query::Settings),
            ClientMsg::Query(Query::SideAnswer {
                id,
                ask: SideAsk::Command(SideCommand::SkillDoctor),
                tag: 3,
            }),
            ClientMsg::Query(Query::Extensions {
                request: crate::extensions::ExtRequest::Remove {
                    target: crate::extensions::ExtTarget {
                        agent: crate::extensions::ExtAgent::Claude,
                        kind: crate::extensions::ExtKind::Plugin,
                        id: "a@b".into(),
                        scope: crate::extensions::ExtScope::User,
                        project: None,
                    },
                },
                tag: 7,
            }),
            ClientMsg::Query(Query::AgentCommands {
                agent: crate::conversation::Provider::Claude,
                folder: "/code".into(),
                tag: 5,
            }),
            ClientMsg::Query(Query::Repositories { rescan: true, tag: 8 }),
            ClientMsg::Query(Query::ListFolders { path: "~".into(), tag: 1 }),
            ClientMsg::Query(Query::CreateFolder {
                parent: "~/code".into(),
                name: "new".into(),
                tag: 4,
            }),
            ClientMsg::Query(Query::SavedConversations {
                agent: "claude".into(),
                folder: "~/code/app".into(),
                tag: 2,
            }),
            ClientMsg::Query(Query::ClosedSessions),
            ClientMsg::Query(Query::WorktreeStanding {
                repo: PathBuf::from("/code/app"),
                folder: PathBuf::from("/code/app-worktrees/task"),
            }),
            ClientMsg::Query(Query::MachineFacts { tag: 1 }),
            ClientMsg::Query(Query::DiscardFile { term: 3, path: "src/a file.rs".into(), tag: 5 }),
            ClientMsg::Query(Query::CloneRepo {
                address: "https://h/o/r.git".into(),
                parent: "~".into(),
                tag: 3,
            }),
            ClientMsg::Query(Query::AgentSignIn {
                agent: SignInAgent::Codex,
                request: SignInRequest::Cancel,
                tag: 4,
            }),
            ClientMsg::Query(Query::FolderGit {
                folder: "~/shop".into(),
                request: FolderGitRequest::CheckoutRemote {
                    remote_branch: "origin/x".into(),
                },
                tag: 8,
            }),
            ClientMsg::Command(Command::NewWorkspace {
                cwd: Some(PathBuf::from("/code")),
                name: None,
                cmd: Some("claude".into()),
            }),
            ClientMsg::Command(Command::Split {
                term: 3,
                dir: crate::layout::Dir::Down,
                cmd: None,
                cwd: None,
            }),
            ClientMsg::Command(Command::ConversationTerminalResize {
                id,
                generation: 2,
                cols: 96,
                rows: 32,
            }),
            ClientMsg::Command(Command::ClosePane { term: 3 }),
            ClientMsg::Command(Command::CloseSession { term: 3 }),
            ClientMsg::Command(Command::UndoClose { term: 3 }),
            ClientMsg::Command(Command::Reveal { term: 3 }),
            ClientMsg::Command(Command::TeachAgent { term: 3 }),
            ClientMsg::Command(Command::Popup {
                cmd: "fzf".into(),
                cwd: None,
            }),
            ClientMsg::Command(Command::AskHuman {
                term: 3,
                text: "Deploy?".into(),
                options: vec!["Yes".into(), "No".into()],
            }),
            ClientMsg::Command(Command::AnswerHuman { id: 1, choice: 0 }),
            ClientMsg::Command(Command::Grant {
                term: 3,
                grants: Some(vec!["read".into()]),
            }),
            ClientMsg::Command(Command::QueueFollowUp {
                term: 3,
                text: "then run the tests".into(),
                first: false,
                operation: None,
            }),
            ClientMsg::Command(Command::ClearQueue { term: 3 }),
            ClientMsg::Command(Command::SendWhenReady {
                term: 3,
                text: "fix the parser".into(),
                operation: Some(7),
            }),
            ClientMsg::Command(Command::SendWhenReady {
                term: 3,
                text: "fix the parser".into(),
                operation: None,
            }),
            ClientMsg::Command(Command::RerunCheck {
                term: 3,
                name: None,
            }),
            ClientMsg::Command(Command::RerunCheck {
                term: 3,
                name: Some("test".into()),
            }),
            ClientMsg::Command(Command::OverrideCheck {
                term: 3,
                name: Some("test".into()),
                reason: "flaky on CI".into(),
            }),
            ClientMsg::Command(Command::UndoOverride {
                term: 3,
                name: None,
            }),
            ClientMsg::Command(Command::ForgetCheckApproval {
                project: PathBuf::from("/code/api"),
                name: "test".into(),
            }),
            ClientMsg::Command(Command::AnswerChatHelpers {
                conversation: ConversationId(7),
                choice: HelperChoice::Allow,
            }),
            ClientMsg::Command(Command::TidyWorktrees {
                items: vec![(PathBuf::from("/code/.wt/rate"), false)],
            }),
            ClientMsg::Command(Command::RenamePane {
                term: 3,
                name: "x".into(),
            }),
            ClientMsg::Command(Command::PinPane {
                term: 3,
                pinned: true,
            }),
            ClientMsg::Command(Command::ArchivePane {
                term: 3,
                archived: true,
            }),
            ClientMsg::Command(Command::SnoozePane {
                term: 3,
                until: Some(1_000),
            }),
            ClientMsg::Command(Command::NewFleet {
                name: "api".into(),
                cwd: None,
                colors: vec![3, 0],
            }),
            ClientMsg::Command(Command::NewShip {
                ws: 2,
                cwd: Some(PathBuf::from("/srv")),
                cmd: None,
            }),
            ClientMsg::Command(Command::MoveToWorktree {
                term: 3,
                branch: Some("feat/x".into()),
            }),
            ClientMsg::Command(Command::BranchWorktree {
                project: PathBuf::from("/code"),
                branch: "feat/x".into(),
            }),
            ClientMsg::Command(Command::SaveFile {
                term: 3,
                tag: 1,
                path: "README.md".into(),
                contents: "# hi\r\n".into(),
                version: Some("5-abc".into()),
            }),
            ClientMsg::Command(Command::ReloadAgent { term: 3 }),
            ClientMsg::Command(Command::SwapPanes { a: 3, b: 4 }),
            ClientMsg::Command(Command::RestoreSnapshot {
                term: 3,
                tag: 4,
                commit: "abc123".into(),
            }),
            ClientMsg::Command(Command::KillServer { forget: false }),
            ClientMsg::Command(Command::DropPrewarm),
            ClientMsg::Command(Command::ReopenClosedSession {
                agent: "claude".into(),
                session: "abc".into(),
            }),
            ClientMsg::Command(Command::ConversationStart {
                target: crate::conversation::StartTarget::Conversation { id, generation: 2 },
                branch: Some("chat/one".into()),
            }),
            ClientMsg::Command(Command::ConversationSend {
                id,
                generation: 1,
                operation: 3,
                text: "hi".into(),
                choice: Some(crate::conversation::TurnChoice {
                    model: Some("opus".into()),
                    effort: Some("high".into()),
                }),
            }),
            ClientMsg::Command(Command::ConversationDequeue {
                id,
                generation: 1,
                operation: 4,
            }),
            ClientMsg::Command(Command::ConversationSendNow {
                id,
                generation: 2,
                operation: 5,
            }),
        ];
        for choice in [ApprovalChoice::Once, ApprovalChoice::Always, ApprovalChoice::Never] {
            clients.push(ClientMsg::Command(Command::ApproveCheck {
                term: 3,
                name: "test".into(),
                choice,
                command_sha256: command_hash("npm test"),
            }));
        }
        for choice in [HelperChoice::Allow, HelperChoice::Always, HelperChoice::No] {
            clients.push(ClientMsg::Command(Command::AnswerHelpers { term: 3, choice }));
        }
        for (key, value) in [
            (SettingKey::ReduceMotion, SettingValue::Bool(true)),
            (SettingKey::Spinner, SettingValue::List(vec!["x".into()])),
            (SettingKey::StartDir, SettingValue::Text("~/code".into())),
            (SettingKey::BypassOff, SettingValue::List(vec!["gemini".into()])),
            (SettingKey::UpdateMachines, SettingValue::Bool(false)),
            (SettingKey::WindowStyle, SettingValue::WindowStyle(WindowStyle::Glass)),
        ] {
            clients.push(ClientMsg::Command(Command::SetSetting { key, value }));
        }
        clients
    }

    fn every_server_message() -> Vec<ServerMsg> {
        let id = crate::conversation::ConversationId(47);
        let why = BTreeMap::from([(3, RemovalReason::Closed), (4, RemovalReason::Exited)]);
        let mut servers = vec![
            ServerMsg::Welcome {
                version: PROTOCOL_VERSION,
                compatible_since: COMPATIBLE_SINCE,
            },
            ServerMsg::State(Snapshot::default()),
            ServerMsg::State(Snapshot {
                daemon_id: Some("0123456789abcdef0123456789abcdef".into()),
                revision: 9,
                removed: why.clone(),
                ..Snapshot::default()
            }),
            ServerMsg::TermsChanged {
                changed: Vec::new(),
                removed: vec![3],
                reasons: BTreeMap::from([(3, RemovalReason::Exited)]),
                revision: 4,
            },
            ServerMsg::TermsChanged {
                changed: Vec::new(),
                removed: vec![3, 4],
                reasons: why,
                revision: 9,
            },
            ServerMsg::Replay {
                term: 3,
                cols: 80,
                rows: 24,
                data: vec![27, b'[', b'H'],
            },
            ServerMsg::Output {
                term: 3,
                data: b"hello".to_vec(),
            },
            ServerMsg::Attention {
                term: 3,
                status: Status::Done,
            },
            ServerMsg::Reply(Reply::Ok),
            ServerMsg::Reply(Reply::Text("screen".into())),
            ServerMsg::Reply(Reply::Folders {
                tag: 7,
                listing: FolderListing {
                    path: "/home/me/code".into(),
                    exists: true,
                    entries: vec![FolderEntry {
                        name: "maiker".into(),
                        git: Some("dev".into()),
                        has_children: true,
                    }],
                    truncated: false,
                    can_create: true,
                },
            }),
            ServerMsg::Reply(Reply::SavedConversations {
                tag: 8,
                found: SavedConversations::Listed(vec![SavedConversation {
                    id: "0195c0de-0000-7000-8000-000000000001".into(),
                    first_message: "Rename the export button".into(),
                    last_active: 1_780_000_000,
                }]),
            }),
            ServerMsg::Reply(Reply::SavedConversations {
                tag: 9,
                found: SavedConversations::NotSupported,
            }),
            ServerMsg::Reply(Reply::TerminalReplay(vec![27, b'[', b'H'])),
            ServerMsg::Reply(Reply::ConversationQueued(crate::conversation::QueuedReceipt {
                conversation: id,
                generation: 1,
                operation: 4,
            })),
            ServerMsg::Reply(Reply::Settings(sample_settings())),
            ServerMsg::SettingsChanged(sample_settings()),
            ServerMsg::Reply(Reply::SideAnswer {
                tag: 3,
                answer: SideAnswer::Answered { text: "ok".into() },
            }),
            ServerMsg::Reply(Reply::HelperRead(HelperRecord {
                term: 1,
                helper: "a1".into(),
                entries: Vec::new(),
                start_missing: true,
            })),
            ServerMsg::Reply(Reply::Specialists(crate::specialists::SpecialistList {
                term: 1,
                project: "/p".into(),
                files: vec![crate::specialists::SpecialistFile {
                    tool: crate::specialists::SpecialistTool::Codex,
                    scope: crate::specialists::SpecialistScope::Home,
                    name: "code-reviewer".into(),
                    description: Some("Reviews a change".into()),
                    path: "/h/.codex/agents/code-reviewer.toml".into(),
                    text: "name = \"code-reviewer\"".into(),
                    text_cut: false,
                }],
                truncated: false,
            })),
            ServerMsg::Reply(Reply::AgentCommands {
                tag: 5,
                answer: Ok(vec![crate::agent_commands::AgentCommand {
                    name: "compact".into(),
                    description: "d".into(),
                    hint: String::new(),
                    aliases: Vec::new(),
                }]),
            }),
            ServerMsg::Reply(Reply::AgentCommands {
                tag: 6,
                answer: Err("Claude Code is not installed".into()),
            }),
            ServerMsg::Reply(Reply::Repositories {
                tag: 8,
                found: crate::repositories::RepositoryIndex {
                    repos: vec![crate::repositories::IndexedRepository {
                        path: "/home/me/app".into(),
                        branch: Some("main".into()),
                        last_used: 1_794_000_000,
                    }],
                    indexed_at: 1_794_000_100,
                    more: false,
                },
            }),
            ServerMsg::Reply(Reply::ClosedSessions(vec![ClosedSession {
                agent: "claude".into(),
                session: "abc".into(),
                cwd: PathBuf::from("/code/api"),
                branch: Some("main".into()),
                title: Some("fix the parser".into()),
                at: 7,
                worktree: None,
                repo: None,
            }])),
            ServerMsg::Reply(Reply::WorktreeStanding(Some(WorktreeStanding {
                dirty: 0,
                branch: Some("task".into()),
                merged: false,
                last_commit: "5 weeks ago".into(),
                inactive_days: Some(30),
            }))),
            ServerMsg::Reply(Reply::AgentSignIn {
                tag: 1,
                agent: SignInAgent::Claude,
                state: SignInState::Waiting {
                    link: Some("https://auth.example/device".into()),
                    code: Some("AB-12".into()),
                },
            }),
            ServerMsg::Reply(Reply::Cloned {
                tag: 1,
                outcome: Ok("/x".into()),
            }),
            ServerMsg::Reply(Reply::FolderGit {
                tag: 8,
                outcome: Ok(FolderGitAnswer::Branches(FolderBranches {
                    current: Some("main".into()),
                    branches: vec![FolderBranch {
                        name: "origin/x".into(),
                        current: false,
                        when: Some(5),
                        remote: true,
                    }],
                    worktrees: Vec::new(),
                })),
            }),
            ServerMsg::Error("nope".into()),
            ServerMsg::Notice("saved".into()),
            ServerMsg::AskRemoveWorktree {
                path: PathBuf::from("/w/task"),
                name: "task".into(),
                why: "not merged anywhere".into(),
            },
            ServerMsg::Clipboard {
                term: 3,
                text: "copied".into(),
            },
            ServerMsg::AutoWorkspace("api".into()),
            ServerMsg::Raise,
            ServerMsg::ConversationChanged { id, generation: 2 },
            ServerMsg::Bye,
        ];
        for outcome in [
            FolderCreated::Created { path: "/home/me/code/new".into() },
            FolderCreated::Exists,
            FolderCreated::NotAllowed { reason: "x".into() },
            FolderCreated::Failed { reason: "y".into() },
        ] {
            servers.push(ServerMsg::Reply(Reply::FolderCreated { tag: 9, outcome }));
        }
        for answer in [
            Ok(crate::extensions::ExtReply::Done("x".into())),
            Err(crate::extensions::ExtError::NeedsTerminal("claude mcp login x".into())),
        ] {
            servers.push(ServerMsg::Reply(Reply::Extensions { tag: 7, answer }));
        }
        servers
    }

    #[test]
    fn every_message_round_trips() {
        for m in &every_client_message() {
            round_trips(m);
        }
        for m in &every_server_message() {
            round_trips(m);
        }
    }

    /// 122 moved the window, so a message is as old as it unless it was added since and has an
    /// arm of its own: a client asks a daemon only what that daemon reads, and a daemon sends a
    /// client only what that client reads.
    #[test]
    fn every_message_is_as_old_as_the_window_or_says_when_it_was_added() {
        for m in every_client_message() {
            let since = match m {
                ClientMsg::Query(Query::DiscardFile { .. }) => DISCARD_FILE_SINCE,
                _ => COMPATIBLE_SINCE,
            };
            assert_eq!(m.introduced_in(), since, "{m:?}");
        }
        for m in every_server_message() {
            assert_eq!(m.introduced_in(), COMPATIBLE_SINCE, "{m:?}");
        }
    }

    /// Every message added since some older peer was built, against that peer's own enum.
    #[test]
    fn a_peer_from_before_a_message_cannot_read_it() {
        use crate::conversation::ConversationId;
        // Each enum below is a declaration as some older peer had it, so most of their
        // fields are never read.
        #[allow(dead_code)]
        mod old {
            use super::super::{Dir, HelperChoice, PathBuf, TermId, WsId};
            use crate::conversation::ConversationId;
            use serde::Deserialize;
            #[derive(Deserialize)]
            pub enum BeforePrewarm { KillServer { forget: bool } }
            #[derive(Deserialize)]
            pub enum BeforeChatHelpers { AnswerHelpers { term: TermId, choice: HelperChoice } }
            #[derive(Deserialize)]
            pub enum BeforeHeld { ClearQueue { term: TermId } }
            #[derive(Deserialize)]
            pub enum BeforeSwap { ResizePane { term: TermId, dir: Dir, delta: f32 } }
            #[derive(Deserialize)]
            pub enum BeforeDequeue { ConversationCancel { id: u64, generation: u64 } }
            #[derive(Deserialize)]
            pub enum Before116 { WriteFile { term: TermId, tag: u64, path: String, contents: String } }
            #[derive(Deserialize)]
            pub enum BeforePin { RenamePane { term: TermId, name: String } }
            #[derive(Deserialize)]
            pub enum BeforeFleets {
                NewWorkspace { cwd: Option<PathBuf>, name: Option<String>, cmd: Option<String> },
                NewTab { ws: WsId, name: Option<String>, cmd: Option<String> },
            }
            #[derive(Deserialize)]
            pub enum BeforeSoftClose { ClosePane { term: TermId } }
            #[derive(Deserialize)]
            pub enum BeforeSnooze { ArchivePane { term: TermId, archived: bool } }
            #[derive(Deserialize)]
            pub enum BeforeSendNow { ConversationDequeue { id: ConversationId, generation: u64, operation: u64 } }
            #[derive(Deserialize)]
            pub enum BeforeReopen { DropPrewarm }
            #[derive(Deserialize)]
            pub enum BeforeRestoreCount { Snapshots }
            #[derive(Deserialize)]
            pub enum BeforeFindFiles { Snapshots, RestoreCount { commit: String } }
            #[derive(Deserialize)]
            pub enum QueryBeforeSettings { UsageReport }
            #[derive(Deserialize)]
            pub enum QueryBeforeExtensions { GitIdentities { tag: u64 } }
            #[derive(Deserialize)]
            pub enum QueryBeforeFolders { ListFolders { path: String, tag: u64 } }
            #[derive(Deserialize)]
            pub enum QueryBeforeClosed { List }
            #[derive(Deserialize)]
            pub enum QueryBeforeDiscard { Git { term: u32, request: super::super::GitRequest, tag: u64 } }
            #[derive(Deserialize)]
            pub enum ReplyBefore { Ok }
            #[derive(Deserialize)]
            pub enum ServerBefore { Raise, Bye }
        }
        let id = ConversationId(3);
        unreadable_before::<old::BeforePrewarm, _>(&Command::DropPrewarm);
        unreadable_before::<old::BeforeChatHelpers, _>(&Command::AnswerChatHelpers {
            conversation: ConversationId(7),
            choice: HelperChoice::Allow,
        });
        unreadable_before::<old::BeforeHeld, _>(&Command::SendWhenReady {
            term: 3,
            text: "fix the parser".into(),
            operation: None,
        });
        unreadable_before::<old::BeforeSwap, _>(&Command::SwapPanes { a: 3, b: 4 });
        unreadable_before::<old::BeforeDequeue, _>(&Command::ConversationDequeue { id, generation: 1, operation: 4 });
        unreadable_before::<old::Before116, _>(&Command::SaveFile {
            term: 3,
            tag: 1,
            path: "README.md".into(),
            contents: "# hi\r\n".into(),
            version: Some("5-abc".into()),
        });
        for command in [
            Command::PinPane { term: 3, pinned: true },
            Command::ArchivePane { term: 3, archived: true },
            Command::SetSetting {
                key: crate::settings_view::SettingKey::ReduceMotion,
                value: crate::settings_view::SettingValue::Bool(true),
            },
        ] {
            unreadable_before::<old::BeforePin, _>(&command);
        }
        for command in [
            Command::NewFleet { name: "api".into(), cwd: None, colors: vec![3, 0] },
            Command::NewShip { ws: 2, cwd: Some(PathBuf::from("/srv")), cmd: None },
        ] {
            unreadable_before::<old::BeforeFleets, _>(&command);
        }
        for command in [Command::CloseSession { term: 3 }, Command::UndoClose { term: 3 }] {
            unreadable_before::<old::BeforeSoftClose, _>(&command);
        }
        unreadable_before::<old::BeforeSnooze, _>(&Command::SnoozePane { term: 3, until: Some(1_000) });
        unreadable_before::<old::BeforeSendNow, _>(&Command::ConversationSendNow { id, generation: 2, operation: 5 });
        unreadable_before::<old::BeforeReopen, _>(&Command::ReopenClosedSession {
            agent: "claude".into(),
            session: "abc".into(),
        });
        unreadable_before::<old::BeforeRestoreCount, _>(&crate::repo::RepoRequest::RestoreCount {
            commit: "abc123".into(),
        });
        unreadable_before::<old::BeforeFindFiles, _>(&crate::repo::RepoRequest::FindFiles {
            query: "main".into(),
            limit: 20,
        });

        unreadable_before::<old::QueryBeforeSettings, _>(&Query::Settings);
        unreadable_before::<old::QueryBeforeExtensions, _>(&Query::Extensions {
            request: crate::extensions::ExtRequest::Remove {
                target: crate::extensions::ExtTarget {
                    agent: crate::extensions::ExtAgent::Claude,
                    kind: crate::extensions::ExtKind::Plugin,
                    id: "a@b".into(),
                    scope: crate::extensions::ExtScope::User,
                    project: None,
                },
            },
            tag: 7,
        });
        for query in [
            Query::SideAnswer { id: ConversationId(4), ask: SideAsk::Command(SideCommand::SkillDoctor), tag: 3 },
            Query::Repositories { rescan: true, tag: 8 },
            Query::CreateFolder { parent: "~/code".into(), name: "new".into(), tag: 4 },
            Query::SavedConversations { agent: "claude".into(), folder: "~/code/app".into(), tag: 2 },
        ] {
            unreadable_before::<old::QueryBeforeFolders, _>(&query);
        }
        for query in [
            Query::ClosedSessions,
            Query::WorktreeStanding {
                repo: PathBuf::from("/code/app"),
                folder: PathBuf::from("/code/app-worktrees/task"),
            },
        ] {
            unreadable_before::<old::QueryBeforeClosed, _>(&query);
        }
        unreadable_before::<old::QueryBeforeDiscard, _>(&Query::DiscardFile { term: 3, path: "a.txt".into(), tag: 5 });

        let standing = WorktreeStanding {
            dirty: 0,
            branch: Some("task".into()),
            merged: false,
            last_commit: "5 weeks ago".into(),
            inactive_days: Some(30),
        };
        for reply in [
            Reply::ConversationQueued(crate::conversation::QueuedReceipt { conversation: id, generation: 1, operation: 4 }),
            Reply::SideAnswer { tag: 3, answer: SideAnswer::Answered { text: "ok".into() } },
            Reply::Repositories {
                tag: 8,
                found: crate::repositories::RepositoryIndex { repos: Vec::new(), indexed_at: 1_794_000_100, more: false },
            },
            Reply::SavedConversations { tag: 2, found: SavedConversations::NotSupported },
            Reply::ClosedSessions(Vec::new()),
            Reply::WorktreeStanding(Some(standing)),
        ] {
            unreadable_before::<old::ReplyBefore, _>(&reply);
        }
        for news in [
            ServerMsg::ConversationChanged { id, generation: 2 },
            ServerMsg::SettingsChanged(sample_settings()),
        ] {
            unreadable_before::<old::ServerBefore, _>(&news);
        }
    }

    /// `Query::DiscardFile` is new in 123 and nothing else moved, so `COMPATIBLE_SINCE` stays: a
    /// daemon on 122 still talks, is never asked to discard, and what it and its clients send
    /// today decodes as before. The answer is the `GitDone` it already had.
    #[test]
    fn a_discard_is_asked_only_of_a_daemon_that_reads_it_and_older_shapes_still_decode() {
        const { assert!(COMPATIBLE_SINCE < DISCARD_FILE_SINCE && DISCARD_FILE_SINCE <= PROTOCOL_VERSION) };
        let discard = ClientMsg::Query(Query::DiscardFile { term: 3, path: "src/a file.rs".into(), tag: 5 });
        assert_eq!(discard.introduced_in(), DISCARD_FILE_SINCE);
        assert!(speaks_with(DISCARD_FILE_SINCE - 1, 0), "a daemon from before it is still talked to");
        round_trips(&discard);

        // What a peer on 122 writes, in its own declarations.
        #[derive(Serialize)]
        enum OldQuery {
            Git { term: u32, request: GitRequest, tag: u64 },
        }
        #[derive(Serialize)]
        enum OldReply {
            GitDone { tag: u64, outcome: Result<String, String> },
        }
        let asked: Query = decode(&encode(&OldQuery::Git { term: 3, request: GitRequest::Push, tag: 5 }).unwrap()).unwrap();
        assert!(matches!(asked, Query::Git { term: 3, request: GitRequest::Push, tag: 5 }), "{asked:?}");
        let answered: Reply = decode(&encode(&OldReply::GitDone { tag: 5, outcome: Err("no".into()) }).unwrap()).unwrap();
        assert!(matches!(&answered, Reply::GitDone { tag: 5, outcome: Err(why) } if why == "no"), "{answered:?}");
        assert_eq!(ServerMsg::Reply(answered).introduced_in(), COMPATIBLE_SINCE, "an older client reads the answer");
    }

    /// Pinned encodings of answers a peer on the same version reads: a reorder or a rename of
    /// these is seen, which a round trip would not catch.
    #[test]
    fn answers_keep_their_pinned_wire_shape() {
        let reply = crate::repo::RepoReply::Saved { version: "7-ab".into() };
        assert_eq!(
            encode(&reply).unwrap().as_ref(),
            [0x81, 0xa5, b'S', b'a', b'v', b'e', b'd', 0x81, 0xa7, b'v', b'e', b'r', b's', b'i', b'o', b'n', 0xa4, b'7', b'-', b'a', b'b']
        );
        assert_eq!(encode(&crate::repo::RepoReply::ChangedOnDisk).unwrap().as_ref(), [0xad, b'C', b'h', b'a', b'n', b'g', b'e', b'd', b'O', b'n', b'D', b'i', b's', b'k']);
        let created = FolderCreated::Created { path: "/a/b".into() };
        assert_eq!(
            encode(&created).unwrap().as_ref(),
            [0x81, 0xa7, b'C', b'r', b'e', b'a', b't', b'e', b'd', 0x81, 0xa4, b'p', b'a', b't', b'h', 0xa4, b'/', b'a', b'/', b'b']
        );
        assert_eq!(encode(&FolderCreated::Exists).unwrap().as_ref(), [0xa6, b'E', b'x', b'i', b's', b't', b's']);
    }

    #[test]
    fn conversation_summary_from_an_older_daemon_defaults_to_structured_execution() {
        use crate::conversation::capabilities::{Capabilities, Verified};
        let mut summary: ConversationSummary = serde_json::from_value(serde_json::json!({
            "id": 7,
            "generation": 3,
            "provider": "Codex",
            "cwd": "/code",
            "worktree": null,
            "state": "Running",
            "status": "Idle",
            "native_term": null,
            "checks": []
        }))
        .expect("older summary without execution still decodes");

        assert_eq!(
            summary.execution,
            crate::conversation::ExecutionKind::Structured
        );
        // `root` and `branch` (a chat session's project, ADR 0003) are defaulted too.
        assert_eq!((summary.root.clone(), summary.branch.clone()), (None, None));
        assert!(summary.helpers.is_empty(), "an older daemon reports no helpers");
        assert!(summary.helper_ask.is_empty(), "an older daemon's chat asks for no helpers");
        assert_eq!(summary.capabilities, None, "an older daemon reports no capabilities");

        // Capabilities are written only when the daemon knows them.
        let unknown = serde_json::to_value(&summary).unwrap();
        summary.capabilities = Some(Capabilities {
            steer: true,
            verified: Verified::Pinned,
            ..Capabilities::default()
        });
        let known = serde_json::to_value(&summary).unwrap();
        let read: ConversationSummary = serde_json::from_value(known.clone()).unwrap();
        assert!(unknown.get("capabilities").is_none());
        assert_eq!(known["capabilities"]["steer"], true);
        assert_eq!(read.capabilities, summary.capabilities);
    }

    /// `queued` was added to the read as a defaulted field: a reply from before it still decodes,
    /// as an empty queue.
    #[test]
    fn a_conversation_read_from_before_the_send_queue_still_decodes() {
        let read: crate::conversation::ReadResult = serde_json::from_value(serde_json::json!({
            "conversation": 3, "generation": 1, "status": "Idle", "receipt": null,
            "history": { "entries": [], "next": null, "completeness": "Complete" },
            "error": null, "checks": [], "approvals": []
        }))
        .expect("a read from before the queue");
        assert!(read.queued.is_empty() && read.history.resume.is_none() && !read.history.reset);
        assert!(read.answered_approvals.is_empty(), "a read from before answered approvals");
    }

    /// `questions` was added to a permission ask as a defaulted field: one from a hook or a daemon
    /// built before it still decodes, as a prompt with none, so the version stays as it was.
    #[test]
    fn a_permission_ask_from_before_several_questions_still_decodes() {
        #[derive(Serialize)]
        struct OldAsk {
            tool: String,
            detail: String,
            answerable: bool,
            choices: Vec<String>,
        }
        let bytes = encode(&OldAsk { tool: "AskUserQuestion".into(), detail: "Which?".into(), answerable: false, choices: vec!["A".into(), "B".into()] }).unwrap();
        let ask: PermissionAsk = decode(&bytes).unwrap();
        assert_eq!((ask.choices.len(), ask.questions.len()), (2, 0));

        let several = PermissionAsk {
            tool: "AskUserQuestion".into(),
            questions: vec![AskQuestion { question: "Which?".into(), choices: vec!["A".into(), "B".into()], multi: false }; 2],
            ..PermissionAsk::default()
        };
        let back: PermissionAsk = decode(&encode(&several).unwrap()).unwrap();
        assert_eq!(back, several);

        // A form with a question that takes several answers reaches a peer from before it as no
        // questions at all, so that peer leaves the prompt to the terminal rather than answer it
        // one key per question.
        #[derive(Deserialize)]
        struct AskBeforeForm {
            #[serde(default)]
            choices: Vec<String>,
            #[serde(default)]
            questions: Vec<OldQuestion>,
        }
        #[derive(Deserialize)]
        struct OldQuestion {}
        let form = PermissionAsk {
            tool: "AskUserQuestion".into(),
            form: vec![AskQuestion { question: "Which ones?".into(), choices: vec!["A".into(), "B".into()], multi: true }],
            ..PermissionAsk::default()
        };
        let old: AskBeforeForm = decode(&encode(&form).unwrap()).unwrap();
        assert!(old.choices.is_empty() && old.questions.is_empty());
        let back: PermissionAsk = decode(&encode(&form).unwrap()).unwrap();
        assert_eq!(back, form);

        // One from before choices existed reads with none.
        let ask: PermissionAsk =
            serde_json::from_value(serde_json::json!({"tool": "Bash", "detail": "ls", "answerable": true})).unwrap();
        assert!(ask.choices.is_empty(), "an older peer sends no choices");
    }

    /// `first` and then `operation` were added to `QueueFollowUp` (and `operation` to
    /// `SendWhenReady`) as defaulted fields: a send from before either decodes as "at the back"
    /// with no operation, and an older daemon reads one that carries an operation but ignores it,
    /// so `COMPATIBLE_SINCE` stays.
    #[test]
    fn a_terminal_send_from_before_first_and_operation_ids_still_decodes_both_ways() {
        #[derive(Serialize)]
        enum BeforeFirst {
            QueueFollowUp { term: TermId, text: String },
        }
        let bytes = encode(&BeforeFirst::QueueFollowUp { term: 3, text: "next".into() }).unwrap();
        let Command::QueueFollowUp { first, .. } = decode(&bytes).unwrap() else {
            panic!("expected a follow-up")
        };
        assert!(!first);

        #[derive(Debug, Serialize, Deserialize)]
        enum OldCommand {
            QueueFollowUp { term: TermId, text: String, first: bool },
            SendWhenReady { term: TermId, text: String },
        }
        let queued = encode(&OldCommand::QueueFollowUp { term: 3, text: "next".into(), first: true }).unwrap();
        assert!(matches!(
            decode::<Command>(&queued).unwrap(),
            Command::QueueFollowUp { term: 3, first: true, operation: None, .. }
        ));
        let held = encode(&OldCommand::SendWhenReady { term: 3, text: "fix it".into() }).unwrap();
        assert!(matches!(
            decode::<Command>(&held).unwrap(),
            Command::SendWhenReady { term: 3, operation: None, .. }
        ));

        let new = encode(&Command::SendWhenReady { term: 3, text: "fix it".into(), operation: Some(9) }).unwrap();
        assert!(matches!(
            decode::<Command>(&new).unwrap(),
            Command::SendWhenReady { operation: Some(9), .. }
        ));
        assert!(matches!(
            decode::<OldCommand>(&new).unwrap(),
            OldCommand::SendWhenReady { term: 3, text } if text == "fix it"
        ));
        let new = encode(&Command::QueueFollowUp { term: 3, text: "next".into(), first: false, operation: Some(9) }).unwrap();
        assert!(matches!(decode::<OldCommand>(&new).unwrap(), OldCommand::QueueFollowUp { term: 3, first: false, .. }));
    }

    /// `choice` was added to `ConversationSend` as a defaulted field: a send from before it still
    /// decodes, as "nothing picked", and one that carries a choice round-trips.
    #[test]
    fn a_send_from_before_the_model_choice_still_decodes() {
        #[derive(Serialize)]
        enum OldCommand {
            ConversationSend {
                id: crate::conversation::ConversationId,
                generation: u64,
                operation: u64,
                text: String,
            },
        }
        let id = crate::conversation::ConversationId(3);
        let bytes = encode(&OldCommand::ConversationSend { id, generation: 1, operation: 2, text: "hi".into() }).unwrap();
        let Command::ConversationSend { choice, .. } = decode(&bytes).unwrap() else {
            panic!("expected a send")
        };
        assert_eq!(choice, None);

        let picked = crate::conversation::TurnChoice { model: Some("opus".into()), effort: Some("high".into()) };
        let sent = Command::ConversationSend { id, generation: 1, operation: 3, text: "hi".into(), choice: Some(picked.clone()) };
        let Command::ConversationSend { choice, .. } = decode(&encode(&sent).unwrap()).unwrap() else {
            panic!("expected a send")
        };
        assert_eq!(choice, Some(picked));
    }

    /// `agent` and `prompt` were added to `NewWorktree` as defaulted fields: a peer that does not
    /// send them still decodes, as "no agent", so the version stays as it was.
    #[test]
    fn a_worktree_request_from_before_agent_and_prompt_still_decodes() {
        #[derive(Serialize)]
        enum OldCommand {
            NewWorktree {
                ws: WsId,
                branch: String,
                base: Option<String>,
                cmd: Option<String>,
                split: Option<TermId>,
                from: Option<PathBuf>,
            },
        }
        let bytes = encode(&OldCommand::NewWorktree {
            ws: 1,
            branch: "feat/x".into(),
            base: None,
            cmd: Some("claude".into()),
            split: None,
            from: None,
        })
        .unwrap();
        let Command::NewWorktree {
            branch,
            cmd,
            agent,
            prompt,
            ..
        } = decode(&bytes).unwrap()
        else {
            panic!("expected a worktree request")
        };
        assert_eq!(
            (branch.as_str(), cmd.as_deref()),
            ("feat/x", Some("claude"))
        );
        assert_eq!((agent, prompt), (None, None));
    }

    /// `branch` was added to `ConversationStart` as a defaulted field (protocol 72, chat sessions
    /// on a branch): the shape from before it still decodes, as "no branch", and a start that
    /// names one round-trips. The version was raised too, because a peer that predates the field
    /// would drop it and start in the main checkout.
    #[test]
    fn a_conversation_start_from_before_branch_still_decodes() {
        #[derive(Serialize)]
        enum OldCommand {
            ConversationStart {
                target: crate::conversation::StartTarget,
            },
        }
        let target = crate::conversation::StartTarget::Conversation {
            id: crate::conversation::ConversationId(5),
            generation: 2,
        };
        let bytes = encode(&OldCommand::ConversationStart {
            target: target.clone(),
        })
        .unwrap();
        let Command::ConversationStart { target: read, branch } = decode(&bytes).unwrap() else {
            panic!("expected a conversation start")
        };
        assert_eq!((read, branch), (target.clone(), None));

        let bytes = encode(&Command::ConversationStart {
            target,
            branch: Some("chat/one".into()),
        })
        .unwrap();
        assert!(matches!(
            decode::<Command>(&bytes).unwrap(),
            Command::ConversationStart { branch: Some(ref b), .. } if b == "chat/one"
        ));
    }

    /// A `Snapshot` as a daemon built before `daemon_id` encoded it.
    #[derive(Serialize)]
    struct SnapshotWithoutId {
        conversations: Vec<ConversationSummary>,
        daemon_version: String,
        workspaces: Vec<WorkspaceInfo>,
        active_ws: Option<WsId>,
        terms: BTreeMap<TermId, TermInfo>,
    }

    #[test]
    fn a_snapshot_from_a_daemon_without_an_id_decodes_with_none() {
        let old = SnapshotWithoutId {
            conversations: Vec::new(),
            daemon_version: "0.50.0".into(),
            workspaces: Vec::new(),
            active_ws: None,
            terms: BTreeMap::new(),
        };
        let snapshot: Snapshot = decode(&encode(&old).unwrap()).unwrap();
        assert_eq!(snapshot.daemon_id, None);
        assert_eq!(snapshot.daemon_version, "0.50.0");
    }

    #[test]
    fn a_state_and_a_pane_delta_from_before_revisions_read_as_revision_zero() {
        #[derive(Serialize)]
        struct OldSnapshot {
            workspaces: Vec<WorkspaceInfo>,
            active_ws: Option<WsId>,
            terms: BTreeMap<TermId, TermInfo>,
        }
        #[derive(Serialize)]
        enum OldServerMsg {
            TermsChanged { changed: Vec<TermInfo>, removed: Vec<TermId> },
        }
        let old = OldSnapshot { workspaces: Vec::new(), active_ws: None, terms: BTreeMap::new() };
        let snapshot: Snapshot = decode(&encode(&old).unwrap()).unwrap();
        assert_eq!(snapshot.revision, 0);

        let old = OldServerMsg::TermsChanged { changed: Vec::new(), removed: vec![3] };
        let Ok(ServerMsg::TermsChanged { removed, revision, .. }) = decode(&encode(&old).unwrap())
        else {
            panic!("an old pane delta still decodes");
        };
        assert_eq!((removed, revision), (vec![3], 0));

        let new = ServerMsg::TermsChanged {
            changed: Vec::new(),
            removed: Vec::new(),
            reasons: BTreeMap::new(),
            revision: 9,
        };
        assert!(matches!(
            decode(&encode(&new).unwrap()),
            Ok(ServerMsg::TermsChanged { revision: 9, .. })
        ));
        let numbered = Snapshot { revision: 9, ..Snapshot::default() };
        assert_eq!(decode::<Snapshot>(&encode(&numbered).unwrap()).unwrap().revision, 9);
    }

    #[test]
    fn a_pane_delta_and_a_state_from_before_removal_reasons_read_as_no_reason_given() {
        #[derive(Serialize)]
        struct OldSnapshot {
            workspaces: Vec<WorkspaceInfo>,
            active_ws: Option<WsId>,
            terms: BTreeMap<TermId, TermInfo>,
            revision: u64,
        }
        #[derive(Serialize)]
        enum OldServerMsg {
            TermsChanged { changed: Vec<TermInfo>, removed: Vec<TermId>, revision: u64 },
        }
        let old = OldServerMsg::TermsChanged { changed: Vec::new(), removed: vec![3], revision: 2 };
        let Ok(ServerMsg::TermsChanged { removed, reasons, .. }) = decode(&encode(&old).unwrap())
        else {
            panic!("an old pane delta still decodes");
        };
        assert_eq!(removed, vec![3]);
        assert!(reasons.is_empty(), "an older daemon gives no reason");

        let old =
            OldSnapshot { workspaces: Vec::new(), active_ws: None, terms: BTreeMap::new(), revision: 2 };
        assert!(decode::<Snapshot>(&encode(&old).unwrap()).unwrap().removed.is_empty());

        let why = BTreeMap::from([(3, RemovalReason::Closed), (4, RemovalReason::Exited)]);
        let new = ServerMsg::TermsChanged {
            changed: Vec::new(),
            removed: vec![3, 4],
            reasons: why.clone(),
            revision: 3,
        };
        let Ok(ServerMsg::TermsChanged { reasons, .. }) = decode(&encode(&new).unwrap()) else {
            panic!("a pane delta with reasons decodes");
        };
        assert_eq!(reasons, why);
        let state = Snapshot { removed: why.clone(), ..Snapshot::default() };
        assert_eq!(decode::<Snapshot>(&encode(&state).unwrap()).unwrap().removed, why);
    }

    #[test]
    fn a_removal_reason_from_a_newer_daemon_reads_as_unknown_and_the_message_survives() {
        #[derive(Serialize)]
        enum NewerReason {
            Exited,
            Teleported,
        }
        #[derive(Serialize)]
        enum NewerServerMsg {
            TermsChanged {
                changed: Vec<TermInfo>,
                removed: Vec<TermId>,
                reasons: BTreeMap<TermId, NewerReason>,
                revision: u64,
            },
        }
        let newer = NewerServerMsg::TermsChanged {
            changed: Vec::new(),
            removed: vec![3, 4],
            reasons: BTreeMap::from([(3, NewerReason::Exited), (4, NewerReason::Teleported)]),
            revision: 5,
        };
        let Ok(ServerMsg::TermsChanged { removed, reasons, revision, .. }) =
            decode(&encode(&newer).unwrap())
        else {
            panic!("a reason this build does not know must not cost the message");
        };
        assert_eq!((removed, revision), (vec![3, 4], 5));
        assert_eq!(
            reasons,
            BTreeMap::from([(3, RemovalReason::Exited), (4, RemovalReason::Unknown)])
        );
    }

    #[test]
    fn a_check_from_an_older_peer_fills_in_what_it_lacks() {
        let bytes = rmp_serde::to_vec_named(&BTreeMap::from([("command", "npm test")])).unwrap();
        let info: CheckInfo = decode(&bytes).expect("only the command");
        assert_eq!(
            (info.command.as_str(), info.exit_code, info.rerun_queued),
            ("npm test", None, false)
        );

        // A v43 check has the first fields and reads with the newer ones defaulted.
        let v43 = serde_json::json!({
            "command": "npm test", "state": "Failed", "exit_code": 1, "started_at": 100, "duration_ms": 14200,
            "after_turn_ended_at": 90, "first_failing_line": "FAIL", "rerun_queued": false,
            "overridden_at": null, "override_reason": "",
        });
        let info: CheckInfo = decode(&rmp_serde::to_vec_named(&v43).unwrap()).expect("a v43 check");
        assert_eq!((info.state, info.exit_code), (CheckState::Failed, Some(1)));
        assert_eq!(
            (
                info.name.as_str(),
                info.source,
                info.changed_files.len(),
                info.previous_command
            ),
            ("", CheckSource::User, 0, None)
        );
    }

    fn every_field_check() -> CheckInfo {
        CheckInfo {
            command: "npm test".into(),
            state: CheckState::NeedsApproval,
            exit_code: Some(1),
            started_at: 100,
            duration_ms: 14_200,
            after_turn_ended_at: 90,
            first_failing_line: "FAIL footer.test.ts".into(),
            rerun_queued: true,
            overridden_at: Some(130),
            override_reason: "flaky".into(),
            name: "test".into(),
            cwd: PathBuf::from("/code/api"),
            turn: 3,
            line_count: 1_284,
            stale_since: Some(140),
            changed_files: vec![
                ChangedFile {
                    kind: 'M',
                    path: "src/a.rs".into(),
                },
                ChangedFile {
                    kind: 'A',
                    path: "tests/b.rs".into(),
                },
            ],
            overridden_by: "you".into(),
            source: CheckSource::Repo {
                file: ".maiker/checks.toml".into(),
                commit: Some("a1b2c3d".into()),
                committed_at: Some(80),
                uncommitted: true,
            },
            previous_command: Some("npm t".into()),
        }
    }

    /// A pane as a peer sends it, with `extra` fields on top.
    fn pane_from(extra: serde_json::Value) -> TermInfo {
        let mut v = serde_json::json!({
            "id": 3, "cols": 80, "rows": 24, "title": "", "process": "", "agent": null,
            "status": "Done", "cwd": "/code", "summary": "", "name": "", "model": "", "said": "",
            "branch": null, "linked": false, "subagents": [], "root": null, "top": null,
            "since": 0, "asleep": false, "win32_input": false,
        });
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        decode(&rmp_serde::to_vec_named(&v).unwrap()).expect("a pane")
    }

    /// Every field added to a pane after the first peers is defaulted: a pane from a peer that
    /// sends none of them reads as unset (no checks, no helpers asked for, no changes, a terminal,
    /// awake, neither pinned nor archived, no question, no exit, no repeats), and one that sends
    /// them reads them and round-trips.
    #[test]
    fn a_pane_from_an_older_peer_reads_every_newer_field_as_unset() {
        let old = pane_from(serde_json::json!({}));
        assert_eq!(old.check(), None);
        assert!(old.helper_ask.is_empty(), "a peer that knows no helper requests");
        assert!(old.last_lines.is_empty(), "a peer that reads no screens sends none");
        assert_eq!((old.diff_added, old.diff_removed, old.diff_files), (0, 0, 0));
        assert!(!old.began_as_agent, "a pane from before began_as_agent is a terminal");
        assert_eq!(old.effort, None);
        assert_eq!(old.snoozed_until, None);
        assert!(!old.pinned && !old.archived);
        assert_eq!(old.ask, None);
        assert_eq!(old.exit, None);
        assert_eq!(old.repeats, None);

        let mut new = pane_from(serde_json::json!({
            "diff_added": 7, "diff_removed": 2, "diff_files": 3, "began_as_agent": true,
            "effort": "medium", "snoozed_until": 1_000, "pinned": true, "archived": true,
        }));
        assert_eq!((new.diff_added, new.diff_removed, new.diff_files), (7, 2, 3));
        assert!(new.began_as_agent);
        assert_eq!(new.effort.as_deref(), Some("medium"));
        assert_eq!(new.snoozed_until, Some(1_000));
        assert!(new.pinned && new.archived);

        new.helper_ask = vec!["fix the login test".into(), "port the footer".into()];
        new.last_lines = "All three migrations ran clean.".into();
        new.ask = Some(PermissionAsk {
            tool: "Bash".into(),
            detail: "cargo test".into(),
            answerable: true,
            choices: vec!["A".into(), "B".into()],
            questions: Vec::new(),
            form: Vec::new(),
        });
        new.exit = Some(ExitInfo {
            code: Some(137),
            at: 9,
        });
        new.repeats = Some(6);
        new.checks = vec![CheckInfo {
            command: "npm test".into(),
            state: CheckState::Overridden,
            exit_code: Some(1),
            started_at: 100,
            duration_ms: 14_200,
            after_turn_ended_at: 90,
            first_failing_line: "FAIL footer.test.ts".into(),
            rerun_queued: true,
            overridden_at: Some(130),
            override_reason: "flaky".into(),
            ..Default::default()
        }];
        round_trips(&ServerMsg::State(Snapshot {
            terms: [(3, new)].into(),
            ..Default::default()
        }));
    }

    fn sample_settings() -> crate::settings_view::SharedSettings {
        use crate::settings_view::*;
        SharedSettings {
            default_agent: "claude".into(),
            new_session_view: NewSessionView::Terminal,
            sidebar_side: SidebarSide::Right,
            theme_dark: "night".into(),
            theme_light: "day".into(),
            appearance: Appearance::Light,
            spinner: vec!["a".into(), "b".into()],
            start_dir: "C:\\Users\\me\\code".into(),
            reduce_motion: true,
            window_style: WindowStyle::Glass,
            bypass_off: vec!["codex".into()],
            update_machines: false,
        }
    }

    /// An older daemon's settings have no bypass switches: they read as all on, and the key is only sent
    /// to a daemon that knows it.
    #[test]
    fn settings_from_before_the_bypass_switches_read_as_all_on() {
        use crate::settings_view::*;
        #[derive(Serialize)]
        struct Old {
            default_agent: String,
            new_session_view: NewSessionView,
            sidebar_side: SidebarSide,
            theme_dark: String,
            theme_light: String,
            appearance: Appearance,
            spinner: Vec<String>,
            start_dir: String,
            reduce_motion: bool,
            window_style: WindowStyle,
        }
        let now = sample_settings();
        let old = Old {
            default_agent: now.default_agent.clone(),
            new_session_view: now.new_session_view,
            sidebar_side: now.sidebar_side,
            theme_dark: now.theme_dark.clone(),
            theme_light: now.theme_light.clone(),
            appearance: now.appearance,
            spinner: now.spinner.clone(),
            start_dir: now.start_dir.clone(),
            reduce_motion: now.reduce_motion,
            window_style: now.window_style,
        };
        let read: SharedSettings = decode(&rmp_serde::to_vec_named(&old).unwrap()).unwrap();
        assert_eq!(read, SharedSettings { bypass_off: Vec::new(), update_machines: true, ..now });
        let machines = ClientMsg::Command(Command::SetSetting {
            key: SettingKey::UpdateMachines,
            value: SettingValue::Bool(false),
        });
        assert_eq!(machines.introduced_in(), COMPATIBLE_SINCE);
        let set = ClientMsg::Command(Command::SetSetting {
            key: SettingKey::BypassOff,
            value: SettingValue::List(vec!["codex".into()]),
        });
        assert_eq!(set.introduced_in(), COMPATIBLE_SINCE);
        let other = ClientMsg::Command(Command::SetSetting {
            key: SettingKey::ReduceMotion,
            value: SettingValue::Bool(true),
        });
        assert_eq!(other.introduced_in(), COMPATIBLE_SINCE);
    }

    #[test]
    fn a_check_with_every_field_round_trips() {
        round_trips(&every_field_check());
        let mut term = pane_from(serde_json::json!({}));
        term.checks = vec![
            every_field_check(),
            CheckInfo {
                name: "build".into(),
                state: CheckState::Pending,
                ..Default::default()
            },
        ];
        round_trips(&ServerMsg::State(Snapshot {
            terms: [(3, term)].into(),
            ..Default::default()
        }));
    }

    /// Workflow reports are gone (ADR 0011). A pane from a daemon that still keeps runs reads
    /// without them, and a report from an older `maiker workflow report` is not read as anything
    /// else: that one-shot call is refused, never misread.
    #[test]
    fn a_pane_with_workflow_runs_reads_without_them_and_a_report_is_refused() {
        let term = pane_from(serde_json::json!({ "workflows": [{ "workflow": "factory", "run": "1", "steps": [] }] }));
        round_trips(&ServerMsg::State(Snapshot { terms: [(3, term)].into(), ..Default::default() }));
        #[derive(Serialize)]
        enum OldClientMsg {
            WorkflowReport { term: TermId, token: String, run: serde_json::Value },
        }
        let old = OldClientMsg::WorkflowReport { term: 1, token: String::new(), run: serde_json::json!({}) };
        assert!(decode::<ClientMsg>(&encode(&old).unwrap()).is_err());
    }

    #[test]
    fn reports_go_to_this_version_and_the_older_ones_that_read_them_but_never_a_newer_one() {
        assert!(daemon_reads_reports(PROTOCOL_VERSION));
        assert!(daemon_reads_reports(REPORTS_READ_SINCE));
        assert!(!daemon_reads_reports(REPORTS_READ_SINCE - 1));
        assert!(!daemon_reads_reports(PROTOCOL_VERSION + 1));
    }

    /// The reports as the daemon at `REPORTS_READ_SINCE` declares them, copied from that
    /// release. They change only together with `REPORTS_READ_SINCE`.
    mod reports_at_oldest {
        use super::super::TermId;
        use serde::Deserialize;
        use std::path::PathBuf;

        #[derive(Debug, PartialEq, Deserialize)]
        pub enum HookStatus {
            Working,
            Blocked,
            Done,
            Idle,
            Gone,
            Same,
        }

        #[derive(Debug, Deserialize)]
        pub struct Subagent {
            pub id: String,
            pub kind: String,
            pub start: bool,
            #[serde(default)]
            pub reported_at: u64,
            #[serde(default)]
            pub task: Option<String>,
            #[serde(default)]
            pub model: Option<String>,
            #[serde(default)]
            pub effort: Option<String>,
            #[serde(default)]
            pub activity: Option<String>,
        }

        #[derive(Debug, Deserialize)]
        pub struct PermissionAsk {
            pub tool: String,
            pub detail: String,
            #[serde(default)]
            pub answerable: bool,
            #[serde(default)]
            pub choices: Vec<String>,
        }

        #[derive(Debug, Deserialize)]
        pub struct Usage {
            pub context: Option<f32>,
            pub cost: Option<f64>,
            #[serde(default)]
            pub tokens: Option<u64>,
            #[serde(default)]
            pub tokens_in: Option<u64>,
            #[serde(default)]
            pub tokens_out: Option<u64>,
        }

        #[derive(Debug, Deserialize)]
        pub struct Limit {
            pub name: String,
            pub used: f32,
            pub resets_at: u64,
        }

        #[derive(Debug, Deserialize)]
        #[allow(clippy::large_enum_variant)]
        pub enum ClientMsg {
            Hook {
                term: TermId,
                agent: String,
                status: HookStatus,
                session: Option<String>,
                cwd: Option<PathBuf>,
                prompt: Option<String>,
                said: Option<String>,
                subagent: Option<Subagent>,
                event: String,
                pid: u32,
                #[serde(default)]
                token: String,
                transcript: Option<PathBuf>,
                model: Option<String>,
                name: Option<String>,
                #[serde(default)]
                background: Vec<String>,
                #[serde(default)]
                ask: Option<PermissionAsk>,
                #[serde(default)]
                call: Option<String>,
            },
            Usage {
                term: TermId,
                token: String,
                usage: Usage,
                limits: Vec<Limit>,
            },
        }
    }

    #[test]
    fn todays_reports_are_read_by_the_oldest_daemon_they_are_sent_to() {
        let hook = ClientMsg::Hook {
            term: 3,
            agent: "claude".into(),
            status: HookStatus::Done,
            session: Some("abc-123".into()),
            cwd: Some(PathBuf::from("/code/api")),
            prompt: Some("fix it".into()),
            said: Some("done".into()),
            subagent: Some(Subagent {
                id: "s1".into(),
                kind: "Explore".into(),
                start: false,
                reported_at: 7,
                task: Some("look".into()),
                model: Some("opus".into()),
                effort: Some("high".into()),
                activity: Some("reading".into()),
            }),
            event: "Stop".into(),
            pid: 42,
            token: "00ff".into(),
            transcript: Some(PathBuf::from("/t.jsonl")),
            model: Some("opus".into()),
            name: Some("api work".into()),
            background: vec!["b1".into(), "a2".into()],
            background_agents: vec!["a2".into()],
            background_reported: true,
            ask: Some(PermissionAsk {
                tool: "Bash".into(),
                detail: "cargo test".into(),
                answerable: false,
                choices: vec!["Yes".into()],
                questions: Vec::new(),
                form: Vec::new(),
            }),
            call: Some("00112233445566ff".into()),
        };
        let read: reports_at_oldest::ClientMsg =
            decode(&encode(&hook).unwrap()).expect("the oldest daemon reads today's hook report");
        let reports_at_oldest::ClientMsg::Hook {
            term,
            agent,
            status,
            session,
            cwd,
            prompt,
            said,
            subagent,
            event,
            pid,
            token,
            transcript,
            model,
            name,
            background,
            ask,
            call,
        } = read
        else {
            panic!("expected a hook report")
        };
        assert_eq!(
            (term, agent.as_str(), pid, token.as_str()),
            (3, "claude", 42, "00ff")
        );
        assert_eq!(status, reports_at_oldest::HookStatus::Done);
        assert_eq!(event, "Stop");
        assert_eq!(session.as_deref(), Some("abc-123"));
        assert_eq!(cwd, Some(PathBuf::from("/code/api")));
        assert_eq!(
            (prompt.as_deref(), said.as_deref()),
            (Some("fix it"), Some("done"))
        );
        assert_eq!(transcript, Some(PathBuf::from("/t.jsonl")));
        assert_eq!(
            (model.as_deref(), name.as_deref()),
            (Some("opus"), Some("api work"))
        );
        assert_eq!(background, ["b1", "a2"]);
        assert_eq!(call.as_deref(), Some("00112233445566ff"));
        let subagent = subagent.expect("the helper it names");
        assert_eq!(
            (
                subagent.id.as_str(),
                subagent.kind.as_str(),
                subagent.start,
                subagent.reported_at
            ),
            ("s1", "Explore", false, 7)
        );
        assert_eq!(
            (
                subagent.task.as_deref(),
                subagent.model.as_deref(),
                subagent.effort.as_deref(),
                subagent.activity.as_deref()
            ),
            (Some("look"), Some("opus"), Some("high"), Some("reading"))
        );
        let ask = ask.expect("the question it asks");
        assert_eq!(
            (ask.tool.as_str(), ask.detail.as_str(), ask.answerable),
            ("Bash", "cargo test", false)
        );
        assert_eq!(ask.choices, ["Yes"]);

        let usage = ClientMsg::Usage {
            term: 3,
            token: "00ff".into(),
            usage: Usage {
                context: Some(30.0),
                cost: Some(1.5),
                tokens: Some(900),
                tokens_in: Some(600),
                tokens_out: Some(300),
            },
            limits: vec![Limit {
                name: "5h".into(),
                used: 23.0,
                resets_at: 100,
            }],
        };
        let read: reports_at_oldest::ClientMsg =
            decode(&encode(&usage).unwrap()).expect("the oldest daemon reads today's usage report");
        let reports_at_oldest::ClientMsg::Usage {
            term,
            token,
            usage,
            limits,
        } = read
        else {
            panic!("expected a usage report")
        };
        assert_eq!((term, token.as_str()), (3, "00ff"));
        assert_eq!((usage.context, usage.cost), (Some(30.0), Some(1.5)));
        assert_eq!(
            (usage.tokens, usage.tokens_in, usage.tokens_out),
            (Some(900), Some(600), Some(300))
        );
        assert_eq!(
            (limits[0].name.as_str(), limits[0].used, limits[0].resets_at),
            ("5h", 23.0, 100)
        );
    }

    #[test]
    fn a_hook_report_reads_across_the_background_field() {
        let old = serde_json::json!({ "Hook": {
            "term": 3, "agent": "claude", "status": "Done", "session": null, "cwd": null, "prompt": null,
            "said": null, "subagent": null, "event": "Stop", "pid": 42, "token": "00ff",
            "transcript": null, "model": null, "name": null,
        }});
        let msg: ClientMsg =
            decode(&rmp_serde::to_vec_named(&old).unwrap()).expect("a hook from before the field");
        let ClientMsg::Hook {
            event,
            background,
            background_agents,
            background_reported,
            ask,
            call,
            ..
        } = msg
        else {
            panic!("expected a hook report")
        };
        assert_eq!((event.as_str(), background.len(), ask), ("Stop", 0, None));
        assert!(background_agents.is_empty(), "an older peer names no helpers");
        assert!(!background_reported, "an older peer's empty list is nothing said, not nothing running");
        assert_eq!(call, None, "an older peer sends no call fingerprint");

        #[derive(Deserialize)]
        enum OldClientMsg {
            Hook {
                term: TermId,
                status: HookStatus,
                event: String,
                pid: u32,
                token: String,
            },
        }
        let new = ClientMsg::Hook {
            term: 3,
            agent: "claude".into(),
            status: HookStatus::Done,
            session: None,
            cwd: None,
            prompt: None,
            said: None,
            subagent: None,
            event: "Stop".into(),
            pid: 42,
            token: "00ff".into(),
            transcript: None,
            model: None,
            name: None,
            background: vec!["b1".into()],
            background_agents: vec!["b1".into()],
            background_reported: true,
            ask: None,
            call: None,
        };
        let OldClientMsg::Hook {
            term,
            status,
            event,
            pid,
            token,
        } = decode(&encode(&new).unwrap()).expect("an older daemon reads it");
        assert_eq!(
            (term, status, event.as_str(), pid, token.as_str()),
            (3, HookStatus::Done, "Stop", 42, "00ff")
        );
    }

    #[test]
    fn a_pane_with_the_old_single_check_reads_as_one_checkpoint() {
        let old = pane_from(
            serde_json::json!({ "check": { "command": "npm test", "state": "Failed", "exit_code": 1 } }),
        );
        assert_eq!(
            old.checks
                .iter()
                .map(|c| (c.command.as_str(), c.state))
                .collect::<Vec<_>>(),
            [("npm test", CheckState::Failed)]
        );
        assert!(
            pane_from(serde_json::json!({ "check": null }))
                .checks
                .is_empty()
        );
        assert!(pane_from(serde_json::json!({})).checks.is_empty());
    }

    #[test]
    fn the_headline_is_the_worst_checkpoint_and_the_first_on_ties() {
        use CheckState::*;
        let order = [
            Failed,
            CouldNotRun,
            NeedsApproval,
            Checking,
            Pending,
            Stale,
            Never,
            Overridden,
            Passed,
        ];
        let at = |state: CheckState, name: &str| CheckInfo {
            state,
            name: name.into(),
            ..Default::default()
        };
        for (i, &worse) in order.iter().enumerate() {
            for &better in &order[i + 1..] {
                for checks in [
                    vec![at(worse, "a"), at(better, "b")],
                    vec![at(better, "b"), at(worse, "a")],
                ] {
                    assert_eq!(
                        headline(&checks).map(|c| c.state),
                        Some(worse),
                        "{worse:?} over {better:?}"
                    );
                }
            }
            let tie = [at(worse, "first"), at(worse, "second")];
            assert_eq!(
                headline(&tie).map(|c| c.name.as_str()),
                Some("first"),
                "{worse:?} tie"
            );
        }
        assert_eq!(headline(&[]), None);
    }

    #[test]
    fn the_headline_is_not_reported_while_the_agent_works_or_asks() {
        let mut term = pane_from(serde_json::json!({}));
        term.checks = vec![
            CheckInfo {
                state: CheckState::Passed,
                ..Default::default()
            },
            CheckInfo {
                state: CheckState::Failed,
                name: "test".into(),
                ..Default::default()
            },
        ];
        assert_eq!(term.reported_check().map(|c| c.name.as_str()), Some("test"));
        for status in [Status::Working, Status::Blocked] {
            term.status = status;
            assert_eq!(term.reported_check(), None, "{status:?}");
        }
    }

    #[test]
    fn new_check_states_have_their_script_labels() {
        let got = [
            CheckState::Pending,
            CheckState::NeedsApproval,
            CheckState::Stale,
            CheckState::Never,
        ]
        .map(CheckState::label);
        assert_eq!(got, ["pending", "needs_approval", "stale", "never"]);
    }

    /// An older daemon's listing has no `can_create` and reads as one that cannot, so a window
    /// asks only a daemon whose listing says it can; a new listing still reads to an old window.
    #[test]
    fn a_folder_listing_from_an_older_daemon_reads_as_one_that_cannot_create() {
        #[derive(Debug, Deserialize)]
        #[allow(dead_code)]
        struct OldListing {
            path: String,
            exists: bool,
            entries: Vec<FolderEntry>,
            truncated: bool,
        }
        #[derive(Serialize)]
        struct Listing {
            path: String,
            exists: bool,
            entries: Vec<FolderEntry>,
            truncated: bool,
        }
        let old = encode(&Listing { path: "/a".into(), exists: true, entries: Vec::new(), truncated: false }).unwrap();
        assert!(!decode::<FolderListing>(&old).unwrap().can_create);
        let new = encode(&FolderListing { can_create: true, ..FolderListing::missing("/a") }).unwrap();
        assert!(decode::<OldListing>(&new).is_ok());
    }

    /// A closed session from a peer that records no worktree still reads, with neither set.
    #[test]
    fn a_closed_session_without_its_worktree_still_reads() {
        #[derive(Serialize)]
        struct OldClosedSession {
            agent: String,
            session: String,
            cwd: PathBuf,
            branch: Option<String>,
            title: Option<String>,
            at: u64,
        }
        let old = OldClosedSession {
            agent: "codex".into(),
            session: "abc".into(),
            cwd: PathBuf::from("/code/api"),
            branch: Some("feat".into()),
            title: None,
            at: 3,
        };
        let read: ClosedSession = decode(&encode(&old).unwrap()).unwrap();
        assert_eq!((read.worktree, read.repo), (None, None));
        assert_eq!(read.branch.as_deref(), Some("feat"));
    }

    /// Version 121 added a provider. A list of conversations is sent to every client, so a peer
    /// from before it would fail on the first ACP conversation: the window moved, and such a
    /// peer is refused instead.
    #[test]
    fn a_peer_from_before_acp_is_refused_because_it_cannot_read_an_acp_conversation() {
        use crate::conversation::{Provider, StartTarget};
        #[derive(Debug, Deserialize)]
        #[allow(dead_code)]
        enum OldProvider {
            Codex,
            Claude,
            Gemini,
        }
        #[derive(Debug, Deserialize)]
        #[allow(dead_code)]
        enum OldStartTarget {
            Create(serde_json::Value),
            Session { settings: serde_json::Value, thread_id: String },
            Conversation { id: u64, generation: u64 },
        }
        let acp = rmp_serde::to_vec_named(&Provider::Acp).unwrap();
        let start = rmp_serde::to_vec_named(&StartTarget::Acp { agent: "gemini".into(), cwd: "/code".into() }).unwrap();

        assert!(decode::<OldProvider>(&acp).is_err());
        assert!(decode::<OldStartTarget>(&start).is_err());
        assert!(!speaks_with(120, 115), "a peer from before the provider");
        assert!(!speaks_with(119, 0));
    }

    /// Version 122 added a start that names no program (`StartTarget::Agent`). A daemon from
    /// before it cannot decode the request, so the window moved and such a peer is refused.
    #[test]
    fn a_peer_from_before_the_daemon_found_start_is_refused_because_it_cannot_read_one() {
        use crate::conversation::{ApprovalPolicy, Provider, Sandbox, StartTarget};
        #[derive(Debug, Deserialize)]
        #[allow(dead_code)]
        enum OldStartTarget {
            Create(serde_json::Value),
            Session { settings: serde_json::Value, thread_id: String },
            Conversation { id: u64, generation: u64 },
            Acp { agent: String, cwd: std::path::PathBuf },
        }
        let target = StartTarget::Agent {
            provider: Provider::Claude,
            cwd: "/code".into(),
            sandbox: Sandbox::WorkspaceWrite,
            approval_policy: ApprovalPolicy::OnRequest,
        };
        let start = rmp_serde::to_vec_named(&target).unwrap();

        assert!(decode::<OldStartTarget>(&start).is_err());
        assert_eq!(decode::<StartTarget>(&start).unwrap(), target);
        assert_eq!(COMPATIBLE_SINCE, 122);
        assert!(!speaks_with(121, 121), "a peer from before the daemon-found start");
        assert!(speaks_with(122, 122));
    }

    #[test]
    fn an_acp_conversation_names_its_agent_and_every_other_summary_is_as_it_was() {
        use crate::conversation::Provider;
        let old = serde_json::json!({
            "id": 7, "generation": 3, "provider": "Codex", "cwd": "/code", "worktree": null,
            "state": "Running", "status": "Idle", "native_term": null, "checks": []
        });
        let codex: ConversationSummary = serde_json::from_value(old.clone()).unwrap();
        let mut acp = codex.clone();
        acp.provider = Provider::Acp;
        acp.agent = Some("gemini".into());

        let written = serde_json::to_value(&acp).unwrap();
        let read: ConversationSummary = decode(&encode(&acp).unwrap()).unwrap();

        assert!(serde_json::to_value(&codex).unwrap().get("agent").is_none());
        assert_eq!((&written["provider"], &written["agent"]), (&serde_json::json!("Acp"), &serde_json::json!("gemini")));
        assert_eq!((read.provider, read.agent.as_deref()), (Provider::Acp, Some("gemini")));
        assert_eq!((codex.agent_label(), acp.agent_label()), ("Codex".to_owned(), "gemini".to_owned()));
    }

    /// The shapes version 118 wrote for what 119 still reads, as a peer of that version encodes them.
    #[test]
    fn what_118_sent_about_clones_and_sign_in_still_decodes() {
        let sent = |value: serde_json::Value| rmp_serde::to_vec_named(&value).unwrap();
        let ask: ClientMsg = decode(&sent(serde_json::json!({"Query": {"CloneRepo": {"address": "https://h/o/r.git", "parent": "~", "tag": 3}}}))).unwrap();
        assert!(matches!(ask, ClientMsg::Query(Query::CloneRepo { tag: 3, .. })));
        let sign_in: ClientMsg = decode(&sent(serde_json::json!({"Query": {"AgentSignIn": {"agent": "codex", "request": "cancel", "tag": 4}}}))).unwrap();
        assert!(matches!(sign_in, ClientMsg::Query(Query::AgentSignIn { agent: super::SignInAgent::Codex, request: super::SignInRequest::Cancel, tag: 4 })));
        let answer: ServerMsg = decode(&sent(serde_json::json!({"Reply": {"Cloned": {"tag": 3, "outcome": {"Ok": "/home/me/r"}}}}))).unwrap();
        assert!(matches!(answer, ServerMsg::Reply(Reply::Cloned { tag: 3, outcome: Ok(_) })));
        let state: ServerMsg = decode(&sent(serde_json::json!({"Reply": {"AgentSignIn": {"tag": 4, "agent": "claude", "state": {"Waiting": {"link": null, "code": "A-1"}}}}}))).unwrap();
        assert!(matches!(state, ServerMsg::Reply(Reply::AgentSignIn { agent: super::SignInAgent::Claude, .. })));
    }
}
