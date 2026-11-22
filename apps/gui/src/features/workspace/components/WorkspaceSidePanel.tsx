import { repoTree } from '@/features/inspect/api'
import { closeOtherTabs, closeTab, openTab, showTab, SURFACE_KINDS, tabOf, type PanelTab, type RepoSurfaceKind, type SurfaceKind } from '@/features/inspect/panelTabs'
import { RepoSurface } from '@/features/inspect/RepoSurface'
import { SidePanel } from '@/features/inspect/SidePanel'
import { SURFACES } from '@/features/inspect/surfaces'
import { usePreloadFiles } from '@/features/inspect/useRepoQuery'
import { usePresence } from '@/lib/usePresence'
import { useReducedMotion } from './motion'
import { isShell } from '../model/sidebar'
import { agentName, sendAgentMessage, suggestedCommitMessage } from '../model/agentMessage'
import type { SessionView } from '../model/session'
import { terminalName } from '../model/terminalTabs'
import { useWorkspace } from '../workspaceContext'
import { PanelTerminal } from './PanelTerminal'

const loadTopFolder = (term: number) => repoTree(term, null)

/** How long the panel takes to slide out (`--panel-out`); it stays drawn until then. */
const PANEL_EXIT_MS = 220

/**
 * Files or Changes with no pane to read the folder through: a chat has no terminal of its own, so the session's first
 * terminal is what the daemon is asked about. It is offered here, and opens behind the surface that asked for it.
 */
function NeedsTerminal({ kind, session, canStart, onStart }: { kind: RepoSurfaceKind; session: SessionView; canStart: boolean; onStart: () => void }) {
  return (
    <div className="mx-sp-needs" role="status">
      <strong>{SURFACES[kind].label} needs a terminal in this folder</strong>
      <span>Maiker reads {session.cwdLabel} through one of this session’s terminals, and it has none yet.</span>
      <button type="button" className="mx-sp-needs-go" disabled={!canStart} onClick={onStart}>Open a terminal</button>
    </div>
  )
}

/** The side panel for the focused session, a card beside the main pane: the session's own tabs of surfaces. */
export function WorkspaceSidePanel() {
  const { inspectOpen, inspectRefusal, focusMode, inspectTerm, focusedSession, lookAt, turnDiff, setTurnDiff, setInspectOpen, flash, openDocument, panelOf, changePanel, pinTerminal, ownsTerminals, canStart, addAgentTerminal, closeAgentTerminals, agentTerminals, setPanelFocused, root } = useWorkspace()
  const presence = usePresence(inspectOpen, PANEL_EXIT_MS, useReducedMotion())
  // Files reads this computer's checkouts, so nothing is read ahead for a session of another machine.
  usePreloadFiles(focusedSession?.machineName === null ? inspectTerm : null, loadTopFolder)
  if (!presence.shown || focusMode || !focusedSession || inspectRefusal !== null) return null
  const session = focusedSession
  const panel = panelOf(session.id)
  const terminals = agentTerminals.get(session.id) ?? []
  const nameOf = (tab: PanelTab) => (tab.kind === 'terminal' ? terminalName(terminals, tab.id) : SURFACES[tab.kind].label)
  // A terminal is this computer's to start, so a session of another machine is offered the surfaces that only read.
  const offered = SURFACE_KINDS.filter((kind) => kind !== 'terminal' || ownsTerminals(session))
  const open = (kind: SurfaceKind) => {
    if (SURFACES[kind].many) addAgentTerminal(session.id)
    else changePanel(session.id, (current) => openTab(current, tabOf(kind)))
  }
  const close = (id: string) => {
    const tab = panel.tabs.find((each) => each.id === id)
    if (tab === undefined) return
    // A terminal's tab is its shell: closing it ends the shell, so it asks first, and the tab goes when the shell has.
    if (tab.kind === 'terminal') closeAgentTerminals([id], nameOf(tab))
    else changePanel(session.id, (current) => closeTab(current, id))
    if (tab.kind === 'changes') setTurnDiff(null)
  }
  const closeOthers = (id: string) => {
    const shells = panel.tabs.filter((tab) => tab.id !== id && tab.kind === 'terminal')
    const closeThem = () => { changePanel(session.id, (current) => closeOtherTabs(current, id)) }
    const only = shells.length === 1 ? shells[0] : undefined
    if (shells.length === 0) closeThem()
    else closeAgentTerminals(shells.map((tab) => tab.id), only ? nameOf(only) : `${String(shells.length)} terminals`, closeThem)
  }
  const body = (tab: PanelTab) => {
    switch (tab.kind) {
      case 'terminal':
        return <PanelTerminal terminalId={tab.id} leaving={presence.leaving} />
      case 'files':
      case 'changes':
        // With the service away nothing can be asked, and no terminal started either.
        if (inspectTerm === null && !ownsTerminals(session)) return <p className="mx-inspect-note" role="status">{SURFACES[tab.kind].label} can’t be read while the Maiker service is not connected.</p>
        if (inspectTerm === null) return <NeedsTerminal kind={tab.kind} session={session} canStart={canStart} onStart={() => { addAgentTerminal(session.id, 'behind') }} />
        return (
          <RepoSurface
            kind={tab.kind}
            term={inspectTerm}
            {...(session.branch ? { branch: session.branch } : {})}
            machine={session.machine}
            machineName={session.machineName}
            lookAt={lookAt}
            documents={{ root: `${session.machineName ?? ''}${session.repoRoot ?? session.cwd}`, sessionId: session.id, onOpenBeside: (path: string) => { openDocument(session.id, path) } }}
            {...(isShell(session) ? {} : { comments: { agent: agentName(session.process), onSend: (message: string) => sendAgentMessage(session, message) } })}
            {...(session.machineName === null && session.repoRoot !== null ? { changeActions: { folder: session.repoRoot, machine: session.machine, suggested: suggestedCommitMessage(session) } } : {})}
            {...(turnDiff?.sessionId === session.id ? { turnScope: { turn: turnDiff.turn, onAllChanges: () => { setTurnDiff(null) } } } : {})}
            {...(session.machineName !== null ? { changeActions: { folder: session.repoRoot ?? '', machine: session.machine, term: inspectTerm, suggested: suggestedCommitMessage(session) } } : {})}
            onNotice={flash}
          />
        )
    }
  }
  return (
    <SidePanel
      key={session.id}
      tabs={panel.tabs}
      active={panel.active}
      offered={offered}
      nameOf={nameOf}
      menuRoot={root}
      leaving={presence.leaving}
      onOpen={open}
      onShow={(id, by) => {
        changePanel(session.id, (current) => showTab(current, id))
        // A clicked terminal tab takes the keys; one reached with the arrows leaves them on the tabs, to walk on.
        setPanelFocused(by === 'pointer' && panel.tabs.some((tab) => tab.id === id && tab.kind === 'terminal'))
      }}
      onClose={close}
      onCloseOthers={closeOthers}
      onPin={(id) => { pinTerminal(session.id, id) }}
      onClosePanel={() => { setInspectOpen(false); setTurnDiff(null) }}
    >
      {body}
    </SidePanel>
  )
}
