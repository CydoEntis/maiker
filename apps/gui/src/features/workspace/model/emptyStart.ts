import { CHAT_AGENTS, type ChatAgent } from './chatView'
import { machineTitle, type MachineHead } from './machines'
import { sameProject, type MachineProjects, type OpenedProject } from './openedProjects'
import { listedProjects } from './sidebarTree'

/** A project the empty state can start an agent in. */
export type StartPlace = {
  /** What the picker calls it: the project's name, with its machine when that is not this computer. Unique in the list. */
  readonly label: string
  readonly name: string
  readonly project: OpenedProject
  readonly machine: number
  readonly remote: boolean
  /** Its machine cannot be reached now, so nothing starts there. */
  readonly down: boolean
}

function placeOf(head: MachineHead, project: OpenedProject, name: string): StartPlace {
  const remote = head.name !== null
  return { label: remote ? `${name} · ${machineTitle(head)}` : name, name, project, machine: head.machine, remote, down: head.down }
}

/**
 * Every opened project as a place to start in, in the sidebar's order. Two projects that would read the same (two
 * folders with one name) are told apart by their folder.
 */
export function startPlaces(heads: readonly MachineHead[], machines: readonly MachineProjects[]): StartPlace[] {
  const places = listedProjects(heads, machines).map(({ head, entry, name }) => placeOf(head, entry.project, name))
  const times = new Map<string, number>()
  for (const place of places) times.set(place.label, (times.get(place.label) ?? 0) + 1)
  return places.map((place) => ((times.get(place.label) ?? 0) > 1 ? { ...place, label: `${place.label} (${place.project.folder})` } : place))
}

/**
 * The place the picker shows: the one picked on this screen while it is still listed, else the project last opened or
 * selected in the sidebar, else the one opened most recently (`opened` is in the order projects were opened). Null with
 * no project open.
 */
export function pickedPlace(places: readonly StartPlace[], picked: OpenedProject | null, selected: OpenedProject | null, opened: readonly OpenedProject[]): StartPlace | null {
  const newestFirst = [...opened].reverse()
  for (const candidate of [picked, selected, ...newestFirst]) {
    if (candidate === null) continue
    const place = places.find((each) => sameProject(each.project, candidate))
    if (place !== undefined) return place
  }
  return places[0] ?? null
}

/**
 * Whether `agent` can be started where `installed` was read. Only this computer's programs are known: another machine's
 * are not read here, and before the first read nothing is ruled out, so every agent is offered in both cases.
 */
export function agentIsOffered(agent: ChatAgent, installed: readonly string[] | null, remote: boolean): boolean {
  return remote || installed === null || installed.includes(agent)
}

/** The agents the empty state lists for a place, in the order their number keys follow: the first is `1`. */
export function agentsToStart(installed: readonly string[] | null, remote: boolean): ChatAgent[] {
  return CHAT_AGENTS.filter((agent) => agentIsOffered(agent, installed, remote))
}

/** What is known of a key press when the empty state decides whether it is a number picking an agent. */
export type DigitPress = {
  readonly key: string
  /** Ctrl, Alt or the command key is held: the press belongs to a shortcut. */
  readonly modified: boolean
  /** The press went to a text field or a terminal, which types the digit. */
  readonly typing: boolean
  /** A dialog, a menu or the palette is open over the screen. */
  readonly covered: boolean
}

/**
 * The agent a plain number key starts, null when the press is not one: a digit with no agent at that number, a key held
 * with a modifier, one typed into a field, or one pressed while something is open over the screen.
 */
export function agentForDigit(press: DigitPress, agents: readonly ChatAgent[]): ChatAgent | null {
  if (press.modified || press.typing || press.covered) return null
  if (!/^[1-9]$/.test(press.key)) return null
  return agents[Number(press.key) - 1] ?? null
}
