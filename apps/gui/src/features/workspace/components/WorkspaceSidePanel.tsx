import { InspectPanel } from '@/features/inspect/InspectPanel'
import { repoTree } from '@/features/inspect/api'
import { usePreloadFiles } from '@/features/inspect/useRepoQuery'
import { usePresence } from '@/lib/usePresence'
import { useReducedMotion } from './motion'
import { isShell } from '../model/sidebar'
import { agentName, sendAgentMessage, suggestedCommitMessage } from '../model/agentMessage'
import { useWorkspace } from '../workspaceContext'

const loadTopFolder = (term: number) => repoTree(term, null)

/** How long the panel takes to slide out (`--panel-out`); it stays drawn until then. */
const PANEL_EXIT_MS = 220

/** The side panel for the focused session, docked between the chat area and the tools bar. */
export function WorkspaceSidePanel() {
  const { inspectOpen, focusMode, inspectTerm, focusedSession, diffStat, inspectView, lookAt, turnDiff, setTurnDiff, setInspectOpen, flash, openDocument } = useWorkspace()
  const presence = usePresence(inspectOpen, PANEL_EXIT_MS, useReducedMotion())
  // Files reads this computer's checkouts, so nothing is read ahead for a session of another machine.
  usePreloadFiles(focusedSession?.machineName === null ? inspectTerm : null, loadTopFolder)
  if (!presence.shown || focusMode || !focusedSession || inspectTerm === null) return null
  return (
    <InspectPanel
      key={focusedSession.id}
      term={inspectTerm}
      changedFiles={diffStat.data?.files ?? 0}
      {...(focusedSession.branch ? { branch: focusedSession.branch } : {})}
      view={inspectView}
      agentWorking={focusedSession.status === 'working'}
      timeline={focusedSession.timeline}
      checks={focusedSession.checks}
      machine={focusedSession.machine}
      machineName={focusedSession.machineName}
      lookAt={lookAt}
      documents={{ root: `${focusedSession.machineName ?? ''}${focusedSession.repoRoot ?? focusedSession.cwd}`, sessionId: focusedSession.id, onOpenBeside: (path: string) => { openDocument(focusedSession.id, path) } }}
      leaving={presence.leaving}
      {...(isShell(focusedSession) ? {} : { comments: { agent: agentName(focusedSession.process), onSend: (message: string) => sendAgentMessage(focusedSession, message) } })}
      {...(focusedSession.machineName === null && focusedSession.repoRoot !== null ? { changeActions: { folder: focusedSession.repoRoot, machine: focusedSession.machine, suggested: suggestedCommitMessage(focusedSession) } } : {})}
      {...(turnDiff?.sessionId === focusedSession.id ? { turnScope: { turn: turnDiff.turn, onAllChanges: () => { setTurnDiff(null) } } } : {})}
      {...(focusedSession.machineName !== null ? { changeActions: { folder: focusedSession.repoRoot ?? '', machine: focusedSession.machine, term: inspectTerm, suggested: suggestedCommitMessage(focusedSession) } } : {})}
      onClose={() => { setInspectOpen(false); setTurnDiff(null) }}
      onNotice={flash}
    />
  )
}
