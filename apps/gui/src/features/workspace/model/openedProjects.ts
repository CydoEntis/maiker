import { inCreationOrder, type SessionView } from './session'

/**
 * A project the person has opened: a folder on one machine. The same folder on two machines is two projects, because
 * each machine has its own checkout. `machineName` is null for this computer, as on `SessionView`.
 */
export type OpenedProject = { readonly machineName: string | null; readonly folder: string }

export type ProjectSessions = { readonly project: OpenedProject; readonly sessions: readonly SessionView[] }

export type MachineProjects = { readonly machineName: string | null; readonly projects: readonly ProjectSessions[] }

export type ProjectGrouping = {
  /** This computer first, then the other machines by name. A machine with no opened project is not listed. */
  readonly machines: readonly MachineProjects[]
  /**
   * The opened projects after adding the ones a session needed. The same array as the one passed in when nothing was
   * added, so a caller saves only when it differs.
   */
  readonly opened: readonly OpenedProject[]
}

export type CloseRefusal = { readonly code: 'sessions-running'; readonly running: readonly SessionView[] }

export type CloseResult =
  | { readonly ok: true; readonly value: readonly OpenedProject[] }
  | { readonly ok: false; readonly error: CloseRefusal }

/** A drive (`C:\`, `c:/`) or a share (`\\server`): such a path is compared the way Windows compares it. */
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/
const WINDOWS_SEPARATOR = '\\'
const POSIX_SEPARATOR = '/'
const BARE_DRIVE = /^[A-Za-z]:$/

/**
 * One spelling per folder for comparing, never for showing. Windows takes either slash and ignores case, and git writes a
 * main checkout as `C:/dev/x` while a shell reports `C:\dev\x`.
 */
function pathKey(folder: string): string {
  const windows = WINDOWS_PATH.test(folder)
  const separator = windows ? WINDOWS_SEPARATOR : POSIX_SEPARATOR
  const spelled = windows ? folder.replaceAll(POSIX_SEPARATOR, WINDOWS_SEPARATOR).toLowerCase() : folder
  const trimmed = spelled.replace(/[\\/]+$/, '')
  // A root keeps its separator, so `/` and `C:\` still contain what is under them.
  if (trimmed === '' || BARE_DRIVE.test(trimmed)) return `${trimmed}${separator}`
  return trimmed
}

function contains(outer: string, inner: string): boolean {
  if (outer === inner) return true
  const separator = WINDOWS_PATH.test(outer) ? WINDOWS_SEPARATOR : POSIX_SEPARATOR
  return inner.startsWith(outer.endsWith(separator) ? outer : `${outer}${separator}`)
}

/** Machine names are compared without regard to case, as the host registers them (`api/machines.ts`). */
function sameMachine(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase()
}

export function sameProject(a: OpenedProject, b: OpenedProject): boolean {
  return sameMachine(a.machineName, b.machineName) && pathKey(a.folder) === pathKey(b.folder)
}

/**
 * The opened project a session belongs to, or the folder that would be opened for it when none fits. A session in git
 * belongs to its repository's main checkout (`repoRoot`, which the daemon gives as the main checkout for a linked
 * worktree too), so every worktree of a repository is one project. Outside git it belongs to the deepest opened folder
 * around its own, else its own folder.
 */
function placeOf(session: SessionView, opened: readonly OpenedProject[]): OpenedProject {
  const own: OpenedProject = { machineName: session.machineName, folder: session.repoRoot ?? session.cwd }
  if (session.repoRoot !== null) return opened.find((project) => sameProject(project, own)) ?? own
  const folder = pathKey(session.cwd)
  let deepest: OpenedProject | null = null
  for (const project of opened) {
    if (!sameMachine(project.machineName, session.machineName) || !contains(pathKey(project.folder), folder)) continue
    if (deepest === null || pathKey(project.folder).length > pathKey(deepest.folder).length) deepest = project
  }
  return deepest ?? own
}

/** `opened` with `project` in it, and the entry that stands for it: the one already there when the folder is open. */
export function openProject(opened: readonly OpenedProject[], project: OpenedProject): { opened: readonly OpenedProject[]; project: OpenedProject } {
  const existing = opened.find((candidate) => sameProject(candidate, project))
  return existing === undefined ? { opened: [...opened, project], project } : { opened, project: existing }
}

/**
 * Every session under exactly one project of its machine, adding a project for a session that fits none. Sessions are
 * placed in creation order, so the first session in a new folder decides what is opened for it, whatever order the list
 * came in; each project's sessions are in creation order too. A project with no session stays listed.
 */
export function groupByProject(sessions: readonly SessionView[], saved: readonly OpenedProject[]): ProjectGrouping {
  let opened = saved
  const placed = new Map<OpenedProject, SessionView[]>()
  for (const session of inCreationOrder(sessions)) {
    const added = openProject(opened, placeOf(session, opened))
    opened = added.opened
    const members = placed.get(added.project) ?? []
    members.push(session)
    placed.set(added.project, members)
  }
  const machines = new Map<string | null, { machineName: string | null; projects: ProjectSessions[] }>()
  for (const project of opened) {
    const key = project.machineName?.toLowerCase() ?? null
    const machine = machines.get(key) ?? { machineName: project.machineName, projects: [] }
    machine.projects.push({ project, sessions: placed.get(project) ?? [] })
    machines.set(key, machine)
  }
  return { machines: [...machines.values()].sort(byMachine), opened }
}

function byMachine(a: MachineProjects, b: MachineProjects): number {
  if (a.machineName === null || b.machineName === null) return Number(a.machineName !== null) - Number(b.machineName !== null)
  return a.machineName.localeCompare(b.machineName, undefined, { sensitivity: 'base' })
}

/**
 * `opened` without `project`. Refused while a session that has not ended is in it: closing the project must not hide a
 * running session, and the session would open it again. A project that is not open closes as a no-op.
 */
export function closeProject(opened: readonly OpenedProject[], project: OpenedProject, sessions: readonly SessionView[]): CloseResult {
  const running = sessions.filter((session) => !session.ended && sameProject(placeOf(session, opened), project))
  if (running.length > 0) return { ok: false, error: { code: 'sessions-running', running: inCreationOrder(running) } }
  return { ok: true, value: opened.filter((candidate) => !sameProject(candidate, project)) }
}
