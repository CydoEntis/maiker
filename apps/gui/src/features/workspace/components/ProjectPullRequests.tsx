import { useEffect } from 'react'
import { LOCAL_MACHINE } from '@/api/machines'
import { machineLabel } from '@/data/machineNicknames'
import { followLink } from '@/features/chat/followLink'
import { needsYouElsewhere, pullsKey } from '@/features/pull-requests/model'
import { PullRequestsSurface } from '@/features/pull-requests/PullRequestsSurface'
import { pullsOf } from '@/features/pull-requests/usePullRequests'
import { SignInCard } from '@/features/signin/SignInCard'
import { useAgentSignIn } from '@/features/signin/useAgentSignIn'
import type { SessionView } from '../model/session'
import { projectName } from '../model/sidebarTree'
import { projectOfSession } from '../model/startProject'
import { useWorkspace } from '../workspaceContext'

/**
 * The Pull requests surface for `session`: the open pull requests of the project the session is in, read on the
 * project's own machine, where `gh` and its sign-in are. Signing in on this computer from the chat view runs `gh`'s web
 * sign-in through the daemon and shows its code and link here; the terminal view, and another machine, open `gh auth
 * login` in a terminal as before.
 */
export function ProjectPullRequests({ session }: { session: SessionView }) {
  const { openedProjects, pullRequests, signInGitHub, gitHubSignInsEnded, preferences } = useWorkspace()
  const project = projectOfSession(openedProjects.machines, session.id)?.project ?? null
  const machineName = project?.machineName ?? null
  const folder = project?.folder ?? null
  const { refresh } = pullRequests
  // Signed in from here: the list is read again at once.
  const signIn = useAgentSignIn(() => { if (folder !== null) refresh({ machineName, folder }, true) })
  const inPlace = session.machine === LOCAL_MACHINE && preferences.openSessionsIn === 'chat'
  // Asked when the surface comes up, and again when a GitHub sign-in started from here has ended.
  useEffect(() => {
    if (folder !== null) refresh({ machineName, folder }, false)
  }, [refresh, machineName, folder, gitHubSignInsEnded])
  if (project === null) return <p className="mx-inspect-note" role="status">This session is in no opened project, so there are no pull requests to list.</p>
  const names = new Map(openedProjects.machines.flatMap((machine) => machine.projects.map((placed) => [pullsKey(placed.project), projectName(placed)] as const)))
  const label = session.machineName === null ? null : machineLabel(session.machineName)
  const shown = signIn.view
  return (
    <>
    {shown !== null && <SignInCard view={shown} onCancel={() => { signIn.cancel(shown.agent) }} onClose={signIn.close} onRetry={() => { signIn.begin(shown.agent) }} />}
    <PullRequestsSurface
      pulls={pullsOf(pullRequests, project)}
      where={label ?? 'this computer'}
      elsewhere={needsYouElsewhere(pullRequests.projects, pullsKey(project), (key) => names.get(key) ?? '')}
      onOpen={followLink}
      onRetry={() => { refresh(project, true) }}
      onSignIn={() => { if (inPlace) signIn.begin('github'); else signInGitHub(session.machine, label ?? '') }}
    />
    </>
  )
}
