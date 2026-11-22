import { z } from 'zod'

const STORAGE_KEY = 'maiker.gui.sidebar-folds.v1'

/** The fold keys of what is folded: project headings and leads' helpers (`projectFoldKey`, `helpersFoldKey`). */
const StoredSchema = z.array(z.string())

/** The headings folded in the sidebar; none when nothing is kept or it cannot be read. Never throws. */
export function readSidebarFolds(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return []
    const parsed = StoredSchema.safeParse(JSON.parse(stored))
    if (parsed.success) return parsed.data
    console.warn('Ignoring unsupported Maiker sidebar folds', parsed.error)
    return []
  } catch (error) {
    console.warn('Ignoring invalid Maiker sidebar folds', error)
    return []
  }
}

/** Keeps the folded headings; a failure to write (storage blocked or full) is logged, never thrown. */
export function writeSidebarFolds(folded: readonly string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folded))
  } catch (error) {
    console.warn('Could not keep the folded sidebar headings', error)
  }
}
