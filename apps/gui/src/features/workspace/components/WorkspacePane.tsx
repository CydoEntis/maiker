import { OpenSubagentContext, subagentNamed, type OpenSubagent } from '@/features/chat/openSubagent'
import { movePanes } from './paneTransition'
import { useCallback } from 'react'
import { TerminalView } from '@/TerminalView'
import { useTipWithKeys } from '@/features/shortcuts/platform'
import { useWorkspace } from '../workspaceContext'
import { toast } from '@/lib/toast'
import { dropQueuedFollowUp, isDesktop, queueFollowUp, sendTerminalInput } from '@/api/daemon'
import { sendHelpersAnswer } from '../useOutsideAsks'
import { isChatSession } from '../model/chatSession'
import { PaneCard } from './PaneCard'
import { leafKey } from './dragSession'
import { SplitPane, SplitPlaceholder } from './SplitPane'
import { SplitTree } from './SplitTree'
import { AGENT_LEAF, leavesOf } from '../model/splitTree'
import { PaneErrorBoundary } from '@/components/PaneErrorBoundary'
import { LOCAL_MACHINE } from '@/api/machines'
import type { TurnSpan } from '@/features/inspect/turnRange'
import { COMMAND_SUBMIT_GAP_MS } from '@/features/chat/useChatComposer'
import { contextFull, type ChatProblem } from '@/features/chat/problem'
import { ChatPane } from '@/features/chat/components/ChatPane'
import { NoTerminalNote } from '@/features/chat/components/NoTerminalNote'
import { type Arrangement, focusPane, type PaneSlot, toggleMaximize } from '../model/layout'
import { toSubagentView } from '../model/subagents'
import { isShell } from '../model/sidebar'
import { agentLabel } from '../model/session'
import { guardLocal } from '@/lib/localOnly'
import type { RewindPlace } from '@/features/chat/editFromHere'
import { fileSearchOf } from '@/features/chat/fileMention'
import { ShowSidebarButton } from './ShowSidebarButton'
import { placeOf } from '@/features/chat/sessionPlace'
import type { EndedActions } from '@/features/chat/components/Composer'
import { endedResume } from '../model/recentSessions'
import { updateProblem } from '../model/machines'

/** Ctrl+L: a shell clears its screen and keeps what was typed. */
const CLEAR_SCREEN = '\x0c'

/**
 * One pane of the layout: its header, and the session's terminal with its chat over it when the chat shows.
 * A pane of a tab kept out of sight keeps its terminal and its chat mounted, both paused: neither reads, takes keys or
 * answers for it, so going back to the tab shows both at once.
 */
