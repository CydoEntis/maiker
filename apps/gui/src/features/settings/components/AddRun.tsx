import { Button } from '@/components/ui/button'
import { addressOf, type AddRequest, type HostResult, type MachineFacts, type Stage } from '../model/addStage'
import { unreachableKind, unreachableTitle } from '../model/unreachable'
import { AddChecklist, type Position, type StepId } from './AddChecklist'
import { HelperProgressBody, NoAnswerBody, StepBody } from './AddBodies'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'
import type { MachinesInfo } from './DesktopSettings'
import { HostKeyBody } from './HostKeyBody'
import { KeyStep } from './KeyStep'
import { MachineAdded } from './MachineAdded'
import { useAddRun, type AddRun as Run } from './useAddRun'

const HOST_WORDS: Record<HostResult, string> = { known: 'Known computer', trusted: 'Trusted just now', unchecked: 'Checked while signing in' }

type Props = {
  request: AddRequest
  machines: MachinesInfo
  /** What the machine's daemon can say about it, once the host reports that. Rows without it are left out. */
  facts?: MachineFacts | undefined
  /** The running app's version: the one that is copied to a machine without Maiker. */
  appVersion?: string | null | undefined
  /** Back to the address, which keeps what was typed. */
  onChangeAddress: () => void
  onClose: () => void
  /** The machine was left as it is, without Maiker or with its old one. */
  onKept: (name: string) => void
  /** Done: the machine's name and the label the person chose for it. */
  onDone: (name: string, label: string) => void
  onStart: (name: string, label: string, machine: number) => void
}

function resultsOf(stage: Stage, request: AddRequest, host: HostResult): Partial<Record<StepId, string>> {
  const added = stage.kind === 'helper' ? stage.added : null
  return {
    reach: `Reached ${request.host}${added?.reach_ms == null ? '' : ` · ${String(added.reach_ms)} ms`}`,
    host: HOST_WORDS[host],
    key: added?.key == null ? 'Signed in' : `Signed in with ${added.key}`,
  }
}

type Parts = { request: AddRequest; machines: MachinesInfo; run: Run; appVersion: string | null; onChangeAddress: () => void; onKept: (name: string) => void }

/** Where the checklist stands for a stage: the step in hand, how it is, and the one fix when it needs the person. */
function positionOf(stage: Stage, { request, machines, run, appVersion, onChangeAddress, onKept }: Parts): Position {
  const { host } = request
  switch (stage.kind) {
    case 'checking': return { at: 'reach', state: 'running' }
    case 'no-answer': {
      const body = <NoAnswerBody message={stage.message} host={host} port={request.port} onRetry={run.retry} onEdit={onChangeAddress} />
      return { at: 'reach', state: 'needs', label: unreachableTitle(unreachableKind(stage.message), host), body }
    }
    case 'no-name': return { at: 'reach', state: 'needs', label: "Can't make a name for that", body: <StepBody text={`Type ${request.target} as user@host, so Maiker can name it.`}><Button variant="soft" onClick={onChangeAddress}>Edit the address</Button></StepBody> }
    case 'name-taken': {
      const body = <StepBody text="It is saved but did not connect. Retry it, or remove it to start again."><Button variant="needs" onClick={() => { machines.onRetry(stage.name) }}>Retry {stage.name}</Button><Button variant="soft" onClick={() => { machines.onRemove(stage.name) }}>Remove {stage.name}</Button></StepBody>
      return { at: 'reach', state: 'needs', label: `${stage.name} is already added`, body }
    }
    case 'trust': return { at: 'host', state: 'needs', label: `First time connecting to ${host}`, body: <HostKeyBody report={stage.report} trusting={stage.trusting} problem={stage.problem} onTrust={run.trust} onCopy={machines.onCopyCommand} /> }
    case 'changed': return { at: 'host', state: 'failed', label: `${host}'s identity changed since you last connected`, body: <HostKeyBody report={stage.report} trusting={false} problem={null} onTrust={run.trust} onCopy={machines.onCopyCommand} /> }
    case 'unverified': return { at: 'host', state: 'needs', label: `Couldn't check ${host}'s identity`, body: <StepBody text={stage.said}><Button variant="needs" onClick={() => { machines.onRetry(stage.name) }}>Try again</Button></StepBody> }
    case 'adding': {
      if (!stage.helper) return { at: 'key', state: 'running' }
      const text = stage.action === 'install' ? `Not installed yet. Copying Maiker${appVersion === null ? '' : ` ${appVersion}`} to ${request.name}…` : `Updating Maiker on ${request.name}…`
      return { at: 'helper', state: 'running', body: <HelperProgressBody text={text} percent={stage.percent} /> }
    }
    case 'key': return { at: 'key', state: 'needs', label: `${stage.login.name} didn't accept your key`, body: <KeyStep name={stage.login.name} target={stage.login.target} port={request.port} machines={machines} /> }
    case 'helper': return helperPosition(stage, { request, machines, run, appVersion, onChangeAddress, onKept })
    case 'connected': return { at: 'connected', state: 'done' }
  }
}

