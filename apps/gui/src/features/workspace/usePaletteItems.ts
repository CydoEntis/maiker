import { type Dispatch, type SetStateAction, useCallback, useMemo } from 'react'
import { type Platform, type ShortcutAction, type ShortcutView, shortcutText } from './model/shortcuts'
import type { MachineHead } from './model/machines'
import { toast } from '@/lib/toast'
import { machineLabel } from '@/data/machineNicknames'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { activeArrangement, type Layout, setColumnWidths, type SplitDirection } from './model/layout'
import { type SessionView, tildePath } from './model/session'
import { byUrgency, isShell, rowTitle } from './model/sidebar'
import { outputSnippet, type PaletteItem } from './model/palette'
import type { SearchHit } from '@/features/find/api'
import { THEMES } from './theme/themes'
import { isChatSession } from './model/chatSession'
import { SETUP_AGENTS } from '@/features/welcome/setup'
import { ADD_MACHINE, type OpenProjectRequest } from './useOpenProject'

/** The command palette's list: sessions, their projects, actions and themes. */
export function usePaletteItems({ openReadme, setGetFileId, paletteOpen, platform, view, layout, sessions, projectOf, showSessionById, home, newSession, focusedMachineNumber, newTerminal, chatView, focusedSession, addAgentTerminal, runShortcut, heads, online, preferences, setPreferences, split, setSettingsSection, inspectRefusal, setInspectOpen, showPanelView, setFindOpen, setFocusMode, setShortcutsOpen, setLayout, startAgent, setRecentOpen, openFolder, setSavedOpen, setOpenProject }: {
  /** Opens the focused session's README, beside the chat or in the Files panel. */
  openReadme: (place: 'beside' | 'files') => void
  /** Asks for a file to pull from the machine of a session. */
  setGetFileId: (id: string) => void
  paletteOpen: boolean
  platform: Platform
  /** The view the focused session shows: the hints name its keys. */
  view: ShortcutView
  layout: Layout
  sessions: SessionView[]
  projectOf: Map<string, { name: string; key: string }>
  showSessionById: (sessionId: string) => void
  home: string
  newSession: (machine?: number) => void
  /** The whole app is in the Chat view: a terminal is a chat's own, in the side panel, never a shell of its own. */
  chatView: boolean
  focusedMachineNumber: number
  newTerminal: (machine?: number) => void
  focusedSession: SessionView | undefined
  addAgentTerminal: (agentId: string) => void
  runShortcut: (action: ShortcutAction) => void
  heads: MachineHead[]
  online: boolean
  preferences: SettingsPreferences
  setPreferences: Dispatch<SetStateAction<SettingsPreferences>>
  split: (paneId: string | null, direction: SplitDirection) => void
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  inspectRefusal: string | null
  setInspectOpen: Dispatch<SetStateAction<boolean>>
  /** Opens the focused session's side panel on one surface. */
  showPanelView: (view: 'changes' | 'files') => void
  setFindOpen: Dispatch<SetStateAction<boolean>>
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setLayout: Dispatch<SetStateAction<Layout>>
  startAgent: (program: string) => void
  setRecentOpen: Dispatch<SetStateAction<boolean>>
  /** Picks a folder in the system's dialog and opens the New session draft on it. */
  openFolder: () => void
  setSavedOpen: Dispatch<SetStateAction<boolean>>
  setOpenProject: (request: OpenProjectRequest) => void
}) {
  const paletteItems: PaletteItem[] = useMemo(() => {
    // Thirty-odd items with closures, built only while the palette can show them.
    if (!paletteOpen) return []
    const keys = (shortcut: ShortcutAction) => shortcutText(shortcut, platform, preferences.keyOverrides, view)
    const action = (id: string, label: string, run: () => void, shortcut?: string): PaletteItem => ({ id, label, kind: 'Action', run, ...(shortcut ? { shortcut } : {}) })
    const showing = activeArrangement(layout)
    // Sessions first, most urgent first, then their projects, then actions: what the palette is mostly for is jumping.
    const urgent = byUrgency(sessions)
    const sessionItems: PaletteItem[] = urgent.map((member) => ({
      id: `session-${member.id}`,
      label: rowTitle(member),
      detail: `${member.process} · ${projectOf.get(member.id)?.name ?? member.cwdLabel}`,
      kind: 'Session',
      status: member.status,
      ...(member.status === 'needs' ? { badge: 'Needs you' } : {}),
      run: () => { showSessionById(member.id) },
    }))
    const projectItems: PaletteItem[] = [...new Map(urgent.map((member) => [projectOf.get(member.id)?.key ?? member.cwd, member])).entries()].map(([key, member]) => ({
      id: `project-${key}`,
      label: projectOf.get(member.id)?.name ?? member.cwdLabel,
      detail: tildePath(member.repoRoot ?? member.cwd, home),
      kind: 'Project',
      run: () => { showSessionById(member.id) },
    }))
    const items: PaletteItem[] = [
      ...sessionItems,
      ...projectItems,
      action('new-session', 'New session…', () => { newSession(focusedMachineNumber) }, keys('new-session')),
      action('open-project', 'Open a project…', () => { setOpenProject({ start: { kind: 'sources' }, purpose: 'session' }) }),
      action('open-folder', 'Open a folder…', openFolder, keys('open-folder')),
      action('recent-sessions', 'Recent sessions…', () => { setRecentOpen(true) }),
      action('resume-saved', 'Resume a saved chat…', () => { setSavedOpen(true) }),
      action('new-terminal', chatView ? 'Show the terminal' : 'New terminal', () => { newTerminal(focusedMachineNumber) }, keys('new-terminal')),
      ...(focusedSession && !isShell(focusedSession) ? [action('open-terminal', 'New terminal for this agent', () => { addAgentTerminal(focusedSession.id) })] : []),
      ...heads.filter((head) => head.name !== null && head.chip?.tone === 'ok' && online).flatMap((head) => [
        action(`new-on-${head.key}`, `New session on ${head.label}…`, () => { newSession(head.machine) }),
        ...(chatView ? [] : [action(`new-terminal-on-${head.key}`, `New terminal on ${head.label}…`, () => { newTerminal(head.machine) })]),
      ]),
      ...(focusedSession && focusedSession.machineName !== null ? [action('get-file', `Get a file from ${machineLabel(focusedSession.machineName)}…`, () => { setGetFileId(focusedSession.id) })] : []),
      action('sidebar-side', preferences.sidebarSide === 'left' ? 'Move sidebar to the right' : 'Move sidebar to the left', () => { setPreferences((current) => ({ ...current, sidebarSide: current.sidebarSide === 'left' ? 'right' : 'left' })) }),
      ...(focusedSession && focusedSession.machineName === null ? [action('open-readme', 'Open README', () => { openReadme('files') }), action('open-readme-beside', 'Open README beside the chat', () => { openReadme('beside') })] : []),
      action('split-right', 'Split right', () => { split(null, 'right') }, keys('split-right')),
      action('split-down', 'Split down', () => { split(null, 'down') }, keys('split-down')),
      action('usage', 'Open usage and cost', () => { setSettingsSection('usage') }, keys('usage')),
      action('jump-needs', 'Jump to the next session that needs you', () => { runShortcut('jump-needs') }, keys('jump-needs')),
      action('inspect', 'Inspect the repository', () => { if (inspectRefusal !== null) toast.info(inspectRefusal); else setInspectOpen(true) }, keys('inspect')),
      action('show-changes', 'Show changes', () => { showPanelView('changes') }),
      action('show-files', 'Show files', () => { showPanelView('files') }),
      ...(focusedSession && !isChatSession(focusedSession.conversation) ? [action('new-worktree', 'New worktree', () => { runShortcut('new-worktree') }, keys('new-worktree'))] : []),
      action('find', 'Find in the pane or every session', () => { setFindOpen(true) }, keys('find')),
      action('fetch', 'Fetch the repository', () => { runShortcut('fetch') }, keys('fetch')),
      action('broadcast', showing?.broadcast ? 'Stop broadcasting' : 'Broadcast typing to this tab', () => { runShortcut('broadcast') }, keys('broadcast')),
      action('focus', 'Focus mode', () => { setFocusMode(true) }, keys('focus-mode')),
      action('settings', 'Open settings', () => { setSettingsSection('appearance') }, keys('settings')),
      action('performance', 'Open performance', () => { setSettingsSection('performance') }, keys('performance')),
      action('machines', 'Add a remote machine…', () => { setOpenProject(ADD_MACHINE) }),
      action('shortcuts', 'Keyboard shortcuts', () => { setShortcutsOpen(true) }, keys('shortcuts')),
      ...(showing?.widths ? [action('reset-widths', 'Reset pane widths', () => { setLayout((current) => setColumnWidths(current, showing.id, null)) })] : []),
      ...SETUP_AGENTS.map(({ program, label }) => ({ ...action(`start-${program}`, `Start ${label}`, () => { startAgent(program) }), needsQuery: true })),
    ]
    for (const candidate of THEMES) items.push({ id: `theme-${candidate.name}`, label: candidate.name, detail: candidate.family, kind: 'Theme', needsQuery: true, run: () => { setPreferences((current) => ({ ...current, themeMode: candidate.light ? 'light' : 'dark', ...(candidate.light ? { lightTheme: candidate.name } : { darkTheme: candidate.name }) })) } })
    return items
  }, [setGetFileId, paletteOpen, layout, sessions, focusedSession, heads, preferences.sidebarSide, preferences.keyOverrides, platform, view, projectOf, showSessionById, home, newSession, focusedMachineNumber, newTerminal, chatView, addAgentTerminal, runShortcut, online, setPreferences, split, setSettingsSection, inspectRefusal, setInspectOpen, showPanelView, setFindOpen, setFocusMode, setShortcutsOpen, setLayout, startAgent, setRecentOpen, openFolder, setSavedOpen, setOpenProject, openReadme])
  /** A line some session printed, as a row that opens that session; null when the pane is not one of the window's sessions. */
  const paletteOutputItem = useCallback((hit: SearchHit, query: string): PaletteItem | null => {
    const owner = sessions.find((member) => member.machine === hit.machine && member.pane === hit.term)
    if (!owner) return null
    return { id: `output-${String(hit.machine)}/${String(hit.term)}:${String(hit.line)}`, label: rowTitle(owner), detail: outputSnippet(hit.text, query), kind: 'Output', run: () => { showSessionById(owner.id) } }
  }, [sessions, showSessionById])
  return { paletteItems, paletteOutputItem }
}
