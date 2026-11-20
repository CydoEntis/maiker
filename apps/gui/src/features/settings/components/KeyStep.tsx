import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { keySetupCommand } from '../model/keyCommand'
import type { MachinesInfo } from './DesktopSettings'
import { KeyTerminal } from './KeyTerminal'
import { CopyLine } from './StatusBlock'

const IS_WINDOWS = /windows/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)

type Props = {
  name: string
  /** How the machine is reached (`user@host` or an alias): what the key is sent to. */
  target: string
  port: number | null
  machines: MachinesInfo
}

/**
 * The fix for a machine that did not accept the key: one main button, **Copy my key to <name>**, that opens a terminal of this
 * computer right here with the command typed and not run, and a quiet **Copy the command** for doing it elsewhere. The password
 * is typed into that terminal and goes to ssh like any terminal input; Maiker never reads or keeps it. The step goes on by
 * itself when the machine connects (the terminal dials it again), so there is no button for that.
 */
export function KeyStep({ name, target, port, machines }: Props) {
  const [settingUp, setSettingUp] = useState(false)
  const copyButton = useRef<HTMLButtonElement>(null)
  const command = keySetupCommand(target, port, IS_WINDOWS)
  const keyTerminal = machines.keyTerminal
  if (command === null) {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-xs text-(--fg2)">Run this once in a terminal, then try again:</p>
        <CopyLine text={`ssh-copy-id ${target}`} label="the ssh-copy-id command" onCopy={machines.onCopyCommand} />
        <div><Button variant="soft" onClick={() => { machines.onRetry(name) }}>Try again</Button></div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-xs text-(--fg2)">
        Copy your public key to it once, then Maiker signs in with the key from now on. You type the password into a terminal; it goes straight to ssh, and Maiker never reads or keeps it.
      </p>
      {keyTerminal !== undefined && settingUp && (
        <KeyTerminal host={keyTerminal} name={name} command={command} onFailed={() => { setSettingUp(false) }} onLeave={() => { copyButton.current?.focus() }} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {keyTerminal !== undefined && !settingUp && <Button variant="needs" autoFocus onClick={() => { setSettingUp(true) }}>Copy my key to {name}</Button>}
        <Button ref={copyButton} variant="soft" onClick={() => { machines.onCopyCommand(command) }}>Copy the command</Button>
      </div>
    </div>
  )
}
