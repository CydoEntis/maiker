import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_COMMAND, DAEMON_NAME, ENV_PREFIX, PREVIOUS_DAEMON_NAMES } from '@/brand'

const guiDirectory = path.resolve(__dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const file = path.join(directory, entry)
    if (statSync(file).isDirectory()) return sourceFiles(file)
    return /\.(ts|tsx)$/.test(entry) ? [file] : []
  })
}

describe('the brand constants', () => {
  it('name a daemon and a prefix that follow no brand', () => {
    expect(DAEMON_NAME).not.toBe('')
    expect(PREVIOUS_DAEMON_NAMES).not.toContain(DAEMON_NAME)
    expect(ENV_PREFIX).toMatch(/^[A-Z]+$/)
    expect(ENV_PREFIX.toLowerCase()).not.toBe(APP_COMMAND)
  })

  it('are the names the Tauri bundle ships the daemon under', () => {
    const config = JSON.parse(readFileSync(path.join(guiDirectory, 'src-tauri/tauri.conf.json'), 'utf8')) as { bundle: { externalBin: string[] } }
    expect(config.bundle.externalBin).toEqual([`binaries/${DAEMON_NAME}`])
  })

  it('are never written out as the daemon name or an old one in the app source', () => {
    const names = [DAEMON_NAME, ...PREVIOUS_DAEMON_NAMES, 'maittyd']
    const written = sourceFiles(path.join(guiDirectory, 'src'))
      .filter((file) => !file.endsWith(`${path.sep}brand.ts`) && !file.endsWith(`${path.sep}brand.test.ts`))
      .filter((file) => names.some((name) => readFileSync(file, 'utf8').includes(name)))
      .map((file) => path.relative(guiDirectory, file))
    expect(written, 'read the daemon name from @/brand').toEqual([])
  })
})
