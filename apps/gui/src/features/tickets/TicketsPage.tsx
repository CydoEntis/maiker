import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { githubRepoOf, loadTicket, loadTicketKeys, writeTicket, type GroupKind, type TicketDetail, type TicketFailure, type TicketGroup, type TicketKeyState, type TicketSummary, type TicketWrite } from '@/api/tickets'
import { LOCAL_MACHINE } from '@/api/machines'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { Icon, type IconName } from '@/features/workspace/components/glyphs'
import { useReducedMotion } from '@/features/workspace/components/motion'
import { usePresence } from '@/lib/usePresence'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { linkOf, placeOf, useTicketLinks, type ProjectLink } from './model/ticketLinks'
import { TicketSetup } from './TicketSetup'
import type { SetupAsk } from './useTicketSetupAsks'
import { GROUP_VIEWS, groupCounts, groupsUnder, isMine, kindWord, matchesSearch, openBlockers, PROVIDER_LOOK, PROVIDERS, ticketKey, type KitchenRun, type Provider } from './model/tickets'
import { failureOf, ticketsOf, TICKETS_REFRESH_MS, useTicketDetail, useTicketGroups, useTicketList } from './useTicketData'
import { TicketBoard, TicketRow, TicketSkeleton, type RowState } from './TicketRows'
import { TicketGroups, type GroupLayout } from './TicketGroups'
import { TicketDrawer } from './TicketDrawer'
import { TicketWriteDialog } from './TicketWriteDialog'
import { writeFailureWords } from './model/ticketWrite'
import { KitchenDialog, StartTicketDialog, type KitchenTarget, type StartChoice } from './TicketDialogs'
import type { TicketsProject } from './model/ticketProjects'
import './tickets.css'

/** The scope menu's value for the whole source; group ids are never empty. */
const ALL_SCOPE = ''


/** What the page asks of the window around it. */
export type TicketsHost = {
  /** The themed window root, where dialogs mount. */
  container: HTMLElement | null
  defaultAgent: ChatAgent
  /** Who `gh` is signed in as on this computer, for Mine on GitHub; null when not known. */
  githubLogin: string | null
  /** The chats running Kitchen in this project. */
  kitchenChats: readonly KitchenTarget[]
  /** The Kitchen run a chat reports for a ticket key, if any. */
  runOf: (key: string) => KitchenRun | null
  /** There is a chat in front to send a ticket into. */
  canSendHere: boolean
  onClose: () => void
  onSettings: () => void
  onSignInGitHub: () => void
  onStart: (ticket: TicketDetail, choice: StartChoice) => Promise<void>
  onSendHere: (ticket: TicketDetail, text: string) => Promise<void>
  onSendKitchen: (target: string, tickets: readonly TicketSummary[]) => Promise<void>
  onOpenWork: (sessionId: string) => void
}

type View = 'list' | 'mine' | 'board' | GroupKind
type Dialog = { kind: 'start' | 'here' | 'comment' | 'close'; id: string } | { kind: 'kitchen'; ids: readonly string[] } | null

/** How long the ticket page takes to slide out (README §1: in .28s, out .19s). */
const DRAWER_EXIT_MS = 190
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

/**
 * A version that goes up whenever a whole ticket is read into the cache, so what is read from it on render stays
 * current. Only those: the cache also tells of every observer a render adds or updates, and following those would
 * draw the page again for ever.
 */
function useCacheVersion(): number {
  const client = useQueryClient()
  const cache = client.getQueryCache()
  const version = useRef(0)
  const subscribe = useCallback((changed: () => void) => cache.subscribe((event) => {
    const key = event.query.queryKey as readonly unknown[]
    if (event.type !== 'updated' || key[1] !== 'detail') return
    version.current += 1
    changed()
  }), [cache])
  return useSyncExternalStore(subscribe, () => version.current, () => version.current)
}

const VIEW_ICON: Readonly<Record<GroupKind, IconName>> = { Milestone: 'milestone', Module: 'modules', Cycle: 'cycle', Project: 'folder' }

/**
 * Tickets, over the whole chat area: the current chat's project's tickets from GitHub, Plane and Linear, read-only.
 * A tab per provider (always all three, "Not linked" when the project has none), a toolbar (search, scope, the views),
 * the list, the board or one kind of group, a selection bar, the ticket page, and the dialogs that start an agent or
 * hand tickets to Kitchen. Ticket text is other people's and is shown as plain text everywhere.
 */
