import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from 'react'
import { daemonSaidEnded } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { AgentTerminals } from '@/data/agentTerminals'
import { toast } from '@/lib/toast'
import { wasClosed } from './closedSessions'
import { movePanes } from './components/paneTransition'
import { activeArrangement, cycleFocus, type Layout, type PaneSlot } from './model/layout'
import { remoteStartRefusal } from './model/machines'
import type { SessionView } from './model/session'
import { readSessionSplits, type SavedSplits, writeSessionSplits } from './model/splitStorage'
import { AGENT_LEAF, closeLeaf, focusLeaf, leavesOf, type ListedPane, liveSplits, MAX_SESSION_PANES, provenShells, type SessionSplits, setRatio, type SplitDir, splitLeaf, stepFocus, UNSPLIT } from './model/splitTree'

export const SPLIT_IN_CHAT_VIEW = 'Split makes a terminal, which belongs to the Terminal view. In the Chat view, open a terminal in the side panel instead.'
const SESSION_FULL = 'Six panes is the most one session can hold'
const NOTHING_TO_SPLIT = 'A split belongs to a session’s terminal. Click one first.'

/** What a split is called, in its header and in the question its close asks. */
export const splitName = (number: number | undefined): string => `Split ${String(number ?? 1)}`

const TOKEN_BYTES = 6
const HEX = 16
const HEX_DIGITS = 2

/**
 * The name a split's shell is given on the daemon, where a restart keeps it: the one thing about a pane that says
 * "this is that split" when its number may have been handed out again. Random, so no other pane carries it, and
 * short, because the daemon cuts a long name.
 */
function newMark(): string {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)), (byte) => byte.toString(HEX).padStart(HEX_DIGITS, '0')).join('')
  return `Split ${token}`
}

/**
 * The split trees, kept between runs, and the shells proven to be each listed session's splits (`provenShells`).
 * Only those are a session's own: hidden from the sidebar, drawn in its tree, ended with it. A record that names a
 * pane it cannot prove is left alone, and the pane stays an ordinary session.
 */
export function useSplitStore(sessionMap: ReadonlyMap<string, SessionView>) {
  const [savedSplits, setSavedSplits] = useState<SavedSplits>(readSessionSplits)
  useEffect(() => { writeSessionSplits(savedSplits) }, [savedSplits])
  // The shells this window started in this run: one is its session's split before the daemon lists it under its mark.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  // Once the daemon lists a shell under a name, that name alone says whose it is: the number may be another pane's later.
  const named = [...fresh].filter((id) => (sessionMap.get(id)?.name ?? null) !== null)
  if (named.length > 0) setFresh(new Set([...fresh].filter((id) => !named.includes(id))))
  const paneOf = useCallback((id: string): ListedPane | undefined => {
    const session = sessionMap.get(id)
    return session === undefined ? undefined : { name: session.name, agent: Boolean(session.conversation.agent) }
  }, [sessionMap])
  const provenOf = useCallback((splits: SessionSplits) => provenShells(splits, paneOf, fresh), [paneOf, fresh])
  const splitOwned = useMemo<AgentTerminals>(() => new Map([...savedSplits]
    .filter(([owner]) => sessionMap.has(owner))
    .map(([owner, splits]): [string, string[]] => [owner, [...provenOf(splits)]])
    .filter(([, ids]) => ids.length > 0)), [savedSplits, sessionMap, provenOf])
  return { savedSplits, setSavedSplits, setFresh, provenOf, splitOwned }
}

/** The first pane the keys reach when they come into a session from the pane before it, or the last when from the one after. */
function edgeLeaf(splits: SessionSplits, step: 1 | -1): string {
  const leaves = leavesOf(splits.tree)
  return (step === 1 ? leaves[0] : leaves.at(-1)) ?? AGENT_LEAF
}

/**
 * A session's splits (the Terminal view only). A split is an ordinary shell the daemon owns, started in the session's
 * folder and named with a mark of its own. The tree records where each one sits and that mark; a shell is the
 * session's (out of the sidebar, ended with it) only while the daemon lists it under that mark.
 */
