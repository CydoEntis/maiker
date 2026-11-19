import { describe, expect, it } from 'vitest'
import { folderNameOf, nextLabel } from './setup'

describe('setup model', () => {
  it('names the primary button for each state', () => {
    expect(nextLabel(0, null, null, null)).toBe('Get started')
    expect(nextLabel(1, null, null, null)).toBe('Pick one to continue')
    expect(nextLabel(1, 'chat', null, null)).toBe('Continue')
    expect(nextLabel(2, 'chat', 'folder', null)).toBe('Pick a folder')
    expect(nextLabel(2, 'chat', 'folder', 'api')).toBe('Start in api')
  })
  it('takes the project name from the last path part', () => {
    expect(folderNameOf('~/code/acme-store/')).toBe('acme-store')
    expect(folderNameOf('C:\\work\\api')).toBe('api')
    expect(folderNameOf('  ')).toBeNull()
  })
})
