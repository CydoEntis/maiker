import { X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Panel } from '@/components/ui/panel'
import { WindowPortal } from '@/components/ui/portal'
import type { SessionView } from '../model/session'
import { projectName } from '../model/sidebarTree'
import { projectOfSession } from '../model/startProject'
import { useWorkspace } from '../workspaceContext'
import { ProjectPullRequests } from './ProjectPullRequests'

/**
 * The open pull requests of `session`'s project in a window of their own over the whole app, as Settings is: a scrim
 * behind, a title, and × (or Esc, or a click outside) to close it. The sidebar's pull-request button opens it.
 */
export function PullRequestsWindow({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const { openedProjects } = useWorkspace()
  const placed = projectOfSession(openedProjects.machines, session.id)
  const title = placed === null ? 'Pull requests' : `Pull requests · ${projectName(placed)}`
  return (
    <WindowPortal container={null}>
      <Panel label={title} onClose={onClose} scrimClassName="mx-settings-scrim" className="mx-pulls-window">
        <div className="mx-pulls-window-head">
          <h2>{title}</h2>
          <IconButton label="Close pull requests" onClick={onClose}><X /></IconButton>
        </div>
        <div className="mx-pulls-window-body">
          <ProjectPullRequests session={session} />
        </div>
      </Panel>
    </WindowPortal>
  )
}
