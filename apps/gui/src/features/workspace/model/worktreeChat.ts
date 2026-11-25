import { START_MODE } from '@/features/chat/chatMeta'
import { chatAgentOf, type ChatAgent } from './chatView'
import { startChoiceFor } from './lastWho'
import type { SessionView } from './session'
import type { NewChatRequest } from '../components/NewChatPage'

/**
 * What the New worktree dialog starts in the Chat view: a chat with the agent of the session it was made from (else the
 * default agent) in a new worktree of that session's checkout, as the New session draft's Own worktree starts one. The
 * daemon's own New worktree opens a plain shell, which the Chat view does not list, so the session seemed lost.
 * The folder is the session's own, so "the current commit" is the commit that session is on.
 */
export function worktreeChatRequest(from: Pick<SessionView, 'cwd' | 'machine' | 'machineName'> & { conversation: Pick<SessionView['conversation'], 'agent'> }, branch: string, base: string | null, defaultAgent: ChatAgent): NewChatRequest {
  const agent = chatAgentOf(from.conversation.agent) ?? defaultAgent
  return {
    folder: from.cwd,
    agent,
    ...startChoiceFor(agent),
    // The agent's usual mode, which its Bypass Permissions switch in Settings then decides, as an untouched draft starts.
    mode: START_MODE[agent],
    message: '',
    branch: { name: branch, create: true, worktree: true, ...(base === null ? {} : { base }) },
    machine: from.machine,
    machineName: from.machineName ?? '',
    resume: null,
  }
}
