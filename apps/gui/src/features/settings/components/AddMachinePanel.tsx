import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/error-message'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName, withPort } from '../model/addressCheck'
import { keySetupCommand } from '../model/keyCommand'
import { targetOf } from '../model/machineTarget'
import { AddOutcome, type Stage } from './AddOutcome'
import { AddressOptions } from './AddressOptions'
import type { MachinesInfo } from './DesktopSettings'

const BACK_PATH = 'm15 18-6-6 6-6'
const IS_WINDOWS = /windows/i.test(typeof navigator === 'undefined' ? '' : navigator.userAgent)
const LEAD = 'Maiker connects over SSH, using your keys. It never asks for or keeps passwords.'
/** How long "Connected" is shown after the key worked, before the dialog closes. */
const CONNECTED_SHOWN_MS = 1400
const ADDRESS_PLACEHOLDER = 'user@host, IP address or name'
const ADDRESS_HINT = 'Type user@host, an IP address, or a name from your SSH config. Add :port if it is not 22.'
const BARE_HOST = /^[\d.]+(:\d*)?$/

type Hosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

/** What was last asked of the host, so Try again reruns the whole sequence from the start. */
type Request = { target: string; name: string; port: number | null; host: string }

/** How the machine came to be added: reached (`connected`), Maiker put on it (`installed`), or left as it is (`added`). */
export type AddedHow = 'connected' | 'installed' | 'added'

type Props = {
  machines: MachinesInfo
  /** The breadcrumb: back to the list. */
  onClose: () => void
  /** The machine is added: the list is where the person sees it. */
  onAdded: (name: string, how: AddedHow) => void
  /** Shown inside the first-run setup, which has its own steps: no breadcrumb back to the list. */
  embedded?: boolean
}

