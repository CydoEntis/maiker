import type { Check } from '@/features/inspect/checks'
import type { PullRequest } from '@/features/workspace/model/pullRequest'
export type SessionStatus = 'working' | 'needs-you' | 'done' | 'idle' | 'recovery' | 'unknown'

/** `Unknown` is a value a newer service sent that this app does not know. */
export type TurnKind = 'Working' | 'NeedsYou' | 'Done' | 'Idle' | 'Prompt' | 'CommandStarted' | 'CommandFinished' | 'Unknown'

/** The question a permission prompt asks, from the agent's own hook. */
export type PermissionAsk = { tool: string; detail: string; answerable: boolean; choices?: readonly string[]; /** A prompt that asks several questions at once, each with one answer, in the order the agent shows them. */ questions?: readonly AskedQuestion[]; /** A prompt with a question that takes several answers: every question it asks, in order. */ form?: readonly AskedQuestion[] }
/** One question of a prompt; `multi` when it takes any number of its choices. */
export type AskedQuestion = { question: string; choices: readonly string[]; multi?: boolean }

/** What the daemon reports about a terminal session beyond its status. */
export type TerminalDetails = {
  /** What a stopped agent is asking, off its screen: the exact command and its choices. */
  asking: string
  /** The permission prompt the agent's hook says it is stopped on; null when it said none. */
  ask?: PermissionAsk | null
  /** An agent that was mid-turn when the daemon restarted; offered a resume, never resumed on its own. */
  interrupted: { agent: string; resume: string } | null
  /** A chat a service restart cut mid-reply that nobody has taken up since (`ConversationSummary.interrupted`); absent for a terminal. */
  chatCutOff?: boolean
  /** The agent's own conversation id, for resuming it elsewhere; null when the daemon did not say. */
  agentSession?: string | null
  /** The agent's own hooks have reported in: without them the daemon has no session or transcript to follow, so no chat. */
  hooked?: boolean
  /** Why the agent's hooks never report, from the daemon's own look at its settings file; null or absent when it found nothing. */
  hookProblem?: { file: string; why: string; repaired: boolean } | null
  /** The effort the agent's own files say it runs at; null when they do not say. */
  agentEffort?: string | null
  /** The model its agent answers with, short (the daemon's `TermInfo.model`); empty or absent when it has not said. */
  agentModel?: string
  /** When the status last changed, in unix seconds (the daemon's `TermInfo.since`); absent or 0 when it did not say. */
  since?: number
  /** What set the status, in the daemon's own words (`TermInfo.status_why`: `hook: Stop`); absent or empty when it gave no reason. */
  statusWhy?: string
  /** It hit its plan limit, and the daemon tells it to continue at this time, in unix seconds (`TermInfo.resume_at`); null or absent when it is not held. */
  resumeAt?: number | null
  /** Snoozed until this time, in unix seconds (`TermInfo.snoozed_until`); null or absent when it is awake. */
  snoozedUntil?: number | null
  /** The latest turn events, oldest first; `at` is unix seconds. */
  timeline: Array<{ at: number; kind: TurnKind; detail: string }>
  /** The last command ended in failure, as the shell reported it (a non-zero exit code); null when nothing failed. Only the daemon sets it. */
  exit?: { code: number | null; at: number } | null
  /** What the provider reports the session has used; each is null when it did not say. */
  usage: { context: number | null; cost: number | null; tokens: number | null }
  /** The plan limits of the session's agent, as it last reported them (`5h`, `week`); absent from an older daemon. */
  limits?: Array<{ name: string; used: number; resetsAt: number }>
  /** Secrets the session's agent is waiting for the person to give. */
  secretAsk?: Array<{ id: number; label: string; reason: string }>
  /** The pane's checks, as the daemon reports them; absent from an older daemon. */
  checks?: Check[]
  /** The pull request of the pane's branch, as the daemon polls it; null or absent when it has none. */
  pr?: PullRequest | null
  /** The follow-ups the pane's daemon holds for its working agent, oldest first. */
  queued?: string[]
  /** The agent's own turn is over: it takes a message, though helpers it started may keep the pane working. */
  ownTurnOver?: boolean
  /** The daemon holds this helper's start until its starter has a free slot, and reports it working meanwhile; absent from an older daemon. */
  waitingForSlot?: boolean
  /** The helpers the session asked to start and waits on the person for, one task each; absent from an older daemon. */
  helperAsk?: string[]
  /** The session whose agent started this one, by its id in this window; null or absent when a person did. */
  startedBy?: string | null
  /** The agent's subagents as its runtime reports them; absent from an older daemon. */
  subagents?: SubagentActivity[]
}

/** The runtime's states for a subagent (`SubagentState` in the protocol). */
/** `Unknown` is a state a newer service sent that this app does not know. */
export type SubagentState = 'Starting' | 'Working' | 'WaitingForInput' | 'AwaitingApproval' | 'Completed' | 'Failed' | 'Cancelled' | 'ConnectionLost' | 'Unknown'

/** One subagent of a session, as the daemon reports it. Times are unix seconds. */
export type SubagentActivity = {
  id: string
  name: string
  state: SubagentState
  /** What it was asked to do. */
  task: string | null
  startedAt: number | null
  updatedAt: number
  /** The runtime's last word on what it is doing. */
  latest: string | null
  /** Its report, once it finished. */
  result: string | null
}

