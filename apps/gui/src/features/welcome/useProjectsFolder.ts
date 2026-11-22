import { useCallback, useEffect, useMemo, useState } from 'react'
import { listFolders } from '@/api/folders'
import { LOCAL_MACHINE } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import { detectProjectsFolder, type FolderFound, type FolderOrigin } from './setup'

/** The only folders looked into under home, one level deep: never a walk of the whole home folder. */
export const SCAN_FOLDERS = ['code', 'projects', 'dev', 'src', 'work'] as const
/** How long a folder may take to answer before it is left out. */
export const SCAN_TIMEOUT_MS = 2000

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

/** The git projects directly inside a folder; null for a folder that is not there or did not answer in time. */
async function scanFolder(path: string): Promise<FolderFound | null> {
  const listing = await withTimeout(listFolders(LOCAL_MACHINE, path), SCAN_TIMEOUT_MS)
  if (listing === null || !listing.exists) return null
  return { path, projects: listing.entries.filter((entry) => entry.git !== null).map((entry) => entry.name) }
}

export type ProjectsFolder = {
  /** The folder offered or chosen; empty until the home folder is known. */
  path: string
  /** Why it is this folder; `chosen` once the person picked one. */
  origin: FolderOrigin | 'chosen'
  /** The git projects directly inside it; null while that is being read. */
  projects: readonly string[] | null
  /** The other folders that hold code, to change to. */
  others: readonly FolderFound[]
  choose: (path: string) => void
  /** Opens the system's folder picker and takes what it gives. */
  browse: () => void
  /** Why the picker could not be opened; empty otherwise. */
  note: string
}

/**
 * The projects folder of the first run: the saved one, or the folder under home that holds the most git projects, found
 * by listing a fixed shortlist through the daemon (`list_folders`), each with a time limit. A chosen folder is listed
 * the same way.
 */
export function useProjectsFolder(home: string, saved: string, onChooseFolder: (current: string) => Promise<string | null>): ProjectsFolder {
  const [found, setFound] = useState<readonly FolderFound[] | null>(null)
  const [extra, setExtra] = useState<Readonly<Record<string, readonly string[]>>>({})
  const [chosen, setChosen] = useState<string | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (home === '') return undefined
    let stopped = false
    void Promise.all(SCAN_FOLDERS.map((name) => scanFolder(joinPath(home, name)))).then((scanned) => {
      if (!stopped) setFound(scanned.filter((entry): entry is FolderFound => entry !== null))
    })
    return () => { stopped = true }
  }, [home])

  const offered = useMemo(() => detectProjectsFolder(saved, home, found ?? []), [saved, home, found])
  // A saved folder is offered at once; a detected one only when the shortlist has answered, so the path never changes under the eye.
  const settled = chosen !== null || offered.origin === 'saved' || found !== null
  const path = chosen ?? (settled ? offered.path : '')
  const listed = found?.find((folder) => folder.path === path)?.projects ?? extra[path]

  useEffect(() => {
    if (path === '' || listed !== undefined) return undefined
    let stopped = false
    void scanFolder(path).then((scanned) => {
      if (!stopped) setExtra((current) => ({ ...current, [path]: scanned?.projects ?? [] }))
    })
    return () => { stopped = true }
  }, [path, listed])

  const choose = useCallback((next: string) => { setChosen(next); setNote('') }, [])
  const browse = useCallback(() => {
    onChooseFolder(path).then(
      (picked) => { if (picked !== null) choose(picked) },
      (error: unknown) => { setNote(errorMessage(error, 'Could not open the folder picker')) },
    )
  }, [onChooseFolder, path, choose])

  return {
    path,
    origin: chosen === null ? offered.origin : 'chosen',
    projects: listed ?? null,
    others: (found ?? []).filter((folder) => folder.path !== path && folder.projects.length > 0),
    choose,
    browse,
    note,
  }
}
