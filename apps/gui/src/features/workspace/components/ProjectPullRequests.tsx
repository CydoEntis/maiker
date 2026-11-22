import { useEffect } from 'react'
import { machineLabel } from '@/data/machineNicknames'
import { followLink } from '@/features/chat/followLink'
import { needsYouElsewhere, pullsKey } from '@/features/pull-requests/model'
import { PullRequestsSurface } from '@/features/pull-requests/PullRequestsSurface'
import { pullsOf } from '@/features/pull-requests/usePullRequests'
import type { SessionView } from '../model/session'
import { projectName } from '../model/sidebarTree'
import { projectOfSession } from '../model/startProject'
import { useWorkspace } from '../workspaceContext'

/**
 * The side panel's Pull requests surface for `session`: the open pull requests of the project the session is in, read
 * on the project's own machine, where `gh` and its sign-in are.
 */
export function ProjectPullRequests({ session }: { session: SessionView }) {
  const { openedProjects, pullRequests, signInGitHub, gitHubSignInsEnded } = useWorkspace()
  const project = projectOfSession(openedProjects.machines, session.id)?.project ?? null
  const machineName = project?.machineName ?? null
  const folder = project?.folder ?? null
  const { refresh } = pullRequests
  // Asked when the surface comes up, and again when a GitHub sign-in started from here has ended.
  useEffect(() => {
    if (folder !== null) refresh({ machineName, folder }, false)
  }, [refresh, machineName, folder, gitHubSignInsEnded])
  if (project === null) return <p className="mx-inspect-note" role="status">This session is in no opened project, so there are no pull requests to list.</p>
  const names = new Map(openedProjects.machines.flatMap((machine) => machine.projects.map((placed) => [pullsKey(placed.project), projectName(placed)] as const)))
  const label = session.machineName === null ? null : machineLabel(session.machineName)
  return (
    <PullRequestsSurface
      pulls={pullsOf(pullRequests, project)}
      where={label ?? 'this computer'}
      elsewhere={needsYouElsewhere(pullRequests.projects, pullsKey(project), (key) => names.get(key) ?? '')}
      onOpen={followLink}
      onRetry={() => { refresh(project, true) }}
      onSignIn={() => { signInGitHub(session.machine, label ?? '') }}
    />
  )
}
