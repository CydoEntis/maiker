import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { machineTitle, UPDATE_WORDS, type MachineHead, type UpdateAction } from '../model/machines'
import { STATUS_WORD, type SessionView } from '../model/session'
import { inProject, isShell, projectChoices, projectOf, rowTitle, sectionOf, splitPutAway, statusSections, type HeldRow } from '../model/sidebar'
import { sameProject, type MachineProjects, type OpenedProject } from '../model/openedProjects'
import { machineFoldCounts, machineFoldKey, projectFoldCounts, projectFoldKey, showsStatusHeadings, sidebarTree, treePlacement, waitingSessions, withSessionsOnly, type MachineNode, type ProjectNode, type WaitingSession } from '../model/sidebarTree'
import { readSidebarFolds, writeSidebarFolds } from '@/data/sidebarFolds'
import { useTipWithKeys, useShortcutText } from '@/features/shortcuts/platform'
import { SidebarResizer } from './SidebarResizer'
import { AppIcon, FolderMark, Icon, MachineIcon } from './glyphs'
import { StatusIcon } from '@/components/ui/status-icon'
import { Collapse } from './Collapse'
import { useReducedMotion } from './motion'
import { useFlip } from './useFlip'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { SessionRow } from './SessionRow'
import { helperLinks } from '../model/helpers'
import { SidebarFilterMenu } from './SidebarFilterMenu'
import { NeedsYouStrip } from './NeedsYouStrip'
import { FoldBadges } from './FoldBadges'
import { RowHoverHost } from './RowHoverHost'
import { useHoverController } from './useHoverController'
import { flipKey } from './flipKey'
import { menuPoint } from './menuPoint'
import { ProjectHeadActions } from './ProjectHeadActions'
import { projectCommands, projectMenuEntries, type ProjectActions } from './projectMenu'


export type SidebarProps = {
  /** Every session of every machine. Each machine lists its own, in `order`. */
  sessions: readonly SessionView[]
  /** The daemon has sent its first list; until then an empty list means "not known yet", not "none". */
  listed: boolean
  /** The machine groups: this computer first, then the others. */
  machines: readonly MachineHead[]
  /** Each machine's opened projects with their sessions (`useOpenedProjects().machines`): what the tree draws. */
  projects: readonly MachineProjects[]
  /** The project to show and mark (`useOpenedProjects().selected`): its machine and itself are unfolded when it changes. */
  selectedProject: OpenedProject | null
  /** A project of `STATUS_HEADINGS_FROM` sessions or more heads each status that has sessions (Settings › Show status headings). */
  statusHeadings: boolean
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
  /** Starts a plain terminal in a machine's home folder; absent in the Chat view, which makes none. */
  onNewShell?: ((machine: number) => void) | undefined
  onAddMachine: () => void
  /**
   * Opens a folder of a machine as a project, starting nothing. Every + that is not a project's own does this: a session
   * is started from an opened project, never on its own.
   */
  onOpenProject: (machine: number) => void
  /** What a project heading's buttons and right-click menu do; without it a heading only folds. */
  projectActions?: ProjectActions | undefined
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
  /** Lists the worktrees of this session's project, to start a session in one. */
  onOpenWorktree?: (id: string) => void
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
    // A worktree is made from a repository, so a session that has not gone into one yet cannot start it or list them.
    ...(props.onNewWorktree === undefined ? [] : [{ label: 'New worktree…', disabled: !props.online || session.repoRoot === null, run: () => { props.onNewWorktree?.(session.id) } }]),
    ...(props.onOpenWorktree === undefined ? [] : [{ label: 'Open worktree…', disabled: !props.online || session.repoRoot === null, run: () => { props.onOpenWorktree?.(session.id) } }]),
    ...(session.machineName === null ? [] : [{ label: 'Rename machine…', run: () => { props.onRenameMachine(session.machineName ?? '') } }]),
    ...(session.machineName === null ? [] : [{ label: 'Get a file…', disabled: !props.online, run: () => { props.onGetFile(session.id) } }]),
    // A finished agent waits under Done until you look; this files it under Idle without opening it.
    ...(session.status === 'done' ? [{ label: 'Mark as done', disabled: !props.online, run: () => { props.onMarkDone(session.id) } }] : []),
    ...(session.snoozedUntil !== null ? [{ label: 'Unsnooze', disabled: !props.online, run: () => { props.onUnsnooze(session.id) } }] : []),
    ...(session.archived ? [{ label: 'Bring back', disabled: !props.online, run: () => { props.onBringBack(session.id) } }] : []),
  ]
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

