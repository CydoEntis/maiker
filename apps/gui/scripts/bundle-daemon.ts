import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
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
copyFileSync(executable, sidecar)
process.stdout.write(`Prepared daemon sidecar for ${targetTriple}\n`)