import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: string[] = []
vi.mock('@/api/daemon', () => ({
  resumeChat: vi.fn(() => { calls.push('resume'); return Promise.resolve({ id: 44, generation: 6 }) }),
  readConversationPage: vi.fn(() => { calls.push('read'); return Promise.resolve({ receipt: { operation: 3 }, queued: [{ operation: 4 }] }) }),
  submitMessage: vi.fn(() => { calls.push('send'); return Promise.resolve({}) }),
}))

import { readConversationPage, resumeChat, submitMessage } from '@/api/daemon'
import { CONTINUE_WORDS, continueCutChat } from './continueCutChat'
import type { Conversation } from '@/data/preview'

const chat = { conversation: { id: '44', chat: { conversation: 44, generation: 5 } } as Conversation }

describe('continuing a chat a restart cut', () => {
  beforeEach(() => { calls.length = 0 })

  it('starts it again, then tells it to carry on at its new generation with a number above its earlier messages', async () => {
    await continueCutChat(chat)

    expect(calls).toEqual(['resume', 'read', 'send'])
    expect(vi.mocked(resumeChat)).toHaveBeenCalledWith({ id: '44', generation: 5 })
    expect(vi.mocked(readConversationPage)).toHaveBeenCalledWith(44, null)
    expect(vi.mocked(submitMessage)).toHaveBeenCalledWith({ id: '44', generation: 6 }, 5, CONTINUE_WORDS)
  })

  it('sends nothing when it could not be started again', async () => {
    vi.mocked(resumeChat).mockRejectedValueOnce(new Error('No current conversation'))

    await expect(continueCutChat(chat)).rejects.toThrow('No current conversation')
    expect(calls).toEqual([])
  })

  it('refuses a session that is not a chat', async () => {
    await expect(continueCutChat({ conversation: { id: 't7' } as Conversation })).rejects.toThrow('Only a chat session')
  })
})
