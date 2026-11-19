import { useState, type ReactNode } from 'react'
import { ArrowUpRight, Lock } from 'lucide-react'
import { HighlightedLine } from '@/components/HighlightedLine'
import { Spinner } from '@/features/workspace/components/glyphs'
import { ElapsedSince } from '@/features/workspace/components/times'
import type { CommandEvent, EditEvent, ToolEvent } from '../chatEvents'
import { isOmitted, redactionNote } from '../redaction'
import { commandHeadMeta, relativePath } from '../stepInfo'
import { commandIntent, foundNothing, shownCommandStatus } from '../commandIntent'
import { toolFacts, type ToolFacts } from '../toolFacts'
import type { WorkStep } from '../workSummary'
import { documentOf } from '../writtenDocument'
import { Fold } from '@/components/ui/fold'
import { StatusIcon } from '@/components/ui/status-icon'
import { useCopied } from '@/lib/useCopied'
import { Block, BlockHead } from './Block'
import { ChangePill, FileBadge, StepRow, type MetaTone } from './cardParts'
import { diffRows, type DiffRow } from './diffRows'
import { DocumentCard } from './DocumentCard'

/**
 * The steps an agent takes, each a row that opens to its detail (handoff items 8 to 15). A fact the
 * daemon's history does not carry is said to be unavailable, never guessed. Colours are theme
 * tokens, and nothing here animates except the spinner of a step that is running.
 */

export const FOLD_LINES = 12

const STOPPED_WORD = 'stopped'
const FAILED_WORD = 'failed'

/** A muted line saying the daemon hid a secret in the text above it; nothing when it hid none. */
function RedactionNote({ texts }: { texts: readonly (string | null)[] }) {
  const note = redactionNote(...texts)
  return note === null ? null : <p className="mx-step-note">{note}</p>
}

/**
 * Whether a step's detail is open, and how to flip it. Folded until the person opens it: a chat of many steps stays short,
 * and its lines say how each one went. A run of steps hands each one its `control`, so only one of them is open at a time.
 * `startOpen` is for a step that stands alone between messages: it is one card, so showing its output or diff costs a few
 * lines, where the same in every step of a long run would fill the screen.
 */
export type OpenControl = { open: boolean; toggle: () => void }
function useOpen(control?: OpenControl, startOpen = false): [boolean, () => void] {
  const [open, setOpen] = useState(startOpen)
  if (control !== undefined) return [control.open, control.toggle]
  return [open, () => { setOpen(!open) }]
}

