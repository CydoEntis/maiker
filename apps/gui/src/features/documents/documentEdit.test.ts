import { describe, expect, it } from 'vitest'
import { type FileFacts, mayOverwrite, modeAskedBy, modesOffered, needsConfirmToLeave, shownMode } from './documentEdit'

const file = (facts: Partial<FileFacts> = {}): FileFacts => ({ markdown: false, changed: false, readable: true, canEdit: true, ...facts })

describe('the modes a file offers', () => {
  it('offers only the modes that apply to the file', () => {
    expect(modesOffered(file())).toEqual(['file', 'edit'])
    expect(modesOffered(file({ changed: true }))).toEqual(['changes', 'file', 'edit'])
    expect(modesOffered(file({ markdown: true }))).toEqual(['preview', 'file', 'edit'])
    expect(modesOffered(file({ markdown: true, changed: true }))).toEqual(['preview', 'changes', 'file', 'edit'])
  })

  it('offers Edit only to a file that can be saved', () => {
    expect(modesOffered(file({ markdown: true, canEdit: false }))).toEqual(['preview', 'file'])
  })

  it('offers only the diff of a file whose text cannot be read from here: a deleted one, or another machine’s code', () => {
    expect(modesOffered(file({ changed: true, readable: false }))).toEqual(['changes'])
    expect(modesOffered(file({ readable: false }))).toEqual([])
  })
})

describe('the mode a file opens in', () => {
  const changedCode = modesOffered(file({ changed: true }))
  const changedDocument = modesOffered(file({ markdown: true, changed: true }))

  it('opens a file picked in Changes as its diff, and one picked in Files as itself, changed or not', () => {
    expect(shownMode(modeAskedBy('changes'), changedCode)).toBe('changes')
    expect(shownMode(modeAskedBy('files'), changedCode)).toBe('file')
    expect(shownMode(modeAskedBy('files'), changedDocument)).toBe('preview')
  })

  it('opens the way last chosen for the file when it still offers it, else the first way to read it', () => {
    expect(shownMode('file', changedDocument)).toBe('file')
    expect(shownMode('preview', changedCode)).toBe('file')
    expect(shownMode('changes', modesOffered(file()))).toBe('file')
  })

  it('never opens straight into the editor unasked, and shows the diff when that is all there is', () => {
    expect(shownMode(null, modesOffered(file()))).toBe('file')
    expect(shownMode(null, modesOffered(file({ changed: true, readable: false })))).toBe('changes')
    expect(shownMode('file', [])).toBeNull()
  })
})

describe('what editing may do next', () => {
  it('asks before leaving an edit only when work would be lost', () => {
    expect(needsConfirmToLeave('edit', 'new', 'old')).toBe(true)
    expect(needsConfirmToLeave('edit', 'same', 'same')).toBe(false)
    expect(needsConfirmToLeave('preview', 'new', 'old')).toBe(false)
  })

  it('overwrites only when the person chose to after a conflict', () => {
    expect(mayOverwrite({ kind: 'changed' }, true)).toBe(true)
    expect(mayOverwrite({ kind: 'changed' }, false)).toBe(false)
    expect(mayOverwrite({ kind: 'idle' }, true)).toBe(false)
    expect(mayOverwrite({ kind: 'failed', message: 'x' }, true)).toBe(false)
  })
})
