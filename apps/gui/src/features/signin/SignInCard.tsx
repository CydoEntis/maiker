import { X } from 'lucide-react'
import { openLink } from '@/api/daemon'
import { Button, IconButton } from '@/components/ui/button'
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/card'
import { copyText } from '@/lib/clipboard'
import { errorMessage } from '@/lib/error-message'
import { toast } from '@/lib/toast'
import { failureWords, linkHost, SIGN_IN_LABELS } from './signInWords'
import type { SignInView } from './useAgentSignIn'

/**
 * An agent's sign-in, as a card: the link and the one-time code its own command printed, a Cancel while it waits, and
 * Signed in or the reason it did not end. The window shows what the daemon read from the command's output and nothing
 * more; no password or token passes through it.
 */
export function SignInCard({ view, onCancel, onClose, onRetry }: { view: SignInView; onCancel: () => void; onClose: () => void; onRetry: () => void }) {
  const { agent, state, problem } = view
  const label = SIGN_IN_LABELS[agent]
  const open = (link: string) => {
    openLink(link).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not open the browser')) })
  }
  const copy = (code: string) => {
    copyText(code).then(
      () => { toast.message('Code copied') },
      () => { toast.error('Could not copy the code') },
    )
  }
  const failed = problem !== null || state.kind === 'failed'
  const waiting = problem === null && state.kind === 'waiting'
  const link = state.kind === 'waiting' ? state.link : null
  const code = state.kind === 'waiting' ? state.code : null
  return (
    <Card role="region" aria-label={`Sign in to ${label}`} tone={failed ? 'err' : 'none'} className="mx-aside" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); if (state.kind === 'waiting') onCancel(); else onClose() } }}>
      <CardHead>
        <span className="min-w-0 flex-1 truncate">Sign in to {label}</span>
        <IconButton label="Close" onClick={state.kind === 'waiting' ? onCancel : onClose}><X /></IconButton>
      </CardHead>
      <CardBody className="mx-aside-body">
        {problem !== null && <p role="alert">{problem}</p>}
        {waiting && (
          <>
            {link === null && code === null && <p role="status" className="mx-aside-wait">Starting {label}&apos;s sign-in…</p>}
            {link !== null && <p>Finish signing in in your browser. {label} may already have opened it; if not, use the link ({linkHost(link)}).</p>}
            {code !== null && (
              <p>
                Enter this code there: <code aria-label="One-time code" className="mx-signin-code">{code}</code>
              </p>
            )}
            {agent === 'claude' && link !== null && <p className="mx-aside-wait">If the page ends by showing a code to paste back, sign in from a terminal instead.</p>}
          </>
        )}
        {problem === null && state.kind === 'signed-in' && <p role="status">Signed in to {label}. Sessions already running keep their old sign-in until they are restarted.</p>}
        {problem === null && state.kind === 'failed' && <p role="alert">{failureWords(agent, state.failure)}</p>}
      </CardBody>
      <CardFoot>
        {waiting && link !== null && <Button variant="primary" size="sm" onClick={() => { open(link) }}>Open link</Button>}
        {waiting && code !== null && <Button variant="soft" size="sm" onClick={() => { copy(code) }}>Copy code</Button>}
        {waiting && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
        {(problem !== null || (state.kind === 'failed' && state.failure !== 'unsupported' && state.failure !== 'not-installed')) && <Button variant="soft" size="sm" onClick={onRetry}>Try again</Button>}
        {state.kind !== 'waiting' && <Button variant="ghost" size="sm" onClick={onClose}>{state.kind === 'signed-in' ? 'Done' : 'Close'}</Button>}
      </CardFoot>
    </Card>
  )
}
