import { useEffect, useMemo, useRef, useState } from 'react'

/** How long between one sentence (or list item, or table row) of a reply and the next. */
export const REVEAL_MS = 120

const FENCE = /^\s{0,3}(```|~~~)/
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/
const TABLE_ROW = /^\s*\|/
/** The end of a sentence: its mark, any closing quote or bracket, then a space or the end of the line. */
const SENTENCE_END = /[.!?]["')\]]*(?=\s|$)/g

/**
 * Where each unit of a reply ends, as offsets into `text`: a sentence of prose, a list item, a table row, a whole fenced
 * block of code. A reply is shown one unit at a time, so what appears is always something finished.
 */
export function revealEnds(text: string): number[] {
  const ends: number[] = []
  let offset = 0
  let fence: string | null = null
  let previousItem = false
  for (const line of text.split('\n')) {
    const start = offset
    const lineEnd = start + line.length
    offset = lineEnd + 1
    const marker = FENCE.exec(line)?.[1]
    if (fence !== null) {
      // Code is one unit: it ends at its closing fence.
      if (marker === fence) {
        ends.push(lineEnd)
        fence = null
      }
      continue
    }
    if (marker !== undefined) {
      fence = marker
      previousItem = false
      continue
    }
    if (line.trim() === '') {
      previousItem = false
      continue
    }
    if (LIST_ITEM.test(line) || TABLE_ROW.test(line)) {
      ends.push(lineEnd)
      previousItem = true
      continue
    }
    // A wrapped line of a list item belongs to the item above it.
    if (previousItem && /^\s/.test(line) && ends.length > 0) {
      ends[ends.length - 1] = lineEnd
      continue
    }
    previousItem = false
    let sentenceFrom = 0
    for (const match of line.matchAll(SENTENCE_END)) {
      const end = match.index + match[0].length
      ends.push(start + end)
      sentenceFrom = end
    }
    if (line.slice(sentenceFrom).trim() !== '') ends.push(lineEnd)
  }
  // Code still being written has no closing fence yet: what there is shows as the last unit.
  if (fence !== null) ends.push(text.length)
  return ends
}

/**
 * A reply shown sentence by sentence, one every `REVEAL_MS`. A reply that arrives live starts at its first sentence; one
 * that mounts already complete (an old message, a session you switched to) shows whole, unless `fromStart` says it came
 * live. Text that grows is revealed from where it was. With `enabled` off everything shows at once.
 */
export function useRevealedText(target: string, enabled: boolean, fromStart = false): string {
  const ends = useMemo(() => revealEnds(target), [target])
  const [count, setCount] = useState(fromStart ? Math.min(1, ends.length) : ends.length)
  const total = useRef(ends.length)
  useEffect(() => { total.current = ends.length })
  // The timer runs only while something is waiting to be shown: every reply on screen has one of these, and a
  // conversation at rest should wake nothing.
  const behind = enabled && count < ends.length
  useEffect(() => {
    if (!behind) return
    const timer = window.setInterval(() => { setCount((now) => Math.min(now + 1, total.current)) }, REVEAL_MS)
    return () => { window.clearInterval(timer) }
  }, [behind])
  if (!enabled || count >= ends.length) return target
  return target.slice(0, ends[count - 1] ?? 0)
}
