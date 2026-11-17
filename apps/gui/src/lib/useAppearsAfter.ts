import { useEffect, useState } from 'react'

/**
 * How long a loading state waits before it shows. Most reads answer sooner, and a skeleton or "looking…" line that
 * flashes for a few frames reads as flicker, not as speed.
 */
export const LOADING_SHOWS_AFTER_MS = 150

/** False until `delayMs` after the component mounted, then true: for a loading state that should not flash. */
export function useAppearsAfter(delayMs: number = LOADING_SHOWS_AFTER_MS): boolean {
  const [shown, setShown] = useState(delayMs <= 0)
  useEffect(() => {
    if (delayMs <= 0) return undefined
    const timer = window.setTimeout(() => { setShown(true) }, delayMs)
    return () => { window.clearTimeout(timer) }
  }, [delayMs])
  return shown
}
