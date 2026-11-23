import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSidebarFolds, writeSidebarFolds } from './sidebarFolds'

const KEY = 'maiker.gui.sidebar-folds.v1'

describe('the folded sidebar headings kept in this window', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads back what was written', () => {
    writeSidebarFolds(['machine:devbox', 'project:this computer:C:\\dev\\shop'])
    expect(readSidebarFolds()).toEqual(['machine:devbox', 'project:this computer:C:\\dev\\shop'])
  })

  it('reads nothing folded when nothing is kept, or what is kept is not a list of keys', () => {
    expect(readSidebarFolds()).toEqual([])
    localStorage.setItem(KEY, '{not json')
    expect(readSidebarFolds()).toEqual([])
    localStorage.setItem(KEY, JSON.stringify({ folded: 1 }))
    expect(readSidebarFolds()).toEqual([])
  })

  it('does not throw when the storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => { writeSidebarFolds(['machine:devbox']) }).not.toThrow()
  })
})
