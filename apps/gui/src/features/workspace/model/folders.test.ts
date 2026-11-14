import { describe, expect, it } from 'vitest'
import { parentFolder } from './folders'

describe('the folder a project sits in', () => {
  it('is the path without its last part, on Unix and on Windows', () => {
    expect(parentFolder('/home/me/code/maitty')).toBe('/home/me/code')
    expect(parentFolder('C:\\Users\\me\\code\\maitty')).toBe('C:\\Users\\me\\code')
  })

  it('keeps the root of a folder at the top', () => {
    expect(parentFolder('/maitty')).toBe('/')
    expect(parentFolder('C:\\maitty')).toBe('C:\\')
  })

  it('is nothing for a name with no folder', () => {
    expect(parentFolder('maitty')).toBe('')
  })
})
