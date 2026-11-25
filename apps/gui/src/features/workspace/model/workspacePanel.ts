import { useCallback, useEffect, useState } from 'react'
import { savedWorkspace, type ClosedSession } from '@/api/daemon'
import type { FolderBranchList } from '@/api/folderGit'
import type { WorktreeStanding, WorktreesRemoved } from '@/features/worktrees/api'
import { ageWords, changesAndMerged, lossOfRemoving } from '@/features/worktrees/worktreeAdvice'
import { agentName } from './agentMessage'
import { baseName } from './folderPick'
import { ageOf } from './newChatHost'
import { sameProject, type MachineProjects, type OpenedProject } from './openedProjects'
import { worktreeChoices } from './projectWorktrees'
import type { SessionView } from './session'
import { isShell, rowTitle } from './sidebar'
import { projectName } from './sidebarTree'
import { startProjectOn } from './startProject'

/** The project whose Workspace panel is open, with the name its heading gives it; null while the panel is closed. */
export type WorkspaceFor = { readonly project: OpenedProject; readonly name: string }

/** What the panel knows of the project's saved set: nothing yet, the set, or why there is none. */
export type SavedRead = { kind: 'loading' } | { kind: 'listed'; list: readonly ClosedSession[] } | { kind: 'older' } | { kind: 'failed' }

/**
 * One row of the panel. A session listed in the window is `running`, or `ended` once its agent has gone while its row
 * stays; one from the saved set is `closed`. `at` is the last time anything happened to it, in unix seconds.
 */
export type WorkspaceRow = {
  readonly key: string
  readonly name: string
  /** The agent's program (`claude`, `codex`), for its mark and name. */
  readonly agent: string
  readonly branch: string | null
  readonly at: number | null
} & (
  | { readonly state: 'running' | 'ended'; readonly sessionId: string; readonly conversation: string | null }
  | { readonly state: 'closed'; readonly saved: ClosedSession }
)

const MS_PER_SECOND = 1000

function liveRow(session: SessionView): WorkspaceRow {
  return {
    key: `session:${session.id}`,
    name: rowTitle(session),
    agent: session.process,
    branch: session.branch,
    at: session.statusSince === null ? null : Math.floor(session.statusSince / MS_PER_SECOND),
    state: session.ended ? 'ended' : 'running',
    sessionId: session.id,
    conversation: session.agentSession ?? null,
  }
}

/** What a saved session is called: the name it was saved with, else "<Agent> session". */
export function savedName(saved: ClosedSession): string {
  return saved.title ?? `${agentName(saved.agent)} session`
}

function savedRow(saved: ClosedSession): WorkspaceRow {
  return {
    key: `saved:${saved.agent}:${saved.session}`,
    name: savedName(saved),
    agent: saved.agent,
    branch: saved.branch,
    at: saved.at,
    state: 'closed',
    saved,
  }
}

/**
 * The panel's rows: the project's agent sessions in the window, in the order the sidebar lists them, then its saved set,
 * newest first. A plain terminal is left out (the workspace is the agents' work), and so is a saved session whose
 * conversation runs again in the window, so one piece of work is one row.
 */
export function workspaceRows(sessions: readonly SessionView[], saved: readonly ClosedSession[]): WorkspaceRow[] {
  const live = sessions.filter((session) => !isShell(session)).map(liveRow)
  const running = (entry: ClosedSession) => live.some((row) => row.state !== 'closed' && row.agent === entry.agent && row.conversation === entry.session)
  const closed = saved.filter((entry) => !running(entry)).sort((a, b) => b.at - a.at).map(savedRow)
  return [...live, ...closed]
}

/** The saved set's rows, once it is read; none while it loads or when it could not be read. */
export function savedOf(read: SavedRead): readonly ClosedSession[] {
  return read.kind === 'listed' ? read.list : []
}

/** The saved sessions among `rows` that Open starts again: the closed ones, since a session in the window already runs. */
export function openTargets(rows: readonly WorkspaceRow[]): ClosedSession[] {
  return rows.flatMap((row) => (row.state === 'closed' ? [row.saved] : []))
}

/** The sessions among `rows` that Close ends: the ones in the window, running or ended; a closed row has nothing to end. */
export function closeTargets(rows: readonly WorkspaceRow[]): string[] {
  return rows.flatMap((row) => (row.state === 'closed' ? [] : [row.sessionId]))
}

/** How an Open went: how many started, how many failed and the last reason why, and each one skipped with why. */
export type OpenOutcome = {
  readonly opened: number
  readonly failed: number
  readonly lastError: unknown
  readonly skipped: readonly { readonly name: string; readonly why: string }[]
}

/** The one toast an Open ends with: its kind, its title, and the line naming what was skipped, if anything was. */
export type OpenWords = { readonly kind: 'success' | 'warning' | 'failed'; readonly title: string; readonly note: string | null }

