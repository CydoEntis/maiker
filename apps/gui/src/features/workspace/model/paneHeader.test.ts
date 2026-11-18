import { describe, expect, it } from 'vitest'
import { headerFit, shellProgram } from './paneHeader'

describe('pane header fit', () => {
  it('shows the view tabs in a pane wide enough', () => {
    expect(headerFit(400)).toEqual({ switcher: true })
  })

  it('gives up the view tabs in a narrow pane', () => {
    expect(headerFit(340)).toEqual({ switcher: false })
  })

  it('shows everything until the pane is measured', () => {
    expect(headerFit(null)).toEqual({ switcher: true })
  })
})

describe('the shell a plain terminal header names', () => {
  it('is the program’s own name, without its folder, its .exe or a login dash', () => {
    expect(shellProgram({ conversation: { process: '/usr/bin/zsh' } })).toBe('zsh')
    expect(shellProgram({ conversation: { process: 'C:\\Windows\\pwsh.exe' } })).toBe('pwsh')
    expect(shellProgram({ conversation: { process: '-bash' } })).toBe('bash')
  })

  it('is "shell" when the daemon named none', () => {
    expect(shellProgram({ conversation: {} })).toBe('shell')
    expect(shellProgram({ conversation: { process: '  ' } })).toBe('shell')
  })
})
