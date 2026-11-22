import type { MouseEvent } from 'react'

/** A click on a pane's padding still puts the cursor in its terminal. */
export function focusTerminalFromPadding(event: MouseEvent<HTMLDivElement>): void {
  if (event.target !== event.currentTarget) return
  event.preventDefault()
  event.currentTarget.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')?.focus()
}

/** Whether a right-click is the pane's to answer: a text box keeps the system menu, for its paste. */
export function isPaneMenuTarget(target: EventTarget): target is Element {
  return target instanceof Element && target.closest('textarea:not(.xterm-helper-textarea), input') === null
}
