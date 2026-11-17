import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import { taggedAnswers } from './taggedAnswers'

/** An agent whose sign-in this computer's daemon can run. Gemini is named so the answer can say it has none. */
export type SignInAgent = 'claude' | 'codex' | 'gemini'

/** What a window asks of a sign-in: run it, stop it, or look at where it stands. */
export type SignInRequest = 'start' | 'cancel' | 'read'

/** Why a sign-in did not end signed in. */
export type SignInFailure = 'not-installed' | 'unsupported' | 'could-not-start' | 'timed-out' | 'ended'

/**
 * Where an agent's sign-in stands. A `waiting` one has the agent's own command running: `link` is the web address it
 * printed for the person and `code` the one-time code to enter there, each null until it has printed it. Never a token.
 */
export type SignInState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'waiting'; readonly link: string | null; readonly code: string | null }
  | { readonly kind: 'signed-in' }
  | { readonly kind: 'failed'; readonly failure: SignInFailure }

const FailureSchema = z.enum(['not-installed', 'unsupported', 'could-not-start', 'timed-out', 'ended'])
const AnswerSchema = z.object({
  machine: z.number().int(),
  tag: z.number().int(),
  agent: z.enum(['claude', 'codex', 'gemini']),
  state: z.enum(['idle', 'waiting', 'signed-in', 'failed']),
  link: z.string().nullable(),
  code: z.string().nullable(),
  failure: FailureSchema.nullable(),
})
type Answer = z.infer<typeof AnswerSchema>

const LAST_CONTROL_CODE = 0x20
const DELETE_CODE = 0x7f

/** Whether text has a space, a control character or DEL: nothing an address may carry. */
function hasUnprintable(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code <= LAST_CONTROL_CODE || code === DELETE_CODE) return true
  }
  return false
}

/** A link is shown and opened only when it is a plain `https://` address, whatever the host said. */
export function safeSignInLink(link: string | null): string | null {
  if (link === null || !link.startsWith('https://') || hasUnprintable(link)) return null
  try {
    const url = new URL(link)
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? link : null
  } catch {
    return null
  }
}

/** The host's flat answer as one state; a link that is not a plain https address is dropped. */
export function signInStateOf(answer: Pick<Answer, 'state' | 'link' | 'code' | 'failure'>): SignInState {
  switch (answer.state) {
    case 'idle': return { kind: 'idle' }
    case 'waiting': return { kind: 'waiting', link: safeSignInLink(answer.link), code: answer.code }
    case 'signed-in': return { kind: 'signed-in' }
    case 'failed': return { kind: 'failed', failure: answer.failure ?? 'ended' }
  }
}

/** The daemon answers at once; this covers the connection. */
export const SIGN_IN_ANSWER_MS = 10_000

const ask = taggedAnswers('agent-sign-in', AnswerSchema)

/** Starts, stops or reads an agent's sign-in on this computer, and resolves with where it stands. */
export async function agentSignIn(agent: SignInAgent, request: SignInRequest): Promise<SignInState> {
  const answer = await ask((tag) => invoke('agent_sign_in', { agent, request, tag }), SIGN_IN_ANSWER_MS, 'The service did not answer in time')
  return signInStateOf(answer)
}
