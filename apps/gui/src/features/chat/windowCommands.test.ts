import { describe, expect, it } from 'vitest'
import type { SlashCommand } from './slashCommands'
import { ASKS_FIRST, typedCommand, windowRouteOf, withWindowRoutes } from './windowCommands'

const command = (name: string, terminal?: true): SlashCommand => ({ name, description: '', hint: '', aliases: [], ...(terminal === undefined ? {} : { terminal }) })

describe('the commands the window answers itself', () => {
  it('opens the window\'s own screen for a command typed alone, by its name or another name for it', () => {
    expect(windowRouteOf('diff')).toEqual({ kind: 'panel', view: 'changes' })
    expect(windowRouteOf('undo')).toEqual({ kind: 'panel', view: 'history' })
    expect(windowRouteOf('allowed-tools')).toEqual({ kind: 'settings', section: 'agents' })
    expect(windowRouteOf('resume')).toEqual({ kind: 'recent' })
    expect(windowRouteOf('help')).toEqual({ kind: 'commands' })
  })

  it('leaves a command typed with something after it to Claude Code, which has a use for what was typed', () => {
    expect(windowRouteOf('resume', 'abc123')).toBeNull()
    expect(windowRouteOf('diff', 'src')).toBeNull()
  })

  it('still asks first for one that ends or empties the session, whatever follows it', () => {
    expect(windowRouteOf('exit')?.kind).toBe('confirm')
    expect(windowRouteOf('bg', 'finish the tests')?.kind).toBe('confirm')
    expect(windowRouteOf('clear')?.kind).toBe('confirm')
  })

  it('leaves every other command to Claude Code', () => {
    expect(windowRouteOf('compact')).toBeNull()
    expect(windowRouteOf('model')).toBeNull()
  })

  it('tags each answered command with where it goes, and no longer as the terminal\'s, except one that only asks first', () => {
    const tagged = withWindowRoutes([command('diff', true), command('exit', true), command('compact')])

    expect(tagged).toEqual([
      { ...command('diff'), opens: 'Changes' },
      { ...command('exit', true), opens: ASKS_FIRST },
      command('compact'),
    ])
  })

  it('splits a typed command into its name and what follows, and reads nothing else as one', () => {
    expect(typedCommand('  /resume  abc ')).toEqual({ name: 'resume', args: 'abc' })
    expect(typedCommand('/diff')).toEqual({ name: 'diff', args: '' })
    expect(typedCommand('show the /diff')).toBeNull()
  })
})
