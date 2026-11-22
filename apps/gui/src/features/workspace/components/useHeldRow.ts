import { useState } from 'react'
import type { SessionView } from '../model/session'
import { sectionOf } from '../model/sidebar'
import type { HeldRow } from '../model/sidebarTree'

/**
 * The session on screen in the state it was picked in, which `sidebarOrder` places it by until another is picked: the
 * full sidebar and the rail both keep a row the person just opened where they found it.
 */
export function useHeldRow(focusedId: string | null, sessions: readonly SessionView[]): HeldRow | null {
  const [hold, setHold] = useState<{ for: string | null; row: HeldRow | null }>({ for: null, row: null })
  // Adjusted while rendering, as it follows from the selection: the row is held from the frame it is picked in.
  if (hold.for !== focusedId) {
    const focused = focusedId === null ? undefined : sessions.find((session) => session.id === focusedId)
    setHold({ for: focusedId, row: focused === undefined ? null : { id: focused.id, mark: sectionOf(focused) } })
  }
  return hold.row
}
