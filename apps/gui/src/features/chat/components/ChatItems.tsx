import { memo, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { Quote as QuoteIcon } from 'lucide-react'
import { Icon } from '@/features/workspace/components/glyphs'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import type { TurnSpan } from '@/features/inspect/turnRange'
import { paragraphsOf, splitLead, streamingParagraphs, type ChatRow } from '../chatRows'
import type { ItemStatus } from '../chatEvents'
import { KnownRowsContext } from '../knownRows'
import { isWaitingStep } from '../stepInfo'
import { useTypedText } from '../useTypedText'
import { WorkingMark } from './WorkingMark'
import { LiveBox } from './LiveBox'
import { ReducedMotionContext } from '@/features/workspace/components/motion'
import { parseAttachmentMessage } from '../attachmentMessage'
import { parseQuoteMessage } from '../quoteMessage'
import { askablesOf, type Askable } from '../plainQuestions'
import { ChatActionsContext } from '../chatActions'
import { agentName } from '../commandCards'
import { QuoteStub } from './QuoteStubs'
import { withoutPasteTags } from '../messagePreview'
import { AgentsCard } from './AgentsCard'
import { SentAttachments } from './Attachments'
import { ApprovalCard, type ApprovalActions } from './ApprovalCard'
import { compactionOf, type Compaction } from '../compaction'
import { ContextSummary } from './ContextSummary'
import { InlineMarkdown, Markdown } from './Markdown'
import { PlanCard } from './PlanCard'
import { StepView } from './StepCards'
import { ThoughtRow } from './ThoughtRow'
import { TurnFooter } from './TurnFooter'
import { WorkCard } from './WorkCard'
import { MessageMenu } from './MessageMenu'
import { stripRestoreNote, type EditFromHere } from '../editFromHere'

/**
 * The rows of the chat (v18 C.1). Every fact the daemon's history carries is shown, and one it does
 * not carry is said to be unavailable, never guessed. Colours are theme tokens; only a step that is
 * running animates, so a long conversation costs nothing at rest.
 */

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** One row of the 760px column; rows sit 14px apart. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-chat-row">{children}</div>
}

/** What the rows need from the window besides the row itself. */
export type ChatItemContext = {
  agent: ChatAgent
  workingSince: number | null
  approval: ApprovalActions | null
  /** The session's folder, so file names are shown relative to it. */
  root: string | null
  /**
   * Opens a file's diff in the Changes panel; `null` where there is none. A turn's changes row passes the turn too
   * (null when its times are unknown), so the panel shows what that turn changed.
   */
  openDiff: ((file: string, turn?: TurnSpan | null) => void) | null
  goToStep: ((key: string) => void) | null
  /** The id of the tool step a pending request is about, so that step says it is waiting. */
  waitingStep: string | null
  /** Edit from here on a message the person sent; absent where the chat offers none. */
  editFromHere?: EditFromHere | null
}

type RowProps = { row: ChatRow } & ChatItemContext

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * Whether a row would draw the same. Rows are rebuilt on every update, so identity cannot tell;
 * the events beneath keep their identity until they change, and that is what is compared.
 */
function sameRow(a: ChatRow, b: ChatRow): boolean {
  if (a.kind !== b.kind || a.key !== b.key) return false
  switch (a.kind) {
    case 'agent':
      return b.kind === 'agent' && a.status === b.status && sameStrings(a.paragraphs, b.paragraphs)
    case 'agents':
      return b.kind === 'agents' && a.events.length === b.events.length && a.events.every((event, index) => event === b.events[index])
    case 'changes':
      return b.kind === 'changes' && sameStrings(a.files, b.files) && a.lines?.added === b.lines?.added && a.lines?.removed === b.lines?.removed && a.turn?.startedAtMs === b.turn?.startedAtMs && a.turn?.endedAtMs === b.turn?.endedAtMs
    case 'thought':
      return b.kind === 'thought' && sameStrings(a.texts, b.texts)
    case 'work':
      return b.kind === 'work' && a.events.length === b.events.length && a.events.every((event, index) => event === b.events[index])
    case 'approval':
      return b.kind === 'approval' && a.event === b.event && a.step?.key === b.step?.key && a.step?.label === b.step?.label
    case 'working':
      return b.kind === 'working' && a.phrase === b.phrase && a.placeholder === b.placeholder
    case 'echo':
      return b.kind === 'echo' && a.text === b.text
    case 'report':
      return b.kind === 'report' && a.text === b.text
    case 'divider':
      return b.kind === 'divider' && a.event === b.event && a.steps === b.steps && a.reply === b.reply && a.prompt === b.prompt
    case 'user':
    case 'step':
    case 'summary':
      return 'event' in b && a.event === b.event
  }
}

