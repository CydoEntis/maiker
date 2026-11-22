import type { ChatAgent } from '@/features/workspace/model/chatView'
import { modeLabel, modeShortLabel, START_MODE } from './chatMeta'
import { AGENT_LABEL } from './modelName'

/**
 * The words beside the chat box's shield. The mode an agent starts in needs none: the shield alone stands for it, so
 * the row only speaks up when the session was moved off it. A mode the agent has not said yet shows no words either.
 */
export function permissionWords(agent: ChatAgent, modeKey: string | null | undefined, label: string | null): string | null {
  if (label === null) return null
  const usual = modeKey == null ? label === modeLabel(START_MODE[agent]) : modeKey === START_MODE[agent]
  return usual ? null : modeShortLabel(label)
}

/** Why the model and reasoning level cannot be changed while the agent works; null when it is not working. */
export function workingLock(agent: ChatAgent, working: boolean): string | null {
  return working ? `You can change this when ${AGENT_LABEL[agent]} finishes, or after you stop it (Esc).` : null
}

/**
 * Whether the folder, branch and sync chips sit under the chat box: only for a session that has run nothing yet (a
 * draft is one), where they still choose or change where the work happens. Once it has run, the place is fixed and is
 * said by the pane header and the sidebar's hover card instead.
 */
export function placeChipsShown(place: { readonly picking?: unknown } | undefined, ran: boolean): boolean {
  if (place === undefined) return false
  return place.picking !== undefined || !ran
}
