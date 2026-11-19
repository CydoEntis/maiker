import { movePanes } from './components/paneTransition'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { defaultSessionFolder, isDesktop, markSeenOnDaemon } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import { readSettingsPreferences, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '@/features/settings/preferences'
import { sizeVariables } from './model/layoutSize'
import type { InspectView } from '@/features/inspect/InspectPanel'
import { isChatSession } from './model/chatSession'
import { LOCAL_HEAD, machineHeads, remoteStartRefusal, type UpdateAction } from './model/machines'
import { isFirstRun } from '@/features/welcome/welcomed'
import { repoDiff } from '@/features/inspect/api'
import { type RestartedUpdate, takeRestarted } from '@/features/updates/updateMemory'
import { useUpdater } from '@/features/updates/useUpdater'
import { chooseProjectFolder } from '@/api/folderPicker'
import { showSessionNotice } from '@/features/notifications/notify'
import type { TerminalHandle } from '@/features/terminal/handle'
import type { LookAt } from '@/features/inspect/FilesTab'
import { connectAgentOnce } from './model/agentHooks'
import { chatAvailability, chatSourceOf, effectiveView, type ChatAgent } from './model/chatView'
import { startedAsShell } from './model/shellStarts'
import { useMachineActions, useRemoteMachines } from './useMachines'
import { useSessionAlerts } from './useSessionAlerts'
import { useTrayItem } from './useTrayItem'
import { useSystemDark, useSystemReducedMotion, useWindowNarrowerThan } from './useWindowQueries'
import { readSplitShells, withSplitShell, writeSplitShells } from '@/data/splitShells'
import { liveAgentTerminals, ownedTerminalIds, readAgentTerminals, writeAgentTerminals } from '@/data/agentTerminals'
import { useAgentExits } from './useAgentExits'
import { readMachineNicknames } from '@/data/machineNicknames'
import type { OpenSubagent } from './model/subagents'
import { useSharedSettings } from '@/features/settings/sharedSettings'
import { activeArrangement, dropSession, EMPTY_LAYOUT, focusedSessionId, type Layout, MAX_PANES, openArrangement, type SplitDirection, splitPane, visibleSessionIds } from './model/layout'
import { LAYOUT_RESET_NOTICE, readLayout, writeLayout } from './model/layoutStorage'
import { byPriority } from './model/attentionOrder'
import { folderNameOf, inCreationOrder, type SessionView, tildePath } from './model/session'
import { sharedCheckoutRefusal } from './model/sharedCheckout'
import { bindingFor, detectPlatform, shortcutChords } from './model/shortcuts'
import { resolveStartFolder } from './model/startFolder'
import { themeStyle } from './theme/themes'
import { COMPACT_WIDTH_PX, NARROW_WIDTH_PX } from './model/windowSize'
import { makeId } from './makeId'
import { useDocuments } from './useDocuments'
import { useSessionStarts } from './useSessionStarts'
import { useClosing } from './useClosing'
import { useAppUpdate } from './useAppUpdate'
import { useShortcutKeys, useShortcutRunner } from './useShortcuts'
import { usePaletteItems } from './usePaletteItems'
import { useServiceOffers } from './useServiceOffers'
import { usePaneDrags } from './usePaneDrags'
import { usePreferenceEffects } from './usePreferenceEffects'
import { useSessionSync } from './useSessionSync'
import { useSessionActions } from './useSessionActions'
import { useSessionReplies } from './useSessionReplies'
import { useMoveToWorktree } from './useMoveToWorktree'
import { useServiceReads } from './useServiceReads'
import { useSessionList } from './useSessionList'
import { usePaneFiles } from './usePaneFiles'
import { useWindowTheme } from './useWindowTheme'
import { remoteRepoPane, useInspectActions, useTurnDiff } from './useInspectActions'
import { useAgentStarts } from './useAgentStarts'
import { useMountedTabs } from './useMountedTabs'
import { useRecentSessions } from './useRecentSessions'
import { usePutAway } from './usePutAway'
import { useTerminalDock } from './useTerminalDock'
import { askNotificationPermission } from '@/features/notifications/native'
import { useAttentionBadge } from '@/features/notifications/useAttentionBadge'
import { useServiceStage } from './useServiceStage'
import { sayBackOnline } from './backOnline'

/** The one toast that key and drag notes share: a newer note replaces the one showing. */
const FLASH_TOAST_ID = 'workspace-note'


const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/


const DIFF_STAT_REFRESH_MS = 8000

/** The window's state and what each action does, put together once. `DesktopApp` hands it to the window's parts through `useWorkspace`. */
export function useWorkspaceState() {
  const queryClient = useQueryClient()
  const platform = detectPlatform(navigator.userAgent)
  const compact = useWindowNarrowerThan(COMPACT_WIDTH_PX)
  const narrow = useWindowNarrowerThan(NARROW_WIDTH_PX)
  const systemReducedMotion = useSystemReducedMotion()
  const systemDark = useSystemDark()
  const updater = useUpdater()
  const [welcomeOpen, setWelcomeOpen] = useState(isFirstRun)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [preferences, setPreferences] = useState(readSettingsPreferences)
  const [saved] = useState(readLayout)
  const [layout, setLayout] = useState<Layout>(() => (preferences.restoreLayout ? saved.layout : EMPTY_LAYOUT))
  // A tab layout from an older version was dropped: say so once.
  useEffect(() => { if (saved.reset) toast.info(LAYOUT_RESET_NOTICE) }, [saved.reset])
  // The width while the sidebar's edge is being dragged; it is saved when the pointer is released.
  const [liveSidebarWidth, setLiveSidebarWidth] = useState<number | null>(null)
  const [settingsSection, setSettingsSection] = useState<DesktopSettingsSection | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  // The subagent whose own chat its session's pane shows instead of the session's (README: subagents).
  const [openSubagent, setOpenSubagent] = useState<OpenSubagent | null>(null)
  // Which shells are an agent's own terminals (kept between runs), and which of them each agent shows.
  const [savedAgentTerminals, setAgentTerminals] = useState(readAgentTerminals)
  useEffect(() => { writeAgentTerminals(savedAgentTerminals) }, [savedAgentTerminals])
  const [activeTerminals, setActiveTerminals] = useState<ReadonlyMap<string, string>>(new Map())
  const [getFileId, setGetFileId] = useState<string | null>(null)
  const [specialistsId, setSpecialistsId] = useState<string | null>(null)
  const [updateAsk, setUpdateAsk] = useState<{ name: string; action: UpdateAction } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [inspectOpen, setInspectOpen] = useState(false)
  // The docked panel's width, so the Inspect drawer that overlays the window stays beside it and not under it.
  const [findOpen, setFindOpen] = useState(false)
  // Under 1100px the sidebar is the 60px rail; expanding it opens the full sidebar over the window.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Widening the window past the breakpoint puts the drawer away, so it does not come back open.
  if (!compact && drawerOpen) setDrawerOpen(false)
  // Interrupted agents whose banner you closed; the daemon stops reporting one once an agent runs again.
  const [dismissedRestores, setDismissedRestores] = useState<ReadonlySet<string>>(new Set())
  // The session a new worktree is made from, while the dialog is open.
  const [worktreeFrom, setWorktreeFrom] = useState<SessionView | null>(null)
  const [inspectView, setInspectView] = useState<InspectView>('changes')
  const [lookAt, setLookAt] = useState<LookAt | null>(null)
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus())
  // After a restart into an update, the first thing said is which version this is and what changed.
  const [updatedTo, setUpdatedTo] = useState<RestartedUpdate | null>(takeRestarted)
  // This launch is the restart into an update: the service is updated as part of it, with no second question.
  const [afterAppUpdate] = useState(() => updatedTo !== null)
  const [starting, setStarting] = useState(false)
  // The sessions there were when a start began: one the daemon lists before its tab is placed is kept off the sidebar until it is.
  const [startedFrom, setStartedFrom] = useState<ReadonlySet<string> | null>(null)
  // A new session on another machine asks for a folder there first.
  // The machine the New session draft opened on; null while it is closed.
  /** The machine the New session draft starts its chat on. */
  const [newChatMachine, setNewChatMachine] = useState<number>(LOCAL_MACHINE)
  /** A folder and first message the New session draft opens with (a chat continued from a full one). */
  const [newChatSeed, setNewChatSeed] = useState<{ folder: string; message: string } | null>(null)
  // The agent picked on the New session draft, for the sidebar's draft row; null until the page says.
  const [newChatAgent, setNewChatAgent] = useState<ChatAgent | null>(null)
  // The page a new agent chat starts from (agent, folder, model, effort), over the panes.
  const [newChatOpen, setNewChatOpen] = useState(false)
  // Opening the New session draft is the moment to connect the default agent's hooks, so starting it does not wait for that.
  useEffect(() => {
    if (newChatOpen) connectAgentOnce(preferences.defaultAgent).catch(() => { /* the start itself reports a failure */ })
  }, [newChatOpen, preferences.defaultAgent])
  const [failures, setFailures] = useState(0)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const terminalHandles = useRef(new Map<string, TerminalHandle>())
  const { sessionsQuery, online, home, retryDelay, serviceNewer, mismatch, restartStatusQuery } = useServiceReads({ failures, setFailures })

  const { machines, machinesRef, machinesKnown, machineSaid, forgetMachine } = useRemoteMachines()
  const { sessions, sessionMap, setExpectedAgents, paneSessions } = useSessionList({ sessionsQuery, online, machines, home, layout })
  const focusedId = focusedSessionId(layout)
  const [turnDiff, setTurnDiff] = useTurnDiff(focusedId)
  // A click anywhere outside the panes takes the border off the focused pane; a click in a pane, or focus moving to another pane, puts it back.
  const focusedPaneId = activeArrangement(layout)?.focus ?? null
  const [outsidePanes, setOutsidePanes] = useState(false)
  const [seenFocusedPane, setSeenFocusedPane] = useState(focusedPaneId)
  if (seenFocusedPane !== focusedPaneId) {
    setSeenFocusedPane(focusedPaneId)
    setOutsidePanes(false)
  }
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      setOutsidePanes(!(event.target instanceof Element && event.target.closest('[data-pane]')))
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => { document.removeEventListener('mousedown', onMouseDown, true) }
  }, [])
  const focusedSession = useMemo(() => (focusedId ? sessionMap.get(focusedId) : undefined), [focusedId, sessionMap])
  const { getFile, pasteImage } = usePaneFiles({ terminalHandles, machinesRef, online, focusedId })
  // With the window in the background nothing is being looked at, so a session that finishes then keeps its unread dot.
  const visibleKey = windowFocused ? [...visibleSessionIds(layout)].sort().join(' ') : ''
  // Every session some layout shows: one the daemon lists before its pane is placed is kept off the sidebar until it is.
  const openIds = useMemo(() => new Set(layout.arrangements.flatMap((candidate) => candidate.panes.map((pane) => pane.sessionId))), [layout.arrangements])
  const [machineNicknames, setMachineNicknames] = useState(readMachineNicknames)
  const [renamingMachine, setRenamingMachine] = useState<string | null>(null)
  const heads = useMemo(() => machineHeads(machines, machineNicknames), [machines, machineNicknames])
  const { retryNamed, addNamed, openLoginNamed, grantNamed, updateNamed, updateProgress, copyCommand, cancelAdding, removeNamed } = useMachineActions(sessionsQuery.data, forgetMachine)
  // The sidebar is one flat list in creation order; a status change, a pin or a focus never moves a row.
  const ordered = useMemo(() => inCreationOrder(sessions), [sessions])
  // A session the daemon lists a moment before its pane exists would show in the sidebar and then jump once placed.
  // A terminal opened by splitting a pane is part of that split, not a session of its own to list; one no pane shows is listed so it is never lost.
  const [splitShells, setSplitShells] = useState(readSplitShells)
  // An agent's own terminals are tabs of that agent, not sessions to list; one whose agent is gone is listed again.
  const agentTerminals = useMemo(() => liveAgentTerminals(savedAgentTerminals, new Set(sessionMap.keys())), [savedAgentTerminals, sessionMap])
  const ownedTerminals = useMemo(() => ownedTerminalIds(agentTerminals), [agentTerminals])
  const sidebarSessions = useMemo(() => {
    const listed = ordered.filter((session) => !ownedTerminals.has(session.id) && (!splitShells.has(session.id) || !openIds.has(session.id)))
    if (startedFrom === null) return listed
    return listed.filter((session) => startedFrom.has(session.id) || openIds.has(session.id))
  }, [ordered, startedFrom, openIds, splitShells, ownedTerminals])

  // New sessions go to the machine of the session in front, else this computer.
  const focusedMachineNumber = focusedSession?.machine ?? LOCAL_MACHINE
  const sidebarMachineHeads = useMemo(() => (heads.length === 0 ? [LOCAL_HEAD] : heads), [heads])
  const { reducedMotion, theme, previewThemeSoon, setPreviewTheme, look } = useWindowTheme({ preferences, systemReducedMotion, systemDark })
  useSharedSettings(preferences, setPreferences, online)

  // A short word about a key or a drag that did something you cannot see (or nothing): the toast every note goes through.
  const flash = useCallback((text: string) => { toast.info(text, { id: FLASH_TOAST_ID }) }, [])
  const { dropId, dragId } = usePaneDrags({ setLayout })
  usePreferenceEffects({ preferences, reducedMotion })

  useEffect(() => { writeLayout(layout) }, [layout])
  const { refetchSessions, retryAt, tracks } = useSessionSync({ sessionsQuery, retryDelay, queryClient, setFailures, sessions, setLayout, machinesRef, visibleKey, flash })
  const { signInGitHub, gitHubSignInsEnded, signInAgent, runStart, newSession, newTerminal, startChatHere, handoffSession, newChatWithSummary, startNewChat, warmNewChat, createWorktree } = useSessionStarts({ queryClient, sessions, setWorktreeFrom, setLayout, flash, focusedSession, setNewChatOpen, online, starting, setStarting, setStartedFrom, sessionMap, preferences, setExpectedAgents, setSettingsSection, setNewChatMachine, setNewChatSeed, home, machinesRef })
  const { recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded } = useRecentSessions(startNewChat, starting)

  const split = useCallback((paneId: string | null, direction: SplitDirection) => {
    const tab = activeArrangement(layout)
    if (!tab) return
    if (tab.panes.length >= MAX_PANES) {
      toast.info(`A window holds ${String(MAX_PANES)} panes at most. Close one to split again.`)
      return
    }
    const source = tab.panes.find((pane) => pane.id === (paneId ?? tab.focus))
    const sourceSession = source ? sessionMap.get(source.sessionId) : undefined
    const refusal = sourceSession ? remoteStartRefusal(sourceSession.machine !== LOCAL_MACHINE, sourceSession.machineName, 'Splitting this pane') : null
    if (refusal) {
      toast.info(refusal)
      return
    }
    const cwd = sourceSession?.cwd
    void runStart(async () => cwd ?? resolveStartFolder(preferences.startFolder, home || (await defaultSessionFolder())), (id) => {
      setSplitShells((known) => {
        const next = withSplitShell(known, id, new Set([...sessionMap.keys(), id]))
        writeSplitShells(next)
        return next
      })
      // If the layout changed or filled up while the shell started, the shell still gets a layout: it must not be left with no pane.
      setLayout((current) => {
        const next = splitPane(current, source?.id ?? null, direction, id, makeId)
        return next === current ? openArrangement(current, id, makeId) : next
      })
    })
  }, [layout, sessionMap, runStart, preferences.startFolder, home])
  const { askToClose, endSessions, undoLastClose, lastClose, closePaneById, closingPanes, closeAsk, setCloseAsk } = useClosing({ setLayout, queryClient, layout, sessions, flash, paneSessions, agentTerminals })
  useAgentExits({ sessions, listed: online && sessionsQuery.isSuccess, setLayout, agentTerminals: savedAgentTerminals, endSessions })

  const restartPane = useCallback((paneId: string) => {
    const pane = layout.arrangements.flatMap((tab) => tab.panes).find((candidate) => candidate.id === paneId)
    const old = pane ? paneSessions.get(pane.sessionId) : undefined
    if (!old) return
    if (isChatSession(old.conversation)) {
      toast.info('A chat session cannot be restarted. Close it and start a new one.')
      return
    }
    const refusal = remoteStartRefusal(old.machine !== LOCAL_MACHINE, old.machineName, 'Restarting this pane')
    if (refusal) {
      toast.info(refusal)
      return
    }
    void runStart(() => Promise.resolve(old.cwd), (id) => { movePanes(() => { setLayout((current) => dropSession(current, paneId, id)) }) })
  }, [layout, paneSessions, runStart])

  const endSession = useCallback((sessionId: string) => { askToClose([sessionId], () => { endSessions([sessionId]) }) }, [askToClose, endSessions])
  const { showSessionById, openPath, copyPathOf, showSubagent, saveName, openInSplit, copyText, usageInfo } = useSessionActions({ setRenameId, queryClient, setOpenSubagent, setLayout, layout, flash, sessionMap, sessions, preferences, setPreferences, setSettingsSection, setLookAt, setInspectView, setInspectOpen })
  const { runningVersion, skippedVersion, restartNow, setSkippedVersion, restarting } = useAppUpdate({ updater, serviceNewer, preferences, sessions, online })

  const chooseStartFolder = useCallback(async (current: string): Promise<string | null> => {
    try {
      // `~` and other relative text mean nothing to the picker; it opens where it likes then.
      return await chooseProjectFolder(ABSOLUTE_PATH.test(current) ? current : undefined)
    } catch (error) {
      toast.failed('Could not open the folder picker', error)
      return null
    }
  }, [])

  const showTestNotice = useCallback(() => {
    void askNotificationPermission()
    showSessionNotice('test', {
      kind: 'done',
      title: 'A test session',
      state: 'finished',
      body: 'A toast like this appears when a session you are not looking at finishes.',
      actions: [{ label: 'Open session', primary: true, onClick: () => undefined }],
    })
  }, [])

  const setTextSize = useCallback((size: number) => {
    setPreferences((current) => ({ ...current, terminalFontSize: Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, size)) }))
  }, [])

  // In a window too narrow for the sidebar, the same key opens and closes its drawer.
  const toggleSidebar = useCallback(() => {
    if (compact) setDrawerOpen((open) => !open)
    else setPreferences((current) => ({ ...current, compactSidebar: !current.compactSidebar }))
  }, [compact])
  const { toggleInspect, inspectRefusal, showChangesOf, showChanges, togglePanel, openPanel } = useInspectActions({ focusedSession, setInspectOpen, setInspectView, setTurnDiff, sessionMap, showSessionById, inspectOpen, inspectView, focusedId, setLayout })
  const focusModeChord = useMemo(() => shortcutChords(bindingFor('focus-mode'), platform, preferences.keyOverrides)[0] ?? [], [platform, preferences.keyOverrides])

  // Which view a session shows, and whether it has a chat. The whole app is in one view, set in Settings; no session has a view of its own.
  const chatOf = useCallback((session: SessionView) => {
    const availability = chatAvailability(chatSourceOf(session))
    // A chat session has no terminal to switch to: its pane is the chat, always.
    if (isChatSession(session.conversation)) return { availability, view: 'chat' as const }
    // A shell the user opened stays a terminal even once an agent runs in it.
    return { availability, view: startedAsShell(session.id) ? 'terminal' as const : effectiveView(availability, preferences.openSessionsIn) }
  }, [preferences.openSessionsIn])
  // An agent of this computer can have terminals of its own; a shell is one already.
  const ownsTerminals = useCallback((session: SessionView) => online && isDesktop() && session.machine === LOCAL_MACHINE, [online])
  // A terminal that was just started is shown in the dock, which opens for it, with its tab picked.
  const { terminalOpen, setTerminalOpen, terminalShown, canDock, dockFocused, setDockFocused, tabsOf, onTerminalAdded } = useTerminalDock({ agentTerminals, setActiveTerminals, sessionMap, focusedSession, ownsTerminals, showSessionById })
  const { addAgentTerminal, closeAgentTerminal, startAgent } = useAgentStarts({ sessionMap, endSessions, setAgentTerminals, onTerminalAdded, runStart, setLayout, focusedSession, setSettingsSection, preferences, home })
  // The one way the terminal dock opens and closes: the activity bar, the title bar and the key all call it. A session with no
  // terminal yet gets one, which opens the dock (`onTerminalAdded`).
  const toggleTerminal = useCallback(() => {
    if (terminalShown) {
      setTerminalOpen(false)
      setDockFocused(false)
      return
    }
    if (focusedSession === undefined || !canDock) return
    if ((agentTerminals.get(focusedSession.id) ?? []).length === 0) {
      addAgentTerminal(focusedSession.id)
      return
    }
    setTerminalOpen(true)
    setDockFocused(true)
  }, [terminalShown, setTerminalOpen, setDockFocused, focusedSession, canDock, agentTerminals, addAgentTerminal])
  const { runShortcut } = useShortcutRunner({ newSession, focusedMachineNumber, newTerminal, setSettingsSection, preferences, split, setLayout, layout, askToClose, endSessions, toggleSidebar, setPaletteOpen, sessions, focusedSession, flash, showSessionById, undoLastClose, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, setFindOpen, online, setWorktreeFrom, toggleTerminal })

  // Captured on the window before xterm sees the key, so only these few keys leave the shell.
  const overlayOpen = paletteOpen
  const drawerShown = compact && drawerOpen
  // A narrow window keeps the 60px rail and its drawer; a wide one hides the sidebar whole when it is put away (2h).
  const sidebarMode: 'rail' | 'docked' | 'hidden' = compact ? 'rail' : preferences.compactSidebar ? 'hidden' : 'docked'
  // A name is typed in its row where the full sidebar shows; the rail and Focus mode ask in a dialog.
  const renameInline = !focusMode && (sidebarMode === 'docked' || drawerShown)
  const dialogOpen = settingsSection !== null || (renameId !== null && !renameInline) || getFileId !== null || specialistsId !== null || newChatOpen || renamingMachine !== null || recentOpen
  const modalOpen = dialogOpen || overlayOpen
  // Only the New session draft is up, with no dialog over it.
  const onNewChatPage = newChatOpen && settingsSection === null && (renameId === null || renameInline) && getFileId === null && specialistsId === null && renamingMachine === null && !recentOpen
  useShortcutKeys({ runShortcut, canUndoClose: lastClose !== null, dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, setPaletteOpen, setSettingsSection, setNewChatOpen, setDrawerOpen, setFocusMode, platform, keyOverrides: preferences.keyOverrides })

  // The folder each session sits in, for the notices and the palette.
  const projectOf = useMemo(() => new Map(sessions.map((member) => [member.id, { name: folderNameOf(member), key: member.repoRoot ?? member.cwd }])), [sessions])

  useEffect(() => {
    const gained = () => { setWindowFocused(true) }
    const lost = () => { setWindowFocused(false) }
    window.addEventListener('focus', gained)
    window.addEventListener('blur', lost)
    return () => {
      window.removeEventListener('focus', gained)
      window.removeEventListener('blur', lost)
    }
  }, [])
  // What the tray menu lists: every session that needs you, finished or exited, but not an error you are looking at.
  const attentionSessions = useMemo(() => {
    const activity = (id: string) => tracks.get(id)?.changedAt ?? 0
    return sessions
      .filter((item) => (item.status === 'needs' || item.status === 'error' || item.status === 'done') && !(item.status === 'error' && item.id === focusedId && windowFocused))
      .sort(byPriority(activity))
  }, [sessions, tracks, focusedId, windowFocused])
  useTrayItem(attentionSessions, showSessionById)
  const needsElsewhere = sessions.filter((item) => item.status === 'needs' && item.id !== focusedId).length

  // Inspect looks at the focused pane's own repository; the Inspector's changed-file count comes from the same daemon question.
  // A pane of another machine is asked of that machine's daemon, and only for its changes.
  // A chat session has no pane of its own to ask, so its first terminal answers: it runs in the same folder.
  const repoPaneOf = useCallback((session: SessionView): number | null => {
    if (!online || !isDesktop()) return null
    if (session.machine !== LOCAL_MACHINE) return remoteRepoPane(session)
    if (!isChatSession(session.conversation)) return session.pane
    return sessionMap.get(agentTerminals.get(session.id)?.[0] ?? '')?.pane ?? null
  }, [online, sessionMap, agentTerminals])
  // A restore writes the checkout of the pane `repoPaneOf` answers with, so that pane's checkout is the one compared.
  const sharedFolderRefusalOf = useCallback((session: SessionView): string | null => {
    const terminals = agentTerminals.get(session.id) ?? []
    const restorer = isChatSession(session.conversation) ? sessionMap.get(terminals[0] ?? '') : session
    return sharedCheckoutRefusal(sessions, { machine: session.machine, checkout: restorer?.checkout ?? null }, new Set([session.id, ...terminals]))
  }, [sessions, sessionMap, agentTerminals])
  const inspectTerm = focusedSession ? repoPaneOf(focusedSession) : null
  const { openDocument, openReadme } = useDocuments({ layout, setLayout, focusedSession, repoPaneOf, showSessionById, setLookAt, setInspectView, setInspectOpen })
  const inspectMachine = focusedSession?.machine ?? LOCAL_MACHINE
  // Under the Changes tab's own key (`useChangesQuery`), so the full diff the count comes from is read once, not twice.
  const diffStat = useQuery({
    queryKey: ['repo', inspectTerm, 'diff', ...(inspectMachine === LOCAL_MACHINE ? [] : [inspectMachine])],
    queryFn: () => repoDiff(inspectTerm ?? 0, null, inspectMachine),
    select: (diff) => ({ additions: diff.additions, deletions: diff.deletions, files: diff.total_files }),
    // The count shows only in the Inspect panel, and it comes from a full diff: nothing is read while the panel is
    // closed, and not again just because the window came to the front.
    enabled: inspectTerm !== null && inspectOpen,
    refetchInterval: DIFF_STAT_REFRESH_MS,
    refetchOnWindowFocus: false,
    retry: false,
  })
  // Looking at a pane acknowledges it: a finished agent's done goes back to idle, as when the terminal app
  // focuses it, and an error in it leaves the tray menu. Needs-you stays until the agent is answered.
  const viewedId = focusedSession?.id
  const viewedStatus = focusedSession?.status
  useEffect(() => {
    if (!online || !windowFocused || viewedId === undefined) return
    if (viewedStatus !== 'done') return
    markSeenOnDaemon({ id: viewedId })
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch((error: unknown) => { console.warn('Could not mark the session seen', error) })
  }, [online, windowFocused, viewedId, viewedStatus, queryClient])
  const markDone = useCallback((sessionId: string) => {
    markSeenOnDaemon({ id: sessionId })
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch((error: unknown) => { toast.failed('Could not mark the session as done', error) })
  }, [queryClient])
  const { putAway, bringBack, snooze, unsnooze } = usePutAway({ queryClient, sessionMap })
  const { answerSession, sendTo, resumeInterrupted } = useSessionReplies({ sessionMap, flash, showSessionById, setDismissedRestores })
  // Back after an outage: the toast names the chats a service restart cut mid-turn (the daemon marks them), if any.
  const sayBack = useCallback(() => {
    sayBackOnline(sessions.filter((item) => item.interrupted !== null && !dismissedRestores.has(item.id)), resumeInterrupted)
  }, [sessions, dismissedRestores, resumeInterrupted])
  const service = useServiceStage({ online, mismatch: Boolean(mismatch), onBack: sayBack })
  const moveToWorktree = useMoveToWorktree({ sessionMap, sendTo })

  useSessionAlerts({ sessions, sessionMap, machines, projectOf, online, focusedId, preferences, showSessionById, answerSession })
  // With broadcast on, what is typed in one pane also goes to the layout's other panes, but only the idle ones: never into a busy agent.
  const mirrorInput = useCallback((fromSessionId: string, data: string | Uint8Array) => {
    const showing = activeArrangement(layout)
    if (!showing?.broadcast || typeof data !== 'string') return
    for (const pane of showing.panes) {
      const other = pane.sessionId === fromSessionId ? undefined : sessionMap.get(pane.sessionId)
      if (other?.status === 'idle' && !isChatSession(other.conversation)) void sendTo(other, data).catch((error: unknown) => { toast.failed('Could not broadcast to a pane', error) })
    }
  }, [layout, sessionMap, sendTo])
  // Opens the New session draft on a folder picked from the system's dialog.
  const openFolder = useCallback(() => {
    void chooseStartFolder(home).then((folder) => {
      if (folder === null) return
      setNewChatSeed({ folder, message: '' })
      setNewChatOpen(true)
    })
  }, [chooseStartFolder, home])
  const { paletteItems, paletteOutputItem } = usePaletteItems({ openReadme, paletteOpen, platform, layout, sessions, projectOf, showSessionById, home, newSession, focusedMachineNumber, newTerminal, focusedSession, addAgentTerminal, runShortcut, heads, online, preferences, setPreferences, split, setSettingsSection, inspectRefusal, setInspectOpen, setFindOpen, setFocusMode, setShortcutsOpen, setLayout, startAgent, setRecentOpen, openFolder, setSavedOpen })
  const { offlineDetail, restartOffer, appBehindOffer } = useServiceOffers({ mismatch, serviceNewer, restartStatusQuery, refetchSessions, updater, restartNow, sessionsQuery, restartServiceWhenIdle: preferences.restartServiceWhenIdle, starting, afterAppUpdate })
  const { tab, mountedTabs } = useMountedTabs({ layout })
  const startFolderLabel = preferences.startFolder.trim() ? tildePath(resolveStartFolder(preferences.startFolder, home), home) : '~'
  const canStart = online && !starting
  const sidebarWidth = liveSidebarWidth ?? preferences.sidebarWidth
  const rootStyle = { ...themeStyle(theme), ...sizeVariables(preferences, sidebarWidth) } as CSSProperties

  useAttentionBadge(sessions, sessionsQuery.data !== undefined)
  // Until the first list arrives nothing is known about the sessions: "none running" would be a guess, and wrong.
  const sessionsListed = sessionsQuery.data !== undefined
  return { openDocument, sessionsListed, inspectRefusal, signInGitHub, gitHubSignInsEnded, terminalOpen, terminalShown, canDock, toggleTerminal, dockFocused, setDockFocused, tabsOf, toggleInspect, signInAgent, activeTerminals, setActiveTerminals, closeAgentTerminal, ownsTerminals, repoPaneOf, sharedFolderRefusalOf, inspectOpen, focusMode, inspectTerm, focusedSession, projectOf, diffStat, inspectView, lookAt, turnDiff, setTurnDiff, setInspectView, setInspectOpen, flash, shortcutsOpen, platform, root, setShortcutsOpen, welcomeOpen, preferences, setPreferences, setWelcomeOpen, newSession, focusedMachineNumber, paletteOpen, paletteItems, paletteOutputItem, setPaletteOpen, tracks, showSessionById, focusedId, sessionMap, needsElsewhere, setFocusMode, focusModeChord, worktreeFrom, createWorktree, setWorktreeFrom, heads, sessions, home, getFileId, setGetFileId, getFile, updateAsk, setUpdateAsk, updateNamed, closeAsk, setCloseAsk, renamingMachine, machineNicknames, setMachineNicknames, setRenamingMachine, renameId, renameInline, saveName, setRenameId, settingsSection, setSettingsSection, systemReducedMotion, systemDark, previewThemeSoon, showTestNotice, updater, restartNow, setPreviewTheme, online, runningVersion, machinesKnown, retryNamed, removeNamed, grantNamed, copyCommand, addNamed, openLoginNamed, cancelAdding, usageInfo, chooseStartFolder, updatedTo, setUpdatedTo, restarting, newChatOpen, newChatMachine, setNewChatMachine, newChatAgent, setNewChatAgent, newChatSeed, setNewChatSeed, newChatWithSummary, sidebarMachineHeads, setNewChatOpen, startNewChat, warmNewChat, findOpen, terminalHandles, setFindOpen, dismissedRestores, resumeInterrupted, setDismissedRestores, failures, mismatch, retryAt, offlineDetail, service, sessionsQuery, restartOffer, appBehindOffer, refetchSessions, tab, mountedTabs, layout, narrow, setLayout, closingPanes, startFolderLabel, canStart, starting, theme, setTextSize, sidebarSessions, openSubagent, sidebarWidth, setLiveSidebarWidth, newTerminal, showSubagent, openInSplit, addAgentTerminal, copyPathOf, copyText, showChangesOf, markDone, putAway, bringBack, snooze, unsnooze, endSession, updateProgress, skippedVersion, setSkippedVersion, sidebarMode, toggleSidebar, drawerShown, setDrawerOpen, reducedMotion, setRoot, rootStyle, machineSaid, paneSessions, chatOf, agentTerminals, outsidePanes, dropId, dragId, showChanges, setOpenSubagent, togglePanel, openPanel, startChatHere, handoffSession, look, modalOpen, mirrorInput, openPath, pasteImage, split, closePaneById, sendTo, restartPane, moveToWorktree, recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded, specialistsId, setSpecialistsId, afterAppUpdate }
}
