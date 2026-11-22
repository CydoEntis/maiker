import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Progress } from '@/components/ui/progress'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { StatusIcon } from '@/components/ui/status-icon'
import { Icon } from '@/features/workspace/components/glyphs'
import { folderOfRow, hintsOf, keyAction, moveIndex, type Level, type PaletteMode, type Row, type RowAction, type RowIcon } from './openPalette'

/** The longest text the field takes: the host's limit for a path, which is the longest thing typed here. */
const MOST_FIELD_CHARS = 4096

/** The design's row icons that the window's icon set does not hold, each one stroked path on a 24 grid. */
const ROW_PATHS: Readonly<Partial<Record<RowIcon, string>>> = {
  folder: 'M3 6h7l2 3h9v10H3z',
  repo: 'M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 6',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  github: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V6M6 11l6-6 6 6',
}
const ROW_ICON_PX = 17

function RowGlyph({ icon }: { icon: RowIcon }) {
  const path = ROW_PATHS[icon]
  if (path === undefined) return <Icon name={icon === 'monitor' ? 'monitor' : icon === 'server' ? 'server' : 'copy'} size={ROW_ICON_PX} />
  return <svg width={ROW_ICON_PX} height={ROW_ICON_PX} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={path} /></svg>
}

/**
 * What the list says in place of, or above, its rows: a wait, a note, a machine that is not there or a refusal. An
 * `action` is its one button, which Enter presses when the list has no row to choose.
 */
export type Status = {
  tone: 'working' | 'plain' | 'offline' | 'bad'
  title: string
  detail: string | null
  /** A one-time code to read off, shown large. */
  code?: string | undefined
  /** A bar under the words: a percent, or null when how long it takes is not known. */
  percent?: number | null | undefined
  action?: { label: string; run: () => void } | undefined
}

type Props = {
  level: Level['kind']
  mode: PaletteMode
  /** What the field is for: its placeholder and its name, and the list's name. */
  placeholder: string
  query: string
  onQuery: (text: string) => void
  /** Goes back a level; null on the first level, which shows a search mark instead. */
  onBack: (() => void) | null
  /** The machine and folder before the field, in the folder browser. */
  crumb?: { machine: string; remote: boolean; path: string; full: string } | undefined
  /** A control after the field: the machine a clone goes onto, the owner of the repositories listed. */
  aside?: ReactNode
  rows: readonly Row[]
  status: Status | null
  /** A line under the rows: that a long list was cut. */
  more?: string | null | undefined
  /** The foot's buttons, after the key hints. */
  actions?: ReactNode
  /** While true nothing can be chosen: a clone or an open is running. */
  locked: boolean
  onAct: (action: RowAction) => void
  /** Goes into a folder (Right arrow, Tab). */
  onInto?: ((path: string) => void) | undefined
  /** Backspace on an empty field in the folder browser. */
  onUp?: (() => void) | undefined
  /** Ctrl+Enter in the folder browser. */
  onOpenHere?: (() => void) | undefined
}

function StatusBlock({ status }: { status: Status }) {
  const tone = status.tone === 'offline' ? ' is-offline' : status.tone === 'bad' ? ' is-bad' : ''
  return (
    <div className={`mx-op-status${tone}`} role={status.tone === 'bad' || status.tone === 'offline' ? 'alert' : 'status'}>
      {status.tone === 'working' && <StatusIcon status="working" size={15} />}
      <span className="mx-op-status-text">
        <b>{status.title}</b>
        {status.detail !== null && <span>{status.detail}</span>}
        {status.code !== undefined && <span className="mx-op-code" aria-label="One-time code">{status.code}</span>}
        {status.percent !== undefined && <Progress label={status.title} {...(status.percent === null ? {} : { value: status.percent })} />}
      </span>
      {status.action !== undefined && <button type="button" className="mx-op-status-button" onClick={status.action.run}>{status.action.label}</button>}
    </div>
  )
}

/**
 * One level of the palette: the field row, the list and the foot. The focus stays in the field; the arrows move the
 * highlighted row and the keys do what `keyAction` says, so every level answers the same keys.
 */
