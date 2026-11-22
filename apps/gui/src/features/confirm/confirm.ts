/**
 * The app's one confirm: what each kind asks, and which kinds the person said not to ask about again. Only what is
 * destructive or surprising has a kind here (DESIGN › *Design language*); nothing else in the app confirms.
 */

/** What the dialog shows: a title, one line of body, an optional quieter line under it, and the primary button. */
export type ConfirmCopy = {
  title: string
  body: string
  note?: string
  confirmLabel: string
  /** The primary button is drawn as a danger button: the action stops or removes something. */
  danger: boolean
}

/** One session about to be closed, as its row names it. */
export type ClosingSession = {
  name: string
  /** The agent as a person writes it ("Claude"). */
  agent: string
  /** What closing interrupts: a turn in progress, a question it waits on, or nothing. */
  state: 'working' | 'needs' | 'quiet'
  branch: string | null
  /** The linked worktree it runs in, by its folder name; null in the main checkout or outside git. */
  worktree: string | null
}

/** What a close asks about: one session, or how many when several close together. */
export type ClosingSessions = ClosingSession | { count: number }

/** A project about to be closed: what its heading calls it, and the sessions still running in it, as their rows name them. */
export type ClosingProject = { name: string; running: readonly string[] }

/** How many running sessions a project's close names before it counts the rest. */
const NAMED_RUNNING = 3

