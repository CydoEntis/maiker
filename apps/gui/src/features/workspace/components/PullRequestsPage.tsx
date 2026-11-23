import { useEffect, useRef, type ReactNode } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import type { SessionView } from '../model/session'
import { projectName } from '../model/sidebarTree'
import { projectOfSession } from '../model/startProject'
import { useWorkspace } from '../workspaceContext'
import { Icon } from './glyphs'
import { ProjectPullRequests } from './ProjectPullRequests'

type Props = {
  session: SessionView
  /** The pane header's first control (Show sidebar while the sidebar is hidden). */
  leading?: ReactNode
  onClose: () => void
}

/**
 * The open pull requests of `session`'s project as a page in the main area, over the panes as the New session draft is:
 * the pane header (`project / Pull requests` and ×), then the list in a centred column. Not a window: nothing behind it
 * dims, and the sidebar stays usable. × or Esc closes it, and showing another session leaves it.
 */
export function PullRequestsPage({ session, leading, onClose }: Props) {
  const { openedProjects } = useWorkspace()
  const placed = projectOfSession(openedProjects.machines, session.id)
  const project = placed === null ? null : projectName(placed)
  // It takes the keyboard when it opens, so Esc closes it without a click first.
  const page = useRef<HTMLElement>(null)
  useEffect(() => { page.current?.focus() }, [])
  return (
    <section
      ref={page}
      tabIndex={-1}
      className="mx-newchat mx-pulls-page"
      aria-label={project === null ? 'Pull requests' : `Pull requests, ${project}`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}
    >
      <header className="mx-pane-head">
        {leading}
        <span className="mx-pane-title">
          {project !== null && <><span className="mx-pane-project">{project}</span><span className="mx-pane-slash" aria-hidden="true">/</span></>}
          <span className="mx-pane-name">Pull requests</span>
        </span>
        <IconButton label="Close pull requests" tip="Close pull requests (Esc)" onClick={onClose}><Icon name="close" /></IconButton>
      </header>
      <div className="mx-pulls-page-body">
        <div className="mx-pulls-page-column">
          <ProjectPullRequests session={session} />
        </div>
      </div>
    </section>
  )
}
