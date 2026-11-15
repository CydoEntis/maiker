const STORAGE_KEY = 'maitty.gui.terminal-tabs.v1'

/** One tab of the terminal dock: columns of terminal ids (`features/workspace/model/terminalTabs.ts`). */
type SavedTab = readonly (readonly string[])[]

/** How each agent's terminals were split into tabs, by the agent's session id. */
export type SavedTerminalTabs = ReadonlyMap<string, readonly SavedTab[]>

function isTab(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every((column) => Array.isArray(column) && column.every((id) => typeof id === 'string'))
}

function isTabList(value: unknown): value is string[][][] {
  return Array.isArray(value) && value.every(isTab)
}

/** The tabs and splits each agent's terminals had last time. Which shells exist is the daemon's; this is only their arrangement. */
export function readTerminalTabs(): SavedTerminalTabs {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return new Map()
    return new Map(Object.entries(value).filter((entry): entry is [string, string[][][]] => isTabList(entry[1])))
  } catch (error) {
    console.warn('Ignoring invalid Maitty terminal tabs', error)
    return new Map()
  }
}

export function writeTerminalTabs(tabs: SavedTerminalTabs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(tabs)))
  } catch (error) {
    console.warn('Could not keep the terminal tabs', error)
  }
}
