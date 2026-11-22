/**
 * The side panel's tabs for one session: which surfaces are open in it, which one shows, and which of the session's
 * terminals are pinned to the drawer under the main pane instead of being a tab. Which terminals exist is the daemon's
 * (`data/agentTerminals.ts`); where each one is shown is the window's own knowledge, like the panes of a layout.
 */

/** Every kind of surface the panel can hold. A new kind is one name here and one entry in `surfaces.ts`. */
export const SURFACE_KINDS = ['files', 'changes', 'terminal', 'pulls'] as const

export type SurfaceKind = (typeof SURFACE_KINDS)[number]

/** The surfaces that read the session's repository, through one of its panes. */
export type RepoSurfaceKind = 'files' | 'changes'

/** The surfaces that open once for a session: anything outside the panel can open one and bring it forward. */
export type SingleSurfaceKind = Exclude<SurfaceKind, 'terminal'>

/** One tab. A surface that opens once has its kind as its id; a terminal's id is its session's. */
export type PanelTab = { readonly kind: SurfaceKind; readonly id: string }

export type PanelTabs = {
  readonly tabs: readonly PanelTab[]
  /** The id of the tab that shows; null only while there is none. */
  readonly active: string | null
  /** The terminals pinned to the bottom, by id: they are not tabs. */
  readonly pinned: readonly string[]
}

export const EMPTY_PANEL: PanelTabs = { tabs: [], active: null, pinned: [] }

/** The tab of `kind`: the one it has, or the one of `instance` for a kind that opens several times. */
export function tabOf(kind: SurfaceKind, instance?: string): PanelTab {
  return { kind, id: instance ?? kind }
}

/** The ids of the terminals that are tabs. */
export function terminalTabIds(panel: PanelTabs): string[] {
  return panel.tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.id)
}

/** `panel` showing `tab`: the tab it already has comes to the front, so Files and Changes never open twice. */
export function openTab(panel: PanelTabs, tab: PanelTab): PanelTabs {
  const pinned = panel.pinned.filter((id) => id !== tab.id)
  if (panel.tabs.some((each) => each.id === tab.id)) return { ...panel, pinned, active: tab.id }
  return { tabs: [...panel.tabs, tab], active: tab.id, pinned }
}

/** `panel` with the tab `id` in front; unchanged when it has no such tab. */
export function showTab(panel: PanelTabs, id: string): PanelTabs {
  return panel.tabs.some((tab) => tab.id === id) ? { ...panel, active: id } : panel
}

/** The tab that shows after the tab at `closed` is taken out of `tabs`: the same one, or the one that took its place. */
function activeAfter(panel: PanelTabs, closed: number, left: readonly PanelTab[]): string | null {
  const shown = panel.tabs.findIndex((tab) => tab.id === panel.active)
  const next = Math.min(Math.max(0, shown - (closed < shown ? 1 : 0)), left.length - 1)
  return left[next]?.id ?? null
}

/** `panel` without the tab `id`. Closing the last tab leaves the empty panel, which offers the surfaces again. */
export function closeTab(panel: PanelTabs, id: string): PanelTabs {
  const closed = panel.tabs.findIndex((tab) => tab.id === id)
  if (closed === -1) return panel
  const left = panel.tabs.filter((tab) => tab.id !== id)
  return { ...panel, tabs: left, active: activeAfter(panel, closed, left) }
}

/** `panel` with the tab `id` alone. */
export function closeOtherTabs(panel: PanelTabs, id: string): PanelTabs {
  const kept = panel.tabs.filter((tab) => tab.id === id)
  return kept.length === 0 ? panel : { ...panel, tabs: kept, active: id }
}

/** `panel` with the terminal tab `id` moved to the bottom: the tab before it shows. Only a terminal can be pinned. */
export function pinTerminal(panel: PanelTabs, id: string): PanelTabs {
  const at = panel.tabs.findIndex((tab) => tab.id === id && tab.kind === 'terminal')
  if (at === -1) return panel
  const left = panel.tabs.filter((tab) => tab.id !== id)
  const active = panel.active === id ? left[Math.max(0, at - 1)]?.id ?? null : panel.active
  return { tabs: left, active, pinned: [...panel.pinned.filter((each) => each !== id), id] }
}

/** `panel` with the terminal `id` at the bottom from the start: one that was started there. */
export function withPinned(panel: PanelTabs, id: string): PanelTabs {
  const left = closeTab(panel, id)
  return { ...left, pinned: [...left.pinned.filter((each) => each !== id), id] }
}

/** `panel` with the pinned terminal `id` back as a tab, in front. */
export function unpinTerminal(panel: PanelTabs, id: string): PanelTabs {
  return panel.pinned.includes(id) ? openTab(panel, tabOf('terminal', id)) : panel
}

/**
 * What to show for a session whose live terminals are `terminalIds`: what was remembered, with the terminals that are
 * gone dropped and every terminal that is neither a tab nor pinned given a tab at the end. A terminal can never be lost,
 * and a tab always shows while there is one.
 */
export function livePanel(saved: PanelTabs | undefined, terminalIds: readonly string[]): PanelTabs {
  const remembered = saved ?? EMPTY_PANEL
  const live = new Set(terminalIds)
  const pinned = remembered.pinned.filter((id) => live.has(id))
  const kept = remembered.tabs.filter((tab) => tab.kind !== 'terminal' || (live.has(tab.id) && !pinned.includes(tab.id)))
  const placed = new Set([...pinned, ...kept.map((tab) => tab.id)])
  const tabs = [...kept, ...terminalIds.filter((id) => !placed.has(id)).map((id) => tabOf('terminal', id))]
  const active = tabs.some((tab) => tab.id === remembered.active) ? remembered.active : tabs.at(-1)?.id ?? null
  return { tabs, active, pinned }
}

function isKind(value: unknown): value is SurfaceKind {
  return SURFACE_KINDS.some((kind) => kind === value)
}

function isTab(value: unknown): value is PanelTab {
  if (typeof value !== 'object' || value === null) return false
  const tab = value as Record<string, unknown>
  return isKind(tab.kind) && typeof tab.id === 'string'
}

/**
 * The tabs in a stored value, or null when it is not one. A tab of a kind this version does not know is left out, so a
 * value saved by a newer version still opens.
 */
export function panelTabsOf(value: unknown): PanelTabs | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Record<string, unknown>
  if (!Array.isArray(stored.tabs)) return null
  const tabs = stored.tabs.filter(isTab)
  const pinned = Array.isArray(stored.pinned) ? stored.pinned.filter((id): id is string => typeof id === 'string') : []
  const active = typeof stored.active === 'string' && tabs.some((tab) => tab.id === stored.active) ? stored.active : tabs.at(-1)?.id ?? null
  return { tabs, active, pinned }
}
