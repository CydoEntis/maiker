import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { daemonSaidEnded } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { type AgentTerminals, withAgentTerminal } from '@/data/agentTerminals'
import { toast } from '@/lib/toast'
import { wasClosed } from './closedSessions'
import { movePanes } from './components/paneTransition'
import { activeArrangement, cycleFocus, type Layout, type PaneSlot } from './model/layout'
import { remoteStartRefusal } from './model/machines'
import type { SessionView } from './model/session'
import { readSessionSplits, type SavedSplits, writeSessionSplits } from './model/splitStorage'
import { AGENT_LEAF, closeLeaf, focusLeaf, leavesOf, liveSplits, MAX_SESSION_PANES, type SessionSplits, setRatio, type SplitDir, splitLeaf, stepFocus, UNSPLIT } from './model/splitTree'

export const SPLIT_IN_CHAT_VIEW = 'Split makes a terminal, which belongs to the Terminal view. In the Chat view, open a terminal in the side panel instead.'
const SESSION_FULL = 'Six panes is the most one session can hold'
const NOTHING_TO_SPLIT = 'A split belongs to a session’s terminal. Click one first.'

/** What a split is called, in its header and in the question its close asks. */
export const splitName = (number: number | undefined): string => `Split ${String(number ?? 1)}`

/** Every shell that is a pane of some session's split tree. */
function splitShellIds(saved: SavedSplits): ReadonlySet<string> {
  return new Set([...saved.values()].flatMap((splits) => leavesOf(splits.tree)).filter((id) => id !== AGENT_LEAF))
}

/** The split trees, kept between runs, and which shells are panes of one (so the side panel leaves them out of its tabs). */
export function useSplitStore() {
  const [savedSplits, setSavedSplits] = useState<SavedSplits>(readSessionSplits)
  useEffect(() => { writeSessionSplits(savedSplits) }, [savedSplits])
  const splitShells = useMemo(() => splitShellIds(savedSplits), [savedSplits])
  return { savedSplits, setSavedSplits, splitShells }
}

/** The first pane the keys reach when they come into a session from the pane before it, or the last when from the one after. */
function edgeLeaf(splits: SessionSplits, step: 1 | -1): string {
  const leaves = leavesOf(splits.tree)
  return (step === 1 ? leaves[0] : leaves.at(-1)) ?? AGENT_LEAF
}

/**
 * A session's splits (the Terminal view only). A split is an ordinary shell the daemon owns, started in the session's
 * folder and recorded as one of the session's own terminals (`data/agentTerminals.ts`): that record is what keeps it
 * out of the sidebar and ends it with its session. The tree here is only where each one sits.
 */
