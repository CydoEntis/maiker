import { useEffect, useRef, type RefObject } from 'react'

/** Whether focus is in a place a person types into, which an attachment landing must never take it from. */
function typingElsewhere(active: Element | null): boolean {
  if (active === null || active === document.body) return false
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return true
  return active instanceof HTMLElement && (active.isContentEditable || active.closest('[role="dialog"]') !== null)
}

/**
 * Keeps the message box ready to type in as attachments land. A file dropped on the window, or an image pasted for
 * another machine, arrives after the paste or drop has ended (the host reads the clipboard or sends the picture first),
 * and by then focus can sit on the page itself. When a new attachment lands and focus is not in another field, it goes
 * back to the box with the caret at the end of the text.
 */
export function useKeepTyping(box: RefObject<HTMLTextAreaElement | null>, attachmentCount: number): void {
  const seen = useRef(attachmentCount)
  useEffect(() => {
    const grew = attachmentCount > seen.current
    seen.current = attachmentCount
    const field = box.current
    if (!grew || field === null || field.disabled || document.activeElement === field || typingElsewhere(document.activeElement)) return
    field.focus()
    const end = field.value.length
    field.setSelectionRange(end, end)
  }, [attachmentCount, box])
}
