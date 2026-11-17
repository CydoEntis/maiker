import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmAdd, loadExtensions, previewAdd, removeExtension, setPluginEnabled, splitCommandLine, type ExtAdd, type ExtTarget } from './extensions'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag?: number }) => Promise<unknown>>(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handlers.set(name, handler)
    return Promise.resolve(() => undefined)
  },
}))

/** Waits for the question to be sent, then answers it on the `extensions` event with the tag it was given. */
async function answer(answer: unknown) {
  await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
  const tag = shell.invoke.mock.lastCall?.[1].tag
  shell.handlers.get('extensions')?.({ payload: { machine: 0, tag, answer } })
}

const TARGET: ExtTarget = { agent: 'Claude', kind: 'Plugin', id: 'hello@local-mk', scope: 'User', project: null }
const PREVIEW = { token: 'abc', agent: 'Claude', kind: 'McpServer', name: 'docs', scope: 'User', source: 'Typed in this window', runs: ['npx -y srv'], hosts: [] }

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('reading what is installed', () => {
  it('asks for the user and one project, and reads the list', async () => {
    const asked = loadExtensions('/work/app')
    await answer({ Ok: { List: { items: [{ agent: 'Claude', kind: 'Plugin', scope: 'User', id: 'hello@local-mk', name: 'hello', detail: 'version 1.0.0', enabled: false }], problems: ['claude/settings.json is not valid JSON'] } } })
    await expect(asked).resolves.toEqual({
      ok: true,
      value: { items: [{ agent: 'Claude', kind: 'Plugin', scope: 'User', id: 'hello@local-mk', name: 'hello', detail: 'version 1.0.0', enabled: false }], problems: ['claude/settings.json is not valid JSON'] },
    })
    expect(shell.invoke).toHaveBeenCalledWith('extensions', { request: { List: { project: '/work/app' } }, tag: expect.any(Number) as number })
  })

  it('reads a list from an older shape that has no problems', async () => {
    const asked = loadExtensions(null)
    await answer({ Ok: { List: { items: [] } } })
    await expect(asked).resolves.toEqual({ ok: true, value: { items: [], problems: [] } })
  })

  it('says it was another question\'s answer when the reply is not a list', async () => {
    const asked = loadExtensions(null)
    await answer({ Ok: { Done: 'x' } })
    await expect(asked).resolves.toMatchObject({ ok: false, failure: { line: 'The service gave an answer to another question' } })
  })
})

describe('adding', () => {
  const add: ExtAdd = { Mcp: { agent: 'Claude', name: 'docs', run: { Command: { command: 'npx', args: ['-y', 'srv'] } }, scope: 'User', project: null } }

  it('previews first and sends nothing that installs', async () => {
    const asked = previewAdd(add)
    await answer({ Ok: { Preview: PREVIEW } })
    await expect(asked).resolves.toEqual({ ok: true, value: PREVIEW })
    expect(shell.invoke).toHaveBeenCalledWith('extensions', { request: { PreviewAdd: { add } }, tag: expect.any(Number) as number })
  })

  it('runs an add only with the token the preview gave', async () => {
    const asked = confirmAdd('abc')
    await answer({ Ok: { Done: 'docs added' } })
    await expect(asked).resolves.toEqual({ ok: true, value: 'docs added' })
    expect(shell.invoke).toHaveBeenCalledWith('extensions', { request: { Add: { token: 'abc' } }, tag: expect.any(Number) as number })
  })
})

describe('changing', () => {
  it('turns a plugin on or off', async () => {
    const asked = setPluginEnabled(TARGET, false)
    await answer({ Ok: { Done: 'hello@local-mk turned off' } })
    await expect(asked).resolves.toEqual({ ok: true, value: 'hello@local-mk turned off' })
    expect(shell.invoke).toHaveBeenCalledWith('extensions', { request: { SetEnabled: { target: TARGET, enabled: false } }, tag: expect.any(Number) as number })
  })

  it('removes what the list showed', async () => {
    const asked = removeExtension(TARGET)
    await answer({ Ok: { Done: 'hello@local-mk removed' } })
    await expect(asked).resolves.toEqual({ ok: true, value: 'hello@local-mk removed' })
    expect(shell.invoke).toHaveBeenCalledWith('extensions', { request: { Remove: { target: TARGET } }, tag: expect.any(Number) as number })
  })
})

describe('why a request changed nothing', () => {
  it.each([
    ['NotFound', 'That is not there any more. Refresh the list and try again.', null],
    ['AlreadyInstalled', 'That is already installed.', null],
    [{ CliMissing: 'Codex' }, 'Codex is not installed on this computer, so it cannot be changed here.', null],
    [{ CliTooOld: 'Claude' }, 'This version of Claude Code does not have that command. Update Claude Code and try again.', null],
    [{ NeedsTerminal: 'claude mcp login docs' }, 'This one needs a terminal. Run this command in a terminal:', 'claude mcp login docs'],
    [{ Invalid: 'A plugin is written name@marketplace' }, 'A plugin is written name@marketplace', null],
    [{ Failed: 'boom' }, 'boom', null],
    [{ Failed: '' }, 'The agent said no.', null],
  ])('says %j in plain words', async (said, line, terminal) => {
    const asked = removeExtension(TARGET)
    await answer({ Err: said })
    await expect(asked).resolves.toEqual({ ok: false, failure: { line, terminal } })
  })

  it('says a confirmation that ran out must be started again', async () => {
    const asked = confirmAdd('old')
    await answer({ Err: 'NeedsConfirmation' })
    const told = await asked
    expect(!told.ok && told.failure.line).toContain('Start it again')
  })

  it('rejects with the host\'s own words when the question could not be sent', async () => {
    shell.invoke.mockRejectedValue(new Error('no daemon'))
    await expect(loadExtensions(null)).rejects.toThrow('no daemon')
  })
})

describe('reading a typed command line', () => {
  it('splits on spaces and keeps what is quoted together', () => {
    expect(splitCommandLine('npx -y @scope/server --flag=1')).toEqual({ command: 'npx', args: ['-y', '@scope/server', '--flag=1'] })
    expect(splitCommandLine('  node "my server.js"  \'a b\' ')).toEqual({ command: 'node', args: ['my server.js', 'a b'] })
    expect(splitCommandLine('echo ""')).toEqual({ command: 'echo', args: [''] })
  })

  it('refuses nothing to run and an open quote', () => {
    expect(splitCommandLine('   ')).toBeNull()
    expect(splitCommandLine('node "unclosed')).toBeNull()
  })
})
