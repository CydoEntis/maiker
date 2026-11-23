import { markOf, type StatusMarkKind } from '@/lib/statusMark'
import { baseName } from './folderPick'
import { machineTitle, type MachineHead } from './machines'
import { sameProject, type MachineProjects, type OpenedProject, type ProjectSessions } from './openedProjects'
import { inCreationOrder, type SessionView } from './session'
import { mostUrgent } from './sidebar'

/** A session kept in the state it was in when it was picked, whatever its status says since. */
export type HeldRow = { readonly id: string; readonly mark: StatusMarkKind }

/** The two states a row moves between when the person looks at it: a finished agent turns idle. */
const settles = (mark: StatusMarkKind): boolean => mark === 'done' || mark === 'idle'

/**
 * The state a session is placed by. The `held` one stays where it was picked: looking at a finished agent makes it idle,
 * and a row that drops to the bottom of its project the moment it is clicked reads as the app fighting you. Only that shift between
 * finished and idle is held: a session that starts working, or asks, moves at once.
 */
function placedMark(session: SessionView, held: HeldRow | null): StatusMarkKind {
  const actual = markOf(session.status)
  return session.id === held?.id && settles(held.mark) && settles(actual) ? held.mark : actual
}

/** One row of a project with the helpers listed under it. */
export type SessionNode = {
  readonly session: SessionView
  /** The sessions its agent started, in the order they were made. */
  readonly helpers: readonly SessionView[]
  /** What the row is ranked by: the most urgent of its own state and its helpers'. */
  readonly mark: StatusMarkKind
}

/** How far a helper's starter is followed up to the session at the top: a helper of a helper sits under the first starter. */
const MAX_STARTER_DEPTH = 8

/**
 * A project's sessions as rows in the order they were made, so a row stays where it is while its state changes (a list
 * that reorders on every status cannot be read or clicked); only an idle row drops below the rest. Each has its helpers
 * under it in the order they were made. A helper keeps its place under its lead whatever its own status does: helpers
 * start, finish and ask within seconds, and a list that reorders each time cannot be read or clicked. A helper whose
 * starter is not listed here is an ordinary row.
 */
export function sessionNodes(sessions: readonly SessionView[], held: HeldRow | null = null): SessionNode[] {
  const byId = new Map(sessions.map((session) => [session.id, session]))
  const leadOf = (session: SessionView): SessionView | null => {
    let lead: SessionView | null = null
    let at = session
    for (let depth = 0; depth < MAX_STARTER_DEPTH; depth += 1) {
      const starter = at.startedBy === null ? undefined : byId.get(at.startedBy)
      if (starter === undefined || starter.id === session.id) break
      lead = starter
      at = starter
    }
    return lead
  }
  const helpersOf = new Map<string, SessionView[]>()
  const nested = new Set<string>()
  for (const session of inCreationOrder(sessions)) {
    const lead = leadOf(session)
    if (lead === null) continue
    nested.add(session.id)
    helpersOf.set(lead.id, [...(helpersOf.get(lead.id) ?? []), session])
  }
  return inCreationOrder(sessions.filter((session) => !nested.has(session.id)))
    .map((session): SessionNode => {
      const helpers = helpersOf.get(session.id) ?? []
      return { session, helpers, mark: mostUrgent([session, ...helpers].map((each) => placedMark(each, held))) }
    })
    .sort((a, b) => Number(a.mark === 'idle') - Number(b.mark === 'idle'))
}

/** What this computer is called in a key: a machine's name never holds a space (`data/openedProjects.ts`). */
const THIS_COMPUTER = 'this computer'

/** A machine as the filter and the fold keys name it: its real name whatever its case, so a nickname changes nothing. */
export function machineKey(machineName: string | null): string {
  return machineName?.toLowerCase() ?? THIS_COMPUTER
}

export function projectFoldKey(project: OpenedProject): string {
  return `project:${machineKey(project.machineName)}:${project.folder}`
}

/** The fold of a lead's helpers, kept with the others; a lead is its session id for as long as it is listed. */
export function helpersFoldKey(leadId: string): string {
  return `helpers:${leadId}`
}

/**
 * What a project heading says: the repository's name for a git project, else the folder's last part. A project with no
 * session yet has only its folder to go by.
 */
export function projectName({ project, sessions }: ProjectSessions): string {
  return sessions.find((session) => session.repoName !== null)?.repoName ?? baseName(project.folder)
}

const BADGE_LETTERS = 2
const WORD_BREAK = /[-_ ]+/

/**
 * The letters on a project's badge: the first letters of its first two words (`api-server` is AS), or the first two
 * letters of a one-word name (`chameleon` is CH).
 */
export function badgeLetters(name: string): string {
  const words = name.split(WORD_BREAK).filter((word) => word !== '').map((word) => Array.from(word))
  const letters = words.length > 1 ? words.map((word) => word[0] ?? '') : words[0] ?? []
  return letters.slice(0, BADGE_LETTERS).join('').toUpperCase()
}

