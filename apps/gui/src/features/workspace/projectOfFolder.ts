import { loadFolderBranches } from '@/api/folderGit'
import type { OpenedProject } from './model/openedProjects'

/**
 * The project a folder on a machine opens as. A folder in git opens its repository's main checkout, because every session
 * in that repository (a linked worktree's too) is placed under the main checkout (`groupByProject`); any other folder
 * opens itself. The machine's own daemon reads the folder, so this rejects with that machine's reason when it cannot
 * (no such folder, no permission), and then nothing is to be opened.
 */
export async function projectOfFolder(machine: number, machineName: string | null, folder: string): Promise<OpenedProject> {
  const listing = await loadFolderBranches(machine, folder)
  const main = listing?.worktrees.find((worktree) => worktree.main)
  return { machineName, folder: main?.path ?? folder }
}
