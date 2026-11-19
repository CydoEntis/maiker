import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { toast } from '@/lib/toast'
import { exportDaemonLog, openDaemonLog } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { MachineHead } from '@/features/workspace/model/machines'
import { matching, nameOf, ordered, rowOf, SEARCH_AFTER, updatable, UPDATE_ALL_FROM, type MachineRow, type RowAction } from '../model/machineRows'
import { SettingsSearch } from '../settingsSearch'
import { AddMachinePanel } from './AddMachinePanel'
import { Card, Row as SettingsRow, type DaemonInfo, type MachinesInfo } from './DesktopSettings'
import { GitHubSection, type GitHubSignIn } from './GitHubSection'
import { MachinePage } from './MachinePage'
import { Since } from './Since'
import { StateMark, StatusBlock } from './StatusBlock'
import { UpdateAsk } from './UpdateAsk'
import { useUpdateFlow, type UpdateFlow } from './useUpdateFlow'

/** How long "Retrying…" shows before the row's own state is trusted again. */
const RETRY_BUSY_MS = 6000

type View = { kind: 'list' } | { kind: 'machine'; key: string } | { kind: 'add' } | { kind: 'this' }

const BUTTON_WORDS: Record<Exclude<RowAction, 'retry'>, string> = { fix: 'Fix', update: 'Update', install: 'Install' }

type Props = {
  daemon: DaemonInfo
  machines: MachinesInfo
  github: GitHubSignIn | undefined
  appVersion: string | null
}

/** Settings › Remote machines: the list, a machine's page, Add a machine, or this computer's details, one at a time. */
export function MachinesPage({ daemon, machines, github, appVersion }: Props) {
  const [view, setView] = useState<View>({ kind: 'list' })
  // The machine the person last opened, so the list marks it when they come back; and the one they just added.
  const [opened, setOpened] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const search = useContext(SettingsSearch)
  const flow = useUpdateFlow(machines.onUpdate, machines.onCheckActivity)
  const countOf = (head: MachineHead) => machines.sessionsOn?.(head.machine) ?? null

  // Search results hold only cards with rows: this computer's are the ones that are always there.
  if (search !== null) return <ThisComputer daemon={daemon} github={github} />
  const back = () => { setView({ kind: 'list' }) }
  if (view.kind === 'add') {
    return <AddMachinePanel machines={machines} onClose={back} onAdded={(name) => { setJustAdded(name); back() }} />
  }
  if (view.kind === 'this') {
    return (
      <div className="mx-rm-page">
        <button type="button" className="mx-rm-back" onClick={back}>All machines</button>
        <ThisComputer daemon={daemon} github={github} />
      </div>
    )
  }
  const picked = view.kind === 'machine' ? machines.list.find((head) => head.key === view.key) ?? null : null
  if (picked !== null) {
    return <MachinePage key={picked.key} head={picked} sessions={countOf(picked)} machines={machines} flow={flow} appVersion={appVersion} onBack={back} onRemoved={back} />
  }
  return (
    <MachineList
      machines={machines}
      flow={flow}
      countOf={countOf}
      opened={opened}
      justAdded={justAdded}
      localLine={localLineOf(daemon, machines, appVersion)}
      onOpen={(head) => { setOpened(head.key); setView({ kind: 'machine', key: head.key }) }}
      onAdd={() => { setView({ kind: 'add' }) }}
      onThisComputer={() => { setView({ kind: 'this' }) }}
    />
  )
}

function localLineOf(daemon: DaemonInfo, machines: MachinesInfo, appVersion: string | null): string {
  const count = machines.sessionsOn?.(LOCAL_MACHINE) ?? daemon.sessionCount
  const version = daemon.version ?? appVersion
  return `${version === null ? '' : `${version} · `}${count === 1 ? '1 session' : `${String(count)} sessions`}`
}

type ListProps = {
  machines: MachinesInfo
  flow: UpdateFlow
  countOf: (head: MachineHead) => number | null
  opened: string | null
  justAdded: string | null
  localLine: string
  onOpen: (head: MachineHead) => void
  onAdd: () => void
  onThisComputer: () => void
}

