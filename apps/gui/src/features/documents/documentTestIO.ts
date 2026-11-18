import { vi } from 'vitest'
import type { SaveResult } from '@/features/inspect/api'
import type { DocumentIO } from './useDocument'

/** A document on a pretend disk: reads give its text and version, a save is checked against the version like the daemon does. */
export function fakeDisk(initial: string, version = 'v1') {
  const disk = { text: initial, version }
  let counter = 1
  const io: DocumentIO = {
    read: vi.fn(() => Promise.resolve({ text: disk.text, version: disk.version })),
    save: vi.fn((_term: number, _machine: number, _path: string, contents: string, expect: string | null): Promise<SaveResult> => {
      if (expect !== null && expect !== disk.version) return Promise.resolve({ kind: 'changed' })
      counter += 1
      disk.text = contents
      disk.version = `v${String(counter)}`
      return Promise.resolve({ kind: 'saved', version: disk.version })
    }),
  }
  return { io, disk, agentEdits: (text: string) => { disk.text = text; disk.version = 'agent' } }
}
