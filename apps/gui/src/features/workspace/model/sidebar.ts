import { isChatSession } from './chatSession'
import { markOf, type StatusMarkKind } from '@/lib/statusMark'
import { displayName, folderNameOf, inCreationOrder, limitedWord, SHELL_PROCESS, untilWord, type SessionView, STATUS_WORD } from './session'

/**
 * The most urgent first, by the state each is shown as (`markOf`): what needs you, what is working, what finished, then
 * what is idle, which is where a stopped, limited or unreachable session is. Within a rank the sessions keep their
 * creation order, so a row only moves when its state changes.
 */
const URGENCY: Record<StatusMarkKind, number> = { needs: 0, working: 1, done: 2, idle: 3 }

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
 * The words at the right of a row: what happened to a session that is shown as idle though the daemon says more (a stopped
 * agent, an exited shell, one held by its plan limit, one out of reach). Activity text, never a state of its own.
 */
export function rowWord(session: SessionView, now: number = Date.now()): string {
  if (session.snoozedUntil !== null) return untilWord(session.snoozedUntil, now)
  if (session.status === 'limited') return limitedWord(session.resumeAt, now)
  // Its machine or the daemon is out of reach, or the list just missed it: the last status is not known to be true.
  if (session.status === 'unknown') return STATUS_WORD.unknown
  if (session.status !== 'error') return ''
  // A shell that ended did not stop on a failure, so it says it exited.
  return isShell(session) ? 'exited' : STATUS_WORD.error
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

/**
 * A terminal: a session with no agent in it (a shell, or a program running in one, such as `pnpm dev`). One that needs
 * you counts as an agent here, because what needs you is never folded out of sight.
 */
export function isTerminal(session: Pick<SessionView, 'conversation' | 'status'>): boolean {
  return !session.conversation.agent && session.status !== 'needs'
}

export type StatusSectionKey = StatusMarkKind

/** The status sections in the order they are listed, each with the few words that say what it means. */
const STATUS_SECTIONS: ReadonlyArray<{ key: StatusSectionKey; name: string; hint: string }> = [
  { key: 'needs', name: 'Needs you', hint: 'waiting on you' },
  { key: 'working', name: 'Working', hint: 'running now' },
  { key: 'done', name: 'Done', hint: 'ready to review' },
  { key: 'idle', name: 'Idle', hint: 'nothing to do' },
]

/** The section a session is listed in: the state it is shown as (`markOf`), so only a question the person can answer is under Needs you. */
export function sectionOf(session: Pick<SessionView, 'status'>): StatusSectionKey {
  return markOf(session.status)
}

export type StatusSection = { key: StatusSectionKey; name: string; hint: string; sessions: SessionView[] }

/** A session kept in the section it was in when it was picked, whatever its status says since. */
export type HeldRow = { readonly id: string; readonly section: StatusSectionKey }

/** The two sections a row moves between when the person looks at it: a finished agent turns idle. */
const stays = (section: StatusSectionKey): boolean => section === 'done' || section === 'idle'

/**
 * The sessions under the status each has, the latest change first within a section (`byLatestChange`); a section with nothing in it is left out. The `held` row stays where it was picked: looking at a finished agent makes it
 * idle, and a row that jumps away from under the pointer the moment it is clicked reads as the app fighting you. Its
 * mark still shows its status. Only that shift between finished and idle is held: a row that starts working, or asks, goes
 * to its own section at once, or an agent at work would be listed as idle until the person looked away.
 */
export function statusSections(sessions: readonly SessionView[], held: HeldRow | null = null): StatusSection[] {
  const ordered = byLatestChange(sessions)
  const placed = (session: SessionView): StatusSectionKey => {
    const actual = sectionOf(session)
    return session.id === held?.id && stays(held.section) && stays(actual) ? held.section : actual
  }
  return STATUS_SECTIONS
    .map((section) => ({ ...section, sessions: ordered.filter((session) => placed(session) === section.key) }))
    .filter((section) => section.sessions.length > 0)
}

/**
 * Put away (`TermInfo.archived`) and listed only under Put away. It keeps running, and while Needs you would list it
 * (an agent or a terminal that asks) it is listed there instead, so
 * nothing that waits on you is folded out of sight. The daemon's flag stays set: once it no longer needs you it goes
 * back under Put away, where the person left it. Only Bring back clears it.
 */
function isPutAway(session: SessionView): boolean {
  return (session.archived || session.snoozedUntil !== null) && (isTerminal(session) || sectionOf(session) !== 'needs')
}

/** The sessions the sections list, and the ones put away (as created), which only the Put away section lists. */
export function splitPutAway(sessions: readonly SessionView[]): { listed: SessionView[]; putAway: SessionView[] } {
  return {
    listed: sessions.filter((session) => !isPutAway(session)),
    putAway: inCreationOrder(sessions.filter(isPutAway)),
  }
}

export type ProjectChoice = { name: string; color: string; count: number }

/** Every project that has a session, the busiest first, for the list that narrows the sidebar to one of them. */
export function projectChoices(sessions: readonly SessionView[]): ProjectChoice[] {
  const counts = new Map<string, number>()
  for (const session of sessions) counts.set(projectOf(session), (counts.get(projectOf(session)) ?? 0) + 1)
  return [...counts.entries()]
    .map(([name, count]) => ({ name, color: projectColor(name), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** The sessions of one project, or all of them when none is picked. */
export function inProject(sessions: readonly SessionView[], project: string | null): SessionView[] {
  return project === null ? [...sessions] : sessions.filter((session) => projectOf(session) === project)
}
