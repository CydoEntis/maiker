import { useSyncExternalStore } from 'react'
import type { MachineHead } from '../model/machines'
import type { SessionView } from '../model/session'
import { HoverController } from '../model/hoverController'
import { RowHoverCard } from './RowHoverCard'
import { helperLinks } from '../model/helpers'

/** The only part of the sidebar that follows the hover: it draws the card the controller says, and nothing else. */
export function RowHoverHost({ controller, sessions, namesMachine, machines = [], portalContainer }: { controller: HoverController; sessions: readonly SessionView[]; namesMachine: boolean; /** The machines as the sidebar heads them, so a session's card can say how its own is reached and whether it is up. */ machines?: readonly MachineHead[]; portalContainer: HTMLElement | null }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const session = state.target === null ? undefined : sessions.find((candidate) => candidate.id === state.target?.id)
  if (state.target === null || session === undefined) return null
  const links = helperLinks(sessions)
  return <RowHoverCard session={session} namesMachine={namesMachine} machine={session.machineName === null ? null : machines.find((head) => head.name === session.machineName) ?? null} starter={links.starterOf.get(session.id) ?? null} helpers={links.helpersOf.get(session.id) ?? null} place={state.target.place} open={state.open} cold={state.cold} portalContainer={portalContainer} />
}
