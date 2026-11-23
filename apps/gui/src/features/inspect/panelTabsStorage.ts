import { panelTabsOf, type PanelTabs } from './panelTabs'

const STORAGE_KEY = 'maiker.gui.panel-tabs.v1'

/** The side panel's tabs of each session, by the session's id. */
export type SavedPanels = ReadonlyMap<string, PanelTabs>

/** The tabs each session's side panel had last time. Which terminals still exist is the daemon's; this is only where each was shown. */
export function readPanelTabs(): SavedPanels {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Map()
    return new Map(Object.entries(value).flatMap(([sessionId, stored]): [string, PanelTabs][] => {
      const panel = panelTabsOf(stored)
      return panel === null ? [] : [[sessionId, panel]]
    }))
  } catch (error) {
    console.warn('Ignoring invalid Maiker side panel tabs', error)
    return new Map()
  }
}

export function writePanelTabs(panels: SavedPanels): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(panels)))
  } catch (error) {
    console.warn('Could not keep the side panel tabs', error)
  }
}
