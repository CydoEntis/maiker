import { toast } from '@/lib/toast'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { checksNeedingYou } from '@/features/inspect/checks'
import type { InspectView } from '@/features/inspect/InspectPanel'
import { useWorkspace } from '../workspaceContext'
import { useTerminalToggle } from '../useTerminalToggle'

/** The 24px stroke paths of the bar's icons (layout 2h). */
const PATHS = {
  work: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z',
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

/** The side panel's views, in the bar's order, with what each one's button is called. */
const PANEL_TOOLS: readonly { view: InspectView; label: string }[] = [
  { view: 'changes', label: 'Changes' },
  { view: 'files', label: 'Files' },
  { view: 'history', label: 'History' },
  { view: 'checks', label: 'Checks' },
]

/**
 * The tools bar down the window's right edge (layout 2h §3): Changes, Files, History and Checks open the side panel on
 * that view and close it when it already shows it; Tickets opens over the chat area; Terminal, at the foot, shows and
 * hides the focused session's terminal. A chat that runs a workflow gets Work at the top.
 */
export function ActivityBar() {
  const tip = useTipWithKeys()
  const { focusedSession, inspectOpen, inspectView, setInspectView, setInspectOpen, inspectRefusal, setTurnDiff, diffStat, ticketsOpen, setTicketsOpen, paneViews, newChatOpen } = useWorkspace()
  const terminal = useTerminalToggle()
  const session = focusedSession ?? null
  const pick = (view: InspectView) => {
    if (inspectOpen && inspectView === view) {
      setInspectOpen(false)
      setTurnDiff(null)
      return
    }
    if (session === null) {
      toast.message('Open a session first')
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
  const failing = session === null ? 0 : checksNeedingYou(session.checks)
  const badgeOf = (view: InspectView): Badge | null => {
    if (view === 'changes' && changed > 0) return { text: String(changed), tone: 'plain' }
    if (view === 'checks' && failing > 0) return { text: String(failing), tone: 'danger' }
    return null
  }
  const runs = session?.workflows ?? []
  const workOn = session !== null && paneViews.work.has(session.id)
  const live = runs.filter((run) => run.active).length
  const needs = runs.some((run) => run.active && run.needsYou)
  return (
    <nav className="mx-tools" aria-label="Tools">
      {session !== null && runs.length > 0 && !newChatOpen && (
        <>
          <ToolButton
            label="Work"
            tip={workOn ? 'Back to the chat' : `Work: ${String(live)} ${live === 1 ? 'ticket' : 'tickets'} running`}
            path={PATHS.work}
            on={workOn}
            badge={needs ? { text: '!', tone: 'needs' } : live > 0 ? { text: String(live), tone: 'plain' } : null}
            onClick={() => {
              if (workOn) paneViews.hideWork(session.id)
              else {
                setInspectOpen(false)
                paneViews.showWork(session.id)
              }
            }}
          />
          <span className="mx-tools-divider" aria-hidden="true" />
        </>
      )}
      {PANEL_TOOLS.map((tool) => (
        <ToolButton key={tool.view} label={tool.label} path={PATHS[tool.view as keyof typeof PATHS]} on={inspectOpen && inspectView === tool.view} badge={badgeOf(tool.view)} onClick={() => { pick(tool.view) }} {...(tool.view === 'changes' ? { tip: tip('Changes', 'inspect') } : {})} />
      ))}
      <ToolButton
        label="Tickets"
        tip={session === null ? 'Tickets: open a chat first' : 'Tickets for this project'}
        path={PATHS.tickets}
        on={ticketsOpen}
        onClick={() => {
          if (!ticketsOpen) setInspectOpen(false)
          setTicketsOpen(!ticketsOpen)
        }}
      />
      <span className="mx-tools-fill" />
      <ToolButton label="Terminal" tip={terminal.tip} path={PATHS.terminal} on={terminal.shown} onClick={terminal.toggle} />
    </nav>
  )
}
