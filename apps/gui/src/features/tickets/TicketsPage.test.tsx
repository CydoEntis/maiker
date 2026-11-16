import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyedProvider, TicketDetail, TicketGroup, TicketKeyState, TicketsResult, TicketSummary, TicketWrite, TicketWritten } from '@/api/tickets'
import { resetTicketLinksForTest } from './model/ticketLinks'
import { TicketsPage, type TicketsHost } from './TicketsPage'
import type { SetupAsk } from './useTicketSetupAsks'

const api = vi.hoisted(() => ({
  loadTicketKeys: vi.fn<() => Promise<TicketsResult<TicketKeyState[]>>>(),
  loadTicketGroups: vi.fn<(source: string) => Promise<TicketsResult<TicketGroup[]>>>(),
  loadTicketPage: vi.fn<() => Promise<TicketsResult<{ tickets: TicketSummary[]; more: boolean }>>>(),
  loadTicket: vi.fn<(source: string, id: string) => Promise<TicketsResult<TicketDetail>>>(),
  saveTicketKey: vi.fn<(provider: KeyedProvider, address: string, workspace: string, key: string) => Promise<TicketsResult<TicketKeyState[]>>>(),
  githubRepoOf: vi.fn<(folder: string) => Promise<string | null>>(),
  writeTicket: vi.fn<(source: string, id: string, write: TicketWrite, confirmed: true) => Promise<TicketsResult<TicketWritten>>>(),
}))
vi.mock('@/api/tickets', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/tickets')>(), ...api }))
const fake = vi.hoisted(() => ({ links: null as ReturnType<typeof import('@/test/fakeTicketLinks').fakeTicketLinks> | null }))
vi.mock('@/api/ticketLinks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/ticketLinks')>()
  const { fakeTicketLinks } = await import('@/test/fakeTicketLinks')
  fake.links = fakeTicketLinks()
  return { ...real, ...fake.links.api }
})
function links() {
  if (fake.links === null) throw new Error('the daemon fake is made when the module is mocked')
  return fake.links
}

const CART: TicketSummary = { id: 'github:me/shop#142', title: 'Fix the cart', stateName: 'open', category: 'Open', labels: ['bug'], assignee: 'cydo', url: 'https://github.com/me/shop/issues/142', groups: ['github:me/shop'], updatedAt: '2026-11-14T10:00:00Z' }
const TILL: TicketSummary = { ...CART, id: 'github:me/shop#143', title: 'Fix the till', assignee: null, url: 'https://github.com/me/shop/issues/143' }
const MARKUP = '**bold** <b>tags</b> [links](https://x.example)'

function host(change: Partial<TicketsHost> = {}): TicketsHost {
  return {
    container: document.body, defaultAgent: 'claude', githubLogin: 'cydo', kitchenChats: [], runOf: () => null, canSendHere: true,
    onClose: vi.fn(), onSettings: vi.fn(), onSignInGitHub: vi.fn(), onStart: vi.fn(() => Promise.resolve()), onSendHere: vi.fn(() => Promise.resolve()), onSendKitchen: vi.fn(() => Promise.resolve()), onOpenWork: vi.fn(),
    ...change,
  }
}

function show(page: TicketsHost = host(), setupAsk: SetupAsk | null = null) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TicketsPage project={{ name: 'shop', linkKey: ':/home/me/shop', folder: '/home/me/shop', machine: 0, machineName: null }} host={page} setupAsk={setupAsk} />
    </QueryClientProvider>,
  )
  return page
}

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  resetTicketLinksForTest()
  links().set([])
  for (const mock of Object.values(api)) mock.mockReset()
  api.loadTicketKeys.mockResolvedValue({ ok: true, value: [] })
  api.githubRepoOf.mockResolvedValue('me/shop')
  api.loadTicketGroups.mockResolvedValue({ ok: true, value: [{ id: 'github:me/shop', kind: 'Project', name: 'me/shop', parent: null, count: 2 }] })
  api.loadTicketPage.mockResolvedValue({ ok: true, value: { tickets: [CART, TILL], more: false } })
  api.loadTicket.mockImplementation((_, id) => Promise.resolve({ ok: true, value: { ...(id === CART.id ? CART : TILL), body: MARKUP, comments: [], commentsMore: false, links: [], blockedBy: [] } }))
})

