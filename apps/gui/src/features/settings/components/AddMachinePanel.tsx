import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SkeletonLines } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/error-message'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName, withPort } from '../model/addressCheck'
import type { MachineHead } from '@/features/workspace/model/machines'
import { offeredHosts, type AddFailure, type AddState } from '../model/addFlow'
import { targetOf } from '../model/machineTarget'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'
import { AddressOptions } from './AddressOptions'
import type { MachinesInfo } from './DesktopSettings'
import { StatusBlock } from './StatusBlock'
import { useAddMachine } from './useAddMachine'

const LEAD = 'Maiker connects over SSH with the keys you already use. It never asks for or stores a password.'
const ADDRESS_PLACEHOLDER = 'user@host, an IP address, or a name from your SSH config'

type Hosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

type Props = {
  machines: MachinesInfo
  /** Cancel, the close button, or the machine is in: the dialog closes. */
  onClose: () => void
  /** A host of the SSH config that is already a machine was clicked: the machine's own status is shown instead of adding it again. */
  onOpenAdded: (head: MachineHead) => void
}

/**
 * Add a remote machine (ADR 0017): one field and Add, the hosts of ~/.ssh/config offered as you type, then a spinner on one line
 * until the machine is in (the dialog closes) or the host's one sentence says what failed, with Try again.
 */
export function AddMachinePanel({ machines, onClose, onOpenAdded }: Props) {
  const { add, list } = machines
  const flow = useAddMachine(machines, onClose)
  const busy = flow.state.kind === 'busy'
  // One field takes `user@host`, an IP address or a name from the SSH config, as typed or pasted.
  const [text, setText] = useState('')
  const [portText, setPortText] = useState('')
  const [keyText, setKeyText] = useState('')
  const typed = text.trim()
  // The message waits for Enter or Add, and editing the field hides it again.
  const [shown, setShown] = useState(false)
  const [hosts, setHosts] = useState<Hosts>({ status: 'loading' })
  const { loadHosts } = add

  useEffect(() => {
    let gone = false
    loadHosts().then(
      (found) => { if (!gone) setHosts({ status: 'ready', hosts: found }) },
      (error: unknown) => { if (!gone) setHosts({ status: 'failed', message: errorMessage(error, 'Could not read ~/.ssh/config') }) },
    )
    return () => { gone = true }
  }, [loadHosts])

  // The machine the last try saved goes again before the next one, so it is neither "already in Maiker" nor a name that is taken.
  const others = useMemo(() => list.filter((head) => head.name === null || head.name !== flow.saved), [list, flow.saved])
  const taken = useMemo(() => others.flatMap((head) => (head.name === null ? [] : [head.name])), [others])
  const address = typed === '' ? null : withPort(checkAddress(typed), portText)
  const already = useMemo(() => {
    const lower = typed.toLowerCase()
    if (lower === '') return null
    return others.find((head) => head.name?.toLowerCase() === lower || head.target?.toLowerCase() === lower) ?? null
  }, [others, typed])
  const problem = already !== null ? `${typed} is already in Maiker.` : address !== null && !address.ok ? address.message : null
  const valid = address?.ok === true && already === null
  const keyFile = keyText.trim() === '' ? null : keyText.trim()

  const submit = () => {
    if (busy) return
    // A problem shows only for what was sent; an address that was sent has none to show until it is edited and sent again.
    setShown(!valid)
    if (!valid) return
    flow.add({ target: targetOf(address.user, address.host), name: suggestedName({ host: address.host }, taken), port: address.port, keyFile, shown: address.host })
  }

  const choices = hosts.status === 'ready' ? offeredHosts(text, hosts.hosts) : []
  const pick = (host: HostChoice) => {
    if (host.added) {
      const head = headOf(list, host.alias)
      if (head !== undefined) onOpenAdded(head)
      return
    }
    flow.add({ target: host.alias, name: suggestedName({ alias: host.alias }, taken), port: null, keyFile, shown: host.alias })
  }

  return (
    <AddMachineFrame title="Add a remote machine">
      <FrameBody>
        <p className="mx-rm-lead-text">{LEAD}</p>
        {/* One form, so Enter in the port or key file sends it too. */}
        <form className="flex flex-col gap-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <div className="mx-rm-address">
            <input
              className="mono"
              aria-label="Address"
              aria-invalid={shown && problem !== null}
              value={text}
              placeholder={ADDRESS_PLACEHOLDER}
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              autoFocus
              readOnly={busy}
              onChange={(event) => { setText(event.target.value); setShown(false) }}
            />
            <Button type="submit" variant="solid" size="field" aria-disabled={typed === '' || busy}>Add</Button>
          </div>
          {shown && problem !== null && <p className="mx-rm-error" role="alert">{problem}</p>}
          <AddressOptions port={portText} keyFile={keyText} onPort={(next) => { setPortText(next); setShown(false) }} onKeyFile={setKeyText} />
        </form>
        {shown && already?.name != null && (
          <p className="mx-rm-hint">
            <Button onClick={() => { machines.onRetry(already.name ?? '') }}>Retry {already.name}</Button>
            <Button variant="ghost" onClick={() => { void machines.onRemove(already.name ?? '') }}>Remove {already.name}</Button>
          </p>
        )}
        <AddStatus state={flow.state} machines={machines} onRetry={flow.retry} />
        <SshHosts hosts={hosts} choices={choices} list={list} busy={busy} onPick={pick} />
      </FrameBody>
      <FrameFoot>
        <Button variant="ghost" size="lg" onClick={busy ? flow.cancel : onClose}>Cancel</Button>
      </FrameFoot>
    </AddMachineFrame>
  )
}

