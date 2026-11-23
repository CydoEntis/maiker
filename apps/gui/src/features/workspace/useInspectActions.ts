import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { toast } from '@/lib/toast'
import { guardLocal } from '@/lib/localOnly'
import { isChatSession } from './model/chatSession'
import type { RepoSurfaceKind, SingleSurfaceKind } from '@/features/inspect/panelTabs'
import type { TurnSpan } from '@/features/inspect/turnRange'
import { focusPane, type Layout } from './model/layout'
import type { SessionView } from './model/session'

/** A turn whose changes the panel shows instead of the whole working tree; `turn` is null when its times are unknown. */
export type TurnDiff = { sessionId: string; turn: TurnSpan | null }

/** The turn the panel shows. It belongs to the session it was opened for: when the focus moves to another, it goes. */
export function useTurnDiff(focusedId: string | null) {
  const [turnDiff, setTurnDiff] = useState<TurnDiff | null>(null)
  const [seenFocus, setSeenFocus] = useState(focusedId)
  if (seenFocus !== focusedId) {
    setSeenFocus(focusedId)
    if (turnDiff !== null && turnDiff.sessionId !== focusedId) setTurnDiff(null)
  }
  return [turnDiff, setTurnDiff] as const
}

/**
 * The pane another machine's daemon is asked about for `session`'s changes, or null when it has
 * none: a chat there has no terminal of its own to stand for its folder.
 */
export function remoteRepoPane(session: SessionView): number | null {
  return isChatSession(session.conversation) ? (session.conversation.nativePane ?? null) : session.pane
}

/** Why the side panel has nothing for `session`, or null when it has: a session of another machine needs a pane its daemon can be asked about. */
function panelRefusal(session: SessionView | undefined): string | null {
  return session !== undefined && remoteRepoPane(session) === null ? guardLocal(session, 'inspect') : null
}

/** Opens and closes the side panel. For a session of another machine it shows that machine's changes; one with no pane to ask is told so instead. */
export function useInspectActions({ focusedSession, setInspectOpen, openSurface, setTurnDiff, sessionMap, showSessionById, setLayout }: {
  focusedSession: SessionView | undefined
  setInspectOpen: Dispatch<SetStateAction<boolean>>
  /** Opens the side panel on one of a session's surfaces. */
  openSurface: (sessionId: string, kind: SingleSurfaceKind) => void
  setTurnDiff: Dispatch<SetStateAction<TurnDiff | null>>
  sessionMap: Map<string, SessionView>
  showSessionById: (sessionId: string) => void
  setLayout: Dispatch<SetStateAction<Layout>>
}) {
  const inspectRefusal = panelRefusal(focusedSession)
  const toggleInspect = useCallback(() => {
    if (inspectRefusal !== null) toast.info(inspectRefusal)
    else setInspectOpen((open) => !open)
  }, [inspectRefusal, setInspectOpen])
  // The session's repository changes beside it, once `bringForward` has put it in front; a turn's own when one is given.
  const openChanges = useCallback((sessionId: string, bringForward: () => void, turn?: TurnSpan | null) => {
    const refusal = panelRefusal(sessionMap.get(sessionId))
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    bringForward()
    setTurnDiff(turn === undefined ? null : { sessionId, turn })
    openSurface(sessionId, 'changes')
  }, [sessionMap, openSurface, setTurnDiff])
  // A chat's edit block or changes row: its own pane takes the focus, so a helper agent's chat open there stays open.
  const showChanges = useCallback((paneId: string, sessionId: string, _file?: string, turn?: TurnSpan | null) => {
    openChanges(sessionId, () => { setLayout((current) => focusPane(current, paneId)) }, turn)
  }, [openChanges, setLayout])
  // A project's Show files: one of its sessions comes to the front, since the files are read through a session.
  const showFilesOf = useCallback((sessionId: string) => {
    const refusal = panelRefusal(sessionMap.get(sessionId))
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    showSessionById(sessionId)
    setTurnDiff(null)
    openSurface(sessionId, 'files')
  }, [sessionMap, showSessionById, setTurnDiff, openSurface])
  // The pane takes the focus and the panel shows the surface `view` for it. A chat command such as /diff only ever opens it:
  // typing it twice must not hide what it asked for.
  const openPanel = useCallback((paneId: string, sessionId: string, view: RepoSurfaceKind) => {
    const refusal = panelRefusal(sessionMap.get(sessionId))
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    setLayout((current) => focusPane(current, paneId))
    setTurnDiff(null)
    openSurface(sessionId, view)
  }, [sessionMap, setLayout, openSurface, setTurnDiff])
  // The focused session's panel on one surface, for the command palette: the title bar's button only shows and hides it.
  const showPanelView = useCallback((view: SingleSurfaceKind) => {
    if (focusedSession === undefined) return
    if (inspectRefusal !== null) {
      toast.info(inspectRefusal)
      return
    }
    setTurnDiff(null)
    openSurface(focusedSession.id, view)
  }, [focusedSession, inspectRefusal, setTurnDiff, openSurface])
  return { toggleInspect, inspectRefusal, showFilesOf, showChanges, openPanel, showPanelView }
}
