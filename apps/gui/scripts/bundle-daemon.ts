import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_COMMAND, DAEMON_NAME } from '../src/brand.ts'

const guiDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDirectory = path.resolve(guiDirectory, '../..')
const release = process.argv.includes('--release')
const profile = release ? 'release' : 'debug'
const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
const extension = process.platform === 'win32' ? '.exe' : ''
const targetDirectory = path.resolve(repositoryDirectory, process.env.CARGO_TARGET_DIR ?? 'target')
const executable = path.join(targetDirectory, profile, `${APP_COMMAND}${extension}`)
const sidecarDirectory = path.join(guiDirectory, 'src-tauri', 'binaries')
const sidecar = path.join(sidecarDirectory, `${DAEMON_NAME}-${targetTriple}${extension}`)

execFileSync('cargo', [
  'build',
  '--manifest-path', path.join(repositoryDirectory, 'Cargo.toml'),
  '-p', APP_COMMAND,
  '--bin', APP_COMMAND,
  ...(release ? ['--release'] : []),
], { cwd: repositoryDirectory, stdio: 'inherit' })

if (!existsSync(executable)) throw new Error(`Cargo did not produce ${executable}`)
mkdirSync(sidecarDirectory, { recursive: true })
// The service a previous dev run started outlives its window and runs from this file, and Linux and macOS refuse to
// write into a running program (ETXTBSY). Renaming a new file over it is allowed: the running service keeps the old
// one until it restarts. Windows refuses both, and scripts/dev.ps1 stops before this while the service runs.
const staged = `${sidecar}.${String(process.pid)}.tmp`
try {
  copyFileSync(executable, staged)
  renameSync(staged, sidecar)
} finally {
  rmSync(staged, { force: true })
}
process.stdout.write(`Prepared daemon sidecar for ${targetTriple}\n`)