function MachineList({ machines, flow, countOf, opened, justAdded, localLine, onOpen, onAdd, onThisComputer }: ListProps) {
  const [query, setQuery] = useState('')
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set())
  const [askingAll, setAskingAll] = useState(false)
  const timers = useRef(new Set<number>())
  useEffect(() => { const held = timers.current; return () => { for (const timer of held) window.clearTimeout(timer) } }, [])

  const heads = machines.list
  const shown = ordered(matching(heads, query), countOf, justAdded)
  const behind = updatable(heads)

  const retry = (name: string) => {
    setRetrying((now) => new Set(now).add(name))
    machines.onRetry(name)
    const timer = window.setTimeout(() => {
      timers.current.delete(timer)
      setRetrying((now) => new Set([...now].filter((other) => other !== name)))
    }, RETRY_BUSY_MS)
    timers.current.add(timer)
  }

  const act = (head: MachineHead, action: RowAction) => {
    if (action === 'fix') onOpen(head)
    else if (action === 'retry') retry(head.label)
    else flow.ask(head)
  }

  return (
    <section className="mx-rm" aria-label="Remote machines">
      <div className="mx-rm-head">
        <span className="mx-rm-count">{heads.length === 1 ? '1 machine' : `${String(heads.length)} machines`}</span>
        {heads.length > SEARCH_AFTER && <input className="mx-rm-search" type="search" value={query} placeholder="Find a machine" aria-label="Find a machine" spellCheck={false} onChange={(event) => { setQuery(event.target.value) }} />}
        {behind.length >= UPDATE_ALL_FROM && <button type="button" className="mx-rm-text" disabled={askingAll} onClick={() => { setAskingAll(true) }}>Update all {behind.length}</button>}
        <button type="button" className="mx-rm-primary" disabled={!machines.known} onClick={onAdd}>+ Add machine</button>
      </div>
      {askingAll && (
        <StatusBlock tone="needs" lead={`Update ${String(behind.length)} machines?`} more="Updating restarts each machine's service. Their sessions are saved and come back with their agents resumed; an agent in the middle of a turn loses that turn if you update now. Update when idle waits until nothing is open on a machine, up to half an hour.">
          <button type="button" className="mx-rm-primary" onClick={() => { flow.runAll(behind.map((head) => head.label), false); setAskingAll(false) }}>Update all now</button>
          <button type="button" className="mx-rm-text" onClick={() => { flow.runAll(behind.map((head) => head.label), true); setAskingAll(false) }}>Update all when idle</button>
          <button type="button" className="mx-rm-text" onClick={() => { setAskingAll(false) }}>Cancel</button>
        </StatusBlock>
      )}
      {!machines.known && <SkeletonLines label="Reading machines" className="mx-rm-hint" />}
      {machines.known && heads.length === 0 && (
        <div className="mx-rm-empty">
          <strong>No remote machines yet</strong>
          <p>Run agents on another computer, like a dev box or a cloud server. Maiker connects over SSH, and their sessions show in your sidebar next to these.</p>
          <button type="button" className="mx-rm-primary" onClick={onAdd}>+ Add a machine</button>
        </div>
      )}
      {machines.known && heads.length > 0 && (
        <div role="list" className="mx-rm-list">
          {shown.map((head) => {
            const busy = flow.running.has(head.label) ? (head.updateAction === 'install' ? 'Installing…' : 'Updating…') : flow.checking === head.label ? 'Checking…' : retrying.has(head.label) ? 'Retrying…' : null
            return (
              <MachineRowView key={head.key} head={head} row={rowOf(head, countOf(head), head.name === justAdded)} current={opened === head.key} busy={busy} onOpen={() => { onOpen(head) }} onAction={(action) => { act(head, action) }}>
                {flow.asking?.name === head.label && <UpdateAsk flow={flow} />}
              </MachineRowView>
            )
          })}
          {shown.length === 0 && <p className="mx-rm-hint">No machines match.</p>}
        </div>
      )}
      <div className="mx-rm-local">
        <StateMark glyph="●" tone="ok" />
        <span>This computer</span>
        <span className="mono mx-rm-localline">{localLine}</span>
        <button type="button" className="mx-rm-text" onClick={onThisComputer}>Details</button>
      </div>
    </section>
  )
}

