import { useEffect, useState } from 'react'
import type { MachineHead } from '@/features/workspace/model/machines'
import { keySetupCommand } from '../model/keyCommand'
import { AddOutcome, type Stage } from './AddOutcome'
import type { MachinesInfo } from './DesktopSettings'
import { StatusBlock } from './StatusBlock'

const IS_WINDOWS = /windows/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)
/** How long "Connected" is shown after the machine came back, before the dialog closes. */
const CONNECTED_SHOWN_MS = 1400
const NO_REASON = 'The Maiker service gave no reason.'

type Props = {
  /** The machine to mend, as the sidebar showed it. Its live state is read from `machines.list`. */
  head: MachineHead
  machines: MachinesInfo
  /** The machine connected and the person has seen it: the dialog can close. */
  onConnected: (name: string) => void
  /** Leaves for the machine's page in Settings. */
  onOpenSettings: () => void
}

/**
 * Add a remote machine opened on one machine that is not connected. A machine that needs a login goes straight to the key
 * step (the terminal inside the dialog, command typed and not run); a host key to trust keeps its own block. Any other
 * state is one panel: the reason as the host gave it, Try again, and a quiet way to its page in Settings.
 */
export function FixMachine({ head, machines, onConnected, onOpenSettings }: Props) {
  const name = head.name ?? head.label
  const live = machines.list.find((each) => each.name === head.name) ?? head
  const connected = live.chip?.word === 'connected'
  const [settingUp, setSettingUp] = useState(false)

  useEffect(() => {
    if (!connected) return undefined
    const timer = window.setTimeout(() => { onConnected(name) }, CONNECTED_SHOWN_MS)
    return () => { window.clearTimeout(timer) }
  }, [connected, name, onConnected])

  if (connected) return <StatusBlock tone="ok" lead={`Connected to ${name}.`} />

  const needsLogin = live.target !== null && (live.loginCommand !== null || live.chip?.word === 'needs login')
  if (needsLogin) {
    const keyCommand = keySetupCommand(live.target ?? '', null, IS_WINDOWS)
    const keyTerminal = machines.keyTerminal
    const offered = keyTerminal !== undefined && keyCommand !== null
    const stage: Stage = { kind: 'added', added: { outcome: 'login', name, target: live.target ?? '', said: live.said ?? '', command: live.loginCommand }, choice: 'ask', port: null }
    return (
      <AddOutcome
        stage={stage}
        machines={machines}
        onTryAgain={() => { machines.onRetry(name) }}
        onEdit={onOpenSettings}
        editLabel="Open in Settings"
        onCancel={onOpenSettings}
        onInstall={onOpenSettings}
        onSkip={onOpenSettings}
        keyCommand={keyCommand}
        onSetUpKey={offered ? () => { setSettingUp(true) } : null}
        terminal={offered && settingUp ? { host: keyTerminal, onFailed: () => { setSettingUp(false) } } : null}
      />
    )
  }

  return (
    <StatusBlock tone="bad" lead={`${name} is not connected.`} more={live.said ?? live.why ?? NO_REASON}>
      <button type="button" className="mx-rm-primary" autoFocus onClick={() => { machines.onRetry(name) }}>Try again</button>
      <button type="button" className="mx-rm-text" onClick={onOpenSettings}>Open in Settings</button>
    </StatusBlock>
  )
}
