import { folderNameOf, type SessionView } from '@/features/workspace/model/session'

/**
 * A project the open sessions work in, as Settings › Extensions lists it: its name, a key that tells it apart, its
 * folder and the machine's name (null for this computer).
 */
export type ExtensionProject = { name: string; linkKey: string; folder: string; machineName: string | null }

type ProjectSession = Pick<SessionView, 'repoRoot' | 'cwd' | 'repoName' | 'machineName' | 'title'>

/** Each project the open sessions work in, once, in name order. */
export function extensionProjects(sessions: readonly (ProjectSession & { ended: boolean })[]): ExtensionProject[] {
  const byKey = new Map<string, ExtensionProject>()
  for (const session of sessions) {
    if (session.ended) continue
    const folder = session.repoRoot ?? session.cwd
    const linkKey = `${session.machineName ?? ''}:${folder}`
    if (!byKey.has(linkKey)) byKey.set(linkKey, { name: session.repoName ?? folderNameOf(session), linkKey, folder, machineName: session.machineName })
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