function sameProps(a: RowProps, b: RowProps): boolean {
  return a.agent === b.agent && a.workingSince === b.workingSince && a.approval === b.approval && a.root === b.root && a.openDiff === b.openDiff && a.goToStep === b.goToStep && a.waitingStep === b.waitingStep && a.editFromHere === b.editFromHere && sameRow(a.row, b.row)
}

/**
 * An agent's reply. One that arrives while the person is looking is typed in a few words at a time (`useTypedText`), so
 * a reply the history brings whole still appears the way a streamed one does; one that was already there shows whole. What
 * shows is read in its finished form (`streamingParagraphs`), so a half-written mark or table does not flash; each block is
 * parsed and drawn again only when its own text changed (`Markdown`).
 */
function AgentMessage({ rowKey, paragraphs, status, agent }: { rowKey: string; paragraphs: readonly string[]; status: ItemStatus; agent: ChatAgent }) {
  const actions = useContext(ChatActionsContext)
  const reduced = useContext(ReducedMotionContext)
  const known = useContext(KnownRowsContext)
  const running = status === 'running'
  const finished = running ? streamingParagraphs(paragraphs) : paragraphs
  const target = finished.join('\n\n')
  const typed = useTypedText(target, !reduced, known !== null && !known.has(rowKey))
  // Typed once: drawn again, this row shows whole.
  useEffect(() => { known?.add(rowKey) }, [known, rowKey])
  const shown = typed === target ? finished : streamingParagraphs(paragraphsOf(typed))
  const { lead, rest } = splitLead(shown)
  const empty = shown.join('').trim() === ''
  // Questions asked in plain words are offered a Reply only once the message is whole: never while it is still written or typed in.
  const whole = !running && typed === target && actions !== null && actions.canReply
  const restText = rest.join('\n\n')
  const leadAsked = useMemo(() => (whole ? askablesOf(lead).map((one): Askable => ({ ...one, key: `lead.${one.key}` })) : []), [whole, lead])
  const restAsked = useMemo(() => (whole ? askablesOf(restText) : []), [whole, restText])
  const asked = useMemo(() => [...leadAsked, ...restAsked], [leadAsked, restAsked])
  const who = agentName(agent)
  const reply = (focus: string | null) => { actions?.reply(rowKey, who, asked, focus) }
  const leadOne = leadAsked[0]
  return (
    <div className="mx-msg-agent">
      {lead !== '' && (leadOne === undefined
        ? <p className="mx-msg-lead"><InlineMarkdown text={lead} /></p>
        : <p className="mx-msg-lead has-reply"><InlineMarkdown text={lead} /><ReplyAction label={leadOne.label} onReply={() => { reply(leadOne.key) }} /></p>)}
      {rest.length > 0 && <Markdown text={restText} className="mx-msg-rest" {...(restAsked.length === 0 ? {} : { asked: restAsked, onReply: (one: Askable) => { reply(one.key) } })} />}
      {empty && <p className="mx-msg-empty">{running ? 'Writing…' : 'The agent finished without writing a reply.'}</p>}
      {asked.length > 1 && (
        <p className="mx-ask-foot">
          <button type="button" className="mx-ask-all" onClick={() => { reply(null) }}>{asked.length} questions<span aria-hidden="true"> · </span><span className="mx-ask-all-do">Reply to each</span></button>
        </p>
      )}
      {whole && !empty && (
        <button type="button" className="mx-msg-quote" aria-label="Quote this message" title="Quote this message in your reply" onClick={() => { actions.quote(who, quoteTextOf(paragraphs)) }}><QuoteIcon size={13} aria-hidden="true" /></button>
      )}
    </div>
  )
}

