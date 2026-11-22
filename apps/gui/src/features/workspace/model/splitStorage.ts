import { parseSplits, type SessionSplits } from './splitTree'

const STORAGE_KEY = 'maiker.gui.session-splits.v1'

/** Each session's split tree (`splitTree.ts`), by the session's id. */
export type SavedSplits = ReadonlyMap<string, SessionSplits>

/**
 * How each session's terminal panes were split last time. Which shells exist, and whose they are, is not kept here
 * (`data/agentTerminals.ts` and the daemon's list say): this is only their arrangement.
 */
export function readSessionSplits(): SavedSplits {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Map()
    return new Map(Object.entries(value).flatMap(([sessionId, raw]): [string, SessionSplits][] => {
      const splits = parseSplits(raw)
      return splits === null ? [] : [[sessionId, splits]]
    }))
  } catch (error) {
    console.warn('Ignoring invalid Maiker session splits', error)
    return new Map()
  }
}

export function writeSessionSplits(splits: SavedSplits): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(splits)))
  } catch (error) {
    console.warn('Could not keep the session splits', error)
  }
}
