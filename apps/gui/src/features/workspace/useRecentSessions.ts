import { useCallback, useRef, useState } from 'react'
import type { ClosedSession, ImportableChat } from '@/api/daemon'
import { toast } from '@/lib/toast'
import type { NewChatRequest, NewChatStartOptions } from './components/NewChatPage'
import type { SessionView } from './model/session'
import { importStart } from './model/importChats'
import { endedResume, reopenPlan, reopenRemoved, reopenRequest, savedStart } from './model/recentSessions'
import { openWords, savedName, type OpenOutcome, type WorkspaceFor } from './model/workspacePanel'

/**
 * Opens each of `list` again, one after another, through `start`: in place, or, when its folder is gone, once the
 * service has made it again (`reopenRemoved`), so each opens in the view Settings picks. One that fails is counted and the rest still open; one
 * that cannot be opened is skipped with why.
 */
async function openEach(list: readonly ClosedSession[], start: (request: NewChatRequest) => Promise<void>): Promise<OpenOutcome> {
  let opened = 0
  let failed = 0
  let lastError: unknown = null
  const skipped: { name: string; why: string }[] = []
  for (const closed of list) {
    const plan = reopenPlan(closed)
    if (plan.kind === 'skip') {
      skipped.push({ name: savedName(closed), why: plan.why })
      continue
    }
    try {
      if (plan.kind === 'start') await start(plan.request)
      else await reopenRemoved(closed, start)
      opened += 1
    } catch (error) {
      failed += 1
      lastError = error
    }
  }
  return { opened, failed, lastError, skipped }
}

/** The one toast an Open ends with, under the project it opened in (`where`). */
export function toastOpened(outcome: OpenOutcome, where: string): void {
  const { kind, title, note } = openWords(outcome)
  if (kind === 'failed') toast.failed(title, outcome.lastError, { context: where })
  else toast[kind](title, { context: where, ...(note === null ? {} : { description: note }) })
}

/**
 * The Recent sessions list, the Resume a saved chat dialog, Bring in your chats and a project's Workspace panel: whether
 * each is open, and starting a pick from any of them through the new chat's resume start.
 */
export function useRecentSessions(startNewChat: (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>, starting: boolean) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [workspaceFor, setWorkspaceFor] = useState<WorkspaceFor | null>(null)
  const [opening, setOpening] = useState(false)
  // A second Open before the state above re-renders would start the same sessions twice.
  const openingNow = useRef(false)
  const begin = useCallback((request: NewChatRequest, close: () => void) => {
    // A start already under way would drop this one without a word, so the list stays and says why.
    if (starting) {
      toast.info('A session is already starting')
      return
    }
    close()
    startNewChat(request).catch((error: unknown) => { toast.failed('Could not reopen the session', error) })
  }, [startNewChat, starting])
  const reopenSession = useCallback((closed: ClosedSession) => {
    const request = reopenRequest(closed)
    if (request !== null) begin(request, () => { setRecentOpen(false) })
  }, [begin])
  const resumeSaved = useCallback(({ folder, agent, id, name, lastActive }: { folder: string; agent: 'claude' | 'codex'; id: string; name: string; lastActive: number }) => {
    begin(savedStart(folder, agent, id, { name, lastActive }), () => { setSavedOpen(false) })
  }, [begin])
  // Each picked chat starts in the background, one after another, so the window stays where it is; one that fails is
  // counted and the rest still start.
  const importChats = useCallback((chats: readonly ImportableChat[]) => {
    if (starting) {
      toast.info('A session is already starting')
      return
    }
    setImportOpen(false)
    void (async () => {
      let failed = 0
      let lastError: unknown = null
      for (const chat of chats) {
        try {
          await startNewChat(importStart(chat), { background: true })
        } catch (error) {
          failed += 1
          lastError = error
        }
      }
      const brought = chats.length - failed
      if (failed > 0) toast.failed(failed === chats.length ? 'Could not bring in the chats' : `Brought in ${String(brought)}, but ${String(failed)} could not start`, lastError)
      else toast.success(brought === 1 ? 'Brought in 1 chat' : `Brought in ${String(brought)} chats`)
    })()
  }, [startNewChat, starting])
  // A project's saved sessions, opened again in the background as Bring in your chats starts its picks, so the panel
  // stays where it is and its rows turn to running as they start. `where` names the project in the toast that ends it.
  const openSaved = useCallback((list: readonly ClosedSession[], where: string) => {
    if (list.length === 0) return
    if (starting || openingNow.current) {
      toast.info('A session is already starting')
      return
    }
    openingNow.current = true
    setOpening(true)
    void (async () => {
      const outcome = await openEach(list, (request) => startNewChat(request, { background: true }))
      openingNow.current = false
      setOpening(false)
      toastOpened(outcome, where)
    })()
  }, [startNewChat, starting])
  // The Resume on an ended chat: the same resume start, from what the app remembers of the session.
  const resumeEnded = useCallback((session: SessionView) => {
    const resume = endedResume(session)
    if (resume.kind === 'refused') toast.info(resume.why)
    else begin(resume.request, () => undefined)
  }, [begin])
  return { recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded, importOpen, setImportOpen, importChats, workspaceFor, setWorkspaceFor, openSaved, opening }
}
