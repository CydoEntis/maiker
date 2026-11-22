import type { CSSProperties, ReactNode } from 'react'
import { AGENT_LEAF, layoutOf, type PaneRect, type SplitTree as Tree } from '../model/splitTree'
import { TreeSplitHandle } from './SplitHandle'

const FULL = 100
/** A share this close to an edge of the tree is on it: the shares are sums of fractions, never exact. */
const EDGE = 0.0001
/** A pane gives up half the gap on each side that faces another pane, so the two halves make the whole gap. */
const HALF_GAP = 'calc(var(--split-gap) / 2)'
const NONE = '0px'

const percent = (share: number): string => `${String(share * FULL)}%`

/** Where a pane sits: its share of the tree, drawn back from every side that has a neighbour. */
function placeOf(rect: PaneRect): CSSProperties {
  const left = rect.x > EDGE ? HALF_GAP : NONE
  const right = rect.x + rect.w < 1 - EDGE ? HALF_GAP : NONE
  const top = rect.y > EDGE ? HALF_GAP : NONE
  const bottom = rect.y + rect.h < 1 - EDGE ? HALF_GAP : NONE
  return {
    left: `calc(${percent(rect.x)} + ${left})`,
    top: `calc(${percent(rect.y)} + ${top})`,
    width: `calc(${percent(rect.w)} - ${left} - ${right})`,
    height: `calc(${percent(rect.h)} - ${top} - ${bottom})`,
  }
}

/** The agent's pane first, then the shells by id: an order that never changes, whatever the tree becomes. */
function steady(a: PaneRect, b: PaneRect): number {
  if (a.id === AGENT_LEAF) return -1
  if (b.id === AGENT_LEAF) return 1
  return a.id.localeCompare(b.id)
}

/**
 * A session's panes, each placed from the tree (`model/splitTree.ts`). The panes are siblings in one box, in an order
 * that does not follow the tree, so a split or a close moves and sizes them without mounting any terminal again.
 */
export function SplitTree({ tree, renderPane, onResize }: {
  tree: Tree
  renderPane: (id: string) => ReactNode
  /** The branch at `path` gets a new share for its first side; `null` halves it. */
  onResize: (path: string, ratio: number | null) => void
}) {
  const { panes, dividers } = layoutOf(tree)
  return (
    <div className="mx-split-tree">
      {[...panes].sort(steady).map((rect) => <div key={rect.id} className="mx-split-leaf" style={placeOf(rect)}>{renderPane(rect.id)}</div>)}
      {dividers.map((divider) => (
        <TreeSplitHandle key={divider.path} divider={divider} onResize={(ratio) => { onResize(divider.path, ratio) }} onReset={() => { onResize(divider.path, null) }} />
      ))}
    </div>
  )
}