export function PaletteBody({ level, mode, placeholder, query, onQuery, onBack, crumb, aside, rows, status, more, actions, locked, onAct, onInto, onUp, onOpenHere }: Props) {
  // The row highlighted, kept with the text it was chosen under: what is typed next starts at the first row again.
  const [picked, setPicked] = useState<{ under: string; id: string | null }>({ under: query, id: null })
  const index = picked.under === query ? Math.max(0, rows.findIndex((row) => row.id === picked.id)) : 0
  const pick = (at: number) => { setPicked({ under: query, id: rows[at]?.id ?? null }) }
  const current = rows[index] ?? null
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const id = useId()
  const optionId = (at: number) => `${id}-row-${String(at)}`

  useEffect(() => { field.current?.focus() }, [level])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, current?.id])

  const activate = () => {
    if (current !== null) onAct(current.action)
    else status?.action?.run()
  }
  const onKeyDown = (event: KeyboardEvent) => {
    // A button in the palette keeps its own Enter and Space; every other key is the field's.
    if (event.nativeEvent.isComposing || (event.target instanceof HTMLButtonElement && event.key !== 'Escape')) return
    const caretAtEnd = field.current === null || field.current.selectionStart === field.current.value.length
    const action = keyAction({ key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey }, { level, empty: query === '', caretAtEnd, row: current })
    if (action === null) return
    if (action === 'close') {
      // The dialog closes on Escape; this keeps the key from the window's own handlers.
      event.stopPropagation()
      return
    }
    event.preventDefault()
    if (locked) return
    switch (action) {
      case 'next': case 'previous': case 'first': case 'last':
        pick(moveIndex(index, rows.length, action))
        return
      case 'activate':
        activate()
        return
      case 'open-here':
        onOpenHere?.()
        return
      case 'into': {
        const folder = current === null ? null : folderOfRow(current)
        if (folder !== null) onInto?.(folder)
        return
      }
      case 'up':
        onUp?.()
        return
      case 'back':
        onBack?.()
    }
  }

  const hints = hintsOf(level, mode, current, current === null ? status?.action?.label ?? null : null)
  const groups: { name: string | null; rows: { row: Row; at: number }[] }[] = []
  rows.forEach((row, at) => {
    const last = groups.at(-1)
    if (last !== undefined && last.name === row.group) last.rows.push({ row, at })
    else groups.push({ name: row.group, rows: [{ row, at }] })
  })
  const option = ({ row, at }: { row: Row; at: number }) => (
    <ResultsOption key={row.id} id={optionId(at)} selected={at === index} className={`mx-op-row${row.quiet ? ' is-quiet' : ''}`} onMouseMove={() => { if (at !== index) pick(at) }} onClick={() => { if (!locked) onAct(row.action) }}>
      <span className="mx-op-icon"><RowGlyph icon={row.icon} /></span>
      <span className="mx-op-text">
        <span className="mx-op-name">{row.title}</span>
        {row.detail !== null && <span className="mx-op-detail">{row.detail}</span>}
      </span>
      {row.tag !== null && <span className={`mx-op-tag${row.tag === 'Offline' ? ' is-offline' : ''}`}>{row.tag}</span>}
    </ResultsOption>
  )

  return (
    // A press on a row or a button must not take the focus from the field, or the keys would stop answering.
    <div className="mx-op-level" onKeyDown={onKeyDown} onMouseDown={(event) => { if (event.target !== field.current) event.preventDefault() }}>
      <div className="mx-op-head">
        {onBack === null
          ? <span className="mx-op-lead" aria-hidden="true"><Icon name="search" size={16} /></span>
          : <button type="button" className="mx-op-lead" aria-label="Back" title="Back (Backspace)" disabled={locked} onClick={onBack}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg></button>}
        {crumb !== undefined && (
          <span className="mx-op-crumb" title={crumb.full}>
            <span className="mx-op-machine"><Icon name={crumb.remote ? 'server' : 'monitor'} size={13} />{crumb.machine}</span>
            <span className="mx-op-path">{crumb.path}</span>
          </span>
        )}
        <input
          ref={field}
          className="mx-op-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          {...(current !== null ? { 'aria-activedescendant': optionId(index) } : {})}
          aria-label={placeholder}
          placeholder={placeholder}
          value={query}
          maxLength={MOST_FIELD_CHARS}
          spellCheck={false}
          autoComplete="off"
          readOnly={locked}
          onChange={(event) => { onQuery(event.target.value) }}
        />
        {aside}
      </div>
      <ResultsList ref={list} id={`${id}-list`} aria-label={placeholder} className="mx-op-list">
        {status !== null && <StatusBlock status={status} />}
        {groups.map((group) => (group.name === null
          ? group.rows.map(option)
          : (
            <div key={group.name} role="group" aria-label={group.name} className="mx-op-group">
              <div role="presentation" className="mx-op-heading">{group.name}</div>
              {group.rows.map(option)}
            </div>
          )))}
        {more != null && <p role="status" className="mx-op-more">{more}</p>}
      </ResultsList>
      <div className="mx-op-foot">
        {hints.map((hint) => <span key={hint.keys} className="mx-op-hint"><kbd>{hint.keys}</kbd>{hint.does}</span>)}
        <span className="mx-op-fill" />
        {actions}
      </div>
    </div>
  )
}
