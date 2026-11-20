import { useCallback, useEffect, useRef } from 'react'
import { warmChatFeed } from '@/features/chat/useChatFeed'
import { chatAvailability, chatSourceOf } from './model/chatView'
import type { SessionView } from './model/session'

/** How long a pointer rests on a row before its chat is read ahead: a pointer passing over rows reads none. */
export const PREFETCH_DELAY_MS = 100

/**
 * Warms the chat of the sidebar row the pointer or the keyboard is on, so a click paints from memory. `hover(id)` starts
 * the wait, `hover(null)` (the pointer left) cancels it. A terminal or a session with no chat reads nothing.
 */
export function useChatPrefetch(sessionFor: (id: string) => SessionView | undefined): (id: string | null) => void {
  const timer = useRef(0)
  const lookup = useRef(sessionFor)
  useEffect(() => { lookup.current = sessionFor }, [sessionFor])
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  return useCallback((id: string | null) => {
    window.clearTimeout(timer.current)
    if (id === null) return
    timer.current = window.setTimeout(() => {
      const session = lookup.current(id)
      if (session === undefined) return
      const chat = chatAvailability(chatSourceOf(session))
      if (chat.kind !== 'ready') return
      void warmChatFeed(chat.link.conversation, chat.link.generation, chat.agent)
    }, PREFETCH_DELAY_MS)
  }, [])
}
