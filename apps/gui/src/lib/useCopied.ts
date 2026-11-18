import { useEffect, useRef, useState } from 'react'
import { copyText } from './clipboard'
import { toast } from './toast'

/** How long a copy button says it copied. */
export const COPIED_MS = 1500

/**
 * A copy button's own feedback: `copied` is true for a moment after a copy, so the button shows a check or "Copied"
 * where the person is looking, instead of a toast across the window for something that worked. A copy that failed
 * still says so in a toast, with `failed` as its words.
 */
export function useCopied(failed: string): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])
  const copy = (text: string) => {
    copyText(text).then(
      () => {
        setCopied(true)
        if (timer.current !== null) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => { setCopied(false) }, COPIED_MS)
      },
      () => { toast.error(failed) },
    )
  }
  return { copied, copy }
}
