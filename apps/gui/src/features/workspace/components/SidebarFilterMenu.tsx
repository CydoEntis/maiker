import { useState } from 'react'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { DEFAULT_SIDEBAR_SORT, SIDEBAR_GROUPINGS, SIDEBAR_SORTS, type ProjectChoice, type SidebarGrouping, type SidebarSort } from '../model/sidebar'
import { Icon } from './glyphs'

/** The project list shows this many rows before it scrolls; with more projects than this the search box says how many. */
export const PROJECT_ROWS_SHOWN = 6

/** What the menu starts as: Reset puts these back. */
export const DEFAULT_GROUPING: SidebarGrouping = 'status'

type Props = {
  grouping: SidebarGrouping
  onGrouping: (grouping: SidebarGrouping) => void
  sort: SidebarSort
  onSort: (sort: SidebarSort) => void
  /** Every project that has a session, the busiest first. */
  projects: readonly ProjectChoice[]
  /** The project the list is narrowed to, or null for all of them. */
  project: string | null
  onProject: (project: string | null) => void
}

function isGrouping(value: string): value is SidebarGrouping {
  return SIDEBAR_GROUPINGS.some(([grouping]) => grouping === value)
}

function isSort(value: string): value is SidebarSort {
  return SIDEBAR_SORTS.some(([sort]) => sort === value)
}

/**
 * The sidebar's ≡ menu: how the headings group the rows, how rows sort, and which project shows. A choice applies at once
 * and the menu stays open; Reset appears when anything differs from the start. It grows from the button's bottom-left corner.
 */
export function SidebarFilterMenu({ grouping, onGrouping, sort, onSort, projects, project, onProject }: Props) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matching = projects.filter((choice) => needle === '' || choice.name.toLowerCase().includes(needle))
  const dirty = grouping !== DEFAULT_GROUPING || sort !== DEFAULT_SIDEBAR_SORT || project !== null
  const label = `Filter and group: ${project ?? 'All projects'}`
  return (
    <Popover.Root onOpenChange={(open) => { if (open) setQuery('') }}>
      <Popover.Trigger asChild>
        <button type="button" className="mx-head-button" aria-label={label} title="Filter and group"><Icon name="filter" /></button>
      </Popover.Trigger>
      <PopupContent side="bottom" align="start" sideOffset={2} aria-label="Group, sort and filter" className="mx-grp-menu">
        <div className="mx-grp-row">
          <span className="mx-grp-label">Group</span>
          <Segmented aria-label="Group" value={grouping} onValueChange={(next) => { if (isGrouping(next)) onGrouping(next) }}>
            {SIDEBAR_GROUPINGS.map(([key, name]) => <SegmentedItem key={key} value={key}>{name}</SegmentedItem>)}
          </Segmented>
        </div>
        <div className="mx-grp-row">
          <span className="mx-grp-label">Sort</span>
          <Segmented aria-label="Sort" value={sort} onValueChange={(next) => { if (isSort(next)) onSort(next) }}>
            {SIDEBAR_SORTS.map(([key, name]) => <SegmentedItem key={key} value={key}>{name}</SegmentedItem>)}
          </Segmented>
        </div>
        <label className="mx-grp-search">
          <Icon name="search" size={12} />
          <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={projects.length > PROJECT_ROWS_SHOWN ? `Find one of ${String(projects.length)} projects` : 'Filter projects'} aria-label="Filter projects" spellCheck={false} />
        </label>
        <div className="mx-grp-projects" role="group" aria-label="Show projects">
          {needle === '' && <ProjectButton name="All projects" count={projects.reduce((total, choice) => total + choice.count, 0)} on={project === null} onPick={() => { onProject(null) }} />}
          {matching.map((choice) => <ProjectButton key={choice.name} name={choice.name} color={choice.color} count={choice.count} on={project === choice.name} onPick={() => { onProject(choice.name); setQuery('') }} />)}
          {matching.length === 0 && needle !== '' && <div className="mx-grp-none">No project matches.</div>}
        </div>
        {dirty && (
          <div className="mx-grp-foot">
            <button type="button" className="mx-grp-reset" onClick={() => { onGrouping(DEFAULT_GROUPING); onSort(DEFAULT_SIDEBAR_SORT); onProject(null); setQuery('') }}>Reset</button>
          </div>
        )}
      </PopupContent>
    </Popover.Root>
  )
}

function ProjectButton({ name, color, count, on, onPick }: { name: string; color?: string; count: number; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`mx-grp-project${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onPick}>
      <span className="mx-grp-square" style={color === undefined ? undefined : { background: color }} aria-hidden="true" />
      <span className="mx-grp-name">{name}</span>
      <span className="mx-grp-count">{count}</span>
    </button>
  )
}