export function useSessionSplits({ savedSplits, setSavedSplits, setFresh, provenOf, nameShell, sessionMap, layout, setLayout, shownAsTerminal, online, listed, runStart, closeAgentTerminals, endSessions }: {
  savedSplits: SavedSplits
  setSavedSplits: Dispatch<SetStateAction<SavedSplits>>
  setFresh: Dispatch<SetStateAction<ReadonlySet<string>>>
  /** The shells of a tree that are proven to be its splits (`useSplitStore`). */
  provenOf: (splits: SessionSplits) => Set<string>
  /** Gives a shell its mark as its name on the daemon. */
  nameShell: (shellId: string, name: string) => void
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
  const splitsOf = useCallback((session: SessionView): SessionSplits => {
    const saved = savedSplits.get(session.id)
    if (saved === undefined || !shownAsTerminal(session)) return UNSPLIT
    return liveSplits(saved, provenOf(saved))
  }, [savedSplits, provenOf, shownAsTerminal])

  /** How many panes the slot draws: a session's tree, or one for a file pane. */
  const paneCountOf = useCallback((pane: PaneSlot): number => {
    const session = pane.doc ? undefined : sessionMap.get(pane.sessionId)
    return session === undefined ? 1 : leavesOf(splitsOf(session).tree).length
  }, [sessionMap, splitsOf])

  // Every change is made to the tree as it is now: a shell that is gone has left it first, so a path or a number
  // worked out from what is on screen means the same thing here.
  // `started` is a shell this very change adds: the list the window draws from may not have it yet.
  const change = useCallback((sessionId: string, edit: (splits: SessionSplits) => SessionSplits, started?: string) => {
    setSavedSplits((current) => {
      const stored = current.get(sessionId)
      const before = stored ?? UNSPLIT
      const after = edit(liveSplits(before, started === undefined ? provenOf(before) : provenOf(before).add(started)))
      const split = leavesOf(after.tree).length > 1
      if (after === stored || (!split && stored === undefined)) return current
      const next = new Map(current)
      if (split) next.set(sessionId, after)
      else next.delete(sessionId)
      return next
    })
  }, [provenOf, setSavedSplits])

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
      const mark = newMark()
      setFresh((current) => new Set(current).add(id))
      nameShell(id, mark)
      // The pane it came from may have closed while the shell started: the new one then halves the pane with the focus.
      // A tree that filled up meanwhile leaves the shell an ordinary terminal in the sidebar, never out of sight.
      movePanes(() => { change(session.id, (splits) => splitLeaf(splits, leavesOf(splits.tree).includes(from) ? from : splits.focus, direction, id, mark), id) })
    })
  }, [layout, sessionMap, splitRefusalOf, splitsOf, runStart, setFresh, nameShell, change])

  const focusSplit = useCallback((sessionId: string, leaf: string) => { change(sessionId, (splits) => focusLeaf(splits, leaf)) }, [change])
  const resizeSplit = useCallback((sessionId: string, path: string, ratio: number | null) => { change(sessionId, (splits) => setRatio(splits, path, ratio)) }, [change])

  // Closing a split ends its shell, so it asks first (as closing a terminal). Its pane goes with the answer, not when
  // the daemon's next list comes; a shell that then fails to end is listed as a terminal of its own.
  const closeSplit = useCallback((session: SessionView, shellId: string) => {
    // Only a pane of the session's tree is closed here, and the tree holds proven splits only.
    if (!leavesOf(splitsOf(session).tree).includes(shellId)) return
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

  // A session that is gone takes its tree with it. When the daemon says it was closed or exited (somewhere else, or
  // by its own `exit`), its splits are ended here, as closing it in this window ends them. Only a shell proven to be
  // one of its splits is ended, and never one a close is already ending.
  useEffect(() => {
    if (!listed) return
    const gone = [...savedSplits].filter(([owner]) => !sessionMap.has(owner))
    if (gone.length === 0) return
    const orphans = gone.filter(([owner]) => daemonSaidEnded(owner)).flatMap(([, splits]) => [...provenOf(splits)]).filter((id) => !wasClosed(id))
    if (orphans.length > 0) endSessions(orphans)
    setSavedSplits((current) => new Map([...current].filter(([owner]) => !gone.some(([left]) => left === owner))))
  }, [listed, savedSplits, sessionMap, provenOf, endSessions, setSavedSplits])

  return { splitsOf, paneCountOf, splitRefusalOf, split, focusSplit, resizeSplit, closeSplit, closeFocusedSplit, stepPaneFocus }
}
