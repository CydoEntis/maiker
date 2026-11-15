import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { loadTicket, loadTicketGroups, loadTicketPage, TICKETS_PAGE_MAX, type TicketFailure, type TicketsResult, type TicketSummary } from '@/api/tickets'

/** A read that could not be done, kept as the error of its query so the last good answer stays on screen. */
export class TicketReadError extends Error {
  readonly failure: TicketFailure
  constructor(failure: TicketFailure) {
    super(failure.kind)
    this.failure = failure
  }
}

/** The failure a query ended in, or null for one that did not fail (or failed some other way: a service that did not answer). */
export function failureOf(error: unknown): TicketFailure | null {
  if (error instanceof TicketReadError) return error.failure
  if (error instanceof Error) return { kind: 'unreachable', line: error.message }
  return null
}

function unwrap<T>(result: TicketsResult<T>): T {
  if (!result.ok) throw new TicketReadError(result.failure)
  return result.value
}

/** How often a shown list is read again on its own: the providers are asked, not watched. */
const REFRESH_MINUTES = 5
const MS_PER_MINUTE = 60_000
export const TICKETS_REFRESH_MS = REFRESH_MINUTES * MS_PER_MINUTE

/** The groups of a source, or nothing to ask while it is not linked. */
export function useTicketGroups(source: string | null) {
  return useQuery({
    queryKey: ['tickets', 'groups', source],
    queryFn: async () => unwrap(await loadTicketGroups(source ?? '')),
    enabled: source !== null,
    retry: false,
    staleTime: TICKETS_REFRESH_MS,
  })
}

/**
 * A source's tickets in a group (or all of it), every state, matching `search`: a page at a time, the next read as the
 * list is scrolled to its end, up to the pages the daemon allows. The window filters what was read by state and
 * assignee itself, so a filter changes nothing that has to be asked again.
 */
export function useTicketList(source: string | null, group: string | null, search: string, needsGroup: boolean) {
  const words = search.trim()
  return useInfiniteQuery({
    queryKey: ['tickets', 'list', source, group, words],
    queryFn: async ({ pageParam }) => unwrap(await loadTicketPage(source ?? '', { group, state: null, assignee: null, label: null, search: words === '' ? null : words, page: pageParam })),
    initialPageParam: 0,
    getNextPageParam: (last, _all, page) => (last.more && page < TICKETS_PAGE_MAX ? page + 1 : undefined),
    enabled: source !== null && (!needsGroup || group !== null),
    retry: false,
    staleTime: TICKETS_REFRESH_MS,
    refetchInterval: TICKETS_REFRESH_MS,
  })
}

/** One ticket whole, read when it is opened (or its blockers are wanted) and kept while the window runs. */
export function useTicketDetail(source: string | null, id: string | null) {
  return useQuery({
    queryKey: ['tickets', 'detail', source, id],
    queryFn: async () => unwrap(await loadTicket(source ?? '', id ?? '')),
    enabled: source !== null && id !== null,
    retry: false,
    staleTime: TICKETS_REFRESH_MS,
  })
}

/** Every ticket of the read pages, once each. */
export function ticketsOf(pages: ReadonlyArray<{ tickets: TicketSummary[] }> | undefined): TicketSummary[] {
  const seen = new Set<string>()
  const all: TicketSummary[] = []
  for (const page of pages ?? []) {
    for (const ticket of page.tickets) {
      if (seen.has(ticket.id)) continue
      seen.add(ticket.id)
      all.push(ticket)
    }
  }
  return all
}
