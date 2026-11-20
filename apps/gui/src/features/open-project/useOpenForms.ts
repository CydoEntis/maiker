import { useState } from 'react'
import { cloneParentOf, defaultCloneFolder, readGitUrl, type GitUrl, type GitUrlReading } from './repoUrl'

/** Longest address and path the host accepts. */
export const MOST_ADDRESS_CHARS = 2048
export const MOST_PATH_CHARS = 4096
/** A shorter text is still being typed: the field does not complain about it yet. */
const MIN_CHARS_TO_JUDGE = 8

export type UrlForm = {
  url: string
  setUrl: (text: string) => void
  reading: GitUrlReading
  repo: GitUrl | null
  /** What to tell the person about the text; null while it is empty, short, or a repository. */
  complaint: 'credentials' | 'not-a-url' | null
  /** The whole destination the field shows: the home folder and the name, unless it was edited. */
  folder: string
  setFolder: (text: string) => void
  /** The parent folder the daemon is asked to clone inside. */
  parent: string
}

/** The Clone from URL tab's two fields. The destination follows the repository's name until it is typed in. */
export function useUrlForm(home: string): UrlForm {
  const [url, setUrl] = useState('')
  const [edited, setEdited] = useState<string | null>(null)
  const reading = readGitUrl(url)
  const repo = reading.kind === 'repo' ? reading.repo : null
  const folder = edited ?? (repo === null ? '' : defaultCloneFolder(home, repo.name))
  const complaint = reading.kind === 'credentials' || (reading.kind === 'not-a-url' && url.trim().length >= MIN_CHARS_TO_JUDGE) ? reading.kind : null
  return {
    url,
    setUrl: (text) => { setUrl(text); setEdited(null) },
    reading,
    repo,
    complaint,
    folder,
    setFolder: setEdited,
    parent: repo === null ? '' : cloneParentOf(folder, repo.name),
  }
}

export type FolderForm = { folder: string; setFolder: (text: string) => void; ready: boolean }

/** The On this computer tab's one field: the folder to open. */
export function useFolderForm(): FolderForm {
  const [folder, setFolder] = useState('')
  return { folder, setFolder, ready: folder.trim() !== '' }
}
