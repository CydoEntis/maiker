import type { IconName } from '@/features/workspace/components/glyphs'
import type { SurfaceKind } from './panelTabs'

/** What the panel says about one kind of surface: its tab, and its row in the picker. */
export type Surface = {
  label: string
  icon: IconName
  /** The letter that opens it while the surface picker has the keys. */
  key: string
  /** The picker's line under the name. */
  hint: string
  /** It opens as many tabs as are asked for (a terminal); the others open once and are brought forward after that. */
  many: boolean
}

/**
 * Every surface, in the order the picker lists them. A new surface is one entry here (and its kind in `panelTabs.ts`);
 * the panel's host draws its body.
 */
export const SURFACES: Readonly<Record<SurfaceKind, Surface>> = {
  files: { label: 'Files', icon: 'files', key: 'F', hint: 'Browse and open this project’s files', many: false },
  changes: { label: 'Changes', icon: 'gitChanges', key: 'D', hint: 'What this session changed, as diffs', many: false },
  terminal: { label: 'Terminal', icon: 'terminalBox', key: 'T', hint: 'A shell in this project, here in the panel', many: true },
}

/** The surface a typed letter opens among `offered`, or null. */
export function surfaceForKey(key: string, offered: readonly SurfaceKind[]): SurfaceKind | null {
  const letter = key.toUpperCase()
  return offered.find((kind) => SURFACES[kind].key === letter) ?? null
}
