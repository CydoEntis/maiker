import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onCloseAsked } from './useCloseGuard'

const drafts = vi.hoisted(() => ({ has: false, answer: true, asked: 0 }))
vi.mock('@/features/documents/draftGuard', () => ({
  hasDrafts: () => drafts.has,
  draftsMatching: () => [{ owner: { kind: 'file' } }],
  askAboutDrafts: () => { drafts.asked += 1; return Promise.resolve(drafts.answer) },
}))

const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })

describe('closing the window with unsaved documents', () => {
  beforeEach(() => { drafts.has = false; drafts.answer = true; drafts.asked = 0 })

  it('lets the window close at once when nothing is unsaved', () => {
    const event = { preventDefault: vi.fn() }
    const close = vi.fn(() => Promise.resolve())
    onCloseAsked(event, close)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(drafts.asked).toBe(0)
  })

  it('holds the close and asks first, then closes when told to go on', async () => {
    drafts.has = true
    const event = { preventDefault: vi.fn() }
    const close = vi.fn(() => Promise.resolve())
    onCloseAsked(event, close)
    expect(event.preventDefault).toHaveBeenCalled()
    await settle()
    expect(drafts.asked).toBe(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('keeps the window open when you choose to keep editing', async () => {
    drafts.has = true
    drafts.answer = false
    const close = vi.fn(() => Promise.resolve())
    onCloseAsked({ preventDefault: vi.fn() }, close)
    await settle()
    expect(close).not.toHaveBeenCalled()
  })
})
