import { useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { IconButton } from '@/components/ui/icon-button'
import { PopupContent } from '@/components/ui/popup'
import type { MachineChoice, ProjectChoice, SidebarFilter } from '../model/sidebarTree'
import { Icon, MachineIcon } from './glyphs'
import { ProjectBadge } from './ProjectBadge'

/** The project list shows this many rows before it scrolls; with more projects than this the search box says how many. */
export const PROJECT_ROWS_SHOWN = 6

type Props = {
  /** Every opened project by name, in the order they were opened. */
  projects: readonly ProjectChoice[]
  /** Every configured machine, this computer first. */
  machines: readonly MachineChoice[]
  filter: SidebarFilter
  onFilter: (filter: SidebarFilter) => void
}

/**
 * The sidebar's filter: which project and which machine it shows. A pick applies at once and the menu stays open; Reset
 * appears while anything is picked. The machines are offered only once there is more than this computer.
 */
export function SidebarFilterMenu({ projects, machines, filter, onFilter }: Props) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const matching = projects.filter((choice) => needle === '' || choice.name.toLowerCase().includes(needle))
  const narrowed = filter.project !== null || filter.machine !== null
  const total = projects.reduce((sum, choice) => sum + choice.count, 0)
  return (
    <Popover.Root onOpenChange={(open) => { if (open) setQuery('') }}>
      <Popover.Trigger asChild>
        <IconButton label={narrowed ? 'Filter (on)' : 'Filter'} tip="Filter by project or machine" on={narrowed}><Icon name="filter" /></IconButton>
      </Popover.Trigger>
      <PopupContent side="bottom" align="start" sideOffset={2} aria-label="Filter the sidebar" className="mx-sbf">
        <label className="mx-sbf-search">
          <Icon name="search" size={13} />
          <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={projects.length > PROJECT_ROWS_SHOWN ? `Find one of ${String(projects.length)} projects` : 'Filter projects'} aria-label="Filter projects" spellCheck={false} />
        </label>
        <div className="mx-sbf-list is-projects" role="group" aria-label="Projects">
          {needle === '' && <Choice name="All projects" count={total} on={filter.project === null} onPick={() => { onFilter({ ...filter, project: null }) }} />}
          {matching.map((choice) => (
            <Choice key={choice.name} name={choice.name} count={choice.count} on={filter.project === choice.name} mark={<ProjectBadge name={choice.name} />} onPick={() => { onFilter({ ...filter, project: choice.name }); setQuery('') }} />
          ))}
          {matching.length === 0 && needle !== '' && <div className="mx-sbf-none">No project matches.</div>}
        </div>
        {machines.length > 1 && (
          <>
            <div className="mx-sbf-label" aria-hidden="true">Machines</div>
            <div className="mx-sbf-list" role="group" aria-label="Machines">
              {machines.map((choice) => (
                <Choice
                  key={choice.key}
                  name={choice.label}
                  count={choice.count}
                  note={choice.down ? 'offline' : undefined}
                  on={filter.machine === choice.key}
                  mark={<span className={`mx-sbf-machine${choice.down ? ' is-down' : ''}`}><MachineIcon remote={choice.remote} /></span>}
                  // A second press on the machine picked shows every machine again: there is no "All machines" row.
                  onPick={() => { onFilter({ ...filter, machine: filter.machine === choice.key ? null : choice.key }) }}
                />
              ))}
            </div>
          </>
        )}
        {narrowed && (
          <div className="mx-sbf-foot">
            <button type="button" className="mx-sbf-reset" onClick={() => { onFilter({ project: null, machine: null }); setQuery('') }}>Reset</button>
          </div>
        )}
      </PopupContent>
    </Popover.Root>
  )
}

function Choice({ name, count, on, mark, note, onPick }: { name: string; count: number; on: boolean; mark?: ReactNode; note?: string | undefined; onPick: () => void }) {
  return (
    <button type="button" className={`mx-sbf-choice${on ? ' is-on' : ''}`} aria-pressed={on} onClick={onPick}>
      {mark}
      <span className="mx-sbf-name">{name}</span>
      {note !== undefined && <span className="mx-sbf-note">{note}</span>}
      <span className="mx-sbf-count">{count}</span>
    </button>
  )
}
