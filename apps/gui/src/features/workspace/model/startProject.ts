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
 * The project a new session starts in on the machine named `machineName` (null: this computer). A session always starts
 * in an opened project: the one of the session in front, else the one last opened or picked, each only when it is on
 * that machine. Null when neither is, so the caller opens a project first.
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
