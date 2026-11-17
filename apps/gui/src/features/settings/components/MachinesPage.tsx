import { useContext, useEffect, useState, type ReactNode } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { exportDaemonLog, openDaemonLog } from '@/api/daemon'
import { LOCAL_MACHINE, type Added, type HostChoice, type MachineActivity } from '@/api/machines'
import { RadioGroup, RadioGroupItem, Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { DisconnectedSince } from '@/features/workspace/components/times'
import { installNote, UPDATE_WORDS, updateVerb, updateWarning, type MachineHead, type UpdateAction } from '@/features/workspace/model/machines'
import { SettingsSearch } from '../settingsSearch'
import { Card, Row, type DaemonInfo, type MachinesInfo } from './DesktopSettings'
import { GitHubSection, type GitHubSignIn } from './GitHubSection'
import { DAEMON_NAME } from '@/brand'

/** A computer: this one, and the tile of a remote one. The window does not know a machine's kind, so every remote is a server. */
const MONITOR_PATH = 'M3 4h18v12H3zM8 20h8M12 16v4'
const SERVER_PATH = 'M3 4h18v6H3zM3 14h18v6H3zM7 7h.01M7 17h.01'
const PLUS_PATH = 'M12 5v14M5 12h14'
const SEARCH_PATH = 'm20 20-4.2-4.2'
const BACK_PATH = 'm15 18-6-6 6-6'

/** The id that ties the host list to its label. */
const HOSTS_LABEL = 'mx-mach-hosts-label'

/** The selection that shows this computer's card rather than a remote's. */
const LOCAL = 'local'

type Filter = 'all' | 'connected' | 'problems'
type Health = 'ok' | 'quiet' | 'bad'

/** Whether the chip names a line that is down (as against an app to install or update). */
const DOWN_WORDS = new Set(['unreachable', 'refused'])
const LOGIN_WORD = 'needs login'

function healthOf(head: MachineHead): Health {
  return head.chip?.tone ?? 'quiet'
}

/** Something about the machine asks for you: its line is down, it needs a login, or its app needs installing or updating. */
function needsAttention(head: MachineHead): boolean {
  return healthOf(head) === 'bad' || head.updateAction !== null
}

const HEALTH_ORDER: Readonly<Record<Health, number>> = { bad: 0, quiet: 1, ok: 2 }

function sessionWords(count: number): string {
  return count === 1 ? '1 session' : `${String(count)} sessions`
}

/** The first letter up, for a chip word written in lower case. */
function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The summary line under the toolbar: how many there are, and every kind of trouble that is in it. */
function summaryOf(heads: readonly MachineHead[]): { text: string; bad: boolean } {
  const connected = heads.filter((head) => healthOf(head) === 'ok').length
  const down = heads.filter((head) => DOWN_WORDS.has(head.chip?.word ?? '')).length
  const login = heads.filter((head) => head.chip?.word === LOGIN_WORD).length
  const waiting = heads.filter((head) => healthOf(head) === 'quiet').length
  const update = heads.filter((head) => head.updateAction !== null).length
  const parts = [
    `${String(heads.length)} ${heads.length === 1 ? 'machine' : 'machines'}`,
    `${String(connected)} connected`,
    ...(down > 0 ? [`${String(down)} unreachable`] : []),
    ...(login > 0 ? [`${String(login)} ${login === 1 ? 'needs' : 'need'} a login`] : []),
    ...(waiting > 0 ? [`${String(waiting)} connecting`] : []),
    ...(update > 0 ? [`${String(update)} to update`] : []),
  ]
  return { text: parts.join(' · '), bad: down + login > 0 }
}

function Glyph({ path, size = 15, width = '1.8' }: { path: string; size?: number; width?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path} /></svg>
}

function MachineIcon({ path, health }: { path: string; health: Health }) {
  return (
    <span className="mx-mach-icon">
      <Glyph path={path} />
      <span className={`mx-mach-square is-${health}`} />
    </span>
  )
}

type Props = {
  daemon: DaemonInfo
  machines: MachinesInfo
  github: GitHubSignIn | undefined
  appVersion: string | null
}

/** Settings › Remote machines: this computer, a grid of the others to pick from, the picked one's settings, and the add flow. */
export function MachinesPage({ daemon, machines, github, appVersion }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const search = useContext(SettingsSearch)
  const countOf = (head: MachineHead) => machines.sessionsOn?.(head.machine) ?? null

  // Search results hold only cards with rows: this computer's are the ones that are always there.
  if (search !== null) return <ThisComputer daemon={daemon} github={github} />
  if (adding) {
    return (
      <AddMachine
        add={machines.add}
        onClose={() => { setAdding(false) }}
        onOpen={(name) => {
          setAdding(false)
          const added = machines.list.find((head) => head.name === name)
          setSelected(added?.key ?? null)
        }}
      />
    )
  }

  const heads = machines.list
  const counts: Readonly<Record<Filter, number>> = { all: heads.length, connected: heads.filter((head) => healthOf(head) === 'ok').length, problems: heads.filter(needsAttention).length }
  const typed = query.trim().toLowerCase()
  const shown = heads
    .filter((head) => filter === 'all' || (filter === 'connected' ? healthOf(head) === 'ok' : needsAttention(head)))
    .filter((head) => typed === '' || `${head.label} ${head.name ?? ''}`.toLowerCase().includes(typed))
    .sort((a, b) => HEALTH_ORDER[healthOf(a)] - HEALTH_ORDER[healthOf(b)] || Number(b.updateAction !== null) - Number(a.updateAction !== null) || (countOf(b) ?? 0) - (countOf(a) ?? 0))
  const summary = summaryOf(heads)
  const picked = selected === LOCAL ? null : heads.find((head) => head.key === selected) ?? null
  const localCount = machines.sessionsOn?.(LOCAL_MACHINE) ?? daemon.sessionCount
  const localVersion = daemon.version ?? appVersion
  const localLine = localVersion === null ? sessionWords(localCount) : `${localVersion} · ${sessionWords(localCount)}`
  const toggle = (key: string) => { setSelected((now) => (now === key ? null : key)) }

  return (
    <>
      <section className="mx-mach" aria-label="Remote machines">
        <button type="button" className={`mx-mach-local${selected === LOCAL ? ' is-on' : ''}`} aria-pressed={selected === LOCAL} onClick={() => { toggle(LOCAL) }}>
          <MachineIcon path={MONITOR_PATH} health={daemon.online ? 'ok' : 'bad'} />
          <span className="mx-mach-names">
            <span className="mx-mach-name">This computer</span>
            <span className="mx-mach-host">{localLine}</span>
          </span>
          <span className="mx-mach-aside">Every remote connects to this one</span>
        </button>
        <div className="mx-mach-tools">
          <Segmented aria-label="Show" value={filter} onValueChange={(next) => { if (next === 'all' || next === 'connected' || next === 'problems') setFilter(next) }}>
            <SegmentedItem value="all">All <span className="mx-mach-count">{counts.all}</span></SegmentedItem>
            <SegmentedItem value="connected">Connected <span className="mx-mach-count">{counts.connected}</span></SegmentedItem>
            <SegmentedItem value="problems">Needs attention <span className="mx-mach-count">{counts.problems}</span></SegmentedItem>
          </Segmented>
          <label className="mx-mach-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d={SEARCH_PATH} /></svg>
            <input value={query} placeholder="Find a machine" aria-label="Find a machine" spellCheck={false} onChange={(event) => { setQuery(event.target.value) }} />
          </label>
          <button type="button" className="mx-mach-add" disabled={!machines.known} onClick={() => { setAdding(true) }}><Glyph path={PLUS_PATH} size={13} width="2.2" />Add machine</button>
        </div>
        {!machines.known && <SkeletonLines label="Reading machines" className="mx-mach-hint" />}
        {machines.known && heads.length === 0 && <p className="mx-mach-hint">No other machines yet. Add one to see its sessions in your sidebar.</p>}
        {machines.known && heads.length > 0 && (
          <>
            <span className={`mx-mach-summary${summary.bad ? ' is-bad' : ''}`}>{summary.text}</span>
            <div className="mx-mach-grid">
              {shown.map((head) => <MachineTile key={head.key} head={head} sessions={countOf(head)} on={selected === head.key} onPick={() => { toggle(head.key) }} />)}
            </div>
            {shown.length === 0 && <span className="mx-mach-hint">No machines match.</span>}
          </>
        )}
        {selected === null
          ? machines.known && heads.length > 0 && <span className="mx-mach-hint">Click a machine to see and change its settings.</span>
          : (
            <div className="mx-mach-selbar">
              <span>{selected === LOCAL ? 'This computer' : picked?.label}</span>
              <button type="button" onClick={() => { setSelected(null) }}>Close</button>
            </div>
          )}
      </section>
      {selected === LOCAL && <ThisComputer daemon={daemon} github={github} />}
      {picked !== null && <MachineDetail key={picked.key} head={picked} sessions={countOf(picked)} machines={machines} github={github} onRemoved={() => { setSelected(null) }} />}
    </>
  )
}

function MachineTile({ head, sessions, on, onPick }: { head: MachineHead; sessions: number | null; on: boolean; onPick: () => void }) {
  const health = healthOf(head)
  const chip = head.chip
  const update = head.updateAction === null ? null : UPDATE_WORDS[head.updateAction].verb
  return (
    <button type="button" className={`mx-mach-tile is-${health}${on ? ' is-on' : ''}`} aria-pressed={on} title={`${head.label} settings`} onClick={onPick}>
      <span className="mx-mach-tile-head">
        <MachineIcon path={SERVER_PATH} health={health} />
        <span className="mx-mach-names">
          <span className="mx-mach-name">{head.label}</span>
          {head.name !== null && head.name !== head.label && <span className="mx-mach-host">{head.name}</span>}
        </span>
      </span>
      <span className={`mx-mach-state is-${health}`}>
        {chip && <span className="mx-mach-glyph" aria-hidden="true">{chip.glyph}</span>}
        <span className="mx-mach-word">{chip ? capitalised(chip.word) : 'Connecting'}{head.down && <> · <DisconnectedSince at={head.downSince} /></>}</span>
      </span>
      <span className="mx-mach-foot">
        <span>{sessions === null ? 'sessions unknown' : sessionWords(sessions)}</span>
        {update !== null && <span className="mx-mach-update">{update}</span>}
      </span>
    </button>
  )
}

/** A row whose value is plain text, in the cards of a picked machine. */
function ValueRow({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return <Row label={label} detail={detail}><span className="mx-scard-value">{children}</span></Row>
}

function ThisComputer({ daemon, github }: { daemon: DaemonInfo; github: GitHubSignIn | undefined }) {
  const color = daemon.online ? 'var(--ok)' : 'var(--danger)'
  const saveLog = () => {
    exportDaemonLog().then(
      (path) => { toast.success('Log saved', { description: path }) },
      (error: unknown) => { toast.error(errorMessage(error, 'Could not save the log')) },
    )
  }
  const showLog = () => { openDaemonLog().catch((error: unknown) => { toast.error(errorMessage(error, 'Could not open the log')) }) }
  return (
    <>
      <Card title="This computer"
        meta={<span role="status" className="mx-mach-meta" style={{ color }}><span className="mx-mach-dot" style={{ background: color }} />{daemon.online ? 'Connected' : 'Disconnected'}</span>}
      >
        {daemon.version && <ValueRow label="Version" detail="Shared by the GUI and the Maitty TUI.">{daemon.version}</ValueRow>}
        {daemon.socket && <ValueRow label="Socket" detail="Where clients connect.">{daemon.socket}</ValueRow>}
        <ValueRow label="Sessions" detail="Owned by the daemon. The GUI only attaches.">{daemon.sessionCount}</ValueRow>
        <Row label="Service log" detail="What the service did lately, for working out a problem. Save a copy puts it in your Downloads folder as maitty-log.txt. It names your folders and repositories, so look before you share it.">
          <span className="mx-mach-buttons">
            <button type="button" className="mx-scard-button" onClick={saveLog}>Save a copy</button>
            <button type="button" className="mx-scard-button" onClick={showLog}>Show in folder</button>
          </span>
        </Row>
      </Card>
      <GitHubSection machines={[]} signIn={github} only={LOCAL_MACHINE} />
    </>
  )
}

/** The settings of one other machine: how it is reached, its app's version, what it may do here, GitHub there, and removing it. */
function MachineDetail({ head, sessions, machines, github, onRemoved }: { head: MachineHead; sessions: number | null; machines: MachinesInfo; github: GitHubSignIn | undefined; onRemoved: () => void }) {
  const name = head.label
  const health = healthOf(head)
  const down = DOWN_WORDS.has(head.chip?.word ?? '') || head.chip?.word === LOGIN_WORD
  return (
    <>
      <Card title="Connection">
        {health === 'ok' && <ValueRow label="Link" detail={`Over ssh, through its own ${DAEMON_NAME}.`}>connected</ValueRow>}
        {health === 'quiet' && <ValueRow label="Link" detail={`Over ssh, through its own ${DAEMON_NAME}.`}>{head.chip?.word ?? 'connecting'}</ValueRow>}
        {down && (
          <Row label={capitalised(head.chip?.word ?? 'unreachable')} detail={head.why ?? 'Maitty keeps trying to reach it.'}>
            <span className="mx-mach-buttons">
              <button type="button" className="mx-scard-button is-primary" aria-label={`Retry ${name}`} onClick={() => { machines.onRetry(name) }}>Retry now</button>
            </span>
          </Row>
        )}
        {head.down && <ValueRow label="Since" detail="When the line went down.">{<DisconnectedSince at={head.downSince} />}</ValueRow>}
        <ValueRow label="Sessions" detail={health === 'ok' ? 'Running there, shown in your sidebar.' : 'Its sessions come back when it does.'}>{sessions === null ? '—' : health === 'ok' ? String(sessions) : `${String(sessions)} shown`}</ValueRow>
      </Card>
      <VersionCard head={head} machines={machines} />
      <Card title="Allow">
        <Row label="Copy to your clipboard" detail={`Let ${name} put text on your clipboard.`}>
          <Switch aria-label={`Allow ${name} to copy to your clipboard`} checked={head.grants.clipboard} onCheckedChange={(on) => { machines.onGrant(name, 'clipboard', on) }} />
        </Row>
        <Row label="Notifications" detail={`Let ${name} raise notices, and tell you when its sessions need you or finish.`}>
          <Switch aria-label={`Allow ${name} to notify you`} checked={head.grants.notices} onCheckedChange={(on) => { machines.onGrant(name, 'notices', on) }} />
        </Row>
      </Card>
      {health === 'ok' && <GitHubSection machines={[head]} signIn={github} only={head.machine} />}
      <RemoveCard name={name} onRemove={() => { machines.onRemove(name); onRemoved() }} />
    </>
  )
}

/** The machine's app, when it needs installing or updating: the fix, said before it runs, and the command to run instead. */
function VersionCard({ head, machines }: { head: MachineHead; machines: MachinesInfo }) {
  const name = head.label
  const action = head.updateAction
  const [asking, setAsking] = useState(false)
  const [activity, setActivity] = useState<MachineActivity | null>(null)
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  if (action === null && head.updateCommand === null && head.chip?.word !== 'newer than this app') return null
  const words = action === null ? null : UPDATE_WORDS[action]
  const ask = (chosen: UpdateAction) => {
    setActivity(null)
    if (chosen === 'install') { setAsking(true); return }
    setChecking(true)
    void machines.onCheckActivity(name)
      .catch(() => null)
      .then((found) => { setActivity(found); setAsking(true) })
      .finally(() => { setChecking(false) })
  }
  const run = (chosen: UpdateAction, whenIdle: boolean) => {
    setAsking(false)
    setRunning(true)
    void machines.onUpdate(name, chosen, whenIdle).finally(() => { setRunning(false) })
  }
  const detail = asking && action !== null
    ? (action === 'install' ? installNote(name) : updateWarning(name, activity))
    // At rest the fix is the button: the detail is the command to run by hand, not ssh's whole sentence about it.
    : running && words !== null ? words.running(name) : head.updateCommand ?? head.why ?? ''
  return (
    <Card title="Version">
      <Row label={words === null ? 'Maitty' : words.need(name)} detail={detail}>
        <span className="mx-mach-buttons">
          {action !== null && words !== null && !asking && <button type="button" className="mx-scard-button is-primary" disabled={running || checking} aria-label={`${words.verb} Maitty on ${name}`} onClick={() => { ask(action) }}>{checking ? 'Checking…' : words.verb}</button>}
          {asking && action === 'install' && <button type="button" className="mx-scard-button is-primary" onClick={() => { run(action, false) }}>Install on {name} now</button>}
          {asking && action === 'update' && (
            <>
              <button type="button" className="mx-scard-button is-danger" onClick={() => { run(action, false) }}>{updateVerb(action, activity)} {name} now</button>
              <button type="button" className="mx-scard-button" onClick={() => { run(action, true) }}>{updateVerb(action, activity)} {name} when idle</button>
            </>
          )}
          {asking && <button type="button" className="mx-scard-button" onClick={() => { setAsking(false) }}>Cancel</button>}
          {!asking && head.updateCommand !== null && <button type="button" className="mx-scard-button" aria-label={`Copy the update command for ${name}`} onClick={() => { if (head.updateCommand !== null) machines.onCopyCommand(head.updateCommand) }}>Copy command</button>}
        </span>
      </Row>
    </Card>
  )
}

function RemoveCard({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [asking, setAsking] = useState(false)
  return (
    <Card title="Remove">
      <Row label={`Remove ${name}`} detail={asking ? `Removes ${name} from this list. Its sessions keep running on ${name}.` : `Its sessions stop showing here. Nothing on ${name} is deleted.`}>
        <span className="mx-mach-buttons">
          {asking
            ? (
              <>
                <button type="button" className="mx-scard-button is-danger" onClick={onRemove}>Remove {name}</button>
                <button type="button" className="mx-scard-button" onClick={() => { setAsking(false) }}>Keep</button>
              </>
            )
            : <button type="button" className="mx-scard-button is-danger" aria-label={`Remove ${name}`} onClick={() => { setAsking(true) }}>Remove</button>}
        </span>
      </Row>
    </Card>
  )
}

type HostsState = { status: 'loading' } | { status: 'ready'; hosts: readonly HostChoice[] } | { status: 'failed'; message: string }
type AddMode = 'ssh' | 'address'
/** Where the add flow is: filling in the form, looking at the machine over ssh, or how that went. */
type AddStep =
  | { step: 'form'; note: string | null }
  | { step: 'checking'; target: string }
  | { step: 'failed'; target: string; message: string }
  | { step: 'done'; target: string; added: Exclude<Added, { outcome: 'needs-name' | 'cancelled' }> }

/** What the done step says the machine came to. */
function doneWords(added: Exclude<Added, { outcome: 'needs-name' | 'cancelled' }>): { text: string; good: boolean } {
  switch (added.outcome) {
    case 'added': return { text: `${added.name} is added and connecting.${added.version ? ` ${added.version} answered there.` : ''} Its sessions will show in your sidebar.`, good: true }
    case 'login': return { text: `${added.name} is added. ssh needs you to log in: use the session named “ssh ${added.name}”.`, good: true }
    case 'login-manual': return { text: `${added.name} is added. Run “ssh ${added.target}” once in a terminal to log in, then retry it (${added.why}).`, good: false }
  }
}

/** The add-a-machine flow: pick a host of ~/.ssh/config or type an address, name it, and connect. */
function AddMachine({ add, onClose, onOpen }: { add: MachinesInfo['add']; onClose: () => void; onOpen: (name: string) => void }) {
  const [hosts, setHosts] = useState<HostsState>({ status: 'loading' })
  const [mode, setMode] = useState<AddMode>('ssh')
  const [host, setHost] = useState<string | null>(null)
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [state, setState] = useState<AddStep>({ step: 'form', note: null })
  const { loadHosts } = add
  useEffect(() => {
    let gone = false
    loadHosts().then(
      (list) => { if (!gone) setHosts({ status: 'ready', hosts: list }) },
      (error: unknown) => { if (!gone) setHosts({ status: 'failed', message: errorMessage(error, 'Could not read ~/.ssh/config') }) },
    )
    return () => { gone = true }
  }, [loadHosts])

  const target = mode === 'ssh' ? host ?? '' : address.trim()
  const typedName = name.trim()
  const connect = () => {
    if (target === '') return
    setState({ step: 'checking', target })
    add.onAdd(target, typedName === '' ? undefined : typedName).then(
      (result) => {
        if (result.outcome === 'needs-name') { setState({ step: 'form', note: `Give ${target} a name in Maitty to add it.` }); return }
        if (result.outcome === 'cancelled') { setState({ step: 'form', note: 'Cancelled. Nothing was added.' }); return }
        setHosts((now) => (now.status === 'ready' ? { status: 'ready', hosts: now.hosts.filter((choice) => choice.alias !== target) } : now))
        setState({ step: 'done', target, added: result })
      },
      (error: unknown) => { setState({ step: 'failed', target, message: errorMessage(error, 'Could not add the machine') }) },
    )
  }
  const again = () => { setHost(null); setAddress(''); setName(''); setState({ step: 'form', note: null }) }

  return (
    <section className="mx-mach-addflow" aria-label="Add a machine">
      <nav aria-label="Breadcrumb" className="mx-mach-crumbs">
        <button type="button" onClick={onClose}><Glyph path={BACK_PATH} size={13} width="2.2" />Remote machines</button>
        <span aria-hidden="true">›</span>
        <span className="mx-mach-crumb-here">Add a machine</span>
      </nav>
      <div className="mx-mach-addbox">
        {state.step === 'form' && (
          <form className="mx-mach-form" onSubmit={(event) => { event.preventDefault(); connect() }}>
            {add.windows && <p className="mx-mach-note">Windows: use ssh keys or an agent. Password prompts work in the session but are not remembered.</p>}
            <Segmented aria-label="How" value={mode} onValueChange={(next) => { if (next === 'ssh' || next === 'address') setMode(next) }}>
              <SegmentedItem value="ssh">From ~/.ssh/config</SegmentedItem>
              <SegmentedItem value="address">By address</SegmentedItem>
            </Segmented>
            {mode === 'address' && (
              <label className="mx-mach-field">
                <span>Address</span>
                <input className="mono" aria-label="Address" value={address} placeholder="user@host or user@10.0.0.5" spellCheck={false} autoFocus onChange={(event) => { setAddress(event.target.value) }} />
                <span className="mx-mach-help">Uses your ssh keys.</span>
              </label>
            )}
            {mode === 'ssh' && <HostChoices hosts={hosts} picked={host} onPick={(alias) => { setHost(alias) }} />}
            <label className="mx-mach-field">
              <span>Name in Maitty</span>
              <input aria-label="Name in Maitty" value={name} placeholder={target === '' ? 'e.g. homelab' : target} spellCheck={false} onChange={(event) => { setName(event.target.value) }} />
            </label>
            {state.note !== null && <p className="mx-mach-note" role="status">{state.note}</p>}
            <div className="mx-mach-formfoot">
              <span>Connects over ssh. If Maitty isn't on the machine yet, you can install it from its settings once it is added.</span>
              <button type="button" className="mx-mach-quiet" onClick={onClose}>Cancel</button>
              <button type="submit" className="mx-mach-go" disabled={target === ''}>Connect {typedName === '' ? (target === '' ? 'machine' : target) : typedName}</button>
            </div>
          </form>
        )}
        {state.step !== 'form' && (
          <div className="mx-mach-run">
            <span className="mx-mach-target">{state.target}</span>
            <span className={`mx-mach-stage is-${state.step}`}>
              <span className="mx-mach-stage-mark" aria-hidden="true">{state.step === 'checking' ? <span className="mx-mach-spin" /> : state.step === 'failed' ? '✕' : '✓'}</span>
              {state.step === 'checking' ? `Reaching ${state.target} over ssh…` : `Reach ${state.target} over ssh`}
            </span>
            {state.step === 'checking' && (
              <div className="mx-mach-runfoot" data-owns-escape onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); add.onCancel() } }}>
                <span role="status">Esc ends ssh and adds nothing.</span>
                <button type="button" className="mx-mach-quiet" autoFocus onClick={add.onCancel}>Cancel</button>
              </div>
            )}
            {state.step === 'failed' && (
              <div className="mx-mach-fail" role="alert">
                <span className="mono">{state.message}</span>
                <span className="mx-mach-buttons">
                  <button type="button" className="mx-mach-go" onClick={() => { setState({ step: 'form', note: null }) }}>Edit and try again</button>
                  <button type="button" className="mx-mach-quiet" onClick={onClose}>Cancel</button>
                </span>
              </div>
            )}
            {state.step === 'done' && <DoneFoot added={state.added} onAgain={again} onOpen={onOpen} />}
          </div>
        )}
      </div>
    </section>
  )
}

function DoneFoot({ added, onAgain, onOpen }: { added: Exclude<Added, { outcome: 'needs-name' | 'cancelled' }>; onAgain: () => void; onOpen: (name: string) => void }) {
  const words = doneWords(added)
  return (
    <div className="mx-mach-done">
      <span className={words.good ? 'is-good' : 'is-bad'} role="status">{words.text}</span>
      <button type="button" className="mx-mach-quiet" onClick={onAgain}>Add another</button>
      <button type="button" className="mx-mach-go" onClick={() => { onOpen(added.name) }}>Open its settings</button>
    </div>
  )
}

function HostChoices({ hosts, picked, onPick }: { hosts: HostsState; picked: string | null; onPick: (alias: string) => void }) {
  if (hosts.status === 'loading') return <SkeletonLines label="Reading hosts from ~/.ssh/config" className="mx-mach-note" />
  if (hosts.status === 'failed') return <p className="mx-mach-note" role="alert">{hosts.message}</p>
  if (hosts.hosts.length === 0) return <p className="mx-mach-note">No new hosts in ~/.ssh/config. Choose By address to type one.</p>
  return (
    <div className="mx-mach-hosts">
      <span className="mx-mach-label" id={HOSTS_LABEL}>Hosts in your ssh config</span>
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
