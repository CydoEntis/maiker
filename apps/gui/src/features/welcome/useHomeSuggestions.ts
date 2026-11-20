import { useEffect, useState } from 'react'
import { listFolders } from '@/api/folders'
import { LOCAL_MACHINE } from '@/api/machines'

export type HomeSuggestion = { path: string; detail: string }

/** The only folders looked into, one level deep: never a walk of the whole home folder. */
export const SCAN_FOLDERS = ['code', 'projects', 'dev', 'src', 'work'] as const
/** How long the scan may take before the suggestions that came in are all there is. */
export const SCAN_TIMEOUT_MS = 2000

const gitCount = (count: number): string => `${String(count)} git project${count === 1 ? '' : 's'}`

const joinPath = (home: string, name: string): string => `${home.replace(/[\\/]+$/, '')}${home.includes('\\') && !home.includes('/') ? '\\' : '/'}${name}`

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { resolve(null) }, ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(null) },
    )
  })
}

async function scanOne(home: string, name: string): Promise<HomeSuggestion | null> {
  const path = joinPath(home, name)
  const listing = await withTimeout(listFolders(LOCAL_MACHINE, path), SCAN_TIMEOUT_MS)
  if (listing === null || !listing.exists) return null
  return { path, detail: gitCount(listing.entries.filter((entry) => entry.git !== null).length) }
}

/**
 * Folders worth offering as the home directory: the home folder itself, the one saved before, and the shortlisted
 * folders under home that exist, with how many git projects each holds. A folder that does not answer in time is left out.
 */
export function useHomeSuggestions(home: string, saved: string): readonly HomeSuggestion[] {
  const [found, setFound] = useState<readonly HomeSuggestion[]>([])
  useEffect(() => {
    if (home === '') return undefined
    let stopped = false
    void Promise.all(SCAN_FOLDERS.map((name) => scanOne(home, name))).then((scanned) => {
      if (!stopped) setFound(scanned.filter((entry): entry is HomeSuggestion => entry !== null))
    })
    return () => { stopped = true }
  }, [home])
  if (home === '') return []
  const own: HomeSuggestion[] = [{ path: home, detail: 'Your user folder' }]
  if (saved !== '' && saved !== home && !found.some((entry) => entry.path === saved)) own.push({ path: saved, detail: 'Saved earlier' })
  return [...found, ...own]
}
