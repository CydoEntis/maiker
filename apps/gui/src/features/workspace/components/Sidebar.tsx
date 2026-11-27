import { Fragment, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { FolderPlus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useShortcutText, useTipWithKeys } from '@/features/shortcuts/platform'
import { StatusIcon } from '@/components/ui/status-icon'
import { helperDiff, helperLinks, helpersWord, helperSummary, summarySpoken } from '../model/helpers'
import { machineTitle, type MachineHead, type UpdateAction } from '../model/machines'
import { sameProject, type MachineProjects, type OpenedProject } from '../model/openedProjects'
import type { SessionView } from '../model/session'
import { rowTitle } from '../model/sidebar'
import { filterChoices, helpersFoldKey, NO_FILTER, passesFilter, sidebarOrder, type ProjectGroup, type SessionNode, type SidebarFilter, type SidebarSort } from '../model/sidebarTree'
import { Collapse } from './Collapse'
import { Icon } from './glyphs'
import { machineMenuEntries, type MachineActions } from './machineMenu'
import { MachineTag } from './MachineTag'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { isMenuKey } from './menuPoint'
import { projectContextMenu, projectPlusMenu, type ProjectActions, type ProjectTarget } from './projectMenu'
import { ProjectBadge } from './ProjectBadge'
import { RowHoverHost } from './RowHoverHost'
import { sessionMenuEntries } from './sessionMenu'
import { SessionRow } from './SessionRow'
import { SidebarFilterMenu } from './SidebarFilterMenu'
import { SidebarRail } from './SidebarRail'
import { SidebarResizer } from './SidebarResizer'
import { useHeldRow } from './useHeldRow'
import { useHoverController } from './useHoverController'
import { useSidebarFolds } from './useSidebarFolds'

export type SidebarProps = {
  /** The docked column sliding in after it was hidden, or out as it hides (`useSidebarSlide`); absent at rest. */
  slide?: 'in' | 'out' | undefined
  /** Every session of every machine. */
  sessions: readonly SessionView[]
  /** The daemon has sent its first list; until then an empty list means "not known yet", not "none". */
  listed: boolean
  /** The configured machines: this computer first, then the others. */
  machines: readonly MachineHead[]
  /** Each machine's opened projects with their sessions (`useOpenedProjects().machines`): what the sidebar lists. */
  projects: readonly MachineProjects[]
  /** The project last opened or picked (`useOpenedProjects().selected`): it is unfolded when it changes. */
  selectedProject: OpenedProject | null
  /** Every opened project in the order it was opened (`useOpenedProjects().opened`), for the Recent order. */
  opened: readonly OpenedProject[]
  /** How the projects are ordered, and how the filter menu changes it. */
  sort: SidebarSort
  onSort: (sort: SidebarSort) => void
  /** The agent programs on this computer, for a project's `+` menu; null while that is unknown. */
  installedAgents: readonly string[] | null
  /** Opens the search over every session, project and action. */
  onSearch: () => void
  focusedId: string | null
  mode: 'docked' | 'rail'
  online: boolean
  canStart: boolean
  /** Where portalled menus mount, so they read the theme's colours. */
  portalContainer: HTMLElement | null
  /** Collapses the docked sidebar to the rail, or expands the rail (over the window when it is narrow). */
  onToggleRail: () => void
  side: 'left' | 'right'
  /** The docked sidebar's width in px, and how the user changes it by dragging its edge. */
  width: number
  onResize: (width: number) => void
  onResizeEnd: (width: number) => void
  onAddMachine: () => void
  /** Shows Open a project, starting nothing: a machine's folders, or every source when no machine is named (null). */
  onOpenProject: (machine: number | null) => void
  /** What a project heading's menus do; without it a heading only folds. */
  projectActions?: ProjectActions | undefined
  onMachineSettings: () => void
  /** Dials a machine that is not up again (by its real name). */
  onRetryMachine: (name: string) => void
  /** Opens ssh to a machine in a terminal, for a login that needs a password or a second code. */
  onSignInMachine: (machine: number, name: string) => void
  /** Copies the command a down machine's sentence names. */
  onCopyCommand: (command: string) => void
  /** Asks for a name of the user's own for another machine (by its real name). */
  onRenameMachine: (name: string) => void
  /** Installs or updates the app on a machine that needs it; the window asks first. */
  onUpdateMachine: (name: string, action: UpdateAction) => void
  onShowSession: (id: string) => void
  onRenameSession: (id: string | null) => void
  /** Gives a session the name typed in its row. Without it Rename asks the window (`onRenameSession`). */
  onSaveSessionName?: ((id: string, name: string) => void) | undefined
  onCopyPath: (id: string) => void
  /** The pointer or keyboard is on this session's row (`null`: it left), so its chat can be read ahead of a click. */
  onHoverSession?: ((id: string | null) => void) | undefined
  /** Makes a worktree off this session's repository, with a session open in it. */
  onNewWorktree?: (id: string) => void
  /** Lists the worktrees of this session's project, to start a session in one. */
  onOpenWorktree?: (id: string) => void
  onEndSession: (id: string) => void
  onOpenSettings: () => void
  /** The foot's pull-request button: how many need the person across the opened projects, and what a press opens. */
  pullRequests?: { needYou: number; onOpen: () => void } | undefined
  /** How far an install or update of each remote machine has got, by machine name, 0 to 100; absent when none runs. */
  updateProgress?: Readonly<Record<string, number>> | undefined
}

type OpenMenu = { title: string; at: { x: number; y: number }; items: MenuEntry[]; context?: ReactNode; /** The row or heading a right-click or the menu key opened it on. */ owner?: string }

/** The gap between a heading or a tag and the menu that opens under it. */
const MENU_GAP_PX = 4

/** Where a menu opens under what was pressed: its left edge, just below it. */
function under(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect()
  return { x: box.left, y: box.bottom + MENU_GAP_PX }
}

/** What a row's card is placed beside: the row's own height, across the whole sidebar, so every card keeps one edge. */
function cardAnchor(row: HTMLElement): DOMRect {
  const box = row.getBoundingClientRect()
  const side = row.closest('.mx-sidebar')?.getBoundingClientRect() ?? box
  return new DOMRect(side.left, box.top, side.width, box.height)
}

export function Sidebar(props: SidebarProps) {
  const [resizing, setResizing] = useState(false)
  const className = `mx-sidebar mx-card${props.mode === 'rail' ? ' is-rail' : ''}${resizing ? ' is-resizing' : ''}${props.slide === undefined ? '' : ` is-sliding-${props.slide}`}`
  return (
    <nav aria-label="Sessions" className={className}>
      {props.mode === 'rail' ? <SidebarRail {...props} /> : <Expanded {...props} />}
      {props.mode === 'docked' && <SidebarResizer side={props.side} width={props.width} onResize={props.onResize} onResizeEnd={props.onResizeEnd} onDragging={setResizing} />}
    </nav>
  )
}

/** The filter as it can still apply: a project or a machine that is no longer listed narrows nothing. */
function validFilter(filter: SidebarFilter, choices: ReturnType<typeof filterChoices>): SidebarFilter {
  return {
    project: choices.projects.some((choice) => choice.name === filter.project) ? filter.project : null,
    machine: choices.machines.some((choice) => choice.key === filter.machine) ? filter.machine : null,
  }
}

function Expanded(props: SidebarProps) {
  const tip = useTipWithKeys()
  const shortcutText = useShortcutText()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  // The card beside a row the pointer rests on. It follows a controller outside React state, so a hover never draws the rows.
  const hover = useHoverController()
  const endHover = () => { hover.leave() }
  const beginHover = (id: string, element: HTMLElement) => { hover.enter(id, () => cardAnchor(element)) }
  const choices = filterChoices(props.machines, props.projects)
  const [picked, setPicked] = useState<SidebarFilter>(NO_FILTER)
  const held = useHeldRow(props.focusedId, props.sessions)
  // The project just opened or picked is shown whatever the filter said: opening a project and not seeing it reads as a failure.
  const selected = props.selectedProject
  const [filteredFor, setFilteredFor] = useState(selected)
  const everything = sidebarOrder(props.machines, props.projects, NO_FILTER, null, props.sort, props.opened)
  const listedSelected = selected === null ? null : everything.projects.find((group) => sameProject(group.project, selected)) ?? null
  const valid = validFilter(picked, choices)
  const hidesSelected = selected !== filteredFor && listedSelected !== null && !passesFilter(valid, listedSelected)
  if (selected !== filteredFor) {
    setFilteredFor(selected)
    if (hidesSelected) setPicked(NO_FILTER)
  }
  const filter = hidesSelected ? NO_FILTER : valid
  const order = sidebarOrder(props.machines, props.projects, filter, held, props.sort, props.opened)
  // The project just opened or picked is unfolded, so its sessions show.
  const revealKeys = listedSelected === null ? [] : [listedSelected.key]
  const folds = useSidebarFolds(selected, revealKeys)

  // The session whose name is being typed in its row.
  const [renaming, setRenaming] = useState<string | null>(null)
  const { onSaveSessionName, onRenameSession } = props
  const rename = (id: string) => {
    endHover()
    if (onSaveSessionName === undefined) onRenameSession(id)
    else setRenaming(id)
  }
  const openMenu = (event: MouseEvent | KeyboardEvent, next: OpenMenu) => {
    event.preventDefault()
    event.stopPropagation()
    // Some web views also send a right-click for the menu key; the menu the key opened under the row stays where it is.
    if (next.owner !== undefined && menu?.owner === next.owner) return
    endHover()
    setMenu(next)
  }
  const sessionMenu = (session: SessionView, at: { x: number; y: number }): OpenMenu => ({
    owner: session.id,
    title: rowTitle(session),
    at,
    items: sessionMenuEntries(props, session, shortcutText('close'), { onRename: () => { rename(session.id) }, worktreeHint: shortcutText('new-worktree') }),
  })
  const machineActions: MachineActions = { onRetry: props.onRetryMachine, onSignIn: props.onSignInMachine, onCopyCommand: props.onCopyCommand, onRename: props.onRenameMachine, onUpdate: props.onUpdateMachine, onSettings: props.onMachineSettings, onOpenProject: props.canStart ? props.onOpenProject : undefined }

  const targetOf = (group: ProjectGroup): ProjectTarget => ({
    machine: group.head.machine,
    machineLabel: machineTitle(group.head),
    remote: group.head.name !== null,
    project: group.project,
    name: group.name,
    sessions: group.sessions,
    canStart: props.canStart && !group.head.down,
    online: props.online,
    installed: props.installedAgents,
    loose: group.loose,
  })
  /** A heading's parts that open a menu: its `+`, its right-click and its machine tag. Null where the window gave no actions. */
  const headOf = (group: ProjectGroup): HeadMenus => {
    const actions = props.projectActions
    const name = group.head.name
    return {
      onPlus: actions === undefined ? null : (event) => {
        const plus = projectPlusMenu(actions, targetOf(group), shortcutText)
        const row = event.currentTarget.closest('[data-project]') ?? event.currentTarget
        openMenu(event, { title: `New in ${group.name}`, at: under(row), items: plus.items, context: <><Icon name={name === null ? 'monitor' : 'server'} size={12} /><span>{plus.context}</span></> })
      },
      onContextMenu: actions === undefined ? undefined : (event) => { openMenu(event, { owner: group.key, title: group.name, at: { x: event.clientX, y: event.clientY }, items: projectContextMenu(actions, targetOf(group), shortcutText) }) },
      onKeyDown: actions === undefined ? undefined : (event) => { if (isMenuKey(event)) openMenu(event, { owner: group.key, title: group.name, at: under(event.currentTarget), items: projectContextMenu(actions, targetOf(group), shortcutText) }) },
      tag: name === null ? null : (
        <MachineTag head={group.head} progress={props.updateProgress?.[name]} onMenu={(event) => { openMenu(event, { title: machineTitle(group.head), at: under(event.currentTarget), items: machineMenuEntries(group.head, name, machineActions) }) }} onUpdate={() => { const fix = group.head.updateAction; if (fix !== null) props.onUpdateMachine(name, fix) }} />
      ),
    }
  }

  const links = helperLinks(props.sessions)
  const renderRow = (session: SessionView, nested: boolean) => (
    <div key={session.id} className={`mx-sb-item${nested ? ' is-nested' : ''}`} role="listitem" onMouseEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }} onMouseLeave={() => { endHover(); props.onHoverSession?.(null) }} onMouseDown={endHover} onFocus={() => { props.onHoverSession?.(session.id) }} onBlur={() => { props.onHoverSession?.(null) }}>
      <SessionRow
        session={session}
        selected={session.id === props.focusedId}
        starter={links.starterOf.get(session.id) ?? null}
        helpers={links.helpersOf.get(session.id) ?? null}
        diff={nested ? helperDiff(session) : null}
        renaming={renaming === session.id}
        onShow={() => { props.onShowSession(session.id) }}
        onRename={() => { rename(session.id) }}
        onRenameSave={(name) => { onSaveSessionName?.(session.id, name) }}
        onRenameEnd={() => { setRenaming(null) }}
        onContextMenu={(event) => { openMenu(event, sessionMenu(session, { x: event.clientX, y: event.clientY })) }}
        onMenuKey={(event) => { openMenu(event, sessionMenu(session, under(event.currentTarget))) }}
      />
    </div>
  )
  const renderRows = (rows: readonly SessionNode[]) => rows.map((node) => (
    <Fragment key={node.session.id}>
      {renderRow(node.session, false)}
      {node.helpers.length > 0 && (
        <HelperGroup lead={node.session} helpers={node.helpers} open={folds.isOpen(helpersFoldKey(node.session.id))} onToggle={() => { folds.toggle(helpersFoldKey(node.session.id)) }}>
          {node.helpers.map((helper) => renderRow(helper, true))}
        </HelperGroup>
      )}
    </Fragment>
  ))

  const nothingListed = order.projects.length === 0
  return (
    <div className="mx-sidebar-expanded">
      <div className="mx-sb-top">
        <IconButton large label="Hide sidebar" tip={tip('Hide sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="panelLeft" /></IconButton>
        <span className="mx-sb-title">Chats</span>
        <span className="mx-spacer" />
        <SidebarFilterMenu projects={choices.projects} machines={choices.machines} filter={filter} onFilter={setPicked} sort={props.sort} onSort={props.onSort} />
        <IconButton large label="Open a project" tip={tip('Open a project', 'open-folder')} disabled={!props.canStart} onClick={() => { props.onOpenProject(null) }}><FolderPlus strokeWidth={1.9} aria-hidden="true" /></IconButton>
      </div>
      {/* Search as a field across the sidebar, not a third small icon: on the bare ground it anchors the top. */}
      <button type="button" className="mx-sb-search-button" title={tip('Search', 'palette')} onClick={props.onSearch}><Icon name="search" /><span>Search</span></button>
      <div className="mx-sb-body">
        <div className="mx-sb-list" onScroll={endHover}>
          {!props.listed && props.sessions.length === 0 && <p className="mx-sb-note">Looking for your sessions…</p>}
          {/* With a project open, its own heading says it has no sessions; the card is only for a sidebar with nothing in it. */}
          {props.listed && props.sessions.length === 0 && nothingListed && (
            <div className="mx-sb-empty">
              <b>No sessions yet</b>
              <span>Open a project, then start a session in it. It shows here, with the ones that need you on top.</span>
            </div>
          )}
          {order.projects.map((group) => (
            <Project key={group.key} group={group} open={folds.isOpen(group.key)} onToggle={() => { folds.toggle(group.key) }} menus={headOf(group)}>
              {renderRows(group.rows)}
            </Project>
          ))}
        </div>
      </div>
      <div className="mx-sb-foot">
        {/* The service's state is the title bar's chip, so the foot never says it a second time. */}
        <IconButton large label="Add a remote machine" onClick={props.onAddMachine}><Icon name="serverPlus" /></IconButton>
        {props.pullRequests && <PullRequestsButton {...props.pullRequests} />}
        <span className="mx-spacer" />
        <IconButton large label="Settings" tip={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" /></IconButton>
      </div>
      <RowHoverHost controller={hover} sessions={props.sessions} namesMachine={props.machines.some((head) => head.name !== null)} machines={props.machines} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} context={menu.context} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}

/** `count` pull requests need the person, as the button's name and its badge's tooltip say it. */
function needYouWords(count: number): string {
  return count === 1 ? '1 pull request needs you' : `${String(count)} pull requests need you`
}

/** The foot's pull-request button. Its badge counts only the pull requests that need the person; with none it has no badge. */
function PullRequestsButton({ needYou, onOpen }: { needYou: number; onOpen: () => void }) {
  const waiting = needYou > 0
  return (
    <IconButton large label={waiting ? `Pull requests, ${needYouWords(needYou)}` : 'Pull requests'} tip={waiting ? needYouWords(needYou) : 'Pull requests'} onClick={onOpen}>
      <Icon name="pullRequest" />
      {waiting && <span className="mx-sb-foot-count" aria-hidden="true">{needYou}</span>}
    </IconButton>
  )
}

/** What opens a menu from a project heading. `onPlus` is null and `onContextMenu` absent where the window gave no actions. */
type HeadMenus = {
  onPlus: ((event: MouseEvent<HTMLElement>) => void) | null
  onContextMenu: ((event: MouseEvent) => void) | undefined
  /** The menu key on the heading opens the same menu under it. */
  onKeyDown: ((event: KeyboardEvent<HTMLElement>) => void) | undefined
  /** The machine tag of a project on another machine. */
  tag: ReactNode
}

/** The marks on a helper summary line, the size of a row's. */
const SUMMARY_MARK_PX = 14

/**
 * A lead's helpers, one step in under its row with a rule down their left edge. The first line is the summary and the
 * fold: how many there are and, at the right, the most urgent thing among them (how many need you, else that one works,
 * else that they are done), so a folded group still says whether it wants the person.
 */
function HelperGroup({ lead, helpers, open, onToggle, children }: { lead: SessionView; helpers: readonly SessionView[]; open: boolean; onToggle: () => void; children: ReactNode }) {
  const summary = helperSummary(helpers)
  const count = helpersWord(summary.count)
  const leadName = rowTitle(lead)
  return (
    <div className="mx-sb-helpers" role="listitem">
      <button type="button" className={`mx-sb-helpers-sum is-${summary.state}`} aria-expanded={open} aria-label={`${summarySpoken(summary)}, under ${leadName}`} onClick={onToggle}>
        <span className={`mx-sb-caret${open ? ' is-open' : ''}`} aria-hidden="true"><Icon name="caret" /></span>
        <span className="mx-sb-helpers-count">{count}</span>
        {summary.state !== 'idle' && (
          <span className="mx-sb-helpers-state">
            <StatusIcon status={summary.state} size={SUMMARY_MARK_PX} />
            {summary.state === 'needs' && summary.needs}
          </span>
        )}
      </button>
      {open && <div className="mx-sb-helpers-rows" role="list" aria-label={`Helpers of ${leadName}`}>{children}</div>}
    </div>
  )
}

/** `count` sessions as a heading's name says it. */
const sessionsWord = (count: number): string => `${String(count)} ${count === 1 ? 'session' : 'sessions'}`

/** How a project's own state is said on its heading and to a screen reader. */
const PROJECT_STATE_WORDS: Readonly<Record<'needs' | 'working' | 'done', string>> = { needs: 'needs you', working: 'working', done: 'done' }

/**
 * A project and all its sessions, self-contained: its heading (badge, name, machine tag, how many sessions, and its own
 * state, the most urgent of its rows) folds its rows, `+` opens what can start in it, and a right-click its menu. A project
 * with nothing going on is drawn grey (`.is-idle`) until the pointer or the keyboard is on it. One with no session has
 * nothing to fold: its heading opens the `+` menu itself, with "No sessions" at its right.
 */
function Project({ group, open, onToggle, menus, children }: { group: ProjectGroup; open: boolean; onToggle: () => void; menus: HeadMenus; children: ReactNode }) {
  const { onPlus } = menus
  const empty = group.rows.length === 0
  const quiet = group.mark === null || group.mark === 'idle'
  const state = group.mark === null || group.mark === 'idle' ? null : group.mark
  const name = (
    <>
      <ProjectBadge name={group.name} loose={group.loose} />
      <span className="mx-sb-head-name">{group.name}</span>
    </>
  )
  return (
    <div className={`mx-sb-group${quiet ? ' is-idle' : ''}`}>
      {/* A row holding the folding button and the buttons beside it: a button cannot hold a button. */}
      <div className={`mx-sb-head${quiet ? ' is-idle' : ''}`} data-project={group.key} onContextMenu={menus.onContextMenu} onKeyDown={menus.onKeyDown}>
        {empty ? (
          <button type="button" className="mx-sb-head-main" {...(onPlus === null ? { disabled: true } : { 'aria-haspopup': 'menu' as const, onClick: onPlus })} title={`Start a session or a worktree in ${group.name}`}>
            {name}
            <span className="sr-only">, no sessions</span>
          </button>
        ) : (
          <button type="button" className="mx-sb-head-main" aria-expanded={open} title={group.project.folder} onClick={onToggle}>
            {name}
            <span className="sr-only">{`, ${sessionsWord(group.rows.length)}${state === null ? '' : `, ${PROJECT_STATE_WORDS[state]}`}`}</span>
          </button>
        )}
        {menus.tag}
        <span className="mx-spacer" />
        {empty && <span className="mx-sb-head-note" aria-hidden="true">No sessions</span>}
        {/* The sessions under an open project show their own state; folded, the project carries the most urgent one. */}
        {state !== null && !open && <span className="mx-sb-head-state" aria-hidden="true" title={PROJECT_STATE_WORDS[state]}><StatusIcon status={state} size={SUMMARY_MARK_PX} /></span>}
        {!empty && <span className={`mx-sb-caret is-quiet${open ? ' is-open' : ''}`} aria-hidden="true"><Icon name="caret" /></span>}
        {/* With no session the heading itself opens this menu from the keyboard, so the + is only the pointer's second way in. */}
        {onPlus !== null && (
          <IconButton className="mx-sb-add" label={`New session or worktree in ${group.name}`} {...(empty ? { tabIndex: -1, 'aria-hidden': true } : { 'aria-haspopup': 'menu' as const })} onClick={onPlus}>
            <Icon name="plus" />
          </IconButton>
        )}
      </div>
      {!empty && (
        <Collapse open={open}>
          <div className="mx-sb-rows" role="list" aria-label={group.name}>{children}</div>
        </Collapse>
      )}
    </div>
  )
}
