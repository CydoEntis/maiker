import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { MAX_PANES, type PaneSlot, type SplitDirection } from '../model/layout'
import { machineLabel } from '@/data/machineNicknames'
import { MAX_SESSION_NAME_LENGTH, STATUS_WORD, type SessionView } from '../model/session'
import { headerFit, shellProgram } from '../model/paneHeader'
import { isShell, keepsRunningUnseen, projectOf, rowTitle } from '../model/sidebar'
import { InlineName } from './InlineName'
import { BranchMenu, type BranchMenuSpec } from '@/features/chat/components/BranchMenu'
import { StatusIcon } from '@/components/ui/status-icon'
import type { InspectView } from '@/features/inspect/InspectPanel'
import { Icon } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { PaneViewSwitch } from './PaneViewSwitch'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { menuPoint } from './menuPoint'
import { CHAT_AGENTS, type ChatAgent, type PaneView } from '../model/chatView'
import { agentName } from '../model/agentMessage'
import { SecretAskBar } from './SecretAskBar'
import { useShortcutText } from '@/features/shortcuts/platform'

export type PaneCardProps = {
  pane: PaneSlot
  index: number
  session: SessionView
  paneCount: number
  /** Typing in any pane of this layout goes to its idle ones too. */
  broadcast: boolean
  focused: boolean
  maximized: boolean
  dropTarget: boolean
  /** This pane is the one being dragged. */
  dragging: boolean
  /** What letting go over this pane does, said on it while it is the target. */
  dropWord: string
  terminal: ReactNode
  /** The view the pane shows. The terminal stays mounted under the chat, so it keeps streaming and keeps its size. */
  view?: PaneView
  /** Present when the pane has a terminal | chat switch; picking a view sends nothing to the daemon. */
  onViewChange?: (view: PaneView) => void
  /** The chat that covers the terminal while `view` is `chat`. */
  chat?: ReactNode
  /** What floats over the top of the body in either view: the agent's running subagents. */
  overlay?: ReactNode
  /** The view the side panel shows for this pane; null while it is closed or shows another pane. */
  panelView: InspectView | null
  /** Opens the side panel for this pane on a view, or closes it when it already shows that; absent when the panel has nothing to show for it. */
  onPanel?: (view: InspectView) => void
  /** Files the repository says changed: the badge on the Changes button; 0 shows none. */
  changedFiles: number
  /** Checks of the pull request that fail: said beside Checks in the ⋯ menu. */
  failingChecks: number
  /** Opens the project's tickets over the chat area; absent where there are none to open. */
  onTickets?: () => void
  /** Shows or hides the terminal dock; absent where the session cannot have one. */
  onToggleTerminal?: () => void
  terminalShown: boolean
  /** For an agent that can have terminals of its own: opens another in the terminal dock. Absent for a shell, which is one. */
  onNewTerminal?: () => void
  online: boolean
  /** Where portalled menus mount, so they read the theme's colours. */
  portalContainer: HTMLElement | null
  onFocus: (paneId: string) => void
  onSplit: (paneId: string, direction: SplitDirection) => void
  onToggleMaximize: (paneId: string) => void
  onClose: (paneId: string) => void
  /** Clears a shell's screen, as Ctrl+L does in it. */
  onClear: () => void
  onCopyPath: () => void
  onRename: () => void
  /** Saves a name typed into the title, which a double-click on it opens; without it the title is only shown. */
  onSaveName?: (name: string) => void
  /** Before the agent's tile: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
  /** Where the branch crumb can switch the chat's branch (a session on this computer); without it the branch is only said. */
  branchMenu?: BranchMenuSpec | undefined
  /** Starts another agent beside this one's work, with a brief of it. */
  onHandoff: (agent: ChatAgent) => void
  /** Starts a new shell in an ended pane's folder, in its place. */
  onRestart: (paneId: string) => void
  /** Answers the session's request to start helpers; absent where it cannot be answered. */
  onAnswerHelpers?: (choice: 'allow' | 'always' | 'no') => void
}

/** The pane's width as it is laid out, so its header can give up controls as it narrows. */
function useWidth(): [React.RefObject<HTMLElement | null>, number | null] {
  const element = useRef<HTMLElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const target = element.current
    if (!target || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setWidth(Math.round(box.width))
    })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [])
  return [element, width]
}

