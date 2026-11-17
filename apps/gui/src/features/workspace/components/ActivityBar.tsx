import { toast } from '@/lib/toast'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { checksNeedingYou } from '@/features/inspect/checks'
import type { InspectView } from '@/features/inspect/InspectPanel'
import { useWorkspace } from '../workspaceContext'

/** The 24px stroke paths of the bar's icons (layout 2h). */
const PATHS = {
  changes: 'M7 3v12a3 3 0 0 0 3 3h7M17 21l3-3-3-3M7 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  checks: 'M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9',
  tickets: 'M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 6v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-6zM14 5v14',
  terminal: 'M4 5h16v14H4zM8 10l2.5 2L8 14M13 14h3',
} as const

type Badge = { text: string; tone: 'plain' | 'danger' | 'needs' }

function ToolButton({ label, tip, path, on, badge, onClick }: { label: string; tip?: string; path: string; on: boolean; badge?: Badge | null; onClick: () => void }) {
  return (
    <button type="button" className={`mx-tool${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={label} title={tip ?? label} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
      {badge && <span className={`mx-tool-badge is-${badge.tone}`} aria-hidden="true">{badge.text}</span>}
    </button>
  )
}

/** The side panel's views, in the bar's order, with what each one's button is called. `more` ones show only when Settings adds them. */
const PANEL_TOOLS: readonly { view: InspectView; label: string; more?: true }[] = [
  { view: 'changes', label: 'Changes' },
  { view: 'files', label: 'Files', more: true },
  { view: 'history', label: 'History', more: true },
  { view: 'checks', label: 'Checks' },
]

/**
 * The tools bar down the window's right edge (layout 2h §3): Changes, Files, History and Checks open the side panel on
 * that view and close it when it already shows it; Tickets opens over the chat area; Terminal, at the foot, shows and
 * hides the focused session's terminal. Every tool works on a project,
 * so the bar shows only while a session is in front.
 */
export function ActivityBar() {
  const tip = useTipWithKeys()
  const { preferences, focusedSession, inspectOpen, inspectView, setInspectView, setInspectOpen, inspectRefusal, setTurnDiff, diffStat, ticketsOpen, setTicketsOpen, terminalShown, canDock, toggleTerminal } = useWorkspace()
  if (focusedSession === undefined) return null
  const session = focusedSession
  const pick = (view: InspectView) => {
    if (inspectOpen && inspectView === view) {
      setInspectOpen(false)
      setTurnDiff(null)
      return
    }
    if (inspectRefusal !== null) {
      toast.message(inspectRefusal)
      return
    }
    setTicketsOpen(false)
    setInspectView(view)
    setInspectOpen(true)
  }
  const changed = diffStat.data?.files ?? 0
  const failing = checksNeedingYou(session.checks)
  const badgeOf = (view: InspectView): Badge | null => {
    if (view === 'changes' && changed > 0) return { text: String(changed), tone: 'plain' }
    if (view === 'checks' && failing > 0) return { text: String(failing), tone: 'danger' }
    return null
  }
  return (
    <nav className="mx-tools" aria-label="Tools">
      {PANEL_TOOLS.filter((tool) => tool.more !== true || preferences.morePanelTools).map((tool) => (
        <ToolButton key={tool.view} label={tool.label} path={PATHS[tool.view as keyof typeof PATHS]} on={inspectOpen && inspectView === tool.view} badge={badgeOf(tool.view)} onClick={() => { pick(tool.view) }} {...(tool.view === 'changes' ? { tip: tip('Changes', 'inspect') } : {})} />
      ))}
      <ToolButton
        label="Tickets"
        tip="Tickets for this project"
        path={PATHS.tickets}
        on={ticketsOpen}
        onClick={() => {
          if (!ticketsOpen) setInspectOpen(false)
          setTicketsOpen(!ticketsOpen)
        }}
      />
      <span className="mx-tools-fill" />
      <ToolButton
        label="Terminal"
        tip={canDock ? tip(terminalShown ? 'Hide terminal' : 'Open terminal', 'terminal') : 'Terminal: open a session of this computer first'}
        path={PATHS.terminal}
        on={terminalShown}
        onClick={toggleTerminal}
      />
    </nav>
  )
}
