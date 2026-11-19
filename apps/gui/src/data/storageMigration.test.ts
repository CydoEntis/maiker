import { beforeEach, describe, expect, it } from 'vitest'
import { MIGRATED_MARKER, currentKeyFor, migrateLegacyStorage } from './storageMigration'

const dump = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])))

beforeEach(() => { localStorage.clear() })

describe('migrateLegacyStorage', () => {
  it('copies every maitty.* key to its maiker.* name and keeps the old one', () => {
    localStorage.setItem('maitty.gui.settings.v1', '{"accent":"blue"}')
    localStorage.setItem('maitty.documentModes', '{"a":"edit"}')
    localStorage.setItem('maitty.inspect.width.v4', '320')
    localStorage.setItem('maitty.clone-into.github.com', '/code')
    migrateLegacyStorage()
    expect(localStorage.getItem('maiker.gui.settings.v1')).toBe('{"accent":"blue"}')
    expect(localStorage.getItem('maiker.documentModes')).toBe('{"a":"edit"}')
    expect(localStorage.getItem('maiker.inspect.width.v4')).toBe('320')
    expect(localStorage.getItem('maiker.clone-into.github.com')).toBe('/code')
    expect(localStorage.getItem('maitty.gui.settings.v1')).toBe('{"accent":"blue"}')
  })

  it('never overwrites a value already stored under the new name', () => {
    localStorage.setItem('maitty.gui.settings.v1', 'old')
    localStorage.setItem('maiker.gui.settings.v1', 'new')
    migrateLegacyStorage()
    expect(localStorage.getItem('maiker.gui.settings.v1')).toBe('new')
  })

  it('runs once: a key the person reset is not brought back, and a second run changes nothing', () => {
    localStorage.setItem('maitty.gui.welcomed.v1', '1')
    migrateLegacyStorage()
    localStorage.removeItem('maiker.gui.welcomed.v1')
    migrateLegacyStorage()
    expect(localStorage.getItem('maiker.gui.welcomed.v1')).toBeNull()
    expect(localStorage.getItem(MIGRATED_MARKER)).toBe('1')
    const snapshot = dump()
    migrateLegacyStorage()
    expect(dump()).toBe(snapshot)
  })

  it('leaves keys that were never ours alone and works on empty storage', () => {
    localStorage.setItem('other.key', 'x')
    migrateLegacyStorage()
    expect(localStorage.getItem('other.key')).toBe('x')
    expect(localStorage.length).toBe(2)
  })

  it('does not throw when storage refuses', () => {
    const broken = { length: 0, key: () => null, getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } } as unknown as Storage
    expect(() => { migrateLegacyStorage(broken) }).not.toThrow()
  })

  it('names the new key for an old one only', () => {
    expect(currentKeyFor('maitty.gui.layout.v3')).toBe('maiker.gui.layout.v3')
    expect(currentKeyFor('maiker.gui.layout.v3')).toBeNull()
  })
})
