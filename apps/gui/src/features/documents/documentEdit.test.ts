import { describe, expect, it } from 'vitest'
import { isDirty, mayOverwrite, modesOffered, needsConfirmToLeave, usableMode } from './documentEdit'

describe('what editing may do next', () => {
  it('is dirty only when the draft differs from the saved text', () => {
    expect(isDirty('a', 'a')).toBe(false)
    expect(isDirty('a ', 'a')).toBe(true)
  })

  it('asks before leaving an edit only when work would be lost', () => {
    expect(needsConfirmToLeave('edit', 'new', 'old')).toBe(true)
    expect(needsConfirmToLeave('edit', 'same', 'same')).toBe(false)
    expect(needsConfirmToLeave('drawn', 'new', 'old')).toBe(false)
  })

  it('offers Edit only to a file that can be saved', () => {
    expect(modesOffered(true)).toEqual(['drawn', 'source', 'edit'])
    expect(modesOffered(false)).toEqual(['drawn', 'source'])
    expect(usableMode('edit', false)).toBe('drawn')
    expect(usableMode('source', false)).toBe('source')
  })

  it('overwrites only when the person chose to after a conflict', () => {
    expect(mayOverwrite({ kind: 'changed' }, true)).toBe(true)
    expect(mayOverwrite({ kind: 'changed' }, false)).toBe(false)
    expect(mayOverwrite({ kind: 'idle' }, true)).toBe(false)
    expect(mayOverwrite({ kind: 'failed', message: 'x' }, true)).toBe(false)
  })
})
