import { useMemo, useState, type ReactNode } from 'react'
import type { PaneSlot } from '../model/layout'
import type { SplitDir } from '../model/splitTree'
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
import { focusTerminalFromPadding, isPaneMenuTarget } from './paneEvents'
import type { PaneView } from '../model/chatView'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import { IconButton } from '@/components/ui/icon-button'

export type PaneCardProps = {
  pane: PaneSlot
  index: number
  session: SessionView
  /** How many panes the arrangement holds: one of several can be dragged, maximized, and closed without ending its session. */
  paneCount: number
  /** Drawn as a card of its own: the arrangement, or this session's splits, put another pane beside it. */
  card: boolean
  /** Why this pane cannot be split now (the session is full, ended, on another machine); null when it can. */
  splitRefusal: string | null
  /** Typing in any pane of this layout goes to its idle ones too. */
  broadcast: boolean
  focused: boolean
  maximized: boolean
  dropTarget: boolean
  /** Set when the session is split: this pane for a drag (`leafKey`), so it can trade places with another of its panes. */
  leaf?: string | undefined
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
  onSplit: (paneId: string, direction: SplitDir) => void
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
  /** Opens, outside the pane, the dialog that answers what a session shown as a terminal asks (its toast opens the same one). */
  outsideAsks?: { onHelpers: () => void; onSecret: (askId: number) => void }
}

const FULL_PERCENT = 100

