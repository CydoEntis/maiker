import { describe, expect, it } from 'vitest'
import { chatPermissions, launchFlags, startsBypassed, withBypass } from './newChatHost'


describe('launchFlags', () => {
  it('puts a picked Gemini model on the launch line as -m, and never an effort', () => {
    expect(launchFlags('gemini', 'flash', 'high')).toBe(' -m flash')
    expect(launchFlags('gemini', 'default', 'max')).toBe('')
    expect(launchFlags('gemini', 'bad model; rm -rf', 'default')).toBe('')
  })

  it('puts a picked Claude model and effort on the launch line', () => {
    expect(launchFlags('claude', 'sonnet', 'high')).toBe(' --model sonnet --effort high')
    expect(launchFlags('claude', 'default', 'max')).toBe(' --effort max')
  })

  it('puts a picked Codex model and effort in its own flags', () => {
    expect(launchFlags('codex', 'gpt-5-codex', 'medium')).toBe(' -m gpt-5-codex -c model_reasoning_effort=medium')
  })

  it('sends nothing when nothing was picked', () => {
    expect(launchFlags('claude', 'default', 'default')).toBe('')
    expect(launchFlags('codex', 'default', 'default')).toBe('')
  })

  it('puts Max on the Codex launch line too: the menu only offers it for a model that takes it', () => {
    expect(launchFlags('codex', 'default', 'max')).toBe(' -c model_reasoning_effort=max')
  })

  it('starts Codex in the picked permission mode, and sends nothing for Auto or a mode that is not its own', () => {
    expect(launchFlags('codex', 'default', 'default', 'codexReadOnly')).toBe(' --sandbox read-only --ask-for-approval on-request')
    expect(launchFlags('codex', 'gpt-x', 'default', 'codexFullAccess')).toBe(' --sandbox danger-full-access --ask-for-approval never -m gpt-x')
    expect(launchFlags('codex', 'default', 'default', 'codexAuto')).toBe('')
    expect(launchFlags('codex', 'default', 'default', 'plan')).toBe('')
    expect(launchFlags('claude', 'default', 'default', 'codexReadOnly')).toBe('')
  })

  it('drops a model name that is not plain model-id characters', () => {
    expect(launchFlags('claude', 'x; rm -rf /', 'default')).toBe('')
    expect(launchFlags('codex', '-evil', 'default')).toBe('')
  })
})

describe('Bypass Permissions on the launch line', () => {
  it('adds each agent\'s own flag while its switch is on', () => {
    expect(withBypass('claude', ['--model', 'opus'], true)).toEqual(['--dangerously-skip-permissions', '--model', 'opus'])
    expect(withBypass('codex', [], true)).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(withBypass('gemini', ['-m', 'pro'], true)).toEqual(['--yolo', '-m', 'pro'])
    for (const agent of ['claude', 'codex', 'gemini'] as const) expect(startsBypassed(agent, withBypass(agent, [], true))).toBe(true)
  })

  it('adds nothing while the switch is off, and drops a picked Bypass mode Claude would refuse', () => {
    for (const agent of ['claude', 'codex', 'gemini'] as const) expect(withBypass(agent, [], false)).toEqual([])
    expect(withBypass('claude', ['--permission-mode', 'bypassPermissions', '--effort', 'high'], false)).toEqual(['--effort', 'high'])
    expect(withBypass('claude', ['--permission-mode', 'plan'], false)).toEqual(['--permission-mode', 'plan'])
  })

  it('starts Claude in Bypass by its own flag, and keeps another picked mode with Bypass reachable', () => {
    expect(withBypass('claude', ['--permission-mode', 'bypassPermissions'], true)).toEqual(['--dangerously-skip-permissions'])
    const plan = withBypass('claude', ['--permission-mode', 'plan'], true)
    expect(plan).toEqual(['--allow-dangerously-skip-permissions', '--permission-mode', 'plan'])
    expect(startsBypassed('claude', plan)).toBe(false)
  })
})

describe('the starting permission mode', () => {
  it('goes on a Claude launch line unless it is the default, and never on another agent or an unknown mode', () => {
    expect(launchFlags('claude', 'default', 'default', 'plan')).toBe(' --permission-mode plan')
    expect(launchFlags('claude', 'default', 'default', 'default')).toBe('')
    expect(launchFlags('claude', 'default', 'default', 'rm -rf')).toBe('')
    expect(launchFlags('codex', 'default', 'default', 'plan')).toBe('')
  })
})

describe('what a chat started from the draft may do', () => {
  it('asks first in each agent\'s usual mode, and skips the questions while its Bypass Permissions switch is on', () => {
    expect(chatPermissions('claude', 'default', false)).toBe('workspace-write')
    expect(chatPermissions('codex', 'codexAuto', false)).toBe('workspace-write')
    expect(chatPermissions('claude', 'default', true)).toBe('full-access')
    expect(chatPermissions('codex', 'codexAuto', true)).toBe('full-access')
  })

  it('keeps a narrower mode picked for Claude while the switch is on, and Codex\'s switch wins as it does on its launch line', () => {
    expect(chatPermissions('claude', 'plan', true)).toBe('read-only')
    expect(chatPermissions('codex', 'codexReadOnly', true)).toBe('full-access')
    expect(chatPermissions('codex', 'codexReadOnly', false)).toBe('read-only')
  })

  it('starts Claude in its usual mode when Bypass permissions is picked with the switch off', () => {
    expect(chatPermissions('claude', 'bypassPermissions', false)).toBe('workspace-write')
    expect(chatPermissions('claude', 'bypassPermissions', true)).toBe('full-access')
    expect(chatPermissions('codex', 'codexFullAccess', false)).toBe('full-access')
  })

  it('has no posture for a mode the daemon cannot start a chat in', () => {
    expect(chatPermissions('claude', 'acceptEdits', false)).toBeNull()
    expect(chatPermissions('claude', 'auto', true)).toBeNull()
    expect(chatPermissions('codex', 'nonsense', false)).toBeNull()
  })
})
