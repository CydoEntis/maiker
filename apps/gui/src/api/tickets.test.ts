import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commentProblem, githubRepoOf, loadTicket, loadTicketGroups, loadTicketKeys, loadTicketPage, saveTicketKey, TICKET_COMMENT_MAX_CHARS, writeTicket } from './tickets'

const shell = vi.hoisted(() => ({
  invoke: vi.fn<(command: string, args: { tag?: number }) => Promise<unknown>>(),
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: shell.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    shell.handlers.set(name, handler)
    return Promise.resolve(() => undefined)
  },
}))

/** Waits for the question to be sent, then answers it on `event` with the tag it was given. */
async function answer(event: string, answer: unknown) {
  await vi.waitFor(() => { expect(shell.invoke).toHaveBeenCalledOnce() })
  const tag = shell.invoke.mock.lastCall?.[1].tag
  shell.handlers.get(event)?.({ payload: { machine: 0, tag, answer } })
}

const SUMMARY = { id: 'github:me/shop#142', title: 'Fix the cart', state: { name: 'open', category: 'Open' }, labels: ['bug'], assignee: 'cydo', url: 'https://github.com/me/shop/issues/142', groups: ['github:me/shop'], updated_at: '2026-11-14T10:00:00Z' }

beforeEach(() => {
  shell.invoke.mockReset()
  shell.invoke.mockResolvedValue(undefined)
})

describe('reading tickets', () => {
  it('asks for a source\'s groups and reads them', async () => {
    const asked = loadTicketGroups('me/shop')
    await answer('tickets', { Ok: { Groups: [{ id: 'github:me/shop', kind: 'Project', name: 'me/shop', parent: null, ticket_count: 12 }] } })
    await expect(asked).resolves.toEqual({ ok: true, value: [{ id: 'github:me/shop', kind: 'Project', name: 'me/shop', parent: null, count: 12 }] })
    expect(shell.invoke).toHaveBeenCalledWith('tickets', { source: 'me/shop', request: 'Groups', tag: expect.any(Number) as number })
  })

  it('reads a page of a list into the window\'s shape', async () => {
    const asked = loadTicketPage('plane', { group: 'plane:p1', state: null, assignee: null, label: null, search: 'cart', page: 2 })
    await answer('tickets', { Ok: { List: { tickets: [SUMMARY], more: true } } })
    await expect(asked).resolves.toEqual({ ok: true, value: { more: true, tickets: [{ id: SUMMARY.id, title: 'Fix the cart', stateName: 'open', category: 'Open', labels: ['bug'], assignee: 'cydo', url: SUMMARY.url, groups: SUMMARY.groups, updatedAt: SUMMARY.updated_at }] } })
  })

  it('reads one ticket whole', async () => {
    const asked = loadTicket('me/shop', SUMMARY.id)
    await answer('tickets', { Ok: { Ticket: { summary: SUMMARY, body: '<b>not markup</b>', comments: [{ author: 'ada', body: 'hi', created_at: '' }], comments_more: true, links: [], blocked_by: ['github:me/shop#1'] } } })
    const told = await asked
    expect(told.ok && told.value).toMatchObject({ body: '<b>not markup</b>', comments: [{ author: 'ada', body: 'hi', createdAt: '' }], commentsMore: true, blockedBy: ['github:me/shop#1'] })
    expect(shell.invoke).toHaveBeenCalledWith('tickets', { source: 'me/shop', request: { Get: { id: SUMMARY.id } }, tag: expect.any(Number) as number })
  })

  it.each([
    ['NotInstalled', { kind: 'no-key' }],
    ['SignedOut', { kind: 'signed-out' }],
    ['RateLimited', { kind: 'rate-limited' }],
    [{ Unreachable: 'no route to host' }, { kind: 'unreachable', line: 'no route to host' }],
  ])('reads the failure %j', async (said, failure) => {
    const asked = loadTicketGroups('linear')
    await answer('tickets', { Err: said })
    await expect(asked).resolves.toEqual({ ok: false, failure })
  })

  it('says so when the answer is to another question', async () => {
    const asked = loadTicket('me/shop', SUMMARY.id)
    await answer('tickets', { Ok: { Groups: [] } })
    await expect(asked).resolves.toMatchObject({ ok: false, failure: { kind: 'invalid' } })
  })
})

