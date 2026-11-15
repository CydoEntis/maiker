import { folderNameOf, type SessionView } from '@/features/workspace/model/session'
import { projectLinkKey } from './ticketLinks'

/** A project Tickets reads for: its name, the key its links are kept under, its folder and the machine it is on. */
export type TicketsProject = { name: string; linkKey: string; folder: string; machine: number }

type ProjectSession = Pick<SessionView, 'repoRoot' | 'cwd' | 'repoName' | 'machine' | 'title'>

/** The folder a session's project is: its repository's root, else its own folder. */
export function projectFolder(session: Pick<SessionView, 'repoRoot' | 'cwd'>): string {
  return session.repoRoot ?? session.cwd
}

export function ticketProjectOf(session: ProjectSession): TicketsProject {
  const folder = projectFolder(session)
  return { name: session.repoName ?? folderNameOf(session), linkKey: projectLinkKey(session.machine, folder), folder, machine: session.machine }
}

/** Each project the open sessions work in, once, in name order: the projects Settings › Tickets can link. */
export function ticketProjects(sessions: readonly (ProjectSession & { ended: boolean })[]): TicketsProject[] {
  const byKey = new Map<string, TicketsProject>()
  for (const session of sessions) {
    if (session.ended) continue
    const project = ticketProjectOf(session)
    if (!byKey.has(project.linkKey)) byKey.set(project.linkKey, project)
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
