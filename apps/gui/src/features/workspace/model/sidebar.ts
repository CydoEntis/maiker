import { isChatSession } from './chatSession'
import { markOf, type StatusMarkKind } from '@/lib/statusMark'
import { displayName, folderNameOf, inCreationOrder, limitedWord, SHELL_PROCESS, type SessionView, STATUS_WORD } from './session'

/**
 * The most urgent first, by the state each is shown as (`markOf`): what needs you, what is working, what finished, then
 * what is idle, which is where a stopped, limited or unreachable session is. Within a rank the sessions keep their
 * creation order, so a row only moves when its state changes.
 */
export const URGENCY: Record<StatusMarkKind, number> = { needs: 0, working: 1, done: 2, idle: 3 }

export function byUrgency(sessions: readonly SessionView[]): SessionView[] {
  return inCreationOrder(sessions).sort((a, b) => URGENCY[markOf(a.status)] - URGENCY[markOf(b.status)])
}

/** The project a row names on its second line: the repository's folder, else the folder it is in. */
export function projectOf(session: SessionView): string {
  return session.repoName ?? folderNameOf(session)
}

/** Where a session works: `project / branch`, with `· worktree` when it has a checkout of its own. */
export function placeLine(session: SessionView): string {
  const where = session.branch === null ? projectOf(session) : `${projectOf(session)} / ${session.branch}`
  return session.worktree ? `${where} · worktree` : where
}

/**
 * What a toast about one session says: its name as the sidebar calls it (a shell by its path, which is its name) and, under
 * it, where it works. The second line is left out when it would only say the name again.
 */
export function sessionWords(session: SessionView): { title: string; description?: string } {
  const title = isShell(session) ? displayName(session) : rowTitle(session)
  const place = placeLine(session)
  return place === title ? { title } : { title, description: place }
}

/**
 * The square before a project's name: one of five colours, chosen from its name so a project is
 * always the same colour. They are CSS variables (`--proj-1` to `--proj-5`), never amber or red.
 */
const PROJECT_COLORS = 5
const HASH_SEED = 5381
const HASH_SHIFT = 5

export function projectColor(project: string): string {
  let hash = HASH_SEED
  for (let index = 0; index < project.length; index += 1) hash = ((hash << HASH_SHIFT) + hash + project.charCodeAt(index)) | 0
  return `var(--proj-${String((Math.abs(hash) % PROJECT_COLORS) + 1)})`
}

/**
 * Whether this session has work in it that a closed pane must not take away: it has not ended, and it is an agent,
 * a chat, or a shell with a program running in it. A plain idle shell has none.
 */
export function keepsRunningUnseen(session: SessionView): boolean {
  return !session.ended && !(isShell(session) && !isChatSession(session.conversation))
}

export function isShell(session: Pick<SessionView, 'process'>): boolean {
  return session.process === SHELL_PROCESS
}

/**
 * Whether the Chat view leaves this session out: a plain shell there is the dock under a chat, not a session of its
 * own. A helper an agent started is never left out, whatever is running in it: its starter waits on it, and a helper
 * between its shell opening and its agent being recognised reads as a shell.
 */
export function leftOutOfChatView(session: Pick<SessionView, 'process' | 'startedBy'>): boolean {
  return isShell(session) && session.startedBy === null
}

/** What a row calls an agent session that has no name and has not been sent a message: nothing in it says more. */
export const NEW_SESSION = 'New session'

const LINE_BREAK = /\r?\n/
const firstLine = (text: string): string => text.split(LINE_BREAK, 1)[0]?.trim() ?? ''

/** An agent session with no name, no prompt and nothing happening: its row reads "New session", quietly. */
export function isFreshSession(session: Pick<SessionView, 'name' | 'conversation' | 'lastPrompt' | 'status'>): boolean {
  return session.name === null && Boolean(session.conversation.agent) && session.status === 'idle' && firstLine(session.lastPrompt) === ''
}

/**
 * What a row and a pane header call a session: the name you gave it, else (for an agent) the start of what it was last asked,
 * else "New session" while it has done nothing, else the folder it was made in, which is also a shell's name. Neither the agent
 * nor a program running in a shell (`node`, `vim`) is a name: the agent is the mark beside it, a program comes and goes with each
 * command, and a title that followed either would change under you.
 */
export function rowTitle(session: SessionView): string {
  if (session.name !== null) return session.name
  if (!session.conversation.agent) return folderNameOf(session)
  return firstLine(session.lastPrompt) || (isFreshSession(session) ? NEW_SESSION : folderNameOf(session))
}

/**
 * What happened to a session that is shown as idle though the daemon says more, as the one line its hover card reads:
 * `limited until 14:05`, `stopped (exit code 1)`, `exited`, `offline`. Empty when its status is one of the four states.
 */
export function happenedLine(session: SessionView, now: number = Date.now()): string {
  if (session.status === 'limited') return limitedWord(session.resumeAt, now)
  if (session.status === 'unknown') return STATUS_WORD.unknown
  if (session.status !== 'error') return ''
  if (isShell(session)) return 'exited'
  const code = session.conversation.details?.exit?.code ?? null
  return code === null ? STATUS_WORD.error : `${STATUS_WORD.error} (exit code ${String(code)})`
}

/**
 * The sessions with the one whose state changed last first; one that never reported a change comes after the others,
 * newest first. A row moves only when its state changes, never with the clock.
 */
export function byLatestChange(sessions: readonly SessionView[]): SessionView[] {
  return inCreationOrder(sessions).reverse().sort((a, b) => (b.statusSince ?? 0) - (a.statusSince ?? 0))
}

/** The state a session is listed and counted as (`markOf`), so only a question the person can answer is under needs you. */
export function sectionOf(session: Pick<SessionView, 'status'>): StatusMarkKind {
  return markOf(session.status)
}
