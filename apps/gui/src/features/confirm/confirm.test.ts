import { describe, expect, it } from 'vitest'
import { asksFirst, CONFIRM_KINDS, skippedConfirmsOf, withSkipped, type SkippedConfirms } from './confirm'

describe('the remembered "Don\'t ask again"', () => {
  it('asks about every kind until one is skipped, and then only that kind runs without asking', () => {
    const none: SkippedConfirms = []
    expect(CONFIRM_KINDS.every((kind) => asksFirst(none, kind))).toBe(true)
    const skipped = withSkipped(none, 'close-session')
    expect(asksFirst(skipped, 'close-session')).toBe(false)
    expect(CONFIRM_KINDS.filter((kind) => asksFirst(skipped, kind))).toEqual(CONFIRM_KINDS.filter((kind) => kind !== 'close-session'))
  })

  it('keeps one entry for a kind skipped twice', () => {
    const once = withSkipped([], 'switch-view')
    expect(withSkipped(once, 'switch-view')).toBe(once)
  })

  it('reads a saved list, dropping what is not a kind, and reads anything else as nothing saved', () => {
    expect(skippedConfirmsOf(['remove-project', 'no-such-kind', 3])).toEqual(['remove-project'])
    expect(skippedConfirmsOf('close-session')).toBeNull()
    expect(skippedConfirmsOf(undefined)).toBeNull()
  })
})
