import { useContext, useId, useState } from 'react'
import { useRevealOpen } from '../chatActions'
import type { SubagentEvent } from '../chatEvents'
import { dockHelpers, helperCounts, HelpersLiveContext } from '../helpersDock'
import { agentsSummary } from '../stepInfo'
import { ChevronGlyph } from './DockIcons'
import { HelperCounts, HelperRows, HelperStrip, HelpersMarker } from './HelpersDock'

type AgentsCardProps = {
  agents: readonly SubagentEvent[]
  /** The chat row this is, so it can tell it is the one the dock above the message box follows. */
  rowKey?: string
}

/**
 * The helper agents a turn started. While any of them works, the dock above the message box follows them and this row is
 * one quiet line, "Started N helpers · running below". Once they have all finished it becomes the record: the count,
 * how each ended, a block each in a progress strip, and a row each that opens to what it was asked and what it answered.
 * The record opens by itself only when something is worth reading in it: a helper still working or one that failed.
 */
export function AgentsCard({ agents, rowKey }: AgentsCardProps) {
  const live = useContext(HelpersLiveContext)
  const helpers = dockHelpers(agents, [])
  const counts = helperCounts(helpers)
  const [chosen, setChosen] = useState<boolean | null>(null)
  const list = useId()
  useRevealOpen(rowKey, () => { setChosen(true) })
  if (rowKey !== undefined && live?.key === rowKey) return <HelpersMarker count={agents.length} onOpen={live.open} />
  const open = chosen ?? (counts.working > 0 || counts.failed > 0)
  return (
    <section className="mx-agents-record" data-fold="1" role="group" aria-label={agentsSummary(agents)}>
      <button type="button" className={`mx-agents-head${open ? ' is-open' : ''}`} aria-expanded={open} aria-controls={list} onClick={() => { setChosen(!open) }}>
        <span className="mx-agents-title">{helpers.length} {helpers.length === 1 ? 'helper' : 'helpers'}</span>
        <HelperCounts helpers={helpers} />
        <HelperStrip helpers={helpers} />
        <span className={`mx-dock-chevron is-down${open ? ' is-open' : ''}`}><ChevronGlyph /></span>
      </button>
      {open && <div id={list}><HelperRows helpers={helpers} /></div>}
    </section>
  )
}
