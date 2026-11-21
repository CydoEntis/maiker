import { baseName } from './folderPick'
import type { MachineHead } from './machines'
import type { MachineProjects, OpenedProject, ProjectSessions } from './openedProjects'
import { inCreationOrder, type SessionView } from './session'
import { byLatestChange, sectionOf, statusSections, type HeldRow, type StatusSection } from './sidebar'

/**
 * A project with fewer sessions than this lists them under no status heading: with one or two rows the dot on each row
 * already says its status, and a heading per row would double the list's height for nothing.
 */
export const STATUS_HEADINGS_FROM = 3

/** One project under its machine: its sessions by status (Needs you, Working, Done, Idle), the latest change first in each. */
export type ProjectNode = {
  /** Stable across restarts and renames: the machine's name and the project's folder, which is what makes a project. */
  readonly key: string
  readonly name: string
  readonly project: OpenedProject
  readonly sections: readonly StatusSection[]
  readonly count: number
  /** The helpers listed right under the session that started them (`nestHelpers`), by id. */
  readonly nested: ReadonlySet<string>
  /** The sessions that are not nested: what decides whether the project needs status headings. */
  readonly top: number
}

export type MachineNode = {
  readonly head: MachineHead
  /** Stable across restarts: the machine's name. The daemon's machine number can change when the machines are read again. */
  readonly key: string
  readonly projects: readonly ProjectNode[]
  readonly count: number
}

/** How far a helper's starter is followed up to the session at the top: a helper of a helper sits under the first starter. */
const MAX_STARTER_DEPTH = 8

/**
 * A project's sessions with every helper right under the session that started it, in the order the helpers were made.
 * Only the starting session is placed by status, so a helper keeps its place under it whatever its own status does:
 * helpers start, finish and ask within seconds, and a list that reorders each time cannot be read or clicked. A helper
 * whose starter is not listed here is an ordinary row.
 */
export function nestHelpers(sessions: readonly SessionView[], held: HeldRow | null): { sections: StatusSection[]; nested: Set<string> } {
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
  const sections = statusSections(sessions.filter((session) => !nested.has(session.id)), held)
    .map((section) => ({ ...section, sessions: section.sessions.flatMap((lead) => [lead, ...(helpersOf.get(lead.id) ?? [])]) }))
  return { sections, nested }
}

/** What this computer is called in a fold key: a machine's name never holds a space (`data/openedProjects.ts`). */
const THIS_COMPUTER = 'this computer'

export function machineFoldKey(machineName: string | null): string {
  return `machine:${machineName?.toLowerCase() ?? THIS_COMPUTER}`
}

export function projectFoldKey(project: OpenedProject): string {
  return `project:${project.machineName?.toLowerCase() ?? THIS_COMPUTER}:${project.folder}`
}

/**
 * What a project heading says: the repository's name for a git project (the name a row's second line gives it), else the
 * folder's last part. A project with no session yet has only its folder to go by.
 */
export function projectName({ project, sessions }: ProjectSessions): string {
  return sessions.find((session) => session.repoName !== null)?.repoName ?? baseName(project.folder)
}

/** Whether a project of `count` sessions lists them under status headings, with the person's setting on or off. */
export function showsStatusHeadings(count: number, setting: boolean): boolean {
  return setting && count >= STATUS_HEADINGS_FROM
}

/**
 * Whether the tree heads its projects with their machine: only once another machine is configured, whether its line is up
 * or not. With this computer alone a "This computer" heading is one more level for nothing, so its projects are the top.
 */
export function showsMachineHeadings(heads: readonly MachineHead[]): boolean {
  return heads.some((head) => head.name !== null)
}

function sameMachineName(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase()
}

/**
 * The sidebar's tree: every machine (`heads`, this computer first), under each its opened projects in the order they were
 * opened, under each project its `shown` sessions by status. `held` keeps the session on screen in the status it was picked
 * in (`statusSections`). A lone machine with no project and no session has no heading unless `keepEmpty` (a draft waits there).
 */