/** A project (a folder on a machine) with its rows. */
export type ProjectGroup = {
  /** Stable across restarts and renames: the machine's name and the project's folder, which is what makes a project. */
  readonly key: string
  readonly name: string
  readonly project: OpenedProject
  readonly head: MachineHead
  readonly rows: readonly SessionNode[]
  /** Every session placed in the project, whatever the filter shows: what its menus act on. */
  readonly sessions: readonly SessionView[]
  /** The project's own state, its most urgent row's (needs you, working, done, idle); null with no session in it. */
  readonly mark: StatusMarkKind | null
}

/** What narrows the sidebar: one project by its heading's name, one machine by its `machineKey`; null is all of them. */
export type SidebarFilter = { readonly project: string | null; readonly machine: string | null }

export const NO_FILTER: SidebarFilter = { project: null, machine: null }

/** How the projects are ordered: the one opened last first, by name, or by machine (this computer first). */
export type SidebarSort = 'recent' | 'name' | 'machine'

export const SIDEBAR_SORTS: readonly SidebarSort[] = ['recent', 'name', 'machine']

/** The sidebar from top to bottom: one list of projects, each holding all its sessions and saying its own state. */
export type SidebarOrder = { readonly projects: readonly ProjectGroup[] }

/** Whether the filter leaves a project of this name on this machine in the list. */
export function passesFilter(filter: SidebarFilter, project: { readonly head: MachineHead; readonly name: string }): boolean {
  return (filter.machine === null || machineKey(project.head.name) === filter.machine) && (filter.project === null || project.name === filter.project)
}

export type ListedProject = { readonly head: MachineHead; readonly entry: ProjectSessions; readonly name: string }

/** Every opened project of every configured machine, this computer's first, each in the order it was opened. */
export function listedProjects(heads: readonly MachineHead[], machines: readonly MachineProjects[]): ListedProject[] {
  return heads.flatMap((head) => {
    const projects = machines.find((machine) => machineKey(machine.machineName) === machineKey(head.name))?.projects ?? []
    return projects.map((entry) => ({ head, entry, name: projectName(entry) }))
  })
}

const byName = (a: ProjectGroup, b: ProjectGroup): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * The order the sidebar lists everything in. A project is a folder on a machine, so the same folder on two machines is
 * two projects. Each holds all its sessions, the most urgent first (`sessionNodes`), and says its own state on its
 * heading, so nothing moves between sections and a project stays where `sort` puts it whatever its sessions do:
 * `recent` is the one opened last first (`opened` is every opened project in the order it was opened), `name` is A to Z,
 * and `machine` is this computer's first, then each machine's by name. `held` keeps the session on screen where it was
 * picked (`placedMark`).
 */
export function sidebarOrder(heads: readonly MachineHead[], machines: readonly MachineProjects[], filter: SidebarFilter = NO_FILTER, held: HeldRow | null = null, sort: SidebarSort = 'recent', opened: readonly OpenedProject[] = []): SidebarOrder {
  const listed = listedProjects(heads, machines).filter((project) => passesFilter(filter, project))
  const placed = listed.map(({ head, entry, name }, at) => {
    const rows = sessionNodes(entry.sessions, held)
    const openedAt = opened.findIndex((candidate) => sameProject(candidate, entry.project))
    const group: ProjectGroup = {
      key: projectFoldKey(entry.project), name, project: entry.project, head, rows, sessions: entry.sessions,
      mark: rows.length === 0 ? null : mostUrgent(rows.map((node) => node.mark)),
    }
    return { group, at: openedAt === -1 ? at : openedAt, headAt: heads.indexOf(head) }
  })
  const sorted = [...placed].sort((a, b) => {
    if (sort === 'name') return byName(a.group, b.group) || a.headAt - b.headAt
    if (sort === 'machine') return a.headAt - b.headAt || byName(a.group, b.group)
    return b.at - a.at
  })
  return { projects: sorted.map(({ group }) => group) }
}

/**
 * Where every heading and row sits: when it is the same string a re-render moved nothing, so `useFlip` measures nothing.
 * A focus change that moves no row leaves it alone.
 */
export function orderPlacement(order: SidebarOrder): string {
  const groupsOf = (groups: readonly ProjectGroup[]): string =>
    groups.map((group) => `${group.key}{${group.rows.map((node) => [node.session, ...node.helpers].map((session) => session.id).join('+')).join(',')}}`).join(';')
  return groupsOf(order.projects)
}

export type ProjectChoice = { readonly name: string; readonly count: number }
export type MachineChoice = { readonly key: string; readonly label: string; readonly remote: boolean; readonly down: boolean; readonly count: number }

/**
 * What the filter offers: every project by its heading's name (one name on two machines is one choice, and the machine
 * choice tells them apart), and every configured machine, each with how many sessions it has.
 */
export function filterChoices(heads: readonly MachineHead[], machines: readonly MachineProjects[]): { projects: ProjectChoice[]; machines: MachineChoice[] } {
  const listed = listedProjects(heads, machines)
  const counts = new Map<string, number>()
  for (const { name, entry } of listed) counts.set(name, (counts.get(name) ?? 0) + entry.sessions.length)
  return {
    projects: [...counts.entries()].map(([name, count]) => ({ name, count })),
    machines: heads.map((head) => ({
      key: machineKey(head.name),
      label: machineTitle(head),
      remote: head.name !== null,
      down: head.down,
      count: listed.filter((project) => project.head === head).reduce((total, project) => total + project.entry.sessions.length, 0),
    })),
  }
}
