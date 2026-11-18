import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { ChangesTab, type TurnScope } from './ChangesTab'
import { ChecksTab } from './ChecksTab'
import { checksNeedingYou, type Check } from './checks'
import type { ChangeActions } from './CommitBar'
import type { PatchComments } from './PatchView'
import { FilesTab, type DocumentLauncher, type LookAt } from './FilesTab'
import { HistoryTab } from './HistoryTab'
import { ReferencesTab } from './ReferencesTab'
import { TimelineTab } from './TimelineTab'
import { LOCAL_MACHINE } from '@/api/machines'
import type { TerminalDetails } from '@/data/preview'
import { localOnlyMessage } from '@/lib/localOnly'
import { Icon, type IconName } from '@/features/workspace/components/glyphs'
import './inspect.css'

/** The side panel's views (layout 2h): the tools bar picks one. Terminals live in the terminal dock, not here. */
export type InspectView = 'changes' | 'files' | 'history' | 'checks'

const VIEWS: Record<InspectView, { label: string; icon: IconName }> = {
  changes: { label: 'Changes', icon: 'changes' },
  files: { label: 'Files', icon: 'files' },
  history: { label: 'History', icon: 'history' },
  checks: { label: 'Checks', icon: 'list' },
}

/** The panel opens this wide; its edge drags between the two bounds, and the width is remembered. */
const DEFAULT_WIDTH_PX = 680
const MIN_WIDTH_PX = 360
const MAX_WIDTH_PX = 1100
const KEY_STEP_PX = 24
// A new key since the panel docks beside the chat instead of over it, so a width kept from the overlay does not carry.
const WIDTH_KEY = 'maitty.inspect.width.v4'

function clampWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, MIN_WIDTH_PX), MAX_WIDTH_PX))
}

/** The width someone dragged it to, or null for the default. */
function readWidth(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(stored) && stored >= MIN_WIDTH_PX ? clampWidth(stored) : null
  } catch {
    return null
  }
}

function writeWidth(width: number | null): void {
  try {
    if (width === null) window.localStorage.removeItem(WIDTH_KEY)
    else window.localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // The width is only remembered, never needed.
  }
}

type Props = {
  /** The daemon's pane number every repository question is about; null when there is none to ask, and Changes and Files are left out. */
  term: number | null
  /** How many files the repository says changed, shown beside Changes. */
  changedFiles: number
  /** The branch the session's checkout is on. */
  branch?: string
  view: InspectView
  agentWorking: boolean
  /** The session's checks, for the Checks view. */
  checks?: readonly Check[]
  /** The machine the session is on (0: this computer): its daemon answers Changes and Checks, and the views that read files say they cannot. */
  machine?: number
  /** That machine's name, for those words; null on this computer. */
  machineName?: string | null
  /** What the pane's agent and shell reported lately, for History's status log. */
  timeline: TerminalDetails['timeline']
  lookAt: LookAt | null
  /** Opens a markdown file beside the chat (the Files tab offers it), and names the checkout. */
  documents?: DocumentLauncher
  /** The agent a comment on a diff line goes to; absent for a shell, which has nobody to tell. */
  comments?: Omit<PatchComments, 'path' | 'sent' | 'onSent'>
  /** The Changes view's commit area: Commit, the remote button and Create PR, run where the checkout is. */
  changeActions?: ChangeActions
  /** The turn a chat's changes row asked about, for the Changes view. */
  turnScope?: TurnScope
  /** It is sliding out: drawn, but not clicked. */
  leaving?: boolean
  onClose: () => void
  onNotice: (text: string) => void
}

function HistoryView({ term, agentWorking, elsewhere, machineName, timeline, onNotice }: { term: number; agentWorking: boolean; elsewhere: boolean; machineName: string | null; timeline: TerminalDetails['timeline']; onNotice: (text: string) => void }) {
  const [part, setPart] = useState<'snapshots' | 'status'>(elsewhere ? 'status' : 'snapshots')
  return (
    <div className="mx-history">
      <div className="mx-history-bar">
        <Segmented aria-label="History" value={part} onValueChange={(value) => { setPart(value === 'status' ? 'status' : 'snapshots') }}>
          <SegmentedItem value="snapshots">Snapshots</SegmentedItem>
          <SegmentedItem value="status">Status log</SegmentedItem>
        </Segmented>
        <span className="mx-history-sub">{part === 'snapshots' ? 'Taken before every agent turn' : 'Why the status changed'}</span>
      </div>
      {part === 'status' && <TimelineTab events={timeline} />}
      {part === 'snapshots' && (elsewhere ? <p className="mx-inspect-note">{localOnlyMessage('history', machineName)}</p> : <HistoryTab term={term} agentWorking={agentWorking} onNotice={onNotice} />)}
    </div>
  )
}