export function PaneCard(props: PaneCardProps) {
  const { pane, session, paneCount, focused, maximized } = props
  const shortcutText = useShortcutText()
  const tip = useTipWithKeys()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const multi = paneCount > 1
  // A split session's own pane moves among its splits even when it is the window's only pane.
  const draggable = multi || props.leaf !== undefined
  const unsplittable = props.splitRefusal !== null
  const splitWhy = props.splitRefusal ?? undefined
  const ended = session.ended
  const view = props.view ?? 'terminal'
  const shown = view
  const title = rowTitle(session)
  const shell = isShell(session)

  // One pane of several with work in it only leaves the layout; otherwise the close ends what runs in it, after asking.
  const closeLabel = multi && keepsRunningUnseen(session) ? 'Close pane' : shell ? 'Close terminal' : 'Close session'
  // The whole of a terminal pane opens this one: Maiker draws nothing inside it, so what the pane asks or can restart is
  // here too. Rename, the two splits and the close are the menu (handoff 6.2); the rows between act on this pane alone.
  const terminalMenuItems: MenuEntry[] = [
    { label: 'Rename…', hint: 'F2', run: props.onRename },
    'separator',
    { label: 'Split right', hint: shortcutText('split-right'), disabled: unsplittable, ...(splitWhy === undefined ? {} : { why: splitWhy }), run: () => { props.onSplit(pane.id, 'right') } },
    { label: 'Split down', hint: shortcutText('split-down'), disabled: unsplittable, ...(splitWhy === undefined ? {} : { why: splitWhy }), run: () => { props.onSplit(pane.id, 'down') } },
    'separator',
    ...(multi || maximized ? [{ label: maximized ? 'Restore layout' : 'Maximize pane', run: () => { props.onToggleMaximize(pane.id) } }] : []),
    { label: 'Clear', hint: 'Ctrl+L', disabled: !props.online || ended, run: props.onClear },
    { label: 'Copy folder path', run: props.onCopyPath },
    ...(ended ? [{ label: 'Restart shell', disabled: !props.online, run: () => { props.onRestart(pane.id) } }] : []),
    ...(!ended && props.outsideAsks !== undefined ? outsideEntries(session, props.outsideAsks) : []),
    'separator',
    // The close key ends the focused session; a pane that only leaves the layout has no key.
    { label: closeLabel, ...(closeLabel === 'Close pane' ? {} : { hint: shortcutText('close') }), danger: true, run: () => { props.onClose(pane.id) } },
  ]
  // A chat pane's menu is its header's alone (handoff 5): the chat has no splits, nothing of a terminal to clear, and its
  // folder is the chat box's and the sidebar row's to copy. Maximize shows only in a layout of several panes.
  const chatMenuItems: MenuEntry[] = [
    { label: 'Rename…', hint: 'F2', run: props.onRename },
    ...(multi || maximized ? [{ label: maximized ? 'Restore layout' : 'Maximize pane', run: () => { props.onToggleMaximize(pane.id) } }] : []),
    'separator',
    { label: closeLabel, danger: true, run: () => { props.onClose(pane.id) } },
  ]

  return (
    <>
    <section
      className={`mx-pane${shown === 'terminal' ? ' is-terminal' : ' is-chat'}${props.card ? ' is-card' : ''}${focused && props.card ? ' is-focused' : ''}${props.broadcast ? ' is-broadcast' : ''}${props.dropTarget ? ' is-drop-target' : ''}${props.dragging ? ' is-dragging' : ''}`}
      aria-label={`Terminal ${String(props.index + 1)}: ${session.cwdLabel}${focused ? ', focused' : ''}`}
      data-session-id={session.id}
      data-pane={pane.id}
      onMouseDown={() => { props.onFocus(pane.id) }}
      onContextMenu={(event) => {
        // A terminal's whole pane opens the pane menu; a chat's opens it from the header only, and the conversation has
        // no menu of the pane's.
        if (!isPaneMenuTarget(event.target)) return
        event.preventDefault()
        if (shown === 'terminal' || event.target.closest('.mx-pane-head') !== null) setMenuAt(menuPoint(event, false))
      }}
    >
      <div
        className={`mx-pane-head${draggable ? ' is-draggable' : ''}`}
        title={draggable ? 'Drag to move this pane' : undefined}
        onPointerDown={(event) => {
          // Buttons in the header keep their own clicks; only the bar itself starts a drag.
          if (draggable && !(event.target instanceof Element && event.target.closest('button, input'))) beginPointerDrag(event, { kind: 'pane', id: pane.id, label: title, ...(props.leaf === undefined ? {} : { leaf: props.leaf }) })
        }}
      >
        {props.leading}
        <PaneTitle session={session} />
        {shown === 'terminal' && <TerminalFacts session={session} />}
        {props.broadcast && <span className="mx-broadcast-pill">◉ Broadcast</span>}
        {shown === 'terminal' && (
          <>
            <IconButton label="Split right" tip={splitWhy ?? tip('Split right', 'split-right')} disabled={unsplittable} onClick={() => { props.onSplit(pane.id, 'right') }}><Icon name="splitRight" /></IconButton>
            <IconButton label="Split down" tip={splitWhy ?? tip('Split down', 'split-down')} disabled={unsplittable} onClick={() => { props.onSplit(pane.id, 'down') }}><Icon name="splitDown" /></IconButton>
          </>
        )}
        <IconButton label={closeLabel} onClick={() => { props.onClose(pane.id) }}><Icon name="close" /></IconButton>
      </div>
      <div
        className={`mx-pane-body${shown === 'chat' ? ' is-chat' : ''}`}
        onMouseDown={focusTerminalFromPadding}
      >
        {props.terminal}
        {shown === 'chat' && props.chat}
        {props.overlay}
      </div>
      {props.dropTarget && <span className="mx-pane-drop" aria-hidden="true">{props.dropWord}</span>}
    </section>
    {/* Beside the pane, not in it: a pane has `contain: paint`, which would place the menu's fixed anchor from the pane's corner. */}
    {menuAt && <MenuPopup key={`${String(menuAt.x)},${String(menuAt.y)}`} title={title} at={menuAt} items={shown === 'terminal' ? terminalMenuItems : chatMenuItems} portalContainer={props.portalContainer} onClose={() => { setMenuAt(null) }} />}
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
 * The left of every pane's header (handoff 5 and 6.1): the machine (a remote one only), then `project / session name`
 * for an agent, or a plain shell's name alone. It carries no status mark: the status is the sidebar's.
 */
function PaneTitle({ session }: { session: SessionView }) {
  const shell = isShell(session)
  const model = modelWords(session.agentModel)
  const who = shell ? null : model === null ? agentName(session.process) : `${agentName(session.process)} · ${model}`
  return (
    <>
      {session.machineName !== null && <Tag className="mx-pane-machine">{machineLabel(session.machineName)}</Tag>}
      <span className="mx-pane-title" title={who === null ? session.cwd : `${who} · ${session.cwd}`}>
        {!shell && <><span className="mx-pane-project">{projectOf(session)}</span><span className="mx-pane-slash" aria-hidden="true">/</span></>}
        <span className="mx-pane-name">{rowTitle(session)}</span>
      </span>
    </>
  )
}

/**
 * What a terminal pane's header adds for an agent: the permission shield and how full its context is; a chat has both
 * in its chat box. The shield says only what Maiker knows, whether the session was started with its agent's Bypass
 * Permissions flag: the mode after that is the agent's own, and its screen is never read for it.
 */
function TerminalFacts({ session }: { session: SessionView }) {
  const bypassed = useMemo(() => startedBypassed(session.id), [session.id])
  if (isShell(session)) return null
  const context = session.usage.context
  const shield = bypassed ? 'Started with Bypass permissions: it does not ask first' : 'Permissions are the agent’s own: it asks in its terminal'
  return (
    <>
      <span className={`mx-pane-shield${bypassed ? ' is-bypass' : ''}`} role="img" aria-label={shield} title={shield}><Icon name="shield" size={13} /></span>
      {context !== null && <ContextMeter percent={Math.min(FULL_PERCENT, Math.max(0, Math.round(context)))} />}
    </>
  )
}
