import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { githubRepoOf, loadTicket, loadTicketKeys, type TicketDetail, type TicketFailure, type TicketKeyState } from '@/api/tickets'
import { LOCAL_MACHINE } from '@/api/machines'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Icon } from '@/features/workspace/components/glyphs'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { linkOf, placeOf, useTicketLinks, type ProjectLink } from './model/ticketLinks'
import { TicketSetup } from './TicketSetup'
import { parseTicketLink } from './model/pastedLink'
import type { SetupAsk } from './useTicketSetupAsks'
import { groupsUnder, kindWord, matchesSearch, openBlockers, PROVIDER_LOOK, PROVIDERS, ticketKey, type Provider } from './model/tickets'
import { failureOf, ticketsOf, TICKETS_REFRESH_MS, useTicketGroups, useTicketList } from './useTicketData'
import { TicketRow, TicketSkeleton } from './TicketRows'
import { StartTicketDialog, type StartChoice } from './TicketDialogs'
import type { TicketsProject } from './model/ticketProjects'
import './tickets.css'

/** The scope menu's value for the whole source; group ids are never empty. */
const ALL_SCOPE = ''

/** What the page asks of the window around it. */
export type TicketsHost = {
  /** The themed window root, where dialogs mount. */
  container: HTMLElement | null
  defaultAgent: ChatAgent
  onClose: () => void
  onSettings: () => void
  onSignInGitHub: () => void
  onStart: (ticket: TicketDetail, choice: StartChoice) => Promise<void>
}

/** How long the search waits after the last key before it asks the provider. */
const SEARCH_WAIT_MS = 300
const MINUTE_MS = 60_000

/** Where a provider's tickets come from for a project, or why there are none. */
type Source =
  | { linked: true; source: string; top: string | null; topName: string }
  | { linked: false; why: 'unlinked' | 'no-key' }

function sourceFor(provider: Provider, link: ProjectLink, detectedRepo: string | null, keys: readonly TicketKeyState[] | undefined): Source {
  if (provider === 'github') {
    const repo = link.github ?? detectedRepo
    return repo === null || repo === '' ? { linked: false, why: 'unlinked' } : { linked: true, source: repo, top: null, topName: repo }
  }
  const picked = provider === 'plane' ? link.plane : link.linear
  const keyed = keys?.find((key) => key.provider.toLowerCase() === provider)?.set ?? false
  if (!keyed) return { linked: false, why: 'no-key' }
  if (picked === null) return { linked: false, why: 'unlinked' }
  return { linked: true, source: provider, top: picked.id, topName: picked.name }
}

/** Minutes since `at`, said as a person would. */
function minutesAgo(at: number, now: number): string {
  const minutes = Math.max(1, Math.round((now - at) / MINUTE_MS))
  return `${String(minutes)} min ago`
}

type Banner = { tone: 'plain' | 'danger'; glyph: string; title: string; sub: string; button: { label: string; run: () => void } | null }

function bannerFor(provider: Provider, failure: TicketFailure | null, hasData: boolean, readAt: number, retryAt: number, now: number, actions: { retry: () => void; signIn: () => void; settings: () => void }): Banner | null {
  if (failure === null) return null
  const name = PROVIDER_LOOK[provider].name
  if (failure.kind === 'signed-out' && provider === 'github') {
    return { tone: 'plain', glyph: '○', title: 'GitHub: not signed in', sub: 'Maitty uses your gh login. Run gh auth login in a terminal, then refresh.', button: { label: 'Open terminal', run: actions.signIn } }
  }
  if (failure.kind === 'signed-out') {
    return { tone: 'danger', glyph: '✕', title: `${name} refused the key`, sub: `The key may have been revoked. ${name} tickets are hidden until you add a new one.`, button: { label: 'Replace key', run: actions.settings } }
  }
  if (failure.kind === 'rate-limited') {
    const at = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return { tone: 'plain', glyph: '■', title: `${name} rate limit reached`, sub: hasData ? `${name} tickets are from ${minutesAgo(readAt, now)}. Maitty refreshes them at ${at}.` : `Maitty asks again at ${at}.`, button: null }
  }
  if (failure.kind === 'unreachable') {
    return hasData
      ? { tone: 'plain', glyph: '○', title: 'Offline', sub: `Showing tickets from ${minutesAgo(readAt, now)}. Starting an agent still works from these copies.`, button: { label: 'Retry', run: actions.retry } }
      : { tone: 'plain', glyph: '○', title: `Can't reach ${name}`, sub: failure.line, button: { label: 'Retry', run: actions.retry } }
  }
  if (failure.kind === 'no-key') return null
  const sub = failure.kind === 'not-found' ? `${name} has no such project, or this key cannot see it.` : failure.line
  return { tone: 'danger', glyph: '✕', title: `Couldn't read ${name}`, sub, button: { label: 'Retry', run: actions.retry } }
}

