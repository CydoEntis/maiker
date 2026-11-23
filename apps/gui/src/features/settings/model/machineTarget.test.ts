import { describe, expect, it } from 'vitest'
import { hostProblem, portOf, targetOf, userProblem } from './machineTarget'

describe('the parts of a machine destination', () => {
  it('puts user and host together as the config keeps them', () => {
    expect(targetOf('dev', '100.78.214.15')).toBe('dev@100.78.214.15')
    expect(targetOf('', 'kingdom')).toBe('kingdom')
  })

  it('refuses what ssh would read as an option or a shell word', () => {
    for (const bad of ['-oProxyCommand=x', '-p', 'a b', 'a;b', 'a$(x)']) {
      expect(hostProblem(bad)).not.toBeNull()
      expect(userProblem(bad)).not.toBeNull()
    }
    expect(hostProblem('fe80::1%eth0')).toBeNull()
    expect(userProblem('CORP\\me')).toBeNull()
  })

  it('reads a port as a number from 1 to 65535, blank as none, and anything else as bad', () => {
    expect(portOf('')).toBeNull()
    expect(portOf('2222')).toBe(2222)
    for (const bad of ['0', '65536', '22a', '-1', '1e3']) expect(portOf(bad)).toBeUndefined()
  })
})
