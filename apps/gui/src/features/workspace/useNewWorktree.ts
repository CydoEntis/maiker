import { type Dispatch, type SetStateAction, useCallback } from 'react'
import type { NewChatRequest } from './components/NewChatPage'
import type { ChatAgent } from './model/chatView'
import type { SessionView } from './model/session'
import { worktreeChatRequest } from './model/worktreeChat'

/**
 * What the New worktree dialog's Create does. In the Terminal view the pane's daemon makes the worktree and opens its
 * session there (`[worktree] command`, else a shell). In the Chat view that shell would run unlisted, so the worktree is
 * made the way the New session draft makes one and a chat with the same agent opens in it (`worktreeChatRequest`).
 */
export function useNewWorktree({ chatView, inTerminal, startNewChat, defaultAgent, setWorktreeFrom, flash }: {
  chatView: boolean
  /** The Terminal view's start: the daemon's `NewWorktree` off the session's pane. */
  inTerminal: (from: SessionView, branch: string, base: string | null) => Promise<void>
  startNewChat: (request: NewChatRequest) => Promise<void>
  defaultAgent: ChatAgent
  setWorktreeFrom: Dispatch<SetStateAction<SessionView | null>>
  flash: (text: string) => void
}) {
  return useCallback(async (from: SessionView, branch: string, base: string | null): Promise<void> => {
    if (!chatView) return inTerminal(from, branch, base)
    // A failure rejects before the dialog closes, so it shows under the branch name with the words to fix it.
    await startNewChat(worktreeChatRequest(from, branch, base, defaultAgent))
    setWorktreeFrom(null)
    flash(`Worktree ${branch} ready`)
  }, [chatView, inTerminal, startNewChat, defaultAgent, setWorktreeFrom, flash])
}
