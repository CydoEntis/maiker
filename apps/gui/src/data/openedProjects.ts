import { z } from 'zod'
import { openProject, type OpenedProject } from '@/features/workspace/model/openedProjects'

const STORAGE_KEY = 'maiker.gui.opened-projects.v1'

/**
 * Where this computer's projects are kept in the stored record. A machine's name starts with a letter or digit and holds
 * no space (`maitty-machines` `def.rs`), so no other machine can be stored under it.
 */
const THIS_COMPUTER_KEY = 'this computer'

/** Each machine's opened folders, in the order they were opened, by the machine's name. */
const StoredSchema = z.record(z.string(), z.array(z.string()))

/** The opened projects of every machine; an empty list when nothing is kept or it cannot be read. Never throws. */
export function readOpenedProjects(): OpenedProject[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return []
    const parsed = StoredSchema.safeParse(JSON.parse(stored))
    if (!parsed.success) {
      console.warn('Ignoring unsupported Maiker opened projects', parsed.error)
      return []
    }
    let opened: readonly OpenedProject[] = []
    for (const [machine, folders] of Object.entries(parsed.data)) {
      const machineName = machine === THIS_COMPUTER_KEY ? null : machine
      // Through `openProject`, so a folder kept twice (another spelling of it) is listed once.
      for (const folder of folders) opened = openProject(opened, { machineName, folder }).opened
    }
    return [...opened]
  } catch (error) {
    console.warn('Ignoring invalid Maiker opened projects', error)
    return []
  }
}

/** Keeps the opened projects; a failure to write (storage blocked or full) is logged, never thrown. */
export function writeOpenedProjects(opened: readonly OpenedProject[]): void {
  const stored: Record<string, string[]> = {}
  for (const project of opened) {
    const machine = project.machineName ?? THIS_COMPUTER_KEY
    stored[machine] = [...(stored[machine] ?? []), project.folder]
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch (error) {
    console.warn('Could not keep the opened projects', error)
  }
}