describe('ticket keys', () => {
  it('asks which keys are set, and never gets a key back', async () => {
    const asked = loadTicketKeys()
    await answer('ticket-keys', { Ok: [{ provider: 'Plane', set: true, address: 'https://plane.example', workspace: 'acme' }] })
    await expect(asked).resolves.toEqual({ ok: true, value: [{ provider: 'Plane', set: true, address: 'https://plane.example', workspace: 'acme' }] })
    expect(shell.invoke).toHaveBeenCalledWith('ticket_keys', { change: 'Status', tag: expect.any(Number) as number })
  })

  it('sends a key trimmed, with Plane\'s address and workspace', async () => {
    const asked = saveTicketKey('Plane', ' https://plane.example ', ' acme ', ' secret-value ')
    await answer('ticket-keys', { Ok: [] })
    await asked
    expect(shell.invoke).toHaveBeenCalledWith('ticket_keys', { change: { Set: { provider: 'Plane', address: 'https://plane.example', workspace: 'acme', key: 'secret-value' } }, tag: expect.any(Number) as number })
  })
})

describe('writing to a ticket', () => {
  it('sends a comment trimmed, marked confirmed, and reads what was done', async () => {
    const asked = writeTicket('me/shop', SUMMARY.id, { kind: 'comment', text: '  Fixed in #7\r\nthanks \n' }, true)
    await answer('ticket-write', { Ok: 'Commented' })
    await expect(asked).resolves.toEqual({ ok: true, value: 'Commented' })
    expect(shell.invoke).toHaveBeenCalledWith('ticket_write', { source: 'me/shop', id: SUMMARY.id, write: { Comment: { text: 'Fixed in #7\nthanks' } }, confirmed: true, tag: expect.any(Number) as number })
  })

  it('closes a ticket and says why a write was refused', async () => {
    const closed = writeTicket('plane', 'plane:p1#i1', { kind: 'close' }, true)
    await answer('ticket-write', { Ok: 'Closed' })
    await expect(closed).resolves.toEqual({ ok: true, value: 'Closed' })
    expect(shell.invoke).toHaveBeenCalledWith('ticket_write', { source: 'plane', id: 'plane:p1#i1', write: 'Close', confirmed: true, tag: expect.any(Number) as number })

    shell.invoke.mockClear()
    const refused = writeTicket('plane', 'plane:p1#i1', { kind: 'close' }, true)
    await answer('ticket-write', { Err: 'SignedOut' })
    await expect(refused).resolves.toEqual({ ok: false, failure: { kind: 'signed-out' } })
  })

  it('knows a comment that cannot be sent before asking', () => {
    expect(commentProblem('hello\nthere')).toBeNull()
    expect(commentProblem('  \n ')).not.toBeNull()
    expect(commentProblem('x'.repeat(TICKET_COMMENT_MAX_CHARS))).toBeNull()
    expect(commentProblem('x'.repeat(TICKET_COMMENT_MAX_CHARS + 1))).not.toBeNull()
    expect(commentProblem('tab\there')).not.toBeNull()
    expect(commentProblem('zero\u200bwidth')).not.toBeNull()
  })
})

describe('a folder\'s GitHub repository', () => {
  it('is what the host says, or none', async () => {
    shell.invoke.mockResolvedValueOnce('me/shop').mockResolvedValueOnce(null)
    await expect(githubRepoOf('/home/me/shop')).resolves.toBe('me/shop')
    await expect(githubRepoOf('/home/me/blog')).resolves.toBeNull()
    expect(shell.invoke).toHaveBeenCalledWith('github_repo_of', { machine: 0, folder: '/home/me/shop' })
  })
})
