import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { HostChoice } from '@/api/machines'
import { errorMessage } from '@/lib/error-message'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { CopyLine } from '@/features/settings/components/StatusBlock'
import type { AddRequest, AddState } from '@/features/settings/model/addFlow'
import { Icon } from '@/features/workspace/components/glyphs'
import { MAX_MACHINE_NICKNAME_LENGTH } from '@/features/workspace/model/machines'
import { BackButton, PaletteBody, PaletteFoot, StatusBlock, type Status } from './PaletteBody'
import { failureTone, hostRequest, machineRows, nicknameOf, stageHints, stageKeyAction, stageOf, typedRequest, type MachineDraft, type MachineStage, type StageAction } from './newMachine'
import type { RowAction } from './openPalette'
import { usePaletteShell } from './paletteShell'
import { useAddMachine } from './useAddMachine'

const MOST_PORT_DIGITS = 5
const NO_DRAFT: MachineDraft = { text: '', port: '', keyFile: '' }

type Hosts = { hosts: readonly HostChoice[]; problem: string | null }

/**
 * New machine (ADR 0017): one field for what `ssh` would take, with the port and a key file behind Options. Enter
 * connects: a spinner, then the machine is in and can be named and browsed, or the host's one sentence says what failed
 * and how to fix it. Nothing here asks for a password, shows a fingerprint or copies a key.
 */
export function MachineLevel({ adding }: { adding: MachinesInfo }) {
  const shell = usePaletteShell()
  const flow = useAddMachine(adding)
  const [draft, setDraft] = useState(NO_DRAFT)
  const [optionsOpen, setOptionsOpen] = useState(false)
  // What is wrong with the address, shown once Enter sent it and until it is edited.
  const [problem, setProblem] = useState<string | null>(null)
  const [hosts, setHosts] = useState<Hosts>({ hosts: [], problem: null })
  const [sent, setSent] = useState<AddRequest | null>(null)
  // The failure whose address is being edited: the field shows again until the add moves on from it.
  const [revised, setRevised] = useState<AddState | null>(null)
  const [nameText, setNameText] = useState<string | null>(null)
  const optionsId = useId()
  const { loadHosts } = adding.add

  useEffect(() => {
    let gone = false
    loadHosts().then(
      (found) => { if (!gone) setHosts({ hosts: found, problem: null }) },
      // The config's hosts are a shortcut: without them an address can still be typed.
      (error: unknown) => { if (!gone) setHosts({ hosts: [], problem: errorMessage(error, 'Could not read ~/.ssh/config') }) },
    )
    return () => { gone = true }
  }, [loadHosts])

  // The machine the last try saved goes again before the next one, so it neither counts as added nor holds its name.
  const others = useMemo(() => adding.list.filter((head) => head.name !== flow.saved), [adding.list, flow.saved])
  const stage: MachineStage = flow.state === revised ? 'editing' : stageOf(flow.state)

  const edit = (change: Partial<MachineDraft>) => { setDraft((now) => ({ ...now, ...change })); setProblem(null) }
  const send = (request: AddRequest) => { setSent(request); flow.add(request) }
  const onAct = (action: RowAction) => {
    if (action.do !== 'add') { shell.act(action); return }
    if (action.alias !== null) { send(hostRequest(action.alias, draft, others)); return }
    const typed = typedRequest(draft, others)
    if (typed.ok) send(typed.request)
    else setProblem(typed.message)
  }

  if (stage === 'editing') {
    const rows = machineRows(draft, hosts.hosts, others)
    const status: Status | null = problem !== null ? { tone: 'bad', title: problem, detail: null }
      : rows.length === 0 ? { tone: 'plain', title: 'Type the address you’d give ssh', detail: 'Maiker uses your SSH keys and agent, as your terminal does. It never asks for a password.' }
      : null
    return (
      <PaletteBody
        level="machine"
        mode={shell.mode}
        placeholder="user@host, or a name from your SSH config"
        query={draft.text}
        onQuery={(text) => { shell.forget(); edit({ text }) }}
        onBack={shell.back}
        aside={<button type="button" className="mx-op-choice" aria-expanded={optionsOpen} aria-controls={optionsId} onClick={() => { setOptionsOpen(!optionsOpen) }}>Options<Icon name="chevronDown" size={13} /></button>}
        options={optionsOpen ? (
          <div id={optionsId} className="mx-op-options">
            <label><span>Port</span><input inputMode="numeric" value={draft.port} placeholder="22" autoComplete="off" onChange={(event) => { edit({ port: event.target.value.replace(/\D/g, '').slice(0, MOST_PORT_DIGITS) }) }} /></label>
            {/* The host only checks that the file is there and never reads it; a path it cannot use is answered in its own words. */}
            <label><span>Key file</span><input value={draft.keyFile} placeholder="~/.ssh/id_ed25519" spellCheck={false} autoCapitalize="none" autoComplete="off" onChange={(event) => { edit({ keyFile: event.target.value }) }} /></label>
          </div>
        ) : undefined}
        rows={rows}
        status={shell.taking ?? status}
        more={hosts.problem}
        locked={shell.locked}
        onAct={onAct}
      />
    )
  }

  const address = sent === null ? '' : `${sent.target}${sent.port === null ? '' : `:${String(sent.port)}`}`

  if (flow.state.kind === 'busy') {
    const { shown } = flow.state.request
    return (
      <StageFrame stage="connecting" address={address} onBack={shell.back} onAction={() => undefined} actions={<button type="button" className="mx-op-system" onClick={flow.cancel}>Cancel</button>}>
        <StatusBlock status={{ tone: 'working', title: flow.state.installing ? `Connecting to ${shown} and setting up Maiker there…` : `Connecting to ${shown}…`, detail: null }} />
      </StageFrame>
    )
  }

  if (flow.state.kind === 'failed') {
    const failed = flow.state
    const { failure } = failed
    // The login terminal needs the machine's number, which it has once the window lists the machine the host saved.
    const login = failure.kind === 'needs-person' ? adding.list.find((head) => head.name === failure.saved && head.machine > 0) : undefined
    const run = (action: StageAction) => {
      if (action === 'retry') flow.retry()
      else if (action === 'edit') setRevised(failed)
    }
    return (
      <StageFrame stage="failed" address={address} onBack={shell.back} onAction={run}>
        <div className={`mx-op-status is-stacked ${failureTone(failure) === 'needs' ? 'is-offline' : 'is-bad'}`} role="alert">
          <span className="mx-op-status-text"><b>{failure.message}</b></span>
          {failure.fixCommand !== null && <CopyLine text={failure.fixCommand} label="the command" onCopy={adding.onCopyCommand} />}
          <span className="mx-op-acts">
            <button type="button" className="mx-op-primary" data-first-focus="" onClick={() => { run('retry') }}>Try again</button>
            <button type="button" className="mx-op-system" onClick={() => { run('edit') }}>Edit the address</button>
            {/* The sign-in goes on in a terminal of the window, so the palette steps aside and the machine it is for stays listed. */}
            {login !== undefined && <button type="button" className="mx-op-system" onClick={() => { flow.keep(); adding.onOpenLogin(login.machine); shell.close() }}>Sign in in a terminal</button>}
          </span>
        </div>
      </StageFrame>
    )
  }

  const name = flow.state.kind === 'added' ? flow.state.name : ''
  const label = adding.list.find((head) => head.name === name)?.label ?? name
  const typedName = nameText ?? label
  // The folders are browsed by the machine's number, which it has once the window lists it.
  const machine = shell.machines.find((candidate) => candidate.name === name) ?? null
  const finish = (browse: boolean) => {
    if (browse && machine === null) return
    if (typedName.trim() !== label) adding.onRename(name, nicknameOf(typedName, name))
    if (machine !== null && browse) shell.go({ kind: 'browse', machine: machine.machine, path: machine.start })
    else shell.close()
  }
  const calledAs = typedName.trim() === '' ? name : typedName.trim()
  return (
    <StageFrame
      stage="done"
      address={address}
      onBack={shell.back}
      onAction={(action) => { if (action === 'browse') finish(true) }}
      actions={<>
        <button type="button" className="mx-op-system" onClick={() => { finish(false) }}>Done</button>
        <button type="button" className="mx-op-primary" aria-disabled={machine === null} onClick={() => { finish(true) }}>Browse folders on {calledAs}</button>
      </>}
    >
      <StatusBlock status={{ tone: 'plain', title: `${name} is added`, detail: 'Its sessions show in the sidebar.' }} />
      <NameField value={typedName} onChange={setNameText} />
    </StageFrame>
  )
}

