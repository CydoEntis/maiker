import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { leaveQueriesToDaemon } from './daemonAnswers'

/** What xterm sends back while it parses `output`, as a program in the pane would receive it. */
async function answersTo(output: string, leave: boolean): Promise<string> {
  const terminal = new Terminal({ allowProposedApi: true })
  if (leave) leaveQueriesToDaemon(terminal.parser)
  let sent = ''
  terminal.onData((data) => { sent += data })
  await new Promise<void>((resolve) => { terminal.write(output, resolve) })
  terminal.dispose()
  return sent
}

const DAEMON_ANSWERS = '\x1b]11;?\x1b\\\x1b]10;?\x07\x1b[6n\x1b[5n\x1b[c\x1b[0c\x1b[>c\x1b[>0c'

describe('the queries the daemon answers', () => {
  it('are answered by xterm on its own, which is the late second answer the shell printed', async () => {
    expect(await answersTo('\x1b[6n', false)).not.toBe('')
  })

  it('get no second answer from the window', async () => {
    expect(await answersTo(DAEMON_ANSWERS, true)).toBe('')
  })

  it('leave the queries the daemon does not answer to xterm', async () => {
    expect(await answersTo('\x1b[?2026$p', true)).not.toBe('')
  })
})
