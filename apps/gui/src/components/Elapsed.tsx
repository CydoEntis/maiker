import { useNow } from '@/lib/clock'
import { formatElapsed } from '@/lib/working-since'

/** Reads the shared second clock, so a running timer re-renders itself and not the surrounding app. */
export function Elapsed({ since }: { since: number }) {
  const now = useNow()
  return <span className="elapsed">{formatElapsed(now - since)}</span>
}
