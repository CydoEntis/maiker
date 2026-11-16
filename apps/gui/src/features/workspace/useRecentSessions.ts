import { useCallback, useState } from 'react'
import type { ClosedSession } from '@/api/daemon'
import { errorMessage } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import type { NewChatRequest } from './components/NewChatPage'
import { LOCAL_MACHINE } from '@/api/machines'
import { DEFAULT_PICK } from '@/features/chat/agentChoice'
import { reopenRequest } from './model/recentSessions'

/**
 * The Recent sessions list and the Resume a saved chat dialog: whether each is open, and starting a pick from either
 * through the new chat's resume start.
 */
export function useRecentSessions(startNewChat: (request: NewChatRequest) => Promise<void>, starting: boolean) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const begin = useCallback((request: NewChatRequest, close: () => void) => {
    // A start already under way would drop this one without a word, so the list stays and says why.
    if (starting) {
      toast.message('A session is already starting')
      return
    }
    close()
    startNewChat(request).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not reopen the session')) })
  }, [startNewChat, starting])
  const reopenSession = useCallback((closed: ClosedSession) => {
    const request = reopenRequest(closed)
    if (request !== null) begin(request, () => { setRecentOpen(false) })
  }, [begin])
  // A saved conversation resumes in its folder as it is: no branch is made, as the new chat page's Resume did.
  const resumeSaved = useCallback(({ folder, agent, id }: { folder: string; agent: 'claude' | 'codex'; id: string }) => {
    begin({ folder, agent, model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: '', branch: null, machine: LOCAL_MACHINE, machineName: 'This computer', resume: id }, () => { setSavedOpen(false) })
  }, [begin])
  return { recentOpen, setRecentOpen, reopenSession, savedOpen, setSavedOpen, resumeSaved }
}
