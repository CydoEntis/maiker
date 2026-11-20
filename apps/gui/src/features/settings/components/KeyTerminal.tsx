import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { TerminalView, type TerminalLook } from '@/TerminalView'
import type { Conversation } from '@/data/preview'
import { lastKeyLine } from '../model/keyCommand'

/** What the window gives Add a machine to show a terminal of this computer inside it. */
export type KeyTerminalHost = {
  /**
   * Starts a shell on this computer, types `line` at its prompt and presses Enter, so it runs at once. The session is never placed
   * in a pane. Null when it did not start (said in a toast).
   */
  start: (line: string) => Promise<Conversation | null>
  /** Ends that shell for good; it must not outlive the dialog. Says in a toast when it could not. */
  end: (session: Conversation) => Promise<void>
  /** Whether the shell of this session is still there: false once it has exited. */
  isOpen: (id: string) => boolean
  /** The text the terminal shows now; empty when it could not be read. */
  readScreen: (session: Conversation) => Promise<string>
  /** Dials the machine again every few seconds until it connects, without announcing it. Returns the call that stops that. */
  watch: (name: string) => () => void
  fontSize: number
  look: TerminalLook
}

/** Marks the terminal so that the dialog leaves Esc to it while it has focus. */
export const KEY_TERMINAL_ATTRIBUTE = 'data-key-terminal'

/** How often the screen is read for the line that ends up being said when the command is over. */
const SCREEN_READ_MS = 700

type Props = {
  host: KeyTerminalHost
  /** The machine being added, for the accessible name and for the retries. */
  name: string
  /** The line that is typed and run. */
  line: string
  /** The terminal could not start: the step goes back to offering Run. */
  onFailed: () => void
  /** The command ended (the shell exited), with the last line it showed, when there was one. */
  onExit: (lastLine: string | null) => void
  /** Ctrl+Tab: xterm keeps Tab for the shell, so this is the way out of the terminal by keyboard. */
  onLeave: () => void
}

/**
 * A shell of this computer shown inside the step, with the key command already running in it. The person types the password
 * in it; it travels through the terminal like any shell input, and nothing here reads or keeps it. The command ends the shell,
 * which is how the step knows to check the key. The shell lives as long as this is on screen: it is ended when this unmounts,
 * whatever closed the dialog.
 */
export function KeyTerminal({ host, name, line, onFailed, onExit, onLeave }: Props) {
  const [session, setSession] = useState<Conversation | null>(null)
  // Read at unmount and on each tick, which is when the host's calls are made: the props of an earlier render would be stale.
  const latest = useRef({ host, onFailed, onExit })
  useEffect(() => { latest.current = { host, onFailed, onExit } })
  const lastLine = useRef<string | null>(null)
  const exited = useRef(false)

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
      if (started !== null && !exited.current) void latest.current.host.end(started)
    }
  }, [name, line])

  // The last line is remembered while the shell is there, because once it has exited there is no screen left to read.
  useEffect(() => {
    if (session === null) return undefined
    const timer = window.setInterval(() => {
      latest.current.host.readScreen(session).then((screen) => {
        const said = lastKeyLine(screen)
        if (said !== null) lastLine.current = said
      }, () => undefined)
    }, SCREEN_READ_MS)
    return () => { window.clearInterval(timer) }
  }, [session])

  const ended = session !== null && !host.isOpen(session.id)
  useEffect(() => {
    if (!ended || exited.current) return
    exited.current = true
    latest.current.onExit(lastLine.current)
  }, [ended])

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
      <p className="mx-rm-hint">Type the password here when it asks. It goes to ssh like any terminal input; Maiker does not read or keep it.</p>
    </div>
  )
}
