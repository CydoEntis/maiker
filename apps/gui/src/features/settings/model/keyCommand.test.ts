import { describe, expect, it } from 'vitest'
import { explainKeyFailure, keyRunLine, keySetupCommand, lastKeyLine } from './keyCommand'

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

describe('the line that runs the key command in the terminal', () => {
  it('ends the shell when the command ends, so the step knows to check the key', () => {
    expect(keyRunLine('ssh-copy-id me@box')).toBe('ssh-copy-id me@box; exit $?')
    expect(keyRunLine('ssh-copy-id me@box', true)).toBe('ssh-copy-id me@box; exit $LASTEXITCODE')
  })
})

describe('what is said back when the key did not go on', () => {
  it('takes the last line of the screen, never ssh asking for the password', () => {
    expect(lastKeyLine(["$ ssh-copy-id me@box", "me@box's password: ", 'Connection closed by 10.0.0.1 port 22', '', ''].join('\n'))).toBe('Connection closed by 10.0.0.1 port 22')
    expect(lastKeyLine(['$ ssh-copy-id me@box', "me@box's password: "].join('\n'))).toBe('$ ssh-copy-id me@box')
    expect(lastKeyLine('  \n')).toBeNull()
  })

  it('says a refusing computer is refusing for a few minutes', () => {
    const said = 'This computer is refusing connections for a few minutes because of earlier failed sign-ins. Wait and try again.'
    expect(explainKeyFailure('Connection closed by 10.0.0.1 port 22')).toBe(said)
    expect(explainKeyFailure('Not allowed at this time')).toBe(said)
  })

  it('says the password was wrong for Permission denied', () => {
    expect(explainKeyFailure('Permission denied, please try again.')).toMatch(/password was not accepted/)
  })

  it('says it plainly when it is neither, or there was nothing to read', () => {
    expect(explainKeyFailure('something odd')).toMatch(/could not sign in with it yet/)
    expect(explainKeyFailure(null)).toMatch(/could not sign in with it yet/)
  })
})
