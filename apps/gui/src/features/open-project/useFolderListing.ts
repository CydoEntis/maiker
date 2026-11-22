import { useCallback, useEffect, useState } from 'react'
import type { FolderListing } from '@/api/folders'
import { errorMessage } from '@/lib/error-message'

/**
 * The one way the palette reads a folder: `machine` is this computer or any other, and which it is makes no difference
 * here. The answer is a listing, or one with `exists` false for a folder that is not there; it rejects when the
 * machine could not be asked.
 */
export type ListFolders = (machine: number, path: string) => Promise<FolderListing>

/** A read shorter than this shows no wait: a flash of it for a local read is noise. */
export const LISTING_WAIT_MS = 160

export type FolderRead =
  | { state: 'idle' }
  | { state: 'reading'; /** True once the read has gone on long enough to say so. */ late: boolean }
  | { state: 'listed'; listing: FolderListing }
  | { state: 'failed'; why: string }

type Answer = { key: string; read: Extract<FolderRead, { state: 'listed' | 'failed' }> }

/**
 * The folders inside `path` on a machine, read again when either changes or `again` is called. With `ask` false nothing
 * is read (a machine known to be away) until `again` forces one try. An answer for a folder since left is never shown.
 */
export function useFolderListing(list: ListFolders, machine: number, path: string, ask: boolean): { read: FolderRead; again: () => void } {
  const [tries, setTries] = useState(0)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [late, setLate] = useState<string | null>(null)
  const key = `${String(machine)}:${path}:${String(tries)}`
  const asking = ask || tries > 0

  useEffect(() => {
    if (!asking) return undefined
    let live = true
    const timer = window.setTimeout(() => { if (live) setLate(key) }, LISTING_WAIT_MS)
    list(machine, path).then(
      (listing) => { if (live) setAnswer({ key, read: { state: 'listed', listing } }) },
      (error: unknown) => { if (live) setAnswer({ key, read: { state: 'failed', why: errorMessage(error, 'The machine did not answer') } }) },
    )
    return () => { live = false; window.clearTimeout(timer) }
  }, [list, machine, path, key, asking])

  const again = useCallback(() => { setTries((count) => count + 1) }, [])
  const read: FolderRead = !asking ? { state: 'idle' } : answer?.key === key ? answer.read : { state: 'reading', late: late === key }
  return { read, again }
}
