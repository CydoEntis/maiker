import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ResultsList, ResultsOption } from '@/components/ui/results-list'
import { firstHitPerPane, searchPalette, withOutputHits, type PaletteItem } from '../model/palette'
import type { SearchHit } from '@/features/find/api'
import { usePaletteOutput } from '../usePaletteOutput'
import { Icon, type IconName } from './glyphs'
import { StatusMark, type StatusMarkState } from '@/components/StatusMark'
import type { SessionStatus } from '../model/session'

/** The palette's groups (layout 2h), in the order they are listed; a theme is something to do, so it sits with the actions. */
const GROUPS: ReadonlyArray<{ id: string; name: string; kinds: readonly PaletteItem['kind'][] }> = [
  { id: 'chats', name: 'Chats', kinds: ['Session'] },
  { id: 'actions', name: 'Actions', kinds: ['Action', 'Theme'] },
  { id: 'projects', name: 'Projects', kinds: ['Project'] },
  { id: 'in-sessions', name: 'In sessions', kinds: ['Output'] },
]

/** The mark at a row's left, so a chat, a project and an action read apart before their words do. */
const MARKS: Record<PaletteItem['kind'], IconName> = { Session: 'chat', Project: 'folder', Action: 'prompt', Theme: 'palette', Output: 'terminal' }
/** A chat's mark (layout 2h): its status, the same shape the sidebar uses, so the palette reads like the list. */
const STATUS_MARKS: Record<SessionStatus, StatusMarkState> = { needs: 'needs-you', working: 'working', limited: 'needs-you', error: 'needs-you', done: 'done', idle: 'idle', unknown: 'unknown' }
const optionId = (index: number) => `mx-palette-option-${String(index)}`

type Props = {
  items: readonly PaletteItem[]
  /** A line a session printed as a row; null when it belongs to no session the window shows. */
  outputItem: (hit: SearchHit, query: string) => PaletteItem | null
  onClose: () => void
}

/** ⌘K: jump to a session, project, action or theme by typing a few letters of its name, or to a session by what it printed. */
export function CommandPalette({ items, outputItem, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const hits = usePaletteOutput(query)
  const results = useMemo(() => withOutputHits(searchPalette(items, query), firstHitPerPane(hits).flatMap((hit) => outputItem(hit, query) ?? [])), [items, query, hits, outputItem])
  // Each group keeps the search's ranking inside it; the arrows walk the rows in the order they are drawn.
  const groups = useMemo(() => GROUPS.map((group) => ({ ...group, items: results.filter((item) => group.kinds.includes(item.kind)) })).filter((group) => group.items.length > 0), [results])
  const shown = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const active = Math.min(selected, Math.max(0, shown.length - 1))
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, shown])

  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }
  const row = (item: PaletteItem, index: number) => (
    <ResultsOption key={item.id} id={optionId(index)} selected={index === active} className={`mx-palette-row${index === active ? ' is-selected' : ''}`} onMouseMove={() => { setSelected(index) }} onClick={() => { run(item) }}>
      <span className="mx-palette-mark" aria-hidden="true">{item.status ? <StatusMark status={STATUS_MARKS[item.status]} /> : <Icon name={MARKS[item.kind]} size={14} />}</span>
      <span className="mx-palette-label">{item.label}</span>
      {item.detail && <span className={`mx-palette-detail${item.kind === 'Output' ? ' is-output' : ''}`}>{item.detail}</span>}
      <span className="mx-spacer" />
      {item.badge && <span className="mx-palette-badge">{item.badge}</span>}
      {item.shortcut && <kbd className="mx-palette-keys">{item.shortcut}</kbd>}
    </ResultsOption>
  )
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (shown.length > 0) setSelected((active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(shown[active])
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent unstyled overlayClassName="mx-palette-scrim" aria-label="Command palette" aria-describedby={undefined} className="mx-palette" onKeyDown={onKeyDown} onOpenAutoFocus={(event) => { event.preventDefault() }}>
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="mx-palette-input">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="mx-palette-list"
            {...(shown.length > 0 ? { 'aria-activedescendant': optionId(active) } : {})}
            aria-label="Search the palette"
            placeholder="Jump to a chat, project or action…"
            value={query}
            spellCheck={false}
            onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
          />
          <kbd className="mx-keycap">esc</kbd>
        </div>
        <ResultsList ref={list} id="mx-palette-list" aria-label="Results" className="mx-palette-list">
          {groups.map((group, at) => {
            const first = groups.slice(0, at).reduce((count, before) => count + before.items.length, 0)
            return (
              <div key={group.id} role="group" aria-labelledby={`mx-palette-${group.id}`} className="mx-palette-group">
                <div id={`mx-palette-${group.id}`} role="presentation" className="mx-palette-section">{group.name}</div>
                {group.items.map((item, index) => row(item, first + index))}
              </div>
            )
          })}
          {shown.length === 0 && <div className="mx-palette-empty">Nothing matches “{query}”.</div>}
        </ResultsList>
        <div className="mx-palette-foot"><span>↑ ↓ move</span><span>↵ open</span></div>
      </DialogContent>
    </Dialog>
  )
}
