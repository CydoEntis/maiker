import type { MouseEvent } from 'react'
import { machineLabel } from '@/data/machineNicknames'
import { STATUS_WORD, type SessionView } from '../model/session'
import { isFreshSession, isShell, projectOf, rowTitle, rowWord } from '../model/sidebar'
import { StatusIcon } from '@/components/ui/status-icon'
import { MachineIcon } from './glyphs'
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
 * The line under a row's name, saying where the session is: the machine's icon (a monitor here, a server for another machine),
 * that machine's name in the accent colour when it is another one, then `project / worktree` (the worktree's name is its branch,
 * mono). `project` is null when a project heading above the row already says it.
 */
function PlaceLine({ session, project, machine }: { session: SessionView; project: string | null; machine: string | null }) {
  const worktree = session.worktree ? session.branch : null
  return (
    <span className="mx-row-sub">
      <span className="mx-row-folder"><MachineIcon remote={session.machineName !== null} size={12} /></span>
      {machine !== null && <span className="mx-row-machine">{machineLabel(machine)}</span>}
      {machine !== null && project !== null && <span className="mx-row-slash" aria-hidden="true">·</span>}
      {project !== null && <span className="mx-row-project-name">{project}</span>}
      {project !== null && worktree !== null && <span className="mx-row-slash" aria-hidden="true">/</span>}
      {worktree !== null && <span className="mx-row-branch-name">{worktree}</span>}
    </span>
  )
}

/**
 * One session in the sidebar, the same in every view. Line 1: its status mark, its name, a word when it stopped or is held by
 * its plan limit, and how long it has been in its state. Line 2: where it is (`PlaceLine`). What the agent is doing is the
 * hover card's, not the row's. An idle row is dimmed.
 */
export function SessionRow({ session, selected, showProject, machine = null, onShow, onRename, onContextMenu }: Props) {
  const title = rowTitle(session)
  const active = !isShell(session) && session.status !== 'idle'
  const word = rowWord(session)
  const className = `mx-row${session.status === 'idle' ? ' is-idle' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${session.status === 'needs' ? ' is-needs' : ''}${session.status === 'working' ? ' is-working' : ''}${isShell(session) ? ' is-shell' : ''}${isFreshSession(session) ? ' is-fresh' : ''}${session.status === 'unknown' ? ' is-offline' : ''}${session.status === 'limited' ? ' is-limited' : ''}`
  const project = showProject ? projectOf(session) : null
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
      <span className="mx-row-text">
        <span className="mx-row-title">
          <StatusIcon status={session.status} className="mx-row-status" />
          <span className="mx-row-name">{title}</span>
          {word !== '' && <span className="mx-row-word">{word}</span>}
          {/* A shell has no state worth timing. */}
          {!isShell(session) && session.statusSince !== null && <span className="mx-row-when"><Ago at={session.statusSince} /></span>}
        </span>
        <PlaceLine session={session} project={project} machine={machine} />
      </span>
    </button>
  )
}
