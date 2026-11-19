import { describe, expect, it } from 'vitest'
import css from './sidebar.css?raw'
import sidebar from './Sidebar.tsx?raw'

// A row whose status changes only moves (`useFlip`); nothing tints it, so there is no class or overlay for a change to add.
describe('a sidebar row whose status changed', () => {
  it('has no flash style or hook left', () => {
    expect(css).not.toContain('is-flashing')
    expect(css).not.toContain('mx-row-flash')
    expect(sidebar).not.toContain('is-flashing')
    expect(sidebar).not.toContain('useStatusFlash')
  })
})
