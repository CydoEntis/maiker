import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from 'react'
import { KEY_CAPTURE_ATTRIBUTE, type KeyOverrides, matchShortcut, NEW_CHAT_PAGE_ACTIONS, type Platform, type ShortcutAction, type ShortcutView } from './model/shortcuts'
import { toast } from '@/lib/toast'
import { isAlertDialogOpen } from '@/components/ui/alert-dialog'
import { isOpenPaletteUp } from '@/features/open-project/paletteOpen'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { guardLocal } from '@/lib/localOnly'
import { isChatSession } from './model/chatSession'
import { discardDraft } from './model/newSessionDraft'
import { activeArrangement, cycleFocus, type Layout, type SplitDirection, toggleBroadcast } from './model/layout'
import type { SessionView } from './model/session'
import { type EscLayer, topmostOpen } from './model/escLadder'
import { LOCAL_MACHINE } from '@/api/machines'
import { syncRemote } from '@/features/inspect/api'
import { jumpToast, nextNeedsYou, NOTHING_NEEDS_YOU } from '@/features/needs-you/model/needsYou'

/** What the Open folder key calls; the Open a project palette sits behind it. */
export type OpenProject = (kind: 'folder') => void

/** Listens for the keyboard: a shortcut runs its action, and Esc closes the topmost layer. */
export function useShortcutKeys({ view, runShortcut, dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, setPaletteOpen, setSettingsSection, setNewChatOpen, setDrawerOpen, setFocusMode, platform, keyOverrides }: {
  /** The view the focused session shows: in the chat view plain Ctrl+key forms are taken, in the terminal view never. */
  view: ShortcutView
  runShortcut: (action: ShortcutAction) => void
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
  const shortcutState = useRef({ view, runShortcut, settingsOpen: dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, keyOverrides })
  useEffect(() => { shortcutState.current = { view, runShortcut, settingsOpen: dialogOpen, onNewChatPage, overlayOpen, paletteOpen, focusMode, drawerShown, welcomeOpen, shortcutsOpen, keyOverrides } })
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
      if (state.welcomeOpen) return
      // A question is on screen: every key, Esc too, is its own until it is answered.
      if (isAlertDialogOpen()) return
      // The Open a project palette is a keyboard surface of its own: no window shortcut reaches past it, and Esc closes only it.
      if (isOpenPaletteUp()) return
      // Settings › Hotkeys is taking down a new key: every key, Esc too, is the field's.
      if (event.target instanceof Element && event.target.closest(`[${KEY_CAPTURE_ATTRIBUTE}]`)) return
      const match = matchShortcut(event, platform, state.keyOverrides, state.view)
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
      state.runShortcut(match.action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [platform, setDrawerOpen, setFocusMode, setNewChatOpen, setPaletteOpen, setSettingsSection])
}

/** What each shortcut does. The palette and the keyboard both go through it. */
export function useShortcutRunner({ openProject, newSession, focusedMachineNumber, newTerminal, setSettingsSection, preferences, split, setLayout, layout, askToClose, endSessions, toggleSidebar, setPaletteOpen, sessions, focusedSession, flash, showSessionById, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, setFindOpen, online, setWorktreeFrom, toggleTerminal }: {
  openProject: OpenProject
  newSession: (machine?: number) => void
  focusedMachineNumber: number
  newTerminal: (machine?: number) => void
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  preferences: SettingsPreferences
  split: (paneId: string | null, direction: SplitDirection) => void
  setLayout: Dispatch<SetStateAction<Layout>>
  layout: Layout
  askToClose: (ids: string[], close: () => void) => void
  endSessions: (ids: string[]) => void
  toggleSidebar: () => void
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  sessions: SessionView[]
  focusedSession: SessionView | undefined
  flash: (text: string) => void
  showSessionById: (sessionId: string) => void
  setFocusMode: Dispatch<SetStateAction<boolean>>
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>
  setTextSize: (size: number) => void
  toggleInspect: () => void
  setFindOpen: Dispatch<SetStateAction<boolean>>
  online: boolean
  setWorktreeFrom: Dispatch<SetStateAction<SessionView | null>>
  toggleTerminal: () => void
}) {
  const runShortcut = useCallback((action: ShortcutAction) => {
    switch (action) {
      case 'new-session':
        newSession(focusedMachineNumber)
        return
      case 'new-terminal':
        newTerminal(focusedMachineNumber)
        return
      case 'split-right':
        split(null, 'right')
        return
      case 'split-down':
        split(null, 'down')
        return
      case 'focus-previous':
        setLayout((current) => cycleFocus(current, -1))
        return
      case 'focus-next':
        setLayout((current) => cycleFocus(current, 1))
        return
      case 'close': {
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
        setSettingsSection((current) => current ?? 'appearance')
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
      case 'performance':
        setSettingsSection('performance')
        return
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
  }, [openProject, newSession, focusedMachineNumber, newTerminal, setSettingsSection, preferences.terminalFontSize, split, setLayout, toggleSidebar, setPaletteOpen, setFocusMode, setShortcutsOpen, setTextSize, toggleInspect, setFindOpen, layout, askToClose, endSessions, sessions, focusedSession, flash, showSessionById, online, setWorktreeFrom, toggleTerminal])
  return { runShortcut }
}
