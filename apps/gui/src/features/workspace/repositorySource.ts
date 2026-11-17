import { listRepositories, rescanRepositories, type RepositoryList } from '@/api/repositories'
import type { RepositoryIndex, RepositorySource } from './model/folderPick'

/** The daemon says 0 for "not known"; the picker says null. */
function knownOrNull(seconds: number): number | null {
  return seconds > 0 ? seconds : null
}

/** One machine's answer in the picker's shape, with unknown times as null so an unused repository is not "recent". */
export function toRepositoryIndex(list: RepositoryList): RepositoryIndex {
  return {
    repos: list.repos.map((repo) => ({ path: repo.path, branch: repo.branch, lastUsed: knownOrNull(repo.lastUsed) })),
    indexedAt: knownOrNull(list.indexedAt),
  }
}

/** Where the folder picker's Repositories tab reads the daemon's repository index. */
export const REPOSITORY_SOURCE: RepositorySource | null = {
  list: async (machine) => toRepositoryIndex(await listRepositories(machine)),
  rescan: async (machine) => toRepositoryIndex(await rescanRepositories(machine)),
}
