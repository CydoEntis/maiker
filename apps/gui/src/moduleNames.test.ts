import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceDirectory = path.resolve(__dirname)
const MODULE_FILE = /\.(ts|tsx|js|jsx)$/

/** Every importable module under `directory`, as the path an import names: no extension. */
function moduleIds(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry)
    if (statSync(file).isDirectory()) return moduleIds(file)
    return MODULE_FILE.test(entry) ? [path.relative(sourceDirectory, file).replace(MODULE_FILE, '')] : []
  })
}

describe('module file names', () => {
  // Windows and macOS file systems ignore case, so there `./CoachMark` can load `coachMark.ts` instead of
  // `CoachMark.tsx`: the import finds the wrong module and the app stops before it draws. Linux CI never sees it.
  it('never differ only by case, so an import finds the same file on every system', () => {
    const seen = new Map<string, string>()
    const clashes = moduleIds(sourceDirectory).flatMap((id) => {
      const key = id.toLowerCase()
      const earlier = seen.get(key)
      seen.set(key, id)
      return earlier !== undefined && earlier !== id ? [`${earlier} / ${id}`] : []
    })
    expect(clashes).toEqual([])
  })
})
