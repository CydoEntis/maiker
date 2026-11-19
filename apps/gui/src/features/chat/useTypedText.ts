import { useEffect, useRef, useState } from 'react'

/** The slowest a reply is typed, in characters a second, so even a short one reads as written and not dropped in. */
export const MIN_CHARS_PER_SECOND = 120
/** The longest a reply takes to be typed once it has arrived, however long it is: the pace rises to fit. */
export const CATCH_UP_SECONDS = 2.5
/** Time between two draws. About 25 a second is smooth for text and light on a web view that paints in software. */
export const TICK_MS = 40
const MS_PER_SECOND = 1000
/** How far back a cut looks for the end of a word before it gives up and cuts mid-word (a long path or address). */
const WORD_LOOKBACK = 40

/** How many characters to add after `seconds`, when `backlog` characters are still to come. */
export function charsDue(backlog: number, seconds: number): number {
  return Math.max(MIN_CHARS_PER_SECOND, backlog / CATCH_UP_SECONDS) * seconds
}

/** Where to cut `text` near `at` so a word is never shown half: the end of the last whole word. */
export function wordEdge(text: string, at: number): number {
  if (at >= text.length) return text.length
  for (let edge = at; edge > Math.max(0, at - WORD_LOOKBACK); edge -= 1) {
    if (/\s/.test(text.charAt(edge))) return edge
  }
  return at
}

/**
 * `target` typed in a few characters at a time, so a reply that arrives whole (an agent that writes its message to
 * the history only when it is finished) still appears the way a streamed one does. Text that grows is typed from
 * where it was, so a reply that really streams is only smoothed. `fromStart` types a reply in from its first word;
 * without it a reply that is already there shows whole. With `enabled` off everything shows at once.
 */
export function useTypedText(target: string, enabled: boolean, fromStart: boolean): string {
  const [start] = useState(() => (fromStart && !document.hidden ? 0 : target.length))
  const [length, setLength] = useState(start)
  const position = useRef(start)
  const latest = useRef(target)
  useEffect(() => { latest.current = target }, [target])
  // The timer runs only while text is waiting to be shown: a conversation at rest wakes nothing.
  const behind = enabled && length < target.length
  useEffect(() => {
    if (!behind) return
    const timer = window.setInterval(() => {
      const text = latest.current
      position.current = Math.min(text.length, position.current + charsDue(text.length - position.current, TICK_MS / MS_PER_SECOND))
      setLength(wordEdge(text, Math.floor(position.current)))
    }, TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [behind])
  return enabled && length < target.length ? target.slice(0, length) : target
}