/** What quoting a whole message takes: its paragraphs, in order. The strip and the message cut it to fit. */
function quoteTextOf(paragraphs: readonly string[]): string {
  return paragraphs.join('\n\n')
}

/** A quiet Reply at the right edge of a question. Its room is always kept, so showing it moves nothing. */
export function ReplyAction({ label, onReply }: { label: string; onReply: () => void }) {
  return <button type="button" className="mx-ask-reply" aria-label={label === '' ? 'Reply to this question' : `Reply to question ${label}`} onClick={onReply}>Reply</button>
}

/** Quotes what the person said in the next message: hidden until the message is hovered or the button has the keys, its room always kept. */
function QuoteOwn({ text }: { text: string }) {
  const actions = useContext(ChatActionsContext)
  const said = wordsSaid(text)
  if (actions === null || said === '') return null
  return <button type="button" className="mx-msg-quote is-own" aria-label="Quote this message" title="Quote this message in your reply" onClick={() => { actions.quote('You', said) }}><QuoteIcon size={13} aria-hidden="true" /></button>
}

/** What a sent message says in its own words: without its attached files, the quotes it carried, or the notes for the agent. */
function wordsSaid(raw: string): string {
  const text = withoutPasteTags(stripRestoreNote(raw)).trim()
  const words = parseAttachmentMessage(text)?.text ?? text
  const segments = parseQuoteMessage(words)
  return (segments === null ? words : segments.flatMap((segment) => (segment.kind === 'words' ? [segment.text] : [])).join('\n\n')).trim()
}

/**
 * What the person said: its text, and its attached files as chips. A message on its way is drawn the
 * same as one the history holds, so the files never show as the paths that carry them.
 */
function SaidText({ text: sent, rowKey }: { text: string; rowKey: string }) {
  // The note a restore put in front is for the agent; the person sees what they wrote. Blank lines around it (Claude
  // Code stores a pasted message with two in front) would only draw an empty band in the bubble.
  const text = withoutPasteTags(stripRestoreNote(sent)).replace(/^\s*\n/, '').trimEnd()
  const attached = parseAttachmentMessage(text)
  const words = attached === null ? text : attached.text.trim()
  const segments = parseQuoteMessage(words)
  const bubble = segments === null
    ? (words === '' ? null : <p className="mx-bubble">{words}</p>)
    : (
      // What it quotes sits above each part of what was said, in one bubble.
      <div className="mx-bubble has-quotes">
        {segments.map((segment, index) => (segment.kind === 'quote'
          ? <QuoteStub key={index} quote={segment} from={rowKey} />
          : <p key={index} className="mx-said-words">{segment.text}</p>))}
      </div>
    )
  // Attachments sit above the bubble, as they were added before the text was sent.
  return (
    <>
      {attached !== null && <SentAttachments files={attached.files} />}
      {bubble}
    </>
  )
}

