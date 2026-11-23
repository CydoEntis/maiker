import { loadFolderBranches } from '@/api/folderGit'
import { listFolders } from '@/api/folders'
import type { OpenedProject } from './model/openedProjects'

/**
 * The project a folder on a machine opens as. A folder in git opens its repository's main checkout, because every session
 * in that repository (a linked worktree's too) is placed under the main checkout (`groupByProject`); any other folder
 * opens itself. The machine's own daemon reads the folder, so this rejects with that machine's reason when it cannot
 * (no such folder, no permission), and then nothing is to be opened. A machine that cannot ask git (it has none) still
 * opens a folder it can list, as itself.
 */
export async function projectOfFolder(machine: number, machineName: string | null, folder: string): Promise<OpenedProject> {
  let listing: Awaited<ReturnType<typeof loadFolderBranches>>
  try {
    listing = await loadFolderBranches(machine, folder)
  } catch (gitProblem: unknown) {
    // Git's reason is the one to give when the folder cannot be listed either, so a failed second read adds nothing.
    const read = await listFolders(machine, folder).catch(() => null)
    if (read === null || !read.exists) throw gitProblem
    return { machineName, folder }
  }
  const main = listing?.worktrees.find((worktree) => worktree.main)
  return { machineName, folder: main?.path ?? folder }
}
