import { describe, expect, it } from 'vitest'
import { syncFace, syncMenu, type SyncStanding } from './syncMenu'

const BASE: SyncStanding = { branch: 'red-kite', upstream: 'origin/red-kite', counts: { ahead: 1, behind: 2 }, fetched: '4m ago', running: null }
const item = (standing: SyncStanding, key: string) => syncMenu(standing).items.find((entry) => entry.key === key)

describe('the sync menu', () => {
  it('offers Fetch, Pull and Push, with how many commits each would move', () => {
    const menu = syncMenu(BASE)
    expect(menu.items.map((entry) => entry.key)).toEqual(['fetch', 'pull', 'push'])
    expect(item(BASE, 'pull')?.label).toContain('2')
    expect(item(BASE, 'push')?.label).toContain('1')
    expect(menu.items.every((entry) => !entry.disabled)).toBe(true)
    expect(menu.head).toContain('red-kite')
    expect(menu.head).toContain('origin/red-kite')
    expect(menu.sub).toContain('4m ago')
  })

  it('turns off a move with nothing to move, and keeps Fetch', () => {
    const level: SyncStanding = { ...BASE, counts: { ahead: 0, behind: 0 } }
    expect(item(level, 'fetch')?.disabled).toBe(false)
    expect(item(level, 'pull')?.disabled).toBe(true)
    expect(item(level, 'push')?.disabled).toBe(true)
  })

  it('offers every move without a number where the commits are not counted', () => {
    const uncounted: SyncStanding = { ...BASE, upstream: null, counts: null, fetched: null }
    const menu = syncMenu(uncounted)
    expect(menu.items.every((entry) => !entry.disabled)).toBe(true)
    expect(menu.items.some((entry) => /\d/.test(entry.label))).toBe(false)
    expect(syncFace(uncounted)).not.toMatch(/\d/)
  })

  it('offers nothing while a move runs, and the chip says which', () => {
    const pulling: SyncStanding = { ...BASE, running: 'pull' }
    expect(syncMenu(pulling).items.every((entry) => entry.disabled)).toBe(true)
    expect(syncFace(pulling)).not.toBe(syncFace(BASE))
  })

  it('shows on the chip only the directions that have commits waiting', () => {
    expect(syncFace(BASE)).toMatch(/2.*1/)
    expect(syncFace({ ...BASE, counts: { ahead: 0, behind: 3 } })).toMatch(/^\S*3$/)
    expect(syncFace({ ...BASE, counts: { ahead: 0, behind: 0 } })).not.toMatch(/\d/)
  })
})
