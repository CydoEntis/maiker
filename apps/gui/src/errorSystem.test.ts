import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// docs/DESIGN.md, Errors: a failure is a toast from the one helper, a line in the dock, a field's own error, or a
// dialog scoped to what it blocks. Never a banner, never a second toast library.
const sourceDirectory = __dirname

function sourceFiles(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry)
    if (statSync(file).isDirectory()) return sourceFiles(file, pattern)
    return pattern.test(entry) ? [file] : []
  })
}

const appCode = sourceFiles(sourceDirectory, /\.(ts|tsx)$/).filter((file) => !/\.test\.tsx?$/.test(file) && !file.includes(`${path.sep}test${path.sep}`))
const styles = sourceFiles(sourceDirectory, /\.css$/)
const relative = (file: string) => path.relative(sourceDirectory, file)
const offenders = (files: string[], pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(file, 'utf8'))).map(relative)

/** The only files that may draw toasts or hold their state. */
const TOAST_HOME = new Set(['lib/toast.ts', 'components/ui/toaster.tsx'].map((file) => file.split('/').join(path.sep)))

describe('the error system', () => {
  it('has one toast library: the app never imports another', () => {
    expect(offenders([...appCode, ...sourceFiles(sourceDirectory, /\.test\.tsx?$/)], /from ['"](sonner|react-hot-toast|react-toastify)['"]/)).toEqual([])
  })

  it('draws no banner: no banner component and no banner class in code or styles', () => {
    expect(offenders(appCode, /\b[A-Z]\w*Banner\b|mx-banner|maitty-toaster/)).toEqual([])
    expect(offenders(styles, /\.mx-banner|\.mx-offline|\.mx-notice\b|\.maitty-toaster/)).toEqual([])
  })

  it('raises every toast through the helper, never its own store or element', () => {
    const own = appCode.filter((file) => !TOAST_HOME.has(relative(file)))
    expect(offenders(own, /className=["'{`][^"'`]*\bmx-toast\b/)).toEqual([])
    expect(offenders(own, /useSyncExternalStore\([^)]*toast|role=["']status["'][^>]*mx-(note|notice)/i)).toEqual([])
  })

  it('names what failed for a caught error: a raw message in an error toast goes through toast.failed', () => {
    expect(offenders(appCode, /toast\.error\(\s*(errorMessage\(|String\(error\)|\(?error as Error\)?\.message|error\.message)/)).toEqual([])
  })
})
