import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ClosedSession } from '@/api/daemon'
import { RecentSessionsDialog } from './RecentSessionsDialog'

const answer = vi.hoisted(() => ({ next: (): Promise<ClosedSession[] | null> => Promise.resolve([]) }))
const reopened = vi.hoisted(() => ({ sent: [] as [string, string][], next: (): Promise<boolean> => Promise.resolve(true) }))
// The service makes the folder again and answers with it; an older one answers null and is asked to reopen it itself.
const ready = vi.hoisted(() => ({ sent: [] as [string, string][], next: (): Promise<string | null> => Promise.resolve('/home/me/dev/app-docs') }))
vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  closedSessions: () => answer.next(),
  readyClosedFolder: (agent: string, session: string) => { ready.sent.push([agent, session]); return ready.next() },
  reopenClosedSession: (agent: string, session: string) => { reopened.sent.push([agent, session]); return reopened.next() },
}))

const NOW = Math.floor(Date.now() / 1000)
const parser: ClosedSession = { agent: 'claude', session: 'abc-123', cwd: '/home/me/dev/app', branch: 'fix/parser', title: 'Fix the parser', at: NOW - 3 * 3600, folder_present: true, worktree: null, repo: null }
const gone: ClosedSession = { agent: 'codex', session: 'def-456', cwd: '/home/me/dev/old', branch: null, title: null, at: NOW - 86_400, folder_present: false, worktree: null, repo: null }
const removedWorktree: ClosedSession = { ...parser, title: 'Tidy the docs', session: 'ghi-789', cwd: '/home/me/dev/app-docs', branch: 'docs/tidy', folder_present: false, worktree: '/home/me/dev/app-docs', repo: '/home/me/dev/app' }

function deferred<T>() {
  let settle: { resolve: (value: T) => void; reject: (error: unknown) => void } = { resolve: () => undefined, reject: () => undefined }
  const promise = new Promise<T>((resolve, reject) => { settle = { resolve, reject } })
  return { promise, ...settle }
}

function open(list: ClosedSession[] | null | Error) {
  answer.next = () => (list instanceof Error ? Promise.reject(list) : Promise.resolve(list))
  reopened.sent = []
  ready.sent = []
  const onPick = vi.fn()
  const onStart = vi.fn(() => Promise.resolve())
  const onReopened = vi.fn()
  const { unmount } = render(<RecentSessionsDialog home="/home/me" onPick={onPick} onStart={onStart} onReopened={onReopened} onCancel={vi.fn()} />)
  return { onPick, onStart, onReopened, unmount }
}

