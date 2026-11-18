import { type DocumentMode, isDocumentMode } from './documentEdit'

const KEY = 'maitty.documentModes'
const MAX_REMEMBERED = 200

type Remembered = Record<string, DocumentMode>

function read(): Remembered {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, DocumentMode] => isDocumentMode(entry[1])))
  } catch {
    return {}
  }
}

/** A key for one file of one checkout: the folder, then the path. */
export const modeKey = (root: string, path: string): string => `${root}\u0000${path}`

/** The mode last chosen for a file, or `drawn`. A per-person convenience; a blocked store just forgets. */
export function rememberedMode(key: string): DocumentMode {
  return read()[key] ?? 'drawn'
}

/** Remembers the mode, but never `edit`: a file reopens to reading, not to an editor that might hold a stale text. */
export function rememberMode(key: string, mode: DocumentMode): void {
  try {
    const all = read()
    all[key] = mode === 'edit' ? 'drawn' : mode
    const kept = Object.entries(all).slice(-MAX_REMEMBERED)
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Private windows and blocked storage: the choice lasts until the viewer closes.
  }
}
