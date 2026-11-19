import { describe, expect, it } from 'vitest'
import { chatAvailability, effectiveView, noChatReason, openViewFor } from './chatView'

const LINK = { conversation: 7, generation: 2 }

describe('chatAvailability', () => {
  it('is ready for a Claude or Codex session the daemon holds a conversation for', () => {
    expect(chatAvailability({ agent: 'claude', chat: LINK })).toEqual({ kind: 'ready', agent: 'claude', link: LINK })
    expect(chatAvailability({ agent: 'Codex', chat: LINK })).toEqual({ kind: 'ready', agent: 'codex', link: LINK })
  })

  it('says there are no events for a supported agent without a conversation', () => {
    expect(chatAvailability({ agent: 'claude', chat: null })).toEqual({ kind: 'no-events', agent: 'claude' })
  })

  it('leaves a plain shell and other agents terminal-only', () => {
    expect(chatAvailability({ agent: null, chat: null })).toEqual({ kind: 'shell' })
    expect(chatAvailability({ agent: 'opencode', chat: LINK })).toEqual({ kind: 'unsupported', agent: 'opencode' })
  })

  it('gives Gemini CLI the same chat as Claude and Codex, read from its transcript', () => {
    expect(chatAvailability({ agent: 'gemini', chat: LINK })).toEqual({ kind: 'ready', agent: 'gemini', link: LINK })
    expect(chatAvailability({ agent: 'Gemini', chat: null })).toEqual({ kind: 'no-events', agent: 'gemini' })
  })

  it('gives a session of another machine the chat its daemon holds, kept apart by the key', () => {
    const remote = { conversation: 2 * 2 ** 32 + 7, generation: 2, machine: 'build' }
    expect(chatAvailability({ agent: 'claude', chat: remote })).toEqual({ kind: 'ready', agent: 'claude', link: remote })
    expect(chatAvailability({ agent: 'claude', chat: remote }).kind).toBe('ready')
  })
})

describe('effectiveView', () => {
  it('shows every agent session that has or will have a chat in the view the whole app is in', () => {
    expect(effectiveView({ kind: 'ready', agent: 'claude', link: LINK }, 'chat')).toBe('chat')
    expect(effectiveView({ kind: 'ready', agent: 'codex', link: LINK }, 'terminal')).toBe('terminal')
    expect(effectiveView({ kind: 'no-events', agent: 'claude' }, 'chat')).toBe('chat')
  })

  it('keeps Gemini in its terminal whatever the app is set to', () => {
    expect(effectiveView({ kind: 'ready', agent: 'gemini', link: LINK }, 'chat')).toBe('terminal')
    expect(openViewFor('gemini', 'chat')).toBe('terminal')
  })

  it('keeps a shell and an agent the app does not read in the terminal', () => {
    expect(effectiveView({ kind: 'shell' }, 'chat')).toBe('terminal')
    expect(effectiveView({ kind: 'unsupported', agent: 'opencode' }, 'chat')).toBe('terminal')
  })
})

describe('noChatReason', () => {
  it('names the shell case the way the design does', () => {
    expect(noChatReason({ kind: 'shell' })).toContain('Chat view is for agent sessions')
  })
})
