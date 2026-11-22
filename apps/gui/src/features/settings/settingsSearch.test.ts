import { describe, expect, it } from 'vitest'
import { groupShowsWhole, matchesQuery, rowIsResult } from './settingsSearch'

describe('searching settings', () => {
  it('finds any part of a text, whatever its case, and everything for an empty search', () => {
    expect(matchesQuery('Dark theme', 'dark')).toBe(true)
    expect(matchesQuery('Use the DARK one', ' dark ')).toBe(true)
    expect(matchesQuery('Light theme', 'dark')).toBe(false)
    expect(matchesQuery('Light theme', '  ')).toBe(true)
  })

  it('shows a group whole when its page or its title matched', () => {
    expect(groupShowsWhole('Appearance', 'Theme', 'appear')).toBe(true)
    expect(groupShowsWhole('Appearance', 'Theme', 'theme')).toBe(true)
    expect(groupShowsWhole('Appearance', 'Theme', 'folder')).toBe(false)
  })

  it('keeps a row by its label or its detail, and every row of a group shown whole', () => {
    const row = { label: 'Reduce motion', detail: 'Turns off pulses and slide-ins.' }
    expect(rowIsResult(row, 'motion', false)).toBe(true)
    expect(rowIsResult(row, 'pulses', false)).toBe(true)
    expect(rowIsResult(row, 'folder', false)).toBe(false)
    expect(rowIsResult(row, 'folder', true)).toBe(true)
    expect(rowIsResult({ label: 'Text size' }, 'size', false)).toBe(true)
  })
})
