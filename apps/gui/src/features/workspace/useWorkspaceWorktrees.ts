import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { loadFolderBranches } from '@/api/folderGit'
import { LOCAL_MACHINE } from '@/api/machines'
import { explainError } from '@/lib/error-message'
import { removeWorktrees, worktreeStanding, type WorktreesRemoved } from '@/features/worktrees/api'
import type { SessionView } from './model/session'
import { worktreeRows, worktreesInUse, type StandingRead, type WorktreesRead } from './model/workspacePanel'

const STANDING_FAILED = 'Could not check where the worktree stands'

/**
 * The worktrees of the project at `folder` on this computer, for its Workspace panel: the list first, from the daemon's
 * own git read (`loadFolderBranches`, no session needed), then each linked worktree's standing, asked one by one in the
 * background so a slow `gh` never holds the list. The standing shares its cache with the worktree manager. A worktree
 * one of `sessions` (the window's, on any project) runs in is marked. `retry` reads the list again after it failed;
 * `remove` removes worktrees with this computer's daemon and then reads the list and their standings again.
 */
export function useWorkspaceWorktrees(folder: string, sessions: readonly SessionView[]): {
  read: WorktreesRead
  retry: () => void
  remove: (items: readonly { path: string; force: boolean }[]) => Promise<WorktreesRemoved>
} {
  const client = useQueryClient()
  const listKey = ['workspace-worktrees', LOCAL_MACHINE, folder]
  const listing = useQuery({ queryKey: listKey, queryFn: () => loadFolderBranches(LOCAL_MACHINE, folder), retry: false })
  const listed = listing.data?.worktrees ?? []
  const linked = listed.filter((worktree) => !worktree.main)
  // The daemon is asked with the main checkout as the repository, as the worktree manager asks it.
  const repo = listed.find((worktree) => worktree.main)?.path ?? folder
  const standings = useQueries({
    queries: linked.map((worktree) => ({
      queryKey: ['worktree-standing', LOCAL_MACHINE, worktree.path],
      queryFn: () => worktreeStanding(repo, worktree.path, LOCAL_MACHINE),
      retry: false,
    })),
  })
  // Reset rather than refetch, so the section says it is looking again instead of keeping the failure up meanwhile.
  const retry = () => { void client.resetQueries({ queryKey: listKey }) }
  const remove = async (items: readonly { path: string; force: boolean }[]) => {
    try {
      return await removeWorktrees(items, LOCAL_MACHINE)
    } finally {
      // The list first, so a removed worktree has left it before its standing goes stale and is not asked again.
      await client.invalidateQueries({ queryKey: listKey })
      await Promise.all(items.map((item) => client.invalidateQueries({ queryKey: ['worktree-standing', LOCAL_MACHINE, item.path] })))
    }
  }
  const standingOf = (path: string): StandingRead => {
    const query = standings[linked.findIndex((worktree) => worktree.path === path)]
    if (query?.data !== undefined) return { kind: 'read', standing: query.data }
    if (query?.isError === true) return { kind: 'failed', why: explainError(query.error, STANDING_FAILED).reason }
    return { kind: 'checking' }
  }
  // A list already read stays up when a later read of it fails.
  if (listing.data === undefined) return { read: listing.isError ? { kind: 'failed' } : { kind: 'loading' }, retry, remove }
  if (listing.data === null) return { read: { kind: 'not-a-repo' }, retry, remove }
  const inUse = worktreesInUse(listing.data.worktrees, sessions, LOCAL_MACHINE)
  return { read: { kind: 'listed', rows: worktreeRows(listing.data.worktrees, standingOf, inUse) }, retry, remove }
}
