import type { SessionView } from './session'

/**
 * The sessions a service restart cut mid-reply that wait for the person: a terminal agent its daemon offers a resume
 * for (`TermInfo.interrupted`), or a chat its daemon lists as cut (`ConversationSummary.interrupted`). Every machine's
 * are here, since each daemon says for its own. Those the person put off in this window are left out.
 */
export function cutOffSessions(sessions: readonly SessionView[], putOff: ReadonlySet<string>): SessionView[] {
  return sessions.filter((session) => !putOff.has(session.id) && (session.interrupted !== null || session.chatCutOff === true))
}
