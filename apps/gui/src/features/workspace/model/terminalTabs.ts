/**
 * How an agent's terminals are arranged in the terminal dock (layout 2h): tabs, and inside a tab up to four shells
 * split into columns and rows. Each split is a shell of its own that the daemon owns; which tab and column it sits in
 * is the window's own knowledge, like the panes of a layout.
 */

/** A tab: columns left to right, each a list of terminal ids top to bottom. Never empty. */
export type TerminalTab = readonly (readonly string[])[]

/** The most shells one tab splits into: past this the panes are too small to read. */
export const MAX_SPLITS = 4

/** Where a new shell goes: beside `beside`, to its right or under it. */
export type SplitPlace = { beside: string; down: boolean }

export function splitCount(tab: TerminalTab): number {
  return tab.reduce((total, column) => total + column.length, 0)
}

/** The ids of a tab, in reading order. */
export function tabIds(tab: TerminalTab): string[] {
  return tab.flat()
}

/**
 * The tabs to show for an agent whose live terminals are `ids`: what was saved, with the terminals that are gone
 * dropped and every terminal not in a tab yet given a tab of its own at the end. The tabs can never lose a terminal.
 */
export function liveTabs(saved: readonly TerminalTab[] | undefined, ids: readonly string[]): TerminalTab[] {
  const live = new Set(ids)
  const placed = new Set<string>()
  const tabs: TerminalTab[] = []
  for (const tab of saved ?? []) {
    const columns = tab.map((column) => column.filter((id) => live.has(id) && !placed.has(id))).filter((column) => column.length > 0)
    for (const id of columns.flat()) placed.add(id)
    if (columns.length > 0) tabs.push(columns)
  }
  for (const id of ids) if (!placed.has(id)) tabs.push([[id]])
  return tabs
}

/**
 * `tabs` with `id` split in beside `place.beside`: a column to its right, or a row under it. A tab that is full, or a
 * terminal that is in no tab, gives the new shell a tab of its own instead.
 */
export function withSplit(tabs: readonly TerminalTab[], id: string, place: SplitPlace): TerminalTab[] {
  const at = tabs.findIndex((tab) => tabIds(tab).includes(place.beside))
  const tab = tabs[at]
  if (tab === undefined || splitCount(tab) >= MAX_SPLITS) return [...tabs, [[id]]]
  const column = tab.findIndex((ids) => ids.includes(place.beside))
  const next = tab.map((ids) => [...ids])
  if (place.down) {
    const row = next[column]?.indexOf(place.beside) ?? -1
    next[column]?.splice(row + 1, 0, id)
  } else {
    next.splice(column + 1, 0, [id])
  }
  return tabs.map((each, index) => (index === at ? next : each))
}

/** The tab that holds `id`, or -1. */
export function tabIndexOf(tabs: readonly TerminalTab[], id: string | undefined): number {
  return id === undefined ? -1 : tabs.findIndex((tab) => tabIds(tab).includes(id))
}
