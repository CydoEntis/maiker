import type { FileMode } from './documentEdit'

const KEY = 'maiker.documentModes'
const MAX_REMEMBERED = 200

/** The two ways to read a file; the diff and the editor are never what a file reopens to. */
type ReadingMode = Extract<FileMode, 'preview' | 'file'>
type Remembered = Record<string, ReadingMode>

/** A stored choice as a mode; `drawn` and `source` are what the same two were called before. */
function readingMode(value: unknown): ReadingMode | null {
  if (value === 'preview' || value === 'drawn') return 'preview'
  if (value === 'file' || value === 'source') return 'file'
  return null
}

function read(): Remembered {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => { const mode = readingMode(value); return mode === null ? [] : [[key, mode]] }))
  } catch {
    return {}
  }
}

/** A key for one file of one checkout: the folder, then the path. */
export const modeKey = (root: string, path: string): string => `${root}\u0000${path}`

/** The way of reading last chosen for a file, or null. A per-person convenience; a blocked store just forgets. */
export function rememberedMode(key: string): FileMode | null {
  return read()[key] ?? null
}

/** Remembers a way of reading; the editor (it might hold a stale text) and the diff (it goes when the file is committed) are not remembered. */
export function rememberMode(key: string, mode: FileMode): void {
  const reading = readingMode(mode)
  if (reading === null) return
  try {
    const all = read()
    all[key] = reading
    const kept = Object.entries(all).slice(-MAX_REMEMBERED)
    window.localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Private windows and blocked storage: the choice lasts until the viewer closes.
  }
}