function helperPosition(stage: Extract<Stage, { kind: 'helper' }>, { machines, run, onKept }: Parts): Position {
  const { name, version } = stage.added
  if (stage.reason === 'not-running') {
    return { at: 'helper', state: 'needs', label: `Maiker is on ${name} but couldn't start`, body: <StepBody text="Its service did not answer."><Button variant="needs" onClick={() => { machines.onRetry(name) }}>Try again</Button></StepBody> }
  }
  const keep = <Button variant="soft" onClick={() => { run.keep(); onKept(name) }}>{stage.reason === 'older' && version !== null ? `Keep ${version}` : 'Add without it'}</Button>
  if (stage.reason === 'older') {
    const label = `${name} has an older Maiker${version === null ? '' : ` (${version})`}`
    return { at: 'helper', state: 'needs', label, body: <StepBody text="Some features need both computers on the same version."><Button variant="needs" onClick={() => { run.setUpHelper('update') }}>Update it</Button>{keep}</StepBody> }
  }
  const text = stage.said ?? 'Maiker is not installed there yet. It installs in ~/.maiker (about 40 MB). No admin rights needed.'
  return { at: 'helper', state: 'needs', label: `Couldn't put Maiker on ${name}`, body: <StepBody text={text}><Button variant="needs" onClick={() => { run.setUpHelper('install') }}>Try again</Button>{keep}</StepBody> }
}

/**
 * Add a remote machine after Connect: the checklist runs in the same card, each step ticking with its result, and a step that
 * needs the person becomes an amber step with one main fix. When the machine is in, the card turns into "Machine added".
 */
export function AddRun({ request, machines, facts, appVersion = null, onChangeAddress, onClose, onKept, onDone, onStart }: Props) {
  const run = useAddRun(request, machines)
  const { stage } = run
  if (stage.kind === 'connected') {
    const { name } = stage.reached
    const machine = machines.list.find((head) => head.name === name)?.machine
    // A machine the host has not reported yet has a negative number: a session cannot be started on it.
    return <MachineAdded reached={stage.reached} facts={facts} machine={machine !== undefined && machine > 0 ? machine : null} onDone={(label) => { onDone(name, label) }} onStart={(label, number) => { onStart(name, label, number) }} />
  }
  const position = positionOf(stage, { request, machines, run, appVersion, onChangeAddress, onKept })
  return (
    <AddMachineFrame title={`Connecting to ${request.name}`} address={addressOf(request)}>
      <FrameBody><AddChecklist host={request.host} position={position} results={resultsOf(stage, request, run.host)} /></FrameBody>
      <FrameFoot start={<Button variant="ghost" onClick={onChangeAddress}>← Change address</Button>}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </FrameFoot>
    </AddMachineFrame>
  )
}
