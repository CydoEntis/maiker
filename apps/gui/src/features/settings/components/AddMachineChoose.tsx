import { useState } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { HostChoice } from '@/api/machines'
import { checkAddress, suggestedName } from '../model/addressCheck'
import { portOf, targetOf } from '../model/machineTarget'

export type ChooseHosts = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }

/** What the person decided on this screen: where to connect and what to call it. */
export type Chosen = { readonly target: string; readonly name: string | undefined; readonly port: number | undefined }

const HOSTS_LABEL = 'mx-mach-hosts-label'
const FIRST_STAGE = 0
const STAGES = ['Choose a computer', 'Connect', 'Ready'] as const

/** The three stages of adding a machine: the current one filled, the ones before it with a tick. */
export function AddStepper({ stage }: { stage: number }) {
  return (
    <ol className="mx-mach-stepper" aria-label="Progress">
      {STAGES.map((title, index) => (
        <li key={title} className={index < stage ? 'is-done' : index === stage ? 'is-now' : ''} aria-current={index === stage ? 'step' : undefined}>
          <span className="mx-mach-stepper-mark" aria-hidden="true">{index < stage ? '✓' : String(index + 1)}</span>
          {title}
        </li>
      ))}
    </ol>
  )
}

/** Stage 1: pick a computer of ~/.ssh/config or type its address, and name it. Nothing is changed on it from here. */
export function AddMachineChoose({ hosts, taken, note, windows, onConnect, onCancel }: {
  hosts: ChooseHosts
  /** The names machines already have, so a suggested one is never a repeat. */
  taken: readonly string[]
  note: string | null
  /** This computer is Windows: its ssh cannot remember a password. */
  windows: boolean
  onConnect: (chosen: Chosen) => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // An error shows once the person leaves the field or presses Enter, not while they are still typing.
  const [shown, setShown] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [portText, setPortText] = useState('')

  const address = typed.trim() === '' ? null : checkAddress(typed)
  const advancedPort = portOf(portText.trim())
  const typedPort = address?.ok === true ? address.port ?? advancedPort ?? null : null
  const target = picked ?? (address?.ok === true ? targetOf(address.user, address.host) : '')
  const suggestion = picked !== null ? suggestedName({ alias: picked }, taken) : address?.ok === true ? suggestedName({ host: address.host }, taken) : ''
  const called = (name ?? suggestion).trim()
  const problem = address !== null && !address.ok ? address.message : advancedPort === undefined ? 'Ports go from 1 to 65535.' : null
  const ready = target !== '' && advancedPort !== undefined

  const connect = () => {
    setShown(true)
    if (!ready) return
    onConnect({ target, name: called === '' ? undefined : called, port: picked === null ? typedPort ?? undefined : undefined })
  }

  return (
    <form className="mx-mach-form mx-mach-choose" onSubmit={(event) => { event.preventDefault(); connect() }}>
      <AddStepper stage={FIRST_STAGE} />
      <div>
        <h3 className="mx-mach-h">Which computer do you want to use?</h3>
        <p className="mx-mach-note">Maiker logs in to it over SSH, the same way you would from a terminal, and sets itself up there. Then you can start sessions on that computer from this app.</p>
      </div>
      {windows && <p className="mx-mach-note">Windows: use ssh keys or an agent. Password prompts work in the session but are not remembered.</p>}
      <HostRadios hosts={hosts} picked={picked} onPick={(alias) => { setPicked(alias); setTyped(''); setShown(false); setName(null) }} />
      <label className="mx-mach-field">
        <span>Type its address</span>
        <input
          className="mono"
          aria-label="Type its address"
          aria-invalid={shown && problem !== null}
          value={typed}
          placeholder="you@192.168.1.20  or  you@my-server.com"
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => { setTyped(event.target.value); setPicked(null); setShown(false); setName(null) }}
          onBlur={() => { if (typed.trim() !== '') setShown(true) }}
        />
      </label>
      {shown && problem !== null && <p className="mx-mach-note is-bad" role="alert">{problem}</p>}
      {problem === null && address?.ok === true && <p className="mx-mach-note">Maiker will log in to {address.user === '' ? 'you@' : `${address.user}@`}{address.host} using your SSH key.</p>}
      {target !== '' && (
        <label className="mx-mach-field">
          <span>What should Maiker call it?</span>
          <input aria-label="What should Maiker call it?" value={name ?? suggestion} placeholder="e.g. homelab" spellCheck={false} onChange={(event) => { setName(event.target.value) }} />
        </label>
      )}
      <div className="mx-mach-more">
        <button type="button" className="mx-mach-quiet" aria-expanded={more} onClick={() => { setMore(!more) }}>{more ? '▾' : '▸'} Advanced: port</button>
        {more && (
          <label className="mx-mach-field">
            <span>Port</span>
            <input className="mono mx-mach-port" aria-label="Port" value={portText} placeholder="22" inputMode="numeric" spellCheck={false} onChange={(event) => { setPortText(event.target.value) }} />
          </label>
        )}
      </div>
      {note !== null && <p className="mx-mach-note" role="status">{note}</p>}
      <div className="mx-mach-formfoot">
        <span>Nothing is changed on that computer until you say so.</span>
        <button type="button" className="mx-mach-quiet" onClick={onCancel}>Cancel</button>
        <button type="submit" className="mx-mach-go" disabled={target === ''}>{target === '' ? 'Pick a computer first' : `Connect to ${called === '' ? target : called}`}</button>
      </div>
    </form>
  )
}

function HostRadios({ hosts, picked, onPick }: { hosts: ChooseHosts; picked: string | null; onPick: (alias: string) => void }) {
  if (hosts.status === 'loading') return <SkeletonLines label="Reading hosts from ~/.ssh/config" className="mx-mach-note" />
  if (hosts.status === 'failed') return <p className="mx-mach-note" role="alert">{hosts.message}</p>
  if (hosts.hosts.length === 0) return null
  return (
    <div className="mx-mach-hosts">
      <span className="mx-mach-label" id={HOSTS_LABEL}>Computers you already use with SSH</span>
      <RadioGroup aria-labelledby={HOSTS_LABEL} value={picked ?? ''} onValueChange={onPick} className="mx-mach-hostlist">
        {hosts.hosts.map((choice) => (
          <RadioGroupItem key={choice.alias} value={choice.alias} className={`mx-mach-hostrow${picked === choice.alias ? ' is-on' : ''}`}>
            <span className="mx-mach-radio" aria-hidden="true" />
            <span className="mx-mach-hostname">{choice.alias}</span>
            <span className="mx-mach-hostaddr">{choice.detail}</span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
    </div>
  )
}
