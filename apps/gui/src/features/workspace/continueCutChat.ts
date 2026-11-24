import { readConversationPage, resumeChat, submitMessage } from '@/api/daemon'
import { reserveOperation } from '@/features/chat/sendOperation'
import type { SessionView } from './model/session'

/** What a cut chat is told to carry on with: the words its service sends itself with `restore.continue_turn` on. */
export const CONTINUE_WORDS = 'Continue where you left off.'

/**
 * Continues a chat a service restart cut mid-reply, as the person asked: its agent starts again on its own session (the
 * service reads its past back first), then it is told to carry on. The message is sent like one the person typed, so it
 * shows in the chat.
 */
export async function continueCutChat(session: Pick<SessionView, 'conversation'>): Promise<void> {
  const link = session.conversation.chat
  if (link === undefined) throw new Error('Only a chat session is continued this way')
  const resumed = await resumeChat({ id: session.conversation.id, generation: link.generation })
  // The numbers its earlier messages used: a send must go above them.
  const page = await readConversationPage(link.conversation, null)
  await submitMessage({ id: session.conversation.id, generation: resumed.generation }, reserveOperation(link.conversation, page), CONTINUE_WORDS)
}
