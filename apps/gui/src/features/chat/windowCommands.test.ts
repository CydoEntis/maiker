import { describe, expect, it } from 'vitest'
import type { SlashCommand } from './slashCommands'
import { ASKS_FIRST, typedCommand, windowRouteOf, withWindowRoutes } from './windowCommands'

const command = (name: string, terminal?: true): SlashCommand => ({ name, description: '', hint: '', aliases: [], ...(terminal === undefined ? {} : { terminal }) })

describe('the commands the window answers itself', () => {
  it('opens the window\'s own screen for a command typed alone, by its name or another name for it', () => {
    expect(windowRouteOf('diff')).toEqual({ kind: 'panel', view: 'changes' })
    expect(windowRouteOf('undo')).toEqual({ kind: 'panel', view: 'history' })
    expect(windowRouteOf('allowed-tools')).toEqual({ kind: 'settings', section: 'permissions' })
    expect(windowRouteOf('resume')).toEqual({ kind: 'recent' })
    expect(windowRouteOf('help')).toEqual({ kind: 'commands' })
  })

  it('signs Claude in from a card instead of the terminal, and still leaves /logout to the terminal', () => {
    expect(windowRouteOf('login')).toEqual({ kind: 'signIn', agent: 'claude' })
    expect(windowRouteOf('login', 'x')).toBeNull()
    expect(windowRouteOf('logout')).toBeNull()
    const [login] = withWindowRoutes([command('login', true)])
    expect(login?.terminal).toBeUndefined()
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

  it('asks Claude Code beside the conversation for a reporting command typed alone, and for /btw with its question', () => {
    expect(windowRouteOf('context')).toEqual({ kind: 'aside', title: 'Context', ask: { command: 'context' } })
    expect(windowRouteOf('skill-doctor')).toEqual({ kind: 'aside', title: 'Skills', ask: { command: 'skill-doctor' } })
    expect(windowRouteOf('btw', '  which file?  ')).toEqual({ kind: 'aside', title: 'Side question', ask: { question: 'which file?' } })
    expect(windowRouteOf('btw')).toEqual({ kind: 'complete', text: '/btw ' })
    expect(windowRouteOf('config', 'editor=vim')).toBeNull()
    expect(windowRouteOf('advisor', 'opus')).toBeNull()
    expect(windowRouteOf('mobile')?.kind).toBe('note')
  })

  it('renames for /rename with a name, and leaves /rename alone to Claude Code, which makes one up', () => {
    expect(windowRouteOf('rename', ' tax fix ')).toEqual({ kind: 'rename', name: 'tax fix' })
    expect(windowRouteOf('rename')).toBeNull()
  })
})

