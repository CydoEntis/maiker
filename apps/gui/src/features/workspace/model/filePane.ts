import type { Arrangement } from './layout'

/**
 * Whether picking a file also hides the side panel. It does not: the panel floats over the right of the file pane and
 * the title bar's button hides it. One switch, so the other answer is one word away.
 */
export const PICKING_A_FILE_HIDES_THE_PANEL: boolean = false

/** The file the arrangement's file pane shows for `sessionId`, or null: a pane out of sight behind a maximised one shows nothing. */
export function openFileOf(shown: Arrangement | undefined, sessionId: string | undefined): string | null {
  const pane = shown?.panes.find((candidate) => candidate.doc !== undefined && candidate.sessionId === sessionId)
  if (shown === undefined || pane?.doc === undefined) return null
  return shown.max === null || shown.max === pane.id ? pane.doc.path : null
}

/** The id of the arrangement's file pane when it shows `path` of `sessionId`'s checkout, or null. */
export function filePaneShowing(shown: Arrangement | undefined, sessionId: string, path: string): string | null {
  return shown?.panes.find((pane) => pane.sessionId === sessionId && pane.doc?.path === path)?.id ?? null
}

/** Where the side panel sits: a card of its own beside the main pane, or a float over the pane beside it. */
export type PanelPlacement = 'docked' | 'floating'

/**
 * With a file open the panel floats over the file pane instead of taking room from it, so the chat is never squeezed
 * by both; in a narrow window there is no room beside the pane either way.
 */
export function panelPlacement(fileOpen: boolean, narrow: boolean): PanelPlacement {
  return fileOpen || narrow ? 'floating' : 'docked'
}
