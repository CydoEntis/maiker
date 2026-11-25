import { markClosed, unmarkClosed } from './closedSessions'
import { movePanes } from './components/paneTransition'
import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { toast } from '@/lib/toast'
import { closeSession } from '@/api/daemon'
import { confirmAsk, type ConfirmAsk } from '@/features/confirm/confirm'
import type { Confirm } from '@/features/confirm/useConfirm'
import { useLatest } from '@/lib/useLatest'
import { guardDrafts, inPane, ofSessions } from '@/features/documents/draftGuard'
import { isChatSession } from './model/chatSession'
import { type Layout, removePane, removeSessions } from './model/layout'
import { agentLabel, displayName, type SessionView } from './model/session'
import { isShell, keepsRunningUnseen, rowTitle, sessionWords } from './model/sidebar'
import type { AgentTerminals } from '@/data/agentTerminals'

/** How long a closing pane shrinks before its session ends (matches `.mx-pane-cell.is-closing` in pane.css), and how long it is kept marked if the close did not happen. */
const PANE_EXIT_MS = 240

const PANE_CLOSE_SETTLE_MS = 1500

/** The last part of a path, whichever way its machine writes one. */
const folderOf = (path: string): string => path.split(/[\\/]/).filter((part) => part !== '').at(-1) ?? path

/** A shell with no chat of its own: closing it is closing a terminal, not a session. */
const isPlainShell = (session: SessionView): boolean => isShell(session) && !isChatSession(session.conversation)

/** What to ask before `closing` (sessions that have not ended, at least one) close. */
export function closeAsk(closing: readonly SessionView[]): ConfirmAsk {
  const only = closing.length === 1 ? closing[0] : undefined
  if (closing.every(isPlainShell)) return confirmAsk('close-terminal', { name: only ? displayName(only) : `${String(closing.length)} terminals` })
  if (only === undefined) return confirmAsk('close-session', { count: closing.length })
  return confirmAsk('close-session', {
    name: sessionWords(only).title,
    agent: agentLabel(only.process),
    state: only.status === 'working' ? 'working' : only.status === 'needs' ? 'needs' : 'quiet',
    branch: only.branch,
    worktree: only.worktree && only.checkout !== null ? folderOf(only.checkout) : null,
  })
}

/**
 * What to ask before `closing` (sessions that have not ended, at least one) close from a list that names them: one is
 * asked about as its pane's close asks, several by name as Close project names them, up to three and a count of the rest.
 */
export function closeNamedAsk(closing: readonly SessionView[]): ConfirmAsk {
  return closing.length === 1 ? closeAsk(closing) : confirmAsk('close-session', { names: closing.map(rowTitle) })
}