type RowProps = {
  head: MachineHead
  row: MachineRow
  current: boolean
  busy: string | null
  onOpen: () => void
  onAction: (action: RowAction) => void
  children?: ReactNode
}

/** One line per machine: what matters now, and at most one fix. Clicking the row opens the machine's page. */
function MachineRowView({ head, row, current, busy, onOpen, onAction, children }: RowProps) {
  const name = nameOf(head)
  return (
    <div role="listitem" className="mx-rm-item" aria-current={current ? 'true' : undefined}>
      <div className={`mx-rm-row${current ? ' is-current' : ''}`} onClick={onOpen}>
        <StateMark glyph={row.glyph} tone={row.tone} />
        <button type="button" className="mx-rm-name" onClick={(event) => { event.stopPropagation(); onOpen() }}>{name}</button>
        <span className="mx-rm-addr mono">{head.target ?? ''}</span>
        <span className={`mx-rm-line is-${row.tone}`}>{row.line}{row.showsSince && head.downSince !== null && <> · <Since at={head.downSince} /></>}</span>
        <span className="mx-rm-act">
          {busy !== null
            ? <span className="mx-rm-busy">{busy}</span>
            : row.action !== null && <button type="button" className="mx-rm-out" aria-label={`${row.action === 'retry' ? 'Retry' : BUTTON_WORDS[row.action]} ${name}`} onClick={(event) => { event.stopPropagation(); onAction(row.action as RowAction) }}>{row.action === 'retry' ? 'Retry' : BUTTON_WORDS[row.action]}</button>}
        </span>
      </div>
      {children}
    </div>
  )
}

/** A row whose value is plain text, in the cards of this computer. */
function ValueRow({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return <SettingsRow label={label} detail={detail}><span className="mx-scard-value">{children}</span></SettingsRow>
}

function ThisComputer({ daemon, github }: { daemon: DaemonInfo; github: GitHubSignIn | undefined }) {
  const color = daemon.online ? 'var(--ok)' : 'var(--danger)'
  const saveLog = () => {
    exportDaemonLog().then(
      (path) => { toast.success('Log saved', { description: path }) },
      (error: unknown) => { toast.failed('Could not save the log', error) },
    )
  }
  const showLog = () => { openDaemonLog().catch((error: unknown) => { toast.failed('Could not open the log', error) }) }
  return (
    <>
      <Card title="This computer"
        meta={<span role="status" className="mx-mach-meta" style={{ color }}><span className="mx-mach-dot" style={{ background: color }} />{daemon.online ? 'Connected' : 'Disconnected'}</span>}
      >
        {daemon.version && <ValueRow label="Version" detail="Shared by the GUI and the Maiker TUI.">{daemon.version}</ValueRow>}
        {daemon.socket && <ValueRow label="Socket" detail="Where clients connect.">{daemon.socket}</ValueRow>}
        <ValueRow label="Sessions" detail="Owned by the daemon. The GUI only attaches.">{daemon.sessionCount}</ValueRow>
        <SettingsRow label="Service log" detail="What the service did lately, for working out a problem. Save a copy puts it in your Downloads folder as maiker-log.txt. It names your folders and repositories, so look before you share it.">
          <span className="mx-mach-buttons">
            <button type="button" className="mx-scard-button" onClick={saveLog}>Save a copy</button>
            <button type="button" className="mx-scard-button" onClick={showLog}>Show in folder</button>
          </span>
        </SettingsRow>
      </Card>
      <GitHubSection machines={[]} signIn={github} only={LOCAL_MACHINE} />
    </>
  )
}

