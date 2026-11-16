import { useCallback, useEffect, useRef, useState } from 'react'
import { sideAnswer, type SideAsk } from '@/api/daemon'
import { errorMessage } from '@/lib/error-message'

/** The card above the box: what was asked, and Claude Code's answer once it comes. */
export type Aside = {
  readonly title: string
  /** The side question as typed; absent for a command or a note. */
  readonly question?: string
  readonly state:
    | { readonly kind: 'asking' }
    | { readonly kind: 'answered'; readonly text: string }
    | { readonly kind: 'failed'; readonly reason: string }
}

/**
 * The one aside a chat shows. A new ask replaces the card, and an answer that comes back for an ask already replaced or
 * put away is dropped, as is one for a chat that has gone.
 */
export function useAside(conversation: number) {
  const [aside, setAside] = useState<Aside | null>(null)
  const asked = useRef(0)
  useEffect(() => () => { asked.current += 1 }, [conversation])
  const ask = useCallback((title: string, side: SideAsk) => {
    const turn = asked.current + 1
    asked.current = turn
    const question = 'question' in side ? { question: side.question } : {}
    setAside({ title, ...question, state: { kind: 'asking' } })
    sideAnswer(conversation, side).then(
      (reply) => {
        if (asked.current !== turn) return
        setAside({ title, ...question, state: reply.ok ? { kind: 'answered', text: reply.text } : { kind: 'failed', reason: reply.reason } })
      },
      (error: unknown) => {
        if (asked.current !== turn) return
        setAside({ title, ...question, state: { kind: 'failed', reason: errorMessage(error, 'Claude Code could not answer') } })
      },
    )
  }, [conversation])
  const show = useCallback((title: string, text: string) => {
    asked.current += 1
    setAside({ title, state: { kind: 'answered', text } })
  }, [])
  const close = useCallback(() => {
    asked.current += 1
    setAside(null)
  }, [])
  return { aside, ask, show, close }
}