describe('the Tickets view', () => {
  it("lists the GitHub tickets of the folder's own repository", async () => {
    show()
    const list = await screen.findByRole('list', { name: 'Tickets' })
    expect(await within(list).findByText('Fix the cart')).toBeInTheDocument()
    expect(within(list).getByText('#143')).toBeInTheDocument()
    expect(api.loadTicketGroups).toHaveBeenCalledWith('me/shop')
  })

  it("opens a ticket and shows its words as plain text, never as markup", async () => {
    show()
    await userEvent.click(await screen.findByText('Fix the cart'))
    expect(await screen.findByText(MARKUP)).toBeInTheDocument()
    expect(document.querySelector('.mx-tk-drawer b')).toBeNull()
  })

  it('says so when gh is signed out, and offers a terminal', async () => {
    api.loadTicketGroups.mockResolvedValue({ ok: false, failure: { kind: 'signed-out' } })
    api.loadTicketPage.mockResolvedValue({ ok: false, failure: { kind: 'signed-out' } })
    const page = show()
    expect(await screen.findByText('GitHub: not signed in')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(page.onSignInGitHub).toHaveBeenCalledOnce()
  })

  it('sets up GitHub in place when the folder names no repository, for the project and its worktrees', async () => {
    api.githubRepoOf.mockResolvedValue(null)
    show()
    expect(await screen.findByText("Which repository are shop's issues in?")).toBeInTheDocument()
    expect(screen.getByText(/Saved for shop and every worktree of it/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub repo for shop' }), 'me/shop')
    await userEvent.click(screen.getByRole('button', { name: 'Use this repo' }))
    expect(links().projects).toEqual([{ machine: null, folder: '/home/me/shop', link: { github: 'me/shop', plane: null, linear: null } }])
    expect(await screen.findByText('Fix the cart')).toBeInTheDocument()
  })

  it('connects Linear once, then picks the team this project reads', async () => {
    const LINEAR_SET: TicketKeyState[] = [{ provider: 'Plane', set: false, address: '', workspace: '' }, { provider: 'Linear', set: true, address: '', workspace: '' }]
    api.saveTicketKey.mockResolvedValue({ ok: true, value: LINEAR_SET })
    api.loadTicketGroups.mockImplementation((source) => Promise.resolve({ ok: true, value: source === 'linear' ? [{ id: 'linear:team.1', kind: 'Project', name: 'Core', parent: null, count: 4 }] : [] }))
    show()
    await userEvent.click(await screen.findByRole('tab', { name: /Linear/ }))
    expect(screen.getByRole('list', { name: 'Set up Linear' })).toBeInTheDocument()
    expect(screen.getByText(/used for every project/)).toBeInTheDocument()
    const key = screen.getByLabelText('Linear API key')
    expect(key).toHaveAttribute('type', 'password')
    await userEvent.type(key, 'lin_api_0123456789')
    await userEvent.click(screen.getByRole('button', { name: 'Connect Linear' }))
    expect(api.saveTicketKey).toHaveBeenCalledWith('Linear', '', '', 'lin_api_0123456789')
    expect(await screen.findByText('Linear is connected on this computer')).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('lin_api_0123456789')
    await userEvent.click(await screen.findByRole('button', { name: /Core/ }))
    await vi.waitFor(() => { expect(links().projects[0]?.link.linear).toEqual({ id: 'linear:team.1', name: 'Core' }) })
  })
})

describe('setup an agent opened', () => {
  it('opens on the source the agent named, with its link shown as text and nothing saved', async () => {
    const link = 'https://plane.example/acme/projects/p1/issues/'
    show(host(), { source: 'plane', link })
    expect(await screen.findByRole('list', { name: 'Set up Plane' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Plane/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(link)).toBeInTheDocument()
    expect(document.querySelector('.mx-tk-suggested a')).toBeNull()
    expect(links().projects).toEqual([])
    expect(api.saveTicketKey).not.toHaveBeenCalled()
  })

  it("reads the sources a repository's own file names, without a link made here", async () => {
    links().setRepoFile('/home/me/shop', { linear: { id: 'linear:team.9', name: 'Core' } })
    api.loadTicketKeys.mockResolvedValue({ ok: true, value: [{ provider: 'Plane', set: false, address: '', workspace: '' }, { provider: 'Linear', set: true, address: '', workspace: '' }] })
    api.loadTicketGroups.mockImplementation((source) => Promise.resolve({ ok: true, value: source === 'linear' ? [{ id: 'linear:team.9', kind: 'Project', name: 'Core', parent: null, count: 4 }] : [] }))
    show()
    await userEvent.click(await screen.findByRole('tab', { name: /Linear/ }))
    expect(await screen.findByRole('list', { name: 'Tickets' })).toBeInTheDocument()
    expect(links().projects).toEqual([])
  })
})

describe('changing a ticket', () => {
  async function openCart() {
    await userEvent.click(await screen.findByText('Fix the cart'))
    return screen.findByRole('complementary', { name: /Fix the cart/ })
  }

  it('posts a comment only after the review is confirmed, then reads the ticket again', async () => {
    api.writeTicket.mockResolvedValue({ ok: true, value: 'Commented' })
    show()
    const drawer = await openCart()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Comment…' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Your comment' }), 'On it')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(api.writeTicket).not.toHaveBeenCalled()
    const reads = api.loadTicket.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Post comment to GitHub' }))
    expect(api.writeTicket).toHaveBeenCalledExactlyOnceWith('me/shop', CART.id, { kind: 'comment', text: 'On it' }, true)
    await vi.waitFor(() => { expect(screen.queryByRole('button', { name: 'Post comment to GitHub' })).toBeNull() })
    await vi.waitFor(() => { expect(api.loadTicket.mock.calls.length).toBeGreaterThan(reads) })
  })

  it('leaves the ticket alone when the person backs out, and when the provider refuses', async () => {
    show()
    const drawer = await openCart()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Mark done…' }))
    expect(screen.getByText('Exactly what will be written')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel (Esc)' }))
    expect(api.writeTicket).not.toHaveBeenCalled()

    api.writeTicket.mockResolvedValue({ ok: false, failure: { kind: 'signed-out' } })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Mark done…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mark done on GitHub' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not written.')
    expect(api.writeTicket).toHaveBeenCalledExactlyOnceWith('me/shop', CART.id, { kind: 'close' }, true)
  })
})

