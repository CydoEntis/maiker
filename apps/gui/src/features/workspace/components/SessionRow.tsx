import type { MouseEvent, ReactNode } from 'react'
import { machineLabel } from '@/data/machineNicknames'
import { STATUS_WORD, type SessionView } from '../model/session'
import { isShell, projectOf, rowTitle, rowWord } from '../model/sidebar'
import { StatusIcon } from '@/components/ui/status-icon'
import { AppIcon, Icon } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { Ago } from './times'

type Props = {
  session: SessionView
  selected: boolean
  /** Inside a project group the project is in the heading, so the row leaves it out. */
  showProject: boolean
  /** The real name of the other machine the session runs on, when no heading above the row says so. */
  machine?: string | null
  onShow: () => void
  onRename: () => void
  onContextMenu: (event: MouseEvent) => void
}

/**
 * The line under a row's name, saying where the session is: a folder icon, its project, `/`, its branch (mono; the tree
 * icon when it runs in a worktree of its own), and the other machine it runs on at the right.
 */
function PlaceLine({ session, showProject, machine, children }: { session: SessionView; showProject: boolean; machine: string | null; children?: ReactNode }) {
  const branch = session.branch
  return (
    <span className="mx-row-sub">
      <span className="mx-row-folder" aria-hidden="true"><Icon name="folder" size={12} /></span>
      {showProject && <span className="mx-row-project-name">{projectOf(session)}</span>}
      {showProject && branch !== null && <span className="mx-row-slash" aria-hidden="true">/</span>}
      {branch !== null && <span className="mx-row-branch-name">{branch}</span>}
      {machine !== null && <span className="mx-row-machine">{machineLabel(machine)}</span>}
      {children}
    </span>
  )
}

const seenAt = new Map<string, number>()

/** When this window first saw the session, kept for as long as the window lives. */
function firstSeen(id: string): number {
  const before = seenAt.get(id)
  if (before !== undefined) return before
  const now = Date.now()
  seenAt.set(id, now)
  return now
}

/**
 * One session in the sidebar: the agent's mark, its name with its status icon at the far right (and a word when it stopped or
 * is held by its plan limit), and under it where it is (folder, project, branch, machine) with how long the session has run at the far right.
 * An idle row is dimmed.
 */
export function SessionRow({ session, selected, showProject, machine = null, onShow, onRename, onContextMenu }: Props) {
  const title = rowTitle(session)
  const active = !isShell(session) && session.status !== 'idle'
  const word = rowWord(session)
  const className = `mx-row${session.status === 'idle' ? ' is-idle' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${session.status === 'needs' ? ' is-needs' : ''}${isShell(session) ? ' is-shell' : ''}${session.status === 'unknown' ? ' is-offline' : ''}${session.status === 'limited' ? ' is-limited' : ''}`
  const icon = <span className="mx-row-agent"><AppIcon process={session.process} size={14} dimmed={session.status === 'idle' || session.status === 'unknown'} /></span>
  const status = <StatusIcon status={session.status} className="mx-row-status" />
  // The daemon does not say when a session began, so it is timed from when this window first saw it.
  const first = firstSeen(session.id)
  return (
    <button
      type="button"
      className={className}
      onPointerDown={(event) => { beginPointerDrag(event, { kind: 'session', id: session.id, label: title }) }}
      aria-label={`${title}, ${session.process}, ${session.status === 'limited' ? word : STATUS_WORD[session.status]}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onShow}
      onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); onRename() } }}
      onContextMenu={onContextMenu}
    >
      {icon}
      <span className="mx-row-text">
        <span className="mx-row-title">
          <span className="mx-row-name">{title}</span>
          {word !== '' && <span className="mx-row-word">{word}</span>}
          {status}
        </span>
        <PlaceLine session={session} showProject={showProject} machine={machine}>
          <span className="mx-row-when"><Ago at={first} /></span>
        </PlaceLine>
      </span>
    </button>
  )
}
