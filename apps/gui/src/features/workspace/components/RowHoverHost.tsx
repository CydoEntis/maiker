import { useSyncExternalStore } from 'react'
import type { SessionView } from '../model/session'
import { HoverController } from '../model/hoverController'
import { RowHoverCard } from './RowHoverCard'
import { helperLinks } from '../model/helpers'

/** The only part of the sidebar that follows the hover: it draws the card the controller says, and nothing else. */
export function RowHoverHost({ controller, sessions, portalContainer }: { controller: HoverController; sessions: readonly SessionView[]; portalContainer: HTMLElement | null }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const session = state.target === null ? undefined : sessions.find((candidate) => candidate.id === state.target?.id)
  if (state.target === null || session === undefined) return null
  const links = helperLinks(sessions)
  return <RowHoverCard session={session} starter={links.starterOf.get(session.id) ?? null} helpers={links.helpersOf.get(session.id) ?? null} place={state.target.place} open={state.open} cold={state.cold} portalContainer={portalContainer} />
}
