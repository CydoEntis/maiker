import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu, type ChipItem } from '@/features/workspace/components/NewChatMenus'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { ago } from '@/features/inspect/format'
import type { SyncAction } from '@/features/inspect/api'
import { PlaceHead } from './PlaceHead'
import { syncFace, syncMenu } from './syncMenu'
import type { SessionSync } from './useSessionSync'

const WIDTH = 300
const ICON: Readonly<Record<SyncAction, 'refresh' | 'arrowDown' | 'arrowUp'>> = { fetch: 'refresh', pull: 'arrowDown', push: 'arrowUp' }

/**
 * The sync chip under the chat box of a session that has run nothing: how far the branch is from its upstream, and
 * Fetch, Pull and Push (`syncMenu`). On another machine the commits are not counted, so the chip says only `Sync`.
 */
export function SyncChip({ state, branch }: { state: SessionSync; branch: string }) {
  const { sync, running, run } = state
  const standing = { branch, upstream: sync?.upstream ?? null, counts: sync === null ? null : { ahead: sync.ahead, behind: sync.behind }, fetched: state.fetchedAt === null ? null : ago(state.fetchedAt, nowSeconds()), running }
  const face = syncFace(standing)
  const menu = syncMenu(standing)
  const items: ChipItem[] = menu.items.map((item) => ({
    key: item.key,
    label: item.label,
    icon: <Icon name={ICON[item.key]} size={13} />,
    checked: false,
    disabled: item.disabled,
    onPick: () => { run(item.key) },
  }))
  return (
    <ChipMenu
      title="Sync with origin"
      summary={face}
      chevron={false}
      variant="place"
      triggerClass="mx-place-chip"
      width={WIDTH}
      icon={<span className={running === null ? 'mx-place-icon' : 'mx-place-icon is-spinning'}><Icon name="refresh" size={12} /></span>}
      label={<span className="mx-place-text">{face}</span>}
      header={<PlaceHead mono main={menu.head} sub={menu.sub} />}
      sections={[{ heading: 'Remote', quiet: true, items }]}
    />
  )
}
