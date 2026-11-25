import { sameMachine, sameProject, type MachineProjects, type OpenedProject, type ProjectSessions } from './openedProjects'

/** The opened project `sessionId` is placed in, with its sessions; null for a session no machine lists. */
export function projectOfSession(machines: readonly MachineProjects[], sessionId: string): ProjectSessions | null {
  for (const machine of machines) {
    const found = machine.projects.find((entry) => entry.sessions.some((session) => session.id === sessionId))
    if (found !== undefined) return found
  }
  return null
}

/**
 * The project a new session starts in on the machine named `machineName` (null: this computer): the one of the session
 * in front, else the one last opened or picked, each only when it is on that machine. The No project group counts as the
 * project of a session in it. Null when neither is (`draftFolderOn` says what happens then).
 */
export function startProjectOn(machineName: string | null, machines: readonly MachineProjects[], focusedId: string | null, selected: OpenedProject | null): OpenedProject | null {
  const inFront = focusedId === null ? null : projectOfSession(machines, focusedId)?.project ?? null
  for (const candidate of [inFront, selected]) {
    if (candidate === null || !sameMachine(candidate.machineName, machineName)) continue
    const listed = machines.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, candidate))
    if (listed !== undefined) return listed.project
  }
  return null
}

/**
 * The folder New session opens the draft in: the project's (`startProjectOn`), else on this computer with no project
 * open there (`localProjectsOpen` false) the start folder (`startFolder`, null or '' while it is not known), where the
 * draft starts with no project. Null otherwise, so the caller opens a project first: on another machine with no project
 * in front, on this computer when projects are open but none is in front, and while the start folder is not known.
 */
export function draftFolderOn(local: boolean, project: OpenedProject | null, startFolder: string | null, localProjectsOpen: boolean): string | null {
  if (project !== null) return project.folder
  return local && !localProjectsOpen && startFolder !== null && startFolder !== '' ? startFolder : null
}
