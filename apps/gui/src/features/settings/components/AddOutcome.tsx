import { useRef } from 'react'
import type { Added } from '@/api/machines'
import { HOST_KEY_WORDS } from '../model/machineRows'
import { unreachableAdvice, unreachableKind } from '../model/unreachable'
import type { MachinesInfo } from './DesktopSettings'
import { HostKeyBlock } from './HostKeyBlock'
import { KeyTerminal, type KeyTerminalHost } from './KeyTerminal'
import { MoreOptions } from './MoreOptions'
import { StatusBlock } from './StatusBlock'

/** Where adding a machine is, from the moment Connect is pressed. Nothing here while it is idle. */
export type Stage =
  | { kind: 'working'; text: string }
  /** ssh could not reach it, so nothing was added. `message` is ssh's own words. */
  | { kind: 'failed'; message: string; host: string; port: number | null }
  | { kind: 'no-name'; target: string }
  /** It was added; `choice` is what the person has said about installing or updating Maiker on it. */
  | { kind: 'added'; added: Extract<Added, { outcome: 'added' | 'login' }>; choice: 'ask' | 'installing'; port: number | null }
  /** The machine connected while its key was being set up; shown for a moment before the screen closes. */
  | { kind: 'connected'; name: string }

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
  /** The line that puts this computer's key on the machine, as it is typed in a terminal; null when there is none to give. */
  keyCommand: string | null
  /** Shows the terminal with `keyCommand` typed and not run; null where that is not offered. */
  onSetUpKey: (() => void) | null
  /** The terminal while it is shown under the error; null before it is asked for. */
  terminal: { host: KeyTerminalHost; onFailed: () => void } | null
  /** What the way out of the address is called; "Edit address" unless the screen has no address to edit. */
  editLabel?: string
}

/** The host's refusal when the name is already in the saved machines. */
const SAVED_NAME = /already have a machine called (\S+?)\./

const SET_UP_WORDS = 'Maiker opens a terminal here with the command typed. Press Enter and type the password in it. The terminal hands it to ssh like any terminal does; Maiker never reads or keeps it.'
const TERMINAL_WORDS = 'Press Enter in the terminal below, then type the password there. Maiker connects as soon as the key works.'

/** The one status block under the address field: working, asking, or what failed. */
export function AddOutcome({ stage, machines, onTryAgain, onEdit, onCancel, onInstall, onSkip, keyCommand, onSetUpKey, terminal, editLabel = 'Edit address' }: Props) {
  const copyButton = useRef<HTMLButtonElement>(null)
  const edit = <button type="button" className="mx-rm-text" onClick={onEdit}>{editLabel}</button>
  if (stage.kind === 'working') {
    return <StatusBlock tone="work" lead={stage.text}><button type="button" className="mx-rm-text" autoFocus onClick={onCancel}>Cancel</button></StatusBlock>
  }
  if (stage.kind === 'connected') {
    return <StatusBlock tone="ok" lead={`Connected to ${stage.name}.`} />
  }
  if (stage.kind === 'no-name') {
    return <StatusBlock tone="bad" lead="Can't make a name for that." more={`Type ${stage.target} as user@host, so Maiker can name it.`}>{edit}</StatusBlock>
  }
  if (stage.kind === 'failed') {
    // The name is taken by an entry that is saved but may not be in the list: say so, and offer what fixes it, here.
    const saved = SAVED_NAME.exec(stage.message)?.[1]
    if (saved !== undefined) {
      return (
        <StatusBlock tone="bad" lead={`${saved} is already added.`} more="It is saved but did not connect. Retry it, or remove it to start again.">
          <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(saved) }}>Retry {saved}</button>
          <button type="button" className="mx-rm-text" onClick={() => { machines.onRemove(saved) }}>Remove {saved}</button>
        </StatusBlock>
      )
    }
    const kind = unreachableKind(stage.message)
    // ssh's own words are the reason when none of the known ones fits: they are the headline, not a click away.
    if (kind === 'other') {
      return (
        <StatusBlock tone="bad" lead={`Couldn't add ${stage.host}.`} more={stage.message}>
          <button type="button" className="mx-rm-primary" onClick={onTryAgain}>Try again</button>
          <MoreOptions raw={null}>{edit}</MoreOptions>
        </StatusBlock>
      )
    }
    return (
      <StatusBlock tone="bad" lead={kind === 'cannot-resolve' ? `Couldn't find ${stage.host}.` : `Can't reach ${stage.host}.`} more={unreachableAdvice(kind, stage.host, stage.port)}>
        <button type="button" className="mx-rm-primary" onClick={onTryAgain}>Try again</button>
        <MoreOptions raw={stage.message}>{edit}</MoreOptions>
      </StatusBlock>
    )
  }
  const { added } = stage
  const name = added.name
  if (added.outcome === 'login') {
    if (HOST_KEY_WORDS.test(added.said)) {
      return <HostKeyBlock name={name} inspect={machines.hostKey.inspect} trust={machines.hostKey.trust} onCopy={machines.onCopyCommand} leave={edit} />
    }
    const retry = <button type="button" className="mx-rm-text" onClick={() => { machines.onRetry(name) }}>Try again</button>
    if (onSetUpKey !== null && keyCommand !== null && terminal !== null) {
      return (
        <>
          <StatusBlock tone="bad" lead={`${name} didn't accept your key.`} more={TERMINAL_WORDS}>
            <button type="button" ref={copyButton} className="mx-rm-text" onClick={() => { machines.onCopyCommand(keyCommand) }}>Copy the command instead</button>
            <MoreOptions raw={added.said}>{retry}{edit}</MoreOptions>
          </StatusBlock>
          <KeyTerminal host={terminal.host} name={name} command={keyCommand} onFailed={terminal.onFailed} onLeave={() => { copyButton.current?.focus() }} />
        </>
      )
    }
    if (onSetUpKey !== null && keyCommand !== null) {
      return (
        <StatusBlock tone="bad" lead={`${name} didn't accept your key.`} more={SET_UP_WORDS}>
          <button type="button" className="mx-rm-primary" autoFocus onClick={onSetUpKey}>Set up the key here</button>
          <button type="button" className="mx-rm-text" onClick={() => { machines.onCopyCommand(keyCommand) }}>Copy the command instead</button>
          <MoreOptions raw={added.said}>{retry}{edit}</MoreOptions>
        </StatusBlock>
      )
    }
    return (
      <StatusBlock tone="bad" lead={`${name} didn't accept your key.`} more="Run this once in a terminal, then try again:" copy={{ text: keyCommand ?? `ssh-copy-id ${added.target}`, label: 'the ssh-copy-id command', onCopy: machines.onCopyCommand }}>
        <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(name) }}>Try again</button>
        <MoreOptions raw={added.said}>{edit}</MoreOptions>
      </StatusBlock>
    )
  }
  if (added.reach === 'not-running') {
    return (
      <StatusBlock tone="bad" lead={`Maiker is installed on ${name} but couldn't start.`} more="Its service did not answer.">
        <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(name) }}>Try again</button>
        <MoreOptions raw={null}>{edit}</MoreOptions>
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