const sessionsWord = (count: number): string => (count === 1 ? '1 session' : `${String(count)} sessions`)

/**
 * What the toast after an Open says. A failure is an error toast whose line under the title is the failure's own reason,
 * so the title counts the skipped ones too; a skip alone is a warning, which stays until dismissed, with a line naming
 * each skipped session and why.
 */
export function openWords({ opened, failed, skipped }: OpenOutcome): OpenWords {
  if (failed > 0) {
    if (opened === 0 && skipped.length === 0) return { kind: 'failed', title: failed === 1 ? 'Could not open the session' : `Could not open the ${String(failed)} sessions`, note: null }
    const skips = skipped.length === 0 ? '' : `, and ${String(skipped.length)} ${skipped.length === 1 ? 'was' : 'were'} skipped`
    return { kind: 'failed', title: `Opened ${String(opened)}, but ${String(failed)} could not start${skips}`, note: null }
  }
  const note = `Skipped ${skipped.map(({ name, why }) => `“${name}”: ${why}`).join('; ')}.`
  if (skipped.length > 0) return { kind: 'warning', title: opened === 0 ? `Could not open ${sessionsWord(skipped.length)}` : `Opened ${sessionsWord(opened)}, skipped ${String(skipped.length)}`, note }
  return { kind: 'success', title: `Opened ${sessionsWord(opened)}`, note: null }
}

/** What a row says under its name: the agent, then the branch it was on. */
export function rowWhere(row: WorkspaceRow): string {
  return [agentName(row.agent), row.branch].filter((part): part is string => part !== null && part !== '').join(' · ')
}

/** What a row says at its right: whether it runs, and how long since anything happened to it. */
export function rowWhen(row: WorkspaceRow, now: number): string {
  return row.at === null ? row.state : `${row.state} · ${ageOf(row.at, now)} ago`
}

/** Where a linked worktree stands while the daemon reads it in the background: not yet, read, or why it could not be. */
export type StandingRead = { readonly kind: 'checking' } | { readonly kind: 'read'; readonly standing: WorktreeStanding } | { readonly kind: 'failed'; readonly why: string }

/**
 * One row of the panel's Worktrees section, keyed `worktree:<path>`. The main checkout is the project's own folder: it
 * is listed but never ticked, since removing it would remove the project; a linked worktree carries its standing, and
 * whether a session of the window runs in it, which keeps it from being ticked too.
 */
export type WorktreeRow = { readonly key: string; readonly path: string; readonly name: string } & (
  | { readonly main: true }
  | { readonly main: false; readonly standing: StandingRead; readonly running: boolean }
)

/** A linked worktree's row: one Remove can act on. */
export type LinkedWorktreeRow = Extract<WorktreeRow, { main: false }>

/** What the panel knows of the project's worktrees: nothing yet, the rows, a folder outside git, or a failed read. */
export type WorktreesRead = { kind: 'loading' } | { kind: 'listed'; rows: readonly WorktreeRow[] } | { kind: 'not-a-repo' } | { kind: 'failed' }

/**
 * The Worktrees section's rows in the order git lists them (the main checkout first), each linked one with its standing
 * as far as it is read and whether a session runs in it (its folder is in `inUse`). A worktree on no branch is named by
 * its folder.
 */
export function worktreeRows(worktrees: FolderBranchList['worktrees'], standingOf: (path: string) => StandingRead, inUse: ReadonlySet<string>): WorktreeRow[] {
  return worktrees.map((worktree): WorktreeRow => {
    const base = { key: `worktree:${worktree.path}`, path: worktree.path, name: worktree.branch ?? baseName(worktree.path) }
    return worktree.main ? { ...base, main: true } : { ...base, main: false, standing: standingOf(worktree.path), running: inUse.has(worktree.path) }
  })
}

/**
 * The folders of the linked worktrees a session of the window on `machine` runs in, matched by its checkout as Open
 * worktree matches them (`worktreeChoices`). The daemon keeps such a worktree when asked to remove it; the panel does
 * not offer it.
 */
export function worktreesInUse(worktrees: FolderBranchList['worktrees'], sessions: readonly SessionView[], machine: number): ReadonlySet<string> {
  const linked = worktrees.filter((worktree) => !worktree.main).map((worktree) => ({ path: worktree.path, branch: worktree.branch, present: true }))
  return new Set(worktreeChoices(linked, sessions, machine).flatMap((choice) => (choice.kind === 'running' ? [choice.worktree.path] : [])))
}

/** The worktree rows a tick can go on: every linked worktree no session runs in, never the main checkout. */
export function tickableWorktrees(read: WorktreesRead): LinkedWorktreeRow[] {
  if (read.kind !== 'listed') return []
  return read.rows.filter((row): row is LinkedWorktreeRow => !row.main && !row.running)
}

