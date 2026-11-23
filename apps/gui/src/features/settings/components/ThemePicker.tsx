import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { findTheme, THEMES, type ThemeEntry } from '@/features/workspace/theme/themes'

type Props = {
  kind: 'dark' | 'light'
  value: string
  /** This slot's theme is the one showing: hovering a row previews it on the whole window. */
  inUse: boolean
  /** The other slot while a fixed mode is chosen. */
  dimmed: boolean
  onPick: (name: string) => void
  onPreview: (name: string | null) => void
}

function ThemeSwatch({ theme }: { theme: ThemeEntry }) {
  return (
    <span className="mx-swatch" style={{ background: theme.tokens.term }} aria-hidden="true">
      <span><i style={{ width: 12, background: theme.tokens.accent }} /><i style={{ width: 16, background: theme.tokens.fg, opacity: 0.7 }} /></span>
      <span><i style={{ width: 8, background: theme.tokens.ansiMag }} /><i style={{ width: 10, background: theme.tokens.ansiBlue }} /><i style={{ width: 6, background: theme.tokens.ansiGreen }} /></span>
    </span>
  )
}

/** Steps the keys move the lit row by. */
const PAGE_ROWS = 5

/** Whether a theme's name or family holds the search, any case. */
const matches = (theme: ThemeEntry, needle: string) => !needle || `${theme.name} ${theme.family}`.toLowerCase().includes(needle)

/**
 * A dropdown of the dark (or light) themes, A to Z, with search. The theme in use keeps its place in the list and carries
 * a check. The keys stay in the search field: Up and Down (Page Up and Page Down by five) light a row, which previews it
 * when this slot is the one showing, and Enter picks it.
 */
export function ThemePicker({ kind, value, inUse, dimmed, onPick, onPreview }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [lit, setLit] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const light = kind === 'light'
  const noun = light ? 'light' : 'dark'
  const title = light ? 'Light' : 'Dark'
  const pool = useMemo(() => THEMES.filter((theme) => theme.light === light).sort((a, b) => a.name.localeCompare(b.name)), [light])
  const shown = useMemo(() => pool.filter((theme) => matches(theme, query.trim().toLowerCase())), [pool, query])
  const current = findTheme(value)
  const listId = `mx-theme-list-${kind}`
  const optionId = (index: number) => `${listId}-${String(index)}`

  const change = (next: boolean) => {
    setOpen(next)
    setQuery('')
    if (next) setLit(Math.max(0, pool.findIndex((theme) => theme.name === value)))
    else onPreview(null)
  }

  // A preview never outlives the picker.
  useEffect(() => () => { onPreview(null) }, [onPreview])
  // The lit row stays in view as the keys move it, and the list opens on the theme in use.
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[data-lit]')?.scrollIntoView({ block: 'nearest' })
  })

  const lightRow = (index: number) => {
    const theme = shown[index]
    if (theme === undefined) return
    setLit(index)
    if (inUse) onPreview(theme.name)
  }
  const pick = (theme: ThemeEntry) => { onPick(theme.name); change(false) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = shown.length - 1
    if (last < 0) return
    const step: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1, PageDown: PAGE_ROWS, PageUp: -PAGE_ROWS }
    const by = step[event.key]
    if (by !== undefined) {
      event.preventDefault()
      const paged = Math.abs(by) > 1
      const next = lit + by
      lightRow(paged ? Math.min(Math.max(next, 0), last) : (next + shown.length) % shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const theme = shown[lit]
      if (theme !== undefined) pick(theme)
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={change}>
      <div className={`mx-picker${dimmed ? ' is-dimmed' : ''}`}>
        <Popover.Trigger asChild>
          <button type="button" className={`mx-picker-button${open ? ' is-open' : ''}`} aria-label={`${title} theme: ${current.name}`}>
            <ThemeSwatch theme={current} />
            <span className="mx-picker-text">
              <span className="mx-theme-name">{current.name}</span>
              <span className="mx-theme-sub">{current.family}</span>
            </span>
            <svg className="mx-picker-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
        </Popover.Trigger>
      </div>
      <PopupContent align="end" collisionPadding={8} className="mx-picker-menu" aria-label={`${title} theme picker`} onEscapeKeyDown={(event) => { event.stopPropagation() }}>
        <label className="mx-search-field mx-picker-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[lit] === undefined ? undefined : optionId(lit)}
            value={query}
            placeholder={`Search ${noun} themes`}
            aria-label={`Search ${noun} themes`}
            onChange={(event) => { setQuery(event.target.value); setLit(0) }}
            onKeyDown={onKeyDown}
          />
        </label>
        <ResultsList ref={list} id={listId} aria-label={`${title} themes`} className="mx-picker-list" onMouseLeave={() => { onPreview(null) }}>
          {shown.map((theme, index) => {
            const picked = theme.name === value
            return (
              <ResultsOption
                key={theme.name}
                id={optionId(index)}
                selected={index === lit}
                aria-current={picked ? 'true' : undefined}
                data-lit={index === lit ? '' : undefined}
                className="mx-theme-card"
                onMouseEnter={() => { lightRow(index) }}
                onMouseDown={(event) => { event.preventDefault() }}
                onClick={() => { pick(theme) }}
              >
                <ThemeSwatch theme={theme} />
                <span className="mx-picker-text">
                  <span className="mx-theme-name">{theme.name}</span>
                  <span className="mx-theme-sub">{theme.family}</span>
                </span>
                {picked && <svg className="mx-theme-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>}
              </ResultsOption>
            )
          })}
          {shown.length === 0 && <span className="mx-picker-empty">No themes match.</span>}
        </ResultsList>
        <div className="mx-picker-foot">{pool.length} {noun} themes</div>
      </PopupContent>
    </Popover.Root>
  )
}
