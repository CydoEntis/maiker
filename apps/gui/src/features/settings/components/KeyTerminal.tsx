import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TerminalView, type TerminalLook } from '@/TerminalView'
import type { Conversation } from '@/data/preview'

/** What the window gives Add a machine to show a terminal of this computer inside it. */
export type KeyTerminalHost = {
  /**
   * Starts a shell on this computer with `command` typed at its prompt and not run. The session is never placed in a pane.
   * Null when it did not start (said in a toast).
   */
  start: (command: string) => Promise<Conversation | null>
  /** Ends that shell for good; it must not outlive the dialog. Says in a toast when it could not. */
  end: (session: Conversation) => Promise<void>
  /** Dials the machine again every few seconds until it connects, without announcing it. Returns the call that stops that. */
  watch: (name: string) => () => void
  fontSize: number
  look: TerminalLook
}

/** Marks the terminal so that the dialog leaves Esc to it while it has focus. */
export const KEY_TERMINAL_ATTRIBUTE = 'data-key-terminal'

type Props = {
  host: KeyTerminalHost
  /** The machine being added, for the accessible name and for the retries. */
  name: string
  /** The line typed at the prompt; the person runs it. */
  command: string
  /** The terminal could not start: the block goes back to offering the button. */
  onFailed: () => void
  /** Ctrl+Tab: xterm keeps Tab for the shell, so this is the way out of the terminal by keyboard. */
  onLeave: () => void
}

/**
 * A shell of this computer shown under the error, with the key command typed and not run. The person presses Enter and types
 * the password in it; it travels through the terminal like any shell input, and nothing here reads or keeps it. The shell
 * lives as long as this is on screen: it is ended when this unmounts, whatever closed the dialog.
 */
export function KeyTerminal({ host, name, command, onFailed, onLeave }: Props) {
  const [session, setSession] = useState<Conversation | null>(null)
  // Read at unmount, which is when the host's calls are made: the props of an earlier render would be stale.
  const latest = useRef({ host, onFailed })
  useEffect(() => { latest.current = { host, onFailed } })

  useEffect(() => {
    let gone = false
    let started: Conversation | null = null
    let stopWatching: (() => void) | null = null
    // Deferred so that the double mount of development builds starts one shell, not two.
    const timer = window.setTimeout(() => {
      latest.current.host.start(command).then((opened) => {
        if (opened === null) { if (!gone) latest.current.onFailed(); return }
        if (gone) { void latest.current.host.end(opened); return }
        started = opened
        stopWatching = latest.current.host.watch(name)
        setSession(opened)
      }, () => { if (!gone) latest.current.onFailed() })
    }, 0)
    return () => {
      gone = true
      window.clearTimeout(timer)
      stopWatching?.()
      if (started !== null) void latest.current.host.end(started)
    }
  }, [name, command])

  const leave = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    onLeave()
  }

  return (
    <div className="mx-key-term-wrap">
      <div className="mx-key-term" {...{ [KEY_TERMINAL_ATTRIBUTE]: '' }} onKeyDownCapture={leave}>
        {session === null ? (
          <p className="mx-key-term-wait" role="status">Opening a terminal…</p>
        ) : (
          <TerminalView conversation={session} desktop fontSize={host.fontSize} look={host.look} label={`Terminal for setting up the key on ${name}`} focused />
        )}
      </div>
      <p className="mx-rm-hint">Press Enter, then type the password here. It goes to ssh like any terminal input; Maiker does not read or keep it.</p>
    </div>
  )
}
