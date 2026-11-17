import { describe, expect, it } from 'vitest'
import { commandIntent, foundNothing } from './commandIntent'

describe('reading a command as what it does', () => {
  it.each([
    ['rg -n "useChatFeed" src', 'Search', '"useChatFeed" in src'],
    ['grep -rn TODO', 'Search', '"TODO"'],
    ['cd /repo && rg -t ts -n foo apps/gui', 'Search', '"foo" in apps/gui'],
    ['cat src/main.ts', 'Read', 'src/main.ts'],
    ['head -n 40 README.md', 'Read', 'README.md'],
    ["sed -n '10,80p' src/a.ts", 'Read', 'src/a.ts lines 10–80'],
    ['ls -la apps', 'List', 'apps'],
    ['ls', 'List', 'the folder'],
    ['find src -name "*.ts"', 'Find files in', 'src'],
    ['git status --short', 'Check', 'git status'],
    ['git diff HEAD~1', 'Read', 'the git diff'],
    ['cargo test -p maitty-core', 'Run tests', 'cargo test -p maitty-core'],
    ['pnpm test', 'Run tests', 'pnpm test'],
  ])('%s', (command, verb, target) => {
    expect(commandIntent(command)).toMatchObject({ verb, target })
  })

  it('shows anything that does more than one plain thing as typed', () => {
    expect(commandIntent('rg foo | head')).toBeNull()
    expect(commandIntent('cat a > b')).toBeNull()
    expect(commandIntent('rm -rf build')).toBeNull()
    expect(commandIntent('npm install')).toBeNull()
    expect(commandIntent("sed -i 's/a/b/' file")).toBeNull()
    expect(commandIntent('')).toBeNull()
  })
})

describe('a search that found nothing', () => {
  const step = { command: 'rg -n missing src', exitCode: 1, output: '', status: 'failed' as const }

  it('is an answer, not a failure', () => {
    expect(foundNothing(step)).toBe(true)
  })

  it('is still a failure with output, another exit code, or another command', () => {
    expect(foundNothing({ ...step, output: 'rg: src: No such file or directory' })).toBe(false)
    expect(foundNothing({ ...step, exitCode: 2 })).toBe(false)
    expect(foundNothing({ ...step, command: 'make' })).toBe(false)
  })
})
