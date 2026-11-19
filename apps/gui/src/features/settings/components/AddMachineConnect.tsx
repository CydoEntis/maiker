import { useEffect, useState, type ReactNode } from 'react'
import type { Added } from '@/api/machines'
import { stepRows, unreachableKind, type StepFacts, type StepMark, type Stop } from '../model/addSteps'
import { userOf } from '../model/machineTarget'
import { AddStepper } from './AddMachineChoose'
import type { MachinesInfo } from './DesktopSettings'
import { HOST_KEY_WORDS, HostKeyCard } from './HostKeyCard'
import { KeyLoginCard, PASSWORD_OFFERED } from './KeyLoginCard'

/** Where adding a machine is, from the moment Connect is pressed. */
export type Phase =
  | { readonly kind: 'running' }
  /** Not added: ssh could not reach it. `message` is ssh's own words. */
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'added'; readonly added: Extract<Added, { outcome: 'added' | 'login' }> }

const COPIED_MS = 1600
const MARK_GLYPH: Readonly<Record<StepMark, string>> = { wait: '', run: '', done: '✓', needs: '!', bad: '✕' }
const MARK_CLASS: Readonly<Record<StepMark, string>> = { wait: 'wait', run: 'spin', done: 'ok', needs: 'warn', bad: 'bad' }

type Props = {
  /** What was typed or picked: `user@host` or an alias. */
  target: string
  /** What the machine is called in Maiker, or the target when it has no name yet. */
  label: string
  phase: Phase
  machines: MachinesInfo
  onTryAgain: () => void
  onChange: () => void
  onCancel: () => void
  onBack: () => void
  onOpen: (name: string) => void
  onStartOn: (name: string) => void
}

/** Stages 2 and 3: the four steps with what each came to, the question or the problem under the step it belongs to, and the Ready screen. */
export function AddMachineConnect(props: Props) {
  const { phase, target } = props
  const [chosen, setChosen] = useState<'idle' | 'installing' | 'skipped' | 'installed'>('idle')
  const added = phase.kind === 'added' ? phase.added : null
  const name = added?.name ?? props.label
  const reach = added?.outcome === 'added' ? added.reach : null
  const needsSetup = reach === 'missing' || reach === 'older'
  const stop = stopOf(phase, chosen === 'idle' && needsSetup)
  const facts: StepFacts = {
    name,
    user: userOf(target) === '' ? null : userOf(target),
    tookMs: added?.outcome === 'added' ? added.took_ms : null,
    version: added?.outcome === 'added' ? added.version : null,
    skipped: chosen === 'skipped',
  }
  const ready = phase.kind === 'added' && stop === null && chosen !== 'installing'
  const rows = stepRows(facts, { stop, running: phase.kind === 'running' || chosen === 'installing' })
  if (ready) return <Ready {...props} name={name} skipped={chosen === 'skipped'} newer={reach === 'newer-here'} />
  const state = stop === null ? 'running' : stop.mark === 'needs' ? 'needs' : 'failed'
  return (
    <section className="mx-mach-form mx-mach-connect" aria-label={`Connecting to ${name}`}>
      <AddStepper stage={1} />
      <div className="mx-add-where"><span><strong>{name}</strong> <span className="mono">{target}</span></span><button type="button" className="mx-mach-quiet" onClick={props.onChange}>Change</button></div>
      <div aria-live="polite">
        <h3 className="mx-mach-h">{state === 'running' ? `Connecting to ${name}…` : state === 'needs' ? `${name} needs you` : `Couldn't connect to ${name}`}</h3>
        <p className="mx-mach-note">{state === 'running' ? 'Maiker goes through these four steps. It will stop and ask if it needs anything from you.' : state === 'needs' ? 'Maiker stopped to ask you something. Pick an option below to carry on.' : `Nothing was changed on ${name}. Fix the problem below, then try again.`}</p>
      </div>
      <ol className="mx-mach-steps mx-add-steps" aria-label="Steps">
        {rows.map((row, index) => (
          <li key={row.title} className={`mx-mach-stage is-${MARK_CLASS[row.mark]}`}>
            <span className="mx-mach-stage-mark" aria-hidden="true">{row.mark === 'run' ? <span className="mx-mach-spin" /> : MARK_GLYPH[row.mark]}</span>
            <span className="mx-add-step-body">
              <span className="mx-add-step-title">{row.mark === 'run' ? row.text : row.title}</span>
              {row.mark !== 'run' && <span className={`mx-add-step-text${row.mark === 'done' ? ' mono' : ''}`}>{row.text}</span>}
              {stop !== null && index === STEP_INDEX[stop.step] && <Box {...props} name={name} chosen={chosen} onChoose={setChosen} />}
            </span>
          </li>
        ))}
      </ol>
      <div className="mx-mach-formfoot" data-owns-escape onKeyDown={(event) => { if (state === 'running' && event.key === 'Escape') { event.stopPropagation(); props.onCancel() } }}>
        <span role="status">{state === 'running' ? (chosen === 'installing' ? 'This takes about 20 seconds.' : 'Usually takes under 10 seconds.') : state === 'needs' ? 'Waiting for you.' : `Stopped. Nothing was changed on ${name}.`}</span>
        {state === 'running' && <button type="button" className="mx-mach-quiet" autoFocus onClick={props.onCancel}>Cancel</button>}
        {state !== 'running' && <button type="button" className="mx-mach-quiet" onClick={props.onBack}>Cancel</button>}
      </div>
    </section>
  )
}

