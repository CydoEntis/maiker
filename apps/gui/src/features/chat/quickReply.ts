import type { Askable } from './plainQuestions'
import { askedText } from './plainQuestions'
import { buildQuoteMessage, type MessageSegment } from './quoteMessage'

/**
 * Quick replies to the questions an agent asked in plain text. The answers go back as one ordinary message: each
 * answered question as a quote (with its number) followed by the answer, in the order asked, so the agent reads clean
 * "question, answer" pairs and the chat draws each as a stub above the person's words.
 */

/** The answers typed so far, by question text: a message edited or regenerated never gives an old answer to a new question. */
export type ReplyAnswers = Readonly<Record<string, string>>

/** What the Your call chip answers. */
export const YOUR_CALL = 'Your call'
export const YES = 'Yes'
export const NO = 'No'

/** The questions with something written for them, in the order asked. */
export function answeredOf(asked: readonly Askable[], answers: ReplyAnswers): Askable[] {
  return asked.filter((one) => (answers[one.text] ?? '').trim() !== '')
}

/** The chips a question offers: Yes and No for a yes-or-no question, and Your call for every one. */
export function chipsOf(asked: Askable): readonly string[] {
  return asked.yesNo ? [YES, NO, YOUR_CALL] : [YOUR_CALL]
}

/** The message the answers make, or null when none is written. `who` is the agent the questions came from. */
export function buildReplyMessage(who: string, asked: readonly Askable[], answers: ReplyAnswers): string | null {
  const segments = answeredOf(asked, answers).flatMap((one): MessageSegment[] => [
    { kind: 'quote', who, text: askedText(one) },
    { kind: 'words', text: (answers[one.text] ?? '').trim() },
  ])
  return segments.length === 0 ? null : buildQuoteMessage(segments)
}

/** The index of the row after `from` that has no answer yet, else the next row; null at the last row. */
export function nextRow(asked: readonly Askable[], answers: ReplyAnswers, from: number): number | null {
  const later = asked.map((one, index) => ({ one, index })).filter(({ index }) => index > from)
  return (later.find(({ one }) => (answers[one.text] ?? '').trim() === '') ?? later[0])?.index ?? null
}

/** What was written for each message's questions, kept while the window is open so closing the tray (Esc) loses nothing. */
const drafts = new Map<string, ReplyAnswers>()

export function replyDraftOf(message: string): ReplyAnswers {
  return drafts.get(message) ?? {}
}

export function keepReplyDraft(message: string, answers: ReplyAnswers): void {
  if (Object.values(answers).every((answer) => answer.trim() === '')) drafts.delete(message)
  else drafts.set(message, answers)
}

export function forgetReplyDraft(message: string): void {
  drafts.delete(message)
}

/** For tests: the drafts belong to the window's lifetime. */
export function forgetReplyDrafts(): void {
  drafts.clear()
}
