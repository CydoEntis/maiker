import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { Askable } from '../plainQuestions'
import { buildReplyMessage, chipsOf, keepReplyDraft, nextRow, answeredOf, replyDraftOf, type ReplyAnswers } from '../quickReply'
import { WaitingCard } from './WaitingCard'

/** The tallest an answer box grows with Shift+Enter, in lines; past it the box scrolls. */
const ANSWER_LINES_MAX = 4
const LINE_PX = 18
/** A key that types a letter, as opposed to one that moves or presses. */
const isTyping = (event: KeyboardEvent) => event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey

type Props = {
  /** The agent the questions came from, as a quote names it. */
  who: string
  asked: readonly Askable[]
  /** The key of the question to start on (its Reply was pressed), or null to start on the first. */
  focus: string | null
  /** The message the questions are in: what is written for them is kept under it, so closing the tray loses nothing. */
  message: string
  /** Why a reply cannot be sent right now (the daemon is offline), or null. */
  blocked: string | null
  /** Sends the built message through the message box's own send; true when it went (or was queued). */
  onSend: (message: string, count: number) => Promise<boolean>
  onClose: () => void
  /** Puts the keys in the first answer box as the tray opens; off only where the tray is shown among others (the gallery). */
  autoFocus?: boolean
}

/** Grows an answer box to its text, up to a few lines. */
function fit(area: HTMLTextAreaElement) {
  area.style.height = 'auto'
  area.style.height = `${String(Math.min(area.scrollHeight, ANSWER_LINES_MAX * LINE_PX))}px`
}

/**
 * Quick replies to the questions an agent asked in plain text (docs/DESIGN.md, "Quick reply"). It opens in the dock
 * slot as the question card does, but is neutral: the agent is not blocked. A row per question with its number, the
 * question, and a one-line answer; Yes, No and Your call answer in one press. The answers go back as one message that
 * quotes each question above its answer. Every key is on the row: Tab and the arrows move between rows, Enter on a row
 * writes in it, Enter in an answer goes on to the next row (and sends from the last), Ctrl+Enter sends, Esc closes and
 * keeps what was written.
 */
