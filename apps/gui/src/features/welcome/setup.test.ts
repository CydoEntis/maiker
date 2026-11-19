import { describe, expect, it } from 'vitest'
import { folderNameOf, nextLabel } from './setup'

describe('setup model', () => {
  it('names the primary button for each state', () => {
    expect(nextLabel(0, null, null)).toBe('Get started')
    expect(nextLabel(1, null, null)).toBe('Pick one to continue')
    expect(nextLabel(1, 'folder', null)).toBe('Pick a folder')
    expect(nextLabel(1, 'folder', 'api')).toBe('Start in api')
  })
  it('takes the project name from the last path part', () => {
    expect(folderNameOf('~/code/acme-store/')).toBe('acme-store')
    expect(folderNameOf('C:\\work\\api')).toBe('api')
    expect(folderNameOf('  ')).toBeNull()
  })
})
