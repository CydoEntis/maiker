import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'
import { KEY_CAPTURE_ATTRIBUTE, type KeyOverrides, matchShortcut, NEW_CHAT_PAGE_ACTIONS, type Platform, type ShortcutAction } from './model/shortcuts'
import { isPageKey } from '@/features/shortcuts/pageKeys'
import { toast } from '@/lib/toast'
import { isAlertDialogOpen } from '@/components/ui/alert-dialog'
import { isOpenPaletteUp } from '@/features/open-project/paletteOpen'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { guardLocal } from '@/lib/localOnly'
import { isChatSession } from './model/chatSession'
import { discardDraft } from './model/newSessionDraft'
import { activeArrangement, type Layout, toggleBroadcast } from './model/layout'
import type { SplitDir } from './model/splitTree'
import type { SessionView } from './model/session'
import { type EscLayer, topmostOpen } from './model/escLadder'
import { LOCAL_MACHINE } from '@/api/machines'
import { syncRemote } from '@/features/inspect/api'
import { jumpToast, nextNeedsYou, NOTHING_NEEDS_YOU } from '@/features/needs-you/model/needsYou'
import { type PanelTabs, type RepoSurfaceKind, showTab } from '@/features/inspect/panelTabs'
import { confirmAsk } from '@/features/confirm/confirm'
import type { Confirm } from '@/features/confirm/useConfirm'
import { focusChatBox, focusSidebar, openModelPicker, sidebarRowOrder } from './keyTargets'

/** Said when the chat box's key is pressed where no chat box is: a terminal pane, or nothing open. */
const NO_CHAT_BOX = 'No chat box here.'

/** Runs an action of the table. `digit` is which of 1 to 9 was pressed, for the key that stands for all nine. */
export type RunShortcut = (action: ShortcutAction, digit?: number) => void

/** What the Open folder key calls; the Open a project palette sits behind it. */
export type OpenProject = (kind: 'folder') => void