const STEP_INDEX = { find: 0, login: 1, setup: 2, link: 3 } as const

/** The step the look stopped at, from how it went. `asksSetup` is an install or update the person has not answered. */
function stopOf(phase: Phase, asksSetup: boolean): Stop | null {
  if (phase.kind === 'running') return null
  if (phase.kind === 'failed') return { step: 'find', mark: 'bad' }
  const { added } = phase
  if (added.outcome === 'login') return { step: HOST_KEY_WORDS.test(added.said) ? 'find' : 'login', mark: 'needs' }
  if (asksSetup) return { step: 'setup', mark: 'needs' }
  return added.reach === 'not-running' ? { step: 'link', mark: 'bad' } : null
}

type BoxProps = Props & { name: string; chosen: 'idle' | 'installing' | 'skipped' | 'installed'; onChoose: (next: 'idle' | 'installing' | 'skipped' | 'installed') => void }

/** What opens under the step: an explanation, what to do about it, and the way to carry on. */
function Box({ phase, name, target, machines, chosen, onChoose, onTryAgain, onChange, onOpen }: BoxProps) {
  if (phase.kind === 'running') return null
  if (phase.kind === 'failed') return <Unreachable name={name} target={target} message={phase.message} onTryAgain={onTryAgain} onChange={onChange} />
  const { added } = phase
  if (added.outcome === 'login') {
    if (HOST_KEY_WORDS.test(added.said)) {
      return (
        <DecisionBox tone="needs" title="Is this the right computer?" details={added.said}>
          <p>This is the first time you've connected to {name} from here, so SSH asks you to confirm it. If you set up this computer yourself, or someone you trust gave you the address, it's safe to trust it.</p>
          <HostKeyCard name={added.name} inspect={machines.hostKey.inspect} trust={machines.hostKey.trust} />
        </DecisionBox>
      )
    }
    return <KeyRejected name={name} added={added} machines={machines} onOpen={onOpen} />
  }
  if (added.reach === 'not-running') {
    return (
      <DecisionBox tone="bad" title={`Maiker is installed on ${name} but couldn't start.`} details={null}>
        <p>Its daemon did not answer. Try again, or open its settings to see what it says.</p>
        <span className="mx-mach-buttons">
          <button type="button" className="mx-add-act is-bad" onClick={() => { machines.onRetry(added.name) }}>Try again</button>
          <button type="button" className="mx-mach-quiet" onClick={() => { onOpen(added.name) }}>Open its settings</button>
        </span>
      </DecisionBox>
    )
  }
  const missing = added.reach === 'missing'
  const action = missing ? 'install' : 'update'
  const installing = chosen === 'installing'
  const run = () => {
    onChoose('installing')
    machines.onUpdate(added.name, action, false).then(() => { onChoose('installed') }, () => { onChoose('idle') })
  }
  return (
    <DecisionBox tone="needs" title={missing ? `Maiker isn't on ${name} yet` : `${name} has an older Maiker`} details={null}>
      <p>{missing ? 'Install it so you can run sessions there. It goes in your home folder (~/.maiker, about 40 MB) and doesn\'t touch anything else.' : 'It will work, but some features need both computers on the same version. Updating takes about 20 seconds.'}</p>
      <span className="mx-mach-buttons">
        <button type="button" className="mx-add-act is-needs" disabled={installing} onClick={run}>{missing ? 'Install Maiker' : 'Update Maiker'}</button>
        <button type="button" className="mx-mach-quiet" disabled={installing} onClick={() => { onChoose('skipped') }}>{missing ? 'Not now' : 'Keep it'}</button>
      </span>
    </DecisionBox>
  )
}

