import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/error-message'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName } from '../model/addressCheck'
import { targetOf } from '../model/machineTarget'
import { AddOutcome, type Stage } from './AddOutcome'
import type { MachinesInfo } from './DesktopSettings'

const BACK_PATH = 'm15 18-6-6 6-6'
const LEAD = 'Maiker connects over SSH, using your keys. It never asks for or keeps passwords.'
const PLACEHOLDER = 'user@host, or a name from your SSH config'

type Hosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

/** What was last asked of the host, so Try again reruns the whole sequence from the start. */
type Request = { target: string; name: string; port: number | null; host: string }

type Props = {
  machines: MachinesInfo
  /** The breadcrumb: back to the list. */
  onClose: () => void
  /** The machine is added: the list is where the person sees it. */
  onAdded: (name: string) => void
  /** Shown inside the first-run setup, which has its own steps: no breadcrumb back to the list. */
  embedded?: boolean
}

/** Settings › Remote machines › Add a machine: one field, one status block, and the hosts of ~/.ssh/config. */
export function AddMachinePanel({ machines, onClose, onAdded, embedded = false }: Props) {
  const { add, list } = machines
  const [typed, setTyped] = useState('')
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
  const address = typed.trim() === '' ? null : checkAddress(typed)
  const already = useMemo(() => {
    const text = typed.trim().toLowerCase()
    return text === '' ? null : list.find((head) => head.name?.toLowerCase() === text || head.target?.toLowerCase() === text) ?? null
  }, [list, typed])
  const problem = already !== null ? `${typed.trim()} is already in Maiker.` : address !== null && !address.ok ? address.message : null
  const valid = address?.ok === true && already === null

  const finish = useCallback((name: string) => { ticket.current += 1; onAdded(name) }, [onAdded])

  const connect = (request: Request) => {
    const run = ++ticket.current
    last.current = request
    setStage({ kind: 'working', text: `Reaching ${request.name}…` })
    add.onAdd(request.target, request.name, request.port ?? undefined).then(
      (result) => {
        if (run !== ticket.current) return
        if (result.outcome === 'cancelled') { setStage(null); return }
        if (result.outcome === 'needs-name') { setStage({ kind: 'no-name', target: request.target }); return }
        if (result.outcome === 'added' && (result.reach === 'answered' || result.reach === 'newer-here')) { finish(result.name); return }
        setStage({ kind: 'added', added: result, choice: 'ask' })
      },
      (error: unknown) => {
        if (run !== ticket.current) return
        setStage({ kind: 'failed', message: errorMessage(error, 'Could not add the machine'), host: request.host, port: request.port })
      },
    )
  }

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
  useEffect(() => { if (connected) finish(waitingOn) }, [connected, waitingOn, finish])

  const install = () => {
    if (stage?.kind !== 'added' || stage.added.outcome !== 'added') return
    const { added } = stage
    const run = ticket.current
    setStage({ kind: 'added', added, choice: 'installing' })
    machines.onUpdate(added.name, added.reach === 'missing' ? 'install' : 'update', false).then(
      () => { if (run === ticket.current) finish(added.name) },
      () => { if (run === ticket.current) setStage({ kind: 'added', added, choice: 'ask' }) },
    )
  }

  const filter = typed.trim().toLowerCase()
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
      <form className="mx-rm-address" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <input
          ref={input}
          className="mono"
          aria-label="Address"
          aria-invalid={shown && problem !== null}
          value={typed}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="none"
          autoFocus
          readOnly={working}
          onChange={(event) => { setTyped(event.target.value); setShown(false); if (!working) setStage(null) }}
        />
        <button type="submit" className="mx-rm-primary" aria-disabled={!valid || working}>Connect</button>
      </form>
      {shown && problem !== null && <p className="mx-rm-error" role="alert"><span aria-hidden="true">×</span> {problem}</p>}
      {stage !== null && (
        <div data-owns-escape onKeyDown={(event) => { if (working && event.key === 'Escape') { event.stopPropagation(); cancel() } }}>
          <AddOutcome stage={stage} machines={machines} onTryAgain={() => { if (last.current !== null) connect(last.current) }} onEdit={edit} onCancel={cancel} onInstall={install} onSkip={() => { if (stage.kind === 'added') finish(stage.added.name) }} />
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
