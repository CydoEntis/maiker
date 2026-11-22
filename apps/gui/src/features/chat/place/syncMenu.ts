import type { SyncAction } from '@/features/inspect/api'

/**
 * How a checkout stands against its upstream, as the sync chip knows it. `counts` is null where the daemon cannot count
 * (another machine's checkout): the chip then offers the moves without numbers instead of guessing them.
 */
export type SyncStanding = {
  readonly branch: string
  readonly upstream: string | null
  readonly counts: { readonly ahead: number; readonly behind: number } | null
  /** How long ago this window last fetched (`4m ago`); null before it has. */
  readonly fetched: string | null
  readonly running: SyncAction | null
}

export type SyncMenuItem = { readonly key: SyncAction; readonly label: string; readonly disabled: boolean }
export type SyncMenu = { readonly head: string; readonly sub: string; readonly items: readonly SyncMenuItem[] }

const DOING: Readonly<Record<SyncAction, string>> = { fetch: 'Fetching…', pull: 'Pulling…', push: 'Pushing…' }

/** `Pull 2 commits`, or just `Pull` while there is nothing to count. */
const moveWords = (verb: string, count: number): string => (count === 0 ? verb : `${verb} ${String(count)} commit${count === 1 ? '' : 's'}`)

/** What the chip says: the move running, `Synced` when level, the two counts, or just `Sync` where nothing is counted. */
export function syncFace({ counts, running }: Pick<SyncStanding, 'counts' | 'running'>): string {
  if (running !== null) return DOING[running]
  if (counts === null) return 'Sync'
  const { ahead, behind } = counts
  if (ahead === 0 && behind === 0) return 'Synced'
  return [behind > 0 ? `↓${String(behind)}` : '', ahead > 0 ? `↑${String(ahead)}` : ''].filter((part) => part !== '').join(' ')
}

/**
 * The sync menu: the branch against its upstream, what waits each way, and Fetch, Pull and Push. A move with nothing to
 * move is off; where nothing is counted every move is offered, since git itself says when there was nothing to do.
 */
export function syncMenu({ branch, upstream, counts, fetched, running }: SyncStanding): SyncMenu {
  const busy = running !== null
  if (counts === null) {
    return {
      head: branch,
      sub: 'Commits to pull and push are not counted on another machine',
      items: [
        { key: 'fetch', label: 'Fetch', disabled: busy },
        { key: 'pull', label: 'Pull', disabled: busy },
        { key: 'push', label: 'Push', disabled: busy },
      ],
    }
  }
  const { ahead, behind } = counts
  const waiting = `${behind > 0 ? `${String(behind)} to pull` : 'Up to date'}${ahead > 0 ? ` · ${String(ahead)} to push` : ''}`
  return {
    head: `${branch} ⇄ ${upstream ?? 'no upstream'}`,
    sub: `${waiting} · ${fetched === null ? 'not fetched yet' : `fetched ${fetched}`}`,
    items: [
      { key: 'fetch', label: 'Fetch', disabled: busy },
      { key: 'pull', label: moveWords('Pull', behind), disabled: busy || behind === 0 },
      { key: 'push', label: moveWords('Push', ahead), disabled: busy || ahead === 0 },
    ],
  }
}
