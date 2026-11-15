import { InspectPanel } from '@/features/inspect/InspectPanel'
import { repoTree } from '@/features/inspect/api'
import { usePreloadFiles } from '@/features/inspect/useRepoQuery'
import { usePresence } from '@/lib/usePresence'
import { AgentTerminals } from './AgentTerminals'
import { useReducedMotion } from './motion'
import { isShell } from '../model/sidebar'
import { agentName, sendAgentMessage, suggestedCommitMessage } from '../model/agentMessage'
import { useWorkspace } from '../workspaceContext'

const loadTopFolder = (term: number) => repoTree(term, null)

/** How long the panel takes to slide out (`--panel-out`); it stays drawn until then. */
const PANEL_EXIT_MS = 220

/** The side panel for the focused session, docked between the chat area and the tools bar. */
export function WorkspaceSidePanel() {
  const { inspectOpen, focusMode, inspectTerm, ownsTerminals, focusedSession, diffStat, inspectView, lookAt, turnDiff, setTurnDiff, setInspectOpen, flash, preferences, setPreferences } = useWorkspace()
  const presence = usePresence(inspectOpen, PANEL_EXIT_MS, useReducedMotion())
  // An agent always has a Terminal view. Pinned under the chat, its terminals are in the pane, and the view offers to bring them back.
  const hasTerminals = focusedSession !== undefined && ownsTerminals(focusedSession)
  // Files reads this computer's checkouts, so nothing is read ahead for a session of another machine.
  usePreloadFiles(focusedSession?.machineName === null ? inspectTerm : null, loadTopFolder)
  if (!presence.shown || focusMode || !focusedSession || (inspectTerm === null && !hasTerminals)) return null
  return (
    <InspectPanel
      key={focusedSession.id}
      term={inspectTerm}
      terminals={!hasTerminals ? null : preferences.terminalDock === 'panel' || isShell(focusedSession)
        ? <AgentTerminals agent={focusedSession} dock="panel" focused={inspectView === 'terminal'} canPin={!isShell(focusedSession)} />
        : (
          <div className="mx-terms-empty">
            <strong>Terminals are pinned under the chat</strong>
            <span>They show at the bottom of this agent's pane.</span>
            <button type="button" className="mx-terms-start" onClick={() => { setPreferences((current) => ({ ...current, terminalDock: 'panel' })) }}>Show them here</button>
          </div>
        )}
      changedFiles={diffStat.data?.files ?? 0}
      {...(focusedSession.branch ? { branch: focusedSession.branch } : {})}
      view={inspectView}
      agentWorking={focusedSession.status === 'working'}
      timeline={focusedSession.timeline}
      checks={focusedSession.checks}
      machine={focusedSession.machine}
      machineName={focusedSession.machineName}
      lookAt={lookAt}
      leaving={presence.leaving}
      {...(isShell(focusedSession) ? {} : { comments: { agent: agentName(focusedSession.process), onSend: (message: string) => sendAgentMessage(focusedSession, message) } })}
      {...(focusedSession.machineName === null && focusedSession.repoRoot !== null ? { changeActions: { folder: focusedSession.repoRoot, machine: focusedSession.machine, suggested: suggestedCommitMessage(focusedSession) } } : {})}
      {...(turnDiff?.sessionId === focusedSession.id ? { turnScope: { turn: turnDiff.turn, onAllChanges: () => { setTurnDiff(null) } } } : {})}
      {...(focusedSession.machineName !== null && inspectTerm !== null ? { changeActions: { folder: focusedSession.repoRoot ?? '', machine: focusedSession.machine, term: inspectTerm, suggested: suggestedCommitMessage(focusedSession) } } : {})}
      onClose={() => { setInspectOpen(false); setTurnDiff(null) }}
      onNotice={flash}
    />
  )
}