export function ReplyTray({ who, asked, focus, message: row, blocked, onSend, onClose, autoFocus = true }: Props) {
  const [answers, setAnswers] = useState<ReplyAnswers>(() => replyDraftOf(row))
  const [sending, setSending] = useState(false)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const fields = useRef<(HTMLTextAreaElement | null)[]>([])
  // The row to write in first, and whether the box has been put there: it is, once, as the tray opens.
  const [start] = useState(() => (focus === null ? 0 : Math.max(0, asked.findIndex((one) => one.key === focus))))
  const started = useRef(false)
  const answered = answeredOf(asked, answers)
  const built = buildReplyMessage(who, asked, answers)
  // Opened from one question's Reply: the others stay one line each, and stay so while the tray is open (nothing resizes on focus).
  const [alone] = useState(() => focus !== null && asked.length > 1)

  const write = (text: string, value: string) => {
    const next = { ...answers, [text]: value }
    keepReplyDraft(row, next)
    setAnswers(next)
  }
  const goToField = (index: number) => {
    const field = fields.current[index]
    field?.focus({ preventScroll: false })
    field?.setSelectionRange(field.value.length, field.value.length)
  }
  const goToRow = (index: number) => { rows.current[Math.max(0, Math.min(asked.length - 1, index))]?.focus() }

  useEffect(() => { fields.current.forEach((field) => { if (field !== null) fit(field) }) }, [answers])

  const send = () => {
    if (built === null || blocked !== null || sending) return
    setSending(true)
    onSend(built, answered.length).then(
      (went) => { setSending(false); if (went) onClose() },
      () => { setSending(false) },
    )
  }
  const onTrayKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      send()
    }
  }
  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, index: number, one: Askable) => {
    // Keys typed in the answer box are its own; only the row itself, when it has the focus, takes single presses.
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return
    const key = event.key.toLowerCase()
    if (event.key === 'ArrowDown') goToRow(index + 1)
    else if (event.key === 'ArrowUp') goToRow(index - 1)
    else if (event.key === 'Enter' || event.key === 'ArrowRight') goToField(index)
    else if (one.yesNo && (key === 'y' || key === 'n')) {
      write(one.text, key === 'y' ? 'Yes' : 'No')
      goToRow(index + 1)
    } else if (/^[1-9]$/.test(event.key)) goToRow(Number(event.key) - 1)
    else if (isTyping(event)) { goToField(index); return }
    else return
    event.preventDefault()
  }
  const onFieldKey = (event: KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    if (event.nativeEvent.isComposing) return
    const single = !event.currentTarget.value.includes('\n')
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      const next = nextRow(asked, answers, index)
      if (next === null) send()
      else goToField(next)
    } else if (single && !event.shiftKey && event.key === 'ArrowDown' && index < asked.length - 1) {
      event.preventDefault()
      goToField(index + 1)
    } else if (single && !event.shiftKey && event.key === 'ArrowUp' && index > 0) {
      event.preventDefault()
      goToField(index - 1)
    }
  }
  const total = asked.length
  const title = total === 1 ? 'Reply to the question' : `Reply to ${String(total)} questions`
  const sendLabel = total === 1 ? 'Send reply' : `Send replies (${String(answered.length)} of ${String(total)})`

  return (
    <WaitingCard
      tone="neutral"
      label={title}
      title={title}
      aside={who}
      flush
      foot={(
        <>
          <Button variant="ghost" className="mx-reply-send" disabled={built === null || blocked !== null || sending} title="Ctrl+Enter sends" onClick={send}>{sendLabel}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <span className="mx-spacer" />
          <span className="mx-waiting-note">{blocked ?? 'Unanswered questions are left out'}</span>
        </>
      )}
    >
      <div className="mx-reply-rows" onKeyDown={onTrayKey}>
        {asked.map((one, index) => {
          const value = answers[one.text] ?? ''
          return (
            <div
              key={one.key}
              ref={(element) => { rows.current[index] = element }}
              role="group"
              tabIndex={0}
              className={`mx-reply-row${alone && one.key !== focus ? ' is-compact' : ''}${value.trim() === '' ? '' : ' is-answered'}`}
              aria-label={`${one.label === '' ? `Question ${String(index + 1)}.` : `Question ${one.label}`} ${one.text}`}
              onKeyDown={(event) => { onRowKey(event, index, one) }}
            >
              <span className="mx-reply-label" aria-hidden="true">{one.label === '' ? `${String(index + 1)}.` : one.label}</span>
              <p className="mx-reply-q" dir="auto" title={one.text}>{one.text}</p>
              <div className="mx-reply-a">
                <textarea
                  ref={(element) => {
                    fields.current[index] = element
                    if (element !== null && autoFocus && index === start && !started.current) {
                      started.current = true
                      element.focus()
                    }
                  }}
                  rows={1}
                  tabIndex={-1}
                  dir="auto"
                  spellCheck
                  className="mx-reply-input"
                  aria-label={`Your answer to: ${one.text}`}
                  placeholder="Your answer"
                  value={value}
                  onChange={(event) => { write(one.text, event.target.value) }}
                  onKeyDown={(event) => { onFieldKey(event, index) }}
                />
                <span className="mx-reply-chips">
                  {chipsOf(one).map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      tabIndex={-1}
                      className="mx-reply-chip"
                      aria-pressed={value === chip}
                      onClick={() => {
                        write(one.text, value === chip ? '' : chip)
                        const next = nextRow(asked, { ...answers, [one.text]: chip }, index)
                        if (value !== chip && next !== null) goToField(next)
                      }}
                    >{chip}</button>
                  ))}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{answered.length} of {total} answered</p>
    </WaitingCard>
  )
}