function Unreachable({ name, target, message, onTryAgain, onChange }: { name: string; target: string; message: string; onTryAgain: () => void; onChange: () => void }) {
  const kind = unreachableKind(message)
  const host = target.slice(target.lastIndexOf('@') + 1)
  return (
    <DecisionBox tone="bad" title={kind === 'no-answer' ? `${name} didn't answer` : kind === 'refused' ? `${name} refused the connection` : kind === 'cannot-resolve' ? `Couldn't find ${host}` : `Couldn't connect to ${name}`} details={message}>
      {kind === 'no-answer' && (
        <>
          <p>Maiker waited 10 seconds and heard nothing back. Usually it's one of these:</p>
          <ul><li>It's turned off or asleep.</li><li>It's on another network. Turn on your VPN if you use one.</li><li>A firewall is blocking SSH (port 22).</li></ul>
        </>
      )}
      {kind === 'refused' && <p>{name} is on, but nothing is listening for SSH on that port.</p>}
      {kind === 'cannot-resolve' && <p>Couldn't find a computer called {host}. Check the spelling, or use its IP address.</p>}
      {kind === 'other' && <p>ssh said the words under technical details.</p>}
      <span className="mx-mach-buttons">
        <button type="button" className="mx-add-act is-bad" onClick={onTryAgain}>Try again</button>
        <button type="button" className="mx-mach-quiet" onClick={onChange}>Change address</button>
      </span>
    </DecisionBox>
  )
}

function KeyRejected({ name, added, machines, onOpen }: { name: string; added: Extract<Added, { outcome: 'login' }>; machines: MachinesInfo; onOpen: (name: string) => void }) {
  const command = `ssh-copy-id ${added.target}`
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  return (
    <DecisionBox tone="bad" title={`${name} didn't accept your key`} details={added.said}>
      <p>Your SSH key isn't on {name} yet. Run this once in a terminal. It asks for your {name} password one time, then copies your key over. Then try again.</p>
      <span className="mx-add-copy"><code className="mono">{command}</code><button type="button" className="mx-mach-quiet" onClick={() => { machines.onCopyCommand(command); setCopied(true) }}>{copied ? 'Copied' : 'Copy'}</button></span>
      {PASSWORD_OFFERED.test(added.said) && <KeyLoginCard name={added.name} inspect={machines.keyLogin.inspect} setUp={machines.keyLogin.setUp} />}
      <span className="mx-mach-buttons">
        <button type="button" className="mx-add-act is-bad" onClick={() => { machines.onRetry(added.name) }}>Try again</button>
        <button type="button" className="mx-mach-quiet" onClick={() => { onOpen(added.name) }}>Open its settings</button>
      </span>
    </DecisionBox>
  )
}

/** The box under a step: a coloured rule on the left, the words, and the raw output behind a toggle. */
function DecisionBox({ tone, title, details, children }: { tone: 'needs' | 'bad'; title: string; details: string | null; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`mx-add-box is-${tone}`} role={tone === 'bad' ? 'alert' : 'group'} aria-label={title}>
      <strong className="mx-add-box-title">{title}</strong>
      {children}
      {details !== null && (
        <>
          <button type="button" className="mx-mach-quiet mx-add-toggle" aria-expanded={open} onClick={() => { setOpen(!open) }}>{open ? '▾' : '▸'} Show technical details</button>
          {open && <pre className="mono mx-add-raw">{details}</pre>}
        </>
      )}
    </div>
  )
}

function Ready({ name, target, skipped, newer, onBack, onStartOn }: Props & { name: string; skipped: boolean; newer: boolean }) {
  return (
    <section className="mx-mach-form mx-mach-ready" aria-label={`${name} is ready`}>
      <AddStepper stage={2} />
      <div className="mx-add-ready">
        <span className="mx-add-ready-tick" aria-hidden="true">✓</span>
        <h3 className="mx-mach-h" role="status">{name} is ready</h3>
        <p className="mx-mach-note">You can now start sessions on {name}. They show in your sidebar next to the ones on this computer.</p>
        {skipped && <p className="mx-mach-note">Maiker isn't installed there yet. Install it from Remote machines when you want to run sessions on it.</p>}
        {newer && <p className="mx-mach-note">The Maiker on {name} is newer than this app. It works; update this app when you can.</p>}
      </div>
      <div className="mx-add-preview" aria-label="How it shows in Maiker"><span className="mx-add-dot" aria-hidden="true" /><strong>{name}</strong><span className="mono">{target}</span><span>Connected</span></div>
      <div className="mx-mach-formfoot">
        <span>You can rename, update or remove it any time in Remote machines.</span>
        <button type="button" className="mx-mach-quiet" onClick={onBack}>Back to machines</button>
        <button type="button" className="mx-mach-go" onClick={() => { onStartOn(name) }}>Start a session on {name}</button>
      </div>
    </section>
  )
}