/** Settings › Remote machines › Add a machine: one field, one status block, and the hosts of ~/.ssh/config. */
export function AddMachinePanel({ machines, onClose, onAdded, embedded = false }: Props) {
  const { add, list } = machines
  // One field takes `user@host`, an IP address or a name from the SSH config, as typed or pasted.
  const [text, setText] = useState('')
  const [portText, setPortText] = useState('')
  const typed = text.trim()
  // The message waits for Enter or Connect, and editing the field hides it again.
  const [shown, setShown] = useState(false)
  const [stage, setStage] = useState<Stage | null>(null)
  const [hosts, setHosts] = useState<Hosts>({ status: 'loading' })
  const input = useRef<HTMLInputElement>(null)
  // Only the latest connect may change the screen: a result that comes back after Cancel is dropped.
  const ticket = useRef(0)
  const last = useRef<Request | null>(null)
  const working = stage?.kind === 'working'
  const { loadHosts, onCancel } = add
  // The machine this dialog saved that has not connected: the host writes it before the login, so closing must take it out again.
  const unconnected = useRef<string | null>(null)
  const removeMachine = useRef(machines.onRemove)
  useEffect(() => { removeMachine.current = machines.onRemove })

  useEffect(() => {
    let gone = false
    loadHosts().then(
      (found) => { if (!gone) setHosts({ status: 'ready', hosts: found }) },
      (error: unknown) => { if (!gone) setHosts({ status: 'failed', message: errorMessage(error, 'Could not read ~/.ssh/config') }) },
    )
    return () => { gone = true }
  }, [loadHosts])

  // Leaving the screen while it connects cancels the connection.
  const stopOnLeave = useRef(false)
  useEffect(() => { stopOnLeave.current = working }, [working])
  useEffect(() => () => { if (stopOnLeave.current) onCancel() }, [onCancel])

  const taken = useMemo(() => list.flatMap((head) => (head.name === null ? [] : [head.name])), [list])
  const address = typed === '' ? null : withPort(checkAddress(typed), portText)
  const already = useMemo(() => {
    const lower = typed.toLowerCase()
    // Once a connect has run the machine is saved, so it is in the list; the outcome box below says where it stands, and "already added" over it would contradict it.
    if (lower === '' || stage !== null) return null
    return list.find((head) => head.name?.toLowerCase() === lower || head.target?.toLowerCase() === lower) ?? null
  }, [list, typed, stage])
  const problem = already !== null ? `${typed} is already in Maiker.` : address !== null && !address.ok ? address.message : null
  const valid = address?.ok === true && already === null

  const finish = useCallback((name: string, how: AddedHow) => { ticket.current += 1; unconnected.current = null; onAdded(name, how) }, [onAdded])

  const connect = (request: Request) => {
    const run = ++ticket.current
    last.current = request
    setStage({ kind: 'working', text: `Reaching ${request.name}…` })
    add.onAdd(request.target, request.name, request.port ?? undefined).then(
      (result) => {
        if (run !== ticket.current) return
        if (result.outcome === 'cancelled') { setStage(null); return }
        if (result.outcome === 'needs-name') { setStage({ kind: 'no-name', target: request.target }); return }
        unconnected.current = result.name
        if (result.outcome === 'added' && (result.reach === 'answered' || result.reach === 'newer-here')) { finish(result.name, 'connected'); return }
        setStage({ kind: 'added', added: result, choice: 'ask', port: request.port })
      },
      (error: unknown) => {
        if (run !== ticket.current) return
        setStage({ kind: 'failed', message: errorMessage(error, 'Could not add the machine'), host: request.host, port: request.port })
      },
    )
  }

  const changed = () => { setShown(false); if (!working) setStage(null) }
  const submit = () => {
    setShown(true)
    if (working || !valid) return
    connect({ target: targetOf(address.user, address.host), name: suggestedName({ host: address.host }, taken), port: address.port, host: address.host })
  }

  const edit = () => {
    ticket.current += 1
    setStage(null)
    input.current?.focus()
  }

  const cancel = () => {
    ticket.current += 1
    add.onCancel()
    setStage(null)
  }

  // A machine that needed a person (a key, a host key) or a restart is added; it counts as done once it connects.
  const waitingOn = stage?.kind === 'added' && (stage.added.outcome === 'login' || stage.added.reach === 'not-running') ? stage.added.name : null
  const connected = waitingOn !== null && list.some((head) => head.name === waitingOn && head.chip?.word === 'connected')
  useEffect(() => { if (connected) unconnected.current = null }, [connected])
  // Closing (Cancel, Close, Esc) with a saved machine that never connected leaves nothing invisible behind; a connected or kept one stays.
  useEffect(() => () => { if (embedded && unconnected.current !== null) removeMachine.current(unconnected.current) }, [embedded])
  // The key terminal is the person's way of making it connect, so they are shown that it did before the screen goes.
  // The stage the terminal was asked for: another stage (a new answer, an edit) is another object, so the terminal is gone with it.
  const [settingUpFor, setSettingUpFor] = useState<Stage | null>(null)
  const settingUp = settingUpFor !== null && settingUpFor === stage
  const shownConnected = connected && settingUp ? waitingOn : null
  useEffect(() => {
    if (connected && !settingUp) { finish(waitingOn, 'connected'); return undefined }
    if (shownConnected === null) return undefined
    const timer = window.setTimeout(() => { finish(shownConnected, 'connected') }, CONNECTED_SHOWN_MS)
    return () => { window.clearTimeout(timer) }
  }, [connected, settingUp, waitingOn, shownConnected, finish])

  const install = () => {
    if (stage?.kind !== 'added' || stage.added.outcome !== 'added') return
    const { added } = stage
    const run = ticket.current
    setStage({ kind: 'added', added, choice: 'installing', port: stage.port })
    machines.onUpdate(added.name, added.reach === 'missing' ? 'install' : 'update', false).then(
      () => { if (run === ticket.current) finish(added.name, 'installed') },
      () => { if (run === ticket.current) setStage({ kind: 'added', added, choice: 'ask', port: stage.port }) },
    )
  }

  // The key is set up in a terminal of this computer shown right here: the person types the password there, and the machine
  // is dialled again until it connects. The terminal goes with the error: any other stage unmounts it, which ends its shell.
  const keyCommand = stage?.kind === 'added' && stage.added.outcome === 'login' ? keySetupCommand(stage.added.target, stage.port, IS_WINDOWS) : null
  const keyTerminal = machines.keyTerminal
  const offersKey = keyTerminal !== undefined && keyCommand !== null
  const onSetUpKey = offersKey ? () => { setSettingUpFor(stage) } : null
  const terminal = offersKey && settingUp ? { host: keyTerminal, onFailed: () => { setSettingUpFor(null) } } : null
  const outcome: Stage | null = shownConnected === null ? stage : { kind: 'connected', name: shownConnected }

  // Only a name typed for the SSH config narrows its list; `user@host` and an IP address never do.
  const filter = typed.includes('@') || BARE_HOST.test(typed) ? '' : typed.toLowerCase()
  const choices = hosts.status === 'ready' ? hosts.hosts.filter((host) => `${host.alias} ${host.detail}`.toLowerCase().includes(filter)) : []

  return (
    <section className="mx-rm-add" aria-label="Add a machine">
      {!embedded && (
        <nav aria-label="Breadcrumb" className="mx-rm-crumbs">
          <button type="button" onClick={onClose}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={BACK_PATH} /></svg>Remote machines</button>
          <span aria-hidden="true">/</span>
          <span className="mx-rm-here">Add a machine</span>
        </nav>
      )}
      <p className="mx-rm-lead-text">{LEAD}</p>
      {terminal === null && (
      <form className="mx-rm-address" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <input
          ref={input}
          className="mono"
          aria-label="Address"
          aria-invalid={shown && problem !== null}
          value={text}
          placeholder={ADDRESS_PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          autoFocus
          readOnly={working}
          onChange={(event) => { setText(event.target.value); changed() }}
        />
        <button type="submit" className="mx-rm-primary" aria-disabled={!valid || working}>Connect</button>
      </form>
      )}
      {stage === null && <p className="mx-rm-hint">{ADDRESS_HINT}</p>}
      {stage === null && <AddressOptions port={portText} readOnly={working} onPort={(next) => { setPortText(next); changed() }} />}
      {shown && problem !== null && <p className="mx-rm-error" role="alert"><span aria-hidden="true">×</span> {problem}</p>}
      {shown && already?.name != null && (
        <p className="mx-rm-hint">
          <button type="button" className="mx-rm-primary" onClick={() => { machines.onRetry(already.name ?? '') }}>Retry {already.name}</button>
          <button type="button" className="mx-rm-text" onClick={() => { machines.onRemove(already.name ?? '') }}>Remove {already.name}</button>
        </p>
      )}
      {outcome !== null && (
        <div data-owns-escape onKeyDown={(event) => { if (working && event.key === 'Escape') { event.stopPropagation(); cancel() } }}>
          <AddOutcome stage={outcome} machines={machines} onTryAgain={() => { if (last.current !== null) connect(last.current) }} onEdit={edit} onCancel={cancel} onInstall={install} onSkip={() => { if (stage?.kind === 'added') finish(stage.added.name, 'added') }} keyCommand={keyCommand} onSetUpKey={onSetUpKey} terminal={terminal} />
        </div>
      )}
      {stage === null && <SshHosts hosts={hosts} choices={choices} onPick={(host) => { connect({ target: host.alias, name: suggestedName({ alias: host.alias }, taken), port: null, host: host.alias }) }} />}
    </section>
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
