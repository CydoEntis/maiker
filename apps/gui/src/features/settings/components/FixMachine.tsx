import { useEffect, useState } from 'react'
import type { HostKeyReport } from '@/api/machines'
import { Button } from '@/components/ui/button'
import { errorMessage } from '@/lib/error-message'
import type { MachineHead } from '@/features/workspace/model/machines'
import { HOST_KEY_WORDS } from '../model/machineRows'
import { AddChecklist, type Position } from './AddChecklist'
import { StepBody } from './AddBodies'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'
import type { MachinesInfo } from './DesktopSettings'
import { HostKeyBody } from './HostKeyBody'
import { KeyStep } from './KeyStep'

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
  onClose: () => void
}

type Look = { state: 'loading' } | { state: 'ready'; report: HostKeyReport } | { state: 'failed'; message: string }

/** A host key to trust on a machine that already exists: looked at by the machine's name, trusted by it. */
function FixHostKey({ name, target, machines }: { name: string; target: string; machines: MachinesInfo }) {
  const { inspect, trust } = machines.hostKey
  const [look, setLook] = useState<Look>({ state: 'loading' })
  const [trusting, setTrusting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    let gone = false
    inspect(name).then(
      (report) => { if (!gone) setLook({ state: 'ready', report }) },
      (error: unknown) => { if (!gone) setLook({ state: 'failed', message: errorMessage(error, 'Could not fetch its host key') }) },
    )
    return () => { gone = true }
  }, [inspect, name])
  if (look.state === 'loading') return <StepBody text={`Reaching ${name}…`} />
  if (look.state === 'failed') return <StepBody text={look.message}><Button variant="needs" onClick={() => { machines.onRetry(name) }}>Try again</Button></StepBody>
  if (look.report.status === 'trusted') return <KeyStep target={target} port={null} said={null} onCopy={machines.onCopyCommand} onTryAgain={() => { machines.onRetry(name) }} />
  const { report } = look
  const doTrust = () => {
    setTrusting(true)
    setProblem(null)
    trust(name, report.fingerprint).catch((error: unknown) => { setTrusting(false); setProblem(errorMessage(error, 'Could not trust the key')) })
  }
  return <HostKeyBody report={report} trusting={trusting} problem={problem} onTrust={doTrust} onCopy={machines.onCopyCommand} />
}

/** Where the checklist stands for a machine that is not connected: the step its state stopped on, with that step's one fix. */
function positionOf(live: MachineHead, name: string, machines: MachinesInfo): Position {
  if (live.chip?.word === 'connected') return { at: 'connected', state: 'done' }
  const needsLogin = live.target !== null && (live.loginCommand !== null || live.chip?.word === 'needs login')
  if (needsLogin && HOST_KEY_WORDS.test(live.said ?? '')) {
    return { at: 'host', state: 'needs', label: `Check ${name} is the right computer`, body: <FixHostKey name={name} target={live.target ?? ''} machines={machines} /> }
  }
  if (needsLogin) return { at: 'key', state: 'needs', label: `Couldn't sign in to ${live.target ?? name}`, body: <KeyStep target={live.target ?? name} port={null} said={live.said} onCopy={machines.onCopyCommand} onTryAgain={() => { machines.onRetry(name) }} /> }
  const body = <StepBody text={live.said ?? live.why ?? NO_REASON}><Button variant="needs" autoFocus onClick={() => { machines.onRetry(name) }}>Try again</Button></StepBody>
  return { at: 'reach', state: 'needs', label: `${name} is not connected`, body }
}

/**
 * Add a remote machine opened on one machine that is not connected: the same checklist, stopped at the step its state failed on.
 * A machine that needs a login goes straight to the key step (the terminal inside the card, command typed and not run); a host
 * key to trust has its own step. Any other state is the reason as the host gave it, **Try again**, and a way to its page in Settings.
 */
export function FixMachine({ head, machines, onConnected, onOpenSettings, onClose }: Props) {
  const name = head.name ?? head.label
  const live = machines.list.find((each) => each.name === head.name) ?? head
  const position = positionOf(live, name, machines)
  const connected = position.at === 'connected'

  useEffect(() => {
    if (!connected) return undefined
    const timer = window.setTimeout(() => { onConnected(name) }, CONNECTED_SHOWN_MS)
    return () => { window.clearTimeout(timer) }
  }, [connected, name, onConnected])

  const results = { reach: `Reached ${live.target ?? name}`, host: 'Known computer', key: 'Signed in', helper: 'Maiker helper is running' }
  return (
    <AddMachineFrame title={`Fix ${head.label}`} address={live.target}>
      <FrameBody><AddChecklist host={live.target ?? name} position={position} results={results} /></FrameBody>
      <FrameFoot start={<Button variant="ghost" onClick={onOpenSettings}>Open in Settings</Button>}>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </FrameFoot>
    </AddMachineFrame>
  )
}
