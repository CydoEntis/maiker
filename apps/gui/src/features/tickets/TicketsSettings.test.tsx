import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitHubReport } from '@/api/githubAccounts'
import type { KeyedProvider, TicketGroup, TicketKeyState, TicketsResult } from '@/api/tickets'
import { resetTicketLinksForTest } from './model/ticketLinks'
import { TicketsSection } from './TicketsSettings'

const api = vi.hoisted(() => ({
  loadTicketKeys: vi.fn<() => Promise<TicketsResult<TicketKeyState[]>>>(),
  saveTicketKey: vi.fn<(provider: KeyedProvider, address: string, workspace: string, key: string) => Promise<TicketsResult<TicketKeyState[]>>>(),
  removeTicketKey: vi.fn<(provider: KeyedProvider) => Promise<TicketsResult<TicketKeyState[]>>>(),
  loadTicketGroups: vi.fn<(source: string) => Promise<TicketsResult<TicketGroup[]>>>(),
  loadTicketPage: vi.fn(),
  loadTicket: vi.fn(),
  githubRepoOf: vi.fn<(folder: string) => Promise<string | null>>(),
}))
vi.mock('@/api/tickets', () => api)
const gh = vi.hoisted(() => ({ loadGitHubAccounts: vi.fn<(machine: number) => Promise<GitHubReport>>() }))
vi.mock('@/api/githubAccounts', () => gh)
const fake = vi.hoisted(() => ({ links: null as ReturnType<typeof import('@/test/fakeTicketLinks').fakeTicketLinks> | null }))
vi.mock('@/api/ticketLinks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/ticketLinks')>()
  const { fakeTicketLinks } = await import('@/test/fakeTicketLinks')
  fake.links = fakeTicketLinks()
  return { ...real, ...fake.links.api }
})
function links() {
  if (fake.links === null) throw new Error('the Maiker service fake is made when the module is mocked')
  return fake.links
}

const NO_KEYS: TicketKeyState[] = [{ provider: 'Plane', set: false, address: '', workspace: '', stored_in: 'File' }, { provider: 'Linear', set: false, address: '', workspace: '', stored_in: 'File' }]
const LINEAR_SET: TicketKeyState[] = [NO_KEYS[0] as TicketKeyState, { provider: 'Linear', set: true, address: '', workspace: '', stored_in: 'File' }]
const SECRET = 'lin_api_0123456789'

function show(signIn = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TicketsSection projects={[{ name: 'shop', linkKey: ':/home/me/shop', folder: '/home/me/shop', machine: 0, machineName: null }]} signIn={{ onSignIn: signIn, signInsEnded: 0 }} />
    </QueryClientProvider>,
  )
  return signIn
}

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  resetTicketLinksForTest()
  links().set([])
  for (const mock of Object.values(api)) mock.mockReset()
  gh.loadGitHubAccounts.mockResolvedValue({ installed: true, accounts: [{ login: 'cydo', active: true }], problem: null })
  api.loadTicketKeys.mockResolvedValue({ ok: true, value: NO_KEYS })
  api.loadTicketGroups.mockResolvedValue({ ok: true, value: [] })
  api.githubRepoOf.mockResolvedValue('me/shop')
})

describe('Settings › Tickets', () => {
  it('shows the gh login under Accounts, and an open project to set up under Linked projects', async () => {
    show()
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Linked projects' })).toBeInTheDocument()
    expect(await screen.findByText('Signed in with gh as @cydo')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Set up' }))
    expect(await screen.findByText("From the folder's origin: me/shop")).toBeInTheDocument()
  })

  it('lists each linked project with what it reads, and unlinks one', async () => {
    links().set([{ machine: null, folder: '/home/me/shop', link: { github: '', plane: null, linear: { id: 'linear:team.1', name: 'Core' } } }, { machine: 'kingdom', folder: '/srv/blog', link: { github: 'me/blog', plane: null, linear: null } }])
    show()
    expect(await screen.findByText('/home/me/shop · GitHub off · Linear Core')).toBeInTheDocument()
    expect(screen.getByText('kingdom · /srv/blog · GitHub me/blog')).toBeInTheDocument()
    const unlinks = screen.getAllByRole('button', { name: 'Unlink' })
    await userEvent.click(unlinks[0] as HTMLElement)
    await waitFor(() => { expect(links().projects).toHaveLength(1) })
    expect(links().projects[0]?.folder).toBe('/srv/blog')
  })

  it('offers a terminal to sign in to gh when nobody is', async () => {
    gh.loadGitHubAccounts.mockResolvedValue({ installed: true, accounts: [], problem: null })
    const signIn = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Open terminal' }))
    expect(signIn).toHaveBeenCalledWith(0, 'This computer')
  })

  it('gives a Linear key to the service once, then never shows it', async () => {
    api.saveTicketKey.mockResolvedValue({ ok: true, value: [NO_KEYS[0] as TicketKeyState, { provider: 'Linear', set: true, address: '', workspace: '', stored_in: 'Keychain' }] })
    show()
    const field = await screen.findByLabelText('Linear API key')
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    await userEvent.type(field, SECRET)
    const connects = screen.getAllByRole('button', { name: 'Connect' })
    await userEvent.click(connects[connects.length - 1] as HTMLElement)
    expect(api.saveTicketKey).toHaveBeenCalledWith('Linear', '', '', SECRET)
    expect(await screen.findByText('Connected · Key kept in your system keychain')).toBeInTheDocument()
    expect(screen.queryByLabelText('Linear API key')).toBeNull()
    expect(document.body.innerHTML).not.toContain(SECRET)
  })

  it('says a key is kept in a file where the machine has no keychain', async () => {
    api.loadTicketKeys.mockResolvedValue({ ok: true, value: LINEAR_SET })
    show()
    expect(await screen.findByText('Connected · Key kept in a file: no keychain on this machine')).toBeInTheDocument()
  })

  it('says a key was refused and asks for a new one', async () => {
    api.loadTicketKeys.mockResolvedValue({ ok: true, value: LINEAR_SET })
    api.loadTicketGroups.mockImplementation((source) => Promise.resolve(source === 'linear' ? { ok: false, failure: { kind: 'signed-out' } } : { ok: true, value: [] }))
    show()
    expect(await screen.findByText(/Key refused/)).toBeInTheDocument()
    await waitFor(() => { expect(screen.getByLabelText('Linear API key')).toHaveClass('is-invalid') })
  })

  it('needs a Plane address that is a web address', async () => {
    show()
    const address = await screen.findByLabelText('Plane address')
    await userEvent.clear(address)
    await userEvent.type(address, 'plane.example')
    expect(screen.getByText('Starts with https://')).toBeInTheDocument()
  })

  it('fills the Plane address and workspace from a pasted link', async () => {
    show()
    await userEvent.type(await screen.findByLabelText('Link to your Plane'), 'http://192.168.1.244/ideayard/projects/3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d/issues/')
    await userEvent.click(screen.getByRole('button', { name: 'Use link' }))
    expect(screen.getByLabelText('Plane address')).toHaveValue('http://192.168.1.244')
    expect(screen.getByLabelText('Plane workspace')).toHaveValue('ideayard')
  })
})
