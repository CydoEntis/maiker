import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SkeletonLines } from '@/components/ui/skeleton'
import { toast } from '@/lib/toast'
import { exportDaemonLog, openDaemonLog } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { MachineHead } from '@/features/workspace/model/machines'
import { matching, nameOf, ordered, rowOf, SEARCH_AFTER, updatable, UPDATE_ALL_FROM, type MachineRow, type RowAction } from '../model/machineRows'
import { SettingsSearch } from '../settingsSearch'
import { Card, Row as SettingsRow, type DaemonInfo, type MachinesInfo } from './DesktopSettings'
import { GitHubSection, type GitHubSignIn } from './GitHubSection'
import { MachineFold } from './MachineFold'
import { Since } from './Since'
import { StateMark, StatusBlock } from './StatusBlock'
import { UpdateAsk } from './UpdateAsk'
import { useUpdateFlow, type UpdateFlow } from './useUpdateFlow'

/** How long "Retrying…" shows before the row's own state is trusted again. */
const RETRY_BUSY_MS = 6000

type View = 'list' | 'this'

const BUTTON_WORDS: Record<Exclude<RowAction, 'retry'>, string> = { fix: 'Fix', update: 'Update', install: 'Install' }

type Props = {
  daemon: DaemonInfo
  machines: MachinesInfo
  github: GitHubSignIn | undefined
  appVersion: string | null
}

/** Settings › Remote machines: the list (each machine one row, its settings folded under More) or this computer's details. Add machine opens the palette's New machine level. */
export function MachinesPage({ daemon, machines, github, appVersion }: Props) {
  const [view, setView] = useState<View>('list')
  const search = useContext(SettingsSearch)
  const flow = useUpdateFlow(machines.onUpdate, machines.onCheckActivity)
  const countOf = (head: MachineHead) => machines.sessionsOn?.(head.machine) ?? null

  // Search results hold only cards with rows: this computer's are the ones that are always there.
  if (search !== null) return <ThisComputer daemon={daemon} github={github} />
  if (view === 'this') {
    return (
      <div className="mx-rm-page">
        <button type="button" className="mx-rm-back" onClick={() => { setView('list') }}>All machines</button>
        <ThisComputer daemon={daemon} github={github} />
      </div>
    )
  }
  return (
    <MachineList
      machines={machines}
      flow={flow}
      countOf={countOf}
      appVersion={appVersion}
      localLine={localLineOf(daemon, machines, appVersion)}
      onAdd={machines.add.open}
      onThisComputer={() => { setView('this') }}
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
  appVersion: string | null
  localLine: string
  onAdd: () => void
  onThisComputer: () => void
}

function MachineList({ machines, flow, countOf, appVersion, localLine, onAdd, onThisComputer }: ListProps) {
  const [query, setQuery] = useState('')
  // One fold open at a time, and one Remove question, by the machine's key.
  const [unfolded, setUnfolded] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set())
  const [askingAll, setAskingAll] = useState(false)
  const timers = useRef(new Set<number>())
  useEffect(() => { const held = timers.current; return () => { for (const timer of held) window.clearTimeout(timer) } }, [])

  const heads = machines.list
  const shown = ordered(matching(heads, query), countOf)
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
    if (action === 'fix') setUnfolded(head.key)
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
            const open = unfolded === head.key
            return (
              <MachineRowView
                key={head.key}
                head={head}
                row={rowOf(head, countOf(head))}
                open={open}
                busy={busy}
                onFold={() => { setUnfolded(open ? null : head.key) }}
                onAction={(action) => { act(head, action) }}
              >
                {flow.asking?.name === head.label && <UpdateAsk flow={flow} />}
                {open && <MachineFold head={head} sessions={countOf(head)} machines={machines} appVersion={appVersion} onRemove={() => { setRemoving(head.key) }} />}
                {removing === head.key && <RemoveAsk name={head.label} onRemove={() => { setRemoving(null); void machines.onRemove(head.label) }} onCancel={() => { setRemoving(null) }} />}
              </MachineRowView>
            )
          })}
          {shown.length === 0 && <p className="mx-rm-hint">No machines match.</p>}
        </div>
      )}
      <div className="mx-rm-local">
        <StateMark glyph="●" tone="ok" />
        <span className="mx-rm-who">
          <span className="mx-rm-name">This computer</span>
          <span className="mx-rm-addr mono">{localLine}</span>
        </span>
        <button type="button" className="mx-rm-out" onClick={onThisComputer}>Details</button>
      </div>
    </section>
  )
}

type RowProps = {
  head: MachineHead
  row: MachineRow
  /** Its More fold is open. */
  open: boolean
  busy: string | null
  onFold: () => void
  onAction: (action: RowAction) => void
  children?: ReactNode
}

/**
 * One row per machine: its mark, its name over its address, what matters now, at most one fix, and a caret that unfolds
 * its settings (Remove is there, at the foot). Clicking the row folds it too.
 */
function MachineRowView({ head, row, open, busy, onFold, onAction, children }: RowProps) {
  const name = nameOf(head)
  return (
    <div role="listitem" className="mx-rm-item" aria-label={name}>
      <div className="mx-rm-row" onClick={onFold}>
        <StateMark glyph={row.glyph} tone={row.tone} />
        <span className="mx-rm-who">
          <span className="mx-rm-name">{name}</span>
          {head.target !== null && <span className="mx-rm-addr mono" title={head.target}>{head.target}</span>}
        </span>
        <span className={`mx-rm-line is-${row.tone}`}>{row.line}{row.showsSince && head.downSince !== null && <> · <Since at={head.downSince} /></>}</span>
        <span className="mx-rm-act">
          {busy !== null
            ? <span className="mx-rm-busy">{busy}</span>
            : row.action !== null && <button type="button" className="mx-rm-out" aria-label={`${row.action === 'retry' ? 'Retry' : BUTTON_WORDS[row.action]} ${name}`} onClick={(event) => { event.stopPropagation(); onAction(row.action as RowAction) }}>{row.action === 'retry' ? 'Retry' : BUTTON_WORDS[row.action]}</button>}
        </span>
        <button type="button" className={`mx-rm-fold-toggle${open ? ' is-open' : ''}`} aria-expanded={open} aria-label={`More about ${name}`} title={open ? 'Less' : 'More'} onClick={(event) => { event.stopPropagation(); onFold() }}>
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  )
}

/** Remove asks in place first and says what stays: the machine leaves the list, nothing on it is touched. */
function RemoveAsk({ name, onRemove, onCancel }: { name: string; onRemove: () => void; onCancel: () => void }) {
  return (
    <StatusBlock tone="needs" lead={`Remove ${name}?`} more={`Its sessions stop showing here. Nothing on ${name} is deleted.`}>
      <button type="button" className="mx-rm-remove" aria-label={`Remove ${name}`} onClick={onRemove}>Remove</button>
      <button type="button" className="mx-rm-text" onClick={onCancel}>Cancel</button>
    </StatusBlock>
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

