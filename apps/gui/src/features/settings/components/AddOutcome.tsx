import type { Added } from '@/api/machines'
import { HOST_KEY_WORDS } from '../model/machineRows'
import { unreachableAdvice, unreachableKind } from '../model/unreachable'
import type { MachinesInfo } from './DesktopSettings'
import { HostKeyBlock } from './HostKeyBlock'
import { StatusBlock } from './StatusBlock'

/** Where adding a machine is, from the moment Connect is pressed. Nothing here while it is idle. */
export type Stage =
  | { kind: 'working'; text: string }
  /** ssh could not reach it, so nothing was added. `message` is ssh's own words. */
  | { kind: 'failed'; message: string; host: string; port: number | null }
  | { kind: 'no-name'; target: string }
  /** It was added; `choice` is what the person has said about installing or updating Maiker on it. */
  | { kind: 'added'; added: Extract<Added, { outcome: 'added' | 'login' }>; choice: 'ask' | 'installing' }

type Props = {
  stage: Stage
  machines: MachinesInfo
  /** Reruns the whole sequence from the start. */
  onTryAgain: () => void
  /** Clears the block and puts focus back in the field. */
  onEdit: () => void
  onCancel: () => void
  onInstall: () => void
  /** Leave Maiker off or at its old version: the machine stays added. */
  onSkip: () => void
}

/** The one status block under the address field: working, asking, or what failed. */
export function AddOutcome({ stage, machines, onTryAgain, onEdit, onCancel, onInstall, onSkip }: Props) {
  const edit = <button type="button" className="mx-rm-text" onClick={onEdit}>Edit address</button>
  if (stage.kind === 'working') {
    return <StatusBlock tone="work" lead={stage.text}><button type="button" className="mx-rm-text" autoFocus onClick={onCancel}>Cancel</button></StatusBlock>
  }
  if (stage.kind === 'no-name') {
    return <StatusBlock tone="bad" lead="Can't make a name for that." more={`Type ${stage.target} as user@host, so Maiker can name it.`}>{edit}</StatusBlock>
  }
  if (stage.kind === 'failed') {
    const kind = unreachableKind(stage.message)
    return (
      <StatusBlock tone="bad" lead={kind === 'cannot-resolve' ? `Couldn't find ${stage.host}.` : `Can't reach ${stage.host}.`} more={unreachableAdvice(kind, stage.host, stage.port)} raw={stage.message}>
        <button type="button" className="mx-rm-primary" onClick={onTryAgain}>Try again</button>
        {edit}
      </StatusBlock>
    )
  }
  const { added } = stage
  const name = added.name
  if (added.outcome === 'login') {
    if (HOST_KEY_WORDS.test(added.said)) {
      return <HostKeyBlock name={name} inspect={machines.hostKey.inspect} trust={machines.hostKey.trust} onCopy={machines.onCopyCommand} leave={edit} />
    }
    return (
      <StatusBlock tone="bad" lead={`${name} didn't accept your key.`} more="Run this once in a terminal, then try again:" copy={{ text: `ssh-copy-id ${added.target}`, label: 'the ssh-copy-id command', onCopy: machines.onCopyCommand }} raw={added.said}>
        <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(name) }}>Try again</button>
        {edit}
      </StatusBlock>
    )
  }
  if (added.reach === 'not-running') {
    return (
      <StatusBlock tone="bad" lead={`Maiker is installed on ${name} but couldn't start.`} more="Its service did not answer.">
        <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(name) }}>Try again</button>
        {edit}
      </StatusBlock>
    )
  }
  const missing = added.reach === 'missing'
  if (stage.choice === 'installing') {
    return <StatusBlock tone="work" lead={`${missing ? 'Installing' : 'Updating'} Maiker on ${name}…`} more="About 20 seconds." />
  }
  return (
    <StatusBlock
      tone="needs"
      lead={missing ? `Maiker isn't on ${name} yet.` : `${name} has an older Maiker${added.version === null ? '' : ` (${added.version})`}.`}
      more={missing ? 'It installs in ~/.maiker (about 40 MB). No admin rights needed.' : 'Some features need both computers on the same version.'}
    >
      <button type="button" className="mx-rm-primary" onClick={onInstall}>{missing ? 'Install Maiker' : 'Update it'}</button>
      <button type="button" className="mx-rm-text" onClick={onSkip}>{missing ? 'Add without it' : added.version === null ? 'Keep it' : `Keep ${added.version}`}</button>
    </StatusBlock>
  )
}
