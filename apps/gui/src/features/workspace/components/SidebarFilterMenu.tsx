import { useState } from 'react'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import type { ProjectChoice } from '../model/sidebar'
import { FolderMark, Icon } from './glyphs'

/** The project list shows this many rows before it scrolls; with more projects than this the search box says how many. */
export const PROJECT_ROWS_SHOWN = 6

type Props = {
  /** Every project that has a session, the busiest first. */
  projects: readonly ProjectChoice[]
  /** The project the list is narrowed to, or null for all of them. */
  project: string | null
  onProject: (project: string | null) => void
}

/**
 * The sidebar's ≡ menu: which project the tree shows. A pick applies at once and the menu stays open; Reset appears while a
 * project is picked. It grows from the button's bottom-left corner.
 */
export function SidebarFilterMenu({ projects, project, onProject }: Props) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matching = projects.filter((choice) => needle === '' || choice.name.toLowerCase().includes(needle))
  const narrowed = project !== null
  const label = `Filter by project: ${project ?? 'All projects'}`
  return (
    <Popover.Root onOpenChange={(open) => { if (open) setQuery('') }}>
      <Popover.Trigger asChild>
        <button type="button" className={`mx-head-button${narrowed ? ' is-on' : ''}`} data-on={narrowed} aria-label={label} title="Filter by project"><Icon name="filter" /></button>
      </Popover.Trigger>
      <PopupContent side="bottom" align="start" sideOffset={2} aria-label="Filter by project" className="mx-grp-menu">
        <label className="mx-grp-search">
          <Icon name="search" size={12} />
          <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={projects.length > PROJECT_ROWS_SHOWN ? `Find one of ${String(projects.length)} projects` : 'Filter projects'} aria-label="Filter projects" spellCheck={false} />
        </label>
        <div className="mx-grp-projects" role="group" aria-label="Show projects">
          {needle === '' && <ProjectButton name="All projects" count={projects.reduce((total, choice) => total + choice.count, 0)} on={project === null} onPick={() => { onProject(null) }} />}
          {matching.map((choice) => <ProjectButton key={choice.name} name={choice.name} count={choice.count} on={project === choice.name} onPick={() => { onProject(choice.name); setQuery('') }} />)}
          {matching.length === 0 && needle !== '' && <div className="mx-grp-none">No project matches.</div>}
        </div>
        {narrowed && (
          <div className="mx-grp-foot">
            <button type="button" className="mx-grp-reset" onClick={() => { onProject(null); setQuery('') }}>Reset</button>
          </div>
        )}
      </PopupContent>
    </Popover.Root>
  )
}

function ProjectButton({ name, count, on, onPick }: { name: string; count: number; on: boolean; onPick: () => void }) {
  return (
    <button type="button" className={`mx-grp-project${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onPick}>
      <FolderMark size={13} />
      <span className="mx-grp-name">{name}</span>
      <span className="mx-grp-count">{count}</span>
    </button>
  )
}
