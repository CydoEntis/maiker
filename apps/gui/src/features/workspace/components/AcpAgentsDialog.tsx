import { useCallback, useEffect, useRef, useState } from 'react'
import { windowRoot } from './windowRoot'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
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

/**
 * Other agents: the ones that run as a chat over ACP (ADR 0021). The config's are ready; the ACP registry's are installed
 * here on request, into the app's own folder, and can be removed again. Using one picks it for the session being drafted.
 */
export function AcpAgentsDialog({ onPick, onCancel }: Props) {
  const [read, setRead] = useState<Read>({ kind: 'loading' })
  // The agent being installed or removed, and the last change that failed, said on its own row.
  const [changing, setChanging] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; why: string } | null>(null)
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
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled asChild container={windowRoot()} aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); dialog.current?.focus() }}>
        <div
          ref={dialog}
          tabIndex={-1}
          aria-label="Other agents"
          className="mx-rename mx-recent"
          onKeyDown={(event) => {
            // Radix closes on Escape; this keeps the key from reaching the app's own handlers.
            if (event.key === 'Escape') event.stopPropagation()
          }}
        >
          <DialogTitle asChild><h2>Other agents</h2></DialogTitle>
          <p>Agents from the ACP registry. Installing one downloads its program to this computer and runs it as you, like any program you install. It uses its own model and permission settings.</p>
          {read.kind === 'loading' && <p role="status">Reading the registry…</p>}
          {read.kind === 'failed' && <p role="alert" className="mx-nsd-note is-error">{`Could not list the agents: ${read.why}`}</p>}
          {read.kind === 'listed' && (
            <ul className="mx-recent-list" aria-label="Agents">
              {read.agents.map((agent) => {
                const ready = agent.installed !== null
                const busy = changing === agent.id
                return (
                  <li key={agent.id} className="mx-acp-row">
                    <div className="mx-recent-text">
                      <span><strong>{agent.name}</strong>{agent.version === '' ? '' : ` ${agent.version}`}</span>
                      <small>{busy ? (ready ? 'Working…' : 'Installing… this can take a few minutes') : stateOf(agent)}</small>
                      {agent.description !== '' && <small>{agent.description}</small>}
                      {failed?.id === agent.id && <p role="alert" className="mx-nsd-note is-error">{failed.why}</p>}
                    </div>
                    <div className="mx-rename-actions">
                      {ready && <button type="button" className="mx-text-button" disabled={changing !== null} aria-label={`Use ${agent.name}`} onClick={() => { onPick({ id: agent.id, name: agent.name }) }}>Use</button>}
                      {ready && agent.source === 'registry' && agent.installed !== agent.version && agent.unavailable === null && <button type="button" className="mx-text-button" disabled={changing !== null} aria-label={`Update ${agent.name}`} onClick={() => { change(agent.id, installAcpAgent) }}>Update</button>}
                      {ready && agent.source === 'registry' && <button type="button" className="mx-text-button" disabled={changing !== null} aria-label={`Remove ${agent.name}`} onClick={() => { change(agent.id, removeAcpAgent) }}>Remove</button>}
                      {!ready && agent.unavailable === null && <button type="button" className="mx-text-button" disabled={changing !== null} aria-label={`Install ${agent.name}`} onClick={() => { change(agent.id, installAcpAgent) }}>Install</button>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="mx-rename-actions">
            <button type="button" className="mx-text-button" onClick={onCancel}>Close</button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
