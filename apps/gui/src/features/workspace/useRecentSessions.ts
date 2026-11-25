import { useCallback, useState } from 'react'
import type { ClosedSession, ImportableChat } from '@/api/daemon'
import { toast } from '@/lib/toast'
import type { NewChatRequest, NewChatStartOptions } from './components/NewChatPage'
import type { SessionView } from './model/session'
import { importStart } from './model/importChats'
import { endedResume, reopenRequest, savedStart } from './model/recentSessions'
import type { WorkspaceFor } from './model/workspacePanel'

/**
 * The Recent sessions list, the Resume a saved chat dialog, Bring in your chats and a project's Workspace panel: whether
 * each is open, and starting a pick from any of them through the new chat's resume start.
 */
export function useRecentSessions(startNewChat: (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>, starting: boolean) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [workspaceFor, setWorkspaceFor] = useState<WorkspaceFor | null>(null)
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
  // The Resume on an ended chat: the same resume start, from what the app remembers of the session.
  const resumeEnded = useCallback((session: SessionView) => {
    const resume = endedResume(session)
    if (resume.kind === 'refused') toast.info(resume.why)
    else begin(resume.request, () => undefined)
  }, [begin])
  return { recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved, resumeEnded, importOpen, setImportOpen, importChats, workspaceFor, setWorkspaceFor }
}
