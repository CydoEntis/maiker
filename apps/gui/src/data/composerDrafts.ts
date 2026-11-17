/**
 * The unsent text of each chat's message box, kept in this window's storage so closing or restarting the app never
 * loses what was being written. Only text: attached files are object URLs and paths that do not outlive the window.
 */

const STORAGE_KEY = 'maitty.gui.composer-drafts.v1'
/** A draft not touched for this long is dropped: a conversation number the daemon hands out again names another chat. */
const DAY_MS = 86_400_000
const DAYS_KEPT = 7
export const DRAFT_KEPT_MS = DAYS_KEPT * DAY_MS
/** At most this many drafts, the newest kept, and this many characters each, so storage stays small. */
const MAX_DRAFTS = 50
const MAX_DRAFT_CHARS = 20_000

export type SavedDraft = { readonly text: string; readonly at: number }

/** The drafts kept from earlier, by conversation key, without the ones too old to trust. */
export function readComposerDrafts(now: number): Map<number, SavedDraft> {
  const drafts = new Map<number, SavedDraft>()
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (error) {
    console.warn('Could not read the kept message drafts', error)
    return drafts
  }
  if (raw === null) return drafts
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    console.warn('Ignoring unreadable message drafts', error)
    return drafts
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return drafts
  for (const [key, entry] of Object.entries(value)) {
    const conversation = Number(key)
    if (!Number.isSafeInteger(conversation) || !isSavedDraft(entry)) continue
    if (now - entry.at > DRAFT_KEPT_MS || entry.text.trim() === '') continue
    drafts.set(conversation, { text: entry.text.slice(0, MAX_DRAFT_CHARS), at: entry.at })
  }
  return drafts
}

/** Keeps `drafts` for the next start: the newest `MAX_DRAFTS`, each cut to `MAX_DRAFT_CHARS`. */
export function writeComposerDrafts(drafts: ReadonlyMap<number, SavedDraft>): void {
  const newest = [...drafts.entries()]
    .filter(([, draft]) => draft.text.trim() !== '')
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_DRAFTS)
    .map(([conversation, draft]) => [String(conversation), { text: draft.text.slice(0, MAX_DRAFT_CHARS), at: draft.at }] as const)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)))
  } catch (error) {
    // Full or blocked storage costs only the next start its drafts; the window still holds them.
    console.warn('Could not keep the message drafts', error)
  }
}

function isSavedDraft(value: unknown): value is SavedDraft {
  return typeof value === 'object' && value !== null
    && 'text' in value && typeof value.text === 'string'
    && 'at' in value && typeof value.at === 'number' && Number.isFinite(value.at)
}
