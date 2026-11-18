import { describe, expect, it } from 'vitest'
import { FOLDER_NAME_MAX_BYTES, folderNameProblem } from './folderName'

describe('what a new folder may be called', () => {
  it.each(['notes', 'my project', 'app-2', 'v1.2', '.config', 'ünï', '日本語', 'a.b.c', 'CONSOLE', 'com10'])('accepts %s', (name) => {
    expect(folderNameProblem(name, [])).toBeNull()
  })

  it.each([
    ['', 'Type a name'],
    ['.', 'cannot be called'],
    ['..', 'cannot be called'],
    ['a/b', 'one folder, not a path'],
    ['a\\b', 'one folder, not a path'],
    ['../x', 'one folder, not a path'],
    ['a:b', 'cannot hold any of'],
    ['a*b', 'cannot hold any of'],
    ['a?b', 'cannot hold any of'],
    [' a', 'start or end with a space'],
    ['a ', 'start or end with a space'],
    ['a.', 'end with a dot'],
    ['tab\there', 'control or hidden'],
    ['zero​width', 'control or hidden'],
    ['con', 'device'],
    ['NUL', 'device'],
    ['Lpt9.txt', 'device'],
    ['aux.log', 'device'],
  ])('refuses %j with words', (name, words) => {
    expect(folderNameProblem(name, [])).toContain(words)
  })

  it('counts the length in bytes, as the daemon does', () => {
    expect(folderNameProblem('a'.repeat(FOLDER_NAME_MAX_BYTES), [])).toBeNull()
    expect(folderNameProblem('a'.repeat(FOLDER_NAME_MAX_BYTES + 1), [])).toContain('too long')
    expect(folderNameProblem('é'.repeat(Math.ceil(FOLDER_NAME_MAX_BYTES / 2)), [])).toContain('too long')
  })

  it('refuses a name already in the folder, whatever its case', () => {
    expect(folderNameProblem('Notes', ['notes', 'src'])).toBe('A folder called Notes is already here.')
    expect(folderNameProblem('docs', ['notes', 'src'])).toBeNull()
  })
})
