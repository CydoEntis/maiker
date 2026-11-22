import { useNow } from '@/lib/clock'
import { formatElapsed } from '../model/tracking'

/** A running "0:42" since `since`; re-renders on its own each second. */
export function ElapsedSince({ since, prefix = '' }: { since: number; prefix?: string }) {
  const now = useNow()
  return <>{prefix}{formatElapsed(now - since)}</>
}
