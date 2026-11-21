import { loadFolderBranches } from '@/api/folderGit'
import { listFolders } from '@/api/folders'
import type { ListedWorktree } from './model/projectWorktrees'

/** What a project's machine says of its repository's worktrees: the linked ones, or that the folder is not in git. */
export type ProjectWorktreesRead = { readonly kind: 'not-a-repo' } | { readonly kind: 'listed'; readonly worktrees: readonly ListedWorktree[] }

/**
 * The linked worktrees of the repository at `folder` on a machine (this computer is machine 0), asked of that machine's
 * own daemon, so no session is needed. Git still lists a worktree whose folder was deleted by hand and the listing does not
 * say so, so each folder is looked for on the same machine (`listFolders`, which answers "not there" rather than failing).
 * Rejects with the machine's reason when the repository could not be read.
 */
export async function readProjectWorktrees(machine: number, folder: string): Promise<ProjectWorktreesRead> {
  const listing = await loadFolderBranches(machine, folder)
  if (listing === null) return { kind: 'not-a-repo' }
  const linked = listing.worktrees.filter((worktree) => !worktree.main)
  const worktrees = await Promise.all(linked.map(async ({ path, branch }) => ({ path, branch, present: (await listFolders(machine, path)).exists })))
  return { kind: 'listed', worktrees }
}
