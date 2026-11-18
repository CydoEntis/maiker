import type { MouseEvent } from 'react'

/** Where a selection is being edited, not read: releasing the mouse there offers nothing. */
const EDITED = 'textarea, input, [contenteditable="true"]'
/** The bar itself: a release on one of its buttons is that button's click, not a new selection. */
export const SELECTION_BAR = '.mx-select-bar'

/** Text selected in the chat, who said it (when the selection began in a message), and where the mouse let go of it, in the window. */
export type PickedText = { readonly text: string; readonly speaker: 'user' | 'agent' | null; readonly x: number; readonly y: number }

/** Whose message a selection began in: the person's bubble, the agent's reply, or neither (a step, a thought). */
function speakerOf(node: Node | null): PickedText['speaker'] {
  const from = node instanceof Element ? node : node?.parentElement ?? null
  if (from?.closest('.mx-msg-user') != null) return 'user'
  return from?.closest('.mx-msg-agent') != null ? 'agent' : null
}

/**
 * What a mouse release in the chat selected, or null when it selected nothing to act on: a plain click, a
 * selection that began outside this chat (left behind elsewhere), or one in the message box. `undefined` means
 * the release was on the selection bar, so what is picked stands.
 */
export function pickedText(event: MouseEvent<HTMLElement>): PickedText | null | undefined {
  const target = event.target
  if (target instanceof Element && target.closest(SELECTION_BAR) !== null) return undefined
  if (target instanceof Element && target.closest(EDITED) !== null) return null
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || !event.currentTarget.contains(selection.anchorNode)) return null
  const text = selection.toString()
  if (text.trim() === '') return null
  return { text, speaker: speakerOf(selection.anchorNode), x: event.clientX, y: event.clientY }
}
