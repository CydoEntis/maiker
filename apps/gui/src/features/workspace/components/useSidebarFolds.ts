import { useEffect, useRef, useState } from 'react'
import { readSidebarFolds, writeSidebarFolds } from '@/data/sidebarFolds'

/** `folded` without `keys`; the same set when none was folded, so nothing is stored again. */
function unfolding(folded: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  return keys.some((key) => folded.has(key)) ? new Set([...folded].filter((key) => !keys.includes(key))) : folded
}

/**
 * Which headings of the sidebar are folded, by their fold keys (`projectFoldKey`, `IDLE_FOLD_KEY`, `helpersFoldKey`); kept in this window's
 * storage, so a fold survives a restart. When `revealed` changes (the project just opened or picked), `revealKeys` are
 * unfolded, so that project is never out of sight.
 */
export function useSidebarFolds(revealed: unknown, revealKeys: readonly string[]) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set(readSidebarFolds()))
  const [shown, setShown] = useState<unknown>(null)
  // Adjusted while rendering, as it follows from the selection: the fold opens in the same frame the project is picked.
  if (revealed !== shown) {
    setShown(revealed)
    const next = unfolding(folded, revealKeys)
    if (next !== folded) setFolded(next)
  }
  const kept = useRef(folded)
  useEffect(() => {
    if (folded === kept.current) return
    kept.current = folded
    writeSidebarFolds([...folded])
  }, [folded])
  return {
    /** Which headings are folded: part of what decides when rows are measured to slide. */
    signature: [...folded].join(','),
    isOpen: (key: string) => !folded.has(key),
    toggle: (key: string) => {
      const next = new Set(folded)
      if (!next.delete(key)) next.add(key)
      setFolded(next)
    },
  }
}
