import { createContext } from 'react'

/** A page of Settings drawn as search results: what was typed, which page this is, and how to open one of its groups. */
export type SearchScope = {
  query: string
  /** The page's name in the nav, put before each group's title in the results. */
  page: string
  /** The page's name matched, so every group on it shows whole. */
  pageMatched: boolean
  /** Leaves the search for this page and puts focus in the named group. */
  onOpen: (cardTitle: string) => void
}

/** Present only while Settings is searching; a page drawn normally has none. */
export const SettingsSearch = createContext<SearchScope | null>(null)

/** False inside a group whose own title did not match, where only the rows that match show. */
export const GroupShowsAll = createContext(true)

/** Case-insensitive, and any part of the text: "dark" finds "Dark theme" and "Use the dark one". */
export function matchesQuery(text: string, query: string): boolean {
  const wanted = query.trim().toLowerCase()
  return wanted === '' || text.toLowerCase().includes(wanted)
}

/** Whether a group shows whole in the results: its page's name or its own title matched, so no row of it is left out. */
export function groupShowsWhole(page: string, title: string, query: string): boolean {
  return matchesQuery(page, query) || matchesQuery(title, query)
}

/** Whether a row is a result: its group shows whole, or its own label or detail matched. */
export function rowIsResult(row: { label: string; detail?: string | undefined }, query: string, groupWhole: boolean): boolean {
  return groupWhole || matchesQuery(`${row.label} ${row.detail ?? ''}`, query)
}
