import { useCallback, useEffect, useRef, useState } from 'react'
import { agentSignIn, type SignInAgent, type SignInState } from '@/api/agentSignIn'
import { errorMessage } from '@/lib/error-message'

/** How often a running sign-in is looked at. The daemon answers from memory, so this is cheap. */
export const SIGN_IN_POLL_MS = 1500

/** The sign-in a card shows: which agent, where it stands, and why the daemon could not be asked, if it could not. */
export type SignInView = {
  readonly agent: SignInAgent
  readonly state: SignInState
  readonly problem: string | null
}

/**
 * The one agent sign-in a window shows. `begin` asks the daemon to run the agent's own login (one already running is
 * joined, not doubled) and the card then follows it until it ends; `cancel` stops it. The daemon owns the command, so
 * a card that goes away leaves it to end at its own limit. `onSignedIn` runs once when an agent's own status command
 * says it is signed in.
 */
export function useAgentSignIn(onSignedIn: ((agent: SignInAgent) => void) | undefined) {
  const [view, setView] = useState<SignInView | null>(null)
  const turn = useRef(0)
  const told = useRef(onSignedIn)
  useEffect(() => { told.current = onSignedIn }, [onSignedIn])

  const show = useCallback((agent: SignInAgent, state: SignInState, mine: number) => {
    if (turn.current !== mine) return
    setView({ agent, state, problem: null })
    if (state.kind === 'signed-in') told.current?.(agent)
  }, [])
  const fail = useCallback((agent: SignInAgent, mine: number, error: unknown) => {
    if (turn.current !== mine) return
    setView({ agent, state: { kind: 'idle' }, problem: errorMessage(error, 'The service did not answer') })
  }, [])

  const begin = useCallback((agent: SignInAgent) => {
    turn.current += 1
    const mine = turn.current
    setView({ agent, state: { kind: 'waiting', link: null, code: null }, problem: null })
    agentSignIn(agent, 'start').then((state) => { show(agent, state, mine) }, (error: unknown) => { fail(agent, mine, error) })
  }, [show, fail])

  const cancel = useCallback((agent: SignInAgent) => {
    turn.current += 1
    setView(null)
    agentSignIn(agent, 'cancel').then(() => undefined, (error: unknown) => { setView({ agent, state: { kind: 'idle' }, problem: errorMessage(error, 'Could not cancel the sign-in') }) })
  }, [])

  const close = useCallback(() => {
    turn.current += 1
    setView(null)
  }, [])

  const following = view !== null && view.state.kind === 'waiting' ? view.agent : null
  useEffect(() => {
    if (following === null) return
    const timer = window.setInterval(() => {
      const mine = turn.current
      agentSignIn(following, 'read').then((state) => { show(following, state, mine) }, (error: unknown) => { fail(following, mine, error) })
    }, SIGN_IN_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [following, show, fail])

  return { view, begin, cancel, close }
}
