import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'
import { toast } from '@/lib/toast'
import { guardLocal } from '@/lib/localOnly'
import { isChatSession } from './model/chatSession'
import type { InspectView } from '@/features/inspect/InspectPanel'
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
export function useInspectActions({ focusedSession, setInspectOpen, setInspectView, setTurnDiff, sessionMap, showSessionById, inspectOpen, inspectView, focusedId, setLayout }: {
  focusedSession: SessionView | undefined
  setInspectOpen: Dispatch<SetStateAction<boolean>>
  setInspectView: Dispatch<SetStateAction<InspectView>>
  setTurnDiff: Dispatch<SetStateAction<TurnDiff | null>>
  sessionMap: Map<string, SessionView>
  showSessionById: (sessionId: string) => void
  inspectOpen: boolean
  inspectView: InspectView
  focusedId: string | null
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
    setInspectView('changes')
    setInspectOpen(true)
  }, [sessionMap, setInspectOpen, setInspectView, setTurnDiff])
  // A chat's edit block or changes row: its own pane takes the focus, so a helper agent's chat open there stays open.
  const showChanges = useCallback((paneId: string, sessionId: string, _file?: string, turn?: TurnSpan | null) => {
    openChanges(sessionId, () => { setLayout((current) => focusPane(current, paneId)) }, turn)
  }, [openChanges, setLayout])
  // A session menu's Show changes: the session may be out of sight, so it is brought to the front.
  const showChangesOf = useCallback((sessionId: string) => { openChanges(sessionId, () => { showSessionById(sessionId) }) }, [openChanges, showSessionById])
  // The pane takes the focus and the panel shows for it, on `view` when one is asked for; `open` false closes it.
  const showPanel = useCallback((paneId: string, sessionId: string, view: InspectView | undefined, open: (showing: boolean) => boolean) => {
    const refusal = panelRefusal(sessionMap.get(sessionId))
    if (refusal !== null) {
      toast.info(refusal)
      return
    }
    const showing = inspectOpen && focusedId === sessionId && (view === undefined || inspectView === view)
    setLayout((current) => focusPane(current, paneId))
    setTurnDiff(null)
    if (view !== undefined) setInspectView(view)
    setInspectOpen(open(showing))
  }, [sessionMap, inspectOpen, inspectView, focusedId, setLayout, setInspectView, setInspectOpen, setTurnDiff])
  // A pane's side-panel button closes the panel when it already showed that.
  const togglePanel = useCallback((paneId: string, sessionId: string, view?: InspectView) => { showPanel(paneId, sessionId, view, (showing) => !showing) }, [showPanel])
  // A chat command such as /diff only ever opens it: typing it twice must not hide what it asked for.
  const openPanel = useCallback((paneId: string, sessionId: string, view: InspectView) => { showPanel(paneId, sessionId, view, () => true) }, [showPanel])
  return { toggleInspect, inspectRefusal, showChangesOf, showChanges, togglePanel, openPanel }
}
