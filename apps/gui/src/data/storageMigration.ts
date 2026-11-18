/**
 * The window's saved settings were keyed `maitty.*` before the rename. This copies each one to its `maiker.*` name once, at
 * startup, before anything reads. The old keys are left in place: an older build still installed (or a rollback) reads them,
 * and a copy costs a few kilobytes. A key already present under the new name is never overwritten, and a marker makes the
 * pass run once, so a setting the person later resets is not brought back from the old copy.
 *
 * This is the only source file that names a `maitty.` key (`brand.test.ts` holds the rest of the source to that).
 */
const LEGACY_PREFIX = 'maitty.'
const CURRENT_PREFIX = 'maiker.'
export const MIGRATED_MARKER = `${CURRENT_PREFIX}gui.storageMigrated.v1`

/** The key an old `maitty.` key is now stored under; `null` for one that was never ours. */
export function currentKeyFor(key: string): string | null {
  return key.startsWith(LEGACY_PREFIX) ? CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length) : null
}

/** Copy every `maitty.*` entry to `maiker.*` unless the new one exists; a no-op after the first run. Never throws. */
export function migrateLegacyStorage(storage: Storage = window.localStorage): void {
  try {
    if (storage.getItem(MIGRATED_MARKER) !== null) return
    const legacyKeys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key !== null && currentKeyFor(key) !== null) legacyKeys.push(key)
    }
    for (const key of legacyKeys) {
      const current = currentKeyFor(key)
      const value = storage.getItem(key)
      if (current !== null && value !== null && storage.getItem(current) === null) storage.setItem(current, value)
    }
    storage.setItem(MIGRATED_MARKER, '1')
  } catch {
    // Blocked or full storage: the app starts with defaults, as it does without storage anywhere else, and the next start tries again.
  }
}
