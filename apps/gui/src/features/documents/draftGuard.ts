import { useSyncExternalStore } from 'react'

/**
 * The one place that knows which documents hold unsaved edits. A viewer registers while its draft differs from the
 * file; every way a document can go away (its pane closing, its session ending, another file taking its pane) asks
 * `guardDrafts` first, so nothing is thrown away without the person saying so.
 */

/** Where a draft lives: the pane that shows it, and the session whose checkout the file belongs to. */
export type DraftOwner = { readonly paneId: string | null; readonly sessionId: string | null }

export type DraftHandle = {
  readonly path: string
  readonly owner: DraftOwner
  /** Writes the draft; false when it did not land (a conflict or an error the viewer shows). */
  save: () => Promise<boolean>
  /** Throws the draft away and shows the file as it is on disk. */
  discard: () => void
}

const handles = new Map<string, DraftHandle>()

/** Registers a draft until the returned function is called. */
export function registerDraft(id: string, handle: DraftHandle): () => void {
  handles.set(id, handle)
  return () => { if (handles.get(id) === handle) handles.delete(id) }
}

export function draftsMatching(matches: (owner: DraftOwner) => boolean): DraftHandle[] {
  return [...handles.values()].filter((handle) => matches(handle.owner))
}

export function hasDrafts(): boolean {
  return handles.size > 0
}

export const inPane = (paneId: string) => (owner: DraftOwner) => owner.paneId === paneId
export const ofSessions = (ids: ReadonlySet<string>) => (owner: DraftOwner) => owner.sessionId !== null && ids.has(owner.sessionId)

type Ask = { readonly drafts: readonly DraftHandle[]; readonly resolve: (goOn: boolean) => void }

let pending: Ask | null = null
const listeners = new Set<() => void>()
function publish(next: Ask | null) {
  pending = next
  for (const listener of listeners) listener()
}

/** What the dialog shows: the open question, if there is one. */
export function useDraftAsk(): { drafts: readonly DraftHandle[]; answer: (goOn: boolean) => void } | null {
  const ask = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => pending)
  return ask === null ? null : { drafts: ask.drafts, answer: (goOn) => { publish(null); ask.resolve(goOn) } }
}

/** Asks about these drafts; true when the caller may go on (each was saved or discarded), false for "keep editing". */
export function askAboutDrafts(drafts: readonly DraftHandle[]): Promise<boolean> {
  if (drafts.length === 0) return Promise.resolve(true)
  // One question at a time: a second one while the first is open is answered "keep editing".
  if (pending !== null) return Promise.resolve(false)
  return new Promise((resolve) => { publish({ drafts, resolve }) })
}

/** Saves each draft in turn; stops and says false at the first that did not land. */
export async function saveAll(drafts: readonly DraftHandle[]): Promise<boolean> {
  for (const draft of drafts) {
    if (!(await draft.save())) return false
    release(draft)
  }
  return true
}

export function discardAll(drafts: readonly DraftHandle[]): void {
  for (const draft of drafts) {
    draft.discard()
    release(draft)
  }
}

/** A saved or discarded draft is no longer one at once, so the close that follows is not asked about it again. */
function release(draft: DraftHandle): void {
  for (const [id, handle] of handles) if (handle === draft) handles.delete(id)
}

/** Runs `go` now when no draft is in the way, else after the person's answer; never when they keep editing. */
export function guardDrafts(matches: (owner: DraftOwner) => boolean, go: () => void): void {
  const drafts = draftsMatching(matches)
  if (drafts.length === 0) { go(); return }
  void askAboutDrafts(drafts).then((goOn) => { if (goOn) go() })
}
