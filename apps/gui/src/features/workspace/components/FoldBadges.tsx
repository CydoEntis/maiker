import type { FoldCounts } from '../model/sidebarTree'

const needsWords = (count: number) => (count === 1 ? '1 session needs you' : `${String(count)} sessions need you`)
const finishedWords = (count: number) => (count === 1 ? '1 finished session not opened yet' : `${String(count)} finished sessions not opened yet`)

/**
 * What a folded machine or project hides that wants a look: how many of its sessions need you, in the needs colour, and how
 * many finished unseen, in the done colour. A count of zero draws nothing, and an unfolded heading draws none at all: its
 * rows already say their status. Each badge is named for what it counts, since a bare number says nothing to a screen reader.
 */
export function FoldBadges({ counts, folded }: { counts: FoldCounts; folded: boolean }) {
  if (!folded) return null
  return (
    <>
      {/* A space before each badge, which a flex heading does not draw, keeps the heading's name "shop 2 sessions need you". */}
      {counts.needs > 0 && <>{' '}<span className="mx-fold-badge is-needs" role="img" aria-label={needsWords(counts.needs)} title={needsWords(counts.needs)}>{counts.needs}</span></>}
      {counts.finished > 0 && <>{' '}<span className="mx-fold-badge is-done" role="img" aria-label={finishedWords(counts.finished)} title={finishedWords(counts.finished)}>{counts.finished}</span></>}
    </>
  )
}
