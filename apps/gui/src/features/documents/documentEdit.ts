/** What the editor may do next, decided from plain values so it can be tested without a screen. */

export type DocumentMode = 'drawn' | 'source' | 'edit'

export const DOCUMENT_MODES: readonly DocumentMode[] = ['drawn', 'source', 'edit']

export function isDocumentMode(value: unknown): value is DocumentMode {
  return value === 'drawn' || value === 'source' || value === 'edit'
}

/** Whether the draft differs from what was last read or saved. */
export function isDirty(draft: string, saved: string): boolean {
  return draft !== saved
}

/** Leaving the edit (closing the pane, picking another file, switching mode) needs a question only when work would be lost. */
export function needsConfirmToLeave(mode: DocumentMode, draft: string, saved: string): boolean {
  return mode === 'edit' && isDirty(draft, saved)
}

/** The modes a viewer offers: Edit only when the daemon can save with a version check and the file is on this computer. */
export function modesOffered(canEdit: boolean): readonly DocumentMode[] {
  return canEdit ? DOCUMENT_MODES : DOCUMENT_MODES.filter((mode) => mode !== 'edit')
}

/** The mode a stored choice becomes when the viewer cannot offer it. */
export function usableMode(mode: DocumentMode, canEdit: boolean): DocumentMode {
  return modesOffered(canEdit).includes(mode) ? mode : 'drawn'
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
