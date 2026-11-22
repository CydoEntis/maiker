import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { MAX_PANES, type PaneSlot, type SplitDirection } from '../model/layout'
import type { SessionView } from '../model/session'
import { isShell, projectOf, rowTitle } from '../model/sidebar'
import { BranchMenu, type BranchMenuSpec } from '@/features/chat/components/BranchMenu'
import { Icon } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { menuPoint } from './menuPoint'
import type { PaneView } from '../model/chatView'
import { SecretAskBar } from './SecretAskBar'
import { PaneHeadId } from './PaneHeadId'
import { PaneFooter } from './PaneFooter'
import { useShortcutText } from '@/features/shortcuts/platform'
import { IconButton } from '@/components/ui/icon-button'

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
  /** The view the pane shows: the app-wide one (Settings › Open sessions in). The terminal stays mounted under the chat, so it keeps streaming and keeps its size. */
  view?: PaneView
  /** The chat that covers the terminal while `view` is `chat`. */
  chat?: ReactNode
  /** What floats over the top of the body in either view: the agent's running subagents. */
  overlay?: ReactNode
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
  /** Before the agent's tile: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
  /** Where the branch crumb can switch the chat's branch (a session on this computer); without it the branch is only said. */
  branchMenu?: BranchMenuSpec | undefined
  /** Starts a new shell in an ended pane's folder, in its place. */
  onRestart: (paneId: string) => void
  /** Answers the session's request to start helpers; absent where it cannot be answered. */
  onAnswerHelpers?: (choice: 'allow' | 'always' | 'no') => void
  /** The chat shown in the pane asks the helpers question itself, over its message box, so the bar here stays out. */
  helpersAskedInChat?: boolean
}

const stop = (event: MouseEvent) => { event.stopPropagation() }

export function PaneCard(props: PaneCardProps) {
  const { pane, session, paneCount, focused, maximized } = props
  const shortcutText = useShortcutText()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const menuWasOpen = useRef(false)
  const multi = paneCount > 1
  const full = paneCount >= MAX_PANES
  const ended = session.ended
  const view = props.view ?? 'terminal'
  const shown = view
  const title = rowTitle(session)
  const shell = isShell(session)

  const menuItems: MenuEntry[] = [
    { label: 'Split right', hint: shortcutText('split-right'), disabled: full, run: () => { props.onSplit(pane.id, 'right') } },
    { label: 'Split down', hint: shortcutText('split-down'), disabled: full, run: () => { props.onSplit(pane.id, 'down') } },
    'separator',
    { label: 'Rename…', hint: 'F2', run: props.onRename },
    { label: maximized ? 'Restore layout' : 'Maximize pane', disabled: !multi && !maximized, run: () => { props.onToggleMaximize(pane.id) } },
    { label: 'Clear', hint: 'Ctrl+L', disabled: !props.online || ended, run: props.onClear },
    { label: 'Copy folder path', run: props.onCopyPath },
    // The header has no close button; with the sidebar hidden this is the one close in reach, on the only pane too.
    'separator',
    { label: 'Close', danger: true, run: () => { props.onClose(pane.id) } },
  ]

  return (
    <>
    <section
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
        <div className="mx-pane-id">
          <PaneHeadId session={session} />
          {/* In the chat the branch is a chip under the box, so the header says only where the session is. */}
          {!shell && shown !== 'chat' && <PaneCrumbs session={session} branchMenu={props.branchMenu} />}
        </div>
        {props.broadcast && <span className="mx-broadcast-pill">◉ Broadcast</span>}
        <span className="mx-pane-controls">
          <IconButton
            label="More pane actions"
            aria-haspopup="menu"
            aria-expanded={menuAt !== null}
            // The open menu closes itself on this press, before the click: the click must not open it again.
            onPointerDown={() => { menuWasOpen.current = menuAt !== null }}
            onMouseDown={stop}
            onClick={(event) => { if (!menuWasOpen.current) setMenuAt(menuPoint(event, true)) }}
          ><Icon name="more" /></IconButton>
        </span>
        {/* The header's bottom edge says the status: the plain line while idle, a strip sweeping right to left while working, lit while it needs you. */}
        <span className="mx-pane-status" data-status={session.status} aria-hidden="true" />
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
      {shown === 'terminal' && !shell && <PaneFooter session={session} />}
      {session.helperAsk.length > 0 && props.onAnswerHelpers && !(shown === 'chat' && props.helpersAskedInChat) && (
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
    </section>
    {/* Beside the pane, not in it: a pane has `contain: paint`, which would place the menu's fixed anchor from the pane's corner. */}
    {menuAt && <MenuPopup key={`${String(menuAt.x)},${String(menuAt.y)}`} title={title} at={menuAt} items={menuItems} portalContainer={props.portalContainer} onClose={() => { setMenuAt(null) }} />}
    </>
  )
}

/**
 * The header's branch: its name and mark, which a session on this computer can switch from here (locked when the chat has a
 * worktree of its own). The pane's width decides how much shows (`pane.css`).
 */
function PaneCrumbs({ session, branchMenu }: { session: SessionView; branchMenu: BranchMenuSpec | undefined }) {
  const project = projectOf(session)
  return (
    <nav className="mx-crumbs" aria-label="Chat location">
      {session.branch !== null && (
        <>
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
    </nav>
  )
}
