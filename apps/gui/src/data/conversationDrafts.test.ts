import { beforeEach, describe, expect, it } from 'vitest'
import { readConversationDrafts, writeConversationDrafts } from './conversationDrafts'

describe('conversation drafts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps drafts associated with their conversation', () => {
    const drafts = { 'thread-a': 'Review the changes', 'thread-b': 'Check the build' }
    writeConversationDrafts(drafts)

    expect(readConversationDrafts()).toEqual(drafts)
  })

  it('ignores corrupt draft data', () => {
    localStorage.setItem('maiker.gui.drafts.v1', '{broken')

    expect(readConversationDrafts()).toEqual({})
  })

  it('removes a draft after it is cleared', () => {
    writeConversationDrafts({ 'thread-a': 'Review the changes' })
    writeConversationDrafts({ 'thread-a': '' })

    expect(readConversationDrafts()).toEqual({})
  })
})
