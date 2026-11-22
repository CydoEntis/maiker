import { type Dispatch, type SetStateAction, useCallback } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { renameConversationOnDaemon } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { DesktopSettingsSection, UsageInfo } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { guardLocal } from '@/lib/localOnly'
import type { RepoSurfaceKind } from '@/features/inspect/panelTabs'
import { repoLocate } from '@/features/inspect/api'
import type { LookAt } from '@/features/inspect/FilesTab'
import type { OpenSubagent } from './model/subagents'
import { type Layout, showSession } from './model/layout'
import { displayName, type SessionView } from './model/session'
import { makeId } from './makeId'
import { copyText as writeClipboard } from '@/lib/clipboard'

/** What a session's row and menu do: show it, rename it, copy its path, open one of its files. */
export function useSessionActions({ setRenameId, queryClient, setOpenSubagent, setLayout, flash, sessionMap, sessions, preferences, setPreferences, setSettingsSection, setLookAt, openSurface }: {
  setRenameId: Dispatch<SetStateAction<string | null>>
  queryClient: QueryClient
  setOpenSubagent: Dispatch<SetStateAction<OpenSubagent | null>>
  setLayout: Dispatch<SetStateAction<Layout>>
  flash: (text: string) => void
  sessionMap: Map<string, SessionView>
  sessions: SessionView[]
  preferences: SettingsPreferences
  setPreferences: Dispatch<SetStateAction<SettingsPreferences>>
  setSettingsSection: Dispatch<SetStateAction<DesktopSettingsSection | null>>
  setLookAt: Dispatch<SetStateAction<LookAt | null>>
  /** Opens the side panel on a session's Files or Changes. */
  openSurface: (sessionId: string, kind: RepoSurfaceKind) => void
}) {
  const saveName = useCallback((sessionId: string, name: string) => {
    setRenameId(null)
    void renameConversationOnDaemon({ id: sessionId }, name)
      .then(async () => { await queryClient.invalidateQueries({ queryKey: ['conversations'] }) })
      .catch((error: unknown) => { toast.failed('Could not rename the session', error) })
  }, [queryClient, setRenameId])

  // Showing a session shows its own chat: a subagent's chat is left by picking any session, its parent too. It shows
  // at once, with no glide: picking a session is the most frequent thing done in the window, and a cross-fade on every
  // pick made switching feel slow. Panes that move (a split, a swap, a close) still glide (`movePanes`).
  const showSessionById = useCallback((sessionId: string) => {
    setOpenSubagent(null)
    setLayout((current) => showSession(current, sessionId, makeId))
  }, [setLayout, setOpenSubagent])

  const copyText = useCallback((text: string, what: string) => {
    writeClipboard(text).then(
      () => { flash(`${what} copied`) },
      (error: unknown) => { toast.failed(`Could not copy the ${what.toLowerCase()}`, error) },
    )
  }, [flash])

  const copyPathOf = useCallback((sessionId: string) => {
    const target = sessionMap.get(sessionId)
    if (target) copyText(target.cwd, 'Path')
  }, [sessionMap, copyText])

  // A subagent's own chat shows in its session's pane.
  const showSubagent = useCallback((sessionId: string, subagentId: string) => {
    setLayout((current) => showSession(current, sessionId, makeId))
    setOpenSubagent({ sessionId, subagentId })
  }, [setLayout, setOpenSubagent])

  // The usage report names panes of this computer's daemon by number; only a pane this window has can be opened.
  const sessionForUsageTerm = useCallback((term: number) => {
    const found = sessions.find((member) => member.machine === LOCAL_MACHINE && member.pane === term)
    return found ? { id: found.id, name: displayName(found) } : null
  }, [sessions])

  const usageInfo: UsageInfo = {
    budget: preferences.monthlyBudget,
    onBudget: (budget: number | null) => { setPreferences((current) => ({ ...current, monthlyBudget: budget })) },
    sessionForTerm: sessionForUsageTerm,
    onOpenSession: (id: string) => { setSettingsSection(null); showSessionById(id) },
  }

  // Cmd/Ctrl-click on a file name in a pane's output: find it in that pane's repo, then show it in Inspect.
  const openPath = useCallback((session: SessionView, path: string, line?: number) => {
    // Files and Changes look at this computer's own checkouts; a pane of another machine has none here.
    const refusal = guardLocal(session, 'path-links')
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    void repoLocate(session.pane, path)
      .then((relative) => {
        showSessionById(session.id)
        setLookAt({ path: relative, ...(line === undefined ? {} : { line }), key: Date.now() })
        openSurface(session.id, 'files')
      })
      .catch((error: unknown) => { toast.failed('Could not open that file', error) })
  }, [openSurface, setLookAt, showSessionById])
  return { showSessionById, openPath, copyPathOf, showSubagent, saveName, copyText, usageInfo }
}