export function sidebarTree(heads: readonly MachineHead[], machines: readonly MachineProjects[], shown: (session: SessionView) => boolean, held: HeldRow | null, keepEmpty = false): MachineNode[] {
  const tree = heads.map((head): MachineNode => {
    const projects = machines.find((machine) => sameMachineName(machine.machineName, head.name))?.projects ?? []
    const nodes = projects.map((entry): ProjectNode => {
      const sessions = entry.sessions.filter(shown)
      const { sections, nested } = nestHelpers(sessions, held)
      return { key: projectFoldKey(entry.project), name: projectName(entry), project: entry.project, sections, count: sessions.length, nested, top: sessions.length - nested.size }
    })
    return { head, key: machineFoldKey(head.name), projects: nodes, count: nodes.reduce((total, node) => total + node.count, 0) }
  })
  const empty = tree.every((machine) => machine.projects.length === 0)
  return !keepEmpty && empty && heads.length <= 1 ? [] : tree
}

/**
 * Where every row of the tree sits, and which status headings are drawn: when it is the same string a re-render moved
 * nothing, so `useFlip` measures nothing (`flipKey`). A focus change that moves no row leaves it alone.
 */
export function treePlacement(tree: readonly MachineNode[], headings: boolean): string {
  return tree.map((machine) => `${machine.key}[${machine.projects.map((project) => {
    const titled = showsStatusHeadings(project.top, headings)
    return `${project.key}${titled ? '#' : ''}{${project.sections.map((section) => `${section.key}:${section.sessions.map((session) => session.id).join(',')}`).join('|')}}`
  }).join(';')}]`).join('/')
}

/**
 * The tree narrowed by the project filter: only the projects that still have a session shown, and only the machines
 * left with one, unless `keep` holds a machine (a draft chat waits there).
 */
export function withSessionsOnly(tree: readonly MachineNode[], keep: (head: MachineHead) => boolean): MachineNode[] {
  return tree
    .map((machine) => ({ ...machine, projects: machine.projects.filter((project) => project.count > 0) }))
    .filter((machine) => machine.projects.length > 0 || keep(machine.head))
}

/** A session that waits on the person, with the machine and the project the tree lists it under. */
export type WaitingSession = { readonly session: SessionView; readonly machine: MachineHead; readonly project: ProjectNode }

/**
 * Whether a session waits on the person: what the tree lists under Needs you (it asks, or an agent stopped), except one held
 * by its plan limit, which waits on the limit and not on the person, so nothing that says "needs you" counts it but the tree.
 */
export function waitsOnYou(session: SessionView): boolean {
  return sectionOf(session) === 'needs' && session.status !== 'limited'
}

/**
 * Every session that waits on the person, on every machine and in every project, the one that started waiting last first
 * (`statusSince`, when its status last changed). Each keeps its place in the tree, so a pick can unfold it there.
 */
export function waitingSessions(heads: readonly MachineHead[], machines: readonly MachineProjects[]): WaitingSession[] {
  const placed = new Map(sidebarTree(heads, machines, waitsOnYou, null).flatMap((machine) => machine.projects.flatMap((project) =>
    project.sections.flatMap((section) => section.sessions.map((session) => [session.id, { session, machine: machine.head, project }] as const)))))
  return byLatestChange([...placed.values()].map((entry) => entry.session)).flatMap((session) => {
    const entry = placed.get(session.id)
    return entry === undefined ? [] : [entry]
  })
}

/**
 * Whether a session finished and has not been opened since: the daemon keeps a finished agent `done` until the person looks
 * at it, and looking (or Mark as done) turns it idle (`markSeenOnDaemon`), so no second "seen" record is kept here.
 */
export function finishedUnseen(session: SessionView): boolean {
  return session.status === 'done'
}

/** What a folded heading counts of the sessions under it: those that wait on you, and those that finished unseen. */
export type FoldCounts = { readonly needs: number; readonly finished: number }

function countsOf(sessions: readonly SessionView[]): FoldCounts {
  return { needs: sessions.filter(waitsOnYou).length, finished: sessions.filter(finishedUnseen).length }
}

/** A project's counts, over the sessions the tree lists under it (put-away and filtered-out ones are not under it). */
export function projectFoldCounts(project: ProjectNode): FoldCounts {
  return countsOf(project.sections.flatMap((section) => section.sessions))
}

/** A machine's counts: the sum of its projects', folded or not. */
export function machineFoldCounts(machine: MachineNode): FoldCounts {
  return machine.projects.map(projectFoldCounts).reduce((total, counts) => ({ needs: total.needs + counts.needs, finished: total.finished + counts.finished }), { needs: 0, finished: 0 })
}
