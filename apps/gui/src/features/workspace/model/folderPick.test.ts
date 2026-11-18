import { describe, expect, it } from 'vitest'
import { baseName, crumbsOf, isPathQuery, isRoot, joinPath, niceOf, parentOf, visibleFolders } from './folderPick'

describe('paths in the folder picker', () => {
  it('joins, goes up and names folders with either separator', () => {
    expect(joinPath('/home/me/', 'code')).toBe('/home/me/code')
    expect(joinPath('C:\\Users\\me', 'code')).toBe('C:\\Users\\me\\code')
    expect(parentOf('/home/me/code')).toBe('/home/me')
    expect(parentOf('/home')).toBe('/')
    expect(parentOf('C:\\Users')).toBe('C:\\')
    expect(parentOf('C:\\')).toBe('C:\\')
    expect(isRoot('/')).toBe(true)
    expect(isRoot('D:\\')).toBe(true)
    expect(isRoot('/home')).toBe(false)
    expect(baseName('/home/me/code/')).toBe('code')
  })

  it('writes a path under the home folder with a tilde', () => {
    expect(niceOf('/home/me/code', '/home/me')).toBe('~/code')
    expect(niceOf('/home/me', '/home/me')).toBe('~')
    expect(niceOf('/home/meow', '/home/me')).toBe('/home/meow')
    expect(niceOf('/srv/app', null)).toBe('/srv/app')
  })

  it('builds the clickable parts from the home folder or the root', () => {
    expect(crumbsOf('/home/me/code/app', '/home/me')).toEqual([
      { label: '~', path: '/home/me' }, { label: 'code', path: '/home/me/code' }, { label: 'app', path: '/home/me/code/app' },
    ])
    expect(crumbsOf('/srv/www', '/home/me')).toEqual([{ label: '/', path: '/' }, { label: 'srv', path: '/srv' }, { label: 'www', path: '/srv/www' }])
    expect(crumbsOf('C:\\Work\\app', 'C:\\Users\\me')).toEqual([{ label: 'C:', path: 'C:\\' }, { label: 'Work', path: 'C:\\Work' }, { label: 'app', path: 'C:\\Work\\app' }])
  })

  it('takes text that starts with a slash, a tilde or a drive as a path to go to', () => {
    expect(isPathQuery('/srv')).toBe(true)
    expect(isPathQuery('~/code')).toBe(true)
    expect(isPathQuery('D:\\x')).toBe(true)
    expect(isPathQuery('maitty')).toBe(false)
  })
})

describe('the rows of the folder picker', () => {
  it('sorts folders by name without the leading dot and keeps hidden ones out unless asked or typed', () => {
    const entries = [{ name: 'zeta' }, { name: '.cache' }, { name: 'alpha' }, { name: '.config' }]
    expect(visibleFolders(entries, '', false).map((entry) => entry.name)).toEqual(['alpha', 'zeta'])
    expect(visibleFolders(entries, '', true).map((entry) => entry.name)).toEqual(['alpha', '.cache', '.config', 'zeta'])
    expect(visibleFolders(entries, '.ca', false).map((entry) => entry.name)).toEqual(['.cache'])
  })
})
