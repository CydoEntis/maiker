import { useState } from 'react'
import '../dock.css'
import { parseAttachmentMessage, type SentAttachment } from '../attachmentMessage'
import { AGENT_LABEL } from '../modelName'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import type { QueuedItem } from '../useChatComposer'
import { SentAttachments } from './Attachments'
import { ChevronGlyph, ClockGlyph, EditGlyph, MoveUpGlyph, RemoveGlyph, SendNowGlyph } from './DockIcons'

type Props = {
  agent: ChatAgent
  /** Oldest first: the one that is sent next leads. */
  queue: readonly QueuedItem[]
  /** Two or more queued messages show as the open numbered list instead of the stack. */
  open: boolean
  /** Opens or folds the numbered list; the chat folds the helpers list when this opens (one open at a time). */
  onOpenChange: (open: boolean) => void
  /** A message was opened to be read: the chat folds the helpers list. */
  onRead: () => void
  /** The helpers list is open: only one thing is open at a time, so no message is being read. */
  helpersOpen: boolean
  onRemove: (id: number) => void
  /** Takes the message out of the queue and puts its words and files back in the message box. */
  onEdit: (id: number) => void
  /** Sends a message into the turn that is running; absent while the agent asks something, or where the chat cannot send. */
  onSendNow?: ((id: number) => void) | undefined
  /** Send now goes into the running turn; otherwise the turn is stopped for it. */
  steers?: boolean | undefined
  /** Puts a message one place nearer the front. */
  onMoveUp?: ((id: number) => void) | undefined
  /** Removes every queued message. */
  onClear: () => void
  /** The messages being sent now: their button waits for the daemon's answer. */
  sendingNow?: ReadonlySet<number> | undefined
  /** A quiet line under the queue, for a session that stopped or failed with messages still waiting. */
  note?: string | null | undefined
}

type Message = { id: number; files: readonly SentAttachment[]; label: string }

function fileCount(count: number): string {
  return `${String(count)} attached ${count === 1 ? 'file' : 'files'}`
}

function messageOf(item: QueuedItem): Message {
  const parsed = parseAttachmentMessage(item.text)
  const files = parsed?.files ?? []
  const words = parsed?.text ?? item.text
  return { id: item.id, files, label: words === '' ? fileCount(files.length) : words }
}

type ActionsProps = {
  id: number
  canMoveUp: boolean
  agent: ChatAgent
  onRemove: (id: number) => void
  onEdit: (id: number) => void
  onSendNow: ((id: number) => void) | undefined
  steers: boolean
  onMoveUp: ((id: number) => void) | undefined
  sending: boolean
}

/** What can be done to a message that is open: Edit, Send now, Move up and Remove, as outlined buttons. */
function Actions({ id, canMoveUp, agent, onRemove, onEdit, onSendNow, steers, onMoveUp, sending }: ActionsProps) {
  return (
    <div className="mx-qd-actions">
      <button type="button" className="mx-dock-action" title="Take it back into the message box to change it" onClick={() => { onEdit(id) }}><EditGlyph />Edit</button>
      {onSendNow !== undefined && (
        <button type="button" className="mx-dock-action" disabled={sending} title={steers ? `Send it to ${AGENT_LABEL[agent]} now, into the turn it is running` : `Send it to ${AGENT_LABEL[agent]} now, interrupting the step it is on`} onClick={() => { onSendNow(id) }}><SendNowGlyph />Send now</button>
      )}
      {canMoveUp && onMoveUp !== undefined && <button type="button" className="mx-dock-action" onClick={() => { onMoveUp(id) }}><MoveUpGlyph />Move up</button>}
      <span className="mx-spacer" />
      <button type="button" className="mx-dock-action is-remove" onClick={() => { onRemove(id) }}><RemoveGlyph />Remove</button>
    </div>
  )
}

/**
 * The messages waiting for the agent's turn to end, between the helpers line and the message box. One message is a
 * strip with a clock and "Queued"; two or more are a paper stack showing the first message and how many more; opened,
 * a numbered list with a hint and Clear all. A click on a message reads it whole, and only then do its actions show.
 * Only one message is read at a time; opening the list or the helpers folds the others (`open`, `onRead`).
 */