describe('the Recent sessions list', () => {
  it("shows each session's title, agent, folder, branch and when it closed, and picking one reopens it", async () => {
    const { onPick } = open([parser])
    const row = await screen.findByRole('button', { name: /Fix the parser/ })
    expect(row.textContent).toContain('Claude · ~/dev/app · fix/parser')
    expect(row.textContent).toContain('closed 3h ago')
    fireEvent.click(row)
    expect(onPick).toHaveBeenCalledWith(parser)
  })

  it('marks a session whose folder is gone and does not let it be picked', async () => {
    const { onPick } = open([gone])
    const row = await screen.findByRole('button', { name: /Codex session/ })
    expect(row.textContent).toContain('folder removed')
    expect(row.getAttribute('aria-disabled')).toBe('true')
    expect(row.hasAttribute('disabled')).toBe(false)
    row.focus()
    expect(document.activeElement).toBe(row)
    fireEvent.click(row)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('has the service make a removed worktree again, starts the session there, and closes once it has', async () => {
    const reply = deferred<string | null>()
    ready.next = () => reply.promise
    const { onPick, onStart, onReopened } = open([removedWorktree])
    const row = await screen.findByRole('button', { name: /Tidy the docs/ })
    expect(row.getAttribute('aria-disabled')).toBe('false')
    expect(row.textContent).toContain('folder removed')
    fireEvent.click(row)
    fireEvent.click(row)
    expect(ready.sent).toEqual([['claude', 'ghi-789']])
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('Making the folder again')
    reply.resolve('/home/me/dev/app-docs')
    await waitFor(() => { expect(onReopened).toHaveBeenCalledTimes(1) })
    // Started like any resume, so it opens as a chat or in its terminal as Settings says.
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', folder: '/home/me/dev/app-docs', resume: 'ghi-789' }))
    expect(reopened.sent).toEqual([])
  })

  it('has an older service, which cannot only make the folder, reopen the session itself', async () => {
    ready.next = () => Promise.resolve(null)
    const { onStart, onReopened } = open([removedWorktree])
    fireEvent.click(await screen.findByRole('button', { name: /Tidy the docs/ }))
    await waitFor(() => { expect(onReopened).toHaveBeenCalledTimes(1) })
    expect(reopened.sent).toEqual([['claude', 'ghi-789']])
    expect(onStart).not.toHaveBeenCalled()
  })

  it('lets no other session be picked while a removed folder is made again', async () => {
    const reply = deferred<string | null>()
    ready.next = () => reply.promise
    const { onPick } = open([removedWorktree, parser])
    fireEvent.click(await screen.findByRole('button', { name: /Tidy the docs/ }))
    const present = screen.getByRole('button', { name: /Fix the parser/ })
    expect(present.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(present)
    expect(onPick).not.toHaveBeenCalled()
    reply.reject(new Error('the branch docs/tidy no longer exists'))
    await screen.findByRole('alert')
    expect(present.getAttribute('aria-disabled')).toBe('false')
  })

  it('does nothing with an answer that arrives after the list closed', async () => {
    const reply = deferred<boolean>()
    ready.next = () => Promise.resolve(null)
    reopened.next = () => reply.promise
    const { onReopened, unmount } = open([removedWorktree])
    fireEvent.click(await screen.findByRole('button', { name: /Tidy the docs/ }))
    await waitFor(() => { expect(reopened.sent).toHaveLength(1) })
    unmount()
    reply.resolve(true)
    await reply.promise
    await Promise.resolve()
    expect(onReopened).not.toHaveBeenCalled()
  })

  it("shows the service's refusal and keeps the list usable", async () => {
    ready.next = () => Promise.reject(new Error('the branch docs/tidy no longer exists in /home/me/dev/app, so its worktree was not made again'))
    const { onReopened } = open([removedWorktree])
    const row = await screen.findByRole('button', { name: /Tidy the docs/ })
    fireEvent.click(row)
    expect((await screen.findByRole('alert')).textContent).toContain('the branch docs/tidy no longer exists')
    expect(onReopened).not.toHaveBeenCalled()
    ready.next = () => Promise.resolve('/home/me/dev/app-docs')
    fireEvent.click(row)
    await waitFor(() => { expect(onReopened).toHaveBeenCalledTimes(1) })
  })

  it('asks for a service restart when the service is older than reopening a removed folder', async () => {
    ready.next = () => Promise.resolve(null)
    reopened.next = () => Promise.resolve(false)
    const { onReopened } = open([removedWorktree])
    fireEvent.click(await screen.findByRole('button', { name: /Tidy the docs/ }))
    expect((await screen.findByRole('alert')).textContent.trim()).toBe('The Maiker service needs a restart to reopen it.')
    expect(onReopened).not.toHaveBeenCalled()
  })

  it('asks for a service restart when the service is older than the list', async () => {
    open(null)
    expect(await screen.findByText('The Maiker service needs a restart to see closed sessions.')).toBeTruthy()
  })

  it('says a failed read in plain words and tries again', async () => {
    open(new Error('pipe closed'))
    const retry = await screen.findByRole('button', { name: 'Try again' })
    answer.next = () => Promise.resolve([parser])
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /Fix the parser/ })).toBeTruthy()
  })
})
