import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { importTicketLinks, loadTicketLinks, NO_LINK, saveTicketLink, saveTicketName, unlinkTicketProject, type LinkedProject, type ProjectLink, type TicketLinksAnswer, type TicketPlace } from '@/api/ticketLinks'
import type { KeyedProvider, TicketsResult } from '@/api/tickets'
import type { TicketsProject } from './ticketProjects'

export { NO_LINK, type ProjectLink }

/**
 * Which sources each project reads, as this computer's daemon keeps them (`api/ticketLinks.ts`): a link is set once
 * per project (and so for every worktree of it), and every window shows that project the same tickets. The window
 * keeps nothing but the query cache.
 */

const LINKS_QUERY = ['tickets', 'links'] as const

/** Where the daemon finds a project: its machine's name (null for this computer) and its folder. */
export function placeOf(project: Pick<TicketsProject, 'machineName' | 'folder'>): TicketPlace {
  return { machine: project.machineName, folder: project.folder }
}

/** Where the window kept links before the daemon kept them. */
const OLD_STORAGE_KEY = 'maitty.gui.ticketLinks.v1'
const OldPickSchema = z.object({ id: z.string(), name: z.string() })
const OldStoreSchema = z.object({
  projects: z.record(z.string(), z.object({ github: z.string().nullable().default(null), plane: OldPickSchema.nullable().default(null), linear: OldPickSchema.nullable().default(null) })).default({}),
  me: z.object({ plane: z.string().default(''), linear: z.string().default('') }).default({ plane: '', linear: '' }),
})
/** The old key was `<machine number>:<folder>`; this computer was 0. Another machine's number changed from run to run. */
const THIS_COMPUTER_PREFIX = '0:'

function oldLinks(): { projects: LinkedProject[]; me: { plane: string; linear: string } } | null {
  try {
    const stored = localStorage.getItem(OLD_STORAGE_KEY)
    if (stored === null) return null
    const parsed = OldStoreSchema.safeParse(JSON.parse(stored))
    if (!parsed.success) return { projects: [], me: { plane: '', linear: '' } }
    const projects = Object.entries(parsed.data.projects)
      .filter(([key]) => key.startsWith(THIS_COMPUTER_PREFIX))
      .map(([key, link]) => ({ machine: null, folder: key.slice(THIS_COMPUTER_PREFIX.length), link }))
    return { projects, me: parsed.data.me }
  } catch {
    // Unreadable storage holds nothing to bring over.
    return null
  }
}

let moved: Promise<void> | null = null

/**
 * Hands the daemon the links this window kept in its own storage before protocol 108, once: the daemon adds only what
 * it has not got, so another window that already moved its own wins. The old copy is dropped once the daemon has it.
 */
function moveOldLinksOnce(): Promise<void> {
  moved ??= (async () => {
    const old = oldLinks()
    if (old === null) return
    const nothing = old.projects.length === 0 && old.me.plane === '' && old.me.linear === ''
    const told = nothing ? { ok: true } : await importTicketLinks(old.projects, old.me)
    if (!told.ok) {
      moved = null
      return
    }
    try {
      localStorage.removeItem(OLD_STORAGE_KEY)
    } catch {
      // Kept: the next start moves it again, which the daemon adds nothing twice from.
    }
  })().catch(() => { moved = null })
  return moved
}

async function read(place: TicketPlace | null): Promise<TicketLinksAnswer> {
  await moveOldLinksOnce()
  const told = await loadTicketLinks(place)
  if (!told.ok) throw new Error(told.failure.kind === 'invalid' || told.failure.kind === 'unreachable' ? told.failure.line : 'The Maiker service could not read the ticket links')
  return told.value
}

/** The project `project` is (its root, what it reads) with every linked project and your names; null lists only. */
export function useTicketLinks(project: Pick<TicketsProject, 'machineName' | 'folder'> | null) {
  const place = project === null ? null : placeOf(project)
  return useQuery({ queryKey: [...LINKS_QUERY, place?.machine ?? null, place?.folder ?? null], queryFn: () => read(place), retry: false, staleTime: 30_000 })
}

/** What a project reads, or nothing linked while it is read or when it can't be. */
export function linkOf(answer: TicketLinksAnswer | undefined): ProjectLink {
  return answer?.project?.link ?? NO_LINK
}

/** Changes to the daemon's links; each reads every project's links again once it is answered. */
export function useLinkChanges() {
  const client = useQueryClient()
  const after = useCallback(async (work: Promise<TicketsResult<TicketLinksAnswer>>): Promise<TicketsResult<TicketLinksAnswer>> => {
    const told = await work
    if (told.ok) await client.invalidateQueries({ queryKey: LINKS_QUERY })
    return told
  }, [client])
  const save = useCallback((place: TicketPlace, link: ProjectLink) => after(saveTicketLink(place, link)), [after])
  const unlink = useCallback((place: TicketPlace) => after(unlinkTicketProject(place)), [after])
  const saveName = useCallback((provider: KeyedProvider, name: string) => after(saveTicketName(provider, name)), [after])
  return { save, unlink, saveName }
}

/** For tests: forget that the old links were moved, so the next read moves them again. */
export function resetTicketLinksForTest(): void {
  moved = null
}
