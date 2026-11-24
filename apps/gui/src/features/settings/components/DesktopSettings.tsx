import { ApprovedCommands } from './ApprovedCommands'
import { HelpersSection } from './HelpersSection'
import { toast } from '@/lib/toast'
import type { UpdaterState } from '@/features/updates/useUpdater'
import type { Transfer } from '@/features/updates/downloadEta'
import { Fragment, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { groupShowsWhole, GroupShowsAll, matchesQuery, rowIsResult, SettingsSearch } from '../settingsSearch'
import { ThemePicker } from './ThemePicker'
import { Panel } from '@/components/ui/panel'
import { PickerSelect, type PickerGroup, type PickerItem } from './PickerSelect'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { ViewSwitch } from '@/features/workspace/components/ViewSwitch'
import { Switch } from '@/components/ui/switch'
import type { GitHubSignIn } from './GitHubSection'
import { MachinesPage } from './MachinesPage'
import { UpdateBox } from './UpdateBox'
import { UpdatesPage } from './UpdatesPage'
import { ExtensionsSection } from '@/features/extensions/ExtensionsSection'
import type { ExtensionProject } from '@/features/extensions/projects'
import { captureCombo, comboChord, HOTKEY_GROUPS, hotkeyRows, isOwnKey, KEY_CAPTURE_ATTRIBUTE, matchShortcut, takenBy, withoutAction, writeChord, type KeyOverrides, type Platform, type ShortcutAction } from '@/features/workspace/model/shortcuts'
import { type ChatAgent, type PaneView } from '@/features/workspace/model/chatView'
import { asksFirst, confirmAsk, withSkipped } from '@/features/confirm/confirm'
import { ConfirmHost } from '@/features/confirm/ConfirmDialog'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { Keycaps } from '@/features/shortcuts/Keycaps'
import { Icon } from '@/features/workspace/components/glyphs'
import { explainError } from '@/lib/error-message'
import { loadAgentAuth, signOutAgent, type AgentAuth } from '@/api/daemon'
import { SignInCard } from '@/features/signin/SignInCard'
import { useAgentSignIn } from '@/features/signin/useAgentSignIn'
import { BUNDLED_FONT_NAME, fontStackFor, installedMonospaceFamilies, WEIGHT_BOLD, WEIGHT_EXTRA_BOLD, WEIGHT_LIGHT, WEIGHT_MEDIUM, WEIGHT_REGULAR, WEIGHT_SEMIBOLD, type TerminalFontWeight } from '@/lib/terminalFont'
import type { AddMachineOptions, Added, Grant, HostChoice, MachineActivity, UpdateProgress } from '@/api/machines'
import type { MachineHead, UpdateAction } from '@/features/workspace/model/machines'
import { UsagePage } from '@/features/usage/UsagePage'
import type { OpenSession } from '@/features/usage/UsageTable'
import { BYPASS_AGENTS, bypasses, type ChatFont, CHAT_TEXT_SIZES, INTERFACE_SIZES, LINE_HEIGHT_CHOICES, SCROLL_SPEED_CHOICES, SCROLLBACK_CHOICES, SIDEBAR_WIDTH_DEFAULT, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN, type CursorStyle, type ScrollbackLines, type ScrollSpeed, type TerminalLineHeight, type SettingsPreferences } from '../preferences'

export type DesktopSettingsSection = 'general' | 'appearance' | 'notifications' | 'keys' | 'chat' | 'permissions' | 'helpers' | 'terminal' | 'extensions' | 'machines' | 'updates' | 'usage'

/** The other machines, for the Machines page: what the window knows of each, and what it can ask of the host. */
export type MachinesInfo = {
  /** The host has answered about the machines: before that the page says it is loading. */
  known: boolean
  list: readonly MachineHead[]
  onRetry: (name: string) => void
  /** Takes the machine out. Settles with whether it is gone; a refusal has already been told to the person. */
  onRemove: (name: string) => Promise<boolean>
  /** Allow or stop one of a machine's powers over this computer. */
  onGrant: (name: string, grant: Grant, on: boolean) => void
  /**
   * Installs this version on a machine and restarts its daemon there; its saved sessions come
   * back. Settles when the update ended and has already told the person how it went.
   */
  onUpdate: (name: string, action: UpdateAction, whenIdle: boolean) => Promise<void>
  /**
   * How many sessions are open on a machine and how many are busy; null when it cannot say (its
   * app is too old, or it cannot be reached). The update question uses it to say what it will interrupt.
   */
  onCheckActivity: (name: string) => Promise<MachineActivity | null>
  /** Puts the same command on the clipboard, to run in a terminal instead. */
  onCopyCommand: (command: string) => void
  /** Opens ssh in a session on this computer for a machine that needs a login (by its number), so its prompts can be answered. */
  onOpenLogin: (machine: number) => void
  /** Names a machine in the window (a local label; blank takes the name away). Nothing changes on the machine. */
  onRename: (name: string, nickname: string) => void
  /** How many sessions the sidebar shows for a machine (by its number); without it a tile says it does not know. */
  sessionsOn?: (machine: number) => number
  add: {
    /** The hosts of ~/.ssh/config that are not machines yet. Stable between renders. */
    loadHosts: () => Promise<HostChoice[]>
    /** Looks at the target and adds it, with the helper installed when it is missing. Rejects with the words to show when it cannot be added. */
    onAdd: (target: string, name?: string, port?: number, options?: AddMachineOptions) => Promise<Added>
    /** Ends the look that is running. */
    onCancel: () => void
    /** Calls back as the host reports how far a machine's helper install has got; resolves with the call that stops it. */
    onProgress: (listener: (progress: UpdateProgress) => void) => Promise<() => void>
    /** Opens the palette on its New machine level (the same one the sidebar opens). */
    open: () => void
  }
}

export type DaemonInfo = {
  online: boolean
  sessionCount: number
  /** Reported by the daemon; rows are left out until it does. */
  version?: string
  socket?: string
}

/** Where the app's own update is, for the box at the foot of the nav. */
export type SettingsUpdates = {
  summary: string
  status: UpdaterState['status']
  /** The version found, downloading or ready; undefined while there is none. */
  version?: string | undefined
  /** How far the download is, while one runs. */
  download?: { progress: number | null; transfer: Transfer | null } | undefined
  onCheck: () => void
  onDownload: () => void
  onRestart: () => void
}

export type UsageInfo = { budget: number | null; onBudget: (budget: number | null) => void; sessionForTerm: (term: number) => OpenSession | null; onOpenSession: (id: string) => void }

type DesktopSettingsProps = {
  section: DesktopSettingsSection
  /** Shows a sample notification where notifications appear. */
  onTestNotice?: () => void
  /** The app's update check, when there is one to ask; shown at the foot of the nav. */
  updates?: SettingsUpdates
  onSection: (section: DesktopSettingsSection) => void
  preferences: SettingsPreferences
  onChange: (preferences: SettingsPreferences) => void
  /** The system asks for reduced motion; the switch then cannot turn motion back on. */
  systemReducedMotion: boolean
  /** The operating system is set to dark; System mode follows it. */
  systemDark: boolean
  /** A theme hovered in a theme dropdown shows on the whole window; null ends the preview. */
  onPreviewTheme: (name: string | null) => void
  /** Closes Settings and plays the first-run welcome again. */
  onShowWelcome: () => void
  platform: Platform
  daemon: DaemonInfo
  /** The running app's version, for the update box and This computer; null until known. */
  appVersion: string | null
  machines: MachinesInfo
  /** Opens the system's folder picker at the folder given; the path picked, or null when it is cancelled. */
  onChooseFolder?: (current: string) => Promise<string | null>
  /** What the Usage & cost page needs from the window. */
  usage: UsageInfo
  /** Opens the agent's own sign-in in a terminal of its own; without it the Agents page offers no sign-in. */
  onSignInAgent?: (agent: 'claude' | 'codex') => void
  /** Starts GitHub's own sign-in in a terminal on a machine, and how many of those have ended; without it the GitHub page offers no sign-in. */
  github?: GitHubSignIn
  /** The projects the open sessions work in, for Settings › Extensions to look at one. */
  extensionProjects?: readonly ExtensionProject[]
  onClose: () => void
}

type NavItem = { id: DesktopSettingsSection; label: string; path: string }

/** The nav (the whole-app mock): what the window does, how agents run, and which computers. Usage & cost has no item: it opens
    from its own key, the palette and the usage meters, and leaves the nav with none current. */
const NAV: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'APP',
    items: [
      { id: 'general', label: 'General', path: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4' },
      { id: 'appearance', label: 'Appearance', path: 'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-.9-.8-1.3-.8-2.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.4-4-7.6-9-7.6zM7.5 11.5h.01M10.5 7.5h.01M15.5 8.5h.01' },
      { id: 'notifications', label: 'Notifications', path: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0' },
      { id: 'updates', label: 'Updates & repair', path: 'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5' },
      { id: 'keys', label: 'Hotkeys', path: 'M2 6h20v12H2zM6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8' },
    ],
  },
  {
    label: 'AGENTS',
    items: [
      { id: 'chat', label: 'Chat', path: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z' },
      { id: 'permissions', label: 'Permissions', path: 'M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6z' },
      { id: 'helpers', label: 'Helpers', path: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8' },
      { id: 'terminal', label: 'Terminal', path: 'M4 7V4h16v3M9 20h6M12 4v16' },
      { id: 'extensions', label: 'Extensions', path: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M7 6h10v12H7z' },
    ],
  },
  {
    label: 'MACHINES',
    items: [
      { id: 'machines', label: 'Remote machines', path: 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01M17 7h.01M17 17h.01' },
    ],
  },
]

const PAGE: Record<DesktopSettingsSection, [string, string]> = {
  general: ['General', 'How sessions open, where they start and what happens to them.'],
  appearance: ['Appearance', 'Your theme, motion and the sidebar.'],
  notifications: ['Notifications', 'When the system should tell you a session needs you.'],
  keys: ['Hotkeys', 'Everything the window handles before the shell does.'],
  chat: ['Chat', 'Which agent a chat starts, who it is signed in as, and how it is drawn.'],
  permissions: ['Permissions', 'What your agents may run without asking.'],
  helpers: ['Helpers', 'Sessions an agent starts for itself, and how many run at once.'],
  terminal: ['Terminal', 'How every pane renders. Changes apply instantly.'],
  extensions: ['Extensions', 'Skills, plugins and MCP servers for Claude Code and Codex, for you and for a project.'],
  machines: ['Remote machines', 'Other computers whose sessions show up in your sidebar.'],
  updates: ['Updates & repair', 'What can update, what version it is on, and how to fix it when an update did not take.'],
  usage: ['Usage & cost', 'What the agents reported using, by session. Never estimated.'],
}

/** Esc ends an open theme list first; Settings stays. A part that handles Esc itself is marked `data-owns-escape`. */
const keepForOpenList = (event: globalThis.KeyboardEvent) => {
  const inside = event.target instanceof Element && event.target.closest('[data-owns-escape]') !== null
  if (inside || document.querySelector('.mx-picker-list') !== null) event.preventDefault()
}

/** The report pages, which hide the nav and fill the dialog. */
const NAVLESS: readonly DesktopSettingsSection[] = ['usage']

/** The pages a search looks through, in nav order. Usage is figures, not settings. */
const SEARCHED: readonly DesktopSettingsSection[] = [...NAV.flatMap((group) => group.items.map((item) => item.id))]

function foundLine(rows: number, query: string): string {
  return `${String(rows)} ${rows === 1 ? 'setting matches' : 'settings match'} “${query}”`
}

/** Settings (⌘,): a dialog in the window that holds focus until it closes, then gives it back. */
export function DesktopSettings(props: DesktopSettingsProps) {
  const { section, preferences, onChange: change } = props
  // Every change is kept the moment it is made; the header says so for a moment after each one.
  const [saved, flashSaved] = useSavedFlash()
  const onChange = (next: SettingsPreferences) => { change(next); flashSaved() }
  const update = <K extends keyof SettingsPreferences>(key: K, value: SettingsPreferences[K]) => { onChange({ ...preferences, [key]: value }) }
  // One change, not two: the view and a ticked "Don't ask again" are saved together, so neither overwrites the other.
  const switchView = (view: PaneView, dontAskAgain: boolean) => { onChange({ ...preferences, openSessionsIn: view, confirmSkipped: dontAskAgain ? withSkipped(preferences.confirmSkipped, 'switch-view') : preferences.confirmSkipped }) }

  // Focus lands on the current section, not the first control; Radix traps it and gives it back on close.
  const focusSection = (event: Event) => {
    event.preventDefault()
    // A report page has no nav: focus goes to its close button instead.
    if (event.currentTarget instanceof HTMLElement) (event.currentTarget.querySelector<HTMLElement>('.mx-settings-nav-item.is-current') ?? event.currentTarget.querySelector<HTMLElement>('.mx-settings-close'))?.focus()
  }

  const [query, setQuery] = useState('')
  const searchField = useRef<HTMLInputElement>(null)
  // The window's Find key searches the settings while they are open; the window's own keys are off under a dialog.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(`[${KEY_CAPTURE_ATTRIBUTE}]`)) return
    if (matchShortcut(event, props.platform, preferences.keyOverrides)?.action !== 'find') return
    event.preventDefault()
    searchField.current?.focus()
  }
  const searching = query.trim() !== ''
  const scroller = useRef<HTMLDivElement>(null)
  const [found, setFound] = useState({ rows: 0, groups: 0 })
  // A group to put focus in once its page has drawn, after a search result's page was opened.
  const focusGroup = useRef<string | null>(null)

  // The results are the pages themselves, filtered as they draw, and some fill in later (signed-in agents, machines),
  // so they are counted from what is on screen whenever it changes.
  useEffect(() => {
    const root = scroller.current
    if (!searching || root === null) return
    const count = () => {
      const rows = root.querySelectorAll('[data-search-hit]').length
      const groups = root.querySelectorAll('.mx-scard:not(.is-filtered), .mx-scard.is-filtered:has([data-search-hit])').length
      setFound((was) => (was.rows === rows && was.groups === groups ? was : { rows, groups }))
    }
    const frame = requestAnimationFrame(count)
    const observer = new MutationObserver(count)
    observer.observe(root, { childList: true, subtree: true })
    return () => { cancelAnimationFrame(frame); observer.disconnect() }
  }, [searching, query])

  useEffect(() => {
    const wanted = focusGroup.current
    if (searching || wanted === null) return
    focusGroup.current = null
    const group = scroller.current?.querySelector<HTMLElement>(`.mx-scard[aria-label="${CSS.escape(wanted)}"]`)
    group?.scrollIntoView({ block: 'start' })
    group?.querySelector<HTMLElement>('button, input, select, textarea, [role="switch"], [role="radio"], [tabindex="0"]')?.focus()
  }, [searching, section])

  const openPage = (id: DesktopSettingsSection) => {
    setQuery('')
    props.onSection(id)
  }

  // Esc empties the search before it closes Settings.
  const onEscape = (event: globalThis.KeyboardEvent) => {
    keepForOpenList(event)
    if (event.defaultPrevented || !searching) return
    event.preventDefault()
    setQuery('')
  }

  const page = (id: DesktopSettingsSection): ReactNode => {
    switch (id) {
      case 'general': return <GeneralSection preferences={preferences} update={update} onSwitchView={switchView} onChooseFolder={props.onChooseFolder} onShowWelcome={props.onShowWelcome} />
      case 'chat': return <><ChatSection preferences={preferences} update={update} /><AgentsSection onSignIn={props.onSignInAgent} /></>
      case 'permissions': return <><BypassSection preferences={preferences} update={update} /><ApprovedCommands /></>
      case 'helpers': return <HelpersSection />
      case 'terminal': return <TerminalSection preferences={preferences} update={update} />
      case 'appearance': return <><AppearanceSection preferences={preferences} update={update} systemDark={props.systemDark} onPreviewTheme={props.onPreviewTheme} /><SidebarSection preferences={preferences} update={update} /></>
      case 'usage': return <UsageSection usage={props.usage} />
      case 'notifications': return <NotificationsSection preferences={preferences} update={update} onTestNotice={props.onTestNotice} />
      case 'machines': return <MachinesPage daemon={props.daemon} machines={props.machines} github={props.github} appVersion={props.appVersion} />
      case 'updates': return <UpdatesPage updates={props.updates} appVersion={props.appVersion} machines={props.machines} />
      case 'extensions': return <ExtensionsSection projects={props.extensionProjects ?? []} />
      case 'keys': return <HotkeysSection platform={props.platform} overrides={preferences.keyOverrides} onOverrides={(next) => { update('keyOverrides', next) }} />
    }
  }

  const [title, subtitle] = searching ? ['Search', foundLine(found.rows, query.trim())] : PAGE[section]
  // Usage & cost is a report opened from its own key: it takes the whole dialog, without the nav.
  const report = !searching && NAVLESS.includes(section)
  return (
    <Panel label="Settings" onClose={props.onClose} scrimClassName="mx-settings-scrim" className="mx-settings" onKeyDown={onKeyDown} onOpenAutoFocus={focusSection} onEscapeKeyDown={onEscape}>
      <>
        {!report && <nav aria-label="Settings sections" className="mx-settings-nav">
          <span className="mx-settings-nav-title">Settings</span>
          <label className="mx-settings-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input ref={searchField} type="text" value={query} placeholder="Search settings" aria-label="Search settings" spellCheck={false} onChange={(event) => { setQuery(event.target.value) }} />
          </label>
          {NAV.map((group) => (
            <div key={group.label} className="mx-settings-nav-group">
              <span className="mx-settings-nav-label">{group.label}</span>
              {group.items.map((item) => (
                <button key={item.id} type="button" className={`mx-settings-nav-item${!searching && section === item.id ? ' is-current' : ''}`} aria-current={!searching && section === item.id ? 'page' : undefined} onClick={() => { openPage(item.id) }}>
                  <svg className="mx-settings-nav-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.path} /></svg>
                  <span className="mx-settings-nav-text">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
          {props.updates && (
            <>
              <span className="mx-settings-nav-spacer" />
              <UpdateBox updates={props.updates} appVersion={props.appVersion} />
            </>
          )}
        </nav>}
        <div className="mx-settings-body">
          <header className="mx-settings-header">
            <div className="mx-settings-heading" key={searching ? 'search' : section}>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
            <span className="mx-settings-saved" role="status">{saved && <><Icon name="check" size={12} />Saved</>}</span>
            <button type="button" className="mx-icon-button mx-settings-close" aria-label="Close settings" title="Close (Esc)" onClick={props.onClose}><Icon name="close" size={14} /></button>
          </header>
          <div className="mx-settings-scroll" ref={scroller}>
            <div className={`mx-settings-sections${!searching && section === 'usage' ? ' is-wide' : ''}`} key={searching ? 'search' : section}>
              {!searching && page(section)}
              {searching && SEARCHED.map((id) => (
                <SettingsSearch.Provider key={id} value={{ query, page: PAGE[id][0], pageMatched: matchesQuery(PAGE[id][0], query), onOpen: (group) => { focusGroup.current = group; openPage(id) } }}>
                  {page(id)}
                </SettingsSearch.Provider>
              ))}
              {searching && found.groups === 0 && <p className="mx-settings-none">No settings match “{query.trim()}”.</p>}
            </div>
          </div>
        </div>
      </>
    </Panel>
  )
}

type Update = <K extends keyof SettingsPreferences>(key: K, value: SettingsPreferences[K]) => void

/** A titled group of rows: an uppercase heading with an optional note at its right, then rows divided by hairlines. */
export function Card({ title, meta, children, foot, footRow = false }: { title: string; meta?: ReactNode; children?: ReactNode; foot?: ReactNode; footRow?: boolean }) {
  const search = useContext(SettingsSearch)
  if (search !== null) {
    // In the results: titled with its page, opened by its title, and only its matching rows unless the title matched.
    const whole = groupShowsWhole(search.page, title, search.query)
    const heading = search.page === title ? title : `${search.page} · ${title}`
    return (
      <section className={`mx-scard${whole ? '' : ' is-filtered'}`} aria-label={title}>
        <div className="mx-scard-head">
          <button type="button" className="mx-scard-title mx-scard-open" title={`Open ${search.page}`} onClick={() => { search.onOpen(title) }}>{heading}</button>
        </div>
        <GroupShowsAll.Provider value={whole}>{children}</GroupShowsAll.Provider>
      </section>
    )
  }
  return (
    <section className="mx-scard" aria-label={title}>
      <div className="mx-scard-head">
        <span className="mx-scard-title">{title}</span>
        {meta}
      </div>
      {children}
      {foot && <div className={`mx-scard-foot${footRow ? ' is-row' : ''}`}>{foot}</div>}
    </section>
  )
}

/**
 * A card of settings most people never change: only its title until Show opens it. A search looks inside it anyway,
 * because the results draw each card's rows whatever the fold says.
 */
export function FoldedCard({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const searching = useContext(SettingsSearch) !== null
  const bodyId = useId()
  return (
    <Card title={title} meta={<button type="button" className="mx-scard-meta-button" aria-expanded={open} aria-controls={bodyId} onClick={() => { setOpen((was) => !was) }}>{open ? 'Hide' : 'Show'}</button>}>
      {(open || searching) && <div id={bodyId}>{children}</div>}
    </Card>
  )
}

export function Row({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  const search = useContext(SettingsSearch)
  const whole = useContext(GroupShowsAll)
  const hit = search !== null && rowIsResult({ label, detail }, search.query, whole)
  if (search !== null && !hit) return null
  return (
    <div className="mx-scard-row" data-search-hit={hit || undefined}>
      <div className="mx-scard-text"><span>{label}</span>{detail && <span>{detail}</span>}</div>
      {children}
    </div>
  )
}

function SegmentedChoice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: ReadonlyArray<readonly [T, ReactNode]>; onChange: (value: T) => void }) {
  return (
    <Segmented
      aria-label={label}
      value={String(value)}
      onValueChange={(next) => {
        const picked = options.find(([option]) => String(option) === next)
        if (picked) onChange(picked[0])
      }}
    >
      {options.map(([option, text]) => <SegmentedItem key={String(option)} value={String(option)}>{text}</SegmentedItem>)}
    </Segmented>
  )
}

const BYPASS_DETAIL: Readonly<Record<ChatAgent, string>> = {
  claude: 'New Claude sessions start in Bypass permissions and ask about nothing. A new chat can still pick another mode.',
  codex: 'New Codex sessions start with approvals and the sandbox off, so they run commands and edit files without asking.',
  gemini: 'New Gemini sessions start in its yolo mode, which approves every tool call without asking.',
}

/** One switch per agent that can start without permission prompts; shared with the terminal app (`[permissions.bypass]`). */
function BypassSection({ preferences, update }: { preferences: SettingsPreferences; update: Update }) {
  return (
    <Card
      title="Bypass Permissions"
      foot="On for every agent unless you turn it off. The agent can change files and run commands without asking, so turn it off for any agent you want to approve each step. Only sessions started after a change get it; sessions already running keep how they started."
    >
      {BYPASS_AGENTS.map((agent) => (
        <Row key={agent} label={AGENT_LABEL[agent]} detail={BYPASS_DETAIL[agent]}>
          <Switch aria-label={`Bypass Permissions for ${AGENT_LABEL[agent]}`} checked={bypasses(preferences, agent)} onCheckedChange={(value) => {
            update('bypassOff', value ? preferences.bypassOff.filter((off) => off !== agent) : [...preferences.bypassOff, agent])
          }} />
        </Row>
      ))}
    </Card>
  )
}

/** How long the header says Saved after a value changed. */
const SAVED_FLASH_MS = 2000

/** The header's Saved note: shown for a moment each time `flash` is called after a change was kept. */
function useSavedFlash(): [boolean, () => void] {
  const [shown, setShown] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const flash = () => {
    window.clearTimeout(timer.current)
    setShown(true)
    timer.current = window.setTimeout(() => { setShown(false) }, SAVED_FLASH_MS)
  }
  return [shown, flash]
}

function GeneralSection({ preferences, update, onSwitchView, onChooseFolder, onShowWelcome }: { preferences: SettingsPreferences; update: Update; onSwitchView: (view: PaneView, dontAskAgain: boolean) => void; onChooseFolder: ((current: string) => Promise<string | null>) | undefined; onShowWelcome: () => void }) {
  // The folder comes from the system's folder picker, which only offers one that exists, so nothing is typed or checked.
  const home = preferences.startFolder === ''
  const setStart = (folder: string) => { update('startFolder', folder) }
  return (
    <>
      <SessionViewCard preferences={preferences} onSwitchView={onSwitchView} />
      <Card
        title="Start folder"
        foot="Every new session opens a shell here. Leave it empty for your home folder. Projects appear in the sidebar when a session cds into a git repo."
      >
        <div className="mx-scard-body">
          <div className="mx-folder-row">
            <div className="mx-folder-field" title={home ? undefined : preferences.startFolder}>
              <span className="mono mx-folder-cd" aria-hidden="true">cd</span>
              <span className="mono mx-folder-path" style={{ color: home ? 'var(--dim)' : 'var(--fg)' }}>{home ? 'Your home folder' : preferences.startFolder}</span>
            </div>
            {onChooseFolder && (
              <button type="button" className="mx-scard-button" aria-label="Choose the start folder" onClick={() => { void onChooseFolder(preferences.startFolder).then((picked) => { if (picked) setStart(picked) }) }}>Browse…</button>
            )}
            {!home && <button type="button" className="mx-scard-button" onClick={() => { setStart('') }}>Use home folder</button>}
          </div>
        </div>
      </Card>
      <Card
        title="Export folder"
        foot="Code blocks and tables you save from a chat go here. An existing file is never replaced; the new one gets a number."
      >
        <div className="mx-scard-body">
          <div className="mx-folder-row">
            <div className="mx-folder-field" title={preferences.exportFolder === '' ? undefined : preferences.exportFolder}>
              <span className="mono mx-folder-path" style={{ color: preferences.exportFolder === '' ? 'var(--dim)' : 'var(--fg)' }}>{preferences.exportFolder === '' ? 'Your Downloads folder' : preferences.exportFolder}</span>
            </div>
            {onChooseFolder && (
              <button type="button" className="mx-scard-button" aria-label="Choose the export folder" onClick={() => { void onChooseFolder(preferences.exportFolder).then((picked) => { if (picked) update('exportFolder', picked) }) }}>Browse…</button>
            )}
            {preferences.exportFolder !== '' && <button type="button" className="mx-scard-button" onClick={() => { update('exportFolder', '') }}>Use Downloads</button>}
          </div>
        </div>
      </Card>
      <Card title="Window">
        <Row label="Status bar" detail="A line at the bottom with the version, updates, usage and the Commands and Shortcuts keys.">
          <Switch aria-label="Status bar" checked={preferences.statusBar} onCheckedChange={(value) => { update('statusBar', value) }} />
        </Row>
      </Card>
      <Card title="Updates">
        <Row label="Download updates automatically" detail="A new release is fetched in the background. Installing waits until you restart.">
          <Switch aria-label="Download updates automatically" checked={preferences.autoDownloadUpdates} onCheckedChange={(value) => { update('autoDownloadUpdates', value) }} />
        </Row>
        <Row label="Install updates when idle" detail="Never while an agent is working.">
          <Switch aria-label="Install updates when idle" checked={preferences.restartWhenIdle} onCheckedChange={(value) => { update('restartWhenIdle', value) }} />
        </Row>
        <Row label="Restart the service when idle" detail="After an update, an older service restarts by itself once no agent is working, waiting on you or starting. Sessions come back.">
          <Switch aria-label="Restart the service when idle" checked={preferences.restartServiceWhenIdle} onCheckedChange={(value) => { update('restartServiceWhenIdle', value) }} />
        </Row>
        <Row label="Update remote machines too" detail="After this computer updates, each machine follows once its agents are idle. Off: click Update on each one.">
          <Switch aria-label="Update remote machines too" checked={preferences.updateMachines} onCheckedChange={(value) => { update('updateMachines', value) }} />
        </Row>
      </Card>
      <Card title="Sessions">
        <Row label="Reopen layout on launch" detail="Restore the panes and splits you had last time.">
          <Switch aria-label="Reopen layout on launch" checked={preferences.restoreLayout} onCheckedChange={(value) => { update('restoreLayout', value) }} />
        </Row>
        <Row label="Welcome" detail="Replay the setup: how you like to work and where to start.">
          <button type="button" className="mx-scard-button" onClick={onShowWelcome}>Show the welcome again</button>
        </Row>
        <Row label="Questions you turned off" detail="Asks again before closing a session, switching the view and anything else you ticked “Don’t ask again” on.">
          <button type="button" className="mx-scard-button" disabled={preferences.confirmSkipped.length === 0} onClick={() => { update('confirmSkipped', []) }}>Ask again</button>
        </Row>
      </Card>
    </>
  )
}

const DOCK_OPTIONS = [['bottom', 'Bottom'], ['right', 'Right'], ['full', 'Full']] as const
const SIDE_OPTIONS = [['left', 'Left'], ['right', 'Right']] as const

const FONT_SIZES = Array.from({ length: TERMINAL_FONT_SIZE_MAX - TERMINAL_FONT_SIZE_MIN + 1 }, (_, index) => {
  const size = TERMINAL_FONT_SIZE_MIN + index
  return [size, String(size)] as const
})
const WEIGHT_NAMES: Readonly<Record<TerminalFontWeight, string>> = { [WEIGHT_LIGHT]: 'Light', [WEIGHT_REGULAR]: 'Regular', [WEIGHT_MEDIUM]: 'Medium', [WEIGHT_SEMIBOLD]: 'Semibold', [WEIGHT_BOLD]: 'Bold', [WEIGHT_EXTRA_BOLD]: 'Extra bold' }
const weightOptions = (weights: readonly TerminalFontWeight[]) => weights.map((weight) => [weight, WEIGHT_NAMES[weight]] as const)
const NORMAL_WEIGHTS = weightOptions([WEIGHT_LIGHT, WEIGHT_REGULAR, WEIGHT_MEDIUM, WEIGHT_SEMIBOLD])
const BOLD_WEIGHTS = weightOptions([WEIGHT_SEMIBOLD, WEIGHT_BOLD, WEIGHT_EXTRA_BOLD])
const CURSORS: ReadonlyArray<readonly [CursorStyle, string]> = [['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline']]
const THOUSAND = 1000
const SCROLLBACKS: ReadonlyArray<readonly [ScrollbackLines, string]> = SCROLLBACK_CHOICES.map((lines) => [lines, `${String(lines / THOUSAND)}k`] as const)
const LINE_HEIGHTS: ReadonlyArray<readonly [TerminalLineHeight, string]> = LINE_HEIGHT_CHOICES.map((height) => [height, String(height)] as const)
const SCROLL_SPEEDS: ReadonlyArray<readonly [ScrollSpeed, string]> = SCROLL_SPEED_CHOICES.map((speed) => [speed, speed === 1 ? 'Normal' : `${String(speed)}×`] as const)

/** The font picker: Geist Mono (saved as empty) and the monospace families installed here, each set in its own face. */
function FontFamilyField({ value, onCommit }: { value: string; onCommit: (family: string) => void }) {
  const [installed, setInstalled] = useState<string[]>([])
  // Measured after the first paint so opening the page is not held up by it.
  useEffect(() => {
    const timer = window.setTimeout(() => { setInstalled(installedMonospaceFamilies()) }, 0)
    return () => { window.clearTimeout(timer) }
  }, [])
  const item = (name: string, sub: string): PickerItem => ({
    value: name,
    label: name,
    sub,
    tile: <span className="mx-font-tile" style={{ fontFamily: fontStackFor(name) }} aria-hidden="true">Aa</span>,
    labelStyle: { fontFamily: fontStackFor(name) },
  })
  const names = installed.filter((name) => name !== BUNDLED_FONT_NAME)
  // A family saved earlier that this computer no longer reports still shows as the current choice.
  const saved = value !== '' && value !== BUNDLED_FONT_NAME && !names.includes(value) ? [item(value, 'Saved choice')] : []
  const groups: PickerGroup[] = [
    { items: [item(BUNDLED_FONT_NAME, 'Bundled with Maiker')] },
    ...(saved.length + names.length > 0 ? [{ label: 'Installed here', items: [...saved, ...names.map((name) => item(name, 'Monospace'))] }] : []),
  ]
  return <PickerSelect label="Terminal font family" value={value === '' ? BUNDLED_FONT_NAME : value} groups={groups} onPick={(next) => { onCommit(next === BUNDLED_FONT_NAME ? '' : next) }} width={240} />
}

function TerminalSection({ preferences, update }: { preferences: SettingsPreferences; update: Update }) {
  return (
    <>
      <Card title="Text">
        <Row label="Font family" detail="The font every terminal pane uses.">
          <FontFamilyField value={preferences.terminalFontFamily} onCommit={(next) => { update('terminalFontFamily', next) }} />
        </Row>
        <Row label="Text size">
          <SegmentedChoice label="Terminal text size" value={preferences.terminalFontSize} options={FONT_SIZES} onChange={(value) => { update('terminalFontSize', value) }} />
        </Row>
        <Row label="Cursor">
          <SegmentedChoice label="Cursor" value={preferences.cursorStyle} options={CURSORS} onChange={(value) => { update('cursorStyle', value) }} />
        </Row>
        <Row label="Blinking cursor">
          <Switch aria-label="Blinking cursor" checked={preferences.cursorBlink} onCheckedChange={(value) => { update('cursorBlink', value) }} />
        </Row>
      </Card>
      <Card title="Panes">
        <Row label="Terminals open in" detail="Where the terminal opens beside the chat: under it, on its right, or in its place. The terminal's own bar changes it too.">
          <SegmentedChoice label="Terminals open in" value={preferences.terminalDock} options={DOCK_OPTIONS} onChange={(value) => { update('terminalDock', value) }} />
        </Row>
        <Row label="Lines kept per pane" detail="Older output is dropped from this window. The Maiker service keeps the full history.">
          <SegmentedChoice label="Lines kept per pane" value={preferences.scrollback} options={SCROLLBACKS} onChange={(value) => { update('scrollback', value) }} />
        </Row>
      </Card>
      <FoldedCard title="Advanced">
        <Row label="Text weight">
          <SegmentedChoice label="Terminal text weight" value={preferences.terminalFontWeight} options={NORMAL_WEIGHTS} onChange={(value) => { update('terminalFontWeight', value) }} />
        </Row>
        <Row label="Bold weight">
          <SegmentedChoice label="Terminal bold weight" value={preferences.terminalFontWeightBold} options={BOLD_WEIGHTS} onChange={(value) => { update('terminalFontWeightBold', value) }} />
        </Row>
        <Row label="Scroll speed" detail="How many lines one turn of the mouse wheel scrolls. Normal is the terminal's default, which can feel slow.">
          <SegmentedChoice label="Scroll speed" value={preferences.scrollSpeed} options={SCROLL_SPEEDS} onChange={(value) => { update('scrollSpeed', value) }} />
        </Row>
        <Row label="Line height" detail="Row height as a multiple of the font size. Lower it (1 to 1.2) if an agent's pixel-art banner looks torn apart; higher is airier to read. It applies to open terminals at once.">
          <SegmentedChoice label="Line height" value={preferences.terminalLineHeight} options={LINE_HEIGHTS} onChange={(value) => { update('terminalLineHeight', value) }} />
        </Row>
        <Row label="Screen reader support" detail="Mirrors each terminal's text into the page so a screen reader can read it. It makes every pane much heavier to draw, so leave it off unless you use one.">
          <Switch aria-label="Screen reader support" checked={preferences.terminalScreenReader} onCheckedChange={(value) => { update('terminalScreenReader', value) }} />
        </Row>
      </FoldedCard>
    </>
  )
}


const MODE_OPTIONS = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']] as const

/** Chat or Terminal for every new session. It heads General, the page Settings opens on, so it is the first thing seen. */
function SessionViewCard({ preferences, onSwitchView }: { preferences: SettingsPreferences; onSwitchView: (view: PaneView, dontAskAgain: boolean) => void }) {
  // The view asked for, while the question about it is open. Open sessions stay what they are (ADR 0020), which is the surprise it explains.
  const [switchTo, setSwitchTo] = useState<PaneView | null>(null)
  const pickView = (view: PaneView) => {
    if (view === preferences.openSessionsIn) return
    if (asksFirst(preferences.confirmSkipped, 'switch-view')) setSwitchTo(view)
    else onSwitchView(view, false)
  }
  return (
    <Card title="Session view">
      <Row label="Open sessions in" detail="Chat shows a conversation; Terminal shows the agent’s own CLI. Gemini has no chat view, so it always opens in Terminal.">
        <ViewSwitch view={preferences.openSessionsIn} onChange={pickView} />
        <ConfirmHost pending={switchTo === null ? null : { ask: confirmAsk('switch-view', switchTo), answer: (confirmed, dontAskAgain) => { setSwitchTo(null); if (confirmed) onSwitchView(switchTo, dontAskAgain) } }} />
      </Row>
    </Card>
  )
}

function AppearanceSection({ preferences, update, systemDark, onPreviewTheme }: { preferences: SettingsPreferences; update: Update; systemDark: boolean; onPreviewTheme: (name: string | null) => void }) {
  const darkInUse = preferences.themeMode === 'dark' || (preferences.themeMode === 'system' && systemDark)
  return (
    <>
      <Card title="Theme">
        <Row label="Appearance" detail="Follows your system when set to System.">
          <SegmentedChoice label="Appearance" value={preferences.themeMode} options={MODE_OPTIONS} onChange={(value) => { update('themeMode', value) }} />
        </Row>
        <Row label="Dark theme" detail="Used when the window is dark.">
          <ThemePicker kind="dark" value={preferences.darkTheme} inUse={darkInUse} dimmed={!darkInUse && preferences.themeMode !== 'system'} onPick={(name) => { update('darkTheme', name) }} onPreview={onPreviewTheme} />
        </Row>
        <Row label="Light theme" detail="Used when the window is light.">
          <ThemePicker kind="light" value={preferences.lightTheme} inUse={!darkInUse} dimmed={darkInUse && preferences.themeMode !== 'system'} onPick={(name) => { update('lightTheme', name) }} onPreview={onPreviewTheme} />
        </Row>
      </Card>
      <Card title="Size and text">
        <Row label="Interface size" detail="Draws the whole window larger or smaller: text, icons, panes and dialogs together.">
          <SegmentedChoice label="Interface size" value={preferences.interfaceSize} options={INTERFACE_SIZE_OPTIONS} onChange={(value) => { update('interfaceSize', value) }} />
        </Row>
        <Row label="Chat text size" detail="On top of the interface size: everything in the chat, its messages, its cards and its message box.">
          <SegmentedChoice label="Chat text size" value={preferences.chatTextSize} options={CHAT_TEXT_SIZE_OPTIONS} onChange={(value) => { update('chatTextSize', value) }} />
        </Row>
        <Row label="Chat font" detail="The typeface of the chat's messages. Code stays in the monospace.">
          <SegmentedChoice label="Chat font" value={preferences.chatFont} options={CHAT_FONT_OPTIONS} onChange={(value) => { update('chatFont', value) }} />
        </Row>
      </Card>
      <Card title="Motion">
        <Row label="Reduce motion" detail="Turns off pulses, slide-ins and size animations, and holds spinners still. Your system setting is always respected.">
          <Switch aria-label="Reduce motion" checked={preferences.reduceMotion} onCheckedChange={(value) => { update('reduceMotion', value) }} />
        </Row>
      </Card>
    </>
  )
}

/** How chats start and how they are drawn. */
function ChatSection({ preferences, update }: { preferences: SettingsPreferences; update: Update }) {
  return (
    <>
      <Card title="Chat view">
        <Row label="Default agent" detail="The agent a new session starts. A plain terminal is always one click away.">
          <SegmentedChoice label="Default agent" value={preferences.defaultAgent} options={AGENT_OPTIONS} onChange={(value) => { update('defaultAgent', value) }} />
        </Row>
        <Row label="Chat width" detail="How wide the messages and the message box run. Auto grows with the pane.">
          <SegmentedChoice label="Chat width" value={preferences.chatWidth} options={CHAT_WIDTH_OPTIONS} onChange={(value) => { update('chatWidth', value) }} />
        </Row>
        <Row label="Hide successful tool calls" detail="Leaves out the file reads and searches that worked. Commands, edits, other tools and anything that failed still show.">
          <Switch aria-label="Hide successful tool calls" checked={preferences.hideSuccessfulTools} onCheckedChange={(value) => { update('hideSuccessfulTools', value) }} />
        </Row>
        <Row label="Colour file names" detail="Draws a file's name in the message in the colour of its type (TypeScript, Rust, Markdown and so on). Off shows plain names.">
          <Switch aria-label="Colour file names" checked={preferences.colourFileNames} onCheckedChange={(value) => { update('colourFileNames', value) }} />
        </Row>
      </Card>
    </>
  )
}

const ACCOUNT_AGENTS = [['claude', 'Claude'], ['codex', 'Codex']] as const
type AccountAgent = (typeof ACCOUNT_AGENTS)[number][0]
type AccountState = { status: 'loading' } | { status: 'ready'; auth: AgentAuth } | { status: 'failed'; message: string }

/** What the account's row says, and whether it is the line of a problem. */
function accountWords(state: AccountState): string {
  if (state.status === 'loading') return 'Checking…'
  if (state.status === 'failed') return `Could not check. ${state.message}`
  const { installed, signedIn, account, plan } = state.auth
  if (!installed) return 'Not installed on this computer.'
  if (signedIn === null) return 'Installed. It did not say whether it is signed in.'
  if (!signedIn) return 'Installed, not signed in'
  return [account === '' ? 'Signed in' : `Signed in as ${account}`, plan].filter((part) => part !== '').join(' · ')
}

/**
 * The accounts the agents are signed in to, as each agent's own command says, with sign in and sign out. Signing in
 * runs the agent's own login in the daemon and shows its link and code in a card here; where that cannot be done, the
 * agent's own sign-in can still be opened in a terminal. Signing out runs its command here. The window keeps no
 * credentials: it only asks the agent and tells it.
 */
function AgentsSection({ onSignIn }: { onSignIn: ((agent: AccountAgent) => void) | undefined }) {
  const [states, setStates] = useState<Readonly<Record<AccountAgent, AccountState>>>({ claude: { status: 'loading' }, codex: { status: 'loading' } })
  const [asked, setAsked] = useState(0)
  useEffect(() => {
    let current = true
    for (const [agent] of ACCOUNT_AGENTS) {
      loadAgentAuth(agent).then(
        (auth) => { if (current) setStates((now) => ({ ...now, [agent]: { status: 'ready', auth } })) },
        (error: unknown) => { if (current) setStates((now) => ({ ...now, [agent]: { status: 'failed', message: explainError(error, 'Could not check').reason } })) },
      )
    }
    return () => { current = false }
  }, [asked])
  const again = () => { setAsked((count) => count + 1) }
  const signIn = useAgentSignIn(again)
  const shown = signIn.view
  const signOut = (agent: AccountAgent, label: string) => {
    signOutAgent(agent).then(
      () => { toast.success(`${label} signed out`, { description: 'Sessions already running keep their sign-in until they are restarted.' }); again() },
      (error: unknown) => { toast.failed(`Could not sign ${label} out`, error) },
    )
  }
  return (
    <>
    {shown !== null && <SignInCard view={shown} onCancel={() => { signIn.cancel(shown.agent) }} onClose={signIn.close} onRetry={() => { signIn.begin(shown.agent) }} />}
    <Card title="Accounts"
      meta={<button type="button" className="mx-scard-meta-button" onClick={again}>Check again</button>}
      foot="Sign in runs the agent's own sign-in and shows its link and code here. Maiker keeps no passwords or keys."
    >
      {ACCOUNT_AGENTS.map(([agent, label]) => {
        const state = states[agent]
        const auth = state.status === 'ready' ? state.auth : null
        return (
          <Row key={agent} label={label} detail={accountWords(state)}>
            <span style={{ display: 'flex', gap: 8 }}>
              {auth?.installed === true && auth.signedIn !== true && <button type="button" className="mx-scard-button is-primary" aria-label={`Sign in to ${label}`} onClick={() => { signIn.begin(agent) }}>Sign in</button>}
              {auth?.installed === true && auth.signedIn !== true && onSignIn !== undefined && shown?.agent === agent && (shown.problem !== null || shown.state.kind === 'failed') && <button type="button" className="mx-scard-button" aria-label={`Sign in to ${label} in a terminal`} onClick={() => { onSignIn(agent) }}>Use a terminal</button>}
              {auth?.signedIn === true && <button type="button" className="mx-scard-button" aria-label={`Sign out of ${label}`} onClick={() => { signOut(agent, label) }}>Sign out</button>}
            </span>
          </Row>
        )
      })}
    </Card>
    </>
  )
}

/** Which side the sidebar sits on, and how large it is. */
function SidebarSection({ preferences, update }: { preferences: SettingsPreferences; update: Update }) {
  return (
    <>
      <Card title="Sidebar">
        <Row label="Sidebar position" detail="Which side of the window the sidebar sits on. Inspect opens from the other side.">
          <SegmentedChoice label="Sidebar position" value={preferences.sidebarSide} options={SIDE_OPTIONS} onChange={(value) => { update('sidebarSide', value) }} />
        </Row>
      </Card>
      <Card title="Sidebar size">
        <Row label="Sidebar width" detail="Drag the sidebar's edge to change it, or focus the edge and use the arrow keys.">
          <button type="button" className="mx-text-button" disabled={preferences.sidebarWidth === SIDEBAR_WIDTH_DEFAULT} onClick={() => { update('sidebarWidth', SIDEBAR_WIDTH_DEFAULT) }}>Reset</button>
        </Row>
      </Card>
    </>
  )
}

/** Each window key, with Change to press a new one for it and Reset to go back to its own. The terminal's keys are listed, not changed. */
function HotkeysSection({ platform, overrides, onOverrides }: { platform: Platform; overrides: KeyOverrides; onOverrides: (next: KeyOverrides) => void }) {
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)
  const [refusal, setRefusal] = useState<{ action: ShortcutAction; reason: string } | null>(null)
  const rows = hotkeyRows(platform, overrides)
  const anyChanged = rows.some((row) => row.changed)

  const startCapture = (action: ShortcutAction) => { setRefusal(null); setCapturing(action) }
  const onCaptureKey = (action: ShortcutAction, event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') { setCapturing(null); return }
    const captured = captureCombo(event, platform)
    if (captured.kind === 'waiting') return
    if (captured.kind === 'refused') { setRefusal({ action, reason: captured.reason }); return }
    const keys = writeChord(comboChord(captured.combo, platform), platform)
    const other = takenBy(captured.combo, action, platform, overrides)
    if (other) { setRefusal({ action, reason: `${keys} is already ${other.label}. Change that one first.` }); return }
    setRefusal(null)
    setCapturing(null)
    onOverrides(isOwnKey(captured.combo, action, platform) ? withoutAction(overrides, action) : { ...overrides, [action]: captured.combo })
  }

  const meta = <span className="mx-scard-meta">{platform === 'mac' ? 'The same keys in Chat and Terminal view. ⌘ here, Ctrl+Shift on Windows and Linux.' : 'The same keys in Chat and Terminal view. ⌘ on macOS.'}</span>
  const last = HOTKEY_GROUPS[HOTKEY_GROUPS.length - 1]
  // One card a group, in the order and the names of the Ctrl+/ sheet, so the two read the same.
  return (
    <>
      {HOTKEY_GROUPS.map((group, groupIndex) => (
        <Card
          key={group}
          title={group}
          meta={groupIndex === 0 ? meta : undefined}
          foot={group === last ? <>
            <span>In a focused pane, every other key goes straight to the shell.</span>
            {anyChanged && <button type="button" className="mx-text-button" onClick={() => { setRefusal(null); onOverrides({}) }}>Reset all</button>}
          </> : undefined}
          footRow
        >
          <div>
            {rows.filter((row) => row.group === group).map((row) => {
              const action = row.id
              const listening = action !== null && capturing === action
              return (
                <div key={row.action} className="mx-scard-row mx-hotkey-row">
                  <span>{row.action}</span>
                  {listening ? (
                    // Focused as it opens; every key pressed here, Esc too, is taken down rather than acted on.
                    <button
                      type="button"
                      className="mx-key-capture"
                      {...{ [KEY_CAPTURE_ATTRIBUTE]: '', 'data-owns-escape': '' }}
                      aria-label={`Press the new keys for ${row.action}, or Esc to cancel`}
                      autoFocus
                      onKeyDown={(event) => { onCaptureKey(action, event) }}
                      onBlur={() => { setCapturing(null) }}
                    >Press the new keys…</button>
                  ) : (
                    <span className="mx-keys">
                      {row.chords.map((chord, index) => (
                        <Fragment key={chord.join('+')}>
                          {index > 0 && <span className="mx-or">or</span>}
                          <Keycaps chord={chord} className="mx-chord" labelled />
                        </Fragment>
                      ))}
                    </span>
                  )}
                  {action === null ? <span className="mx-hotkey-actions"><span className="mx-hotkey-fixed">{row.fixed}</span></span> : (
                    <span className="mx-hotkey-actions">
                      {!listening && <button type="button" className="mx-text-button" aria-label={`Change the keys for ${row.action}`} onClick={() => { startCapture(action) }}>Change</button>}
                      {row.changed && !listening && <button type="button" className="mx-text-button" aria-label={`Reset ${row.action}`} onClick={() => { setRefusal(null); onOverrides(withoutAction(overrides, action)) }}>Reset</button>}
                    </span>
                  )}
                  {refusal?.action === action && <p className="mx-hotkey-refusal" role="alert">{refusal.reason}</p>}
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </>
  )
}

function UsageSection({ usage }: { usage: UsageInfo }) {
  return <UsagePage {...usage} />
}

const AGENT_OPTIONS = [['claude', 'Claude'], ['codex', 'Codex']] as const
const CHAT_WIDTH_OPTIONS = [['auto', 'Auto'], ['narrow', 'Narrow'], ['wide', 'Wide'], ['full', 'Full']] as const
const CHAT_TEXT_SIZE_OPTIONS: ReadonlyArray<readonly [number, string]> = CHAT_TEXT_SIZES.map((size) => [size, `${String(size)}%`] as const)
const INTERFACE_SIZE_OPTIONS: ReadonlyArray<readonly [number, string]> = INTERFACE_SIZES.map((size) => [size, `${String(size)}%`] as const)
const CHAT_FONT_OPTIONS: ReadonlyArray<readonly [ChatFont, string]> = [['inter', 'Inter'], ['system', 'System'], ['serif', 'Serif'], ['mono', 'Mono']]

/** Native notifications: sent only while the window is in the background, for the session you are not looking at. A stopped agent has its own toast, with no switch. */
function NotificationsSection({ preferences, update, onTestNotice }: { preferences: SettingsPreferences; update: Update; onTestNotice: (() => void) | undefined }) {
  return (
    <>
    <Card
      title="System notifications"
      foot="Clicking a notification brings the window forward and shows that session. It never shows what the agent asked, so nothing private appears on a locked screen."
    >
      <Row label="Needs you" detail="An agent stopped for an answer or an approval.">
        <Switch aria-label="Notify when a session needs you" checked={preferences.notifyNeedsYou} onCheckedChange={(value) => { update('notifyNeedsYou', value) }} />
      </Row>
      <Row label="Done" detail="An agent finished its turn.">
        <Switch aria-label="Notify when a session finishes" checked={preferences.notifyFinished} onCheckedChange={(value) => { update('notifyFinished', value) }} />
      </Row>
    </Card>
    <Card title="In-window toasts" foot="Notes and successes go after 5 seconds, or when you move off them. Anything that needs you stays until you act.">
      {onTestNotice && (
        <Row label="Try it" detail="Shows a toast like the ones above. Done is green, needs you amber and an error red.">
          <button type="button" className="mx-text-button mx-pos-test" onClick={onTestNotice}>Show a test</button>
        </Row>
      )}
    </Card>
    </>
  )
}
