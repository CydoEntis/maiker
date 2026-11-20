import { useEffect, useState } from 'react'
import { listFolders } from '@/api/folders'
import { LOCAL_MACHINE } from '@/api/machines'
import { joinPath } from '@/features/workspace/model/folderPick'
import { SCAN_FOLDERS, SCAN_TIMEOUT_MS, withTimeout } from '@/features/welcome/useHomeSuggestions'

/** A git project found on this computer: its folder's name and path, and the branch it is on. */
export type FoundProject = { name: string; path: string; branch: string }

/** The most projects offered; the rest are one search in Browse away. */
const MOST_FOUND = 12

async function projectsIn(folder: string): Promise<FoundProject[]> {
  const listing = await withTimeout(listFolders(LOCAL_MACHINE, folder), SCAN_TIMEOUT_MS)
  if (listing === null || !listing.exists) return []
  return listing.entries.flatMap((entry) => (entry.git === null ? [] : [{ name: entry.name, path: joinPath(listing.path, entry.name), branch: entry.git }]))
}

/**
 * The git projects directly inside the home folder and inside the shortlisted folders under it (`SCAN_FOLDERS`): one level
 * each, never a walk of the disk, and a folder that does not answer in time adds nothing. Empty until the scan ends.
 */
export function useFoundProjects(home: string): readonly FoundProject[] {
  const [found, setFound] = useState<readonly FoundProject[]>([])
  useEffect(() => {
    if (home === '') return undefined
    let stopped = false
    const places = [home, ...SCAN_FOLDERS.map((name) => joinPath(home, name))]
    void Promise.all(places.map(projectsIn)).then((scanned) => {
      if (stopped) return
      const unique = new Map(scanned.flat().map((project) => [project.path, project]))
      setFound([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MOST_FOUND))
    })
    return () => { stopped = true }
  }, [home])
  return found
}
