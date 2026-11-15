import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { TicketGroup } from '@/api/tickets'
import { Icon } from '@/features/workspace/components/glyphs'
import { share, type GroupCounts } from './model/tickets'

const PERCENT = 100

export type GroupLayout = 'grid' | 'list'

type Props = {
  title: string
  /** What one group is called on its card ("module", "cycle", …). */
  kindWord: string
  groups: readonly TicketGroup[]
  countsOf: (group: TicketGroup) => GroupCounts
  /** Whether every ticket of the source was read: the counts are then whole, else of what was read. */
  whole: boolean
  layout: GroupLayout
  onLayout: (layout: GroupLayout) => void
  onSelectOpen: (ids: readonly string[]) => void
  onOpenGroup: (group: TicketGroup) => void
}

function Progress({ counts }: { counts: GroupCounts }) {
  return (
    <span aria-hidden="true" className="mx-tk-bar"><span className="is-closed" style={{ width: share(counts.closed, counts.total) }} /><span className="is-started" style={{ width: share(counts.started, counts.total) }} /></span>
  )
}

function Tally({ counts }: { counts: GroupCounts }) {
  return (
    <span className="mx-tk-tally"><span>□ {counts.open} open</span><span className="is-started">◧ {counts.started} started</span><span>✓ {counts.closed} closed</span></span>
  )
}

function percentDone(counts: GroupCounts): string {
  return `${String(counts.total === 0 ? 0 : Math.round((counts.closed / counts.total) * PERCENT))}% done`
}

/**
 * One kind of group of the source, never mixed with another: milestones, modules, cycles or Linear projects. Grid
 * (cards of 250px or more) or List (a row each); a card or row opens that group's tickets, and **Select open · N**
 * ticks its open tickets that nothing blocks.
 */
export function TicketGroups({ title, kindWord, groups, countsOf, whole, layout, onLayout, onSelectOpen, onOpenGroup }: Props) {
  const selectOpen = (counts: GroupCounts) => counts.selectable.length > 0 && (
    <button type="button" className="mx-tk-chip-button" onClick={(event) => { event.stopPropagation(); onSelectOpen(counts.selectable) }}>Select open · {counts.selectable.length}</button>
  )
  const open = (group: TicketGroup) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => { onOpenGroup(group) },
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpenGroup(group) } },
  })
  return (
    <div className="mx-tk-groups" data-label="Ticket groups">
      <div className="mx-tk-groups-head">
        <span className="mx-tk-groups-title">{title}</span>
        {!whole && <span className="mx-tk-dim">counts of the tickets read so far</span>}
        <span className="mx-spacer" />
        <Segmented aria-label="Layout" className="mx-tk-seg" value={layout} onValueChange={(value) => { onLayout(value === 'list' ? 'list' : 'grid') }}>
          <SegmentedItem value="grid" aria-label="Grid" title="Grid"><Icon name="modules" /></SegmentedItem>
          <SegmentedItem value="list" aria-label="List" title="List"><Icon name="list" /></SegmentedItem>
        </Segmented>
      </div>
      {groups.length === 0 && <div className="mx-tk-empty"><span>None yet</span><span className="mx-tk-dim">This source has no {title.split(' ')[0]?.toLowerCase()}.</span></div>}
      {layout === 'grid' ? (
        <div className="mx-tk-grid">
          {groups.map((group) => {
            const counts = countsOf(group)
            return (
              <div key={group.id} className="mx-tk-card" {...open(group)}>
                <span className="mx-tk-card-top"><span className="mx-tk-kind">{kindWord}</span><span className="mx-spacer" />{counts.mine > 0 && <span className="mx-tk-me" title="Assigned to you">ME {counts.mine}</span>}</span>
                <span className="mx-tk-card-name"><span>{group.name}</span><span className="mx-tk-dim">{group.count ?? counts.total} tickets</span></span>
                <span className="mx-tk-card-progress"><Progress counts={counts} /><span className="mx-tk-card-tally"><Tally counts={counts} /><span className="mx-tk-pct">{percentDone(counts)}</span></span></span>
                <span className="mx-tk-card-foot">{selectOpen(counts)}<span className="mx-spacer" /><span className="mx-tk-dim">Open ›</span></span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="mx-tk-glist">
          <div aria-hidden="true" className="mx-tk-glist-head"><span>Name</span><span data-gprog="1">Progress</span><span>Tickets</span><span /></div>
          {groups.map((group) => {
            const counts = countsOf(group)
            return (
              <div key={group.id} className="mx-tk-glist-row" {...open(group)}>
                <span className="mx-tk-glist-name"><span>{group.name}</span>{counts.mine > 0 && <span className="mx-tk-me" title="Assigned to you">ME {counts.mine}</span>}</span>
                <span data-gprog="1" className="mx-tk-glist-progress"><Progress counts={counts} /><span className="mx-tk-pct">{percentDone(counts)}</span></span>
                <Tally counts={counts} />
                <span className="mx-tk-glist-end">{selectOpen(counts)}<span className="mx-tk-dim">›</span></span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
