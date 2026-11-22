import { useCallback, useEffect, useMemo, useState } from 'react'
import { readOpenedProjects, writeOpenedProjects } from '@/data/openedProjects'
import { closeProject, groupByProject, openProject, sameProject, type CloseResult, type MachineProjects, type OpenedProject } from './model/openedProjects'
import type { SessionView } from './model/session'
import { useWorkspace } from './workspaceContext'

/** The window's opened projects: the saved list, each machine's projects with their sessions, and the one to show. */
export type OpenedProjects = {
  /** Every opened project in the order it was opened, the ones a session needed included. This is what is saved. */
  readonly opened: readonly OpenedProject[]
  /** Each machine's projects with their sessions (`groupByProject`), this computer first: what the sidebar draws. */
  readonly machines: readonly MachineProjects[]
  /**
   * The project the sidebar is asked to show and select: the last one opened, or picked with `select`. Null for none.
   * Compare it with `sameProject`, not by identity.
   */
  readonly selected: OpenedProject | null
  /**
   * Adds `project` and saves the list, unless its folder is open already (in any spelling); either way the entry that
   * stands for it is selected and given back.
   */
  readonly open: (project: OpenedProject) => OpenedProject
  readonly select: (project: OpenedProject | null) => void
  /**
   * Takes `project` off the list and saves it, unselecting it if it was selected. Refused, changing nothing, while a
   * listed session is in it (`closeProject`): the result says which, for the caller to tell the person.
   */
  readonly close: (project: OpenedProject) => CloseResult
  /** What `close` would answer now, changing nothing: for asking the person before it runs. */
  readonly closable: (project: OpenedProject) => CloseResult
}

/**
 * The window's one opened-projects state: `useWorkspaceState` owns it, everything else reads it with `useOpenedProjects`.
 * A session whose project is not open opens it, and that is saved too, so a project a session started in is kept after
 * the session ends.
 */
export function useOpenedProjectsState(sessions: readonly SessionView[]): OpenedProjects {
  const [stored] = useState<readonly OpenedProject[]>(readOpenedProjects)
  const [saved, setSaved] = useState(stored)
  const [selected, setSelected] = useState<OpenedProject | null>(null)
  const grouping = useMemo(() => groupByProject(sessions, saved), [sessions, saved])
  // `groupByProject` gives back the same list when no session needed a project, so this settles after one adjustment.
  if (grouping.opened !== saved) setSaved(grouping.opened)
  // Not the list as it was read: a record this version could not read stays untouched until something is opened.
  useEffect(() => { if (saved !== stored) writeOpenedProjects(saved) }, [saved, stored])
  const { opened, machines } = grouping
  const open = useCallback((project: OpenedProject) => {
    const entry = openProject(opened, project).project
    // From the newest list, not this render's: an open that waited on a machine must not drop what was added meanwhile.
    setSaved((current) => openProject(current, entry).opened)
    setSelected(entry)
    return entry
  }, [opened])
  const close = useCallback((project: OpenedProject) => {
    const result = closeProject(opened, project, sessions)
    if (!result.ok) return result
    // From the newest list, as `open` does; the check above is this render's, which is what the person was shown.
    setSaved((current) => current.filter((candidate) => !sameProject(candidate, project)))
    setSelected((current) => (current !== null && sameProject(current, project) ? null : current))
    return result
  }, [opened, sessions])
  const closable = useCallback((project: OpenedProject) => closeProject(opened, project, sessions), [opened, sessions])
  return { opened, machines, selected, open, select: setSelected, close, closable }
}

/** The opened projects, from any part of the window. */
export function useOpenedProjects(): OpenedProjects {
  return useWorkspace().openedProjects
}
