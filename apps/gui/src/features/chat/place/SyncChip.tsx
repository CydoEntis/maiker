import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { ago } from '@/features/inspect/format'
import type { SyncAction } from '@/features/inspect/api'
import { PlaceHead } from './PlaceHead'
import type { SessionSync } from './useSessionSync'

const WIDTH = 300
const FETCH_HINT = 'Ctrl Shift F'
const DOING: Readonly<Record<SyncAction, string>> = { fetch: 'Fetching…', pull: 'Pulling…', push: 'Pushing…' }

const commits = (count: number) => `${String(count)} commit${count === 1 ? '' : 's'}`

/** What the chip says: the move running, `Synced` when level, else the two counts. */
function face(state: SessionSync): string {
  const { ahead, behind } = state.sync
  if (state.running !== null) return DOING[state.running]
  if (ahead === 0 && behind === 0) return 'Synced'
  return `${behind > 0 ? `↓${String(behind)}` : ''}${behind > 0 && ahead > 0 ? ' ' : ''}${ahead > 0 ? `↑${String(ahead)}` : ''}`
}

function fetchedLine(fetchedAt: number | null): string {
  return fetchedAt === null ? 'not fetched yet' : `fetched ${ago(fetchedAt, nowSeconds())}`
}

/** The row under the box's sync chip: how far the branch is from its upstream, and Fetch, Pull and Push. */
export function SyncChip({ state, branch }: { state: SessionSync; branch: string }) {
  const { sync, running, run } = state
  const { ahead, behind, upstream } = sync
  const items: ChipItem[] = [
    { key: 'fetch', label: 'Fetch', right: <kbd className="mx-place-key">{FETCH_HINT}</kbd>, checked: false, onPick: () => { run('fetch') } },
    { key: 'pull', label: `Pull ${commits(behind)}`, checked: false, disabled: behind === 0, onPick: () => { run('pull') } },
    { key: 'push', label: `Push ${commits(ahead)}`, checked: false, disabled: ahead === 0, onPick: () => { run('push') } },
  ]
  return (
    <ChipMenu
      title="Sync with origin"
      summary={face(state)}
      chevron={false}
      triggerClass="mx-place-chip"
      width={WIDTH}
      icon={<span className={running === null ? 'mx-place-icon' : 'mx-place-icon is-spinning'}><Icon name="refresh" size={12} /></span>}
      label={<span className="mx-place-text">{face(state)}</span>}
      header={<PlaceHead mono main={`${branch} ⇄ ${upstream ?? 'no upstream'}`} sub={`${String(behind)} to pull · ${String(ahead)} to push · ${fetchedLine(state.fetchedAt)}`} />}
      sections={[{ heading: 'Remote', quiet: true, items }]}
    />
  )
}
