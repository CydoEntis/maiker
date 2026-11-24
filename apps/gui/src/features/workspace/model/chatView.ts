/**
 * Which view the app shows, the terminal or the chat (v18 B.3), and whether a session has a chat to
 * show at all. Pure: the window keeps the choices, this decides what they mean.
 *
 * The chat reads the daemon's structured events (ADR 0006), never the terminal's text. So a session
 * has a chat only when the daemon holds a conversation for it, and only for the agents that speak
 * an event stream or write a transcript the daemon follows: Claude Code, Codex and Gemini CLI. Any
 * other agent, and a plain shell, stay terminal-only.
 */

export type PaneView = 'terminal' | 'chat'
export type ChatAgent = 'claude' | 'codex' | 'gemini'

export const CHAT_AGENTS: readonly ChatAgent[] = ['claude', 'codex', 'gemini']

/** The agents the daemon can also run as a structured chat with no terminal (`startChatSession`); the rest are a terminal session shown as a chat. */
export type StructuredAgent = Exclude<ChatAgent, 'gemini'>

/**
 * The view a session of `agent` shows: what Settings › Open sessions in says for the whole app, except Gemini, which has
 * no chat events to show and so always shows its terminal.
 */
export function openViewFor(agent: ChatAgent, openIn: PaneView): PaneView {
  return agent === 'gemini' ? 'terminal' : openIn
}

/** The daemon conversation that carries a session's structured events. */
export type ChatLink = {
  /** The conversation's key: its number on this computer, or another machine's number kept apart from it (`api/conversationKey.ts`). */
  readonly conversation: number
  readonly generation: number
  /**
   * The conversation follows an agent the user started in the terminal (ADR 0003): the chat shows what
   * it did, but sending, answering and interrupting happen in the terminal.
   */
  readonly readOnly?: boolean
  /** The agent runs over ACP (ADR 0020): its model and permissions are its own settings, so the chat offers no picker for them. */
  readonly acp?: boolean
  /** The machine the agent runs on, so attachments are sent there; absent for this computer. */
  readonly machine?: string | null
  /** The daemon's report that the agent takes a message into a running turn; absent when it made none. */
  readonly steers?: boolean
  /** Its agent is not up yet: asleep since a service restart until it is opened, or starting again on its own session. */
  readonly waking?: boolean
}

export type ChatAvailability =
  /** The daemon holds this session's conversation: the chat can read and send. */
  | { readonly kind: 'ready'; readonly agent: ChatAgent; readonly link: ChatLink }
  /** A Claude, Codex or Gemini session the daemon has no conversation for, so there is no event stream to show. */
  | { readonly kind: 'no-events'; readonly agent: ChatAgent }
  /** An agent without a structured event stream. */
  | { readonly kind: 'unsupported'; readonly agent: string }
  /** A plain shell. */
  | { readonly kind: 'shell' }

export type ChatSource = {
  /** The agent the daemon reports in the session; null for a plain shell. */
  readonly agent: string | null | undefined
  readonly chat: ChatLink | null | undefined
}

export function chatAgentOf(agent: string | null | undefined): ChatAgent | null {
  const name = agent?.trim().toLowerCase()
  return CHAT_AGENTS.find((candidate) => candidate === name) ?? null
}

export function chatAvailability(source: ChatSource): ChatAvailability {
  const agent = chatAgentOf(source.agent)
  if (agent === null) {
    const other = source.agent?.trim()
    return other ? { kind: 'unsupported', agent: other } : { kind: 'shell' }
  }
  return source.chat ? { kind: 'ready', agent, link: source.chat } : { kind: 'no-events', agent }
}

/**
 * The view a pane shows. The whole app is in one view (`openIn`), so an agent session that has, or is about to have, a
 * chat follows it; a shell and an agent the app does not read are terminals whatever the setting says.
 */
export function effectiveView(availability: ChatAvailability, openIn: PaneView): PaneView {
  return availability.kind === 'ready' || availability.kind === 'no-events' ? openViewFor(availability.agent, openIn) : 'terminal'
}

/** The words the empty chat card gives for a session that has no chat. */
export function noChatReason(availability: Exclude<ChatAvailability, { kind: 'ready' }>): string {
  switch (availability.kind) {
    case 'shell':
      return 'Chat view is for agent sessions. Start claude or codex here to use it.'
    case 'unsupported':
      return `Chat view is for agent sessions. ${availability.agent} has no event stream to show, so it stays in the terminal.`
    case 'no-events':
      return `The chat fills in as soon as ${availability.agent} is ready. The terminal works as usual.`
  }
}

/** How long a new session may take to report in before the chat suggests its hooks are the problem. */
export const NO_EVENTS_HINT_AFTER_MS = 10_000

/** Shown once a session has stayed empty past `NO_EVENTS_HINT_AFTER_MS`: the usual cause is hooks from another version. */
export const noEventsHint = (agent: ChatAgent): string => `Still nothing. ${agent} may be waiting for you in the terminal, or its status hooks are not connected or are from another version. Connect them here, run "maiker integrate ${agent}", or switch to the Terminal view in Settings to see its terminal.`

/**
 * Shown once a session has stayed empty past `NO_EVENTS_HINT_AFTER_MS` while its hooks HAVE reported in: Maiker hears
 * from the agent, so the hooks are not the problem, but it has not found the conversation to show yet.
 */
export const noConversationHint = (agent: ChatAgent): string => `${agent} is reporting in, but Maiker has not found its conversation yet, so there is nothing to show here. Its terminal has everything ${agent} has said (the Terminal view, in Settings); the chat takes over once the conversation is found.`

/** The daemon looked at the agent's settings file and knows why its hooks never report: said in plain words, with the file. */
export const hookProblemHint = (agent: ChatAgent, problem: { file: string; why: string; repaired: boolean }): string =>
  problem.repaired
    ? `${agent}'s status hooks were out of date (${problem.file}) and have been fixed, but ${agent} only loads them when it starts. Restart it to get the chat.`
    : `${agent}'s status hooks never reported in, so there is no chat. In ${problem.file}: ${problem.why}.`

/** The folder a settings file is in: the agent's config folder, which is what has to be repaired. */
export const configFolderOf = (file: string): string => file.replace(/[\\/][^\\/]*$/, '')

/** What the empty chat says once it has waited too long, in place of promising that a message is sent when the agent is ready. */
export const stuckChatLine = (agent: ChatAgent): string => `No conversation to show yet. Switch to the Terminal view in Settings to see what ${agent} is doing.`

/** Shown instead when the daemon already knows the agent is stopped for an answer (a trust-this-folder question, a login). */
export const waitingInTerminalHint = (agent: ChatAgent): string => `${agent} is waiting for you in the terminal, for example to trust this folder. Switch to the Terminal view in Settings to answer it; the chat takes over after that.`

/** What a session tells the chat view about itself, from the fields every session view carries. */
export function chatSourceOf(session: { conversation: { agent?: string | null; chat?: ChatLink | undefined } }): ChatSource {
  return { agent: session.conversation.agent, chat: session.conversation.chat }
}