const stop = (event: MouseEvent) => { event.stopPropagation() }

export function PaneCard(props: PaneCardProps) {
  const { pane, session, paneCount, focused, maximized } = props
  const shortcutText = useShortcutText()
  const [box, width] = useWidth()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const menuWasOpen = useRef(false)
  const [naming, setNaming] = useState(false)
  const multi = paneCount > 1
  const full = paneCount >= MAX_PANES
  const ended = session.ended
  const view = props.view ?? 'terminal'
  const shown = view
  const fit = headerFit(width)
  const title = rowTitle(session)
  const shell = isShell(session)
  const changesTip = shortcutText('inspect') === '' ? 'Changes' : `Changes · ${shortcutText('inspect')}`
  // One pane of several closes alone when its session has work in it (`useClosing`); otherwise closing ends the session.
  const closeLabel = multi && keepsRunningUnseen(session) ? 'Close pane · its session keeps running' : 'Close pane · ends its session'

  // An agent's work can move to another agent; a shell or an ended session has none to move.
  const handoffItems: MenuEntry[] = CHAT_AGENTS.includes(session.process as ChatAgent) && !ended
    ? CHAT_AGENTS.filter((agent) => agent !== session.process).map((agent) => ({ label: `Hand off to ${agentName(agent)}`, disabled: !props.online, run: () => { props.onHandoff(agent) } }))
    : []

  // What the removed tools bar held, behind the ⋯: the side panel's four views, Tickets and the terminal dock.
  const toolItems: MenuEntry[] = [
    ...(props.onPanel === undefined ? [] : PANEL_VIEWS.map(({ view, label }) => ({
      label,
      hint: view === 'changes' ? shortcutText('inspect') : view === 'checks' && props.failingChecks > 0 ? `${String(props.failingChecks)} failed` : props.panelView === view ? 'Open' : '',
      run: () => { props.onPanel?.(view) },
    }))),
    ...(props.onTickets === undefined ? [] : [{ label: 'Tickets', run: props.onTickets }]),
    ...(props.onToggleTerminal === undefined ? [] : [{ label: props.terminalShown ? 'Hide terminal' : 'Terminal', hint: shortcutText('terminal'), run: props.onToggleTerminal }]),
  ]

  const menuItems: MenuEntry[] = [
    ...(toolItems.length > 0 ? [...toolItems, 'separator' as const] : []),
    { label: 'Split right', hint: shortcutText('split-right'), disabled: full, run: () => { props.onSplit(pane.id, 'right') } },
    { label: 'Split down', hint: shortcutText('split-down'), disabled: full, run: () => { props.onSplit(pane.id, 'down') } },
    ...handoffItems,
    'separator',
    { label: 'Rename…', hint: 'F2', run: props.onRename },
    { label: maximized ? 'Restore layout' : 'Maximize pane', disabled: !multi && !maximized, run: () => { props.onToggleMaximize(pane.id) } },
    ...(props.onViewChange
      ? [{ label: view === 'chat' ? 'Show terminal' : 'Show chat', hint: shortcutText('chat-toggle'), run: () => { props.onViewChange?.(view === 'chat' ? 'terminal' : 'chat') } }]
      : []),
    ...(props.onNewTerminal === undefined
      ? [{ label: 'Clear', hint: 'Ctrl+L', disabled: !props.online || ended, run: props.onClear }, { label: 'Copy folder path', run: props.onCopyPath }]
      : [{ label: 'New terminal', disabled: !props.online, run: props.onNewTerminal }]),
    // The header has no close button; with the sidebar hidden this is the one close in reach, on the only pane too.
    'separator',
    { label: closeLabel, danger: true, run: () => { props.onClose(pane.id) } },
  ]

  return (
    <>
    <section
      ref={box}
      className={`mx-pane${shown === 'terminal' ? ' is-terminal' : ' is-chat'}${multi ? ' is-card' : ''}${focused && multi ? ' is-focused' : ''}${props.broadcast ? ' is-broadcast' : ''}${props.dropTarget ? ' is-drop-target' : ''}${props.dragging ? ' is-dragging' : ''}`}
      aria-label={`Terminal ${String(props.index + 1)}: ${session.cwdLabel}${focused ? ', focused' : ''}`}
      data-session-id={session.id}
      data-pane={pane.id}
      onMouseDown={() => { props.onFocus(pane.id) }}
      onContextMenu={(event) => {
        // The terminal's own area opens the pane menu too; only the chat's text boxes keep the system menu.
        if (event.target instanceof Element && event.target.closest('textarea:not(.xterm-helper-textarea), input')) return
        event.preventDefault()
        setMenuAt(menuPoint(event, false))
      }}
    >
      <div
        className={`mx-pane-head${multi ? ' is-draggable' : ''}`}
        title={multi ? 'Drag to move this pane' : undefined}
        onPointerDown={(event) => {
          // Buttons in the header keep their own clicks; only the bar itself starts a drag.
          if (multi && !(event.target instanceof Element && event.target.closest('button, input'))) beginPointerDrag(event, { kind: 'pane', id: pane.id, label: title })
        }}
      >
        {props.leading}
        <div className={`mx-pane-id${shell ? ' is-shell' : ''}`}>
          <span className="mx-pane-icon" role="img" aria-label={`${agentName(session.process)} · ${STATUS_WORD[session.status]}`}>
            <StatusIcon status={session.status} />
          </span>
          <span className="mx-pane-title">
            {naming && props.onSaveName !== undefined ? (
              <InlineName value={session.name ?? ''} placeholder={title} label="Session name" maxLength={MAX_SESSION_NAME_LENGTH} onCommit={(name) => { setNaming(false); props.onSaveName?.(name) }} onCancel={() => { setNaming(false) }} />
            ) : props.onSaveName === undefined ? (
              <span className="mx-pane-name">{shell ? `${session.name ?? shellProgram(session)} · ${session.cwdLabel}` : title}</span>
            ) : (
              // One click renames: the name is a plain button, so a press on it is never the start of a drag.
              <button type="button" className="mx-pane-name is-editable" aria-label={`Rename ${title}`} onMouseDown={stop} onClick={() => { setNaming(true) }}>{shell ? `${session.name ?? shellProgram(session)} · ${session.cwdLabel}` : title}</button>
            )}
          </span>
          {!shell && <PaneCrumbs session={session} branchMenu={props.branchMenu} />}
        </div>
        {props.broadcast && <span className="mx-broadcast-pill">◉ Broadcast</span>}
        <span className="mx-pane-controls">
          {props.onViewChange !== undefined && fit.switcher && (
            <PaneViewSwitch views={['chat', 'terminal']} view={shown} onChange={(next) => { props.onViewChange?.(next) }} />
          )}
          {props.onPanel !== undefined && (
            <>
              <button type="button" className={`mx-pane-control${props.panelView === 'changes' ? ' is-on' : ''}`} aria-label="Changes" title={changesTip} aria-pressed={props.panelView === 'changes'} onMouseDown={stop} onClick={() => { props.onPanel?.('changes') }}>
                <Icon name="gitChanges" />
                {props.changedFiles > 0 && <span className="mx-pane-count" aria-label={`${String(props.changedFiles)} changed`}>{props.changedFiles}</span>}
              </button>
              <button type="button" className={`mx-pane-control${props.panelView === 'files' ? ' is-on' : ''}`} aria-label="Files" title="Files" aria-pressed={props.panelView === 'files'} onMouseDown={stop} onClick={() => { props.onPanel?.('files') }}><Icon name="files" size={15} /></button>
            </>
          )}
          <button
            type="button"
            className="mx-pane-control mx-pane-more"
            aria-label="More pane actions"
            title="More pane actions"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            // The open menu closes itself on this press, before the click: the click must not open it again.
            onPointerDown={() => { menuWasOpen.current = menuAt !== null }}
            onMouseDown={stop}
            onClick={(event) => { if (!menuWasOpen.current) setMenuAt(menuPoint(event, true)) }}
          ><Icon name="more" /></button>
        </span>
      </div>
      <div
        className={`mx-pane-body${shown === 'chat' ? ' is-chat' : ''}`}
        onMouseDown={(event) => {
          // A click on the pane's padding still puts the cursor in its terminal.
          if (event.target !== event.currentTarget) return
          event.preventDefault()
          event.currentTarget.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
        }}
      >
        {props.terminal}
        {shown === 'chat' && props.chat}
        {props.overlay}
      </div>
      {session.helperAsk.length > 0 && props.onAnswerHelpers && (
        <div className="mx-pane-ended is-ask" role="alert" aria-label="Wants to start helpers">
          <span className="mx-pane-ended-text">
            <strong>{`Wants to start ${String(session.helperAsk.length)} helper${session.helperAsk.length === 1 ? '' : 's'}`}</strong>
            <small title={session.helperAsk.join('\n')}>{session.helperAsk.join(' · ')}</small>
          </span>
          <button type="button" className="mx-pane-ended-button is-primary" disabled={!props.online} title="This session may start helpers from now on" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('allow') }}>Allow</button>
          <button type="button" className="mx-pane-ended-button" disabled={!props.online} title="Every session of this project may, from now on" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('always') }}>Always in this project</button>
          <button type="button" className="mx-pane-ended-button" disabled={!props.online} title="It does the work alone" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('no') }}>No</button>
        </div>
      )}
      {session.secretAsk.map((ask) => <SecretAskBar key={ask.id} ask={ask} machine={session.machine} online={props.online} />)}
      {ended && (
        <div className="mx-pane-ended" role="status" aria-label="Session ended">
          <span className="mx-pane-ended-text"><strong>Session ended</strong><small>Its output is kept above.</small></span>
          <button type="button" className="mx-pane-ended-button is-primary" disabled={!props.online} onMouseDown={stop} onClick={() => { props.onRestart(pane.id) }}>Restart shell</button>
          <button type="button" className="mx-pane-ended-button" onMouseDown={stop} onClick={() => { props.onClose(pane.id) }}>Close pane</button>
        </div>
      )}
      {props.dropTarget && <span className="mx-pane-drop" aria-hidden="true">{props.dropWord}</span>}
      <span className="mx-pane-ring" aria-hidden="true" />
    </section>
    {/* Beside the pane, not in it: a pane has `contain: paint`, which would place the menu's fixed anchor from the pane's corner. */}
    {menuAt && <MenuPopup key={`${String(menuAt.x)},${String(menuAt.y)}`} title={title} untitled at={menuAt} items={menuItems} portalContainer={props.portalContainer} onClose={() => { setMenuAt(null) }} />}
    </>
  )
}

