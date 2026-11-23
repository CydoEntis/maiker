import { movePanes } from './components/paneTransition'
import { withSkipped, type ConfirmKind } from '@/features/confirm/confirm'
import { useConfirm } from '@/features/confirm/useConfirm'
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { isDesktop, markSeenOnDaemon, renameConversationOnDaemon } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import { readSettingsPreferences, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '@/features/settings/preferences'
import { sizeVariables } from './model/layoutSize'
import { isChatSession } from './model/chatSession'
import { connectedMachine, LOCAL_HEAD, machineHeads, remoteStartRefusal, type UpdateAction } from './model/machines'
import { isFirstRun } from '@/features/welcome/welcomed'
import { type RestartedUpdate, takeRestarted } from '@/features/updates/updateMemory'
import { useUpdater } from '@/features/updates/useUpdater'
import { chooseProjectFolder } from '@/api/folderPicker'
import { showSessionNotice } from '@/features/notifications/notify'
import type { TerminalHandle } from '@/features/terminal/handle'
import { connectAgentOnce } from './model/agentHooks'
import type { NewChatSeed } from './components/NewChatPage'
import { chatAvailability, chatSourceOf, effectiveView, type ChatAgent } from './model/chatView'
import { useMachineActions, useRemoteMachines } from './useMachines'
import { useSessionAlerts } from './useSessionAlerts'
import { useStopToasts } from './useStopToasts'
import { type OpenAsk, useOutsideAsks } from './useOutsideAsks'
import { useLatest } from '@/lib/useLatest'
import { asksOutside } from './model/outsideAsks'
import { useMachineToasts } from './useMachineToasts'
import { useTrayItem } from './useTrayItem'
import { useSystemDark, useSystemReducedMotion, useWindowNarrowerThan } from './useWindowQueries'
import { liveAgentTerminals, ownedTerminalIds, readAgentTerminals, withTerminals, writeAgentTerminals } from '@/data/agentTerminals'
import { useAgentExits } from './useAgentExits'
import { readMachineNicknames } from '@/data/machineNicknames'
import type { OpenSubagent } from './model/subagents'
import { useSharedSettings } from '@/features/settings/sharedSettings'
import { leftOutOfChatView, sectionOf } from './model/sidebar'
import { activeArrangement, dropSession, EMPTY_LAYOUT, focusedSessionId, type Layout, removeSessions, visibleSessionIds } from './model/layout'
import { LAYOUT_RESET_NOTICE, readLayout, writeLayout } from './model/layoutStorage'
import { byPriority } from './model/attentionOrder'
import { agentLabel, folderNameOf, inCreationOrder, type SessionView } from './model/session'
import { startChoiceFor } from './model/lastWho'
import { sharedCheckoutRefusal } from './model/sharedCheckout'
import { bindingFor, detectPlatform, shortcutChords } from './model/shortcuts'
import { themeStyle } from './theme/themes'
import { COMPACT_WIDTH_PX, NARROW_WIDTH_PX } from './model/windowSize'
import { useDocuments } from './useDocuments'
import { useSessionStarts } from './useSessionStarts'
import { useClosing } from './useClosing'
import { useAppUpdate } from './useAppUpdate'
import { type OpenProject, useShortcutKeys, useShortcutRunner } from './useShortcuts'
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
import { useSessionSplits, useSplitStore } from './useSessionSplits'
import { startProjectOn } from './model/startProject'
import { useMountedTabs } from './useMountedTabs'
import { useRecentSessions } from './useRecentSessions'
import { ADD_MACHINE, projectRequestFor, sessionRequestFrom, useOpenProjectState } from './useOpenProject'
import { useOpenWorktreeState, useProjectWorktreeState } from './useProjectActions'
import { useOpenedProjectsState } from './useOpenedProjects'
import { usePullRequestsState } from '@/features/pull-requests/usePullRequests'
import { useTerminalDock } from './useTerminalDock'
import { useSidePanel } from './useSidePanel'
import { askNotificationPermission } from '@/features/notifications/native'
import { useAttentionBadge } from '@/features/notifications/useAttentionBadge'
import { useServiceStage } from './useServiceStage'
import { sayBackOnline } from './backOnline'

/** The one toast that key and drag notes share: a newer note replaces the one showing. */
const FLASH_TOAST_ID = 'workspace-note'


const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/

const NO_CHAT_TO_DOCK = 'Open a chat first: its terminal opens in the side panel.'

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
  // The window's one confirm. A ticked "Don't ask again" is saved with the settings, per kind.
  const skipConfirm = useCallback((kind: ConfirmKind) => { setPreferences((current) => ({ ...current, confirmSkipped: withSkipped(current.confirmSkipped, kind) })) }, [])
  const { confirm, pending: pendingConfirm } = useConfirm(preferences.confirmSkipped, skipConfirm)
  const [saved] = useState(readLayout)
  const [layout, setLayout] = useState<Layout>(() => (preferences.restoreLayout ? saved.layout : EMPTY_LAYOUT))
  // A tab layout from an older version was dropped: say so once.
  useEffect(() => { if (saved.reset) toast.info(LAYOUT_RESET_NOTICE) }, [saved.reset])
  // The width while the sidebar's edge is being dragged; it is saved when the pointer is released.
  const [liveSidebarWidth, setLiveSidebarWidth] = useState<number | null>(null)
  const [settingsSection, setSettingsSection] = useState<DesktopSettingsSection | null>(null)
  // The session whose project's pull requests fill the main area, as a page over its panes; null while none do.
  const [pullsOf, setPullsOf] = useState<string | null>(null)
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
  const [projectWorktreeFrom, setProjectWorktreeFrom] = useProjectWorktreeState()
  const [openWorktreeFor, setOpenWorktreeFor] = useOpenWorktreeState()
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
  const [newChatSeed, setNewChatSeed] = useState<NewChatSeed | null>(null)
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
  const { savedSplits, setSavedSplits, setFresh, provenOf, splitOwned } = useSplitStore(sessionMap)
  const focusedId = focusedSessionId(layout)
  const [turnDiff, setTurnDiff] = useTurnDiff(focusedId)
  // A click anywhere outside the panes takes the border off the focused pane; a click in a pane, or focus moving to another pane, puts it back.
  // The pane with the keys: the arrangement's, and within a split session the one of its own panes.
  const focusedPaneId = `${activeArrangement(layout)?.focus ?? ''} ${savedSplits.get(focusedId ?? '')?.focus ?? ''}`
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
  // The whole app is in one view. In the Chat view no plain shell is made or shown: a terminal is the dock under a chat.
  const chatView = preferences.openSessionsIn === 'chat'
  const openIds = useMemo(() => new Set(layout.arrangements.flatMap((candidate) => candidate.panes.map((pane) => pane.sessionId))), [layout.arrangements])
  const [machineNicknames, setMachineNicknames] = useState(readMachineNicknames)
  const [renamingMachine, setRenamingMachine] = useState<string | null>(null)
  const heads = useMemo(() => machineHeads(machines, machineNicknames), [machines, machineNicknames])
  const { retryNamed, addNamed, openLoginNamed, grantNamed, updateNamed, updateProgress, copyCommand, cancelAdding, removeNamed } = useMachineActions(sessionsQuery.data, forgetMachine, confirm)
  // The sidebar is one flat list in creation order; a status change, a pin or a focus never moves a row.
  const ordered = useMemo(() => inCreationOrder(sessions), [sessions])
  // An agent's own terminals are tabs of that agent, not sessions to list; one whose agent is gone is listed again.
  const agentTerminals = useMemo(() => liveAgentTerminals(savedAgentTerminals, new Set(sessionMap.keys()), (id) => Boolean(sessionMap.get(id)?.conversation.agent)), [savedAgentTerminals, sessionMap])
  // With a session's proven splits, the shells that are a session's own: none is a session to list, and each ends with it.
  const ownedShells = useMemo(() => withTerminals(agentTerminals, splitOwned), [agentTerminals, splitOwned])
  const ownedTerminals = useMemo(() => ownedTerminalIds(ownedShells), [ownedShells])
  // The side panel's tabs, each session's own: Files, Changes and the session's terminals that are not pinned to the bottom.
  const { panelOf, changePanel, openSurface } = useSidePanel({ agentTerminals, sessionMap, setInspectOpen })
  // A shell pane left open from the Terminal view is taken out of the Chat view's layout (state adjusted while rendering, as it follows from the view); the shell itself keeps running.
  const shellPanes = chatView ? layout.arrangements.flatMap((tab) => tab.panes.map((pane) => pane.sessionId)).filter((id) => { const session = sessionMap.get(id); return session !== undefined && leftOutOfChatView(session) && !ownedTerminals.has(id) }) : []
  if (shellPanes.length > 0) setLayout(removeSessions(layout, new Set(shellPanes)))
  // A session the daemon lists a moment before its pane exists would show in the sidebar and then jump once placed.
  const sidebarSessions = useMemo(() => {
    // A terminal made by splitting a pane is listed like any other: hiding it left panes on screen with an empty sidebar.
    // In the Chat view a plain shell is not a session of its own (a terminal is the dock under a chat): it keeps running and is listed again in the Terminal view. A helper is always listed.
    const listed = ordered.filter((session) => !ownedTerminals.has(session.id) && !(chatView && leftOutOfChatView(session)))
    if (startedFrom === null) return listed
    return listed.filter((session) => startedFrom.has(session.id) || openIds.has(session.id))
  }, [ordered, startedFrom, openIds, ownedTerminals, chatView])

  // New sessions go to the machine of the session in front, else this computer.
  const focusedMachineNumber = focusedSession?.machine ?? LOCAL_MACHINE
  const sidebarMachineHeads = useMemo(() => (heads.length === 0 ? [LOCAL_HEAD] : heads), [heads])
  const { reducedMotion, theme, previewThemeSoon, setPreviewTheme, look } = useWindowTheme({ preferences, systemReducedMotion, systemDark })
  useSharedSettings(preferences, setPreferences, online)

  // A short word about a key or a drag that did something you cannot see (or nothing): the toast every note goes through.
  const flash = useCallback((text: string) => { toast.info(text, { id: FLASH_TOAST_ID }) }, [])
  const { dropId, dragId, dropLeaf, dragLeaf } = usePaneDrags({ setLayout, setSavedSplits })
  usePreferenceEffects({ preferences, reducedMotion })

  useEffect(() => { writeLayout(layout) }, [layout])
  const { refetchSessions, retryAt, tracks } = useSessionSync({ sessionsQuery, retryDelay, queryClient, setFailures, sessions, setLayout, machinesRef, visibleKey, flash })
  const { signInGitHub, gitHubSignInsEnded, signInAgent, runStart, startRemoteShell, newTerminal, startChatHere, handoffSession, newChatWithSummary, startNewChat, warmNewChat, createWorktree } = useSessionStarts({ queryClient, sessions, setWorktreeFrom, setLayout, flash, focusedSession, setNewChatOpen, online, starting, setStarting, setStartedFrom, sessionMap, preferences, setExpectedAgents, setSettingsSection, setNewChatMachine, setNewChatSeed, home, machinesRef })
  const { recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded } = useRecentSessions(startNewChat, starting)
  const [openProject, setOpenProject] = useOpenProjectState()
  const openedProjects = useOpenedProjectsState(sidebarSessions)
  const pullRequests = usePullRequestsState({ projects: openedProjects.opened, machineOf: useCallback((name: string | null) => connectedMachine(sidebarMachineHeads, name), [sidebarMachineHeads]) })

  const { askToClose, endSessions, closePaneById, closingPanes } = useClosing({ setLayout, queryClient, layout, sessions, flash, paneSessions, agentTerminals: ownedShells, confirm })
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
  const { showSessionById, copyPathOf, showSubagent, saveName, copyText, usageInfo } = useSessionActions({ setRenameId, queryClient, setOpenSubagent, setLayout, flash, sessionMap, sessions, preferences, setPreferences, setSettingsSection })
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
  const { toggleInspect, inspectRefusal, showFilesOf, showChanges, openPanel, showPanelView } = useInspectActions({ focusedSession, setInspectOpen, openSurface, setTurnDiff, sessionMap, showSessionById, setLayout })
  const focusModeChord = useMemo(() => shortcutChords(bindingFor('focus-mode'), platform, preferences.keyOverrides)[0] ?? [], [platform, preferences.keyOverrides])

  // Which view a session shows, and whether it has a chat. The whole app is in one view, set in Settings; no session has a view of its own.
  const chatOf = useCallback((session: SessionView) => {
    const availability = chatAvailability(chatSourceOf(session))
    // A chat session has no terminal to switch to: its pane is the chat, always.
    if (isChatSession(session.conversation)) return { availability, view: 'chat' as const }
    // In the Chat view every session that can be a chat is one, a shell with an agent typed into it included; a plain
    // shell and an agent with no event stream have no chat and stay terminals.
    return { availability, view: effectiveView(availability, preferences.openSessionsIn) }
  }, [preferences.openSessionsIn])
  // An agent of this computer can have terminals of its own; a shell is one already.
  const ownsTerminals = useCallback((session: SessionView) => online && isDesktop() && session.machine === LOCAL_MACHINE, [online])
  // A terminal that was just started is a tab of the side panel, which opens for it; one pinned to the bottom is in the drawer under the pane.
  const { terminalOpen, setTerminalOpen, terminalShown, canDock, hasPinned, dockFocused, setDockFocused, panelFocused, setPanelFocused, tabsOf, onTerminalAdded, pinTerminal, unpinTerminals, showPanelTerminal } = useTerminalDock({ panelOf, changePanel, inspectOpen, setInspectOpen, setActiveTerminals, sessionMap, focusedSession, ownsTerminals, showSessionById })
  // In the Terminal view a session is the agent's own CLI, so a plain start skips the draft and opens it at once: the
  // draft's chat page belongs to the Chat view. Only a start that has something to set up first (its own worktree, or
  // a message to send) keeps the draft.
  const openDraft = useCallback((machine: number, seed: NewChatSeed) => {
    setSettingsSection(null)
    if (!chatView && seed.worktree !== true && seed.message === '') {
      const machineName = heads.find((head) => head.machine === machine)?.name ?? ''
      const agent = seed.agent ?? preferences.defaultAgent
      startNewChat({ agent, folder: seed.folder, ...startChoiceFor(agent), mode: 'default', message: '', branch: null, machine, machineName, resume: null })
        .catch((error: unknown) => { toast.failed(`Could not start ${agentLabel(seed.agent ?? preferences.defaultAgent)}`, error) })
      return
    }
    setNewChatMachine(machine)
    setNewChatSeed(seed)
    setNewChatOpen(true)
  }, [chatView, heads, preferences.defaultAgent, startNewChat, setSettingsSection])
  const { addAgentTerminal, closeAgentTerminals, startAgent } = useAgentStarts({ sessionMap, endSessions, confirm, setAgentTerminals, onTerminalAdded, runStart, startRemoteShell, startNewChat, openDraft, chatView, machineNameOf: (machine) => heads.find((head) => head.machine === machine)?.name ?? '', setLayout, focusedSession, setSettingsSection, preferences, home })
  // The Terminal view's splits: each session's own tree of panes. A split's shell carries a mark as its name on the daemon.
  const nameShell = useCallback((shellId: string, name: string) => {
    void renameConversationOnDaemon({ id: shellId }, name)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch((error: unknown) => { console.warn('Could not mark the split; it is the session’s only until the app restarts', error) })
  }, [queryClient])
  const shownAsTerminal = useCallback((session: SessionView) => !chatView && chatOf(session).view === 'terminal', [chatView, chatOf])
  const sessionSplits = useSessionSplits({ savedSplits, setSavedSplits, setFresh, provenOf, nameShell, sessionMap, layout, setLayout, shownAsTerminal, online, listed: online && sessionsQuery.isSuccess, runStart, closeAgentTerminals, endSessions })
  const { split, splitsOf, paneCountOf, splitRefusalOf, focusSplit, resizeSplit, closeSplit } = sessionSplits
  // The Terminal key, the command palette and the drawer's own buttons all call it. With terminals pinned to the bottom it shows
  // and hides their drawer; without, it opens the side panel on the session's terminal, starting the first one when there is none.
  const toggleTerminal = useCallback(() => {
    if (terminalShown) {
      setTerminalOpen(false)
      setDockFocused(false)
      return
    }
    if (focusedSession === undefined || !canDock) return
    if (hasPinned) {
      setTerminalOpen(true)
      setDockFocused(true)
    } else if (!showPanelTerminal(focusedSession.id)) addAgentTerminal(focusedSession.id)
  }, [terminalShown, setTerminalOpen, setDockFocused, focusedSession, canDock, hasPinned, showPanelTerminal, addAgentTerminal])
  // A narrow window keeps the 60px rail and its drawer; a wide one hides the sidebar whole when it is put away (2h).
  const sidebarMode: 'rail' | 'docked' | 'hidden' = compact ? 'rail' : preferences.compactSidebar ? 'hidden' : 'docked'
  // A session starts in an opened project: New session opens the draft in the project in front on that machine, and
  // with none opened there it opens a project first.
  const newSession = useCallback((machine: number = focusedMachineNumber) => {
    setSettingsSection(null)
    const machineName = sidebarMachineHeads.find((head) => head.machine === machine)?.name ?? null
    const project = startProjectOn(machineName, openedProjects.machines, focusedId, openedProjects.selected)
    // On this computer the palette goes on to the draft in the folder it takes; on another machine it opens the project alone.
    if (project === null) setOpenProject(machine === LOCAL_MACHINE ? sessionRequestFrom('folder') : projectRequestFor(machine))
    else openDraft(machine, { folder: project.folder, message: '' })
  }, [focusedMachineNumber, sidebarMachineHeads, openedProjects.machines, openedProjects.selected, focusedId, setOpenProject, openDraft])
  // New terminal: a shell pane in the Terminal view; in the Chat view the chat's own terminal, in the side panel or its drawer.
  const newTerminalHere = useCallback((machine?: number, folder?: string) => {
    if (!chatView) newTerminal(machine, folder)
    else if (canDock && focusedSession !== undefined && chatOf(focusedSession).view === 'chat') toggleTerminal()
    else flash(NO_CHAT_TO_DOCK)
  }, [chatView, newTerminal, canDock, focusedSession, chatOf, toggleTerminal, flash])
  // The Open a project palette is the one way in: the Open folder key and command land in this computer's folders.
  const openFolder = useCallback(() => { setOpenProject(sessionRequestFrom('folder')) }, [setOpenProject])
  const openProjectFromKey = useCallback<OpenProject>(() => { setOpenProject(sessionRequestFrom('folder')) }, [setOpenProject])
  const addMachine = useCallback(() => { setOpenProject(ADD_MACHINE) }, [setOpenProject])
  const { runShortcut } = useShortcutRunner({ openProject: openProjectFromKey, newSession, focusedMachineNumber, newTerminal: newTerminalHere, setSettingsSection, preferences, split, stepPaneFocus: sessionSplits.stepPaneFocus, closeFocusedSplit: sessionSplits.closeFocusedSplit, setLayout, layout, askToClose, endSessions, toggleSidebar, setPaletteOpen, sessions, focusedSession, flash, showSessionById, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, setFindOpen, online, setWorktreeFrom, toggleTerminal, setPreferences, confirm, sidebarHidden: sidebarMode === 'hidden', sessionOrder: sidebarSessions, inspectOpen, showPanelView, changePanel, addMachine, root })

  // Captured on the window before xterm sees the key, so only these few keys leave the shell.
  const overlayOpen = paletteOpen
  const drawerShown = compact && drawerOpen
  // A name is typed in its row where the full sidebar shows; the rail and Focus mode ask in a dialog.
  // The request of a terminal session whose dialog is open (`useOutsideAsks`).
  const [openAsk, setOpenAsk] = useState<OpenAsk | null>(null)
  const dialogOpen = openAsk !== null || settingsSection !== null || renameId !== null || getFileId !== null || specialistsId !== null || newChatOpen || renamingMachine !== null || recentOpen || openProject !== null || openWorktreeFor !== null
  const modalOpen = dialogOpen || overlayOpen
  // Only the New session draft is up, with no dialog over it.
  const onNewChatPage = newChatOpen && settingsSection === null && renameId === null && getFileId === null && specialistsId === null && renamingMachine === null && !recentOpen && openProject === null && openWorktreeFor === null
  useShortcutKeys({ runShortcut, dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, setPaletteOpen, setSettingsSection, setNewChatOpen, setDrawerOpen, setFocusMode, platform, keyOverrides: preferences.keyOverrides })

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
  // What the tray menu lists: every session that needs you or finished.
  const attentionSessions = useMemo(() => {
    const activity = (id: string) => tracks.get(id)?.changedAt ?? 0
    return sessions
      .filter((item) => sectionOf(item) === 'needs' || sectionOf(item) === 'done')
      .sort(byPriority(activity))
  }, [sessions, tracks])
  useTrayItem(attentionSessions, showSessionById)
  const needsElsewhere = sessions.filter((item) => sectionOf(item) === 'needs' && item.id !== focusedId).length

  // The side panel's Files and Changes look at the focused pane's own repository.
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
    const terminals = ownedShells.get(session.id) ?? []
    const restorer = isChatSession(session.conversation) ? sessionMap.get(terminals[0] ?? '') : session
    return sharedCheckoutRefusal(sessions, { machine: session.machine, checkout: restorer?.checkout ?? null }, new Set([session.id, ...terminals]))
  }, [sessions, sessionMap, ownedShells])
  const inspectTerm = focusedSession ? repoPaneOf(focusedSession) : null
  const { openDocument, openPath } = useDocuments({ layout, setLayout, showSessionById })
  // Opening a finished session acknowledges it: the daemon that runs it turns its done to idle (it decides; this only
  // says the person looked). Needs-you stays until the agent is answered.
  const viewedId = focusedSession?.id
  const viewedStatus = focusedSession?.status
  useEffect(() => {
    if (!online || !windowFocused || viewedId === undefined || viewedStatus !== 'done') return
    markSeenOnDaemon({ id: viewedId })
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch((error: unknown) => { console.warn('Could not mark the session seen', error) })
  }, [online, windowFocused, viewedId, viewedStatus, queryClient])
  const { answerSession, sendTo, resumeInterrupted } = useSessionReplies({ sessionMap, flash, showSessionById, setDismissedRestores })
  // Back after an outage: the toast names the chats a service restart cut mid-turn (the daemon marks them), if any.
  const sayBack = useCallback(() => {
    sayBackOnline(sessions.filter((item) => item.interrupted !== null && !dismissedRestores.has(item.id)), resumeInterrupted)
  }, [sessions, dismissedRestores, resumeInterrupted])
  const service = useServiceStage({ online, mismatch: Boolean(mismatch), onBack: sayBack })
  const moveToWorktree = useMoveToWorktree({ sessionMap, sendTo })

  // A chat that is drawn says what its session asks in its own cards; a terminal, and a chat still starting, cannot.
  const asksOutsidePane = useCallback((session: SessionView) => { const shown = chatOf(session); return shown.view === 'terminal' || shown.availability.kind !== 'ready' }, [chatOf])
  // A request said by its own toast (`useOutsideAsks`) is not said a second time by the plain needs-you card.
  const saidByOwnToast = useCallback((session: SessionView) => asksOutsidePane(session) && asksOutside(session), [asksOutsidePane])
  useSessionAlerts({ sessions, sessionMap, machines, projectOf, online, focusedId, preferences, showSessionById, answerSession, saidByOwnToast })
  useStopToasts({ sessions, listed: sessionsQuery.data !== undefined, online, showSessionById })
  const paneOfSession = useLatest((sessionId: string) => layout.arrangements.flatMap((each) => each.panes).find((pane) => pane.sessionId === sessionId && !pane.doc)?.id)
  const restartSession = useCallback((sessionId: string) => { const paneId = paneOfSession(sessionId); if (paneId !== undefined) restartPane(paneId) }, [paneOfSession, restartPane])
  const closeSessionPane = useCallback((sessionId: string) => { const paneId = paneOfSession(sessionId); if (paneId !== undefined) closePaneById(paneId) }, [paneOfSession, closePaneById])
  useOutsideAsks({ openAsk, setOpenAsk, sessions: paneSessions, asksOutsidePane, listed: sessionsQuery.data !== undefined, online, showSessionById, restartSession, closeSessionPane })
  useMachineToasts({ heads, updating: updateProgress, onRetry: retryNamed, onUpdate: (name, action) => { setUpdateAsk({ name, action }) } })
  // With broadcast on, what is typed in one pane also goes to the layout's other panes, but only the idle ones: never into a busy agent.
  const mirrorInput = useCallback((fromSessionId: string, data: string | Uint8Array) => {
    const showing = activeArrangement(layout)
    if (!showing?.broadcast || typeof data !== 'string') return
    for (const pane of showing.panes) {
      const other = pane.sessionId === fromSessionId ? undefined : sessionMap.get(pane.sessionId)
      if (other?.status === 'idle' && !isChatSession(other.conversation)) void sendTo(other, data).catch((error: unknown) => { toast.failed('Could not broadcast to a pane', error) })
    }
  }, [layout, sessionMap, sendTo])
  const { paletteItems, paletteOutputItem } = usePaletteItems({ setGetFileId, paletteOpen, platform, layout, sessions, projectOf, showSessionById, home, newSession, focusedMachineNumber, newTerminal: newTerminalHere, chatView, focusedSession, addAgentTerminal, runShortcut, heads, online, preferences, setPreferences, split, setSettingsSection, inspectRefusal, setInspectOpen, showPanelView, setFindOpen, setFocusMode, setShortcutsOpen, setLayout, startAgent, setRecentOpen, openFolder, setSavedOpen, setOpenProject })
  const { offlineDetail, restartOffer, appBehindOffer } = useServiceOffers({ mismatch, serviceNewer, restartStatusQuery, refetchSessions, updater, restartNow, sessionsQuery, restartServiceWhenIdle: preferences.restartServiceWhenIdle, starting, afterAppUpdate })
  const { tab, mountedTabs } = useMountedTabs({ layout })
  const canStart = online && !starting
  const sidebarWidth = liveSidebarWidth ?? preferences.sidebarWidth
  const rootStyle = { ...themeStyle(theme), ...sizeVariables(preferences, sidebarWidth) } as CSSProperties

  useAttentionBadge(sessions, sessionsQuery.data !== undefined)
  // Until the first list arrives nothing is known about the sessions: "none running" would be a guess, and wrong.
  const sessionsListed = sessionsQuery.data !== undefined
  return { pullRequests, showPanelView, showFilesOf, confirm, pendingConfirm, openDocument, sessionsListed, inspectRefusal, signInGitHub, gitHubSignInsEnded, terminalOpen, terminalShown, canDock, toggleTerminal, dockFocused, setDockFocused, tabsOf, toggleInspect, signInAgent, activeTerminals, setActiveTerminals, closeAgentTerminals, ownsTerminals, repoPaneOf, sharedFolderRefusalOf, inspectOpen, focusMode, inspectTerm, focusedSession, projectOf, turnDiff, setTurnDiff, setInspectOpen, panelOf, changePanel, pinTerminal, unpinTerminals, panelFocused, setPanelFocused, flash, shortcutsOpen, platform, root, setShortcutsOpen, welcomeOpen, preferences, setPreferences, setWelcomeOpen, newSession, focusedMachineNumber, paletteOpen, paletteItems, paletteOutputItem, setPaletteOpen, tracks, showSessionById, focusedId, sessionMap, needsElsewhere, setFocusMode, focusModeChord, worktreeFrom, createWorktree, setWorktreeFrom, projectWorktreeFrom, setProjectWorktreeFrom, openWorktreeFor, setOpenWorktreeFor, heads, sessions, home, getFileId, setGetFileId, getFile, updateAsk, setUpdateAsk, updateNamed, renamingMachine, machineNicknames, setMachineNicknames, setRenamingMachine, renameId, saveName, setRenameId, settingsSection, setSettingsSection, pullsOf, setPullsOf, systemReducedMotion, systemDark, previewThemeSoon, showTestNotice, updater, restartNow, setPreviewTheme, online, runningVersion, machinesKnown, retryNamed, removeNamed, grantNamed, copyCommand, addNamed, openLoginNamed, cancelAdding, usageInfo, chooseStartFolder, updatedTo, setUpdatedTo, restarting, newChatOpen, newChatMachine, setNewChatMachine, newChatAgent, setNewChatAgent, newChatSeed, setNewChatSeed, newChatWithSummary, sidebarMachineHeads, setNewChatOpen, startNewChat, warmNewChat, findOpen, terminalHandles, setFindOpen, dismissedRestores, resumeInterrupted, setDismissedRestores, failures, mismatch, retryAt, offlineDetail, service, sessionsQuery, restartOffer, appBehindOffer, refetchSessions, tab, mountedTabs, layout, narrow, setLayout, closingPanes, canStart, starting, theme, setTextSize, sidebarSessions, openSubagent, sidebarWidth, setLiveSidebarWidth, newTerminal: newTerminalHere, chatView, showSubagent, addAgentTerminal, copyPathOf, copyText, endSession, endSessions, updateProgress, skippedVersion, setSkippedVersion, sidebarMode, toggleSidebar, drawerShown, setDrawerOpen, reducedMotion, setRoot, rootStyle, machineSaid, paneSessions, chatOf, agentTerminals, outsidePanes, dropId, dragId, dropLeaf, dragLeaf, showChanges, setOpenSubagent, openPanel, startChatHere, handoffSession, look, modalOpen, mirrorInput, openPath, pasteImage, split, closePaneById, sendTo, restartPane, moveToWorktree, recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded, specialistsId, setSpecialistsId, afterAppUpdate, startAgent, openDraft, openProject, setOpenProject, openedProjects, openAsk, setOpenAsk, splitsOf, paneCountOf, splitRefusalOf, focusSplit, resizeSplit, closeSplit }
}
