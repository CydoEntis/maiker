import { describe, expect, it } from 'vitest'
import { shellProgram } from './paneHeader'

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