export type Conversation = {
  id: string
  /** A terminal session's current folder, as its shell reports it. */
  cwd?: string
  /** The git repository's name when the folder is inside one. */
  repo?: string | null
  generation?: number
  execution?: 'Native' | 'Structured'
  title: string
  project: string
  folder: string
  branch: string
  provider: 'Codex' | 'Claude'
  status: SessionStatus
  lastKnownStatus?: Exclude<SessionStatus, 'unknown'>
  updated: string | null
  model: string
  permission: string
  context: number | null
  nativePane: number | null
  /** The number the host gave the machine this session lives on; absent for this computer. */
  machine?: number
  /** The machine's name; absent for this computer. */
  machineName?: string
  hasDiff: boolean
  /** Lines added and removed in the session's checkout against HEAD, from the daemon; absent when unknown. */
  /** The terminal runs in a linked worktree. */
  linked?: boolean
  /** The top folder of the checkout (main or a linked worktree) it works in; absent or null when the daemon did not say. */
  checkout?: string | null
  diffAdded?: number
  diffRemoved?: number
  isGitRepository?: boolean
  // Put away in any client; the daemon keeps it running.
  archived?: boolean
  // Pinned to the top of its project; the daemon keeps it for every app.
  pinned?: boolean
  // Someone gave it a name (the daemon has one), as opposed to the automatic wording.
  named?: boolean
  // A terminal session: an agent running in a terminal the daemon owns, shared with the terminal
  // app. Anything else is a chat. `nativePane` is its terminal's number.
  kind?: 'terminal'
  /** The agent the daemon reports running in a terminal session; null for a plain shell. */
  agent?: string | null
  /** The program the daemon sees running in a terminal session (a shell's own name when idle). */
  process?: string
  /** The last prompt the agent in a terminal session was given, as one line; empty when unknown. */
  summary?: string
  details?: TerminalDetails
  /**
   * The daemon conversation that carries this terminal session's structured events, when it holds
   * one (a conversation whose native terminal is this pane). The chat view reads and writes
   * through it; without it the session has no chat.
   */
  chat?: { conversation: number; generation: number; /** The agent runs over ACP (ADR 0020): its model and permissions are its own settings. */ acp?: boolean; /** Follows an agent the user started in the terminal (ADR 0003): the chat reads, it does not write. */ readOnly?: boolean; /** The daemon says the agent takes a message into a running turn; absent when it did not say. */ steers?: boolean; /** Its agent is not up yet: a service restart left it asleep until it is opened, or it is starting again on its own session. */ waking?: boolean; /** The agent's own conversation id, which its resume takes; absent until its daemon says (`ConversationSummary.session`). */ session?: string }
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'activity' | 'approval'
  content: string
  time: string
  detail?: string
  activityState?: 'Running' | 'Completed' | 'Failed' | 'Interrupted'
  resolved?: boolean
  providerRequestId?: number | string
  approvalReason?: string
  approvalKind?: 'Command' | 'FileChange' | 'Permission' | 'UserInput'
  approvalScope?: string
  approvalChanges?: Array<{ path: string; kind: string; diff: string }>
  approvalPermissions?: Record<string, unknown>
  userQuestions?: UserInputQuestion[]
  approvalChoices?: Array<'Accept' | 'AcceptForSession' | 'Decline' | 'Cancel'>
}

export type UserInputQuestion = {
  id: string
  header: string
  question: string
  is_other: boolean
  is_secret: boolean
  options: Array<{ label: string; description: string }>
}

export const previewConversations: Conversation[] = [
  {
    id: 'codex-43',
    title: 'Tighten the branch view navigation',
    project: 'maiker',
    folder: 'C:/dev/maiker',
    branch: 'gui/branch-view-navigation',
    provider: 'Codex',
    status: 'needs-you',
    updated: 'now',
    model: 'GPT-5 Codex',
    permission: 'Workspace write · approvals on request',
    context: 38,
    nativePane: 43,
    hasDiff: true,
  },
  {
    id: 'codex-41',
    title: 'Add a conversation reconnect test',
    project: 'maiker',
    folder: 'C:/dev/maiker',
    branch: 'feat/reconnect-proof',
    provider: 'Codex',
    status: 'working',
    updated: '2m',
    model: 'GPT-5 Codex',
    permission: 'Read only · approvals on request',
    context: 61,
    nativePane: 41,
    hasDiff: true,
  },
  {
    id: 'claude-18',
    title: 'Review the daemon restore flow',
    project: 'maiker',
    folder: 'C:/dev/maiker',
    branch: 'main',
    provider: 'Claude',
    status: 'done',
    updated: '14m',
    model: 'Claude Sonnet',
    permission: 'Workspace write · approvals on request',
    context: 47,
    nativePane: 18,
    hasDiff: false,
  },
  {
    id: 'codex-12',
    title: 'Check Windows named pipe errors',
    project: 'maiker',
    folder: 'C:/dev/maiker',
    branch: 'fix/named-pipe-errors',
    provider: 'Codex',
    status: 'idle',
    updated: '1h',
    model: 'GPT-5 Codex',
    permission: 'Read only · approvals off',
    context: 23,
    nativePane: 12,
    hasDiff: true,
  },
  {
    id: 'claude-07',
    title: 'Polish empty state wording',
    project: 'website',
    folder: 'C:/dev/website',
    branch: 'copy/empty-state',
    provider: 'Claude',
    status: 'idle',
    updated: 'yesterday',
    model: 'Claude Sonnet',
    permission: 'Read only · approvals off',
    context: 12,
    nativePane: 7,
    hasDiff: false,
  },
]
