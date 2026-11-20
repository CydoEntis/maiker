import { createContext, useContext } from 'react'

export type PlaceProject = { name: string; folder: string }

/** What the folder menu under the message box can do beyond the session's own folder: the window brings these. */
export type PlaceActions = {
  /** The projects the menu offers a new session in. */
  projects: readonly PlaceProject[]
  onNewSessionIn: (folder: string) => void
  /** Opens the Open a project dialog on its folder tab. */
  onOpenFolder: () => void
  /** Opens the Open a project dialog on Clone from URL. */
  onClone: () => void
}

const NOTHING: PlaceActions = {
  projects: [],
  onNewSessionIn: () => undefined,
  onOpenFolder: () => undefined,
  onClone: () => undefined,
}

/** The window provides it once; the row under the box reads it, so no prop crosses the chat's layers. */
export const PlaceActionsContext = createContext<PlaceActions>(NOTHING)

export function usePlaceActions(): PlaceActions {
  return useContext(PlaceActionsContext)
}