/** The one line under the field once Add is pressed: the spinner, or the host's sentence and what can be done about it. */
function AddStatus({ state, machines, onRetry }: { state: AddState; machines: MachinesInfo; onRetry: () => void }) {
  if (state.kind === 'busy') {
    const { shown } = state.request
    return <StatusBlock tone="work" lead={state.installing ? `Connecting to ${shown} and setting up Maiker there…` : `Connecting to ${shown}…`} />
  }
  if (state.kind !== 'failed') return null
  const { failure } = state
  // The login terminal needs the machine's number, which it has once the window lists the machine the host saved.
  const login = failure.kind === 'needs-person' ? machines.list.find((head) => head.name === failure.saved && head.machine > 0) : undefined
  return (
    <StatusBlock tone={toneOf(failure)} lead={failure.message} copy={failure.fixCommand === null ? undefined : { text: failure.fixCommand, label: 'the command', onCopy: machines.onCopyCommand }}>
      <button type="button" className="mx-rm-primary" onClick={onRetry}>Try again</button>
      {login !== undefined && <button type="button" className="mx-rm-text" onClick={() => { machines.onOpenLogin(login.machine) }}>Sign in in a terminal</button>}
    </StatusBlock>
  )
}

/** Amber for a login only the person can finish (a new host key is theirs to accept), red for anything else. */
function toneOf(failure: AddFailure): 'needs' | 'bad' {
  return failure.kind === 'key-refused' || failure.kind === 'needs-person' || failure.kind === 'host-key-unknown' ? 'needs' : 'bad'
}

/** The machine a host of the SSH config was added as: by its target, or by its name. */
function headOf(list: readonly MachineHead[], alias: string): MachineHead | undefined {
  const lower = alias.toLowerCase()
  return list.find((head) => head.target?.toLowerCase() === lower || head.name?.toLowerCase() === lower)
}

/** What the right-hand end of a host row says: Add, or that the machine is already there and how it stands. */
function hostWords(host: HostChoice, head: MachineHead | undefined): string {
  if (!host.added) return 'Add'
  return head?.chip === null || head?.chip === undefined || head.chip.word === 'connected' ? 'Already added' : `Already added · ${head.chip.word}`
}

type HostsProps = { hosts: Hosts; choices: readonly HostChoice[]; list: readonly MachineHead[]; busy: boolean; onPick: (host: HostChoice) => void }

function SshHosts({ hosts, choices, list, busy, onPick }: HostsProps) {
  if (hosts.status === 'loading') return <SkeletonLines label="Reading hosts from ~/.ssh/config" className="mx-rm-hint" />
  if (hosts.status === 'failed') return <p className="mx-rm-hint" role="alert">{hosts.message}</p>
  if (choices.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="mx-rm-label" id="mx-rm-hosts-label">From your SSH config</span>
      <div role="list" aria-labelledby="mx-rm-hosts-label" className="mx-rm-hostlist">
        {choices.map((host) => {
          const words = hostWords(host, headOf(list, host.alias))
          return (
            <div key={host.alias} role="listitem">
              <button type="button" className={host.added ? 'mx-rm-host is-added' : 'mx-rm-host'} disabled={busy} aria-label={host.added ? `${host.alias}: ${words}` : `Add ${host.alias}`} onClick={() => { onPick(host) }}>
                <span className="mx-rm-hostname">{host.alias}</span>
                <span className="mx-rm-hostaddr mono">{host.detail}</span>
                <span className="mx-rm-hostgo" aria-hidden={host.added ? undefined : 'true'}>{words}</span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
