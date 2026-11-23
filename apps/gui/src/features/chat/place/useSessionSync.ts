import { useCallback, useEffect, useState } from 'react'
import { folderSyncState, type FolderSync } from '@/api/daemon'
import { syncRemote, type SyncAction } from '@/features/inspect/api'
import { remoteAction } from '@/features/inspect/remoteAction'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { toast } from '@/lib/toast'

export type SessionSync = {
  /** Where the checkout stands; null on another machine, whose commits the daemon does not count. */
  sync: FolderSync | null
  /** Unix seconds of the last fetch this window made, null before one. */
  fetchedAt: number | null
  /** The move in progress. */
  running: SyncAction | null
  run: (action: SyncAction) => void
}

type Where = {
  folder: string
  machine: number
  /** The session's pane, which names the checkout on another machine. */
  term: number
  project: string
  /** `counted`: this computer's folder, whose state is read. `uncounted`: another machine's checkout, which can be synced but not counted. `none`: nothing to sync. */
  reading: 'counted' | 'uncounted' | 'none'
  branch: string | null
}

/**
 * How the session's checkout stands against its upstream, and the three moves on it. The daemon answers ahead and behind
 * only for this computer's folders; another machine's checkout has the moves without the counts (`sync` null), so a
 * number is never shown that was not read. Null where there is nothing to sync, or this computer's folder could not be
 * read. Each move ends in a toast; a pull that cannot fast-forward says so and changes nothing (it is never forced).
 */
export function useSessionSync({ folder, machine, term, project, reading, branch }: Where): SessionSync | null {
  const readable = reading === 'counted'
  const [sync, setSync] = useState<FolderSync | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [running, setRunning] = useState<SyncAction | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (!readable || folder === '') return undefined
    const stop = new AbortController()
    void (async () => {
      try {
        const state = await folderSyncState(folder, false)
        if (!stop.signal.aborted) setSync(state)
      } catch (error) {
        console.warn('Could not read where the folder stands against its upstream', error)
      }
    })()
    return () => { stop.abort() }
  }, [folder, readable, branch, reads])
  const run = useCallback((action: SyncAction) => {
    if ((sync === null && reading !== 'uncounted') || running !== null) return
    const blocked = action === 'pull' && sync !== null ? remoteAction(sync.ahead, sync.behind).blocked : null
    if (blocked !== null) {
      toast.warning('Pull needs your say', { context: project, description: blocked })
      return
    }
    setRunning(action)
    syncRemote(folder, action, machine, term)
      .then((said) => {
        if (action !== 'push') setFetchedAt(nowSeconds())
        toast.success(said, { context: project })
        setReads((count) => count + 1)
      })
      .catch((error: unknown) => { toast.failed(`Could not ${action}`, error, { context: project }) })
      .finally(() => { setRunning(null) })
  }, [sync, running, folder, machine, term, project, reading])
  if (reading === 'none' || folder === '') return null
  if (reading === 'uncounted') return { sync: null, fetchedAt, running, run }
  return sync === null ? null : { sync, fetchedAt, running, run }
}
