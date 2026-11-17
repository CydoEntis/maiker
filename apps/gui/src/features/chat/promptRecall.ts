import { parseAttachmentMessage } from './attachmentMessage'
import type { ChatEvent } from './chatEvents'
import { stripRestoreNote } from './editFromHere'

/**
 * ↑ in an empty message box brings back the last message sent in this chat, and ↑ again the one before it, as a
 * shell's history does; ↓ goes forward again and past the newest back to an empty box. It only steps while the box
 * holds exactly the message it brought back: once that is edited it is an ordinary draft and the arrows move the caret.
 */

/** The message the box shows from history: its place among those sent, oldest first, and its text. */
export type Recalled = { readonly index: number; readonly text: string }

export type RecallStep = { readonly draft: string; readonly recalled: Recalled | null }

/**
 * What ↑ (`'older'`) or ↓ (`'newer'`) does to the box, or `null` when the key is the caret's to move: the box holds a
 * draft of its own, the caret is not on the first line (↑) or the last line (↓), or there is nothing further to go to.
 */
export function recallStep(sent: readonly string[], draft: string, recalled: Recalled | null, caret: number, direction: 'older' | 'newer'): RecallStep | null {
  const showing = recalled !== null && recalled.text === draft
  if (direction === 'older') {
    if (draft.slice(0, caret).includes('\n')) return null
    const index = showing ? recalled.index - 1 : draft === '' ? sent.length - 1 : -1
    const text = sent[index]
    return text === undefined ? null : { draft: text, recalled: { index, text } }
  }
  if (!showing || draft.slice(caret).includes('\n')) return null
  const index = recalled.index + 1
  const text = sent[index]
  return text === undefined ? { draft: '', recalled: null } : { draft: text, recalled: { index, text } }
}

/**
 * The messages the person sent in a chat, oldest first, as they wrote them: without the note a restore put in front or the
 * block naming attached files, and a message sent twice in a row listed once.
 */
export function sentTexts(events: readonly ChatEvent[]): string[] {
  const texts: string[] = []
  for (const event of events) {
    if (event.kind !== 'message' || event.role !== 'user') continue
    const written = stripRestoreNote(event.text)
    const text = (parseAttachmentMessage(written)?.text ?? written).trim()
    if (text !== '' && texts.at(-1) !== text) texts.push(text)
  }
  return texts
}