export function TicketsPage({ project, host, leaving = false, setupAsk = null }: { project: TicketsProject; host: TicketsHost; leaving?: boolean; setupAsk?: SetupAsk | null }) {
  const links = useTicketLinks(project)
  const link = linkOf(links.data)
  // The project the daemon took the folder to (a worktree's main checkout), where a link is kept.
  const setupProject = { name: project.name, place: links.data?.project ?? placeOf(project) }
  const reduced = useReducedMotion()
  const client = useQueryClient()
  // Details are read from the cache as the page draws, so a change to the cache draws it again.
  useCacheVersion()
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
  const [picked, setPicked] = useState<Provider | null>(setupAsk?.source ?? null)
  // An agent's ask opens the source it named; a later ask moves to its source too.
  const [askSeen, setAskSeen] = useState(setupAsk)
  if (setupAsk !== askSeen) {
    setAskSeen(setupAsk)
    if (setupAsk?.source != null) setPicked(setupAsk.source)
  }
  const provider = picked ?? firstLinked
  const current = sources[provider]
  const source = current.linked ? current.source : null
  const top = current.linked ? current.top : null

  const [view, setView] = useState<View>('list')
  const [scope, setScope] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [layout, setLayout] = useState<GroupLayout>('grid')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [now, setNow] = useState(() => Date.now())
  const rootRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  // The ticket the page shows, kept while it slides out after closing.
  const [shownId, setShownId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(typed) }, SEARCH_WAIT_MS)
    return () => { window.clearTimeout(timer) }
  }, [typed])
  useEffect(() => {
    const MINUTE_MS = 60_000
    const timer = window.setInterval(() => { setNow(Date.now()) }, MINUTE_MS)
    return () => { window.clearInterval(timer) }
  }, [])
  useEffect(() => { rootRef.current?.focus() }, [])

  const switchProvider = (next: Provider) => {
    setPicked(next)
    setScope(null)
    setSelected(new Set())
    setOpenId(null)
    if (view !== 'list' && view !== 'mine' && view !== 'board') setView('list')
  }

  const groups = useTicketGroups(source)
  const listGroup = provider === 'github' ? (scope === null || scope === `github:${source ?? ''}` ? null : scope) : scope ?? top
  const list = useTicketList(source, listGroup, search, provider === 'plane')
  const tickets = useMemo(() => ticketsOf(list.data?.pages), [list.data])
  const known = useMemo(() => new Map(tickets.map((ticket) => [ticket.id, ticket])), [tickets])
  const isGroupView = view !== 'list' && view !== 'mine' && view !== 'board'
  const me = provider === 'github' ? host.githubLogin : provider === 'plane' ? links.data?.me.plane ?? '' : links.data?.me.linear ?? ''
  const meKnown = me !== null && me !== ''

  // A group view counts every ticket of the source, so it reads them all (up to the daemon's limit).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list
  useEffect(() => {
    if (isGroupView && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [isGroupView, hasNextPage, isFetchingNextPage, fetchNextPage])
  // The list reads its next page when its end scrolls into sight.
  useEffect(() => {
    const end = endRef.current
    if (end === null || !hasNextPage) return
    const watch = new IntersectionObserver((seen) => { if (seen.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage() })
    watch.observe(end)
    return () => { watch.disconnect() }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, view, tickets.length])

  const detailOf = (id: string): TicketDetail | undefined => client.getQueryData<TicketDetail>(['tickets', 'detail', source, id])
  const blockersOf = (id: string): readonly string[] | null => {
    const detail = detailOf(id)
    return detail === undefined ? null : openBlockers(detail, known)
  }
  const blockerKeys = (ids: readonly string[]) => ids.map((id) => ticketKey(known.get(id) ?? { id, url: '' }))

  // The selected tickets (and those about to go to Kitchen) are read whole, so their blockers are known before they are sent anywhere.
  const wholeIds = [...new Set([...selected, ...(dialog?.kind === 'kitchen' ? dialog.ids : [])])].filter((id) => known.has(id))
  useQueries({
    queries: wholeIds.map((id) => ({
      queryKey: ['tickets', 'detail', source, id],
      queryFn: async () => { const told = await loadTicket(source ?? '', id); if (!told.ok) throw new Error(told.failure.kind); return told.value },
      enabled: source !== null,
      retry: false,
      staleTime: TICKETS_REFRESH_MS,
    })),
  })
  const opened = openId === null ? null : known.get(openId) ?? null
  const detail = useTicketDetail(source, openId)
  const drawer = usePresence(opened !== null, DRAWER_EXIT_MS, reduced)
  const drawerTicket = known.get(openId ?? shownId ?? '') ?? null

  const filtered = useMemo(() => tickets.filter((ticket) => matchesSearch(ticket, typed) && (view !== 'mine' || isMine(ticket, me))), [tickets, typed, view, me])
  const rows = view === 'board' ? filtered : filtered.filter((ticket) => showClosed || ticket.category !== 'Closed')
  const hiddenClosed = filtered.filter((ticket) => ticket.category === 'Closed').length
  const rowState = (ticket: TicketSummary): RowState => ({
    checked: selected.has(ticket.id),
    focused: focused === ticket.id,
    open: openId === ticket.id,
    blockedBy: blockerKeys(blockersOf(ticket.id) ?? []),
    run: host.runOf(ticketKey(ticket)),
  })
  const toggle = (id: string) => { setSelected((now) => { const next = new Set(now); if (!next.delete(id)) next.add(id); return next }) }
  const openTicket = (id: string) => { setFocused(id); setOpenId(id); setShownId(id) }
  const closeTicket = () => { setOpenId(null) }

  const allGroups = groups.data ?? []
  const topGroup = allGroups.find((group) => group.kind === 'Project' && (top === null || group.id === top)) ?? null
  const children = groupsUnder(allGroups, topGroup?.id ?? top)
  const kinds = GROUP_VIEWS[provider].filter((entry) => children.some((group) => group.kind === entry.kind))
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

  const openCount = (provider: Provider): string => {
    const here = sources[provider]
    if (!here.linked) return 'Not linked'
    const group = provider === 'github' ? null : here.top
    const cached = client.getQueryData<{ pages: Array<{ tickets: TicketSummary[]; more: boolean }> }>(['tickets', 'list', here.source, group, ''])
    if (cached === undefined) return ''
    const read = ticketsOf(cached.pages)
    const more = cached.pages.at(-1)?.more ?? false
    return `${String(read.filter((ticket) => ticket.category !== 'Closed').length)}${more ? '+' : ''}`
  }

  const start = (id: string, kind: 'start' | 'here') => { setDialog({ kind, id }) }
  /**
   * Sends the one write the person just confirmed in the dialog. Resolves with why it was not written, or null when it
   * was, after which the dialog closes and the ticket is read again so the page shows what is now there.
   */
  const write = async (id: string, what: TicketWrite): Promise<string | null> => {
    if (source === null) return 'This ticket has no source to write to.'
    try {
      const told = await writeTicket(source, id, what, true)
      if (!told.ok) return writeFailureWords(told.failure, provider)
    } catch {
      return 'Maitty did not answer in time. The ticket may have changed: read it again before trying twice.'
    }
    setDialog(null)
    toast.success(what.kind === 'close' ? 'Marked done' : 'Comment posted')
    void client.invalidateQueries({ queryKey: ['tickets', 'detail', source, id] })
    void client.invalidateQueries({ queryKey: ['tickets', 'list'] })
    return null
  }
  const kitchen = (ids: readonly string[]) => { if (ids.length > 0) setDialog({ kind: 'kitchen', ids }) }
  const selectOpen = (ids: readonly string[]) => { setSelected((now) => new Set([...now, ...ids])) }

  const onKeyDown = (event: KeyboardEvent) => {
    if (dialog !== null) return
    const tag = (event.target as HTMLElement).tagName.toLowerCase()
    const typing = tag === 'input' || tag === 'textarea'
    if (event.key === 'Escape') {
      if (openId !== null) { closeTicket(); event.preventDefault(); return }
      if (typing && typed !== '') { setTyped(''); event.preventDefault(); return }
      if (selected.size > 0) { setSelected(new Set()); event.preventDefault() }
      return
    }
    if (typing) return
    if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); return }
    const order = rows.map((ticket) => ticket.id)
    const at = focused === null ? -1 : order.indexOf(focused)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = order[Math.min(order.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (next !== undefined) {
        setFocused(next)
        rootRef.current?.querySelector(`[data-ticket="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
      }
      return
    }
    if (focused === null) return
    if (event.key === ' ' || event.key === 'x') { event.preventDefault(); toggle(focused) }
    else if (event.key === 'Enter') { event.preventDefault(); openTicket(focused) }
    else if (event.key === 's' || event.key === 'S') { event.preventDefault(); openTicket(focused); start(focused, 'start') }
    else if (event.key === 'k' || event.key === 'K') { event.preventDefault(); kitchen(selected.size > 0 ? [...selected] : [focused]) }
  }

  const go = async (run: () => Promise<void>, failed: string) => {
    try {
      await run()
    } catch (error: unknown) {
      toast.error(errorMessage(error, failed))
    }
  }

  // Until the links and the folder's origin are read, a source that is not set up yet is not said to be.
  const settling = links.isPending || keys.isPending || (provider === 'github' && link.github === null && project.machine === LOCAL_MACHINE && detected.isPending)
  const look = PROVIDER_LOOK[provider]
  const views: Array<{ id: View; label: string; icon: IconName }> = [
    { id: 'list', label: 'All', icon: 'list' },
    { id: 'mine', label: 'Mine', icon: 'person' },
    { id: 'board', label: 'Board', icon: 'board' },
    ...kinds.map((entry) => ({ id: entry.kind, label: entry.label, icon: VIEW_ICON[entry.kind] })),
  ]
  const groupKindLabel = kinds.find((entry) => entry.kind === view)?.label ?? ''
  const selectedTickets = [...selected].map((id) => known.get(id)).filter((ticket): ticket is TicketSummary => ticket !== undefined)
  const selectedBlocked = selectedTickets.filter((ticket) => (blockersOf(ticket.id)?.length ?? 0) > 0).length
  const dialogTicket = dialog !== null && (dialog.kind === 'start' || dialog.kind === 'here') ? detailOf(dialog.id) ?? null : null
  const writeTarget = dialog !== null && (dialog.kind === 'comment' || dialog.kind === 'close') ? known.get(dialog.id) ?? null : null
  const dialogBlockers = dialogTicket === null ? [] : openBlockers(dialogTicket, known)
  const firstBlocker = dialogBlockers[0] === undefined ? undefined : known.get(dialogBlockers[0])

  return (
    <div ref={rootRef} className={`mx-tk${leaving ? ' is-leaving' : ''}`} data-label="Tickets page" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="mx-tk-head">
        <span className="mx-tk-head-title">Tickets</span>
        <span className="mx-tk-head-project"><span className="mx-tk-project-dot" aria-hidden="true" /><span>{project.name}</span></span>
        <span className="mx-spacer" />
        <button type="button" className="mx-tk-x" aria-label="Close" title="Back to the chat" onClick={host.onClose}>✕</button>
      </div>
      <>
          <div className="mx-tk-bar-wrap">
            <div role="tablist" aria-label="Source" className="mx-tk-tabs">
              {PROVIDERS.map((each) => {
                const on = each === provider
                const each_ = PROVIDER_LOOK[each]
                const count = openCount(each)
                return (
                  <button key={each} type="button" role="tab" aria-selected={on} className={`mx-tk-tab${on ? ' is-on' : ''}`} onClick={() => { switchProvider(each) }}>
                    <span className="mx-tk-tab-mark" style={{ color: each_.color }}>{each_.mark}</span>{each_.name}<span className={`mx-tk-tab-n${sources[each].linked ? '' : ' is-unlinked'}`}>{count}</span>
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
                {!isGroupView && (
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
                )}
                <Segmented aria-label="View" className="mx-tk-seg mx-tk-views" value={view} onValueChange={(value) => { const next = views.find((each) => each.id === value); if (next === undefined) return; setView(next.id); if (next.id !== 'list' && next.id !== 'mine' && next.id !== 'board') setScope(null) }}>
                  {views.map((each) => (
                    <SegmentedItem key={each.id} value={each.id} title={each.label}>
                      <Icon name={each.icon} /><span data-vlabel="1">{each.label}</span>
                    </SegmentedItem>
                  ))}
                </Segmented>
                <button type="button" className="mx-tk-icon" aria-label="Refresh" title="Refresh" onClick={() => { void list.refetch(); void groups.refetch() }}>
                  <span className={list.isFetching ? 'mx-tk-turning' : undefined}><Icon name="refresh" size={13} /></span>
                </button>
              </div>
            )}
          </div>
          {!current.linked && settling ? (
            <TicketSkeleton />
          ) : !current.linked ? (
            <TicketSetup provider={provider} project={setupProject} link={link} keys={keys.data} {...(setupAsk === null || setupAsk.link === '' ? {} : { suggestedLink: setupAsk.link })} />
          ) : (
            <>
              {banner !== null && (
                <div role="status" className={`mx-tk-banner${banner.tone === 'danger' ? ' is-danger' : ''}`}>
                  <span className={`mx-tk-banner-glyph${banner.tone === 'danger' ? ' mx-tk-danger' : ''}`}>{banner.glyph}</span>
                  <span className="mx-tk-banner-words"><b>{banner.title}</b><span>{banner.sub}</span></span>
                  {banner.button !== null && <button type="button" className="mx-tk-button" onClick={banner.button.run}>{banner.button.label}</button>}
                </div>
              )}
              {view === 'mine' && !meKnown && (
                <div role="status" className="mx-tk-banner"><span className="mx-tk-banner-glyph">○</span><span className="mx-tk-banner-words"><b>Who are you on {look.name}?</b><span>Add the name you go by there in Settings › Tickets to see the tickets assigned to you.</span></span><button type="button" className="mx-tk-button" onClick={host.onSettings}>Open Settings</button></div>
              )}
              {isGroupView ? (
                <TicketGroups
                  title={`${groupKindLabel} in ${topGroup?.name ?? current.topName}`}
                  kindWord={kindWord(provider, view)}
                  groups={children.filter((group) => group.kind === view)}
                  countsOf={(group: TicketGroup) => groupCounts(group.id, keyRefused ? [] : tickets, (id) => (blockersOf(id)?.length ?? 0) > 0, me)}
                  whole={!hasNextPage}
                  layout={layout}
                  onLayout={setLayout}
                  onSelectOpen={selectOpen}
                  onOpenGroup={(group) => { setScope(group.id); setView('list') }}
                />
              ) : view === 'board' ? (
                list.isPending ? <TicketSkeleton /> : (
                  <TicketBoard tickets={shownTickets} stateOf={rowState} me={me} now={now} onToggle={toggle} onOpen={openTicket} onOpenWork={host.onOpenWork} />
                )
              ) : (
                <div className="mx-tk-list" role="list" aria-label="Tickets">
                  {list.isPending && <TicketSkeleton />}
                  {!list.isPending && shownTickets.length === 0 && !keyRefused && (failure === null || tickets.length > 0) && (
                    <div className="mx-tk-empty">
                      <span className="mx-tk-empty-title">No tickets match</span>
                      <span className="mx-tk-dim">{typed !== '' ? `Nothing matches "${typed}" in ${scopeName}.` : view === 'mine' ? `Nothing in ${scopeName} is assigned to you.` : `Nothing open in ${scopeName}.`}</span>
                      <button type="button" className="mx-tk-button" onClick={() => { setTyped(''); setSearch(''); setScope(null); setShowClosed(true); setView('list') }}>Clear filters</button>
                    </div>
                  )}
                  {shownTickets.map((ticket) => <TicketRow key={ticket.id} ticket={ticket} state={rowState(ticket)} me={me} now={now} onToggle={toggle} onOpen={openTicket} onOpenWork={host.onOpenWork} />)}
                  <div ref={endRef} />
                  {hasNextPage && <div className="mx-tk-more-row"><span className="mx-tk-spin" aria-hidden="true" />Loading more as you scroll</div>}
                  {!list.isPending && (hiddenClosed > 0 || showClosed) && (
                    <button type="button" className="mx-tk-closed-toggle" onClick={() => { setShowClosed((now) => !now) }}>{showClosed ? 'Hide closed' : `Show closed · ${String(hiddenClosed)}`}</button>
                  )}
                </div>
              )}
              {selected.size > 0 && dialog === null && (
                <div role="toolbar" aria-label="Selected tickets" className="mx-tk-selection">
                  <span className="mx-tk-selection-n">{selected.size} selected</span>
                  {selectedBlocked > 0 && <span className="mx-tk-danger mx-tk-selection-blocked">✕ {selectedBlocked} blocked</span>}
                  <button type="button" className="mx-tk-text-button" onClick={() => { setSelected(new Set()) }}>Clear <kbd>Esc</kbd></button>
                  <span className="mx-spacer" />
                  {selected.size === 1 && <button type="button" className="mx-tk-button" onClick={() => { const [only] = selected; if (only !== undefined) { openTicket(only); start(only, 'start') } }}>Start an agent… <kbd>S</kbd></button>}
                  <button type="button" className="mx-tk-button is-primary" onClick={() => { kitchen([...selected]) }}>Send to Kitchen<kbd>K</kbd></button>
                </div>
              )}
            </>
          )}
      </>
      {drawer.shown && drawerTicket !== null && (
        <TicketDrawer
          provider={provider}
          summary={drawerTicket}
          detail={detail.data ?? detailOf(drawerTicket.id) ?? null}
          failed={detail.error === null ? null : `Couldn't read the whole ticket: ${failureOf(detail.error)?.kind ?? 'unknown'}`}
          where={[current.linked ? current.topName : project.name, ...drawerTicket.groups.map((id) => allGroups.find((group) => group.id === id && group.kind !== 'Project')?.name).filter((name): name is string => name !== undefined)].join(' › ')}
          known={known}
          leaving={drawer.leaving}
          now={now}
          run={host.runOf(ticketKey(drawerTicket))}
          onSendHere={host.canSendHere ? () => { start(drawerTicket.id, 'here') } : null}
          onKitchen={() => { kitchen([drawerTicket.id]) }}
          onStart={() => { start(drawerTicket.id, 'start') }}
          onComment={() => { setDialog({ kind: 'comment', id: drawerTicket.id }) }}
          onMarkDone={() => { setDialog({ kind: 'close', id: drawerTicket.id }) }}
          onOpenWork={host.onOpenWork}
          onOpenTicket={openTicket}
          onClose={closeTicket}
        />
      )}
      {dialog !== null && (dialog.kind === 'start' || dialog.kind === 'here') && dialogTicket !== null && (
        <StartTicketDialog
          container={host.container}
          provider={provider}
          ticket={dialogTicket}
          blockers={blockerKeys(dialogBlockers)}
          blockerState={firstBlocker?.category === 'Started' ? 'in progress' : firstBlocker?.category === 'Open' ? 'open' : 'not done'}
          here={dialog.kind === 'here'}
          defaultAgent={host.defaultAgent}
          folder={project.folder}
          project={project.name}
          onCancel={() => { setDialog(null) }}
          onGo={(choice) => {
            const ticket = dialogTicket
            const here = dialog.kind === 'here'
            setDialog(null)
            setOpenId(null)
            if (!here) setSelected(new Set())
            void go(() => (here ? host.onSendHere(ticket, choice.message) : host.onStart(ticket, choice)), here ? 'Could not send the ticket' : 'Could not start the agent')
          }}
        />
      )}
      {dialog !== null && (dialog.kind === 'comment' || dialog.kind === 'close') && writeTarget !== null && (
        <TicketWriteDialog
          container={host.container}
          provider={provider}
          ticket={writeTarget}
          kind={dialog.kind}
          onConfirm={(what) => write(dialog.id, what)}
          onCancel={() => { setDialog(null) }}
        />
      )}
      {dialog?.kind === 'kitchen' && (
        <KitchenDialog
          container={host.container}
          provider={provider}
          tickets={dialog.ids.map((id) => known.get(id)).filter((ticket): ticket is TicketSummary => ticket !== undefined)}
          blockersOf={(id) => { const found = blockersOf(id); return found === null ? null : blockerKeys(found) }}
          targets={host.kitchenChats}
          onCancel={() => { setDialog(null) }}
          onGo={(target, chosen) => {
            setDialog(null)
            setSelected(new Set())
            void go(() => host.onSendKitchen(target, chosen), 'Could not send to Kitchen')
          }}
        />
      )}
    </div>
  )
}
