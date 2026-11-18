import type { ReactNode } from 'react'
import { fileTag } from '@/features/inspect/fileTag'
import { FileBadge as UiFileBadge, Tag } from '@/components/ui/tag'
import { Icon } from '@/features/workspace/components/glyphs'
import { StatusIcon } from '@/components/ui/status-icon'
import type { FileChangeKind, ItemStatus } from '../chatEvents'

/** Small pieces the chat's steps and cards share. Colours are theme tokens. */

/** The running light inside a step's 14px mark. */
const RUNNING_LIGHT_PX = 12

const STATUS_WORD: Record<ItemStatus, string> = { running: 'Running', completed: 'Done', failed: 'Failed', interrupted: 'Stopped' }

/** The characters a finished step is marked with, in the design's 16px mono slot: ✓ quiet, × red, ■ quiet. */
const MARK_CHAR: Record<Exclude<ItemStatus, 'running'>, { char: string; tone: string }> = {
  completed: { char: '✓', tone: 'is-done' },
  failed: { char: '×', tone: 'is-failed' },
  interrupted: { char: '■', tone: 'is-stopped' },
}

/**
 * The mark every step starts with: the running light while it runs, a quiet ✓ when done, a red × when it failed, ■ when
 * it was stopped, and an amber ! while it waits on the person. The row says the state in words, so the mark is hidden
 * from screen readers here.
 */
export function StepGlyph({ status, waiting = false }: { status: ItemStatus; waiting?: boolean }) {
  if (waiting) return <span className="mx-step-glyph is-needs" aria-hidden="true">!</span>
  if (status === 'running') return <span className="mx-step-glyph" aria-hidden="true"><StatusIcon status="working" size={RUNNING_LIGHT_PX} /></span>
  const mark = MARK_CHAR[status]
  return <span className={`mx-step-glyph ${mark.tone}`} aria-hidden="true">{mark.char}</span>
}

export type MetaTone = 'dim' | 'danger' | 'working' | 'warn'

type StepRowProps = {
  status: ItemStatus
  verb: ReactNode
  target?: ReactNode
  meta?: ReactNode
  metaTone?: MetaTone
  /** Whether the step's detail shows; `null` for a step with nothing to open. */
  open: boolean | null
  onToggle?: () => void
  /** A request about this step is waiting for the person. */
  waiting?: boolean
}

/** One step as a 30px line: its mark, a verb, what it acted on, and how it ended at the right. */
export function StepRow({ status, verb, target, meta, metaTone = 'dim', open, onToggle, waiting = false }: StepRowProps) {
  const body = (
    <>
      <StepGlyph status={status} waiting={waiting} />
      <span className="mx-step-verb">{verb}</span>
      {target !== undefined && <span className="mx-step-target">{target}</span>}
      <span className="sr-only">{STATUS_WORD[status]}</span>
      <span className="mx-spacer" />
      {waiting ? <span className="mx-step-meta is-warn">waiting for you ↓</span> : meta !== undefined && meta !== null && <span className={`mx-step-meta is-${metaTone}`}>{meta}</span>}
      {open !== null && <span className={`mx-caret-wrap${open ? ' is-open' : ''}`}><Icon name="caret" /></span>}
    </>
  )
  const className = `mx-step-row${waiting ? ' is-waiting' : ''}`
  return open === null
    ? <div className={className}>{body}</div>
    : <button type="button" className={className} aria-expanded={open} onClick={onToggle}>{body}</button>
}

const FOLDER_ICON_SIZE = 14

type FileBadgeProps = {
  path: string
  line?: number | null
  /** Opens the file; without it the badge is text, as inside a row that is itself a button. */
  onOpen?: (() => void) | undefined
  /** No type tag: in a step row the verb and the file's own name already say what it is, and a tag there is noise. */
  bare?: boolean
}

/** A file in the chat (`FileBadge`): its type tag, or a folder icon for a folder, then its path shortened from the front. */
export function FileBadge({ path, line = null, onOpen, bare = false }: FileBadgeProps) {
  const name = path.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() ?? path
  const tag = bare ? undefined : path.endsWith('/') ? <span className="flex w-[22px] flex-none justify-center text-(--dim)"><Icon name="files" size={FOLDER_ICON_SIZE} /></span> : fileTag(name) ?? undefined
  return <UiFileBadge path={path} tag={tag} line={line} onOpen={onOpen} />
}

const CHANGE_TAG = { add: { word: 'Added', tone: 'done' }, update: { word: 'Modified', tone: 'neutral' }, delete: { word: 'Deleted', tone: 'err' } } as const

/**
 * What happened to a file, where the history says: a Write does not say whether the file was new. After the verb Edit,
 * "Modified" only repeats it, so `edited` leaves it out and only Added or Deleted shows.
 */
export function ChangePill({ change, edited = false }: { change: FileChangeKind; edited?: boolean }) {
  if (change === 'unknown' || (edited && change === 'update')) return null
  return <Tag tone={CHANGE_TAG[change].tone}>{CHANGE_TAG[change].word}</Tag>
}
