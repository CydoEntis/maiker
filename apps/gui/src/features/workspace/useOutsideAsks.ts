import { useEffect, useMemo, useRef } from 'react'
import { answerHelpers } from '@/api/daemon'
import { toast } from '@/lib/toast'
import { useLatest } from '@/lib/useLatest'
import { asksToSay, askToastOf, outsideAsksOf, type AsksSaid, type OutsideAsk } from './model/outsideAsks'
import type { SessionView } from './model/session'

/** The request whose dialog is open, by what names it: never its answer. */
export type OpenAsk = { readonly kind: 'helpers'; readonly sessionId: string } | { readonly kind: 'secret'; readonly sessionId: string; readonly askId: number }

const askToastId = (key: string): string => `ask-${key}`

/** Sends the person's answer to a session's request to start helpers (ADR 0016), and says so if the daemon did not take it. */
export function sendHelpersAnswer(session: Pick<SessionView, 'conversation'>, choice: 'allow' | 'always' | 'no'): void {
  void answerHelpers(session.conversation, choice).catch((error: unknown) => { toast.failed('Could not answer the helper request', error) })
}

/**
 * Says outside its pane what a session asks or has to tell where its pane cannot (`model/outsideAsks.ts`): a helpers
 * request and a secret request are needs-you toasts that stay until the daemon says they are answered, and open their
 * dialog; an agent's session that ended is one toast that offers a new shell in its place. A session whose chat is
 * drawn is left out: its chat says these itself, as cards over its message box.
 */
export function useOutsideAsks({ openAsk, setOpenAsk, sessions, asksOutsidePane, listed, online, showSessionById, restartSession, closeSessionPane }: {
  /** The request whose dialog is open, kept by the window so it counts as a dialog over the panes. */
  openAsk: OpenAsk | null
  setOpenAsk: (ask: OpenAsk | null) => void
  /** Every session a pane can show: the listed ones and the ended ones a pane still holds. */
  sessions: ReadonlyMap<string, SessionView>
  /** Whether the session's pane cannot say these itself: it is the agent's terminal, or a chat that is not drawn yet. */
  asksOutsidePane: (session: SessionView) => boolean
  /** The sessions have been listed once: before that an empty list is not "nothing asks". */
  listed: boolean
  online: boolean
  showSessionById: (sessionId: string) => void
  /** Starts a new shell in an ended session's folder, in its pane. */
  restartSession: (sessionId: string) => void
  closeSessionPane: (sessionId: string) => void
}): void {
  const said = useRef<AsksSaid>(new Map())
  const acts = useLatest(() => ({ showSessionById, restartSession, closeSessionPane }))
  const asks = useMemo(() => [...sessions.values()].filter(asksOutsidePane).flatMap(outsideAsksOf), [sessions, asksOutsidePane])
  useEffect(() => {
    // With no line to the service nothing can be answered, and the list says nothing new.
    if (!listed || !online) return
    const { said: now, raised, gone } = asksToSay(said.current, asks)
    said.current = now
    for (const key of gone) toast.dismiss(askToastId(key))
    for (const ask of raised) {
      const session = sessions.get(ask.sessionId)
      if (session !== undefined) raise(ask, session, acts, setOpenAsk)
    }
  }, [asks, sessions, listed, online, acts, setOpenAsk])
  // A request answered from anywhere (the other app, a second window) takes its dialog with it.
  const openGone = openAsk !== null && !asks.some((ask) => isOpen(ask, openAsk))
  useEffect(() => { if (openGone) setOpenAsk(null) }, [openGone, setOpenAsk])
}

function isOpen(ask: OutsideAsk, open: OpenAsk): boolean {
  if (ask.sessionId !== open.sessionId) return false
  return open.kind === 'helpers' ? ask.kind === 'helpers' : ask.kind === 'secret' && ask.ask.id === open.askId
}

type Acts = () => { showSessionById: (sessionId: string) => void; restartSession: (sessionId: string) => void; closeSessionPane: (sessionId: string) => void }

function raise(ask: OutsideAsk, session: SessionView, acts: Acts, open: (ask: OpenAsk) => void): void {
  const words = askToastOf(ask, session)
  const shared = { id: askToastId(ask.key), context: words.context, description: words.description }
  if (ask.kind === 'ended') {
    toast.warning(words.title, {
      ...shared,
      action: { label: words.action, onClick: () => { acts().restartSession(ask.sessionId) } },
      secondary: { label: 'Close pane', onClick: () => { acts().closeSessionPane(ask.sessionId) } },
    })
    return
  }
  const opened: OpenAsk = ask.kind === 'helpers' ? { kind: 'helpers', sessionId: ask.sessionId } : { kind: 'secret', sessionId: ask.sessionId, askId: ask.ask.id }
  toast.needs(words.title, {
    ...shared,
    // It stays until the daemon says the request is answered: closing the dialog, or the toast, must not lose the one
    // place the request can be answered from.
    closeButton: false,
    action: { label: words.action, onClick: (event) => { event.preventDefault(); open(opened) } },
    secondary: { label: 'Open', onClick: (event) => { event.preventDefault(); acts().showSessionById(ask.sessionId) } },
  })
}
