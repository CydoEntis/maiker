import { toast } from '@/lib/toast'
import { CHAT_AGENTS, type ChatAgent } from '../model/chatView'
import type { CloseResult, OpenedProject } from '../model/openedProjects'
import { closeRefusalWords, worktreeSourceOf } from '../model/projectActions'
import { offersOpenWorktree } from '../model/projectWorktrees'
import { agentLabel, type SessionView } from '../model/session'
import type { ShortcutAction } from '../model/shortcuts'
import { AppIcon, Icon } from './glyphs'
import type { MenuEntry, MenuItem } from './MenuPopup'

/** One refusal toast at a time: a second refused removal replaces the first instead of stacking. */
const CLOSE_REFUSED_TOAST = 'close-project-refused'

/** The size of a mark before a row of the `+` menu. */
const MARK_PX = 14

/** What the window does for a project heading's menus. */
export type ProjectActions = {
  /** Opens the new-session draft on `machine`, its folder set to the project's, with `agent` picked when one is given. */
  onNewSession: (machine: number, project: OpenedProject, agent?: ChatAgent) => void
  /**
   * Starts a session in a new worktree of the project. With `from`, a session in the project's repository on its machine
   * (`worktreeSourceOf`), the New worktree dialog opens off it; with none, the draft opens with Own worktree on.
   */
  onNewWorktree: (machine: number, project: OpenedProject, from: SessionView | null) => void
  /** Starts a plain terminal in the project's folder; absent in the Chat view, which makes none. */
  onNewTerminal?: ((machine: number, project: OpenedProject) => void) | undefined
  /** Opens the Open worktree dialog: the project's linked worktrees, to start a session in one. `name` is the heading's. */
  onOpenWorktree: (machine: number, project: OpenedProject, name: string) => void
  /** Copies the project's folder. */
  onCopyPath: (project: OpenedProject) => void
  /** Shows a session of the project with the side panel's Files beside it: the files are read through a session. */
  onShowFiles: (sessionId: string) => void
  /**
   * Takes the project off the list once the person confirms, or refuses now while a session runs in it
   * (`useOpenedProjects().close`). `name` is the heading's, for the question.
   */
  onClose: (project: OpenedProject, name: string) => CloseResult
}

/** The project a heading stands for, and what decides which of its actions can run. */
export type ProjectTarget = {
  machine: number
  /** What the machine is called (`machineTitle`), for the menu's own line. */
  machineLabel: string
  remote: boolean
  project: OpenedProject
  /** What the heading calls it (`projectName`). */
  name: string
  /** Every session placed in the project (`useOpenedProjects().machines`). */
  sessions: readonly SessionView[]
  /** A session can be started on the project's machine now. */
  canStart: boolean
  online: boolean
  /** The agent programs on this computer; null while that is unknown. Nothing is known of another machine's. */
  installed: readonly string[] | null
}

/** The key the binding table gives an action on this platform, '' when it has none. */
type KeysOf = (action: ShortcutAction) => string

const withKeys = (item: MenuItem, keys: string): MenuItem => (keys === '' ? item : { ...item, hint: keys })

/**
 * The agents a session can start with, each numbered while it is installed (its number picks it while the menu is open)
 * and marked `not installed` otherwise. Another machine's agents are not known here, so all of them are offered there.
 */
function agentRows(actions: ProjectActions, target: ProjectTarget): MenuItem[] {
  let number = 0
  return CHAT_AGENTS.map((agent): MenuItem => {
    const label = agentLabel(agent)
    const here = target.remote || target.installed === null || target.installed.includes(agent)
    if (!here) return { label, icon: <AppIcon process={agent} size={MARK_PX} dimmed />, hint: 'not installed', disabled: true, why: `${label} is not installed on this computer` }
    number += 1
    const key = String(number)
    return { label, icon: <AppIcon process={agent} size={MARK_PX} />, hint: key, pick: key, disabled: !target.canStart, run: () => { actions.onNewSession(target.machine, target.project, agent) } }
  })
}

/** New worktree… and Open worktree…, where the project may be a git repository; none for a plain folder. */
function worktreeRows(actions: ProjectActions, target: ProjectTarget, keys: KeysOf): { create: MenuItem; open: MenuItem } | null {
  // A project with no session may be a git repository, and one with sessions is when one of them is in git.
  if (!offersOpenWorktree(target.project, target.sessions)) return null
  const from = worktreeSourceOf(target.sessions)
  return {
    create: withKeys({ label: 'New worktree…', disabled: from === null ? !target.canStart : !target.online, run: () => { actions.onNewWorktree(target.machine, target.project, from) } }, keys('new-worktree')),
    open: { label: 'Open worktree…', disabled: !target.online, run: () => { actions.onOpenWorktree(target.machine, target.project, target.name) } },
  }
}

/** A project's `+` menu: where it acts, then the agents, a terminal and the worktrees. */
export function projectPlusMenu(actions: ProjectActions, target: ProjectTarget, keys: KeysOf): { context: string; items: MenuEntry[] } {
  const { onNewTerminal } = actions
  const worktrees = worktreeRows(actions, target, keys)
  return {
    context: `In ${target.name} · ${target.machineLabel}`,
    items: [
      { heading: 'New session' },
      ...agentRows(actions, target),
      ...(onNewTerminal === undefined ? [] : [withKeys({ label: 'Terminal', icon: <Icon name="terminal" size={MARK_PX} />, disabled: !target.canStart, run: () => { onNewTerminal(target.machine, target.project) } }, keys('new-terminal'))]),
      ...(worktrees === null ? [] : ['separator' as const, { ...worktrees.create, icon: <Icon name="branch" size={MARK_PX} stroke="currentColor" /> }, { ...worktrees.open, icon: <Icon name="worktree" size={MARK_PX} /> }]),
    ],
  }
}

/** A project heading's right-click menu: what starts in it, what shows it, then taking it off the sidebar. */
export function projectContextMenu(actions: ProjectActions, target: ProjectTarget, keys: KeysOf): MenuEntry[] {
  const worktrees = worktreeRows(actions, target, keys)
  const shown = target.sessions[0]
  return [
    { heading: target.remote ? `${target.name} · ${target.machineLabel}` : target.name },
    withKeys({ label: 'New session', disabled: !target.canStart, run: () => { actions.onNewSession(target.machine, target.project) } }, keys('new-session')),
    ...(worktrees === null ? [] : [worktrees.create]),
    'separator',
    { label: 'Copy path', run: () => { actions.onCopyPath(target.project) } },
    { label: 'Show files', disabled: shown === undefined, why: 'Start a session here first: the files are read through one', run: () => { if (shown !== undefined) actions.onShowFiles(shown.id) } },
    'separator',
    { label: 'Remove from sidebar…', danger: true, run: () => { closeOrSayWhy(actions, target) } },
  ]
}

/** Removing never hides a running session: a refusal names the sessions in the way, so the person knows what to close. */
function closeOrSayWhy(actions: ProjectActions, target: ProjectTarget): void {
  const result = actions.onClose(target.project, target.name)
  if (result.ok) return
  const { title, description } = closeRefusalWords(target.name, result.error)
  toast.info(title, { id: CLOSE_REFUSED_TOAST, description })
}