export function useSessionSplits({ savedSplits, setSavedSplits, ownedShells, knownTerminals, setAgentTerminals, sessionMap, layout, setLayout, shownAsTerminal, online, listed, runStart, closeAgentTerminals, endSessions }: {
  savedSplits: SavedSplits
  setSavedSplits: Dispatch<SetStateAction<SavedSplits>>
  /** The shells that are a listed session's own right now, its splits among them. */
  ownedShells: AgentTerminals
  /** The same record as the window keeps it, with the sessions that are gone still in it. */
  knownTerminals: AgentTerminals
  setAgentTerminals: Dispatch<SetStateAction<AgentTerminals>>
  sessionMap: ReadonlyMap<string, SessionView>
  layout: Layout
  setLayout: Dispatch<SetStateAction<Layout>>
  /** The session's pane shows its terminal: a chat has no splits. */
  shownAsTerminal: (session: SessionView) => boolean
  online: boolean
  /** The session list is the daemon's, read just now: only then does a session missing from it say anything. */
  listed: boolean
  runStart: (folder: () => Promise<string>, place: (sessionId: string) => void) => Promise<boolean>
  /** Asks before ending the shells (as closing a terminal); `after` runs with the close. */
  closeAgentTerminals: (terminalIds: string[], name: string, after?: () => void) => void
  endSessions: (ids: string[]) => void
}) {
  // A shell this window just started is a split before the list the window draws from has it.
  const fresh = useRef(new Set<string>())

  const splitsOf = useCallback((session: SessionView): SessionSplits => {
    const saved = savedSplits.get(session.id)
    if (saved === undefined || !shownAsTerminal(session)) return UNSPLIT
    return liveSplits(saved, new Set(ownedShells.get(session.id) ?? []))
  }, [savedSplits, ownedShells, shownAsTerminal])

  /** How many panes the slot draws: a session's tree, or one for a file pane. */
  const paneCountOf = useCallback((pane: PaneSlot): number => {
    const session = pane.doc ? undefined : sessionMap.get(pane.sessionId)
    return session === undefined ? 1 : leavesOf(splitsOf(session).tree).length
  }, [sessionMap, splitsOf])

  // Every change is made to the tree as it is now: a shell that is gone has left it first, so a path or a number
  // worked out from what is on screen means the same thing here.
  const change = useCallback((sessionId: string, edit: (splits: SessionSplits) => SessionSplits) => {
    for (const id of fresh.current) if (sessionMap.has(id)) fresh.current.delete(id)
    const live = new Set([...(ownedShells.get(sessionId) ?? []), ...fresh.current])
    setSavedSplits((current) => {
      const stored = current.get(sessionId)
      const after = edit(liveSplits(stored ?? UNSPLIT, live))
      const split = leavesOf(after.tree).length > 1
      if (after === stored || (!split && stored === undefined)) return current
      const next = new Map(current)
      if (split) next.set(sessionId, after)
      else next.delete(sessionId)
      return next
    })
  }, [ownedShells, sessionMap, setSavedSplits])

  const splitRefusalOf = useCallback((session: SessionView): string | null => {
    if (!shownAsTerminal(session)) return SPLIT_IN_CHAT_VIEW
    if (session.ended) return 'This session has ended'
    if (!online) return 'The Maiker service is not reachable'
    const remote = remoteStartRefusal(session.machine !== LOCAL_MACHINE, session.machineName, 'Splitting this pane')
    if (remote !== null) return remote
    return leavesOf(splitsOf(session).tree).length >= MAX_SESSION_PANES ? SESSION_FULL : null
  }, [shownAsTerminal, online, splitsOf])

  /** Halves a pane of the session in the slot `slotId` (the focused one when null): `leaf`, else the pane with the focus. */
  const split = useCallback((slotId: string | null, direction: SplitDir, leaf?: string) => {
    const tab = activeArrangement(layout)
    const slot = tab?.panes.find((pane) => pane.id === (slotId ?? tab.focus))
    const session = slot === undefined || slot.doc ? undefined : sessionMap.get(slot.sessionId)
    const refusal = session === undefined ? NOTHING_TO_SPLIT : splitRefusalOf(session)
    if (session === undefined || refusal !== null) {
      toast.info(refusal ?? NOTHING_TO_SPLIT)
      return
    }
    const from = leaf ?? splitsOf(session).focus
    void runStart(() => Promise.resolve(session.cwd), (id) => {
      fresh.current.add(id)
      setAgentTerminals((current) => withAgentTerminal(current, session.id, id, new Set([...sessionMap.keys(), id])))
      // The pane it came from may have closed while the shell started: the new one then halves the pane with the focus.
      // A tree that filled up meanwhile leaves the shell as a terminal of the session's side panel, never with no place.
      movePanes(() => { change(session.id, (splits) => splitLeaf(splits, leavesOf(splits.tree).includes(from) ? from : splits.focus, direction, id)) })
    })
  }, [layout, sessionMap, splitRefusalOf, splitsOf, runStart, setAgentTerminals, change])

  const focusSplit = useCallback((sessionId: string, leaf: string) => { change(sessionId, (splits) => focusLeaf(splits, leaf)) }, [change])
  const resizeSplit = useCallback((sessionId: string, path: string, ratio: number | null) => { change(sessionId, (splits) => setRatio(splits, path, ratio)) }, [change])

  // Closing a split ends its shell, so it asks first (as closing a terminal). Its pane goes with the answer, not when
  // the daemon's next list comes; a shell that then fails to end is still the session's, as a terminal of its side panel.
  const closeSplit = useCallback((session: SessionView, shellId: string) => {
    closeAgentTerminals([shellId], splitName(splitsOf(session).numbers[shellId]), () => { movePanes(() => { change(session.id, (splits) => closeLeaf(splits, shellId)) }) })
  }, [closeAgentTerminals, splitsOf, change])

  const focusedSession = useCallback((from: Layout): SessionView | undefined => {
    const tab = activeArrangement(from)
    const slot = tab?.panes.find((pane) => pane.id === tab.focus)
    return slot === undefined || slot.doc ? undefined : sessionMap.get(slot.sessionId)
  }, [sessionMap])

  /** The close key on a split closes that split; false when the focus is on a session's own pane, which the caller closes. */
  const closeFocusedSplit = useCallback((): boolean => {
    const session = focusedSession(layout)
    const focus = session === undefined ? AGENT_LEAF : splitsOf(session).focus
    if (session === undefined || focus === AGENT_LEAF) return false
    closeSplit(session, focus)
    return true
  }, [focusedSession, layout, splitsOf, closeSplit])

  /** Next or previous pane: through the focused session's own panes first, then on to the next session of the arrangement. */
  const stepPaneFocus = useCallback((step: 1 | -1) => {
    const session = focusedSession(layout)
    const within = session === undefined ? null : stepFocus(splitsOf(session), step)
    if (session !== undefined && within !== null) {
      focusSplit(session.id, within)
      return
    }
    const moved = cycleFocus(layout, step)
    const entered = focusedSession(moved) ?? session
    if (moved !== layout) setLayout((current) => cycleFocus(current, step))
    if (entered !== undefined) focusSplit(entered.id, edgeLeaf(splitsOf(entered), step))
  }, [focusedSession, layout, splitsOf, focusSplit, setLayout])

  // A session that is gone takes its tree with it. When the daemon says it was closed or exited somewhere else (the
  // terminal app, its own `exit`), its splits are ended here, as closing it in this window ends them; one this
  // window closed has ended them already. Only shells this window recorded as that session's are touched.
  useEffect(() => {
    if (!listed) return
    const gone = [...savedSplits.keys()].filter((owner) => !sessionMap.has(owner))
    if (gone.length === 0) return
    const orphans = gone
      .filter((owner) => daemonSaidEnded(owner) && !wasClosed(owner))
      .flatMap((owner) => leavesOf(savedSplits.get(owner)?.tree ?? AGENT_LEAF).filter((id) => sessionMap.has(id) && (knownTerminals.get(owner) ?? []).includes(id)))
    if (orphans.length > 0) endSessions(orphans)
    setSavedSplits((current) => new Map([...current].filter(([owner]) => !gone.includes(owner))))
  }, [listed, savedSplits, sessionMap, knownTerminals, endSessions, setSavedSplits])

  return { splitsOf, paneCountOf, splitRefusalOf, split, focusSplit, resizeSplit, closeSplit, closeFocusedSplit, stepPaneFocus }
}
