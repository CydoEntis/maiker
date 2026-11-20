import type { MouseEvent } from 'react'
import { StatusIcon } from '@/components/ui/status-icon'
import { machineTitle } from '../model/machines'
import { isShell, rowTitle, rowWord } from '../model/sidebar'
import type { WaitingSession } from '../model/sidebarTree'
import { MachineIcon } from './glyphs'
import { Ago } from './times'

type Props = {
  /** What waits on the person, the latest first (`waitingSessions`). Nothing is drawn while it is empty. */
  waiting: readonly WaitingSession[]
  focusedId: string | null
  onOpen: (entry: WaitingSession) => void
  onContextMenu: (event: MouseEvent, entry: WaitingSession) => void
}

/**
 * Every session that waits on the person, pinned above the tree: outside its scrolling list and whatever is folded, so
 * nothing that needs you is out of sight. Each row says where the session is (machine · project), since no heading above
 * it does; the session is still listed in its own project too.
 */
export function NeedsYouStrip({ waiting, focusedId, onOpen, onContextMenu }: Props) {
  if (waiting.length === 0) return null
  return (
    <section className="mx-needs-strip" aria-label="Needs you">
      <div className="mx-needs-head" aria-hidden="true">
        <span className="mx-section-name">Needs you</span>
        <span className="mx-section-count mono">{waiting.length}</span>
      </div>
      <div className="mx-rows mx-needs-rows" role="list" aria-label="Sessions that need you">
        {waiting.map((entry) => <WaitingRow key={entry.session.id} entry={entry} selected={entry.session.id === focusedId} onOpen={onOpen} onContextMenu={onContextMenu} />)}
      </div>
    </section>
  )
}

function WaitingRow({ entry, selected, onOpen, onContextMenu }: { entry: WaitingSession; selected: boolean } & Pick<Props, 'onOpen' | 'onContextMenu'>) {
  const { session, machine, project } = entry
  const title = rowTitle(session)
  const word = rowWord(session)
  const where = machineTitle(machine)
  return (
    <div className="mx-row-wrap" role="listitem">
      <button
        type="button"
        className={`mx-row${session.status === 'needs' ? ' is-needs' : ''}${selected ? ' is-selected' : ''}`}
        aria-label={`${title} on ${where} in ${project.name}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => { onOpen(entry) }}
        onContextMenu={(event) => { onContextMenu(event, entry) }}
      >
        <span className="mx-row-text">
          <span className="mx-row-title">
            <StatusIcon status={session.status} className="mx-row-status" />
            <span className="mx-row-name">{title}</span>
            {word !== '' && <span className="mx-row-word">{word}</span>}
            {!isShell(session) && session.statusSince !== null && <span className="mx-row-when"><Ago at={session.statusSince} /></span>}
          </span>
          <span className="mx-row-sub">
            <span className="mx-row-folder"><MachineIcon remote={machine.name !== null} size={12} /></span>
            {/* The accent marks another machine, as on every row; this computer's name is said plainly. */}
            <span className={machine.name === null ? 'mx-row-here' : 'mx-row-machine'}>{where}</span>
            <span className="mx-row-slash" aria-hidden="true">·</span>
            <span className="mx-row-project-name">{project.name}</span>
          </span>
        </span>
      </button>
    </div>
  )
}
