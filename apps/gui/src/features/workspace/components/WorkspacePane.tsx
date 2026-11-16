import { OpenSubagentContext, subagentNamed, type OpenSubagent } from '@/features/chat/openSubagent'
import { movePanes } from './paneTransition'
import { useCallback } from 'react'
import { TerminalView } from '@/TerminalView'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { useWorkspace } from '../workspaceContext'
import { chatAvailability, type PaneView } from '../model/chatView'
import { toast } from '@/lib/toast'
import { answerHelpers, dropQueuedFollowUp, isDesktop, queueFollowUp, sendTerminalInput } from '@/api/daemon'
import { errorMessage } from '@/lib/error-message'
import { isChatSession } from '../model/chatSession'
import { carryDraftToTerminal } from '../model/draftCarry'
import { PaneCard } from './PaneCard'
import { LOCAL_MACHINE } from '@/api/machines'
import type { TurnSpan } from '@/features/inspect/turnRange'
import { COMMAND_SUBMIT_GAP_MS } from '@/features/chat/useChatComposer'
import { contextFull, type ChatProblem } from '@/features/chat/problem'
import { RunningSubagents } from '@/features/chat/components/RunningSubagents'
import { ChatPane } from '@/features/chat/components/ChatPane'
import { NoTerminalNote } from '@/features/chat/components/NoTerminalNote'
import { type Arrangement, focusPane, type PaneSlot, toggleMaximize } from '../model/layout'
import { folderNameOf } from '../model/session'
import { LOCAL_HEAD, machineTitle } from '../model/machines'
import { toSubagentView } from '../model/subagents'
import { isShell } from '../model/sidebar'
import { moveRefusal } from '../model/moveToWorktree'
import { guardLocal } from '@/lib/localOnly'
import type { RewindPlace } from '@/features/chat/editFromHere'
import { fileSearchOf } from '@/features/chat/fileMention'
import { WorkBoard } from '@/features/work/components/WorkBoard'
import { WorkSetup } from '@/features/work/components/WorkSetup'
import { factoryChatsOf } from '@/features/work/factoryChats'
import { ShowSidebarButton } from './ShowSidebarButton'

/** Whether a session can show a chat at all: an agent the app reads. A shell or another program has none, so it gets no switch. */
function hasChat(availability: ReturnType<typeof chatAvailability>): boolean {
  return availability.kind === 'ready' || availability.kind === 'no-events'
}

/** Ctrl+L: a shell clears its screen and keeps what was typed. */
const CLEAR_SCREEN = '\x0c'

/**
 * One pane of the layout: its header, and the session's terminal with its chat over it when the chat shows.
 * A pane of a tab kept out of sight keeps only its terminal, paused: no chat reads, takes keys or answers for it.
 */