/** Closing panes and sessions, asking first (`confirm`) unless nothing in them is still running. */
export function useClosing({ setLayout, queryClient, layout, sessions, flash, paneSessions, agentTerminals, confirm }: {
  /** The window's confirm: it asks, or runs at once for a kind the person said not to ask about again. */
  confirm: Confirm
  /** The terminals each agent opened for itself: they end with their agent. */
  agentTerminals: AgentTerminals
  setLayout: Dispatch<SetStateAction<Layout>>
  queryClient: QueryClient
  layout: Layout
  sessions: SessionView[]
  flash: (text: string) => void
  paneSessions: ReadonlyMap<string, SessionView>
}) {
  // Ending a session takes a moment, and the layout may change meanwhile (a split, a resize, another close):
  // the pane is taken out of the layout as it is when the daemon answers, not as it was when the close began.
  const layoutNow = useLatest(() => layout)
  const endSessionsNow = useCallback((ids: string[]) => {
    // An agent's own terminals go with it. Left running they were listed as sessions of their own under Terminals,
    // so stopping an agent looked as if it had turned into a terminal.
    const gone = new Set(ids.flatMap((id) => [id, ...(agentTerminals.get(id) ?? [])]))
    markClosed(gone)
    const running = sessions.filter((session) => gone.has(session.id))
    // Panes of sessions that already ended have nothing to stop: they just close.
    if (running.length === 0) {
      movePanes(() => { setLayout((current) => removeSessions(current, gone)) })
      return
    }
    // Each close stands alone: one that fails keeps its pane and its row, and the others still close.
    void Promise.allSettled(running.map((session) => closeSession(session.conversation)))
      .then(async (results) => {
        const terminals = running.filter((_, index) => results[index]?.status === 'fulfilled')
        const failed = running.filter((_, index) => results[index]?.status !== 'fulfilled')
        if (failed.length > 0) {
          unmarkClosed(failed.map((session) => session.id))
          const reason: unknown = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason
          toast.failed(failed.length === 1 && failed[0] ? `Could not end ${displayName(failed[0])}` : `Could not end ${String(failed.length)} sessions`, reason)
        }
        if (terminals.length === 0) return
        const closed = new Set(terminals.map((session) => session.id))
        // An ended session whose pane had nothing to stop goes too.
        const removing = new Set([...gone].filter((id) => closed.has(id) || !running.some((session) => session.id === id)))
        movePanes(() => { setLayout(removeSessions(layoutNow(), removing)) })
        await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      })
      .catch((error: unknown) => { toast.failed('Could not end the session', error) })
  }, [sessions, setLayout, layoutNow, queryClient, agentTerminals])

  // A session's documents go with it: a draft in one is asked about first, whoever started the close.
  const endSessions = useCallback((ids: string[]) => {
    const withTerminals = new Set(ids.flatMap((id) => [id, ...(agentTerminals.get(id) ?? [])]))
    guardDrafts(ofSessions(withTerminals), () => { endSessionsNow(ids) })
  }, [agentTerminals, endSessionsNow])

  /** Runs `close` now when every session in `ids` has already ended, so nothing would stop. Otherwise asks first. */
  const askToClose = useCallback((ids: string[], close: () => void) => {
    const live = ids.flatMap((id) => paneSessions.get(id) ?? []).filter((session) => !session.ended)
    if (live.length === 0) close()
    else confirm(closeAsk(live), close)
  }, [paneSessions, confirm])

  /**
   * Ends the sessions in `ids` chosen from a list (a project's Workspace panel): one question naming the running ones
   * (`closeNamedAsk`), then `endSessions`, so drafts are asked about and each close keeps the service's undo. Ended ones
   * close without asking.
   */
  const closeSessions = useCallback((ids: readonly string[]) => {
    const live = ids.flatMap((id) => paneSessions.get(id) ?? []).filter((session) => !session.ended)
    if (live.length === 0) endSessions([...ids])
    else confirm(closeNamedAsk(live), () => { endSessions([...ids]) })
  }, [paneSessions, confirm, endSessions])

  // A pane that is closing shrinks away first (its neighbours grow into the room as it goes); the session ends
  // when that is done. If the close does not happen it grows back.
  const [closingPanes, setClosingPanes] = useState<ReadonlySet<string>>(() => new Set())
  const closePaneNow = useCallback((paneId: string) => {
    const tab = layout.arrangements.find((candidate) => candidate.panes.some((pane) => pane.id === paneId))
    const pane = tab?.panes.find((candidate) => candidate.id === paneId)
    if (!tab || !pane) return
    if (tab.panes.length <= 1) {
      endSessions([pane.sessionId])
      return
    }
    setClosingPanes((current) => new Set(current).add(paneId))
    window.setTimeout(() => {
      endSessions([pane.sessionId])
      window.setTimeout(() => {
        setClosingPanes((current) => {
          const next = new Set(current)
          next.delete(paneId)
          return next
        })
      }, PANE_CLOSE_SETTLE_MS)
    }, PANE_EXIT_MS)
  }, [endSessions, layout])
  const closePaneById = useCallback((paneId: string) => {
    const tab = layout.arrangements.find((candidate) => candidate.panes.some((pane) => pane.id === paneId))
    const pane = tab?.panes.find((candidate) => candidate.id === paneId)
    if (!tab || !pane) return
    // A document pane shows a file beside its session: closing it takes the pane out and nothing else.
    if (pane.doc) {
      guardDrafts(inPane(paneId), () => { movePanes(() => { setLayout((current) => removePane(current, paneId)) }) })
      return
    }
    const session = paneSessions.get(pane.sessionId)
    // One pane of several, with an agent or a running program in it: only the pane goes. The session keeps
    // running and stays in the sidebar, where a click shows it again. Ending it is the sidebar's Stop.
    if (tab.panes.length > 1 && session !== undefined && keepsRunningUnseen(session)) {
      movePanes(() => { setLayout((current) => removePane(current, paneId)) })
      flash(`Pane closed · ${displayName(session)} keeps running`)
      return
    }
    // Ending the session takes its documents with it: ask about their drafts before the pane starts to shrink.
    askToClose([pane.sessionId], () => { guardDrafts(ofSessions(new Set([pane.sessionId])), () => { closePaneNow(paneId) }) })
  }, [layout, paneSessions, setLayout, flash, askToClose, closePaneNow])
  return { askToClose, closeSessions, endSessions, closePaneById, closingPanes }
}