function FilesView({ term, machine, machineName, lookAt, documents }: { term: number; machine: number; machineName: string | null; lookAt: LookAt | null; documents?: DocumentLauncher | undefined }) {
  const [references, setReferences] = useState(false)
  // Another machine's files list and open as Markdown documents only (ADR 0014); its references stay there.
  if (machine !== LOCAL_MACHINE) return <FilesTab term={term} machine={machine} machineName={machineName} lookAt={lookAt} documents={documents} />
  if (!references) return <FilesTab term={term} machine={machine} lookAt={lookAt} documents={documents} onReferences={() => { setReferences(true) }} />
  return (
    <div className="mx-inspect-body">
      <nav className="mx-inspect-crumbs" aria-label="Where you are">
        <button type="button" onClick={() => { setReferences(false) }}>Files</button>
        <span aria-hidden="true">›</span>
        <span>References</span>
      </nav>
      <ReferencesTab term={term} />
    </div>
  )
}

/**
 * The side panel (layout 2h): docked beside the chat, which narrows to make room, with no scrim. It slides in from the
 * window's edge; its header names the view the tools bar picked, with that view's count, and a close button.
 */
export function InspectPanel({ term, changedFiles, branch, view, agentWorking, timeline, checks = [], machine = 0, machineName = null, lookAt, documents, comments, changeActions, turnScope, leaving = false, onClose, onNotice }: Props) {
  const [dragged, setDragged] = useState(readWidth)
  const width = dragged ?? DEFAULT_WIDTH_PX
  const save = useCallback((next: number | null) => {
    setDragged(next)
    writeWidth(next)
  }, [])
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const from = event.clientX
    const start = width
    // The panel's inner edge faces the chat: on the window's right it grows leftwards.
    const onRight = document.querySelector('.mx-app')?.getAttribute('data-side') !== 'right'
    const at = (pointer: PointerEvent) => clampWidth(onRight ? start + from - pointer.clientX : start + pointer.clientX - from)
    const move = (pointer: PointerEvent) => { setDragged(at(pointer)) }
    const stop = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      save(at(pointer))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') save(clampWidth(width + KEY_STEP_PX))
    else if (event.key === 'ArrowRight') save(clampWidth(width - KEY_STEP_PX))
  }
  const failing = checksNeedingYou(checks)
  const count = view === 'changes' && changedFiles > 0 ? String(changedFiles) : view === 'checks' && failing > 0 ? `✕${String(failing)}` : null
  return (
    <aside
      className={`mx-inspect${leaving ? ' is-leaving' : ''}`}
      style={{ width: `min(${String(width)}px, var(--inspect-max))` }}
      aria-label="Side panel"
      inert={leaving}
      onKeyDown={(event) => {
        // Esc closes the panel, except in a terminal, where it belongs to the program running there.
        if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('.mx-tdock'))) return
        event.stopPropagation()
        onClose()
      }}
    >
      <div className="mx-inspect-grip" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" title="Drag to resize" tabIndex={0} onPointerDown={startDrag} onKeyDown={nudge} onDoubleClick={() => { save(null) }} />
      <header className="mx-inspect-head">
        <Icon name={VIEWS[view].icon} size={13} />
        <h2 className="mx-inspect-title">{VIEWS[view].label}</h2>
        {count !== null && <span className={`mx-inspect-count${view === 'checks' ? ' is-bad' : ''}`}>{count}</span>}
        <span className="mx-spacer" />
        <button type="button" className="mx-inspect-close" aria-label="Close" title="Close (Esc)" onClick={onClose}><Icon name="close" size={12} /></button>
      </header>
      {term !== null && (
        <div className="mx-inspect-scroll">
          {view === 'files' && <FilesView term={term} machine={machine} machineName={machineName} lookAt={lookAt} documents={documents} />}
          {view === 'changes' && <ChangesTab term={term} machine={machine} {...(branch !== undefined ? { branch } : {})} {...(comments ? { comments } : {})} {...(changeActions ? { actions: changeActions } : {})} {...(turnScope ? { scope: turnScope } : {})} onNotice={onNotice} />}
          {view === 'checks' && <ChecksTab term={term} machine={machine} checks={checks} onNotice={onNotice} />}
          {view === 'history' && <HistoryView term={term} agentWorking={agentWorking} elsewhere={machine !== LOCAL_MACHINE} machineName={machineName} timeline={timeline} onNotice={onNotice} />}
        </div>
      )}
    </aside>
  )
}
