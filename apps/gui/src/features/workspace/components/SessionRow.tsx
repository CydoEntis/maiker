import type { MouseEvent } from 'react'
import { machineLabel } from '@/data/machineNicknames'
import { MAX_SESSION_NAME_LENGTH, STATUS_WORD, type SessionView } from '../model/session'
import { isShell, projectOf, rowTitle, rowWord } from '../model/sidebar'
import { StatusIcon } from '@/components/ui/status-icon'
import { AppIcon, Icon } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { InlineName } from './InlineName'
import { Ago } from './times'

type Props = {
  session: SessionView
  selected: boolean
  /** Inside a project group the project is in the heading, so the row leaves it out. */
  showProject: boolean
  /** The real name of the other machine the session runs on, when no heading above the row says so. */
  machine?: string | null
  renaming: boolean
  onShow: () => void
  onRename: () => void
  onSetName: (name: string) => void
  onCancelRename: () => void
  onContextMenu: (event: MouseEvent) => void
}

/**
 * The line under a row's name, saying where the session is: a folder icon, its project, `/`, its branch (mono; the tree
 * icon when it runs in a worktree of its own), and the other machine it runs on at the right.
 */
function PlaceLine({ session, showProject, machine }: { session: SessionView; showProject: boolean; machine: string | null }) {
  const branch = session.branch
  return (
    <span className="mx-row-sub">
      <span className="mx-row-folder" aria-hidden="true"><Icon name="folder" size={12} /></span>
      {showProject && <span className="mx-row-project-name">{projectOf(session)}</span>}
      {showProject && branch !== null && <span className="mx-row-slash" aria-hidden="true">/</span>}
      {branch !== null && <span className="mx-row-branch-name">{branch}</span>}
      {machine !== null && <span className="mx-row-machine">{machineLabel(machine)}</span>}
      <span className="mx-row-agent"><AppIcon process={session.process} size={14} dimmed={session.status === 'idle' || session.status === 'unknown'} /></span>
    </span>
  )
}

/**
 * One session in the sidebar: its 14px status icon, its name with how long it has been in its state (or a word when it
 * stopped or is held by its plan limit) at the right, and under it where it is (folder, project, branch, machine) and the agent's mark.
 * An idle row is dimmed.
 */
export function SessionRow({ session, selected, showProject, machine = null, renaming, onShow, onRename, onSetName, onCancelRename, onContextMenu }: Props) {
  const title = rowTitle(session)
  const active = !isShell(session) && session.status !== 'idle'
  const word = rowWord(session)
  const className = `mx-row${session.status === 'idle' ? ' is-idle' : ''}${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${session.status === 'needs' ? ' is-needs' : ''}${isShell(session) ? ' is-shell' : ''}${session.status === 'unknown' ? ' is-offline' : ''}${session.status === 'limited' ? ' is-limited' : ''}`
  const icon = <StatusIcon status={session.status} className="mx-row-icon" />
  if (renaming) {
    return (
      <div className={className} onContextMenu={onContextMenu}>
        {icon}
        <span className="mx-row-text">
          <InlineName value={session.name ?? ''} placeholder={title} label="Session name" maxLength={MAX_SESSION_NAME_LENGTH} onCommit={onSetName} onCancel={onCancelRename} />
          <PlaceLine session={session} showProject={showProject} machine={machine} />
        </span>
      </div>
    )
  }
  return (
    <button
      type="button"
      className={className}
      onPointerDown={(event) => { beginPointerDrag(event, { kind: 'session', id: session.id, label: title }) }}
      aria-label={`${title}, ${session.process}, ${session.status === 'limited' ? word : STATUS_WORD[session.status]}`}
      aria-current={selected ? 'page' : undefined}
      onClick={onShow}
      onDoubleClick={(event) => { event.preventDefault(); onRename() }}
      onKeyDown={(event) => { if (event.key === 'F2') { event.preventDefault(); onRename() } }}
      onContextMenu={onContextMenu}
    >
      {icon}
      <span className="mx-row-text">
        <span className="mx-row-title">
          <span className="mx-row-name">{title}</span>
          {word !== '' && <span className="mx-row-word">{word}</span>}
          {/* How long the agent has been in this state; a shell has no state worth timing. */}
          {word === '' && !isShell(session) && session.statusSince !== null && <span className="mx-row-when"><Ago at={session.statusSince} /></span>}
        </span>
        <PlaceLine session={session} showProject={showProject} machine={machine} />
      </span>
    </button>
  )
}
