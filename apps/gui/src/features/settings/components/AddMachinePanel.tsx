import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SkeletonLines } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/error-message'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName, withPort } from '../model/addressCheck'
import type { MachineHead } from '@/features/workspace/model/machines'
import type { AddRequest } from '../model/addStage'
import { targetOf } from '../model/machineTarget'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'
import { AddressOptions } from './AddressOptions'
import type { MachinesInfo } from './DesktopSettings'

const LEAD = 'Maiker connects over SSH with the keys you already use. It never asks for or stores a password.'
const ADDRESS_PLACEHOLDER = 'user@host, an IP address, or a name from your SSH config'

type Hosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

type Props = {
  machines: MachinesInfo
  /** Cancel: the dialog closes. */
  onClose: () => void
  /** Connect (or a host of the SSH config): the checklist takes over. */
  onConnect: (request: AddRequest) => void
  /** A host of the SSH config that is already a machine was clicked: the machine's own status is shown instead of adding it again. */
  onOpenAdded: (head: MachineHead) => void
  /** What was typed before, when the person came back with Change address. */
  entry?: AddRequest['entry'] | undefined
}

/** Add a remote machine's first step: one field, a closed Port and key row, and the hosts of ~/.ssh/config. */
export function AddMachinePanel({ machines, onClose, onConnect, onOpenAdded, entry = { address: '', port: '', keyFile: '' } }: Props) {
  const { add, list } = machines
  // One field takes `user@host`, an IP address or a name from the SSH config, as typed or pasted.
  const [text, setText] = useState(entry.address)
  const [portText, setPortText] = useState(entry.port)
  const [keyText, setKeyText] = useState(entry.keyFile)
  const typed = text.trim()
  // The message waits for Enter or Connect, and editing the field hides it again.
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

  const taken = useMemo(() => list.flatMap((head) => (head.name === null ? [] : [head.name])), [list])
  const address = typed === '' ? null : withPort(checkAddress(typed), portText)
  const already = useMemo(() => {
    const lower = typed.toLowerCase()
    if (lower === '') return null
    return list.find((head) => head.name?.toLowerCase() === lower || head.target?.toLowerCase() === lower) ?? null
  }, [list, typed])
  const problem = already !== null ? `${typed} is already in Maiker.` : address !== null && !address.ok ? address.message : null
  const valid = address?.ok === true && already === null
  const keyFile = keyText.trim() === '' ? null : keyText.trim()
  const kept = { address: text, port: portText, keyFile: keyText }

  const submit = () => {
    setShown(true)
    if (!valid) return
    onConnect({ target: targetOf(address.user, address.host), name: suggestedName({ host: address.host }, taken), port: address.port, host: address.host, user: address.user === '' ? null : address.user, keyFile, fromConfig: false, entry: kept })
  }

  // The field is for typing an address and pressing Enter, not for searching: the SSH config's hosts are shortcuts that stay as they are.
  const choices = hosts.status === 'ready' ? hosts.hosts : []
  const pick = (host: HostChoice) => {
    if (host.added) {
      const head = headOf(list, host.alias)
      if (head !== undefined) onOpenAdded(head)
      return
    }
    onConnect({ target: host.alias, name: suggestedName({ alias: host.alias }, taken), port: null, ...loginOf(host), keyFile, fromConfig: true, entry: kept })
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
              onChange={(event) => { setText(event.target.value); setShown(false) }}
            />
            <Button type="submit" variant="solid" size="field" aria-disabled={typed === ''}>Connect</Button>
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
        <SshHosts hosts={hosts} choices={choices} list={list} onPick={pick} />
      </FrameBody>
      <FrameFoot>
        <Button variant="ghost" size="lg" onClick={onClose}>Cancel</Button>
      </FrameFoot>
    </AddMachineFrame>
  )
}

/** The computer and login behind an SSH config host, read from the line the list shows (`user@host`); the alias alone when it shows no more. */
function loginOf(host: HostChoice): { host: string; user: string | null } {
  const at = host.detail.indexOf('@')
  return at > 0 && at < host.detail.length - 1 ? { user: host.detail.slice(0, at), host: host.detail.slice(at + 1) } : { user: null, host: host.alias }
}

/** The machine a host of the SSH config was added as: by its target, or by its name. */
function headOf(list: readonly MachineHead[], alias: string): MachineHead | undefined {
  const lower = alias.toLowerCase()
  return list.find((head) => head.target?.toLowerCase() === lower || head.name?.toLowerCase() === lower)
}

/** What the right-hand end of a host row says: Connect, or that the machine is already there and how it stands. */
function hostWords(host: HostChoice, head: MachineHead | undefined): string {
  if (!host.added) return 'Connect'
  return head?.chip === null || head?.chip === undefined || head.chip.word === 'connected' ? 'Already added' : `Already added · ${head.chip.word}`
}

function SshHosts({ hosts, choices, list, onPick }: { hosts: Hosts; choices: readonly HostChoice[]; list: readonly MachineHead[]; onPick: (host: HostChoice) => void }) {
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
              <button type="button" className={host.added ? 'mx-rm-host is-added' : 'mx-rm-host'} aria-label={host.added ? `${host.alias}: ${words}` : `Connect to ${host.alias}`} onClick={() => { onPick(host) }}>
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
