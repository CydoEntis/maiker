import { describe, expect, it } from 'vitest'
import { explainKeyFailure, keyRunLine, keySetupCommand, readKeyScreen, stripAnsi } from './keyCommand'

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
  it('writes the exit status after a marker, and leaves the shell open so the output can be read', () => {
    expect(keyRunLine('ssh-copy-id me@box')).toBe('ssh-copy-id me@box; echo "MAIKER-KEY-EXIT:$?"')
    expect(keyRunLine('ssh-copy-id me@box', true)).toBe("ssh-copy-id me@box; [Console]::WriteLine('MAIKER-KEY-EXIT:' + [int]$LASTEXITCODE)")
  })
})

describe('reading the key terminal', () => {
  const ESC = String.fromCharCode(27)
  const echo = '$ ssh-copy-id me@box; echo "MAIKER-KEY-EXIT:$?"'

  it('takes the escape sequences out of the daemon’s screen text', () => {
    expect(stripAnsi(`${ESC}[0m${ESC}[2J${ESC}[H${ESC}[?25hhello${ESC}[1;31m red${ESC}]0;title${String.fromCharCode(7)}`)).toBe('hello red')
  })

  it('is not finished while only the typed line, which echoes the marker, is on screen', () => {
    expect(readKeyScreen([echo, "me@box's password: "].join('\n'))).toEqual({ exit: null, lastLine: null })
  })

  it('is finished with the status the shell printed, and the last line the command said, never the password question', () => {
    const screen = `${ESC}[0m${ESC}[2J${ESC}[H${[echo, "me@box's password: ", 'Permission denied, please try again.', 'MAIKER-KEY-EXIT:1', '$ '].join('\r\n')}`
    expect(readKeyScreen(screen)).toEqual({ exit: 1, lastLine: 'Permission denied, please try again.' })
  })

  it('reads a status of 0 as a status', () => {
    expect(readKeyScreen([echo, 'Number of key(s) added: 1', 'MAIKER-KEY-EXIT:0'].join('\n'))).toEqual({ exit: 0, lastLine: 'Number of key(s) added: 1' })
  })

  it('shows what the command said so far while it runs, without the typed line or the password question', () => {
    expect(readKeyScreen([echo, '/usr/bin/ssh-copy-id: INFO: attempting', "me@box's password: "].join('\n')).lastLine).toBe('/usr/bin/ssh-copy-id: INFO: attempting')
  })
})

describe('what is said back when the key did not go on', () => {

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
