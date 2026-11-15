import { useSyncExternalStore } from 'react'
import { z } from 'zod'

/**
 * Which ticket sources each project reads, kept by this window (its own storage, like the panel widths): a project
 * is linked once, in Settings › Tickets, and Tickets then shows only that project's tickets. Nothing here is a
 * secret: a repository name and the ids of a Plane project and a Linear team. The keys stay with the daemon.
 */

/** The longest values kept: a group id, a name, and GitHub's `owner/name` (39 + 1 + 100). */
const MOST_ID_CHARS = 200
const MOST_NAME_CHARS = 100
const MOST_REPO_CHARS = 140

/** A linked group: its id (`plane:<project>`, `linear:team.<id>`) and the name it was picked by. */
const PickedSchema = z.object({ id: z.string().max(MOST_ID_CHARS), name: z.string().max(MOST_NAME_CHARS) })
const LinkSchema = z.object({
  /** `owner/name`; null follows the folder's own `origin`, an empty string turns GitHub off for the project. */
  github: z.string().max(MOST_REPO_CHARS).nullable().default(null),
  plane: PickedSchema.nullable().default(null),
  linear: PickedSchema.nullable().default(null),
})
const StoreSchema = z.object({
  projects: z.record(z.string(), LinkSchema).default({}),
  /** The name you are known by in Plane and Linear, for Mine. GitHub's is the signed-in login. */
  me: z.object({ plane: z.string().max(MOST_NAME_CHARS).default(''), linear: z.string().max(MOST_NAME_CHARS).default('') }).default({ plane: '', linear: '' }),
})

export type ProjectLink = z.infer<typeof LinkSchema>
export type TicketLinks = z.infer<typeof StoreSchema>

const STORAGE_KEY = 'maitty.gui.ticketLinks.v1'
const EMPTY: TicketLinks = { projects: {}, me: { plane: '', linear: '' } }
export const NO_LINK: ProjectLink = { github: null, plane: null, linear: null }

/** The key a project's links are kept under: the machine it is on and its folder. */
export function projectLinkKey(machine: number, folder: string): string {
  return `${String(machine)}:${folder}`
}

function read(): TicketLinks {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return EMPTY
    const parsed = StoreSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data : EMPTY
  } catch {
    // Storage can be unreadable (a private profile, a broken value): nothing is linked then, and Settings can link again.
    return EMPTY
  }
}

let current: TicketLinks | null = null
const listeners = new Set<() => void>()

function snapshot(): TicketLinks {
  current ??= read()
  return current
}

function write(next: TicketLinks): void {
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // The links still hold for this run of the window; they are lost at the next start, which Settings shows.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Every project's links and your names, kept current as Settings changes them. */
export function useTicketLinks(): TicketLinks {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function linkOf(links: TicketLinks, key: string): ProjectLink {
  return links.projects[key] ?? NO_LINK
}

/** Changes one project's links; a field left out stays as it was. */
export function setProjectLink(key: string, change: Partial<ProjectLink>): void {
  const now = snapshot()
  write({ ...now, projects: { ...now.projects, [key]: { ...linkOf(now, key), ...change } } })
}

export function setMyName(provider: 'plane' | 'linear', name: string): void {
  const now = snapshot()
  write({ ...now, me: { ...now.me, [provider]: name.trim() } })
}

/** For tests: forget what was read, so the next read is from storage again. */
export function resetTicketLinksForTest(): void {
  current = null
}
