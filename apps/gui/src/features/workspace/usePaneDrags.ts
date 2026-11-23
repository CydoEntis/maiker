import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { parseLeafKey, registerDragHandlers } from './components/dragSession'
import { movePanes } from './components/paneTransition'
import { dropSession, type Layout, swapSessions } from './model/layout'
import { swapLeaves } from './model/splitTree'
import type { SavedSplits } from './model/splitStorage'

/**
 * Dragging a pane onto another swaps them; dragging a session from the sidebar puts it in the pane. A pane of a split
 * session dropped on another pane of the same session trades places with it inside the session.
 */
export function usePaneDrags({ setLayout, setSavedSplits }: {
  setLayout: Dispatch<SetStateAction<Layout>>
  setSavedSplits: Dispatch<SetStateAction<SavedSplits>>
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null>(null)
  const [dragLeaf, setDragLeaf] = useState<string | null>(null)
  const [dropLeaf, setDropLeaf] = useState<string | null>(null)
  useEffect(() => registerDragHandlers({
    start: (source) => {
      if (source.kind === 'pane') setDragId(source.id)
      setDragLeaf(source.leaf ?? null)
    },
    over: (paneId, leaf) => { setDropId(paneId); setDropLeaf(leaf) },
    drop: (source, paneId, leaf) => {
      if (!paneId) return
      const from = source.leaf === undefined ? null : parseLeafKey(source.leaf)
      const to = leaf === null ? null : parseLeafKey(leaf)
      if (from !== null && to !== null && from.owner === to.owner) {
        if (from.leaf === to.leaf) return
        movePanes(() => {
          setSavedSplits((current) => {
            const stored = current.get(from.owner)
            if (stored === undefined) return current
            const next = swapLeaves(stored, from.leaf, to.leaf)
            return next === stored ? current : new Map(current).set(from.owner, next)
          })
        })
      } else if (source.kind === 'session') {
        movePanes(() => { setLayout((current) => dropSession(current, paneId, source.id)) })
      } else if (source.id !== paneId) movePanes(() => { setLayout((current) => swapSessions(current, source.id, paneId)) })
    },
    end: () => { setDragId(null); setDropId(null); setDragLeaf(null); setDropLeaf(null) },
  }), [setLayout, setSavedSplits])
  // A drag from the sidebar ends wherever it is released; the pane's highlight must not outlast it.
  useEffect(() => {
    const clear = () => { setDropId(null); setDropLeaf(null) }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])
  return { dropId, dragId, dropLeaf, dragLeaf }
}