/** The side panel's views the ⋯ menu lists, in the design's order. */
const PANEL_VIEWS: readonly { view: InspectView; label: string }[] = [
  { view: 'changes', label: 'Changes' },
  { view: 'files', label: 'Files' },
  { view: 'history', label: 'History' },
  { view: 'checks', label: 'Checks' },
]

/**
 * The header's second line: the folder (locked when the chat has a worktree of its own), its project, `/`, its branch,
 * which a session on this computer can switch from here, and the other machine it runs on. The pane's width decides how
 * much shows (`pane.css`).
 */
function PaneCrumbs({ session, branchMenu }: { session: SessionView; branchMenu: BranchMenuSpec | undefined }) {
  const project = projectOf(session)
  return (
    <nav className="mx-crumbs" aria-label="Chat location">
      <span className="mx-crumb-folder"><Icon name={session.worktree ? 'folderLocked' : 'folderPlain'} size={14} /></span>
      <span className="mx-crumb-project">
        <span className="mx-crumb-name">{project}</span>
      </span>
      {session.branch !== null && (
        <>
          <span className="mx-crumb-sep" aria-hidden="true">/</span>
          {branchMenu !== undefined ? (
            <BranchMenu spec={branchMenu} branch={session.branch} worktree={session.worktree} project={project} />
          ) : (
            <span className="mx-crumb is-static">
              <span className={`mx-crumb-branch-icon${session.worktree ? ' is-worktree' : ''}`}><Icon name={session.worktree ? 'worktree' : 'branch'} size={12} /></span>
              <span className={`mx-crumb-branch${session.worktree ? ' is-worktree' : ''}`}>{session.branch}</span>
            </span>
          )}
        </>
      )}
      {session.machineName !== null && (
        <>
          <span className="mx-crumb-dot" aria-hidden="true">·</span>
          <span className="mx-crumb-machine">{machineLabel(session.machineName)}</span>
        </>
      )}
    </nav>
  )
}