/** The tab a suggested link belongs on, or none when it names no source. */
function suggestedProvider(link: string | undefined): Provider | null {
  if (link === undefined) return null
  const read = parseTicketLink(link)
  return read.ok ? read.link.kind : null
}

/**
 * Tickets, over the whole chat area: a picker that starts an agent on one of the current chat's project's tickets from
 * GitHub, Plane or Linear. A tab per provider ("Not linked" when the project has none), a search and a scope, and the
 * open tickets; picking one reads it whole and opens the dialog that shows exactly what the agent is sent. It only reads
 * tickets: Maitty is not a tracker, so they are browsed and changed in the tracker itself. Ticket text is other people's
 * and is shown as plain text everywhere.
 */
export function TicketsPage({ project, host, leaving = false, suggestedLink, setupAsk = null }: {
  project: TicketsProject
  host: TicketsHost
  leaving?: boolean
  /** A link to start the setup's paste box with (see `TicketSetupProps.suggestedLink`); its source's tab opens first. */
  suggestedLink?: string | undefined
  /** An agent's ask to set up tickets (`<app>_tickets_setup`): its source opens and its link starts the paste box. */
  setupAsk?: SetupAsk | null
}) {
  const links = useTicketLinks(project)
  const link = linkOf(links.data)
  // The project the daemon took the folder to (a worktree's main checkout), where a link is kept.
  const setupProject = { name: project.name, place: links.data?.project ?? placeOf(project) }
  const keys = useQuery({ queryKey: ['tickets', 'keys'], queryFn: async () => { const told = await loadTicketKeys(); return told.ok ? told.value : [] }, retry: false })
  const detected = useQuery({
    queryKey: ['tickets', 'origin', project.machine, project.folder],
    queryFn: () => githubRepoOf(project.folder),
    enabled: project.machine === LOCAL_MACHINE && link.github === null,
    retry: false,
    staleTime: Infinity,
  })
  const sources = useMemo(() => {
    const all = {} as Record<Provider, Source>
    for (const provider of PROVIDERS) all[provider] = sourceFor(provider, link, detected.data ?? null, keys.data)
    return all
  }, [link, detected.data, keys.data])
  const firstLinked = PROVIDERS.find((provider) => sources[provider].linked) ?? 'github'
  const [picked, setPicked] = useState<Provider | null>(() => setupAsk?.source ?? suggestedProvider(setupAsk?.link || suggestedLink))
  // An agent's ask opens the source it named; a later ask moves to its source too.
  const [askSeen, setAskSeen] = useState(setupAsk)
  if (setupAsk !== askSeen) {
    setAskSeen(setupAsk)
    const next = setupAsk?.source ?? suggestedProvider(setupAsk?.link)
    if (next != null) setPicked(next)
  }
  const provider = picked ?? firstLinked
  const current = sources[provider]
  const source = current.linked ? current.source : null
  const top = current.linked ? current.top : null

  const [scope, setScope] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [focused, setFocused] = useState<string | null>(null)
  // The ticket being started: read whole first, since the message quotes its description. The dialog shows once it is.
  const [starting, setStarting] = useState<string | null>(null)
  const [dialogTicket, setDialogTicket] = useState<TicketDetail | null>(null)
  const client = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(typed) }, SEARCH_WAIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [typed])
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, MINUTE_MS)
    return () => { window.clearInterval(timer) }
  }, [])
  useEffect(() => { rootRef.current?.focus() }, [])

  const switchProvider = (next: Provider) => {
    setPicked(next)
    setScope(null)
    stopStarting()
  }

  const groups = useTicketGroups(source)
  const listGroup = provider === 'github' ? (scope === null || scope === `github:${source ?? ''}` ? null : scope) : scope ?? top
  const list = useTicketList(source, listGroup, search, provider === 'plane')
  const tickets = useMemo(() => ticketsOf(list.data?.pages), [list.data])
  const known = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets])

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  // The list reads its next page when its end scrolls into sight.
  useEffect(() => {
    const end = endRef.current
    if (end === null || !hasNextPage) return
    const watch = new IntersectionObserver((seen) => { if (seen.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage() })
    watch.observe(end)
    return () => { watch.disconnect() }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, tickets.length])

  const pick = (id: string) => {
    if (source === null || starting !== null) return
    setFocused(id)
    setStarting(id)
    client.query({
      queryKey: ['tickets', 'detail', source, id],
      queryFn: async () => { const told = await loadTicket(source, id); if (!told.ok) throw new Error(told.failure.kind); return told.value },
      staleTime: TICKETS_REFRESH_MS,
    }).then(setDialogTicket, (error: unknown) => {
      toast.error(errorMessage(error, "Couldn't read the whole ticket"))
      setStarting(null)
    })
  }
  const stopStarting = () => { setStarting(null); setDialogTicket(null) }

  // Closed tickets are done: there is nothing to start on them.
  const rows = useMemo(() => tickets.filter((ticket) => ticket.category !== 'Closed' && matchesSearch(ticket, typed)), [tickets, typed])

  const allGroups = groups.data ?? []
  const topGroup = allGroups.find((group) => group.kind === 'Project' && (top === null || group.id === top)) ?? null
  const children = groupsUnder(allGroups, topGroup?.id ?? top)
  const scopeItems: ReadonlyArray<{ id: string | null; name: string; kind: string; depth: number }> = [
    { id: null, name: provider === 'github' ? 'All issues' : 'All tickets', kind: '', depth: 0 },
    ...(topGroup === null ? [] : [{ id: topGroup.id, name: topGroup.name, kind: kindWord(provider, 'Project'), depth: 0 }]),
    ...children.map((group) => ({ id: group.id, name: group.name, kind: kindWord(provider, group.kind), depth: 1 })),
  ]
  const scopeName = scope === null ? (provider === 'github' ? 'All issues' : 'All tickets') : allGroups.find((group) => group.id === scope)?.name ?? 'This group'
  const scopeKind = scope === null ? '' : kindWord(provider, allGroups.find((group) => group.id === scope)?.kind ?? 'Module')

  const failure = failureOf(list.error) ?? failureOf(groups.error)
  const banner = bannerFor(provider, failure, tickets.length > 0, list.dataUpdatedAt, list.errorUpdatedAt + TICKETS_REFRESH_MS, now, {
    retry: () => { void list.refetch(); void groups.refetch() },
    signIn: host.onSignInGitHub,
    settings: host.onSettings,
  })
  const keyRefused = failure?.kind === 'signed-out'
  const shownTickets = keyRefused ? [] : rows

  const openCount = (each: Provider): string => (sources[each].linked ? '' : 'Not linked')

  const onKeyDown = (event: KeyboardEvent) => {
    if (starting !== null) return
    const tag = (event.target as HTMLElement).tagName.toLowerCase()
    const typing = tag === 'input' || tag === 'textarea'
    if (event.key === 'Escape') {
      if (typing && typed !== '') { setTyped(''); event.preventDefault() }
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const order = shownTickets.map((ticket) => ticket.id)
      const at = focused === null ? -1 : order.indexOf(focused)
      const next = order[Math.min(order.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next !== undefined) {
        setFocused(next)
        rootRef.current?.querySelector(`[data-ticket="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      return
    }
    if (event.key === 'Enter' && focused !== null) { event.preventDefault(); pick(focused); return }
    if (typing) return
    if (event.key === '/') { event.preventDefault(); searchRef.current?.focus() }
  }

  // Until the links and the folder's origin are read, a source that is not set up yet is not said to be.
  const settling = links.isPending || keys.isPending || (provider === 'github' && link.github === null && project.machine === LOCAL_MACHINE && detected.isPending)
  const look = PROVIDER_LOOK[provider]
  const dialogBlockers = dialogTicket === null ? [] : openBlockers(dialogTicket, known)
  const blockerKeys = dialogBlockers.map((id) => ticketKey(known.get(id) ?? { id, url: '' }))
  const firstBlocker = dialogBlockers[0] === undefined ? undefined : known.get(dialogBlockers[0])

  return (
    <div ref={rootRef} className={`mx-tk${leaving ? ' is-leaving' : ''}`} data-label="Tickets page" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mx-tk-head">
        <span className="mx-tk-head-title">Start from a ticket</span>
        <span className="mx-tk-head-project"><span className="mx-tk-project-dot" aria-hidden="true" /><span>{project.name}</span></span>
        <span className="mx-spacer" />
        <button type="button" className="mx-tk-x" aria-label="Close" title="Back to the chat" onClick={host.onClose}>✕</button>
      </div>
      <div className="mx-tk-bar-wrap">
        <div role="tablist" aria-label="Source" className="mx-tk-tabs">
          {PROVIDERS.map((each) => {
            const on = each === provider
            const each_ = PROVIDER_LOOK[each]
            return (
              <button key={each} type="button" role="tab" aria-selected={on} className={`mx-tk-tab${on ? ' is-on' : ''}`} onClick={() => { switchProvider(each) }}>
                <span className="mx-tk-tab-mark" style={{ color: each_.color }}>{each_.mark}</span><span className="mx-tk-tab-name" data-text={each_.name}>{each_.name}</span><span className={`mx-tk-tab-n${sources[each].linked ? '' : ' is-unlinked'}`}>{openCount(each)}</span>
              </button>
            )
          })}
        </div>
        {current.linked && (
          <div className="mx-tk-toolbar">
            <label className="mx-tk-search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
              <input ref={searchRef} value={typed} onChange={(event) => { setTyped(event.target.value) }} placeholder="Search tickets" aria-label="Search tickets" />
              <kbd>/</kbd>
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="mx-tk-scope-button" aria-label={`Scope: ${scopeName}`}>
                  <span className="mx-tk-scope-name">{scopeName}</span><span className="mx-tk-dim">{scopeKind}</span><span className="mx-spacer" /><Icon name="chevronDown" size={10} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="bottom" align="start" container={host.container} aria-label="Scope" className="mx-tk-menu text-fg">
                <DropdownMenuRadioGroup value={scope ?? ALL_SCOPE} onValueChange={(value) => { const id = value === ALL_SCOPE ? null : value; setScope(provider === 'github' && id === topGroup?.id ? null : id) }}>
                  {scopeItems.map((item) => (
                    <DropdownMenuRadioItem key={item.id ?? ALL_SCOPE} value={item.id ?? ALL_SCOPE} className={`mx-tk-menu-item${item.depth > 0 ? ' is-child' : ''}`}>
                      <span className="mx-tk-menu-name">{item.name}</span><span className="mx-tk-dim">{item.kind}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" className="mx-tk-icon" aria-label="Refresh" title="Refresh" onClick={() => { void list.refetch(); void groups.refetch() }}>
              <span className={list.isFetching ? 'mx-tk-turning' : undefined}><Icon name="refresh" size={13} /></span>
            </button>
          </div>
        )}
      </div>
      {!current.linked && settling ? (
        <TicketSkeleton source={look.name} />
      ) : !current.linked ? (
        <TicketSetup key={setupAsk?.link ?? ''} provider={provider} project={setupProject} link={link} keys={keys.data} suggestedLink={setupAsk?.link || suggestedLink} />
      ) : (
        <>
          {banner !== null && (
            <div role="status" className={`mx-tk-banner${banner.tone === 'danger' ? ' is-danger' : ''}`}>
              <span className={`mx-tk-banner-glyph${banner.tone === 'danger' ? ' mx-tk-danger' : ''}`}>{banner.glyph}</span>
              <span className="mx-tk-banner-words"><b>{banner.title}</b><span>{banner.sub}</span></span>
              {banner.button !== null && <button type="button" className="mx-tk-button" onClick={banner.button.run}>{banner.button.label}</button>}
            </div>
          )}
          <div className="mx-tk-list" role="list" aria-label="Tickets">
            {list.isPending && <TicketSkeleton source={look.name} />}
            {!list.isPending && shownTickets.length === 0 && !keyRefused && (failure === null || tickets.length > 0) && (
              <div className="mx-tk-empty">
                <span className="mx-tk-empty-title">No tickets match</span>
                <span className="mx-tk-dim">{typed !== '' ? `Nothing open matches "${typed}" in ${scopeName}.` : `Nothing open in ${scopeName}.`}</span>
                {(typed !== '' || scope !== null) && <button type="button" className="mx-tk-button" onClick={() => { setTyped(''); setSearch(''); setScope(null) }}>Clear filters</button>}
              </div>
            )}
            {shownTickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} focused={focused === ticket.id} starting={starting === ticket.id} now={now} onStart={pick} />)}
            <div ref={endRef} />
            {hasNextPage && <TicketSkeleton source={look.name} rows={2} />}
          </div>
        </>
      )}
      {dialogTicket !== null && (
        <StartTicketDialog
          container={host.container}
          provider={provider}
          ticket={dialogTicket}
          blockers={blockerKeys}
          blockerState={firstBlocker?.category === 'Started' ? 'in progress' : firstBlocker?.category === 'Open' ? 'open' : 'not done'}
          defaultAgent={host.defaultAgent}
          folder={project.folder}
          project={project.name}
          machineName={project.machineName}
          onCancel={stopStarting}
          onGo={(choice) => {
            const ticket = dialogTicket
            stopStarting()
            void host.onStart(ticket, choice).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not start the agent')) })
          }}
        />
      )}
    </div>
  )
}
