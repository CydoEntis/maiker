import { createContext, useContext } from 'react'

/** Which tab of the Open a project dialog to land on. */
export type OpenProjectTab = 'clone' | 'folder'

export type PlaceProject = { name: string; folder: string }

/** What the folder menu under the message box can do beyond the session's own folder: the window brings these. */
export type PlaceActions = {
  /** The projects the menu offers a new session in. */
  projects: readonly PlaceProject[]
  onNewSessionIn: (folder: string) => void
  onOpenProject: (tab: OpenProjectTab) => void
}

const NOTHING: PlaceActions = {
  projects: [],
  onNewSessionIn: () => undefined,
  // shortcut: until the Open a project dialog is wired in at the window, the two entries do nothing.
  onOpenProject: () => undefined,
}

/** The window provides it once; the row under the box reads it, so no prop crosses the chat's layers. */
export const PlaceActionsContext = createContext<PlaceActions>(NOTHING)

export function usePlaceActions(): PlaceActions {
  return useContext(PlaceActionsContext)
}
