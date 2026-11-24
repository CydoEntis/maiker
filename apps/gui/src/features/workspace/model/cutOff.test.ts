import { describe, expect, it } from 'vitest'
import type { Conversation, TerminalDetails } from '@/data/preview'
import { cutOffSessions } from './cutOff'
import { toSessionView } from './session'

const HOME = '/home/casey'

function details(extra: Partial<TerminalDetails> = {}): TerminalDetails {
  return { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, ...extra }
}

function session(id: string, extra: Partial<TerminalDetails> = {}) {
  const conversation: Conversation = {
    id, generation: 1, execution: 'Structured', title: `Claude conversation ${id}`, project: 'app', folder: `${HOME}/app`, cwd: `${HOME}/app`, repo: 'app',
    branch: 'main', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: null, hasDiff: false,
    agent: 'claude', process: 'claude', chat: { conversation: Number(id), generation: 1 }, details: details(extra),
  }
  return toSessionView(conversation, HOME, 0)
}

describe('the sessions a restart cut mid-reply', () => {
  const idle = session('1')
  const cutChat = session('2', { chatCutOff: true })
  const cutTerminal = session('3', { interrupted: { agent: 'claude', resume: 'claude --resume abc' } })

  it('are the chats its daemon lists as cut and the terminal agents it offers a resume for, never an idle one', () => {
    expect(cutOffSessions([idle, cutChat, cutTerminal], new Set()).map((each) => each.id)).toEqual(['2', '3'])
  })

  it('leave out the ones the person put off in this window', () => {
    expect(cutOffSessions([idle, cutChat, cutTerminal], new Set(['2'])).map((each) => each.id)).toEqual(['3'])
  })
})
