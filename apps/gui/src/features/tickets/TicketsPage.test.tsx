import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketDetail, TicketGroup, TicketKeyState, TicketsResult, TicketSummary, TicketWrite, TicketWritten } from '@/api/tickets'
import { resetTicketLinksForTest } from './model/ticketLinks'
import { TicketsPage, type TicketsHost } from './TicketsPage'

const api = vi.hoisted(() => ({
  loadTicketKeys: vi.fn<() => Promise<TicketsResult<TicketKeyState[]>>>(),
  loadTicketGroups: vi.fn<(source: string) => Promise<TicketsResult<TicketGroup[]>>>(),
  loadTicketPage: vi.fn<() => Promise<TicketsResult<{ tickets: TicketSummary[]; more: boolean }>>>(),
  loadTicket: vi.fn<(source: string, id: string) => Promise<TicketsResult<TicketDetail>>>(),
  githubRepoOf: vi.fn<(folder: string) => Promise<string | null>>(),
  writeTicket: vi.fn<(source: string, id: string, write: TicketWrite, confirmed: true) => Promise<TicketsResult<TicketWritten>>>(),
}))
vi.mock('@/api/tickets', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/tickets')>(), ...api }))

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

function show(page: TicketsHost = host()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TicketsPage project={{ name: 'shop', linkKey: '0:/home/me/shop', folder: '/home/me/shop', machine: 0 }} host={page} />
    </QueryClientProvider>,
  )
  return page
}

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  resetTicketLinksForTest()
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

  it('asks for a source when nothing is linked', async () => {
    api.githubRepoOf.mockResolvedValue(null)
    const page = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Connect a source' }))
    expect(page.onSettings).toHaveBeenCalledOnce()
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

