import { useCallback, useState } from 'react'
import type { PaneView } from './model/chatView'

/**
 * The view each session was switched to by hand, by session id. A session never switched has no
 * entry and shows its agent's default (`effectiveView`). Kept per session, not per pane, so the same
 * session shown elsewhere agrees with itself; a window restart starts from the defaults again.
 *
 * Changing the default (`openIn`) drops every hand choice: "all my chats in the terminal" has to mean
 * the chats already open too, not only the next one.
 */
export function usePaneViews(openIn: PaneView) {
  const [choices, setChoices] = useState<ReadonlyMap<string, PaneView>>(new Map())
  const [seenOpenIn, setSeenOpenIn] = useState(openIn)
  if (seenOpenIn !== openIn) {
    // Adjusting state while rendering is React's way to reset state when a prop changes, with no extra frame of the old views.
    setSeenOpenIn(openIn)
    setChoices(new Map())
  }
  const choose = useCallback((sessionId: string, view: PaneView) => {
    setChoices((current) => new Map(current).set(sessionId, view))
  }, [])
  return { choices, choose }
}
