import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { explainKeyFailure, keyRunLine, keySetupCommand } from '../model/keyCommand'
import { CommandPreview } from './CommandPreview'
import type { MachinesInfo } from './DesktopSettings'
import { KeyTerminal } from './KeyTerminal'
import { CopyLine } from './StatusBlock'

const IS_WINDOWS = /windows/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)
/** How long the machine is dialled again after the command ended well, before it is said that the key did not work. */
const CHECK_MS = 25_000

type Props = {
  name: string
  /** How the machine is reached (`user@host` or an alias): what the key is sent to. */
  target: string
  port: number | null
  machines: MachinesInfo
}

/** Where the step is: showing the command, running it, checking the key it left, or saying why that did not work. */
type Phase = { at: 'idle' } | { at: 'running' } | { at: 'checking' } | { at: 'failed'; said: string | null }

/** The machine is dialled again for a while after the command ended; the step ends itself when it connects (the parent moves on). */
function useKeyCheck(active: boolean, name: string, machines: MachinesInfo, onGaveUp: () => void): void {
  // The parent builds `machines` and the callback again on every render; the check must start once and keep its own clock.
  const latest = useRef({ machines, onGaveUp })
  useEffect(() => { latest.current = { machines, onGaveUp } })
  useEffect(() => {
    if (!active) return undefined
    const { machines: now } = latest.current
    now.onRetry(name)
    const stopWatching = now.keyTerminal?.watch(name)
    const timer = window.setTimeout(() => { latest.current.onGaveUp() }, CHECK_MS)
    return () => { window.clearTimeout(timer); stopWatching?.() }
  }, [active, name])
}

/**
 * The fix for a machine that did not accept the key. It says what will happen in two sentences and shows the exact command as a
 * terminal would (read-only); **Run** opens a terminal of this computer right here, in place of that, running the command. The
 * terminal shows ssh's own output and stays open, so its password prompt is the person's to answer and its last words can be read;
 * the password goes to ssh like any terminal input, so Maiker never reads or keeps it. When the command ends the key is checked
 * (**Checking your key…**) and the step goes on by itself when the machine connects, or says in plain words why not, with
 * **Try again**. **Copy** is for doing it elsewhere.
 */
export function KeyStep({ name, target, port, machines }: Props) {
  const [phase, setPhase] = useState<Phase>({ at: 'idle' })
  const [runs, setRuns] = useState(0)
  const copyButton = useRef<HTMLButtonElement>(null)
  const command = keySetupCommand(target, port, IS_WINDOWS)
  const keyTerminal = machines.keyTerminal
  useKeyCheck(phase.at === 'checking', name, machines, () => { setPhase({ at: 'failed', said: null }) })
  if (command === null) {
    return (
      <div className="flex flex-col gap-3" data-key-step="">
        <p className="m-0 text-[13px] text-(--fg2)">Run this once in a terminal, then try again:</p>
        <CopyLine text={`ssh-copy-id ${target}`} label="the ssh-copy-id command" onCopy={machines.onCopyCommand} />
        <div><Button variant="soft" onClick={() => { machines.onRetry(name) }}>Try again</Button></div>
      </div>
    )
  }
  const run = () => { setRuns((count) => count + 1); setPhase({ at: 'running' }) }
  const terminalShown = keyTerminal !== undefined && phase.at !== 'idle'
  return (
    <div className="flex flex-col gap-3" data-key-step="">
      <p className="m-0 text-[13px] text-(--fg2)">
        Maiker will add your public key to ~/.ssh/authorized_keys on {name}, so it can sign in without a password. You type the password once, in the terminal below; Maiker never sees it.
      </p>
      {terminalShown ? (
        <KeyTerminal
          key={runs}
          host={keyTerminal}
          name={name}
          line={keyRunLine(command, IS_WINDOWS)}
          onFailed={() => { setPhase({ at: 'idle' }) }}
          onDone={({ exit, lastLine }) => { setPhase(exit === 0 ? { at: 'checking' } : { at: 'failed', said: lastLine }) }}
          onLeave={() => { copyButton.current?.focus() }}
        />
      ) : (
        <CommandPreview command={command} prompt={IS_WINDOWS ? 'PS>' : '$'} label="The command Maiker will run" />
      )}
      {phase.at === 'running' && <p className="m-0 text-[13px] text-(--muted)">Type the password in the terminal when it asks. It goes to ssh like any terminal input; Maiker does not read or keep it.</p>}
      {phase.at === 'checking' && (
        <div className="flex flex-col gap-2" role="status">
          <Progress label="Checking your key" />
          <p className="m-0 text-[13px] text-(--fg2)">Checking your key…</p>
        </div>
      )}
      {phase.at === 'failed' && (
        <p role="alert" className="m-0 text-[13px] text-(--fg2)">
          {explainKeyFailure(phase.said)}
          {phase.said !== null && <> ssh said: “{phase.said}”</>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {keyTerminal !== undefined && phase.at === 'idle' && <Button variant="primary" autoFocus onClick={run}>Run</Button>}
        {phase.at === 'failed' && <Button variant="needs" autoFocus onClick={run}>Try again</Button>}
        <Button ref={copyButton} variant="soft" onClick={() => { machines.onCopyCommand(command) }}>Copy</Button>
      </div>
    </div>
  )
}
