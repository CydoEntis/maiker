import { ChoiceItem, ChoiceList } from '@/components/ui/choice-list'
import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import { Icon } from './glyphs'

/** One row of a chip's list: a name, what is under it, and what sits at its right. */
export type ChipItem = { key: string; label: string; sub?: string; icon?: ReactNode; badge?: string; /** The name is a branch or a path: set in the mono face. */ mono?: boolean; right?: ReactNode; checked: boolean; disabled?: boolean; onPick: () => void }
/** `quiet`: no heading over the rows (a short menu of actions that needs none). `ruled`: a hairline above the group, in a place menu. */
export type ChipSection = { heading: string; quiet?: boolean; ruled?: boolean; items: readonly ChipItem[] }

type Props = {
  /** What the chip says (the choice made). */
  label: ReactNode
  /** The chip's choice in words, for a screen reader, when the label is more than text. */
  summary?: string
  title: string
  icon?: ReactNode
  /** Given: a search box over the rows, with this placeholder and the number of rows beside it. */
  search?: string
  sections: readonly ChipSection[]
  /** Under the list: actions and a short note. */
  footer?: ReactNode
  /** Shown above the sections, outside the filter (a meter, a switch). */
  extra?: ReactNode
  /** Shown under the list and above the footer, outside the filter (a meter that comes after the choice above it). */
  below?: ReactNode
  /** A line the search can turn into a row of its own (a pasted path); null when it cannot. */
  fromQuery?: (query: string) => ChipItem | null
  width?: number
  /** Which way the list opens from the chip: up from the message box, or down from the top of a page. */
  side?: 'top' | 'bottom'
  /** `crumb`: a plain header button (a breadcrumb of the chat's place) instead of a filled chip. `token`: one of the new session dialog's three tokens, whose list grows from the token. `place`: a menu of the row under the message box (folder, branch, sync), drawn as the design's chip menu. */
  variant?: 'chip' | 'crumb' | 'token' | 'place'
  /** A small heading over the list, in place of the section headings (`Branch in shop`). */
  heading?: string
  /** Above everything, the menu's own head: what it is about, in lines of its own (a path and where the session runs). */
  header?: ReactNode
  /** The chip is plain text with no chevron: the row under the message box. `triggerClass` gives its look. */
  chevron?: boolean
  /** The token's list head: what it is a list of, and a dim word at its right (`Project`, `on devbox`). */
  hint?: string
  /** The trigger's own class, for the token's look. */
  triggerClass?: string
  /** Why what is typed cannot be used (a branch name git refuses); shown under the search box in place of a row made from it. */
  queryError?: (query: string) => string | null
  /** A control at the end of the search box (the branch list's fetch button). */
  searchEnd?: ReactNode
  /** Given, the list is opened and closed from outside (a failure's button that opens it). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** One fact of the context row over the message box, as a small chip that opens a searchable list above it. */
export function ChipMenu({ label, summary, title, icon, search, sections, footer, extra, below, fromQuery, width = 340, side = 'top', variant = 'chip', heading, header, chevron = true, hint, triggerClass, queryError, searchEnd, open: openFromOutside, onOpenChange }: Props) {
  const [openInside, setOpenInside] = useState(false)
  const open = openFromOutside ?? openInside
  const setOpen = (next: boolean) => { setOpenInside(next); onOpenChange?.(next) }
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const kept = sections
    .map((section) => ({ ...section, items: section.items.filter((item) => needle === '' || `${item.label} ${item.sub ?? ''}`.toLowerCase().includes(needle)) }))
    .filter((section) => section.items.length > 0)
  const made = needle === '' ? null : fromQuery?.(query.trim()) ?? null
  const refused = needle === '' ? null : queryError?.(query) ?? null
  const total = sections.reduce((sum, section) => sum + section.items.length, 0)
  const pick = (item: ChipItem) => { setOpen(false); setQuery(''); item.onPick() }
  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
      <Popover.Trigger asChild>
        <button type="button" className={triggerClass ?? (variant === 'crumb' ? 'mx-crumb' : 'mx-chip')} title={title} {...(variant === 'token' ? { 'aria-haspopup': 'listbox' as const } : {})} aria-label={`${title}: ${summary ?? (typeof label === 'string' ? label : '')}`}>{icon}{label}{!chevron ? null : variant === 'token' ? <Icon name="chevronDown" size={9} /> : <Icon name="chevronDown" />}</button>
      </Popover.Trigger>
      <PopupContent side={side} align="start" aria-label={title} {...(variant === 'token' ? { sideOffset: 4 } : {})} className={`mx-chip-menu${variant === 'crumb' ? ' is-crumb' : ''}${variant === 'token' ? ' is-token' : ''}${variant === 'place' ? ' is-place' : ''}`} style={{ width: `min(${String(width)}px, calc(100vw - 32px))` }}>
        {variant === 'token' && <div className="mx-token-head"><span>{title}</span><span>{hint}</span></div>}
        {header}
        {heading !== undefined && <h3 className="mx-chip-title">{heading}</h3>}
        {search !== undefined && (
          <label className="mx-chip-search">
            <Icon name="search" size={13} />
            <input autoFocus aria-label={search} placeholder={search} value={query} onChange={(event) => { setQuery(event.target.value) }}
              onKeyDown={(event) => { if (event.key === 'Enter' && made) { event.preventDefault(); pick(made) } }} />
            <span className="mx-chip-count">{total}</span>
            {searchEnd}
          </label>
        )}
        {refused !== null && <p role="alert" className="mx-chip-refused"><b aria-hidden="true">×</b><span>{refused}</span></p>}
        {extra}
        <ChoiceList className="mx-chip-list" aria-label={title} current={kept.flatMap((section) => section.items).find((item) => item.checked)?.key ?? null}>
          {made && <ChipRow item={made} onPick={pick} />}
          {kept.map((section) => (
            <div key={section.heading} role="group" aria-label={section.heading} className={section.ruled === true ? 'is-ruled' : undefined}>
              {heading === undefined && section.quiet !== true && <h3 className="mx-chip-heading"><span>{section.heading}</span><span>{section.items.length}</span></h3>}
              {section.items.map((item) => <ChipRow key={item.key} item={item} onPick={pick} />)}
            </div>
          ))}
          {kept.length === 0 && !made && refused === null && (total > 0 || search !== undefined) && <p className="mx-chip-none">{variant === 'token' ? 'Nothing matches.' : 'Nothing matches'}</p>}
        </ChoiceList>
        {below}
        {footer !== undefined && <div className="mx-chip-footer">{footer}</div>}
      </PopupContent>
    </Popover.Root>
  )
}

function ChipRow({ item, onPick }: { item: ChipItem; onPick: (item: ChipItem) => void }) {
  return (
    <ChoiceItem value={item.key} disabled={item.disabled} className={`mx-chip-row${item.checked ? ' is-checked' : ''}`} onPick={() => { onPick(item) }}>
      {item.icon}
      <span className="mx-chip-row-text">
        <span className={`mx-chip-row-label${item.mono === true ? ' is-mono' : ''}`}>{item.label}{item.badge !== undefined && <span className="mx-chip-badge">{item.badge}</span>}</span>
        {item.sub !== undefined && <span className="mx-chip-row-sub">{item.sub}</span>}
      </span>
      {item.right}
    </ChoiceItem>
  )
}
