import { createContext, useContext, useEffect, useRef } from 'react'
import type { Askable } from './plainQuestions'

/**
 * What a row of the chat can ask of the chat around it: put words in the message box's quote strip, go to where a
 * quote came from, and open the reply tray on the questions a message asked. Absent where the chat has no message box
 * to reply in (a helper's chat), and the rows then draw none of these controls.
 */
export type ChatActions = {
  /** Adds a quote of what `who` said to the strip above the message box. */
  readonly quote: (who: string, text: string) => void
  /** Scrolls to the message the quoted words came from, above the row `from`, and marks it for a moment. */
  readonly jump: (text: string, from: string) => void
  /** Opens the reply tray for the agent message `row`, on its questions, with the one named by `focus` (or the first) ready. */
  readonly reply: (row: string, who: string, asked: readonly Askable[], focus: string | null) => void
  /** Whether a reply can be sent now: the message box can take a message (it may queue it). */
  readonly canReply: boolean
}

export const ChatActionsContext = createContext<ChatActions | null>(null)

/** The row a jump asked to open, so a folded block that holds the words opens before the view goes there. */
export type Reveal = { readonly key: string | null; readonly nonce: number }
export const RevealContext = createContext<Reveal>({ key: null, nonce: 0 })

/** Opens a folded block when a jump lands on its row. Only a new jump opens it: closing it again by hand is the person's choice. */
export function useRevealOpen(rowKey: string | undefined, open: () => void): void {
  const reveal = useContext(RevealContext)
  const latest = useRef(open)
  useEffect(() => { latest.current = open })
  useEffect(() => {
    if (rowKey !== undefined && reveal.key === rowKey) latest.current()
  }, [reveal, rowKey])
}
