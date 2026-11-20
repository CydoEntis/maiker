import { describe, expect, it } from 'vitest'
import { keySetupCommand } from './keyCommand'

describe("the command that puts this computer's key on a machine", () => {
  it('is ssh-copy-id and the target', () => {
    expect(keySetupCommand('me@studio.lan', null)).toBe('ssh-copy-id me@studio.lan')
    expect(keySetupCommand('build', 22)).toBe('ssh-copy-id build')
  })

  it('names a port that is not 22', () => {
    expect(keySetupCommand('me@10.0.4.50', 2200)).toBe('ssh-copy-id -p 2200 me@10.0.4.50')
  })

  it('refuses a target a shell would read as more than one word', () => {
    for (const bad of ['me@box; rm -rf ~', 'a b', '$(id)', '-oProxyCommand=x', 'box\r', 'x`y`', '']) {
      expect(keySetupCommand(bad, null), bad).toBeNull()
    }
  })

  it('refuses a port that is not one', () => {
    expect(keySetupCommand('box', 0)).toBeNull()
    expect(keySetupCommand('box', 70_000)).toBeNull()
  })

  it('builds a PowerShell line for Windows: a short line: make a key if there is none, then send it through ssh', () => {
    const line = keySetupCommand('dev@100.78.214.15', null, true)
    expect(line).toContain('ssh-keygen -t ed25519')
    expect(line).toContain('ssh dev@100.78.214.15 "mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"')
    expect(line?.length).toBeLessThan(200)
    expect(keySetupCommand('dev@host', 2222, true)).toContain('ssh -p 2222 dev@host')
    expect(keySetupCommand('a b', null, true)).toBeNull()
  })
})