/** What a worktree's standing says under its name: what is on it that is nowhere else, or why that is not known yet. */
function standingWhere(standing: StandingRead): string {
  if (standing.kind === 'checking') return 'checking…'
  if (standing.kind === 'failed') return 'could not check where it stands'
  return changesAndMerged(standing.standing)
}

/** What a worktree row says under its name: its standing, and why it stays when it cannot be removed. */
export function worktreeWhere(row: WorktreeRow): string {
  if (row.main) return 'main checkout · stays'
  return row.running ? `${standingWhere(row.standing)} · a session runs in it` : standingWhere(row.standing)
}

/**
 * A ticked worktree as Remove asks about it: what removing it would lose, and whether the daemon may go on past
 * uncommitted changes. `loss` is null only for a clean worktree whose work is merged, or one whose folder is already
 * gone: those go without a question of their own, as the daemon's clean-up rule has it. Anything else, a standing still
 * being checked or one that could not be read included, has to be confirmed on its own.
 */
export type RemovalCheck = { readonly row: LinkedWorktreeRow; readonly loss: string | null; readonly force: boolean }

const UNKNOWN_LOSS = 'whatever is in it: where it stands is not known'

export function removalCheck(row: LinkedWorktreeRow): RemovalCheck {
  if (row.standing.kind !== 'read') return { row, loss: UNKNOWN_LOSS, force: true }
  const standing = row.standing.standing
  if (standing.missing) return { row, loss: null, force: false }
  return { row, loss: lossOfRemoving(standing), force: standing.dirty > 0 }
}

/**
 * What Remove sends: each worktree that loses nothing, as it is, and each that would lose something only when its own
 * question was confirmed (`sure` holds its key with the loss its question named, which must still be its loss), the only
 * way `force` goes on. One not confirmed is not sent.
 */
export function removalItems(checks: readonly RemovalCheck[], sure: ReadonlyMap<string, string>): { path: string; force: boolean }[] {
  return checks.flatMap(({ row, loss, force }) => {
    if (loss === null) return [{ path: row.path, force: false }]
    return sure.get(row.key) === loss ? [{ path: row.path, force }] : []
  })
}

const worktreesWord = (count: number): string => (count === 1 ? '1 worktree' : `${String(count)} worktrees`)

/**
 * The line the Worktrees section says after a removal: how many went and how many stayed, whose reasons are on their
 * rows. A service too old to say gets the worktree manager's line, since the list read again is all there is to go on.
 */
export function removedWords(outcome: WorktreesRemoved): string {
  if (outcome === null) return 'Asked the service to remove them. If one is still listed, something is running in it: close that first.'
  const { removed, kept } = outcome
  if (kept.length === 0) return `Removed ${worktreesWord(removed.length)}.`
  const stayed = `${worktreesWord(kept.length)} stayed: the reason is on ${kept.length === 1 ? 'its row' : 'each row'}.`
  return removed.length === 0 ? `Removed nothing. ${stayed}` : `Removed ${worktreesWord(removed.length)}. ${stayed}`
}

/** What a worktree row says at its right: how long it has been quiet, once its standing is read. */
export function worktreeWhen(row: WorktreeRow): string {
  if (row.main || row.standing.kind !== 'read' || row.standing.standing.missing) return ''
  return ageWords(row.standing.standing)
}

/**
 * The project the palette's Workspace… opens: this computer's project of the session in front, else the one last opened
 * or picked, as New session finds it (`startProjectOn`). Null when neither is on this computer, since the saved set is
 * this computer's daemon's, and for the No project group, which is no project and has no workspace.
 */
export function workspaceTargetOf(machines: readonly MachineProjects[], focusedId: string | null, selected: OpenedProject | null): WorkspaceFor | null {
  const project = startProjectOn(null, machines, focusedId, selected)
  if (project === null) return null
  const placed = machines.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, project))
  return placed === undefined || placed.loose === true ? null : { project: placed.project, name: projectName(placed) }
}

/** The sessions the window places in `project` (`useOpenedProjects().machines`); none once it is closed. */
export function sessionsOfProject(machines: readonly MachineProjects[], project: OpenedProject): readonly SessionView[] {
  return machines.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, project))?.sessions ?? []
}

/** The project's saved set, read off the UI thread when the panel opens; `retry` asks again. */
export function useSavedWorkspace(folder: string): { read: SavedRead; retry: () => void } {
  const [read, setRead] = useState<SavedRead>({ kind: 'loading' })
  const [again, setAgain] = useState(0)
  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      try {
        const list = await savedWorkspace(folder)
        if (!stop.signal.aborted) setRead(list === null ? { kind: 'older' } : { kind: 'listed', list })
      } catch (error) {
        if (!stop.signal.aborted) setRead({ kind: 'failed' })
        console.warn('Could not read the saved workspace', error)
      }
    })()
    return () => { stop.abort() }
  }, [folder, again])
  const retry = useCallback(() => { setRead({ kind: 'loading' }); setAgain((count) => count + 1) }, [])
  return { read, retry }
}