/** Listens for the keyboard: a shortcut runs its action, and Esc closes the topmost layer. */
export function useShortcutKeys({ runShortcut, dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, setPaletteOpen, setSettingsSection, setNewChatOpen, setDrawerOpen, setFocusMode, platform, keyOverrides }: {
  runShortcut: RunShortcut
  dialogOpen: boolean
  onNewChatPage: boolean
  overlayOpen: boolean
  paletteOpen: boolean
  focusMode: boolean
  drawerShown: boolean
  welcomeOpen: boolean
  shortcutsOpen: boolean
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  setNewChatOpen: Dispatch<SetStateAction<boolean>>
  setDrawerOpen: Dispatch<SetStateAction<boolean>>
  setFocusMode: Dispatch<SetStateAction<boolean>>
  platform: Platform
  keyOverrides: KeyOverrides
}) {
  const shortcutState = useRef({ runShortcut, settingsOpen: dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, keyOverrides })
  useEffect(() => { shortcutState.current = { runShortcut, settingsOpen: dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, keyOverrides } })
  useEffect(() => {
    // How each layer of the Esc ladder closes. A new dialog adds its closer here and its id to ESC_LADDER.
    const closers: Partial<Record<EscLayer, () => void>> = {
      palette: () => { setPaletteOpen(false) },
      // The New session draft counts as a dialog here, so this layer is the one that closes it too; Esc discards it.
      settings: () => { setSettingsSection(null); discardDraft(); setNewChatOpen(false) },
      drawer: () => { setDrawerOpen(false) },
      'focus-mode': () => { setFocusMode(false) },
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const state = shortcutState.current
      // Not stopped: the terminal or field with the focus still gets the key, only the page's own answer to it is off.
      if (isPageKey(event, platform)) event.preventDefault()
      if (state.welcomeOpen) return
      // A question is on screen: every key, Esc too, is its own until it is answered.
      if (isAlertDialogOpen()) return
      // The Open a project palette is a keyboard surface of its own: no window shortcut reaches past it, and Esc closes only it.
      if (isOpenPaletteUp()) return
      // Settings › Hotkeys is taking down a new key: every key, Esc too, is the field's.
      if (event.target instanceof Element && event.target.closest(`[${KEY_CAPTURE_ATTRIBUTE}]`)) return
      const match = matchShortcut(event, platform, state.keyOverrides)
      if (state.shortcutsOpen) {
        // Only its own key closes it; Esc is the dialog's.
        if (match?.action === 'shortcuts') {
          event.preventDefault()
          event.stopPropagation()
          state.runShortcut('shortcuts')
        }
        return
      }
      if (event.key === 'Escape') {
        // A menu or list that is open (the spinner picker in Settings) takes Esc itself.
        if (event.target instanceof Element && event.target.closest('[role="menu"], [role="combobox"][aria-expanded="true"], .mx-chip-menu, .mx-nsd-more-body')) return
        const top = topmostOpen({ palette: state.paletteOpen, settings: state.settingsOpen, drawer: state.drawerShown, 'focus-mode': state.focusMode })
        if (top === null) return
        // What Esc closes is not also sent on to the terminal, where it would interrupt an agent.
        event.preventDefault()
        event.stopPropagation()
        closers[top]?.()
        return
      }
      if (state.overlayOpen) {
        if (match?.action === 'palette') {
          event.preventDefault()
          event.stopPropagation()
          state.runShortcut(match.action)
        }
        return
      }
      if (state.settingsOpen && !(state.onNewChatPage && match !== null && NEW_CHAT_PAGE_ACTIONS.has(match.action))) return
      if (!match) return
      event.preventDefault()
      event.stopPropagation()
      state.runShortcut(match.action, match.digit)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [platform, setDrawerOpen, setFocusMode, setNewChatOpen, setPaletteOpen, setSettingsSection])
}

/** `panel` with the tab `step` on from the one in front, going round at either end. */
function stepTab(panel: PanelTabs, step: 1 | -1): PanelTabs {
  const shown = panel.tabs.findIndex((tab) => tab.id === panel.active)
  const next = panel.tabs[(Math.max(shown, 0) + step + panel.tabs.length) % panel.tabs.length]
  return next === undefined ? panel : showTab(panel, next.id)
}

/** What each shortcut does. The palette and the keyboard both go through it. */
export function useShortcutRunner({ openProject, newSession, focusedMachineNumber, newTerminal, setSettingsSection, preferences, setPreferences, confirm, split, stepPaneFocus, closeFocusedSplit, setLayout, layout, askToClose, endSessions, toggleSidebar, sidebarHidden, setPaletteOpen, sessions, sessionOrder, focusedSession, flash, showSessionById, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, inspectOpen, showPanelView, changePanel, setFindOpen, online, setWorktreeFrom, toggleTerminal, addMachine, root }: {
  openProject: OpenProject
  newSession: (machine?: number) => void
  focusedMachineNumber: number
  newTerminal: (machine?: number, folder?: string) => void
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  preferences: SettingsPreferences
  setPreferences: Dispatch<SetStateAction<SettingsPreferences>>
  /** The window's one question, asked before the view changes. */
  confirm: Confirm
  split: (paneId: string | null, direction: SplitDir) => void
  /** Moves the focus one pane on or back, through a session's splits and on to the next session. */
  stepPaneFocus: (step: 1 | -1) => void
  /** Closes the split with the focus, after asking; false when the focus is on a session's own pane. */
  closeFocusedSplit: () => boolean
  setLayout: Dispatch<SetStateAction<Layout>>
  layout: Layout
  askToClose: (ids: string[], close: () => void) => void
  endSessions: (ids: string[]) => void
  toggleSidebar: () => void
  /** The sidebar is put away whole, so the key that goes to it shows it first. */
  sidebarHidden: boolean
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  sessions: SessionView[]
  /** The sessions the sidebar lists, for the session keys while the sidebar itself is not drawn. */
  sessionOrder: readonly SessionView[]
  focusedSession: SessionView | undefined
  flash: (text: string) => void
  showSessionById: (sessionId: string) => void
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setTextSize: (size: number) => void
  toggleInspect: () => void
  inspectOpen: boolean
  /** Opens the focused session's side panel on Files or Changes. */
  showPanelView: (view: RepoSurfaceKind) => void
  changePanel: (sessionId: string, change: (panel: PanelTabs) => PanelTabs) => void
  setFindOpen: Dispatch<SetStateAction<boolean>>
  online: boolean
  setWorktreeFrom: Dispatch<SetStateAction<SessionView | null>>
  toggleTerminal: () => void
  /** Opens the Open a project palette on its New machine level. */
  addMachine: () => void
  /** The window's root, where the go-to keys find the chat box and the sidebar (`keyTargets`). */
  root: HTMLElement | null
}) {
  // The session `step` rows on from the one in front, in the order the sidebar draws them, going round at either end.
  const stepSession = useCallback((step: 1 | -1) => {
    const order = sidebarRowOrder(root) ?? sessionOrder.map((session) => session.id)
    const at = focusedSession === undefined ? -1 : order.indexOf(focusedSession.id)
    const next = order[at === -1 ? 0 : (at + step + order.length) % order.length]
    if (next !== undefined) showSessionById(next)
  }, [root, sessionOrder, focusedSession, showSessionById])
  const runShortcut = useCallback<RunShortcut>((action, digit) => {
    switch (action) {
      case 'session-next':
        stepSession(1)
        return
      case 'session-previous':
        stepSession(-1)
        return
      case 'go-to-session': {
        const target = digit === undefined ? undefined : (sidebarRowOrder(root) ?? sessionOrder.map((session) => session.id))[digit - 1]
        if (target !== undefined) showSessionById(target)
        return
      }
      case 'focus-chat':
        if (!focusChatBox(root)) flash(NO_CHAT_BOX)
        return
      case 'model-picker':
        if (!openModelPicker(root)) flash(NO_CHAT_BOX)
        return
      case 'focus-sidebar':
        if (sidebarHidden) toggleSidebar()
        // After the frame that draws a sidebar this key has just shown.
        window.requestAnimationFrame(() => { focusSidebar(root) })
        return
      case 'files':
        showPanelView('files')
        return
      case 'changes':
        showPanelView('changes')
        return
      case 'panel-tab-next':
      case 'panel-tab-previous':
        if (inspectOpen && focusedSession !== undefined) changePanel(focusedSession.id, (panel) => stepTab(panel, action === 'panel-tab-next' ? 1 : -1))
        return
      case 'add-machine':
        addMachine()
        return
      case 'switch-view': {
        const next = preferences.openSessionsIn === 'chat' ? 'terminal' : 'chat'
        confirm(confirmAsk('switch-view', next), () => { setPreferences((current) => ({ ...current, openSessionsIn: next })) })
        return
      }
      case 'new-session':
        newSession(focusedMachineNumber)
        return
      case 'new-terminal':
        // In Chat view a terminal is the session's own, in its side panel; a loose shell is the Terminal view's, and it
        // opens in the folder of the session in front.
        if (preferences.openSessionsIn === 'chat') toggleTerminal()
        else newTerminal(focusedMachineNumber, focusedSession?.cwd)
        return
      case 'split-right':
        split(null, 'right')
        return
      case 'split-down':
        split(null, 'down')
        return
      case 'focus-previous':
        stepPaneFocus(-1)
        return
      case 'focus-next':
        stepPaneFocus(1)
        return
      case 'close': {
        if (closeFocusedSplit()) return
        const tab = activeArrangement(layout)
        if (!tab) return
        const single = tab.panes.length > 1
        const targets = single ? tab.panes.filter((pane) => pane.id === tab.focus) : tab.panes
        const ids = targets.map((pane) => pane.sessionId)
        askToClose(ids, () => { endSessions(ids) })
        return
      }
      case 'toggle-sidebar':
        toggleSidebar()
        return
      case 'settings':
        setSettingsSection((current) => current ?? 'general')
        return
      case 'palette':
        setPaletteOpen((open) => !open)
        return
      case 'jump-needs': {
        const target = nextNeedsYou(sessions, focusedSession?.id ?? null)
        if (!target) flash(NOTHING_NEEDS_YOU)
        else {
          showSessionById(target.session.id)
          flash(jumpToast(target))
        }
        return
      }
      case 'usage':
        setSettingsSection('usage')
        return
      case 'focus-mode':
        setFocusMode((on) => !on)
        return
      case 'shortcuts':
        setShortcutsOpen((open) => !open)
        return
      case 'text-larger':
        setTextSize(preferences.terminalFontSize + 1)
        return
      case 'text-smaller':
        setTextSize(preferences.terminalFontSize - 1)
        return
      case 'inspect':
        toggleInspect()
        return
      case 'terminal':
        toggleTerminal()
        return
      case 'open-folder':
        openProject('folder')
        return
      case 'fetch': {
        const local = focusedSession?.machine === LOCAL_MACHINE
        if (focusedSession === undefined) flash('Nothing to fetch: no session is open.')
        else if (local && focusedSession.repoRoot === null) flash('This session is not in a git repository.')
        else {
          flash('Fetching…')
          // Another machine's checkout is found through the pane that runs there, as the Changes view does.
          syncRemote(focusedSession.repoRoot ?? '', 'fetch', focusedSession.machine, local ? undefined : focusedSession.pane)
            .then(flash)
            .catch((error: unknown) => { toast.failed('Could not fetch', error) })
        }
        return
      }
      case 'find':
        setFindOpen((open) => !open)
        return
      case 'new-worktree': {
        const refusal = guardLocal(focusedSession, 'worktrees')
        if (refusal !== null) toast.info(refusal)
        // A new worktree session branches off a terminal pane, which a chat has none of: it moves through its branch menu.
        else if (focusedSession && isChatSession(focusedSession.conversation)) toast.info('A chat moves to a worktree from its branch menu.')
        else if (focusedSession && online) setWorktreeFrom(focusedSession)
        return
      }
      case 'broadcast':
        if (layout.activeId) {
          const turningOn = !activeArrangement(layout)?.broadcast
          setLayout((current) => toggleBroadcast(current, current.activeId ?? ''))
          flash(turningOn ? 'Broadcast on · typing goes to every idle pane in this tab' : 'Broadcast off')
        }
        return
    }
  }, [openProject, newSession, focusedMachineNumber, newTerminal, setSettingsSection, preferences.terminalFontSize, preferences.openSessionsIn, setPreferences, confirm, split, stepPaneFocus, closeFocusedSplit, setLayout, toggleSidebar, sidebarHidden, setPaletteOpen, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, inspectOpen, showPanelView, changePanel, setFindOpen, layout, askToClose, endSessions, sessions, sessionOrder, stepSession, focusedSession, flash, showSessionById, online, setWorktreeFrom, toggleTerminal, addMachine, root])
  return { runShortcut }
}
