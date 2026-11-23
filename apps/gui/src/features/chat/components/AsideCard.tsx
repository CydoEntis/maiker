import { X } from 'lucide-react'
import { useCopied } from '@/lib/useCopied'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/card'
import type { Aside } from '../useAside'
import { Markdown } from './Markdown'

/**
 * Claude Code's answer beside the conversation, above the message box: a side question or a command that only
 * reports. It is never part of the conversation, so it goes when closed; a side question can still be asked in the
 * conversation itself.
 */
export function AsideCard({ aside, onClose, onAskInConversation }: { aside: Aside; onClose: () => void; onAskInConversation: (question: string) => void }) {
  const { state, question } = aside
  const { copied, copy } = useCopied('Could not copy the answer')
  return (
    <Card role="region" aria-label={aside.title} tone={state.kind === 'failed' ? 'err' : 'none'} className={`mx-aside${question === undefined ? '' : ' is-side'}`} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <CardHead className="mx-aside-head">
        {question !== undefined && <span className="mx-aside-badge" aria-hidden="true">btw</span>}
        <span className="min-w-0 flex-1 truncate">{aside.title}</span>
        <span className="mx-aside-note">Not added to the conversation</span>
        <IconButton label="Close" onClick={onClose}><X /></IconButton>
      </CardHead>
      <CardBody className="mx-aside-body">
        {question !== undefined && <p className="mx-aside-question">{question}</p>}
        {state.kind === 'asking' && <p role="status" className="mx-aside-wait">Asking Claude…</p>}
        {state.kind === 'answered' && <Markdown text={state.text} />}
        {state.kind === 'failed' && <p role="alert">{state.reason}</p>}
      </CardBody>
      {(state.kind === 'answered' || (question !== undefined && state.kind !== 'asking')) && (
        <CardFoot className="mx-aside-foot">
          {state.kind === 'answered' && <Button variant="ghost" size="sm" onClick={() => { copy(state.text) }}>{copied ? 'Copied' : 'Copy'}</Button>}
          {question !== undefined && <Button variant="ghost" size="sm" onClick={() => { onAskInConversation(question) }}>Ask in the conversation</Button>}
        </CardFoot>
      )}
    </Card>
  )
}
