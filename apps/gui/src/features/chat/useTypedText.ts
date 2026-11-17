import { useEffect, useRef, useState } from 'react'

/** How often the shown text moves on: every screen frame, so words arrive in a steady stream rather than in bursts. */
export const TICK_MS = 16
/** The steady pace in characters a second: quick enough that the window never seems to lag, slow enough to watch the words come in. */
const PACE_PER_SECOND = 300
/** A backlog is shown within about this many seconds: the pace eases up while a lot is waiting and settles back as it clears. */
const CATCH_UP_SECONDS = 1.5
const MS_PER_SECOND = 1000
/** A stop falls back to the last space when one is within this many characters, so words appear whole, not halves of them. */
const WORD_REACH = 24

/**
 * Where the reveal of `text` is one tick after `position`, in characters (a fraction carries over to the next
 * tick). It moves at a steady pace, faster while a lot is waiting, so a long reply read whole from an agent's file
 * eases in over a couple of seconds instead of appearing in a flash or crawling for a minute.
 */
export function nextPosition(text: string, position: number): number {
  const left = text.length - position
  if (left <= 0) return text.length
  const perSecond = Math.max(PACE_PER_SECOND, left / CATCH_UP_SECONDS)
  return Math.min(text.length, position + (perSecond * TICK_MS) / MS_PER_SECOND)
}

/** How many characters show at `position`: up to the last whole word, so a word appears in one piece. */
export function shownAt(text: string, position: number): number {
  if (position >= text.length) return text.length
  const at = Math.floor(position)
  for (let index = at; index > at - WORD_REACH && index > 0; index -= 1) {
    if (/\s/.test(text.charAt(index))) return index
  }
  return at
}

/**
 * The text as if it were being typed. A reply arrives in chunks (the history is read a few times a second while the agent works), and
 * showing each chunk whole makes the text flash in. This shows only what was on screen when the row first
 * appeared, then types toward whatever arrives after it; a row that mounts already full (an old message, a
 * session you switched to) shows all of it at once, unless `fromStart` says it arrived live, which types it from its
 * first letter. With `enabled` off everything shows at once.
 */
export function useTypedText(target: string, enabled: boolean, fromStart = false): string {
  const [position, setPosition] = useState(fromStart ? 0 : target.length)
  const latest = useRef(target)
  useEffect(() => { latest.current = target })
  // The timer runs only while text is waiting to be shown: every agent message on screen has one of these, and a
  // conversation at rest should wake nothing.
  const behind = enabled && position < target.length
  useEffect(() => {
    if (!behind) return
    const timer = window.setInterval(() => {
      setPosition((now) => nextPosition(latest.current, now))
    }, TICK_MS)
    return () => { window.clearInterval(timer) }
  }, [behind])
  if (!enabled) return target
  return target.slice(0, shownAt(target, position))
}
