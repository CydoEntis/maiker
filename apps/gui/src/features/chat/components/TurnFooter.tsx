import { useContext } from 'react'
import { ChatActionsContext } from '../chatActions'
import { dividerText, doneText, type ChatRow } from '../chatRows'
import { CopyButton } from './CopyButton'

/** The character a turn's footer starts with, by how it ended. */
const MARK = { completed: '✓', failed: '×', interrupted: '■' } as const

type TurnFooterProps = {
  row: Extract<ChatRow, { kind: 'divider' }>
  clock: (ms: number) => string
}

/**
 * The turn's footer (design: "✓ Done · 5 steps" with Copy and Retry at the right). A finished turn says how many
 * steps it took, with how long and when as its tooltip; a failed or stopped one keeps its own words. Copy takes what the
 * agent wrote, and Retry asks the same again, so each shows only where there is something to copy or to send.
 */
export function TurnFooter({ row, clock }: TurnFooterProps) {
  const actions = useContext(ChatActionsContext)
  const { outcome } = row.event
  const detail = dividerText(row.event, clock)
  const words = outcome === 'completed' ? doneText(row.steps) : detail
  const prompt = row.prompt
  return (
    <div className={`mx-chat-row mx-divider${outcome === 'failed' ? ' is-failed' : ''}`} role="separator" aria-label={detail} title={detail}>
      <span className="mx-divider-text"><span aria-hidden="true">{MARK[outcome]} </span>{words}</span>
      <span className="mx-spacer" />
      {row.reply !== '' && <CopyButton text={row.reply} failed="Could not copy the reply" label="Copy reply" />}
      {actions !== null && prompt !== null && <button type="button" className="mx-block-action" aria-label="Retry this turn" onClick={() => { actions.retry(prompt) }}>Retry</button>}
    </div>
  )
}
