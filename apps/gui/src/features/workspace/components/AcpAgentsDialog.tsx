import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { windowRoot } from './windowRoot'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { ModalBody, ModalFoot, ModalHead } from '@/components/ui/modal'
import { installAcpAgent, loadAcpAgents, removeAcpAgent, type AcpAgent } from '@/api/acpAgents'

/** The agent a session starts with over ACP: its id is what the daemon runs, its name is what the page says. */
export type OtherAgent = { id: string; name: string }

type Props = {
  onPick: (agent: OtherAgent) => void
  onCancel: () => void
}

type Read = { kind: 'loading' } | { kind: 'failed'; why: string } | { kind: 'listed'; agents: AcpAgent[] }

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** What a row says about the agent on this computer. */
function stateOf(agent: AcpAgent): string {
  if (agent.source === 'config') return 'In your config'
  if (agent.installed === null) return agent.unavailable === null ? 'Not installed' : `Cannot be installed: it ${agent.unavailable}`
  return agent.installed === agent.version ? `Installed ${agent.installed}` : `Installed ${agent.installed}; ${agent.version} is out`
}

/** An agent the search names: by its name, id or description, ignoring case. */
function matches(agent: AcpAgent, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  return wanted === '' || [agent.name, agent.id, agent.description].some((text) => text.toLowerCase().includes(wanted))
}

type RowProps = { agent: AcpAgent; busy: boolean; locked: boolean; failed: string | null; onUse: () => void; onChange: (run: (id: string) => Promise<void>) => void }

/** One agent: its name and version, what it is, its state here, and what can be done with it. */
function AgentRow({ agent, busy, locked, failed, onUse, onChange }: RowProps) {
  const ready = agent.installed !== null
  const fromRegistry = agent.source === 'registry'
  return (
    <div className="mx-acp-row" role="listitem">
      <span className="mx-acp-mark" aria-hidden="true">{agent.name.slice(0, 1).toUpperCase()}</span>
      <div className="mx-acp-text">
        <span className="mx-acp-name">{agent.name}{agent.version !== '' && <span className="mx-acp-version">{agent.version}</span>}</span>
        {agent.description !== '' && <span className="mx-acp-about">{agent.description}</span>}
        <span className="mx-acp-state">{busy ? (ready ? 'Working…' : 'Installing… this can take a few minutes') : stateOf(agent)}</span>
        {failed !== null && <p role="alert" className="mx-nsd-note is-error">{failed}</p>}
      </div>
      <div className="mx-acp-actions">
        {ready && fromRegistry && <Button type="button" variant="ghost" size="md" disabled={locked} aria-label={`Remove ${agent.name}`} onClick={() => { onChange(removeAcpAgent) }}>Remove</Button>}
        {ready && fromRegistry && agent.installed !== agent.version && agent.unavailable === null && <Button type="button" variant="ghost" size="md" disabled={locked} aria-label={`Update ${agent.name}`} onClick={() => { onChange(installAcpAgent) }}>Update</Button>}
        {ready && <Button type="button" variant="primary" size="md" disabled={locked} aria-label={`Use ${agent.name}`} onClick={onUse}>Use</Button>}
        {!ready && agent.unavailable === null && <Button type="button" variant="primary" size="md" disabled={locked} aria-label={`Install ${agent.name}`} onClick={() => { onChange(installAcpAgent) }}>Install</Button>}
      </div>
    </div>
  )
}

/**
 * Other agents: the ones that run as a chat over ACP (ADR 0021). The config's are ready; the ACP registry's are installed
 * here on request, into the app's own folder, and can be removed again. Using one picks it for the session being drafted.
 */
export function AcpAgentsDialog({ onPick, onCancel }: Props) {
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  // The agent being installed or removed, and the last change that failed, said on its own row.
  const [changing, setChanging] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; why: string } | null>(null)
  const [query, setQuery] = useState('')
  const dialog = useRef<HTMLDivElement>(null)
  const load = useCallback(() => loadAcpAgents().then(
    (agents) => { setRead({ kind: 'listed', agents }) },
    (error: unknown) => { setRead({ kind: 'failed', why: reasonOf(error) }) },
  ), [])
  useEffect(() => { void load() }, [load])
  const change = (id: string, run: (id: string) => Promise<void>) => {
    setChanging(id)
    setFailed(null)
    void run(id)
      .catch((error: unknown) => { setFailed({ id, why: reasonOf(error) }) })
      .then(load)
      .finally(() => { setChanging(null) })
  }
  const shown = read.kind === 'listed' ? read.agents.filter((agent) => matches(agent, query)) : []
  const groups = [
    { title: 'Ready to use', agents: shown.filter((agent) => agent.installed !== null || agent.source === 'config') },
    { title: 'Available to install', agents: shown.filter((agent) => agent.installed === null && agent.source !== 'config') },
  ]
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label="Other agents"
          className="mx-rename mx-modal mx-acp"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <ModalHead title="Other agents" onClose={onCancel} />
          <ModalBody>
            <p className="mx-acp-lead">Agents from the ACP registry. Installing one downloads its program to this computer and runs it as you; it keeps its own model and permission settings.</p>
            <label className="mx-acp-search">
              <Search aria-hidden="true" />
              <input data-bare type="search" value={query} placeholder="Search agents" aria-label="Search agents" onChange={(event) => { setQuery(event.target.value) }} />
            </label>
            {read.kind === 'loading' && <p className="mx-acp-note" role="status">Reading the registry…</p>}
            {read.kind === 'failed' && <p role="alert" className="mx-nsd-note is-error">{`Could not list the agents: ${read.why}`}</p>}
            {read.kind === 'listed' && shown.length === 0 && <p className="mx-acp-note" role="status">{query.trim() === '' ? 'The registry lists no agents.' : `No agent matches “${query.trim()}”.`}</p>}
            {read.kind === 'listed' && shown.length > 0 && (
              <div className="mx-acp-list" role="list" aria-label="Agents">
                {groups.map((group) => group.agents.length > 0 && (
                  <section key={group.title} className="mx-acp-group" aria-label={group.title}>
                    <h3 className="mx-acp-heading">{group.title}</h3>
                    {group.agents.map((agent) => <AgentRow key={agent.id} agent={agent} busy={changing === agent.id} locked={changing !== null} failed={failed?.id === agent.id ? failed.why : null} onUse={() => { onPick({ id: agent.id, name: agent.name }) }} onChange={(run) => { change(agent.id, run) }} />)}
                  </section>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFoot>
            <Button type="button" variant="ghost" size="lg" onClick={onCancel}>Close</Button>
          </ModalFoot>
        </div>
      </DialogContent>
    </Dialog>
  )
}
