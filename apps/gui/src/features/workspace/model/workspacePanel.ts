import { useCallback, useEffect, useState } from 'react'
import { savedWorkspace, type SavedSession } from '@/api/daemon'
import { agentName } from './agentMessage'
import { ageOf } from './newChatHost'
import { sameProject, type MachineProjects, type OpenedProject } from './openedProjects'
import type { SessionView } from './session'
import { isShell, rowTitle } from './sidebar'
import { projectName } from './sidebarTree'
import { startProjectOn } from './startProject'

/** The project whose Workspace panel is open, with the name its heading gives it; null while the panel is closed. */
export type WorkspaceFor = { readonly project: OpenedProject; readonly name: string }

/** What the panel knows of the project's saved set: nothing yet, the set, or why there is none. */
export type SavedRead = { kind: 'loading' } | { kind: 'listed'; list: readonly SavedSession[] } | { kind: 'older' } | { kind: 'failed' }

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
  | { readonly state: 'closed'; readonly saved: SavedSession }
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

function savedRow(saved: SavedSession): WorkspaceRow {
  return {
    key: `saved:${saved.agent}:${saved.session}`,
    name: saved.title ?? `${agentName(saved.agent)} session`,
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
export function workspaceRows(sessions: readonly SessionView[], saved: readonly SavedSession[]): WorkspaceRow[] {
  const live = sessions.filter((session) => !isShell(session)).map(liveRow)
  const running = (entry: SavedSession) => live.some((row) => row.state !== 'closed' && row.agent === entry.agent && row.conversation === entry.session)
  const closed = saved.filter((entry) => !running(entry)).sort((a, b) => b.at - a.at).map(savedRow)
  return [...live, ...closed]
}

/** The saved set's rows, once it is read; none while it loads or when it could not be read. */
export function savedOf(read: SavedRead): readonly SavedSession[] {
  return read.kind === 'listed' ? read.list : []
}

/** What a row says under its name: the agent, then the branch it was on. */
export function rowWhere(row: WorkspaceRow): string {
  return [agentName(row.agent), row.branch].filter((part): part is string => part !== null && part !== '').join(' · ')
}

/** What a row says at its right: whether it runs, and how long since anything happened to it. */
export function rowWhen(row: WorkspaceRow, now: number): string {
  return row.at === null ? row.state : `${row.state} · ${ageOf(row.at, now)} ago`
}

/**
 * The project the palette's Workspace… opens: this computer's project of the session in front, else the one last opened
 * or picked, as New session finds it (`startProjectOn`). Null when neither is on this computer, since the saved set is
 * this computer's daemon's.
 */
export function workspaceTargetOf(machines: readonly MachineProjects[], focusedId: string | null, selected: OpenedProject | null): WorkspaceFor | null {
  const project = startProjectOn(null, machines, focusedId, selected)
  if (project === null) return null
  const placed = machines.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, project))
  return placed === undefined ? null : { project: placed.project, name: projectName(placed) }
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
