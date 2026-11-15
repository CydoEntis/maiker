import { useEffect, useState } from 'react'

/**
 * Keeps something on screen while it animates out. `shown` stays true for `exitMs` after `open` turns false, with
 * `leaving` true for that time, so the closing animation can play; opening again meanwhile cancels the exit. With
 * reduced motion nothing waits: it goes at once.
 */
export function usePresence(open: boolean, exitMs: number, reduced: boolean): { shown: boolean; leaving: boolean } {
  const [lingering, setLingering] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    setLingering(!open && !reduced)
  }
  useEffect(() => {
    if (!lingering) return
    const timer = window.setTimeout(() => { setLingering(false) }, exitMs)
    return () => { window.clearTimeout(timer) }
  }, [lingering, exitMs])
  return { shown: open || lingering, leaving: !open && lingering }
}
