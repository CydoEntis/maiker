import { useNow } from '@/lib/clock'
import { formatAge } from '@/features/workspace/model/tracking'

/** How long ago `at` was ("3 s", "14 min", "2 h"); re-renders on its own each second. */
export function Since({ at }: { at: number }) {
  const now = useNow()
  return <>{formatAge(Math.max(0, now - at))}</>
}
