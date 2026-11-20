import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TerminalView, type TerminalLook } from '@/TerminalView'
import type { Conversation } from '@/data/preview'
import { readKeyScreen, type KeyScreen } from '../model/keyCommand'

/** What the window gives Add a machine to show a terminal of this computer inside it. */
export type KeyTerminalHost = {
  /**
   * Starts a shell on this computer, waits for its prompt, then types `line` and presses Enter, so it runs. The session is never
   * placed in a pane. Null when it did not start (said in a toast).
   */
  start: (line: string) => Promise<Conversation | null>
  /** Ends that shell for good; it must not outlive the dialog. Says in a toast when it could not. */
  end: (session: Conversation) => Promise<void>
  /** The terminal's screen text as the daemon holds it (with its escape sequences); empty when it could not be read. */
  readScreen: (session: Conversation) => Promise<string>
  /** Dials the machine again every few seconds until it connects, without announcing it. Returns the call that stops that. */
  watch: (name: string) => () => void
  fontSize: number
  look: TerminalLook
}

/** Marks the terminal so that the dialog leaves Esc to it while it has focus. */
export const KEY_TERMINAL_ATTRIBUTE = 'data-key-terminal'

/** How often the screen is read for the command's exit marker. */
const SCREEN_READ_MS = 500

type Props = {
  host: KeyTerminalHost
  /** The machine being added, for the accessible name and for the retries. */
  name: string
  /** The line that is typed and run. */
  line: string
  /** The terminal could not start: the step goes back to offering Run. */
  onFailed: () => void
  /** The command ended: its exit status and the last line it printed. The terminal stays open, with its output. */
  onDone: (result: { exit: number; lastLine: string | null }) => void
  /** Ctrl+Tab: xterm keeps Tab for the shell, so this is the way out of the terminal by keyboard. */
  onLeave: () => void
}

/**
 * A shell of this computer shown inside the step, with the key command running in it. The person sees ssh's own output,
 * password prompt included, and types the password in it; it travels through the terminal like any shell input, and nothing here
 * reads or keeps it. The command ends by printing its exit status after a marker, which is how the step knows it is over; the
 * terminal then stays open so the output can be read. The shell lives as long as this is on screen: it is ended when this unmounts,
 * whatever closed the dialog.
 */
export function KeyTerminal({ host, name, line, onFailed, onDone, onLeave }: Props) {
  const [session, setSession] = useState<Conversation | null>(null)
  // Read at unmount and on each tick, which is when the host's calls are made: the props of an earlier render would be stale.
  const latest = useRef({ host, onFailed, onDone })
  useEffect(() => { latest.current = { host, onFailed, onDone } })

  useEffect(() => {
    let gone = false
    let started: Conversation | null = null
    let stopWatching: (() => void) | null = null
    // Deferred so that the double mount of development builds starts one shell, not two.
    const timer = window.setTimeout(() => {
      latest.current.host.start(line).then((opened) => {
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
  }, [name, line])

  // Only the marker the command's own line prints ends it; whether the shell is still listed says nothing about the command.
  useEffect(() => {
    if (session === null) return undefined
    let finished = false
    const look = () => {
      latest.current.host.readScreen(session).then((screen): KeyScreen => readKeyScreen(screen), (): KeyScreen => ({ exit: null, lastLine: null })).then(({ exit, lastLine }) => {
        if (finished || exit === null) return
        finished = true
        window.clearInterval(timer)
        latest.current.onDone({ exit, lastLine })
      }, () => undefined)
    }
    const timer = window.setInterval(look, SCREEN_READ_MS)
    return () => { finished = true; window.clearInterval(timer) }
  }, [session])

  const leave = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !event.ctrlKey) return
    event.preventDefault()
    event.stopPropagation()
    onLeave()
  }

  return (
    <div className="mx-key-term" {...{ [KEY_TERMINAL_ATTRIBUTE]: '' }} onKeyDownCapture={leave}>
      {session === null ? (
        <p className="mx-key-term-wait" role="status">Opening a terminal…</p>
      ) : (
        <TerminalView conversation={session} desktop fontSize={host.fontSize} look={host.look} label={`Terminal for setting up the key on ${name}`} focused />
      )}
    </div>
  )
}
