import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readOpenedProjects, writeOpenedProjects } from './openedProjects'

const KEY = 'maiker.gui.opened-projects.v1'

describe('the opened projects kept in this window', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads back what was written, keyed by machine name, this computer apart', () => {
    const opened = [
      { machineName: null, folder: '/code/shop' },
      { machineName: 'box', folder: '/srv/api' },
      { machineName: null, folder: 'C:\\dev\\notes' },
    ]

    writeOpenedProjects(opened)

    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual({ 'this computer': ['/code/shop', 'C:\\dev\\notes'], box: ['/srv/api'] })
    expect(readOpenedProjects()).toEqual([opened[0], opened[2], opened[1]])
  })

  it('lists a folder kept twice under two spellings once', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'this computer': ['C:\\dev\\shop', 'c:/DEV/shop/'] }))

    expect(readOpenedProjects()).toEqual([{ machineName: null, folder: 'C:\\dev\\shop' }])
  })

  it('reads nothing kept, broken text or another shape as an empty list', () => {
    expect(readOpenedProjects()).toEqual([])
    localStorage.setItem(KEY, '{broken')
    expect(readOpenedProjects()).toEqual([])
    localStorage.setItem(KEY, JSON.stringify({ box: '/srv/api' }))
    expect(readOpenedProjects()).toEqual([])
    localStorage.setItem(KEY, 'null')
    expect(readOpenedProjects()).toEqual([])
  })

  it('never throws when storage refuses to be read or written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })

    expect(readOpenedProjects()).toEqual([])
    expect(() => { writeOpenedProjects([{ machineName: null, folder: '/code/shop' }]) }).not.toThrow()
  })
})
