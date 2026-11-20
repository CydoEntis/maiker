import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SkeletonLines } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/error-message'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName, withPort } from '../model/addressCheck'
import type { AddRequest } from '../model/addStage'
import { targetOf } from '../model/machineTarget'
import { AddMachineFrame, FrameBody, FrameFoot } from './AddMachineFrame'
import { AddressOptions } from './AddressOptions'
import type { MachinesInfo } from './DesktopSettings'

const LEAD = 'Maiker connects over SSH, using your keys. It never asks for or keeps passwords.'
const ADDRESS_PLACEHOLDER = 'user@host, IP address or name'
const ADDRESS_HINT = 'Type user@host, an IP address, or a name from your SSH config. Add :port if it is not 22.'

type Hosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

type Props = {
  machines: MachinesInfo
  /** Cancel: the dialog closes. */
  onClose: () => void
  /** Connect (or a host of the SSH config): the checklist takes over. */
  onConnect: (request: AddRequest) => void
  /** What was typed before, when the person came back with Change address. */
  entry?: AddRequest['entry'] | undefined
}

/** Add a remote machine's first step: one field, a closed Port and key row, and the hosts of ~/.ssh/config. */
export function AddMachinePanel({ machines, onClose, onConnect, entry = { address: '', port: '', keyFile: '' } }: Props) {
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
    onConnect({ target: targetOf(address.user, address.host), name: suggestedName({ host: address.host }, taken), port: address.port, host: address.host, keyFile, fromConfig: false, entry: kept })
  }

  // The field is for typing an address and pressing Enter, not for searching: the SSH config's hosts are shortcuts that stay as they are.
  const choices = hosts.status === 'ready' ? hosts.hosts : []
  const pick = (host: HostChoice) => {
    onConnect({ target: host.alias, name: suggestedName({ alias: host.alias }, taken), port: null, host: host.alias, keyFile, fromConfig: true, entry: kept })
  }

  return (
    <AddMachineFrame title="Add a remote machine">
      <FrameBody>
        <p className="mx-rm-lead-text">{LEAD}</p>
        {/* One form, so Enter in the port or key file sends it too. */}
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); submit() }}>
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
            <Button type="submit" aria-disabled={!valid} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-42">Connect</Button>
          </div>
          <p className="mx-rm-hint">{ADDRESS_HINT}</p>
          <AddressOptions port={portText} keyFile={keyText} onPort={(next) => { setPortText(next); setShown(false) }} onKeyFile={setKeyText} />
        </form>
        {shown && problem !== null && <p className="mx-rm-error" role="alert"><span aria-hidden="true">×</span> {problem}</p>}
        {shown && already?.name != null && (
          <p className="mx-rm-hint">
            <Button onClick={() => { machines.onRetry(already.name ?? '') }}>Retry {already.name}</Button>
            <Button variant="ghost" onClick={() => { void machines.onRemove(already.name ?? '') }}>Remove {already.name}</Button>
          </p>
        )}
        <SshHosts hosts={hosts} choices={choices} onPick={pick} />
      </FrameBody>
      <FrameFoot>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </FrameFoot>
    </AddMachineFrame>
  )
}

function SshHosts({ hosts, choices, onPick }: { hosts: Hosts; choices: readonly HostChoice[]; onPick: (host: HostChoice) => void }) {
  if (hosts.status === 'loading') return <SkeletonLines label="Reading hosts from ~/.ssh/config" className="mx-rm-hint" />
  if (hosts.status === 'failed') return <p className="mx-rm-hint" role="alert">{hosts.message}</p>
  if (choices.length === 0) return null
  return (
    <div className="mx-rm-hosts">
      <span className="mx-rm-label" id="mx-rm-hosts-label">From your SSH config</span>
      <div role="list" aria-labelledby="mx-rm-hosts-label">
        {choices.map((host) => (
          <div key={host.alias} role="listitem">
            <button type="button" className="mx-rm-host" aria-label={`Connect to ${host.alias}`} onClick={() => { onPick(host) }}>
              <span className="mx-rm-hostname">{host.alias}</span>
              <span className="mx-rm-hostaddr mono">{host.detail}</span>
              <span className="mx-rm-hostgo" aria-hidden="true">Connect</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