function NameField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const id = useId()
  return (
    <div className="mx-op-name-field">
      <label htmlFor={id}>Name</label>
      <input id={id} data-first-focus="" value={value} maxLength={MAX_MACHINE_NICKNAME_LENGTH} spellCheck={false} autoComplete="off" aria-describedby={`${id}-hint`} onChange={(event) => { onChange(event.target.value) }} />
      <span id={`${id}-hint`}>How it shows in the sidebar and the machine picker.</span>
    </div>
  )
}

type FrameProps = {
  stage: Exclude<MachineStage, 'editing'>
  /** What was sent, shown where the field was. */
  address: string
  onBack: () => void
  onAction: (action: StageAction) => void
  /** The foot's buttons. */
  actions?: ReactNode
  children: ReactNode
}

/** The palette frame once Enter was pressed: the New machine chip and the address in place of the field, the stage, and the foot. */
function StageFrame({ stage, address, onBack, onAction, actions, children }: FrameProps) {
  const frame = useRef<HTMLDivElement>(null)
  // Nothing in a stage is the field, so the keys need a home: the stage's first control, or the frame itself.
  useEffect(() => {
    const first = frame.current?.querySelector<HTMLElement>('[data-first-focus]') ?? frame.current
    first?.focus()
    if (first instanceof HTMLInputElement) first.select()
  }, [stage])
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      // The dialog closes on Escape; this keeps the key from the window's own handlers.
      event.stopPropagation()
      return
    }
    // A button keeps its own Enter and Space.
    if (event.target instanceof HTMLButtonElement && (event.key === 'Enter' || event.key === ' ')) return
    const action = stageKeyAction(stage, { key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey })
    if (action === null) return
    event.preventDefault()
    onAction(action)
  }
  return (
    <div ref={frame} className="mx-op-level" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mx-op-head">
        <BackButton disabled={false} onBack={onBack} />
        <span className="mx-op-crumb"><span className="mx-op-machine"><Icon name="server" size={13} />New machine</span></span>
        <span className="mx-op-address" title={address}>{address}</span>
      </div>
      <div className="mx-op-stage">{children}</div>
      <PaletteFoot hints={stageHints(stage)}>{actions}</PaletteFoot>
    </div>
  )
}
