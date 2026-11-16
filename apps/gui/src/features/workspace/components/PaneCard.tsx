import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { MAX_PANES, type PaneSlot, type SplitDirection } from '../model/layout'
import { MAX_SESSION_NAME_LENGTH, STATUS_WORD, type SessionView } from '../model/session'
import { headerFit } from '../model/paneHeader'
import { keepsRunningUnseen, projectColor, projectOf, rowTitle } from '../model/sidebar'
import { InlineName } from './InlineName'
import { BranchMenu, type BranchMenuSpec } from '@/features/chat/components/BranchMenu'
import { AppIcon, Icon, StatusBadge } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { PaneViewSwitch, type WorkCount } from './PaneViewSwitch'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { menuPoint } from './menuPoint'
import { CHAT_AGENTS, type ChatAgent, type PaneShow, type PaneView } from '../model/chatView'
import { agentName } from '../model/agentMessage'
import { SecretAskBar } from './SecretAskBar'
import { pullRequestHeadline, pullRequestTone } from '../model/pullRequest'
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
  /** Present when the session reported workflow runs: the board it shows while open (opened from the window's Work button). */
  work?: WorkCount & { open: boolean; board: ReactNode; onOpen: () => void }
  /** What floats over the top of the body in either view: the agent's running subagents. */
  overlay?: ReactNode
  /** The side panel is open for this pane. */
  panelOpen: boolean
  /** Opens the side panel for this pane, or closes it; absent when the panel has nothing to show for it. */
  onPanel?: () => void
  /** Lines the repository says changed, for the dot on the side-panel button. */
  changed: { added: number; removed: number }
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
  const [naming, setNaming] = useState(false)
  const multi = paneCount > 1
  const full = paneCount >= MAX_PANES
  const ended = session.ended
  const view = props.view ?? 'terminal'
  const work = props.work
  // The Work board covers whichever view the pane was on; choosing that view again leaves it.
  const shown: PaneShow = work?.open === true ? 'work' : view
  const fit = headerFit(width)
  const title = rowTitle(session)
  // One pane of several closes alone when its session has work in it (`useClosing`); otherwise closing ends the session.
  const closeLabel = multi && keepsRunningUnseen(session) ? 'Close pane · its session keeps running' : 'Close pane · ends its session'

  // An agent's work can move to another agent; a shell or an ended session has none to move.
  const handoffItems: MenuEntry[] = CHAT_AGENTS.includes(session.process as ChatAgent) && !ended
    ? CHAT_AGENTS.filter((agent) => agent !== session.process).map((agent) => ({ label: `Hand off to ${agentName(agent)}`, disabled: !props.online, run: () => { props.onHandoff(agent) } }))
    : []

  const menuItems: MenuEntry[] = [
    { label: 'Split right', hint: shortcutText('split-right'), disabled: full, run: () => { props.onSplit(pane.id, 'right') } },
    { label: 'Split down', hint: shortcutText('split-down'), disabled: full, run: () => { props.onSplit(pane.id, 'down') } },
    ...(props.onPanel ? [{ label: 'Changes and files', hint: shortcutText('inspect'), run: props.onPanel }] : []),
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
    // The only pane has nothing to close but its session, which the sidebar's row does.
    ...(multi ? ['separator' as const, { label: 'Close pane', danger: true, run: () => { props.onClose(pane.id) } }] : []),
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
        <span className="mx-pane-icon" role="img" aria-label={`${agentName(session.process)} · ${STATUS_WORD[session.status]}`}>
          <AppIcon process={session.process} size={20} flat dimmed={session.status === 'unknown' || session.status === 'idle'} />
          <StatusBadge status={session.status} />
        </span>
        <span className="mx-pane-title">
          {naming && props.onSaveName !== undefined ? (
            <InlineName value={session.name ?? ''} placeholder={title} label="Session name" maxLength={MAX_SESSION_NAME_LENGTH} onCommit={(name) => { setNaming(false); props.onSaveName?.(name) }} onCancel={() => { setNaming(false) }} />
          ) : (
            <span className="mx-pane-name" title={props.onSaveName === undefined ? undefined : 'Double-click to rename'} onDoubleClick={props.onSaveName === undefined ? undefined : () => { setNaming(true) }}>{title}</span>
          )}
          <PaneCrumbs session={session} branchMenu={props.branchMenu} />
          {session.pr && (
            <span className={`mx-pane-pr is-${pullRequestTone(session.pr)}`} title={`${session.pr.title} (${session.pr.url})`}>{pullRequestHeadline(session.pr)}</span>
          )}
        </span>
        {props.broadcast && <span className="mx-broadcast-pill">◉ Broadcast</span>}
        <span className="mx-pane-controls">
          {props.onViewChange !== undefined && fit.switcher && (
            // While the Work board shows, neither view is underlined; choosing one leaves the board.
            <PaneViewSwitch views={['chat', 'terminal']} view={shown} work={null} onChange={(next) => { if (next !== 'work') props.onViewChange?.(next) }} />
          )}
          <button type="button" className="mx-pane-control mx-pane-more" aria-label="More pane actions" title="More pane actions" aria-haspopup="menu" onMouseDown={stop} onClick={(event) => { setMenuAt(menuPoint(event, true)) }}>⋯</button>
          {/* Kept on the only pane too: with the sidebar hidden, it is the one close in reach. */}
          <button type="button" className="mx-pane-control is-close" aria-label={closeLabel} title={closeLabel} onMouseDown={stop} onClick={() => { props.onClose(pane.id) }}><Icon name="close" /></button>
        </span>
      </div>
      <div
        className={`mx-pane-body${shown === 'chat' ? ' is-chat' : shown === 'work' ? ' is-work' : ''}`}
        onMouseDown={(event) => {
          // A click on the pane's padding still puts the cursor in its terminal.
          if (event.target !== event.currentTarget) return
          event.preventDefault()
          event.currentTarget.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
        }}
      >
        {props.terminal}
        {shown === 'chat' && props.chat}
        {/* Not under is-chat: that hides all but the chat layer, and hid the board with it. */}
        {shown === 'work' && work?.board}
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

/**
 * Where the chat works, after its name (layout 2h): its project, set when the chat started and so locked, then its branch,
 * which a session on this computer can switch from here. The pane's width decides how much shows (`pane.css`).
 */
function PaneCrumbs({ session, branchMenu }: { session: SessionView; branchMenu: BranchMenuSpec | undefined }) {
  const project = projectOf(session)
  return (
    <nav className="mx-crumbs" aria-label="Chat location">
      <span className="mx-crumb-sep is-project" aria-hidden="true">/</span>
      <span className="mx-crumb-project" title="Project · set when the chat started">
        <span className="mx-crumb-square" style={{ background: projectColor(project) }} aria-hidden="true" />
        <span className="mx-crumb-name">{project}</span>
        <Icon name="lock" size={10} />
      </span>
      {session.branch !== null && (
        <>
          <span className="mx-crumb-sep" aria-hidden="true">/</span>
          {branchMenu !== undefined ? (
            <BranchMenu spec={branchMenu} branch={session.branch} worktree={session.worktree} project={project} />
          ) : (
            <span className="mx-crumb is-static" title={session.worktree ? `Worktree: its own copy of the project, on branch ${session.branch}` : `Branch ${session.branch}`}>
              <span className={`mx-crumb-branch-icon${session.worktree ? ' is-worktree' : ''}`}><Icon name={session.worktree ? 'worktree' : 'branch'} size={12} /></span>
              <span className={`mx-crumb-branch${session.worktree ? ' is-worktree' : ''}`}>{session.branch}</span>
            </span>
          )}
        </>
      )}
    </nav>
  )
}
