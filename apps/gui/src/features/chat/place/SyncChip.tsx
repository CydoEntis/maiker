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

/** `Pull 2 commits`, or just `Pull` while there is nothing to move. */
const moveWords = (verb: string, count: number) => (count === 0 ? verb : `${verb} ${String(count)} commit${count === 1 ? '' : 's'}`)

/** The menu's second line: what is waiting each way, then how old the last fetch is. */
function standing(behind: number, ahead: number, fetchedAt: number | null): string {
  return `${behind > 0 ? `${String(behind)} to pull` : 'Up to date'}${ahead > 0 ? ` · ${String(ahead)} to push` : ''} · ${fetchedLine(fetchedAt)}`
}

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
    { key: 'fetch', label: 'Fetch', icon: <Icon name="refresh" size={13} />, right: <kbd className="mx-place-key">{FETCH_HINT}</kbd>, checked: false, onPick: () => { run('fetch') } },
    { key: 'pull', icon: <Icon name="arrowDown" size={13} />, label: moveWords('Pull', behind), checked: false, disabled: behind === 0, onPick: () => { run('pull') } },
    { key: 'push', icon: <Icon name="arrowUp" size={13} />, label: moveWords('Push', ahead), checked: false, disabled: ahead === 0, onPick: () => { run('push') } },
  ]
  return (
    <ChipMenu
      title="Sync with origin"
      summary={face(state)}
      chevron={false}
      variant="place"
      triggerClass="mx-place-chip"
      width={WIDTH}
      icon={<span className={running === null ? 'mx-place-icon' : 'mx-place-icon is-spinning'}><Icon name="refresh" size={12} /></span>}
      label={<span className="mx-place-text">{face(state)}</span>}
      header={<PlaceHead mono main={`${branch} ⇄ ${upstream ?? 'no upstream'}`} sub={standing(behind, ahead, state.fetchedAt)} />}
      sections={[{ heading: 'Remote', quiet: true, items }]}
    />
  )
}