export function QueuedMessages({ agent, queue, open, onOpenChange, onRead, helpersOpen, onRemove, onEdit, onSendNow, steers = false, onMoveUp, onClear, sendingNow, note }: Props) {
  const [reading, setReading] = useState<number | null>(null)
  const messages = queue.map(messageOf)
  const first = messages[0]
  if (first === undefined) return null
  const many = messages.length > 1
  // The agent's daemon holds every one of them, so they go in whether or not this window stays open.
  const sentWhen = `Sent when ${AGENT_LABEL[agent]} finishes this turn, even if you close the window`
  const listOpen = many && open
  // A message that left the queue, or the stack folded, leaves nothing open to read.
  if (reading !== null && (!messages.some((message) => message.id === reading) || (many && !open) || helpersOpen)) setReading(null)
  const read = (id: number) => {
    if (reading === id) {
      setReading(null)
      return
    }
    setReading(id)
    onRead()
  }
  const actions = (message: Message, index: number) => (
    <Actions id={message.id} canMoveUp={index > 0} agent={agent} onRemove={onRemove} onEdit={onEdit} onSendNow={onSendNow} steers={steers} onMoveUp={onMoveUp} sending={sendingNow?.has(message.id) === true} />
  )
  return (
    <div className="mx-dock-queue" role="region" aria-label="Queued messages">
      {!many && (
        <div className="mx-qd-card" data-fold="1">
          <button type="button" className="mx-qd-single" aria-expanded={reading === first.id} title={reading === first.id ? 'Fold' : 'Read the whole message'} onClick={() => { read(first.id) }}>
            <span className="mx-qd-tag" title={sentWhen}><ClockGlyph />Queued</span>
            <span className={`mx-qd-text${reading === first.id ? ' is-read' : ''}`}>{first.label}</span>
            <span className={`mx-qd-chevron${reading === first.id ? ' is-read' : ''}`}><ChevronGlyph /></span>
          </button>
          {reading === first.id && (
            <div className="mx-qd-open">
              {first.files.length > 0 && <SentAttachments files={first.files} />}
              {actions(first, 0)}
            </div>
          )}
        </div>
      )}
      {many && !listOpen && (
        <div className="mx-qd-stack">
          <span className="mx-qd-paper is-far" aria-hidden="true" data-fold="1" />
          <span className="mx-qd-paper is-near" aria-hidden="true" data-fold="1" />
          <button type="button" className="mx-qd-top" data-fold="1" aria-expanded="false" title="Show all queued messages" onClick={() => { onOpenChange(true) }}>
            <span className="mx-qd-tag" title={sentWhen}><ClockGlyph />{messages.length} queued</span>
            <span className="mx-qd-first">{first.label}</span>
            <span className="mx-qd-more">+{messages.length - 1}</span>
            <ChevronGlyph />
          </button>
        </div>
      )}
      {listOpen && (
        <div className="mx-qd-card" data-fold="1">
          <button type="button" className="mx-qd-head" aria-expanded="true" title="Fold the queue" onClick={() => { onOpenChange(false) }}>
            <span className="mx-qd-tag" title={sentWhen}><ClockGlyph />{messages.length} queued</span>
            <span className="mx-qd-hint">Sent one at a time, in this order, when {AGENT_LABEL[agent]} finishes</span>
            <span className="mx-qd-chevron"><ChevronGlyph /></span>
          </button>
          <ol className="mx-qd-list" aria-label="Queue, in the order they are sent">
            {messages.map((message, index) => {
              const on = reading === message.id
              return (
                <li key={message.id} className={on ? 'is-read' : undefined}>
                  <button type="button" className="mx-qd-item" aria-expanded={on} title={on ? 'Fold' : 'Read the whole message'} onClick={() => { read(message.id) }}>
                    <span className={`mx-qd-n${index === 0 ? ' is-next' : ''}`}>{index + 1}</span>
                    <span className={`mx-qd-text${on ? ' is-read' : ''}${index === 0 || on ? ' is-strong' : ''}`}>{message.label}</span>
                    <span className={`mx-qd-chevron${on ? ' is-read' : ''}`}><ChevronGlyph /></span>
                  </button>
                  {on && (
                    <div className="mx-qd-open is-listed">
                      {message.files.length > 0 && <SentAttachments files={message.files} />}
                      {actions(message, index)}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="mx-qd-foot"><button type="button" className="mx-qd-clear" onClick={onClear}>Clear all</button></div>
        </div>
      )}
      {note !== undefined && note !== null && <p className="mx-dock-note">{note}</p>}
    </div>
  )
}
