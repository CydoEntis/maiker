import { afterEach, describe, expect, it } from 'vitest'
import { DRAFT_KEPT_MS, readComposerDrafts, writeComposerDrafts } from './composerDrafts'

const NOW = 1_800_000_000_000

afterEach(() => { localStorage.clear() })

describe('kept message drafts', () => {
  it('come back after a restart, by conversation, the new-chat page (-1) too', () => {
    writeComposerDrafts(new Map([[7, { text: 'half a thought', at: NOW }], [-1, { text: 'a new chat', at: NOW }]]))
    const read = readComposerDrafts(NOW + 1000)
    expect(read.get(7)?.text).toBe('half a thought')
    expect(read.get(-1)?.text).toBe('a new chat')
  })

  it('leave out empty and stale drafts, since an old conversation number may name another chat now', () => {
    writeComposerDrafts(new Map([[1, { text: '   ', at: NOW }], [2, { text: 'old', at: NOW - DRAFT_KEPT_MS - 1 }], [3, { text: 'fresh', at: NOW }]]))
    expect([...readComposerDrafts(NOW).keys()]).toEqual([3])
  })

  it('ignore storage that is not theirs', () => {
    localStorage.setItem('maiker.gui.composer-drafts.v1', '{"x": {"text": 1}, "4": "nope", "5": {"text": "ok", "at": 1800000000000}}')
    expect([...readComposerDrafts(NOW).entries()]).toEqual([[5, { text: 'ok', at: NOW }]])
    localStorage.setItem('maiker.gui.composer-drafts.v1', 'not json')
    expect(readComposerDrafts(NOW).size).toBe(0)
  })
})
