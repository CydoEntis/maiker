/** What the editor may do next, decided from plain values so it can be tested without a screen. */

/** How a file is shown in its pane: drawn (markdown), as its diff, as its text, or in the editor. */
export type FileMode = 'preview' | 'changes' | 'file' | 'edit'

/** Every mode, in the order the pane's header offers them. */
export const FILE_MODES: readonly FileMode[] = ['preview', 'changes', 'file', 'edit']

export function isFileMode(value: unknown): value is FileMode {
  return value === 'preview' || value === 'changes' || value === 'file' || value === 'edit'
}

/** Whether the draft differs from what was last read or saved. */
export function isDirty(draft: string, saved: string): boolean {
  return draft !== saved
}

/** Leaving the edit (closing the pane, picking another file, switching mode) needs a question only when work would be lost. */
export function needsConfirmToLeave(mode: FileMode | null, draft: string, saved: string): boolean {
  return mode === 'edit' && isDirty(draft, saved)
}

/** What decides the modes of a file. */
export type FileFacts = {
  /** Its name says markdown, so it can be drawn. */
  markdown: boolean
  /** It has a diff to show. */
  changed: boolean
  /** Its whole text can be read from here: it still exists, and its machine hands it over (ADR 0014). */
  readable: boolean
  /** The daemon can save it with a version check, and the text read is the file's own. */
  canEdit: boolean
}

/** The modes a file's pane offers; one that does not apply is left out, never shown disabled. */
export function modesOffered({ markdown, changed, readable, canEdit }: FileFacts): readonly FileMode[] {
  const applies: Record<FileMode, boolean> = { preview: markdown && readable, changes: changed, file: readable, edit: readable && canEdit }
  return FILE_MODES.filter((mode) => applies[mode])
}

/** Reading comes before the diff when nothing was asked for: a file picked in Files opens as itself. */
const DEFAULT_ORDER: readonly FileMode[] = ['preview', 'file', 'changes']

/**
 * The mode shown: the one wanted (asked for by what opened the file, or remembered for it) when the file offers it,
 * else the first way to read it; null when the file offers nothing.
 */
export function shownMode(wanted: FileMode | null, offered: readonly FileMode[]): FileMode | null {
  if (wanted !== null && offered.includes(wanted)) return wanted
  return DEFAULT_ORDER.find((mode) => offered.includes(mode)) ?? null
}

/** Two of the daemon's snapshots, whose difference is one turn's changes. */
export type SnapshotSpan = { from: string; to: string }

/**
 * What opened a file asks of its pane: a mode, a line to show, and for a file picked from one turn's changes that
 * turn's snapshots, so the diff shown is the turn's and not the working tree's. A new `key` is a new request, also
 * for the file already open.
 */
export type FileAsk = { mode?: FileMode | null; line?: number; range?: SnapshotSpan; key: number }

/** Where a file was picked, which decides how it opens: the Changes surface opens a file as its diff. */
export type FileSource = 'files' | 'changes'

export function modeAskedBy(source: FileSource): FileMode | null {
  return source === 'changes' ? 'changes' : null
}

/** The width from which the edit mode shows its drawn preview beside the text. */
export const PREVIEW_BESIDE_MIN_PX = 640

export type SaveStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'changed' }
  | { readonly kind: 'failed'; readonly message: string }

/** A conflict is settled by the person only: a draft is never sent over a changed file by itself. */
export function mayOverwrite(step: SaveStep, chose: boolean): boolean {
  return step.kind === 'changed' && chose
}
