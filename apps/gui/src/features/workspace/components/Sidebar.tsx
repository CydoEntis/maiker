import { Fragment, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import { machineTitle, UPDATE_WORDS, type MachineHead, type UpdateAction } from '../model/machines'
import { folderNameOf, STATUS_WORD, type SessionView } from '../model/session'
import { DEFAULT_SIDEBAR_SORT, inProject, isShell, machineGroups, projectChoices, projectSections, rowTitle, sectionOf, splitPutAway, statusSections, type HeldRow, type MachineGroup, type SidebarGrouping, type SidebarOrder, type SidebarSort } from '../model/sidebar'
import { useTipWithKeys, useShortcutText } from '@/features/shortcuts/platform'
import { SidebarResizer } from './SidebarResizer'
import { AppIcon, FolderMark, Icon, MachineIcon } from './glyphs'
import { StatusIcon } from '@/components/ui/status-icon'
import { Collapse } from './Collapse'
import { useReducedMotion } from './motion'
import { useFlip } from './useFlip'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { SessionRow } from './SessionRow'
import { StartMenu } from './StartMenu'
import { SidebarFilterMenu } from './SidebarFilterMenu'
import { RowHoverHost } from './RowHoverHost'
import { useHoverController } from './useHoverController'
import { flipKey } from './flipKey'


export type SidebarProps = {
  /** Every session of every machine. Each machine lists its own, in `order`. */
  sessions: readonly SessionView[]
  /** The daemon has sent its first list; until then an empty list means "not known yet", not "none". */
  listed: boolean
  /** The machine groups: this computer first, then the others. */
  machines: readonly MachineHead[]
  order: SidebarOrder
  /** What the headings are, and how the user picks another. */
  grouping: SidebarGrouping
  onGrouping: (grouping: SidebarGrouping) => void
  /** Opens the search over every session, project and action. */
  onSearch: () => void
  focusedId: string | null
  mode: 'docked' | 'rail'
  online: boolean
  canStart: boolean
  /** The session whose name is being typed in its row; the window starts it from a menu, F2 or a double-click. */
  /** Where portalled menus mount, so they read the theme's colours. */
  portalContainer: HTMLElement | null
  /** Collapses the docked sidebar to the rail, or expands the rail (over the window when it is narrow). */
  onToggleRail: () => void
  side: 'left' | 'right'
  /** The docked sidebar's width in px, and how the user changes it by dragging its edge. */
  width: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  /** The + menu: the machine it is open for (null: closed). The window opens it too, for Get started and the palette. */
  startMenu: number | null
  onStartMenu: (machine: number | null) => void
  /** What the + menu lists: the agents found on this computer (null while unknown), the open project's other worktrees, and its starts. */
  start: StartSupport
  /** Starts a plain terminal on a machine; absent in the Chat view, which makes none. */
  onNewShell?: ((machine: number) => void) | undefined
  onAddMachine: () => void
  onMachineSettings: () => void
  /** Fix on a machine that is not up: mends it in the Add a remote machine dialog. */
  onFixMachine: (head: MachineHead) => void
  /** Asks for a name of the user's own for another machine (by its real name). */
  onRenameMachine: (name: string) => void
  /** Installs or updates the app on a machine that needs it; the window asks first. */
  onUpdateMachine: (name: string, action: UpdateAction) => void
  onShowSession: (id: string) => void
  onRenameSession: (id: string | null) => void
  /** Shows a session beside the pane that has focus. */
  onSplitSession: (id: string, direction: 'right' | 'down') => void
  /** Opens a shell in an agent's folder, beside it. */
  onCopyPath: (id: string) => void
  onCopyText: (text: string, what: string) => void
  onShowChanges: (id: string) => void
  onMarkDone: (id: string) => void
  onBringBack: (id: string) => void
  onUnsnooze: (id: string) => void
  /** Asks for a file to pull from the machine of session `id`. */
  onGetFile: (id: string) => void
  /** The pointer or keyboard is on this session's row (`null`: it left), so its chat can be read ahead of a click. */
  onHoverSession?: ((id: string | null) => void) | undefined
  /** Lists the specialist agent files a session of this computer can see. */
  /** Makes a worktree off this session's repository, with a session open in it. */
  onNewWorktree?: (id: string) => void
  onSpecialists?: (id: string) => void
  onEndSession: (id: string) => void
  onOpenSettings: () => void
  /** Opens the list of agent sessions closed on this computer. */
  onRecentSessions: () => void
  /** How far an install or update of each remote machine has got, by machine name, 0 to 100; absent when none runs. */
  updateProgress?: Readonly<Record<string, number>> | undefined
  /** A chat that is being written but has no first message yet: listed on its machine so it is not lost. */
  draft?: DraftChat | null | undefined
}

/** What the + menu needs from the window beyond the machines. */
export type StartSupport = {
  installedAgents: readonly string[] | null
  onAgent: (program: string, machine: number) => void
}

/** The New session dialog's chat while it is unsent: where it will start, and the agent picked for it. */
export type DraftChat = { machine: number; process: string; /** Opens the draft again, for one that is set aside with text in it; absent while it is open. */ onOpen?: (() => void) | undefined }

type OpenMenu = { title: string; at: { x: number; y: number }; items: MenuEntry[] }

/**
 * A session's right-click menu, the same in the full list and in the rail. The design's four come first (Rename, Open in a new
 * pane, Copy folder path, and after a divider Close session); the rest of what a session can do follows a second divider.
 */
function sessionMenuEntries(props: SidebarProps, session: SessionView, closeHint: string): MenuEntry[] {
  const agent = !isShell(session)
  const other = session.id !== props.focusedId
  return [
    { label: 'Rename', hint: 'F2', run: () => { props.onRenameSession(session.id) } },
    { label: 'Open in a new pane', disabled: !other, run: () => { props.onSplitSession(session.id, 'right') } },
    { label: 'Copy folder path', run: () => { props.onCopyPath(session.id) } },
    'separator',
    // Closing an agent stops it; a plain shell has nothing running to lose.
    { label: agent ? 'Close session' : 'Close shell', hint: closeHint, danger: true, disabled: !props.online, run: () => { props.onEndSession(session.id) } },
    'separator',
    { label: 'Open', run: () => { props.onShowSession(session.id) } },
    ...(other ? [{ label: 'Open in split down', run: () => { props.onSplitSession(session.id, 'down') } }] : []),
    ...(agent ? [{ label: 'Show changes', run: () => { props.onShowChanges(session.id) } }] : []),
    // A worktree is made from a repository, so a session that has not gone into one yet cannot start it; the worktrees are this computer's.
    ...(props.onNewWorktree === undefined ? [] : [{ label: 'New worktree…', disabled: !props.online || session.machineName !== null || session.branch === null, run: () => { props.onNewWorktree?.(session.id) } }]),
    ...(session.machineName === null ? [] : [{ label: 'Rename machine…', run: () => { props.onRenameMachine(session.machineName ?? '') } }]),
    ...(session.machineName === null ? [] : [{ label: 'Get a file…', disabled: !props.online, run: () => { props.onGetFile(session.id) } }]),
    // A finished agent waits under Done until you look; this files it under Idle without opening it.
    ...(session.status === 'done' ? [{ label: 'Mark as done', disabled: !props.online, run: () => { props.onMarkDone(session.id) } }] : []),
    ...(session.snoozedUntil !== null ? [{ label: 'Unsnooze', disabled: !props.online, run: () => { props.onUnsnooze(session.id) } }] : []),
    ...(session.archived ? [{ label: 'Bring back', disabled: !props.online, run: () => { props.onBringBack(session.id) } }] : []),
  ]
}

/**
 * The + menu for a + button, fed from the sidebar's props. The header's (and the rail's) + is the one the window can open too, so
 * it follows `startMenu`; a machine's own + opens and closes itself.
 */
function SidebarStartMenu({ sidebar, machine, windowOpens = false, children }: { sidebar: SidebarProps; machine: number; windowOpens?: boolean; children: ReactElement }) {
  const focused = sidebar.focusedId === null ? undefined : sidebar.sessions.find((session) => session.id === sidebar.focusedId)
  const here = focused !== undefined && focused.machine === machine ? focused : undefined
  const { installedAgents, onAgent } = sidebar.start
  return (
    <StartMenu
      machine={machine}
      machines={sidebar.machines}
      project={here === undefined ? null : folderNameOf(here)}
      installed={installedAgents}
      portalContainer={sidebar.portalContainer}
      open={windowOpens ? sidebar.startMenu !== null : undefined}
      onOpenChange={windowOpens ? (open) => { sidebar.onStartMenu(open ? machine : null) } : undefined}
      onTerminal={sidebar.onNewShell}
      onAgent={onAgent}
      onAddMachine={sidebar.onAddMachine}
    >
      {children}
    </StartMenu>
  )
}

export function Sidebar(props: SidebarProps) {
  const [resizing, setResizing] = useState(false)
  const className = `mx-sidebar mx-card${props.mode === 'rail' ? ' is-rail' : ''}${resizing ? ' is-resizing' : ''}`
  return (
    <nav aria-label="Sessions" className={className}>
      {props.mode === 'rail' ? <Rail {...props} /> : <Expanded {...props} />}
      {props.mode === 'docked' && <SidebarResizer side={props.side} width={props.width} onResize={props.onResize} onResizeEnd={props.onResizeEnd} onDragging={setResizing} />}
    </nav>
  )
}

const PUT_AWAY_SECTION = 'put-away'

/** Which headings are folded. */
function useMachineViews() {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const flip = (set: ReadonlySet<string>, key: string) => { const next = new Set(set); if (!next.delete(key)) next.add(key); return next }
  return {
    /** Which headings are folded: what `flipKey` reads. */
    signature: [...folded].join(','),
    isOpen: (key: string) => !folded.has(key),
    toggle: (key: string) => { setFolded((current) => flip(current, key)) },
  }
}

function Expanded(props: SidebarProps) {
  const tip = useTipWithKeys()
  const shortcutText = useShortcutText()
  const list = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // The card beside a row the pointer rests on. It follows a controller outside React state, so a hover never draws the rows.
  const hover = useHoverController()
  const endHover = () => { hover.leave() }
  const beginHover = (id: string, element: HTMLElement) => { hover.enter(id, () => element.getBoundingClientRect()) }
  const [pickedProject, setPickedProject] = useState<string | null>(null)
  const [sort, setSort] = useState<SidebarSort>(DEFAULT_SIDEBAR_SORT)
  const views = useMachineViews()
  // Folded until opened, unlike the other headings: what is put away is out of the way.
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const reduced = useReducedMotion()
  const projects = projectChoices(props.sessions)
  // A project whose last session closed is no longer a choice, so the list goes back to all of them.
  const project = projects.some((choice) => choice.name === pickedProject) ? pickedProject : null
  const { listed, putAway } = splitPutAway(inProject(props.sessions, project))
  const sessions = listed
  // The session on screen keeps the status section it was picked in until another is picked (`statusSections`).
  const [hold, setHold] = useState<{ for: string | null; row: HeldRow | null }>({ for: null, row: null })
  if (hold.for !== props.focusedId) {
    const focused = props.focusedId === null ? undefined : props.sessions.find((session) => session.id === props.focusedId)
    setHold({ for: props.focusedId, row: focused === undefined ? null : { id: focused.id, section: sectionOf(focused) } })
  }
  const held = hold.row
  const draft = props.draft ?? null
  const groups = machineGroups(sessions, props.machines, draft !== null, props.order)
  const localMachine = props.machines[0]?.machine ?? 0
  // Where each row sits, so a row that changes section because focus moved (`held`) still animates, while a focus change that moves nothing leaves the key alone and `useFlip` reads no layout.
  const placement = props.grouping === 'status' ? statusSections(sessions, held, sort).map((section) => `${section.key}:${section.sessions.map((session) => session.id).join(',')}`).join('|') : ''
  useFlip(list, reduced, flipKey(props, sessions, sort, project, putAwayOpen, views, draft !== null, placement))
  const openMenu = (event: MouseEvent, title: string, items: MenuEntry[]) => {
    event.preventDefault()
    event.stopPropagation()
    endHover()
    setMenu({ title, at: { x: event.clientX, y: event.clientY }, items })
  }

  const sessionMenu = (session: SessionView): MenuEntry[] => sessionMenuEntries(props, session, shortcutText('close'))

  const machineMenu = (head: MachineHead): MenuEntry[] => {
    const open = views.isOpen(head.key)
    const name = head.name
    const action = head.updateAction
    return [
      ...(name !== null && action !== null ? [{ label: `${UPDATE_WORDS[action].verb} Maiker`, run: () => { props.onUpdateMachine(name, action) } }, 'separator' as const] : []),
      { label: 'New session here', disabled: !props.canStart || head.down, run: () => { props.onStartMenu(head.machine) } },
      ...(props.onNewShell === undefined ? [] : [{ label: 'New terminal here', disabled: !props.canStart || head.down, run: () => { props.onNewShell?.(head.machine) } }]),
      ...(head.down ? [{ label: `Not reachable: ${head.why ?? head.chip?.word ?? 'not reachable'}`, disabled: true, run: () => undefined }] : []),
      'separator',
      { label: open ? 'Collapse' : 'Expand', run: () => { views.toggle(head.key) } },
      'separator',
      ...(name === null ? [] : [{ label: 'Rename…', run: () => { props.onRenameMachine(name) } }]),
      { label: 'Machine settings…', run: props.onMachineSettings },
    ]
  }

  const renderRow = (session: SessionView, showProject: boolean, showMachine = true) => {
    const selected = session.id === props.focusedId
    return (
      <div key={session.id} className="mx-row-wrap" role="listitem" data-flip={session.id} onMouseEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }} onMouseLeave={() => { endHover(); props.onHoverSession?.(null) }} onMouseDown={endHover} onFocus={() => { props.onHoverSession?.(session.id) }} onBlur={() => { props.onHoverSession?.(null) }}>
        <SessionRow
          session={session}
          selected={selected}
          showProject={showProject}
          machine={showMachine ? session.machineName : null}
          onShow={() => { props.onShowSession(session.id) }}
          onRename={() => { props.onRenameSession(session.id) }}
          onContextMenu={(event) => { openMenu(event, rowTitle(session), sessionMenu(session)) }}
        />
        {/* A sibling of the row, not inside it (a button cannot hold a button): it shows on hover and focus. */}
      </div>
    )
  }

  // A saved machine with nothing on it keeps its card in every grouping, so it never vanishes from the list that adds to it.
  const emptyMachines: MachineGroup[] = props.machines.filter((head) => head.name !== null && !props.sessions.some((session) => session.machine === head.machine)).map((head) => ({ head, sessions: [] }))
  const machineSection = (group: MachineGroup) => (
    <MachineSection
      key={group.head.key}
      group={group}
      open={views.isOpen(group.head.key) || draft?.machine === group.head.machine}
      draft={draft?.machine === group.head.machine ? draft : null}
      progress={group.head.name === null ? undefined : props.updateProgress?.[group.head.name]}
      onToggle={() => { views.toggle(group.head.key) }}
      onUpdate={props.onUpdateMachine}
      onContextMenu={(event) => { openMenu(event, machineTitle(group.head), machineMenu(group.head)) }}
      renderRow={renderRow}
      canStart={props.canStart}
      renderStart={(machine, button) => <SidebarStartMenu sidebar={props} machine={machine}>{button}</SidebarStartMenu>}
      onFix={props.onFixMachine}
    />
  )
  return (
    <div className="mx-sidebar-expanded">
      <div className="mx-sidebar-top">
        <button type="button" className="mx-head-button" aria-label="Hide sidebar" title={tip('Hide sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="panelLeft" size={14} /></button>
        <span className="mx-sidebar-title">Chats</span>
        <span className="mx-spacer" />
        <button type="button" className="mx-head-button" aria-label="Search" title={tip('Search', 'palette')} onClick={props.onSearch}><Icon name="search" size={14} /></button>
        <SidebarFilterMenu grouping={props.grouping} onGrouping={props.onGrouping} sort={sort} onSort={setSort} projects={projects} project={project} onProject={setPickedProject} />
        <SidebarStartMenu sidebar={props} machine={props.startMenu ?? localMachine} windowOpens>
          <button type="button" className="mx-head-button" aria-label="New session" title={tip('New session', 'new-session')} disabled={!props.canStart}><Icon name="plus" size={15} /></button>
        </SidebarStartMenu>
      </div>
      <div ref={list} className="mx-sidebar-list" onScroll={endHover}>
        {props.grouping !== 'machine' && (
          <section aria-label="Agents" className="mx-sections">
            {draft !== null && <DraftRow process={draft.process} onOpen={draft.onOpen} />}
            {props.grouping === 'status' && statusSections(sessions, held, sort).map((section) => (
              <ListSection key={section.key} id={`status:${section.key}`} tone={section.key} name={section.name} count={section.sessions.length} label={section.name} open={views.isOpen(`status:${section.key}`)} onToggle={() => { views.toggle(`status:${section.key}`) }}>
                {section.sessions.map((session) => renderRow(session, true))}
              </ListSection>
            ))}
            {props.grouping === 'project' && projectSections(sessions, props.machines, sort).map((section) => (
              <ListSection key={section.key} id={section.key} name={section.name} color={section.color} machine={section.head.name === null ? null : section.head} needs={section.needs} count={section.sessions.length} label={section.head.name === null ? section.name : `${section.name} on ${machineTitle(section.head)}`} open={views.isOpen(section.key)} onToggle={() => { views.toggle(section.key) }}>
                {section.sessions.map((session) => renderRow(session, false))}
              </ListSection>
            ))}
            {props.sessions.length === 0 && draft === null && <div className="mx-empty-note">{props.listed ? 'Chats and shells you start appear here, sorted by what needs you.' : 'Looking for your sessions…'}</div>}
            {emptyMachines.map(machineSection)}
            <MachineNotes heads={props.machines.filter((head) => !emptyMachines.some((group) => group.head.key === head.key))} progress={props.updateProgress} onUpdate={props.onUpdateMachine} onFix={props.onFixMachine} />
          </section>
        )}
        {props.grouping === 'machine' && (
        <section aria-label="Agents" className="mx-machines">
          {groups.map(machineSection)}
          {props.sessions.length === 0 && draft === null && <div className="mx-empty-note">{props.listed ? 'Chats and shells you start appear here, sorted by what needs you.' : 'Looking for your sessions…'}</div>}
        </section>
        )}
        {putAway.length > 0 && (
          <section aria-label="Put away sessions" className="mx-sections">
            <ListSection id={PUT_AWAY_SECTION} name="Put away" count={putAway.length} label="Put away" open={putAwayOpen} onToggle={() => { setPutAwayOpen(!putAwayOpen) }}>
              {putAway.map((session) => renderRow(session, true))}
            </ListSection>
          </section>
        )}
      </div>
      <div className="mx-sidebar-foot">
        {/* The service's state is the title bar's chip, so the foot never says it a second time. */}
        <button type="button" className="mx-head-button mx-add-machine" title="Add a remote machine" onClick={props.onAddMachine}><Icon name="plus" size={14} />Remote machine</button>
        <span className="mx-spacer" />
        <button type="button" className="mx-head-button mx-settings-button" aria-label="Settings" title={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" size={15} /></button>
      </div>
      <RowHoverHost controller={hover} sessions={props.sessions} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}

type ListSectionProps = {
  id: string
  name: string
  /** What the list is called for a screen reader: the heading, with its machine when it has one. */
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
  /** A status section: its colour. */
  tone?: string
  /** A project section: its folder mark, the other machine it is on, and how many of its sessions need you. */
  color?: string
  machine?: MachineHead | null
  needs?: number
}

/** One heading of the status or project list, with the rows under it; the heading folds them away. */
function ListSection({ id, name, label, count, open, onToggle, children, tone, color, machine = null, needs = 0 }: ListSectionProps) {
  return (
    <div className="mx-section" data-section={id}>
      <button type="button" className={`mx-section-head${tone === undefined ? '' : ` is-${tone}`}`} data-tone={tone} data-flip={`head:${id}`} aria-expanded={open} onClick={onToggle}>
        {color !== undefined && <FolderMark size={15} />}
        <span className="mx-section-name">{name}</span>
        {machine !== null && <span className="mx-section-machine">· {machineTitle(machine)}</span>}
        {machine !== null && <span className={`mx-machine-dot${machine.down ? ' is-offline' : ''}`} role="img" aria-label={machine.down ? `${machineTitle(machine)} is ${machine.chip?.word ?? 'not reachable'}` : `${machineTitle(machine)} is connected`} />}
        {color === undefined && <span className="mx-section-count mono" data-tone={tone}>{count}</span>}
        {needs > 0 && <span className="mx-project-needs" aria-label={`${String(needs)} need you`}>{needs}</span>}
        <span className="mx-spacer" />
        {color !== undefined && <span className={`mx-section-caret${open ? ' is-open' : ''}`} aria-hidden="true"><Icon name="chevronDown" size={12} /></span>}
      </button>
      <Collapse open={open}>
        <div className="mx-rows" role="list" aria-label={label}>{children}</div>
      </Collapse>
    </div>
  )
}

/**
 * Machines that need the app, when the list is not grouped by machine: there is no machine heading
 * to carry the Update button then, and a machine that cannot run anything must still say so.
 */
function MachineNotes({ heads, progress, onUpdate, onFix }: { heads: readonly MachineHead[]; progress: Readonly<Record<string, number>> | undefined; onUpdate: (name: string, action: UpdateAction) => void; onFix: (head: MachineHead) => void }) {
  const waiting = heads.flatMap((head) => (head.name !== null && (head.down || head.updateAction !== null || progress?.[head.name] !== undefined) ? [{ head, name: head.name }] : []))
  if (waiting.length === 0) return null
  return (
    <div className="mx-machine-notes" role="group" aria-label="Machines that need Maiker">
      {waiting.map(({ head, name }) => {
        const done = progress?.[name]
        return (
          <div key={head.key} className="mx-machine-note">
            <span className="mx-machine-icon" aria-hidden="true"><MachineIcon remote /></span>
            <span className="mx-machine-name">{machineTitle(head)}</span>
            {done !== undefined
              ? <span className="mx-machine-pct mono">{String(done)}%</span>
              : head.updateAction !== null && <UpdateButton name={name} action={head.updateAction} onUpdate={onUpdate} />}
            {head.down && <MachineWhy head={head} onFix={onFix} />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * A machine that is not up: a red dot, "Offline", and one **Fix** button. The word never changes with the line's retries
 * (unreachable, needs login, reconnecting #3 all read the same here); the host's reason is the tooltip, and Fix opens the
 * machine's page in Settings, where the reason is read in full and acted on.
 */
function MachineWhy({ head, onFix }: { head: MachineHead; onFix: (head: MachineHead) => void }) {
  const reason = head.said ?? head.why
  return (
    <span className="mx-machine-why" title={reason === null || reason === '' ? undefined : reason}>
      <span className="mx-machine-why-dot" aria-hidden="true" />
      <span className="mx-machine-why-word">Offline</span>
      <button type="button" className="mx-machine-fix" aria-label={`Fix ${head.label}`} onClick={() => { onFix(head) }}>Fix</button>
    </span>
  )
}

type SectionProps = {
  canStart: boolean
  /** Wraps a machine's + in its + menu. */
  renderStart: (machine: number, button: ReactElement) => ReactNode
  onFix: (head: MachineHead) => void
  /** The draft chat, listed first in this machine; null when it is not on this machine. */
  draft: DraftChat | null
  /** How far this machine's update has got, while one runs. */
  progress: number | undefined
  group: MachineGroup
  open: boolean
  onToggle: () => void
  onUpdate: (name: string, action: UpdateAction) => void
  onContextMenu: (event: MouseEvent) => void
  /** `showMachine` is false under a machine's own heading, which already says it. */
  renderRow: (session: SessionView, showProject: boolean, showMachine?: boolean) => ReactNode
}

/** One machine: its heading (name, count, update, its line's dot) and its sessions as one list, most urgent first. */
function MachineSection({ draft, progress, group, open, onToggle, onUpdate, onContextMenu, renderRow, canStart, renderStart, onFix }: SectionProps) {
  const { head, sessions } = group
  const title = machineTitle(head)
  return (
    <div className={`mx-machine${head.down ? ' is-away' : ''}`}>
      <div className="mx-machine-head" data-flip={`machine:${head.key}`}>
        <button type="button" className="mx-machine-toggle" aria-expanded={open} onClick={onToggle} onContextMenu={onContextMenu}>
          <span className={`mx-caret-wrap${open ? ' is-open' : ''}`}><Icon name="caret" /></span>
          <span className="mx-machine-icon" aria-hidden="true"><MachineIcon remote={head.name !== null} /></span>
          <span className="mx-machine-name">{title}</span>
          <span className="mx-machine-count">{sessions.length}</span>
        </button>
        {progress !== undefined
          ? <span className="mx-machine-pct mono">{String(progress)}%</span>
          : head.name !== null && head.updateAction !== null && <UpdateButton name={head.name} action={head.updateAction} onUpdate={onUpdate} />}
        {renderStart(head.machine, <button type="button" className="mx-head-button is-small mx-machine-add" aria-label={`Add a session to ${title}`} title={`New session on ${title}`} disabled={!canStart || head.down}><Icon name="plus" size={13} /></button>)}
        <span className={`mx-machine-dot${head.updateAction !== null ? ' is-warn' : head.down ? ' is-offline' : ''}`} role="img" aria-label={head.down ? `${title} is ${head.chip?.word ?? 'not reachable'}` : `${title} is connected`} title={head.why ?? (head.down ? head.chip?.word ?? 'not reachable' : `${title} is connected`)} />
      </div>
      {progress !== undefined && head.name !== null && (
        <span className="mx-machine-progress" role="progressbar" aria-label={`Updating ${head.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${String(progress)}%` }} /></span>
      )}
      {head.down && head.name !== null && <MachineWhy head={head} onFix={onFix} />}
      {!head.down && head.name !== null && head.chip?.tone === 'quiet' && <span className="mx-machine-why"><span className="mx-machine-why-word">Connecting…</span></span>}
      <Collapse open={open}>
        <div className="mx-rows" role="list" aria-label={`Sessions on ${title}`}>{sessions.map((session) => renderRow(session, true, false))}</div>
        {sessions.length === 0 && draft === null && <div className="mx-machine-empty">No sessions yet</div>}
        {/* Last, where the new chat will be (sessions keep creation order), so it fills in without anything moving. */}
        {draft !== null && <DraftRow process={draft.process} onOpen={draft.onOpen} />}
      </Collapse>
    </div>
  )
}

/**
 * The session that has not been sent yet (layout 2h): a row named "New session" in italics with a "draft" tag and the picked
 * agent's mark, drawn as a session row draws it, first in the list. The real row takes this place when the chat starts.
 */
function DraftRow({ process, onOpen }: { process: string; onOpen: (() => void) | undefined }) {
  return (
    <div className="mx-row-wrap mx-draft-wrap" {...(onOpen === undefined ? { role: 'status', 'aria-label': 'New session, waiting for the first message' } : {})} data-flip="draft">
      <div className={`mx-row mx-draft${onOpen === undefined ? '' : ' is-parked'}`} {...(onOpen === undefined ? {} : { role: 'button', tabIndex: 0, 'aria-label': 'New session draft, with text kept. Open it.', onClick: onOpen, onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } } })}>
        <span className="mx-row-icon"><AppIcon process={process} size={16} dimmed /></span>
        <span className="mx-row-text">
          <span className="mx-draft-name">New session</span>
          <span className="mx-draft-tag">draft</span>
        </span>
      </div>
    </div>
  )
}

/** What a machine without the app, or with another version of it, needs: an amber text button in its header, no row of its own. */
function UpdateButton({ name, action, onUpdate }: { name: string; action: UpdateAction; onUpdate: (name: string, action: UpdateAction) => void }) {
  const words = UPDATE_WORDS[action]
  return (
    <button type="button" className="mx-machine-update" aria-label={`${words.verb} Maiker on ${name}`} title={words.need(name)} onClick={() => { onUpdate(name, action) }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
      {words.verb}
    </button>
  )
}

/**
 * The slim strip of a narrow window, in the design's language: the sidebar toggle, search and new session, then one flat
 * status icon per session under its status (a hairline between the sections, in the order of the expanded list), the
 * Remote machine and Settings at the foot. A session's hover card is the expanded row's. There is no agent tile and no
 * connection dot: the service's state shows in the title bar alone.
 */
function Rail(props: SidebarProps) {
  const tip = useTipWithKeys()
  const shortcutText = useShortcutText()
  const hover = useHoverController()
  const endHover = () => { hover.leave() }
  const beginHover = (id: string, element: HTMLElement) => { hover.enter(id, () => element.getBoundingClientRect()) }
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const sections = statusSections(splitPutAway(props.sessions).listed, null, DEFAULT_SIDEBAR_SORT)
  return (
    <div className="mx-rail">
      <div className="mx-rail-top">
        <button type="button" className="mx-head-button is-rail" aria-label="Expand sidebar" title={tip('Expand sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="expand" /></button>
        <SidebarStartMenu sidebar={props} machine={props.startMenu ?? props.machines[0]?.machine ?? 0} windowOpens>
          <button type="button" className="mx-head-button is-rail" aria-label="New session" title={tip('New session', 'new-session')} disabled={!props.canStart}><Icon name="plus" size={15} /></button>
        </SidebarStartMenu>
        <button type="button" className="mx-head-button is-rail" aria-label="Search" title={tip('Search', 'palette')} onClick={props.onSearch}><Icon name="search" size={15} /></button>
      </div>
      <div className="mx-rail-rule" aria-hidden="true" />
      <div className="mx-rail-list mx-no-scrollbar" role="list" aria-label="Sessions">
        {sections.map((section, index) => (
          <Fragment key={section.key}>
            {index > 0 && <div role="separator" aria-label={`${section.name} · ${String(section.sessions.length)}`} className="mx-rail-sep" />}
            {section.sessions.map((session) => (
              <div key={session.id} role="listitem" className={`mx-rail-item${session.id === props.focusedId ? ' is-selected' : ''}${session.status === 'idle' ? ' is-idle' : ''}`}>
                <span className="mx-rail-bar" aria-hidden="true" />
                <button
                  type="button"
                  className="mx-rail-session"
                  aria-label={`${rowTitle(session)} · ${STATUS_WORD[session.status]}`}
                  aria-current={session.id === props.focusedId ? 'page' : undefined}
                  onClick={() => { endHover(); props.onShowSession(session.id) }}
                  onContextMenu={(event) => { event.preventDefault(); endHover(); setMenu({ title: rowTitle(session), at: { x: event.clientX, y: event.clientY }, items: sessionMenuEntries(props, session, shortcutText('close')) }) }}
                  onPointerEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
                  onPointerLeave={() => { endHover(); props.onHoverSession?.(null) }}
                  onFocus={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }}
                  onBlur={() => { endHover(); props.onHoverSession?.(null) }}
                >
                  <StatusIcon status={session.status} />
                </button>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      <div className="mx-rail-bottom">
        <button type="button" className="mx-head-button is-rail" aria-label="Remote machine" title="Add a remote machine" onClick={props.onAddMachine}><Icon name="plus" size={15} /></button>
        <button type="button" className="mx-head-button is-rail" aria-label="Settings" title={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" /></button>
      </div>
      <RowHoverHost controller={hover} sessions={props.sessions} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}
