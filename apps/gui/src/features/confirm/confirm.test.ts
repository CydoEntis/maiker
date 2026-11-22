import { describe, expect, it } from 'vitest'
import { asksFirst, canSkip, CONFIRM_KINDS, confirmAsk, discardAsk, skippedConfirmsOf, withSkipped, type SkippedConfirms } from './confirm'

describe('the remembered "Don\'t ask again"', () => {
  it('asks about every kind until one is skipped, and then only that kind runs without asking', () => {
    const none: SkippedConfirms = []
    expect(CONFIRM_KINDS.every((kind) => asksFirst(none, kind))).toBe(true)
    const skipped = withSkipped(none, 'close-session')
    expect(asksFirst(skipped, 'close-session')).toBe(false)
    expect(CONFIRM_KINDS.filter((kind) => asksFirst(skipped, kind))).toEqual(CONFIRM_KINDS.filter((kind) => kind !== 'close-session'))
  })

  it('never stops asking about a kind that cannot be skipped, whatever was saved', () => {
    const fixed = CONFIRM_KINDS.filter((kind) => !canSkip(kind))
    expect(fixed).toContain('delete-new-file')
    for (const kind of fixed) {
      expect(withSkipped([], kind)).toEqual([])
      expect(asksFirst(CONFIRM_KINDS, kind)).toBe(true)
      expect(skippedConfirmsOf([kind])).toEqual([])
    }
  })

  it('keeps one entry for a kind skipped twice', () => {
    const once = withSkipped([], 'switch-view')
    expect(withSkipped(once, 'switch-view')).toBe(once)
  })

  it('reads a saved list, dropping what is not a kind, and reads anything else as nothing saved', () => {
    expect(skippedConfirmsOf(['close-project', 'no-such-kind', 3])).toEqual(['close-project'])
    expect(skippedConfirmsOf('close-session')).toBeNull()
    expect(skippedConfirmsOf(undefined)).toBeNull()
  })
})

describe('what closing a project asks', () => {
  it('names the sessions that stop with it, counts past three, and says the folder stays', () => {
    expect(confirmAsk('close-project', { name: 'shop', running: [] })).toMatchObject({ title: 'Close shop?', body: 'It leaves the sidebar.', confirmLabel: 'Close project', danger: true })
    expect(confirmAsk('close-project', { name: 'shop', running: ['Fix tests'] }).body).toBe('Fix tests stops, and the project leaves the sidebar.')
    expect(confirmAsk('close-project', { name: 'shop', running: ['A', 'B'] }).body).toBe('A and B stop, and the project leaves the sidebar.')
    expect(confirmAsk('close-project', { name: 'shop', running: ['A', 'B', 'C', 'D', 'E'] }).body).toBe('A, B, C and 2 more stop, and the project leaves the sidebar.')
    expect(confirmAsk('close-project', { name: 'shop', running: [] }).note).toContain('stay on disk')
  })
})

describe('what a discard asks', () => {
  const edited = discardAsk({ path: 'src/cart/total.ts', change: 'edited' })
  const deleted = discardAsk({ path: 'src/cart/total.ts', change: 'deleted' })
  const added = discardAsk({ path: 'src/cart/total.ts', change: 'new' })

  it('names the file, and is a danger question whatever changed', () => {
    for (const ask of [edited, deleted, added]) {
      expect(ask.title).toContain('total.ts')
      expect(ask.body).toContain('src/cart/total.ts')
      expect(ask.danger).toBe(true)
    }
  })

  it('asks about a new file as a deletion of its own, which can never be skipped', () => {
    expect(added.kind).not.toBe(edited.kind)
    expect(canSkip(added.kind)).toBe(false)
    expect(added.title).not.toBe(edited.title)
    expect(added.confirmLabel).not.toBe(edited.confirmLabel)
    expect(`${added.body} ${added.note ?? ''}`).toMatch(/delete/i)
  })

  it('asks about an edited and a deleted file under one kind that can be skipped, in different words', () => {
    expect(deleted.kind).toBe(edited.kind)
    expect(canSkip(edited.kind)).toBe(true)
    expect(deleted.body).not.toBe(edited.body)
  })
})