const looksLikeFile = (target: string) => /^[^\s"'`]+\.[A-Za-z0-9]+$/.test(target)

function ToolTarget({ facts }: { facts: ToolFacts }) {
  switch (facts.kind) {
    case 'file':
    case 'folder':
      return <FileBadge path={facts.kind === 'folder' && !facts.path.endsWith('/') ? `${facts.path}/` : facts.path} />
    case 'pattern':
      return <><code className="mx-code-chip">{facts.pattern}</code>{facts.where !== null && <span className="mx-step-where">in {facts.where}</span>}</>
    case 'address':
      return <span className="mx-step-mono">{facts.address}</span>
    case 'query':
      return <span className="mx-step-quoted">“{facts.query}”</span>
    case 'extension':
    case 'other':
      if (facts.target === null) return null
      return looksLikeFile(facts.target) ? <FileBadge path={facts.target} /> : <span className="mx-step-plain">{facts.target}</span>
  }
}

type ToolStepProps = {
  control?: OpenControl
  event: ToolEvent
  /** The session's folder, so paths are shown relative to it. */
  root?: string | null
  waiting?: boolean
}

/** Any tool with no card of its own: a read, a search, a fetch, an extension's tool. Opens to its input and result. */
export function ToolStep({ event, root = null, waiting = false, control }: ToolStepProps) {
  const [open, toggle] = useOpen(control)
  const facts = toolFacts(event, root)
  const meta = event.status === 'failed' ? FAILED_WORD : event.status === 'interrupted' ? STOPPED_WORD : facts.kind === 'file' ? facts.lines : null
  const result = event.detail.trim()
  return (
    <div className="mx-step">
      <StepRow
        status={event.status}
        verb={facts.kind === 'extension' ? <><span className="mx-step-server">{facts.server}</span>{facts.tool}</> : facts.verb}
        target={<ToolTarget facts={facts} />}
        meta={meta}
        metaTone={event.status === 'failed' ? 'danger' : 'dim'}
        open={open}
        onToggle={toggle}
        waiting={waiting}
      />
      {open && (
        <div className="mx-step-body">
          {event.input === null && result === '' ? <p className="mx-step-absent">The conversation history kept no detail for this step.</p> : (
            <dl className="mx-step-io">
              {event.input !== null && <><dt>input</dt><dd>{event.input}</dd></>}
              <dt>result</dt>
              <dd className={result === '' ? 'is-absent' : undefined}>{result === '' ? 'It returned nothing, or the history did not keep it.' : event.detail}</dd>
            </dl>
          )}
          <RedactionNote texts={[event.input, event.detail]} />
        </div>
      )}
    </div>
  )
}

type CommandStepProps = {
  control?: OpenControl
  event: CommandEvent
  /** On its own in the chat: a card with the command in its head, not one line of an opened run. */
  alone?: boolean
  waiting?: boolean
}

/** Copy on a command, which says Copied for a moment where it was pressed. */
function CopyCommand({ command }: { command: string }) {
  const { copied, copy } = useCopied('Could not copy the command')
  return <button type="button" className="mx-block-action" aria-label="Copy command" onClick={() => { copy(command) }}>{copied ? 'Copied' : 'Copy'}</button>
}

/** The command's output on the well: every line, scrolling inside 320px, and what the daemon hid. */
function CommandOutput({ event }: { event: CommandEvent }) {
  const omitted = isOmitted(event.output)
  const text = event.output === '' || omitted ? '' : event.output.replace(/\n+$/, '')
  return (
    <>
      {omitted && <p className="mx-step-note">The output shows a secret file, so the history does not keep it.</p>}
      {text !== '' && <pre className="mx-block-output">{text}</pre>}
      {text !== '' && <RedactionNote texts={[event.output]} />}
    </>
  )
}

/**
 * A command the agent ran. In a run it is one line, the command's first line and how it ended, as the
 * agent's own terminal shows it; opened it is the whole command and its output. On its own it is a block with the
 * command in its head and, at the right, how it ended ("exit 1 · 2.9s", red when it failed). On its own it starts
 * open, with the last lines of its output; as a row inside a run it starts folded, a failed one too.
 */
export function CommandStep({ event, alone = false, waiting = false, control }: CommandStepProps) {
  const [open, toggle] = useOpen(control, alone)
  // A search that found nothing exits 1 but did not fail; how it shows is the one place that decides it.
  const status = shownCommandStatus(event)
  const intent = commandIntent(event.command)
  const typed = event.command.split('\n')
  const first = typed[0] ?? ''
  const running = status === 'running'
  const failed = status === 'failed'
  const unreported = !running && !failed && status !== 'interrupted' && event.exitCode === null && !foundNothing(event)
  const meta = running ? <ElapsedSince since={event.timing.startedAtMs ?? event.observed.firstSeenAtMs} /> : commandHeadMeta(event)
  const metaTone = running ? 'working' : failed ? 'danger' : 'dim'
  const short = event.command === '' ? 'A command' : typed.length > 1 ? `${first} …` : first
  // A provider that reported no exit code is said to have reported none, to a screen reader, so a finished command never reads as one that passed.
  const unreportedNote = unreported ? <span className="sr-only">exit code not reported</span> : null
  if (alone) {
    return (
      <Block role="group" aria-label={`Command ${first}`} failed={failed} waiting={waiting}>
        <BlockHead
          open={open}
          onToggle={toggle}
          actions={open && event.command !== '' ? <CopyCommand command={event.command} /> : undefined}
        >
          <span className="mx-block-prompt" aria-hidden="true">$</span>
          <code className="mx-block-title">{short}</code>
          {waiting ? <span className="mx-step-meta is-warn">waiting for you ↓</span> : meta !== null && meta !== '' && <span className={`mx-step-meta is-${metaTone}`}>{meta}</span>}
          {unreportedNote}
          <span className="sr-only">{failed ? FAILED_WORD : status === 'interrupted' ? STOPPED_WORD : running ? 'Running' : 'Done'}</span>
        </BlockHead>
        {open && <CommandBody event={event} full={event.command !== short} />}
      </Block>
    )
  }
  return (
    <div role="group" aria-label={`Command ${first}`} className="mx-step">
      <StepRow
        status={status}
        verb={intent?.verb ?? 'Run'}
        target={intent !== null
          ? (intent.target === null ? undefined : <code className="mx-code-chip">{intent.target}</code>)
          : <code className="mx-code-chip">{short}</code>}
        meta={<>{meta}{unreportedNote}</>}
        metaTone={metaTone}
        open={open}
        onToggle={toggle}
        waiting={waiting}
      />
      {open && (
        <div className="mx-step-body">
          <Block>
            <div className="mx-block-head is-open is-static">
              <span className="mx-block-prompt" aria-hidden="true">$</span>
              <span className="mx-block-command">{event.command}</span>
            </div>
            <CommandOutput event={event} />
          </Block>
        </div>
      )}
    </div>
  )
}

/** What opens under a command's head: the whole command when the head cut it short, then its output. */
function CommandBody({ event, full }: { event: CommandEvent; full: boolean }) {
  return (
    <>
      {full && <pre className="mx-block-output is-command">{event.command}</pre>}
      <CommandOutput event={event} />
    </>
  )
}

const LINE_TONE: Record<DiffRow['tone'], string> = { add: ' is-add', remove: ' is-del', context: '', header: '' }

/** One line of a diff: a hunk header in blue, or the line with its old and new number, its sign and the file's syntax colours. */
function DiffLine({ row, path }: { row: DiffRow; path: string }) {
  if (row.tone === 'header') return <div className="mx-diff-hunk">{row.text}</div>
  return (
    <div className={`mx-diff-line${LINE_TONE[row.tone]}`}>
      <span className="mx-diff-num" aria-hidden="true">{row.oldNumber ?? ''}</span>
      <span className="mx-diff-num" aria-hidden="true">{row.newNumber ?? ''}</span>
      <span className="mx-diff-sign" aria-hidden="true">{row.sign}</span>
      <span className="mx-diff-text">{row.text === '' ? ' ' : <HighlightedLine line={row.text} path={path} />}</span>
    </div>
  )
}

function EditMeta({ event }: { event: EditEvent }) {
  if (event.status === 'running') return 'writing…'
  if (event.status === 'failed') return FAILED_WORD
  if (event.status === 'interrupted') return STOPPED_WORD
  if (event.diff.status === 'unavailable') return 'no diff'
  if (event.diff.status === 'omitted') return 'contents hidden'
  const { added, removed } = event.diff
  return (
    <>
      {added > 0 && <span className="mx-step-add">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="mx-step-del">−{removed}</span>}
    </>
  )
}

/** The label a file-change block opens with, where the history says whether the file was new or removed. */
const EDIT_LABEL: Partial<Record<EditEvent['change'], string>> = { add: 'Created', delete: 'Deleted' }
const RUNNING_LIGHT_PX = 12

const EDIT_TONE: Partial<Record<EditEvent['status'], MetaTone>> = { running: 'working', failed: 'danger' }

/** The diff, or why there is none: the history kept none, the file is a secret, or it is too large to show. */
function EditBody({ event, file, sidePanel }: { event: EditEvent; file: string | null; sidePanel: ReactNode }) {
  const [all, setAll] = useState(false)
  if (event.status === 'running') return <p className="mx-step-well is-writing"><span className="mx-step-wellspin" aria-hidden="true"><Spinner /></span>Still writing…</p>
  if (event.diff.status === 'unavailable') return <p className="mx-step-absent">The history didn&apos;t keep this diff.</p>
  if (event.diff.status === 'omitted') return <p className="mx-step-well mx-step-secret"><Lock className="size-3 shrink-0" aria-hidden="true" />Secret file: Maiker doesn&apos;t show its contents.</p>
  if (event.diff.truncated) return <p className="mx-step-well mx-step-toolarge">Diff too large to show here{sidePanel}</p>
  const rows = diffRows(event.diff.hunks)
  if (rows.length === 0) return null
  const shown = all ? rows : rows.slice(0, FOLD_LINES)
  return (
    <>
      <div className="mx-diff">{shown.map((row) => <DiffLine key={row.key} row={row} path={file ?? ''} />)}</div>
      {rows.length > FOLD_LINES && <Fold open={all} onToggle={() => { setAll((current) => !current) }} more={`Show all ${String(rows.length)} lines`} less="Show less" />}
    </>
  )
}

type EditStepProps = {
  control?: OpenControl
  event: EditEvent
  /** The session's folder, so the file is shown relative to it. */
  root: string | null
  /** Opens this file's diff in the Changes panel; absent where there is no repository. */
  onOpen: ((file: string) => void) | null
  /** On its own in the chat: a card with the file in its head and its diff below. */
  alone?: boolean
  waiting?: boolean
}

/** A file change: the file, what happened to it and its counts, opening to the first lines of its diff. */
export function EditStep({ event, root, onOpen, alone = false, waiting = false, control }: EditStepProps) {
  const [open, toggle] = useOpen(control, alone)
  const file = event.file === null ? null : relativePath(event.file, root)
  const name = file ?? 'a file'
  const verb = event.tool === 'Write' ? 'Write' : 'Edit'
  const openFile = onOpen !== null && event.file !== null ? () => { if (event.file !== null) onOpen(event.file) } : null
  const document = documentOf(event)
  if (document !== null && file !== null) return <DocumentCard path={file} document={document} />

  const target = <>{file === null ? <span className="mx-step-plain">a file</span> : <FileBadge path={file} />}<ChangePill change={event.change} /></>
  const metaTone = EDIT_TONE[event.status] ?? 'dim'
  if (alone) {
    const failed = event.status === 'failed'
    return (
      <Block role="group" aria-label={`${verb} ${name}`} failed={failed} waiting={waiting}>
        <BlockHead
          open={open}
          onToggle={toggle}
          title={open ? 'Hide the diff' : 'Show the diff'}
          actions={openFile !== null ? <button type="button" className="mx-block-action" aria-label="Open in side panel" onClick={openFile}>Open</button> : undefined}
        >
          {event.status === 'running' && <span className="mx-block-light" aria-hidden="true"><StatusIcon status="working" size={RUNNING_LIGHT_PX} /></span>}
          <span className="mx-block-label">{EDIT_LABEL[event.change] ?? (event.tool === 'Write' ? 'Wrote' : 'Edited')}</span>
          {file === null ? <span className="mx-step-plain">a file</span> : <FileBadge path={file} />}
          <span className="mx-spacer" />
          {waiting ? <span className="mx-step-meta is-warn">waiting for you ↓</span> : <span className={`mx-step-meta is-${metaTone}`}><EditMeta event={event} /></span>}
        </BlockHead>
        {open && <EditBody event={event} file={file} sidePanel={null} />}
      </Block>
    )
  }
  const sidePanel = openFile !== null && <button type="button" className="mx-ghost-btn" onClick={openFile}>Open in side panel<ArrowUpRight className="size-3" aria-hidden="true" /></button>
  const hasDiff = event.diff.status === 'available' && !event.diff.truncated && event.status !== 'running'
  return (
    <div role="group" aria-label={`${verb} ${name}`} className="mx-step">
      <StepRow status={event.status} verb={verb} target={target} meta={<EditMeta event={event} />} metaTone={metaTone} open={open} onToggle={toggle} waiting={waiting} />
      {open && (
        <div className="mx-step-body">
          {hasDiff ? (
            <Block>
              <div className="mx-block-head is-open is-static">
                <span className="mx-step-path" title={name}>{name}</span>
                {sidePanel}
              </div>
              <EditBody event={event} file={file} sidePanel={null} />
            </Block>
          ) : <EditBody event={event} file={file} sidePanel={sidePanel} />}
        </div>
      )}
    </div>
  )
}

type StepViewProps = {
  /** Where a step's open state lives, when the step is one of a run and only one of them may be open. */
  control?: OpenControl
  event: WorkStep
  root: string | null
  openDiff: ((file: string) => void) | null
  /** A step on its own in the chat, not one line of an opened run: an edit shows its diff from the start. */
  alone?: boolean
  waiting?: boolean
}

/** The row for one step, whatever kind it is. */
export function StepView({ event, root, openDiff, alone = false, waiting = false, control }: StepViewProps) {
  const own = control === undefined ? {} : { control }
  if (event.kind === 'edit') return <EditStep event={event} root={root} onOpen={openDiff} alone={alone} waiting={waiting} {...own} />
  if (event.kind === 'command') return <CommandStep event={event} alone={alone} waiting={waiting} {...own} />
  return <ToolStep event={event} root={root} waiting={waiting} {...own} />
}