/** One row of the list. Memoised: a streamed update re-renders only the rows whose events changed. */
export const ChatItem = memo(function ChatItem({ row, agent, workingSince, approval, root, openDiff, goToStep, waitingStep, editFromHere = null }: RowProps) {
  const canQuote = useContext(ChatActionsContext) !== null
  switch (row.kind) {
    case 'user': {
      // Only the daemon's own time: when the window first saw a message is not when it was sent.
      const sentAt = row.event.timing.startedAtMs ?? row.event.timing.completedAtMs
      return (
        <Frame>
          <div className="mx-msg-user">
            <SaidText text={row.event.text} rowKey={row.key} />
            {(sentAt !== null || editFromHere !== null || canQuote) && (
              <div className="mx-msg-meta">
                {sentAt !== null && <time className="mx-msg-time" dateTime={new Date(sentAt).toISOString()}>{clock(sentAt)}</time>}
                {canQuote && <QuoteOwn text={row.event.text} />}
                {editFromHere !== null && <MessageMenu message={row.event} editFromHere={editFromHere} />}
              </div>
            )}
          </div>
        </Frame>
      )
    }
    case 'report': {
      const compaction = compactionOf(row.text)
      if (compaction !== null) return <Frame><CompactedLine compaction={compaction} text={row.text} /></Frame>
      return <Frame><p className="mx-report" title={row.text}><span className="mx-report-arrow" aria-hidden="true">↳</span><span className="mx-report-text"><InlineMarkdown text={row.text} /></span></p></Frame>
    }
    case 'echo':
      return (
        <Frame>
          <div className="mx-msg-user is-echo" aria-label="Sending">
            <SaidText text={row.text} rowKey={row.key} />
            <div className="mx-msg-meta"><WorkingMark agent={agent} />Sending…</div>
          </div>
        </Frame>
      )
    case 'agent':
      return <Frame><AgentMessage rowKey={row.key} paragraphs={row.paragraphs} status={row.status} agent={agent} /></Frame>
    case 'step':
      return <Frame>{row.event.kind === 'todo' ? <PlanCard event={row.event} /> : <StepView event={row.event} root={root} openDiff={openDiff} alone waiting={isWaitingStep(waitingStep, row.event.id)} />}</Frame>
    case 'thought':
      return <Frame><ThoughtRow texts={row.texts} /></Frame>
    case 'summary':
      return <Frame><ContextSummary text={row.event.text} /></Frame>
    case 'work':
      return <Frame><WorkCard steps={row.events} root={root} openDiff={openDiff} waitingStep={waitingStep} rowKey={row.key} /></Frame>
    case 'agents':
      return <Frame><AgentsCard agents={row.events} rowKey={row.key} /></Frame>
    case 'approval':
      return <Frame><ApprovalCard event={row.event} actions={approval} step={row.step} onGoToStep={goToStep} /></Frame>
    case 'divider':
      return <TurnFooter row={row} clock={clock} />
    case 'changes': {
      // The turn's changed-files bar (design: ChangedFilesBar): how many files and lines, and Review, which opens what this
      // turn changed in the side panel. The files themselves are listed there.
      const count = row.files.length
      const first = row.files[0]
      return (
        <Frame>
          <div className="mx-block mx-changed" role="group" aria-label={`${String(count)} changed ${count === 1 ? 'file' : 'files'}`}>
            <div className="mx-block-head is-static">
              <Icon name="toolEdit" />
              <span className="mx-changed-title">{count} changed {count === 1 ? 'file' : 'files'}</span>
              {row.lines !== null && <span className="mx-changed-counts"><span className="is-add">+{row.lines.added}</span><span className="is-remove">−{row.lines.removed}</span></span>}
              <span className="mx-spacer" />
              {openDiff !== null && first !== undefined && <button type="button" className="mx-changed-review" title="Show what this turn changed in the side panel" onClick={() => { openDiff(first, row.turn) }}>Review</button>}
            </div>
          </div>
        </Frame>
      )
    }
    case 'working':
      // Token counts are not shown: the daemon's history carries none, and an estimate would be invented.
      return <Frame><LiveBox phrase={row.phrase} since={workingSince} placeholder={row.placeholder} /></Frame>
  }
}, sameProps)

/** Where the person compacted the conversation: a marked line across the chat, with the hooks that ran named, not printed. */
function CompactedLine({ compaction, text }: { compaction: Compaction; text: string }) {
  const hooks = compaction.hooks.length === 0 ? null : `${compaction.hooks.join(', ')} ${compaction.hooks.length === 1 ? 'hook' : 'hooks'} ran`
  return (
    <div className="mx-divider mx-compacted" title={text}>
      <span className="mx-divider-line" />
      <span className="mx-compacted-pill"><Icon name="collapse" />Conversation compacted{hooks !== null && <span className="mx-compacted-hooks">· {hooks}</span>}</span>
      <span className="mx-divider-line" />
    </div>
  )
}