export function WorkspacePane({ shown, pane, kept }: {
  shown: Arrangement
  pane: PaneSlot
  kept: boolean
}) {
  const { paneSessions, chatOf, openSubagent, ownsTerminals, repoPaneOf, sharedFolderRefusalOf, outsidePanes, dropId, dragId, paneViews, showChanges, online, setOpenSubagent, togglePanel, openPanel, setSettingsSection, setRecentOpen, saveName, preferences, startChatHere, handoffSession, inspectOpen, addAgentTerminal, root, look, modalOpen, mirrorInput, openPath, pasteImage, terminalHandles, setLayout, split, closePaneById, sendTo, copyPathOf, restartPane, setRenameId , heads, retryNamed, newChatWithSummary , moveToWorktree, showSubagent, dockFocused, sidebarMode, toggleSidebar, focusMode, sessions, setTicketsOpen, showSessionById } = useWorkspace()
  const tip = useTipWithKeys()
  // Bound to this pane, so a row opened from a pane without the focus focuses it and shows its own session's changes.
  const openDiff = useCallback((file: string, turn?: TurnSpan | null) => { showChanges(pane.id, pane.sessionId, file, turn) }, [showChanges, pane.id, pane.sessionId])
  const session = paneSessions.get(pane.sessionId)
  if (!session) return null
  const focused = pane.id === shown.focus && !kept
  const chat = chatOf(session)
  const chatOnly = isChatSession(session.conversation)
  // Every subagent the session reported, not only those the sidebar lists, so a workflow step can open a finished one.
  const helpers = (session.conversation.details?.subagents ?? []).map(toSubagentView)
  const opened = openSubagent?.sessionId === session.id ? openSubagent : null
  const subagent = opened === null ? undefined : helpers.find((child) => child.id === opened.subagentId)
  const workOpen = paneViews.work.has(session.id)
  const remoteHead = session.machine === LOCAL_MACHINE ? undefined : heads.find((candidate) => candidate.machine === session.machine)
  const runWhere = { machine: machineTitle(remoteHead ?? LOCAL_HEAD), remote: session.machine !== LOCAL_MACHINE, project: folderNameOf(session), branch: session.branch }
  // A chat that runs no factory still has Work: it says where one runs in this project and how to set one up.
  const work = {
    going: session.workflows.filter((run) => run.active).length,
    needsYou: session.workflows.some((run) => run.active && run.needsYou),
    open: workOpen,
    onOpen: () => { paneViews.showWork(session.id) },
    board: session.workflows.length > 0
      ? <WorkBoard runs={session.workflows} helpers={helpers} onOpenHelper={(id) => { showSubagent(session.id, id) }} where={runWhere} />
      : (
        <WorkSetup
          others={workOpen ? factoryChatsOf(session, sessions).filter((other) => other.id !== session.id) : []}
          onOpenOther={(id) => { paneViews.hideWork(session.id); showSessionById(id); paneViews.showWork(id) }}
          onOpenTickets={() => { paneViews.hideWork(session.id); setTicketsOpen(true) }}
          onBack={() => { paneViews.hideWork(session.id) }}
        />
      ),
  }
  const typeInto = chatOnly ? undefined : (text: string) => sendTerminalInput({ id: session.id, generation: session.conversation.generation ?? 0 }, text)
  // A pane's daemon holds what is sent while its agent works; a chat session's own daemon queue is its conversation's.
  const paneQueue = chatOnly ? undefined : {
    queued: session.queued,
    add: (text: string, first: boolean, operation: number) => queueFollowUp(session, text, first, operation),
    drop: (index: number, text: string) => dropQueuedFollowUp(session, index, text),
  }
  const showTerminal = () => {
    paneViews.choose(session.id, 'terminal')
    void carryDraftToTerminal(session).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not move your message to the terminal')) })
  }
  const head = session.machine === LOCAL_MACHINE ? undefined : heads.find((candidate) => candidate.machine === session.machine)
  const fullPercent = contextFull({ context: session.usage.context, limits: [] })
  // One problem at a time, the one that matters most: a lost machine, then a stopped agent, then a full context.
  const problem: ChatProblem | null = head?.down === true && head.name !== null
    ? { kind: 'offline', machine: head.label, since: head.downSince, onRetry: () => { retryNamed(head.name ?? '') } }
    : session.status === 'error' && !session.ended && !isShell(session)
      ? { kind: 'crashed', agent: session.process, code: session.conversation.details?.exit?.code ?? null, onViewLog: () => { showTerminal() }, onRestart: chatOnly ? null : () => { restartPane(pane.id) } }
      : fullPercent !== null && typeInto !== undefined
        ? { kind: 'context', agent: session.process, percent: fullPercent, onNewWithSummary: (summary) => { newChatWithSummary(session, summary) }, onCompact: () => { void typeInto('/compact').then(() => new Promise((resolve) => { window.setTimeout(resolve, COMMAND_SUBMIT_GAP_MS) })).then(() => typeInto('\r')).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not compact')) }) } }
        : null
  const terminals = ownsTerminals(session)
  // Restoring reads and writes the checkout, so it is this computer's only, like Inspect.
  const rewindTerm = repoPaneOf(session)
  // A restore would also undo the files of another session in the same checkout.
  const rewindRefusal = guardLocal(session, 'rewind') ?? (rewindTerm === null ? null : sharedFolderRefusalOf(session))
  const fileSearch = fileSearchOf(session, { term: rewindTerm, machineDown: head?.down === true, desktop: isDesktop() })
  const rewind: RewindPlace | undefined = rewindRefusal !== null ? { refusal: rewindRefusal } : rewindTerm !== null ? { term: rewindTerm } : undefined
  // A shell is a terminal already: its menu keeps Clear and Copy folder path in place of New terminal.
  const shell = isShell(session)
  // The header's branch crumb switches the branch of a session on this computer; elsewhere it only says it.
  const branchMenu = chatOnly || session.machine !== LOCAL_MACHINE || session.branch === null ? undefined : { folder: session.cwd, onNewWorktree: () => { void moveToWorktree(session) }, ...(moveRefusal(session) === null ? {} : { newWorktreeBlocked: moveRefusal(session) ?? '' }) }
  // The panel has something for this pane: its repository. A pane of another machine keeps the button, which says why not.
  const hasPanel = session.machine !== LOCAL_MACHINE || repoPaneOf(session) !== null
  const chatShown = chat.view === 'chat' && !kept && !workOpen && hasChat(chat.availability)
  const openHelperChat: OpenSubagent = (title, asked) => {
    const found = subagentNamed(session.subagents, title, asked)
    return found === null ? null : () => { showSubagent(session.id, found.id) }
  }
  return (
    <PaneCard
      pane={pane}
      index={shown.panes.findIndex((candidate) => candidate.id === pane.id)}
      leading={sidebarMode === 'hidden' && !focusMode && shown.panes[0]?.id === pane.id ? <ShowSidebarButton onShow={toggleSidebar} tip={tip('Show sidebar', 'toggle-sidebar')} /> : undefined}
      session={session}
      paneCount={shown.panes.length}
      broadcast={shown.broadcast === true}
      focused={focused && !outsidePanes}
      maximized={shown.max === pane.id}
      dropTarget={dropId === pane.id && dragId !== pane.id}
      dragging={dragId === pane.id}
      dropWord={dragId === null ? 'Drop to show it here' : 'Drop to swap'}
      view={chat.view}
      {...(chatOnly || !hasChat(chat.availability) ? {} : { onViewChange: (view: PaneView) => { if (view === 'terminal') showTerminal(); else paneViews.choose(session.id, view) } })}
      work={work}
      chat={chat.view === 'chat' && !kept && !workOpen ? (
        <OpenSubagentContext.Provider value={openHelperChat}>
        <ChatPane
          availability={chat.availability}
          hasTerminal={!chatOnly}
          root={session.repoRoot ?? session.cwd}
          onOpenDiff={openDiff}
          onOpenFile={(path, line) => { openPath(session, path, line ?? undefined) }}
          typeInto={typeInto}
          paneQueue={paneQueue}
          ask={session.ask}
          asking={session.asking}
          sessionId={session.id}
          problem={problem}
          effort={session.agentEffort ?? null}
          rewind={rewind}
          {...(fileSearch === null ? {} : { fileSearch })}
          paneStatus={session.status}
          helpersOnly={session.helpersOnly}
          usage={{ context: session.usage.context, limits: session.limits }}
          process={session.process}
          online={online}
          subagent={subagent ?? null}
          onBackToMain={() => { setOpenSubagent(null) }}
          windowActions={{ openSettings: setSettingsSection, openPanel: (view) => { openPanel(pane.id, session.id, view) }, openRecent: () => { setRecentOpen(true) }, renameSession: (name) => { saveName(session.id, name) } }}
          onBackToTerminal={showTerminal}
          onStartAgent={(agent) => {
            paneViews.choose(session.id, 'terminal')
            void sendTerminalInput({ id: session.id, generation: session.conversation.generation ?? 0 }, `${agent}\r`).catch((error: unknown) => { toast.error(errorMessage(error, `Could not start ${agent}`)) })
          }}
          hideSuccessfulTools={preferences.hideSuccessfulTools}
          onStartChat={(agent, fullAccess) => { startChatHere(session, agent, fullAccess) }}
          fullAccessDefault={preferences.fullAccessNewChats}
        />
        </OpenSubagentContext.Provider>
      ) : undefined}
      // The chat shows its helpers in its own agents card, so the bar floats over the terminal only.
      overlay={kept || session.workflows.length > 0 || chatShown ? undefined : <RunningSubagents subagents={session.subagents} onOpen={(id) => { showSubagent(session.id, id) }} />}
      panelOpen={inspectOpen && focused}
      {...(hasPanel ? { onPanel: () => { togglePanel(pane.id, session.id) } } : {})}
      changed={{ added: session.diffAdded, removed: session.diffRemoved }}
      {...(terminals && !shell ? { onNewTerminal: () => { addAgentTerminal(session.id) } } : {})}
      online={online}
      portalContainer={root}
      terminal={chatOnly ? <NoTerminalNote /> :
        <TerminalView
          key={session.id}
          conversation={session.conversation}
          desktop
          fontSize={preferences.terminalFontSize}
          look={look}
          label={`Shell in ${session.cwdLabel}`}
          inputDisabled={!online}
          ended={session.ended}
          focused={focused && !modalOpen && chat.view === 'terminal' && !workOpen && !dockFocused}
          paused={kept || chat.view === 'chat' || workOpen}
          onInput={(data) => { mirrorInput(session.id, data) }}
          onOpenPath={(path, line) => { openPath(session, path, line) }}
          onPasteImage={(image) => { pasteImage(session.id, image) }}
          onHandle={(handle) => {
            if (handle) terminalHandles.current.set(session.id, handle)
            else terminalHandles.current.delete(session.id)
          }}
        />
      }
      onFocus={(paneId) => { setLayout((current) => focusPane(current, paneId)) }}
      onSplit={(paneId, direction) => {
        setLayout((current) => focusPane(current, paneId))
        split(paneId, direction)
      }}
      onToggleMaximize={(paneId) => { movePanes(() => { setLayout((current) => toggleMaximize(current, paneId)) }) }}
      onClose={closePaneById}
      onClear={() => { void sendTo(session, CLEAR_SCREEN).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not clear the screen')) }) }}
      onCopyPath={() => { copyPathOf(session.id) }}
      onRename={() => { setRenameId(session.id) }}
      onSaveName={(name) => { saveName(session.id, name) }}
      branchMenu={branchMenu}
      onHandoff={(agent) => { void handoffSession(session, agent) }}
      onRestart={restartPane}
      onAnswerHelpers={(choice) => { void answerHelpers(session.conversation, choice).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not answer the helper request')) }) }}
    />
  )
}