export function WorkspacePane({ shown, pane, kept }: {
  shown: Arrangement
  pane: PaneSlot
  kept: boolean
}) {
  const { dismissedRestores, setDismissedRestores, resumeInterrupted, continueCut, paneSessions, chatOf, openSubagent, ownsTerminals, panelFocused, repoPaneOf, sharedFolderRefusalOf, outsidePanes, dropId, dragId, dropLeaf, dragLeaf, showChanges, online, setOpenSubagent, openPanel, setSettingsSection, setRecentOpen, saveName, preferences, addAgentTerminal, root, look, modalOpen, mirrorInput, openPath, pasteImage, terminalHandles, setLayout, split, closePaneById, sendTo, copyPathOf, restartPane, setRenameId, splitsOf, splitRefusalOf, focusSplit, resizeSplit, closeSplit, sessionMap, heads, retryNamed, setUpdateAsk, newChatWithSummary , resumeEnded, setOpenAsk, showSubagent, dockFocused, sidebarMode, toggleSidebar, focusMode } = useWorkspace()
  const tip = useTipWithKeys()
  // Bound to this pane, so a row opened from a pane without the focus focuses it and shows its own session's changes.
  const openDiff = useCallback((file: string, turn?: TurnSpan | null) => { showChanges(pane.id, pane.sessionId, file, turn) }, [showChanges, pane.id, pane.sessionId])
  const session = paneSessions.get(pane.sessionId)
  if (!session) return null
  const focused = pane.id === shown.focus && !kept
  // The session's own panes: its agent's, and a shell for each split. One pane is the whole tree.
  const splits = splitsOf(session)
  const isSplit = leavesOf(splits.tree).length > 1
  const splitRefusal = splitRefusalOf(session)
  const focusLeafOf = (leaf: string) => {
    setLayout((current) => focusPane(current, pane.id))
    focusSplit(session.id, leaf)
  }
  const chat = chatOf(session)
  const chatOnly = isChatSession(session.conversation)
  // Every subagent the session reported, not only those the sidebar lists, so a finished one can still be opened.
  const helpers = (session.conversation.details?.subagents ?? []).map(toSubagentView)
  const opened = openSubagent?.sessionId === session.id ? openSubagent : null
  const subagent = opened === null ? undefined : helpers.find((child) => child.id === opened.subagentId)
  const typeInto = chatOnly ? undefined : (text: string) => sendTerminalInput({ id: session.id, generation: session.conversation.generation ?? 0 }, text)
  // A pane's daemon holds what is sent while its agent works; a chat session's own daemon queue is its conversation's.
  const paneQueue = chatOnly ? undefined : {
    queued: session.queued,
    add: (text: string, first: boolean, operation: number) => queueFollowUp(session, text, first, operation),
    drop: (index: number, text: string) => dropQueuedFollowUp(session, index, text),
  }
  // A session is shown as the app's view says; no control on it moves it between chat and terminal (ADR 0020).
  const view = chat.view
  const head = session.machine === LOCAL_MACHINE ? undefined : heads.find((candidate) => candidate.machine === session.machine)
  const fullPercent = contextFull({ context: session.usage.context, limits: [] })
  const interrupted = session.interrupted !== null && !dismissedRestores.has(session.id) ? session.interrupted : null
  // A chat cut the same way has no resume command: Restart starts it again and tells it to carry on.
  const cutChat = session.chatCutOff === true && !dismissedRestores.has(session.id)
  // One problem at a time, the one that matters most: a lost machine, then a stopped agent, then a turn a service restart
  // cut, then a full context. Each is what the daemon reports about the session; none is guessed here.
  const problem: ChatProblem | null = head?.down === true && head.name !== null
    ? { kind: 'machine', machine: head.label, since: head.downSince, onRetry: () => { retryNamed(head.name ?? '') }, ...updateProblem(head, (name, action) => { setUpdateAsk({ name, action }) }) }
    : session.status === 'error' && !session.ended && !isShell(session)
      ? { kind: 'stopped', agent: session.process, code: session.conversation.details?.exit?.code ?? null, onRestart: chatOnly ? null : () => { restartPane(pane.id) } }
      : interrupted !== null
        ? { kind: 'interrupted', agent: interrupted.agent, resume: interrupted.resume, onRestart: () => { resumeInterrupted(session) }, onDismiss: () => { setDismissedRestores((current) => new Set(current).add(session.id)) } }
        : cutChat
          ? { kind: 'interrupted', agent: agentLabel(session.process), resume: '', onRestart: () => { continueCut(session) }, onDismiss: () => { setDismissedRestores((current) => new Set(current).add(session.id)) } }
          : fullPercent !== null && typeInto !== undefined
          ? { kind: 'context', agent: session.process, percent: fullPercent, onNewWithSummary: (summary) => { newChatWithSummary(session, summary) }, onCompact: () => { void typeInto('/compact').then(() => new Promise((resolve) => { window.setTimeout(resolve, COMMAND_SUBMIT_GAP_MS) })).then(() => typeInto('\r')).catch((error: unknown) => { toast.failed('Could not compact', error) }) } }
          : null
  // An ended chat is read-only: it offers to reopen its conversation or to start a fresh session in the same folder.
  const resumeRefusal = endedResume(session)
  const endedActions: EndedActions = {
    ...(resumeRefusal.kind === 'request' ? { onResume: () => { resumeEnded(session) } } : { resumeWhy: resumeRefusal.why }),
    onNewSession: () => { newChatWithSummary(session, '') },
  }
  const terminals = ownsTerminals(session)
  // Restoring reads and writes the checkout, so it is this computer's only, like Inspect.
  const rewindTerm = repoPaneOf(session)
  // A restore would also undo the files of another session in the same checkout.
  const rewindRefusal = guardLocal(session, 'rewind') ?? (rewindTerm === null ? null : sharedFolderRefusalOf(session))
  const fileSearch = fileSearchOf(session, { term: rewindTerm, machineDown: head?.down === true, desktop: isDesktop() })
  const rewind: RewindPlace | undefined = rewindRefusal !== null ? { refusal: rewindRefusal } : rewindTerm !== null ? { term: rewindTerm } : undefined
  const answerHelperAsk = (choice: 'allow' | 'always' | 'no') => { sendHelpersAnswer(session, choice) }
  // A shell is a terminal already: its menu keeps Clear and Copy folder path in place of New terminal.
  const shell = isShell(session)
  const openHelperChat: OpenSubagent = (title, asked) => {
    const found = subagentNamed(session.subagents, title, asked)
    return found === null ? null : () => { showSubagent(session.id, found.id) }
  }
  const agentPane = (
    <PaneCard
      pane={pane}
      index={shown.panes.findIndex((candidate) => candidate.id === pane.id)}
      leading={sidebarMode === 'hidden' && !focusMode && shown.panes[0]?.id === pane.id ? <ShowSidebarButton onShow={toggleSidebar} tip={tip('Show sidebar', 'toggle-sidebar')} /> : undefined}
      session={session}
      paneCount={shown.panes.length}
      leaf={isSplit ? leafKey(session.id, AGENT_LEAF) : undefined}
      card={isSplit || shown.panes.length > 1}
      splitRefusal={splitRefusal}
      broadcast={shown.broadcast === true}
      focused={focused && !outsidePanes && splits.focus === AGENT_LEAF}
      maximized={shown.max === pane.id}
      dropTarget={dropId === pane.id && dragId !== pane.id}
      dragging={dragId === pane.id}
      dropWord={dragId === null ? 'Drop to show it here' : 'Drop to swap'}
      view={view}
      chat={view === 'chat' ? (
        <PaneErrorBoundary key={session.id} what="This chat">
        <OpenSubagentContext.Provider value={openHelperChat}>
        <ChatPane
          availability={chat.availability}
          root={session.repoRoot ?? session.cwd}
          onOpenDiff={openDiff}
          onOpenFile={(path, line) => { openPath(session, path, line ?? undefined) }}
          typeInto={typeInto}
          paneQueue={paneQueue}
          ask={session.ask}
          asking={session.asking}
          helperAsk={session.helperAsk.length > 0 ? { tasks: session.helperAsk, answer: answerHelperAsk } : undefined}
          secretAsks={session.secretAsk}
          machine={session.machine}
          sessionId={session.id}
          problem={problem}
          place={placeOf(session)}
          ended={session.ended ? endedActions : undefined}
          effort={session.agentEffort ?? null}
          rewind={rewind}
          {...(fileSearch === null ? {} : { fileSearch })}
          paneStatus={session.status}
          {...(session.hooked === undefined ? {} : { hooked: session.hooked })}
          hookProblem={session.hookProblem ?? null}
          helpersOnly={session.helpersOnly}
          usage={{ context: session.usage.context, limits: session.limits }}
          process={session.process}
          online={online}
          paused={kept}
          subagent={subagent ?? null}
          subagents={helpers}
          onBackToMain={() => { setOpenSubagent(null) }}
          windowActions={{ openSettings: setSettingsSection, openPanel: (view) => { openPanel(pane.id, session.id, view) }, openRecent: () => { setRecentOpen(true) }, renameSession: (name) => { saveName(session.id, name) } }}
          hideSuccessfulTools={preferences.hideSuccessfulTools}
        />
        </OpenSubagentContext.Provider>
        </PaneErrorBoundary>
      ) : undefined}
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
          focused={focused && splits.focus === AGENT_LEAF && !modalOpen && view === 'terminal' && !dockFocused && !panelFocused}
          paused={kept || view === 'chat'}
          onInput={(data) => { mirrorInput(session.id, data) }}
          onOpenPath={(path, line) => { openPath(session, path, line) }}
          onPasteImage={(image) => { pasteImage(session.id, image) }}
          onHandle={(handle) => {
            if (handle) terminalHandles.current.set(session.id, handle)
            else terminalHandles.current.delete(session.id)
          }}
        />
      }
      onFocus={() => { focusLeafOf(AGENT_LEAF) }}
      onSplit={(paneId, direction) => {
        focusLeafOf(AGENT_LEAF)
        split(paneId, direction, AGENT_LEAF)
      }}
      onToggleMaximize={(paneId) => { movePanes(() => { setLayout((current) => toggleMaximize(current, paneId)) }) }}
      onClose={closePaneById}
      onClear={() => { void sendTo(session, CLEAR_SCREEN).catch((error: unknown) => { toast.failed('Could not clear the screen', error) }) }}
      onCopyPath={() => { copyPathOf(session.id) }}
      onRename={() => { setRenameId(session.id) }}
      onRestart={restartPane}
      outsideAsks={{ onHelpers: () => { setOpenAsk({ kind: 'helpers', sessionId: session.id }) }, onSecret: (askId) => { setOpenAsk({ kind: 'secret', sessionId: session.id, askId }) } }}
    />
  )
  return (
    <SplitTree
      tree={splits.tree}
      leafKeyOf={(leaf) => leafKey(session.id, leaf)}
      dropLeaf={dragLeaf !== null && dropLeaf !== dragLeaf ? dropLeaf : null}
      onResize={(path, ratio) => { resizeSplit(session.id, path, ratio) }}
      renderPane={(leaf) => {
        if (leaf === AGENT_LEAF) return agentPane
        const shell = sessionMap.get(leaf)
        // A shell's terminal is built when its session is on screen: one kept mounted out of sight would hold a GPU
        // context for a pane nobody is looking at, and a browser has few of those.
        if (kept) return null
        // A shell just started, or just closed, is not in the list yet or any more: its card stands in its room
        // meanwhile, so the split glides open around a pane and a close fades a pane out, never an empty gap.
        if (shell === undefined) return <SplitPlaceholder id={leaf} />
        return (
          <SplitPane
            slotId={pane.id}
            leaf={leafKey(session.id, leaf)}
            owner={session}
            shell={shell}
            number={splits.numbers[leaf]}
            focused={focused && !outsidePanes && splits.focus === leaf}
            splitRefusal={splitRefusal}
            onFocus={() => { focusLeafOf(leaf) }}
            onSplit={(direction) => {
              focusLeafOf(leaf)
              split(pane.id, direction, leaf)
            }}
            onClose={() => { closeSplit(session, leaf) }}
          />
        )
      }}
    />
  )
}