/** `folded` with `project` and its machine unfolded; the same set when neither was folded, so nothing is stored again. */
function unfolding(folded: ReadonlySet<string>, project: OpenedProject): ReadonlySet<string> {
  const shown = [machineFoldKey(project.machineName), projectFoldKey(project)]
  return shown.some((key) => folded.has(key)) ? new Set([...folded].filter((key) => !shown.includes(key))) : folded
}

/**
 * Which machine and project headings are folded, by their fold keys; kept in this window's storage, so a fold survives a
 * restart. A newly `selected` project is unfolded, with its machine, so the project just opened is never out of sight.
 * `listed` is the tree's own entry for it: the fold keys are spelled as the tree spells the folder, and so must a project
 * given to `reveal` be.
 */
function useFolds(selected: OpenedProject | null, listed: OpenedProject | null) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(readSidebarFolds()))
  const [revealed, setRevealed] = useState<OpenedProject | null>(null)
  // Adjusted while rendering, as it follows from the selection: the fold opens in the same frame the project is marked.
  if (selected !== revealed) {
    setRevealed(selected)
    const next = listed === null ? folded : unfolding(folded, listed)
    if (next !== folded) setFolded(next)
  }
  const kept = useRef(folded)
  useEffect(() => {
    if (folded === kept.current) return
    kept.current = folded
    writeSidebarFolds([...folded])
  }, [folded])
  return {
    /** Which headings are folded: what `flipKey` reads. */
    signature: [...folded].join(','),
    isOpen: (key: string) => !folded.has(key),
    /** Unfolds a project of the tree and its machine. */
    reveal: (project: OpenedProject) => { setFolded((current) => unfolding(current, project)) },
    toggle: (key: string) => {
      const next = new Set(folded)
      if (!next.delete(key)) next.add(key)
      setFolded(next)
    },
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
  const selected = props.selectedProject
  const views = useFolds(selected, selected === null ? null : props.projects.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, selected))?.project ?? null)
  // Folded until opened, unlike the other headings: what is put away is out of the way.
  const [putAwayOpen, setPutAwayOpen] = useState(false)
  const reduced = useReducedMotion()
  const [pickedProject, setPickedProject] = useState<string | null>(null)
  const projects = projectChoices(props.sessions)
  // A project whose last session closed is no longer a choice, so the list goes back to all of them.
  const project = projects.some((choice) => choice.name === pickedProject) ? pickedProject : null
  const { putAway } = splitPutAway(inProject(props.sessions, project))
  // The session on screen keeps the status section it was picked in until another is picked (`statusSections`).
  const [hold, setHold] = useState<{ for: string | null; row: HeldRow | null }>({ for: null, row: null })
  if (hold.for !== props.focusedId) {
    const focused = props.focusedId === null ? undefined : props.sessions.find((session) => session.id === props.focusedId)
    setHold({ for: props.focusedId, row: focused === undefined ? null : { id: focused.id, section: sectionOf(focused) } })
  }
  const held = hold.row
  const draft = props.draft ?? null
  const awayIds = new Set(putAway.map((session) => session.id))
  // Every session is under one project, put-away ones included (`useOpenedProjects`); only the listed ones are drawn there.
  const shown = (session: SessionView) => !awayIds.has(session.id) && (project === null || projectOf(session) === project)
  const whole = sidebarTree(props.machines, props.projects, shown, held, draft !== null)
  // Narrowed to one project, the tree drops what has nothing of it, as the list did before it was a tree.
  const tree = project === null ? whole : withSessionsOnly(whole, (head) => draft?.machine === head.machine)
  const localMachine = props.machines[0]?.machine ?? 0
  // Every machine and project, whatever the filter: what waits on you is never narrowed out of sight.
  const waiting = waitingSessions(props.machines, props.projects)
  const openWaiting = ({ session, project: place }: WaitingSession) => {
    // A filter on another project would keep the session's project out of the tree it is unfolded in.
    if (project !== null && projectOf(session) !== project) setPickedProject(null)
    views.reveal(place.project)
    props.onShowSession(session.id)
  }
  // Where each row sits, so a row that changes section because focus moved (`held`) still animates, while a focus change that moves nothing leaves the key alone and `useFlip` reads no layout.
  useFlip(list, reduced, flipKey(props.sessions, putAwayOpen, views.signature, draft !== null, treePlacement(tree, props.statusHeadings)))
  const openMenu = (event: MouseEvent, title: string, items: MenuEntry[], at = { x: event.clientX, y: event.clientY }) => {
    event.preventDefault()
    event.stopPropagation()
    endHover()
    setMenu({ title, at, items })
  }

  const sessionMenu = (session: SessionView): MenuEntry[] => sessionMenuEntries(props, session, shortcutText('close'))

  const machineMenu = (head: MachineHead): MenuEntry[] => {
    const open = views.isOpen(machineFoldKey(head.name))
    const name = head.name
    const action = head.updateAction
    return [
      ...(name !== null && action !== null ? [{ label: `${UPDATE_WORDS[action].verb} Maiker`, run: () => { props.onUpdateMachine(name, action) } }, 'separator' as const] : []),
      { label: 'Open a project…', disabled: !props.canStart || head.down, run: () => { props.onOpenProject(head.machine) } },
      ...(props.onNewShell === undefined ? [] : [{ label: 'New terminal here', disabled: !props.canStart || head.down, run: () => { props.onNewShell?.(head.machine) } }]),
      ...(head.down ? [{ label: `Not reachable: ${head.why ?? head.chip?.word ?? 'not reachable'}`, disabled: true, run: () => undefined }] : []),
      'separator',
      { label: open ? 'Collapse' : 'Expand', run: () => { views.toggle(machineFoldKey(head.name)) } },
      'separator',
      ...(name === null ? [] : [{ label: 'Rename…', run: () => { props.onRenameMachine(name) } }]),
      { label: 'Machine settings…', run: props.onMachineSettings },
    ]
  }

  // A heading's buttons and menu, from every session placed in the project (put-away ones too), not only the rows drawn.
  const projectHead = (head: MachineHead, node: ProjectNode): ProjectHeadProps | null => {
    const actions = props.projectActions
    if (actions === undefined) return null
    const placed = props.projects.flatMap((machine) => machine.projects).find((entry) => sameProject(entry.project, node.project))
    const commands = projectCommands(actions, { machine: head.machine, project: node.project, name: node.name, sessions: placed?.sessions ?? [], canStart: props.canStart && !head.down, online: props.online })
    const items = projectMenuEntries(commands)
    return {
      onContextMenu: (event) => { openMenu(event, node.name, items) },
      actions: <ProjectHeadActions name={node.name} commands={commands} onMore={(event) => { openMenu(event, node.name, items, menuPoint(event, true)) }} />,
    }
  }

  const links = helperLinks(props.sessions)
  const renderRow = (session: SessionView, showProject: boolean, showMachine = true) => {
    const selected = session.id === props.focusedId
    return (
      <div key={session.id} className="mx-row-wrap" role="listitem" data-flip={session.id} onMouseEnter={(event) => { beginHover(session.id, event.currentTarget); props.onHoverSession?.(session.id) }} onMouseLeave={() => { endHover(); props.onHoverSession?.(null) }} onMouseDown={endHover} onFocus={() => { props.onHoverSession?.(session.id) }} onBlur={() => { props.onHoverSession?.(null) }}>
        <SessionRow
          session={session}
          selected={selected}
          showProject={showProject}
          machine={showMachine ? session.machineName : null}
          starter={links.starterOf.get(session.id) ?? null}
          helpers={links.helpersOf.get(session.id) ?? null}
          onShow={() => { props.onShowSession(session.id) }}
          onRename={() => { props.onRenameSession(session.id) }}
          onContextMenu={(event) => { openMenu(event, rowTitle(session), sessionMenu(session)) }}
        />
        {/* A sibling of the row, not inside it (a button cannot hold a button): it shows on hover and focus. */}
      </div>
    )
  }

  const machineSection = (node: MachineNode) => (
    <MachineSection
      key={node.key}
      node={node}
      open={views.isOpen(node.key) || draft?.machine === node.head.machine}
      draft={draft?.machine === node.head.machine ? draft : null}
      progress={node.head.name === null ? undefined : props.updateProgress?.[node.head.name]}
      onToggle={() => { views.toggle(node.key) }}
      onUpdate={props.onUpdateMachine}
      onContextMenu={(event) => { openMenu(event, machineTitle(node.head), machineMenu(node.head)) }}
      canStart={props.canStart}
      onOpenProject={props.onOpenProject}
      onFix={props.onFixMachine}
    >
      {node.projects.map((project) => (
        <ProjectSection
          key={project.key}
          node={project}
          open={views.isOpen(project.key)}
          onToggle={() => { views.toggle(project.key) }}
          headings={showsStatusHeadings(project.count, props.statusHeadings)}
          selected={props.selectedProject !== null && sameProject(project.project, props.selectedProject)}
          head={projectHead(node.head, project)}
          renderRow={(session) => renderRow(session, true, false)}
        />
      ))}
    </MachineSection>
  )
  return (
    <div className="mx-sidebar-expanded">
      <div className="mx-sidebar-top">
        <button type="button" className="mx-head-button" aria-label="Hide sidebar" title={tip('Hide sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="panelLeft" size={14} /></button>
        <span className="mx-sidebar-title">Chats</span>
        <span className="mx-spacer" />
        <button type="button" className="mx-head-button" aria-label="Search" title={tip('Search', 'palette')} onClick={props.onSearch}><Icon name="search" size={14} /></button>
        <SidebarFilterMenu projects={projects} project={project} onProject={setPickedProject} />
        <button type="button" className="mx-head-button" aria-label="Open a project" title="Open a project" disabled={!props.canStart} onClick={() => { props.onOpenProject(localMachine) }}><Icon name="plus" size={15} /></button>
      </div>
      {/* Outside the scrolling list, so it stays in view while the tree scrolls. */}
      <NeedsYouStrip waiting={waiting} focusedId={props.focusedId} onOpen={openWaiting} onContextMenu={(event, { session }) => { openMenu(event, rowTitle(session), sessionMenu(session)) }} />
      <div ref={list} className="mx-sidebar-list" onScroll={endHover}>
        <section aria-label="Agents" className="mx-machines">
          {tree.map(machineSection)}
          {props.sessions.length === 0 && draft === null && <div className="mx-empty-note">{props.listed ? 'Open a project, then start a session in it. Sessions appear here, sorted by what needs you.' : 'Looking for your sessions…'}</div>}
        </section>
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
        <button type="button" className="mx-head-button mx-settings-button" aria-label="Settings" title={tip('Settings', 'settings')} onClick={props.onOpenSettings}><Icon name="gear" size={16} /></button>
      </div>
      <RowHoverHost controller={hover} sessions={props.sessions} portalContainer={props.portalContainer} />
      {menu && <MenuPopup key={`${String(menu.at.x)},${String(menu.at.y)}`} title={menu.title} at={menu.at} items={menu.items} portalContainer={props.portalContainer} onClose={() => { setMenu(null) }} />}
    </div>
  )
}

type ListSectionProps = {
  id: string
  name: string
  /** What the list is called for a screen reader. */
  label: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** The Put away heading, with the rows under it; the heading folds them away. */
function ListSection({ id, name, label, count, open, onToggle, children }: ListSectionProps) {
  return (
    <div className="mx-section" data-section={id}>
      <button type="button" className="mx-section-head" data-flip={`head:${id}`} aria-expanded={open} onClick={onToggle}>
        <span className="mx-section-name">{name}</span>
        <span className="mx-section-count mono">{count}</span>
      </button>
      <Collapse open={open}>
        <div className="mx-rows" role="list" aria-label={label}>{children}</div>
      </Collapse>
    </div>
  )
}

/** A project heading's right-click menu and its buttons (`ProjectHeadActions`). */
type ProjectHeadProps = { onContextMenu: (event: MouseEvent) => void; actions: ReactNode }

type ProjectSectionProps = {
  node: ProjectNode
  open: boolean
  onToggle: () => void
  /** Each status that has sessions under its own heading; otherwise one list in the same order. */
  headings: boolean
  /** The project last opened or picked (`useOpenedProjects().selected`), marked on its heading. */
  selected: boolean
  /** Null: the heading only folds. */
  head: ProjectHeadProps | null
  renderRow: (session: SessionView) => ReactNode
}

/**
 * One opened project under its machine: a heading that folds it (its folder in the tooltip), then its sessions by status,
 * Needs you, Working, Done and Idle, the latest change first in each. A heading names a status only when `headings` is on.
 */
function ProjectSection({ node, open, onToggle, headings, selected, head, renderRow }: ProjectSectionProps) {
  return (
    <div className="mx-project" data-project={node.key}>
      {/* A row holding the folding button and the action buttons beside it, as a machine heading does: a button cannot hold a button. */}
      <div className={`mx-project-head${selected ? ' is-selected' : ''}`} data-flip={`head:${node.key}`} onContextMenu={head?.onContextMenu}>
        <button type="button" className="mx-project-toggle" aria-expanded={open} aria-current={selected ? 'true' : undefined} title={node.project.folder} onClick={onToggle}>
          <span className={`mx-caret-wrap${open ? ' is-open' : ''}`} aria-hidden="true"><Icon name="caret" /></span>
          <FolderMark size={14} />
          <span className="mx-project-name">{node.name}</span>
          <FoldBadges counts={projectFoldCounts(node)} folded={!open} />
        </button>
        {head?.actions}
      </div>
      <Collapse open={open}>
        {node.count === 0 && <div className="mx-project-empty">No sessions</div>}
        {headings
          ? node.sections.map((section) => (
            <div key={section.key} className="mx-status">
              <div className={`mx-status-head is-${section.key}`} data-tone={section.key} data-flip={`head:${node.key}:${section.key}`} aria-hidden="true">
                <span className="mx-section-name">{section.name}</span>
                <span className="mx-section-count mono" data-tone={section.key}>{section.sessions.length}</span>
              </div>
              <div className="mx-rows" role="list" aria-label={`${section.name} in ${node.name}`}>{section.sessions.map(renderRow)}</div>
            </div>
          ))
          : node.count > 0 && <div className="mx-rows" role="list" aria-label={node.name}>{node.sections.flatMap((section) => section.sessions).map(renderRow)}</div>}
      </Collapse>
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
  // One thing to press: a machine that is down because its Maiker is old or missing says so here, and the head carries no second button.
  const update = head.updateAction
  return (
    <span className="mx-machine-why" title={reason === null || reason === '' ? undefined : reason}>
      <span className="mx-machine-why-dot" aria-hidden="true" />
      <span className="mx-machine-why-word">{update === null ? 'Offline' : update === 'install' ? 'Maiker not installed' : 'Needs update'}</span>
      <button type="button" className="mx-machine-fix" aria-label={update === null ? `Fix ${head.label}` : `${UPDATE_WORDS[update].verb} Maiker on ${head.label}`} onClick={() => { onFix(head) }}>{update === null ? 'Fix' : UPDATE_WORDS[update].verb}</button>
    </span>
  )
}

type SectionProps = {
  canStart: boolean
  /** Wraps a machine's + in its + menu. */
  onOpenProject: (machine: number) => void
  onFix: (head: MachineHead) => void
  /** The draft chat, listed last on this machine; null when it is not on this machine. */
  draft: DraftChat | null
  /** How far this machine's update has got, while one runs. */
  progress: number | undefined
  node: MachineNode
  open: boolean
  onToggle: () => void
  onUpdate: (name: string, action: UpdateAction) => void
  onContextMenu: (event: MouseEvent) => void
  /** The machine's projects (`ProjectSection`). */
  children: ReactNode
}

/** One machine: its heading (name, count, update, its line's dot) and its opened projects, each with its sessions. */
function MachineSection({ draft, progress, node, open, onToggle, onUpdate, onContextMenu, children, canStart, onOpenProject, onFix }: SectionProps) {
  const { head } = node
  const title = machineTitle(head)
  return (
    <div className={`mx-machine${head.down ? ' is-away' : ''}`}>
      <div className="mx-machine-head" data-flip={`machine:${head.key}`}>
        <button type="button" className="mx-machine-toggle" aria-expanded={open} onClick={onToggle} onContextMenu={onContextMenu}>
          <span className={`mx-caret-wrap${open ? ' is-open' : ''}`}><Icon name="caret" /></span>
          <span className="mx-machine-icon" aria-hidden="true"><MachineIcon remote={head.name !== null} /></span>
          <span className="mx-machine-name">{title}</span>
          <span className="mx-machine-count">{node.count}</span>
          <FoldBadges counts={machineFoldCounts(node)} folded={!open} />
        </button>
        {progress !== undefined
          ? <span className="mx-machine-pct mono">{String(progress)}%</span>
          : head.name !== null && !head.down && head.updateAction !== null && <UpdateButton name={head.name} action={head.updateAction} onUpdate={onUpdate} />}
        <button type="button" className="mx-head-button is-small mx-machine-add" aria-label={`Open a project on ${title}`} title={`Open a project on ${title}`} disabled={!canStart || head.down} onClick={() => { onOpenProject(head.machine) }}><Icon name="plus" size={13} /></button>
        <span className={`mx-machine-dot${head.updateAction !== null ? ' is-warn' : head.down ? ' is-offline' : ''}`} role="img" aria-label={head.down ? `${title} is ${head.chip?.word ?? 'not reachable'}` : `${title} is connected`} title={head.why ?? (head.down ? head.chip?.word ?? 'not reachable' : `${title} is connected`)} />
      </div>
      {progress !== undefined && head.name !== null && (
        <span className="mx-machine-progress" role="progressbar" aria-label={`Updating ${head.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${String(progress)}%` }} /></span>
      )}
      {head.down && head.name !== null && progress === undefined && <MachineWhy head={head} onFix={onFix} />}
      {!head.down && head.name !== null && head.chip?.tone === 'quiet' && <span className="mx-machine-why"><span className="mx-machine-why-word">Connecting…</span></span>}
      <Collapse open={open}>
        <div className="mx-projects" role="group" aria-label={`Projects on ${title}`}>{children}</div>
        {node.projects.length === 0 && draft === null && <div className="mx-machine-empty">No sessions yet</div>}
        {/* Last, under the projects, so the projects above it never move while it is written. */}
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
 * status icon per session under its status, every machine and project together (a hairline between the statuses), the
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
  const sections = statusSections(splitPutAway(props.sessions).listed)
  return (
    <div className="mx-rail">
      <div className="mx-rail-top">
        <button type="button" className="mx-head-button is-rail" aria-label="Expand sidebar" title={tip('Expand sidebar', 'toggle-sidebar')} onClick={props.onToggleRail}><Icon name="expand" /></button>
        <button type="button" className="mx-head-button is-rail" aria-label="Open a project" title="Open a project" disabled={!props.canStart} onClick={() => { props.onOpenProject(props.machines[0]?.machine ?? 0) }}><Icon name="plus" size={15} /></button>
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
