import { describe, expect, it } from 'vitest'
import { programColor } from './programColor'

describe('program colour', () => {

  it('takes every colour from the theme, so a theme switch recolours the icons', () => {
    for (let index = 0; index < 40; index += 1) expect(programColor(`tool-${String(index)}`).from).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('never uses amber, which only ever means needs you', () => {
    for (let index = 0; index < 60; index += 1) expect(programColor(`tool-${String(index)}`).from).not.toMatch(/--warn/)
  })
})
