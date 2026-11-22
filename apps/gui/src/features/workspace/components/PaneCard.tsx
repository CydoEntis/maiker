import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { MAX_PANES, type PaneSlot, type SplitDirection } from '../model/layout'
import type { SessionView } from '../model/session'
import { isShell, keepsRunningUnseen, projectOf, rowTitle } from '../model/sidebar'
import { startedBypassed } from '@/features/chat/bypassSessions'
import { modelWords } from '@/features/chat/modelName'
import { ContextMeter } from '@/features/usage/UsageMeter'
import { machineLabel } from '@/data/machineNicknames'
import { Tag } from '@/components/ui/tag'
import { agentName } from '../model/agentMessage'
import { Icon } from './glyphs'
import { beginPointerDrag } from './dragSession'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { menuPoint } from './menuPoint'
import type { PaneView } from '../model/chatView'
import { SecretAskBar } from './SecretAskBar'
import { helpersRequestWords } from '../model/outsideAsks'
import { PaneHeadId } from './PaneHeadId'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
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
  /** Before the agent's tile: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
  /** Starts a new shell in an ended pane's folder, in its place. */
  onRestart: (paneId: string) => void
  /** Answers the session's request to start helpers; absent where it cannot be answered. */
  onAnswerHelpers?: (choice: 'allow' | 'always' | 'no') => void
  /** The chat shown in the pane asks the helpers question itself, over its message box, so the bar here stays out. */
  helpersAskedInChat?: boolean
  /** Opens, outside the pane, the dialog that answers what a session shown as a terminal asks (its toast opens the same one). */
  outsideAsks?: { onHelpers: () => void; onSecret: (askId: number) => void }
}

const FULL_PERCENT = 100

const stop = (event: MouseEvent) => { event.stopPropagation() }

export function PaneCard(props: PaneCardProps) {
  const { pane, session, paneCount, focused, maximized } = props
  const shortcutText = useShortcutText()
  const tip = useTipWithKeys()
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
    // Maiker draws nothing in a terminal pane, so what a pane shown as one asks or can restart is here, as well as in its toast.
    ...(shown === 'terminal' && ended ? [{ label: 'Restart shell', disabled: !props.online, run: () => { props.onRestart(pane.id) } }] : []),
    ...(shown === 'terminal' && !ended && props.outsideAsks !== undefined ? outsideEntries(session, props.outsideAsks) : []),
    'separator',
    { label: 'Close', danger: true, run: () => { props.onClose(pane.id) } },
  ]
  // One pane of several with work in it only leaves the layout; otherwise the close ends what runs in it, after asking.
  const closeLabel = multi && keepsRunningUnseen(session) ? 'Close pane' : shell ? 'Close terminal' : 'Close session'

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
        {shown === 'terminal' ? (
          <>
            <TerminalHeadId session={session} />
            {props.broadcast && <span className="mx-broadcast-pill">◉ Broadcast</span>}
            <IconButton label="Split right" tip={tip('Split right', 'split-right')} disabled={full} onClick={() => { props.onSplit(pane.id, 'right') }}><Icon name="splitRight" /></IconButton>
            <IconButton label="Split down" tip={tip('Split down', 'split-down')} disabled={full} onClick={() => { props.onSplit(pane.id, 'down') }}><Icon name="splitDown" /></IconButton>
            <IconButton label={closeLabel} onClick={() => { props.onClose(pane.id) }}><Icon name="close" /></IconButton>
          </>
        ) : (
          <>
            <div className="mx-pane-id">
              <PaneHeadId session={session} />
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
          </>
        )}
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
      {/* Over a chat only. A pane shown as a terminal is the agent's own CLI: what it asks is said outside it (`useOutsideAsks`). */}
      {shown === 'chat' && session.helperAsk.length > 0 && props.onAnswerHelpers && !props.helpersAskedInChat && (
        <div className="mx-pane-ended is-ask" role="alert" aria-label="Wants to start helpers">
          <span className="mx-pane-ended-text">
            <strong>{helpersRequestWords(session.helperAsk.length)}</strong>
            <small title={session.helperAsk.join('\n')}>{session.helperAsk.join(' · ')}</small>
          </span>
          <button type="button" className="mx-pane-ended-button is-primary" disabled={!props.online} title="This session may start helpers from now on" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('allow') }}>Allow</button>
          <button type="button" className="mx-pane-ended-button" disabled={!props.online} title="Every session of this project may, from now on" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('always') }}>Always in this project</button>
          <button type="button" className="mx-pane-ended-button" disabled={!props.online} title="It does the work alone" onMouseDown={stop} onClick={() => { props.onAnswerHelpers?.('no') }}>No</button>
        </div>
      )}
      {shown === 'chat' && session.secretAsk.map((ask) => <SecretAskBar key={ask.id} ask={ask} machine={session.machine} online={props.online} />)}
      {shown === 'chat' && ended && (
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

/** The pane menu's entries for what a session asks: each opens the dialog its toast opens. */
function outsideEntries(session: SessionView, asks: NonNullable<PaneCardProps['outsideAsks']>): MenuEntry[] {
  return [
    ...(session.helperAsk.length > 0 ? [{ label: 'Answer the helpers request…', run: asks.onHelpers }] : []),
    ...session.secretAsk.map((ask) => ({ label: `Provide the secret ${ask.label}…`, run: () => { asks.onSecret(ask.id) } })),
  ]
}

/**
 * A terminal pane's header (handoff 6.1), all Maiker draws of the pane: the machine (a remote one only), then
 * `project / session name` for an agent, with the permission shield and how full its context is, or a plain shell's
 * name alone. The shield says only what Maiker knows, whether the session was started with its agent's Bypass
 * Permissions flag: the mode after that is the agent's own, and its screen is never read for it.
 */
function TerminalHeadId({ session }: { session: SessionView }) {
  const shell = isShell(session)
  const bypassed = useMemo(() => startedBypassed(session.id), [session.id])
  const context = session.usage.context
  const model = modelWords(session.agentModel)
  const who = shell ? null : model === null ? agentName(session.process) : `${agentName(session.process)} · ${model}`
  const shield = bypassed ? 'Started with Bypass permissions: it does not ask first' : 'Permissions are the agent’s own: it asks in its terminal'
  return (
    <>
      {session.machineName !== null && <Tag className="mx-pane-machine">{machineLabel(session.machineName)}</Tag>}
      <span className="mx-pane-title" title={who === null ? session.cwd : `${who} · ${session.cwd}`}>
        {!shell && <><span className="mx-pane-project">{projectOf(session)}</span><span className="mx-pane-slash" aria-hidden="true">/</span></>}
        <span className="mx-pane-name">{rowTitle(session)}</span>
      </span>
      {!shell && <span className={`mx-pane-shield${bypassed ? ' is-bypass' : ''}`} role="img" aria-label={shield} title={shield}><Icon name="shield" size={13} /></span>}
      {!shell && context !== null && <ContextMeter percent={Math.min(FULL_PERCENT, Math.max(0, Math.round(context)))} />}
    </>
  )
}