function listed(names: readonly string[]): string {
  const named = names.slice(0, NAMED_RUNNING)
  const rest = names.length - named.length
  if (rest > 0) return `${named.join(', ')} and ${String(rest)} more`
  return named.length <= 1 ? named.join('') : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`
}

function closingProjectCopy({ name, running }: ClosingProject): ConfirmCopy {
  const body = running.length === 0
    ? 'It leaves the sidebar.'
    : `${listed(running)} ${running.length === 1 ? 'stops' : 'stop'}, and the project leaves the sidebar.`
  return { title: `Close ${name}?`, body, note: 'The folder and its git history stay on disk, and you can open it again any time.', confirmLabel: 'Close project', danger: true }
}

/** A plain shell, or the shells of one terminal tab, about to be closed. */
export type ClosingTerminal = { name: string }

/** A file whose uncommitted changes are about to be discarded. What is lost depends on how it changed. */
export type DiscardingFile = {
  /** The file's path in its project, with `/`. */
  path: string
  /** `new`: no commit has it, so discarding deletes it. `deleted`: discarding brings it back. */
  change: 'edited' | 'deleted' | 'new'
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

function discardingCopy({ path, change }: DiscardingFile): ConfirmCopy {
  const title = `Discard changes to “${nameOf(path)}”?`
  if (change === 'deleted') return { title, body: `${path} was deleted. Discarding brings it back as it was at the last commit.`, confirmLabel: 'Discard changes', danger: true }
  return { title, body: `${path} goes back to how it was at the last commit.`, note: 'Your changes to it since then are lost and cannot be brought back.', confirmLabel: 'Discard changes', danger: true }
}

type View = 'chat' | 'terminal'

const VIEW_NAME: Readonly<Record<View, string>> = { chat: 'Chat', terminal: 'Terminal' }

function closingSessionCopy(closing: ClosingSessions): ConfirmCopy {
  if ('count' in closing) {
    return { title: `Close ${String(closing.count)} sessions?`, body: 'Closing stops any agent that is still working. The sessions leave the sidebar.', note: 'Their branches and any changes stay on disk.', confirmLabel: 'Close sessions', danger: true }
  }
  const interrupts = closing.state === 'working'
    ? `${closing.agent} is still working. Closing stops it mid-turn. `
    : closing.state === 'needs' ? `${closing.agent} is waiting for your answer. Closing stops it. ` : ''
  return { title: `Close “${closing.name}”?`, body: `${interrupts}The session leaves the sidebar.`, note: keptOnDisk(closing), confirmLabel: 'Close session', danger: true }
}

function keptOnDisk({ branch, worktree }: ClosingSession): string {
  if (branch === null) return 'Its files stay on disk.'
  return worktree === null
    ? `Its branch ${branch} and any changes stay on disk.`
    : `Its worktree ${worktree} and branch ${branch} stay on disk, so nothing is lost.`
}

/**
 * Every kind of confirm, with what it says. A new kind is one entry here: its key is what "Don't ask again" is
 * remembered under, and the function's parameter is what the caller has to say about the thing in question.
 */
const CONFIRMS = {
  'close-session': closingSessionCopy,
  'close-terminal': ({ name }: ClosingTerminal): ConfirmCopy => ({ title: `Close ${name}?`, body: 'Anything still running in this terminal stops.', confirmLabel: 'Close terminal', danger: true }),
  'switch-view': (view: View): ConfirmCopy => ({
    title: `Open new sessions in ${VIEW_NAME[view]}?`,
    body: `Going forward, every new session opens in ${VIEW_NAME[view]} view. Sessions that are already open stay as they are.`,
    note: 'You can change this any time in Settings › Appearance.',
    confirmLabel: `Switch to ${VIEW_NAME[view]}`,
    danger: false,
  }),
  'close-project': closingProjectCopy,
  'discard-file': discardingCopy,
  'delete-new-file': (path: string): ConfirmCopy => ({ title: `Delete “${nameOf(path)}”?`, body: `${path} is a new file that was never committed, so discarding it deletes it for good.`, note: 'It cannot be brought back.', confirmLabel: 'Delete file', danger: true }),
}

export type ConfirmKind = keyof typeof CONFIRMS

type Subject = { [K in ConfirmKind]: Parameters<(typeof CONFIRMS)[K]>[0] }

const COPY: { readonly [K in ConfirmKind]: (subject: Subject[K]) => ConfirmCopy } = CONFIRMS

export const CONFIRM_KINDS = Object.keys(CONFIRMS) as readonly ConfirmKind[]

/** The kinds that ask every time: what they do cannot be brought back by any means, so no earlier answer stands in for this one. */
const ALWAYS_ASKED: ReadonlySet<ConfirmKind> = new Set<ConfirmKind>(['delete-new-file'])

/** Whether `kind` offers "Don't ask again". */
export function canSkip(kind: ConfirmKind): boolean {
  return !ALWAYS_ASKED.has(kind)
}

/** A question ready to ask: its kind and the words for this one thing. */
export type ConfirmAsk = ConfirmCopy & { kind: ConfirmKind }

export function confirmAsk<K extends ConfirmKind>(kind: K, subject: Subject[K]): ConfirmAsk {
  return { kind, ...COPY[kind](subject) }
}

/** The question before a file's changes are discarded. Discarding a new file deletes it, which is a question of its own that is asked every time. */
export function discardAsk(file: DiscardingFile): ConfirmAsk {
  return file.change === 'new' ? confirmAsk('delete-new-file', file.path) : confirmAsk('discard-file', file)
}

/** The kinds the person ticked "Don't ask again" for. Saved with the settings. */
export type SkippedConfirms = readonly ConfirmKind[]

/** Whether `kind` still asks before its action runs. */
export function asksFirst(skipped: SkippedConfirms, kind: ConfirmKind): boolean {
  return !canSkip(kind) || !skipped.includes(kind)
}

/** `skipped` with `kind` added: from now on its action runs straight away. */
export function withSkipped(skipped: SkippedConfirms, kind: ConfirmKind): SkippedConfirms {
  return skipped.includes(kind) || !canSkip(kind) ? skipped : [...skipped, kind]
}

/** The skipped kinds in a stored value, leaving out anything that is not a kind now; null when it is not a list. */
export function skippedConfirmsOf(value: unknown): ConfirmKind[] | null {
  if (!Array.isArray(value)) return null
  return CONFIRM_KINDS.filter((kind) => canSkip(kind) && value.includes(kind))
}
