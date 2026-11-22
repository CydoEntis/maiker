import { describe, expect, it } from 'vitest'
import { baseName, isPathQuery, isRoot, joinPath, niceOf, parentOf } from './folderPick'

describe('folder paths', () => {
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

  it('takes text that starts with a slash, a tilde or a drive as a path to go to', () => {
    expect(isPathQuery('/srv')).toBe(true)
    expect(isPathQuery('~/code')).toBe(true)
    expect(isPathQuery('D:\\x')).toBe(true)
    expect(isPathQuery('maitty')).toBe(false)
  })
})
