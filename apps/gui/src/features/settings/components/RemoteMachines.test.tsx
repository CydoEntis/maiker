import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Added, HostKeyReport } from '@/api/machines'
import { machineHeads, type MachineHead, type RemoteMachine } from '@/features/workspace/model/machines'
import type { MachinesInfo } from './DesktopSettings'
import { MachinesPage } from './MachinesPage'

type State = RemoteMachine['state']
const OLDER = 'run `maiker machine update NAME`, then retry'
const MISSING = 'run `maiker machine update NAME --install`, then retry'

function machine(id: number, name: string, state: State['state'], extra: Partial<State> = {}): RemoteMachine {
  const why = (extra.why ?? null)?.replace('NAME', name) ?? null
  return { state: { machine: id, name, state, why, attempt: null, since: Date.now() - 14 * 60_000, target: `me@${name}.lan`, ...extra, ...(why === null ? {} : { why }) }, conversations: [], heard: true, listedAt: 0 }
}

function heads(...machines: RemoteMachine[]): MachineHead[] {
  return machineHeads(new Map(machines.map((each) => [each.state.machine, each]))).filter((head) => head.name !== null)
}

function info(overrides: Partial<MachinesInfo> = {}): MachinesInfo {
  return {
    known: true,
    list: [],
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    onGrant: vi.fn(),
    onUpdate: vi.fn(() => Promise.resolve()),
    onCheckActivity: vi.fn(() => Promise.resolve(null)),
    onCopyCommand: vi.fn(),
    onOpenLogin: vi.fn(),
    onRename: vi.fn(),
    hostKey: { inspect: vi.fn(), trust: vi.fn(() => Promise.resolve()) },
    add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn() },
    ...overrides,
  }
}

function renderPage(machines: MachinesInfo, appVersion = '0.46.0') {
  render(<QueryClientProvider client={new QueryClient()}><MachinesPage daemon={{ online: true, sessionCount: 7, version: '0.46.0' }} machines={machines} github={undefined} appVersion={appVersion} /></QueryClientProvider>)
  return userEvent.setup()
}

const rowOf = (name: string) => screen.getByRole('button', { name }).closest('[role="listitem"]') as HTMLElement
const names = () => within(screen.getByRole('list')).getAllByRole('listitem').map((item) => within(item).getAllByRole('button')[0]?.textContent)

describe('the machine list', () => {
  it('shows a placeholder until the host has answered, and cannot add yet', () => {
    renderPage(info({ known: false }))
    expect(screen.getByRole('status', { name: 'Reading machines' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add machine' })).toBeDisabled()
  })

  it('invites adding the first machine when there are none', async () => {
    const user = renderPage(info())
    expect(screen.getByText('No remote machines yet')).toBeInTheDocument()
    expect(screen.getByText(/Maiker connects over SSH, and their sessions show in your sidebar next to these\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add a machine' }))
    expect(screen.getByRole('region', { name: 'Add a machine' })).toBeInTheDocument()
  })

  it('says one thing about each machine, failed ones first and then the busiest', () => {
    const list = heads(
      machine(1, 'quiet', 'connected'),
      machine(2, 'busy', 'connected'),
      machine(3, 'older', 'needs-update', { why: OLDER }),
      machine(4, 'gone', 'unreachable', { why: 'no answer' }),
      machine(5, 'locked', 'needs-login', { said: 'me@locked.lan: Permission denied (publickey).' }),
    )
    const count: Record<number, number> = { 1: 1, 2: 6, 3: 2, 4: 0, 5: 0 }
    renderPage(info({ list, sessionsOn: (id) => count[id] ?? 0 }))
    expect(screen.getByText('5 machines')).toBeInTheDocument()
    expect(names()).toEqual(['gone', 'locked', 'older', 'busy', 'quiet'])
    expect(within(rowOf('gone')).getByText(/Can't reach it · 14 min/)).toBeInTheDocument()
    expect(within(rowOf('locked')).getByText('Key rejected')).toBeInTheDocument()
    expect(within(rowOf('older')).getByText('2 sessions · older Maiker')).toBeInTheDocument()
    expect(within(rowOf('busy')).getByText('6 sessions')).toBeInTheDocument()
    expect(within(rowOf('busy')).queryByRole('button', { name: /Retry|Fix|Update|Install/ })).toBeNull()
  })

  it('offers each machine at most the one fix its state needs', () => {
    const list = heads(machine(1, 'gone', 'unreachable'), machine(2, 'locked', 'needs-login'), machine(3, 'older', 'needs-update', { why: OLDER }), machine(4, 'bare', 'needs-update', { why: MISSING }), machine(5, 'fine', 'connected'))
    renderPage(info({ list }))
    expect(within(rowOf('gone')).getAllByRole('button').map((button) => button.textContent)).toEqual(['gone', 'Retry'])
    expect(within(rowOf('locked')).getAllByRole('button').map((button) => button.textContent)).toEqual(['locked', 'Fix'])
    expect(within(rowOf('older')).getAllByRole('button').map((button) => button.textContent)).toEqual(['older', 'Update'])
    expect(within(rowOf('bare')).getAllByRole('button').map((button) => button.textContent)).toEqual(['bare', 'Install'])
    expect(within(rowOf('fine')).getAllByRole('button')).toHaveLength(1)
  })

  it('retries in place without leaving the list', async () => {
    const onRetry = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'gone', 'unreachable')), onRetry }))
    await user.click(screen.getByRole('button', { name: 'Retry gone' }))
    expect(onRetry).toHaveBeenCalledWith('gone')
    expect(within(rowOf('gone')).getByText('Retrying…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry gone' })).toBeNull()
    expect(screen.getByText('1 machine')).toBeInTheDocument()
  })

  it('opens the page of a machine from its row, and Fix opens it too', async () => {
    const list = heads(machine(1, 'locked', 'needs-login', { said: 'x: Permission denied (publickey).' }), machine(2, 'fine', 'connected'))
    const user = renderPage(info({ list }))
    await user.click(screen.getByRole('button', { name: 'Fix locked' }))
    expect(screen.getByRole('heading', { name: 'locked' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'All machines' }))
    await user.click(screen.getByRole('button', { name: 'fine' }))
    expect(screen.getByRole('heading', { name: 'fine' })).toBeInTheDocument()
  })

  it('marks the machine you came back from', async () => {
    const user = renderPage(info({ list: heads(machine(1, 'fine', 'connected')) }))
    await user.click(screen.getByRole('button', { name: 'fine' }))
    await user.click(screen.getByRole('button', { name: 'All machines' }))
    expect(rowOf('fine')).toHaveAttribute('aria-current', 'true')
  })

  it('shows a search field only past twelve machines', () => {
    const many = (count: number) => heads(...Array.from({ length: count }, (_, index) => machine(index + 1, `host-${String(index + 1)}`, 'connected')))
    renderPage(info({ list: many(12) }))
    expect(screen.queryByRole('searchbox', { name: 'Find a machine' })).toBeNull()
  })

  it('finds a machine by name or address once there are many', async () => {
    const list = heads(...Array.from({ length: 13 }, (_, index) => machine(index + 1, `host-${String(index + 1)}`, 'connected')))
    const user = renderPage(info({ list }))
    await user.type(screen.getByRole('searchbox', { name: 'Find a machine' }), 'host-13')
    expect(names()).toEqual(['host-13'])
  })

  it('keeps this computer out of the list, with its version and sessions and a way to its details', async () => {
    const user = renderPage(info({ list: heads(machine(1, 'fine', 'connected')) }))
    expect(screen.getByText('0.46.0 · 7 sessions')).toBeInTheDocument()
    expect(names()).toEqual(['fine'])
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('region', { name: 'This computer' })).toBeInTheDocument()
  })
})

describe('updating from the list', () => {
  const older = (name: string, id: number) => machine(id, name, 'needs-update', { why: OLDER })

  it('asks what an update will interrupt before it runs, then updates in place', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const onCheckActivity = vi.fn(() => Promise.resolve({ sessions: 3, busy: 1, current: false }))
    const user = renderPage(info({ list: heads(older('devbox', 1)), onUpdate, onCheckActivity }))
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText(/devbox has 3 sessions open, 1 busy\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update devbox now' }))
    expect(onUpdate).toHaveBeenCalledWith('devbox', 'update', false)
  })

  it('can wait until nothing is open, or be cancelled', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const user = renderPage(info({ list: heads(older('devbox', 1)), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onUpdate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    await user.click(await screen.findByRole('button', { name: 'Update devbox when idle' }))
    expect(onUpdate).toHaveBeenCalledWith('devbox', 'update', true)
  })

  it('still asks when the machine cannot say what is open', async () => {
    const user = renderPage(info({ list: heads(older('devbox', 1)), onCheckActivity: vi.fn(() => Promise.reject(new Error('no route'))) }))
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    expect(await screen.findByText(/devbox could not say what is open on it\./)).toBeInTheDocument()
  })

  it('shows Updating… in the row while it runs, then lets the row say what it is', async () => {
    let finish: () => void = () => undefined
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const user = renderPage(info({ list: heads(older('devbox', 1)), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    await user.click(await screen.findByRole('button', { name: 'Update devbox now' }))
    expect(within(rowOf('devbox')).getByText('Updating…')).toBeInTheDocument()
    finish()
    await waitFor(() => { expect(screen.queryByText('Updating…')).toBeNull() })
  })

  it('installs on a machine with none after one question, without counting what is open', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const onCheckActivity = vi.fn(() => Promise.resolve(null))
    const user = renderPage(info({ list: heads(machine(1, 'bare', 'needs-update', { why: MISSING })), onUpdate, onCheckActivity }))
    await user.click(screen.getByRole('button', { name: 'Install bare' }))
    await user.click(screen.getByRole('button', { name: 'Install on bare now' }))
    expect(onUpdate).toHaveBeenCalledWith('bare', 'install', false)
    expect(onCheckActivity).not.toHaveBeenCalled()
  })

  it('offers Update all only from two machines, asks first, and updates each of them', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const user = renderPage(info({ list: heads(older('a', 1), older('b', 2), machine(3, 'c', 'connected')), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'Update all 2' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('Update 2 machines?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update all now' }))
    expect(onUpdate).toHaveBeenCalledWith('a', 'update', false)
    expect(onUpdate).toHaveBeenCalledWith('b', 'update', false)
  })

  it('has no Update all for a single machine', () => {
    renderPage(info({ list: heads(older('a', 1), machine(2, 'c', 'connected')) }))
    expect(screen.queryByRole('button', { name: /Update all/ })).toBeNull()
  })
})

describe("a machine's page", () => {
  it('says it is connected, with the sessions, and offers no fix', async () => {
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), sessionsOn: () => 2 }))
    await user.click(screen.getByRole('button', { name: 'devbox' }))
    expect(screen.getByRole('status')).toHaveTextContent('Connected · 2 sessions')
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.getByText('me@devbox.lan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retry|Try again|Update/ })).toBeNull()
  })

  it('renames the machine as you type, as a local label', async () => {
    const onRename = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onRename }))
    await user.click(screen.getByRole('button', { name: 'devbox' }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!')
    expect(onRename).toHaveBeenLastCalledWith('devbox', 'devbox!')
  })

  it('shows what is wrong with its one fix: how long it has been unreachable, and Retry now', async () => {
    const onRetry = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'gpu', 'unreachable', { why: 'Maiker keeps trying.' })), onRetry }))
    await user.click(screen.getByRole('button', { name: 'gpu' }))
    expect(screen.getByRole('status')).toHaveTextContent("Can't reach it for 14 min. Maiker keeps trying.")
    await user.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(onRetry).toHaveBeenCalledWith('gpu')
  })

  it('gives the command for a rejected key, with Copy, and tries again', async () => {
    const onRetry = vi.fn()
    const onCopyCommand = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'studio', 'needs-login', { said: 'me@studio.lan: Permission denied (publickey).' })), onRetry, onCopyCommand }))
    await user.click(screen.getByRole('button', { name: 'Fix studio' }))
    expect(screen.getByRole('status')).toHaveTextContent('Key rejected. Run this once on this computer, then try again.')
    await user.click(screen.getByRole('button', { name: 'Copy the ssh-copy-id command' }))
    expect(onCopyCommand).toHaveBeenCalledWith('ssh-copy-id me@studio.lan')
    expect(screen.getByText('Copied')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('studio')
  })

  it('shows the raw words under Details', async () => {
    const said = 'me@studio.lan: Permission denied (publickey).'
    const user = renderPage(info({ list: heads(machine(1, 'studio', 'needs-login', { said })) }))
    await user.click(screen.getByRole('button', { name: 'Fix studio' }))
    expect(screen.queryByText(said)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText(said)).toBeInTheDocument()
  })

  it('updates after asking, with the Update button on its Maiker row', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'needs-update', { why: OLDER })), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'devbox' }))
    expect(screen.getByText('Older · this computer has 0.46.0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update Maiker on devbox' }))
    await user.click(await screen.findByRole('button', { name: 'Update devbox now' }))
    expect(onUpdate).toHaveBeenCalledWith('devbox', 'update', false)
  })

  it('is off for the clipboard and notifications until allowed, and each switch asks for just its own power', async () => {
    const onGrant = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onGrant }))
    await user.click(screen.getByRole('button', { name: 'devbox' }))
    const clipboard = screen.getByRole('switch', { name: 'Allow devbox to copy to your clipboard' })
    const notices = screen.getByRole('switch', { name: 'Allow devbox to notify you' })
    expect(clipboard).toHaveAttribute('aria-checked', 'false')
    await user.click(notices)
    expect(onGrant).toHaveBeenCalledWith('devbox', 'notices', true)
    await user.click(clipboard)
    expect(onGrant).toHaveBeenLastCalledWith('devbox', 'clipboard', true)
  })

  it('asks before removing, says what stays, and goes back to the list', async () => {
    const onRemove = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onRemove }))
    await user.click(screen.getByRole('button', { name: 'devbox' }))
    await user.click(screen.getByRole('button', { name: 'Remove devbox…' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Its sessions stop showing here. Nothing on devbox is deleted.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRemove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove devbox…' }))
    await user.click(screen.getByRole('button', { name: 'Remove devbox' }))
    expect(onRemove).toHaveBeenCalledWith('devbox')
  })
})

describe('a host key on a machine that stopped on it', () => {
  const stopped = (rest: Partial<State> = {}) => heads(machine(1, 'new', 'needs-login', { said: 'Host key verification failed.', ...rest }))
  const report = (status: 'unknown' | 'changed'): HostKeyReport => (status === 'unknown'
    ? { status, host: 'new.lan', port: 22, key_type: 'ssh-ed25519', fingerprint: 'SHA256:abc' }
    : { status, host: 'new.lan', port: 22, key_type: 'ssh-ed25519', fingerprint: 'SHA256:new', known_fingerprint: 'SHA256:old' })

  it('shows its fingerprint and trusts it only when you say so', async () => {
    const trust = vi.fn(() => Promise.resolve())
    const user = renderPage(info({ list: stopped(), hostKey: { inspect: vi.fn(() => Promise.resolve(report('unknown'))), trust } }))
    await user.click(screen.getByRole('button', { name: 'Fix new' }))
    expect(await screen.findByText('First time connecting to new.')).toBeInTheDocument()
    expect(screen.getByText('SHA256:abc')).toBeInTheDocument()
    expect(trust).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Trust and connect' }))
    expect(trust).toHaveBeenCalledWith('new', 'SHA256:abc')
  })

  it('never offers to trust a key that changed', async () => {
    const user = renderPage(info({ list: stopped(), hostKey: { inspect: vi.fn(() => Promise.resolve(report('changed'))), trust: vi.fn() } }))
    await user.click(screen.getByRole('button', { name: 'Fix new' }))
    expect(await screen.findByText("new's identity changed since you last connected.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
  })
})

describe('adding a machine', () => {
  const hosts = [{ alias: 'build', detail: 'me@build.example' }, { alias: 'lab', detail: 'lab.example' }]
  const added = (name: string, reach: Extract<Added, { outcome: 'added' }>['reach'] = 'answered'): Added => ({ outcome: 'added', name, version: reach === 'older' ? '0.45.2' : null, reach, took_ms: 18 })
  const login = (name: string, said: string): Added => ({ outcome: 'login', name, target: `me@${name}.lan`, said, command: null })

  const open = async (add: Partial<MachinesInfo['add']> = {}, rest: Partial<MachinesInfo> = {}) => {
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), ...rest, add: { ...info().add, ...add } }))
    await user.click(screen.getByRole('button', { name: '+ Add machine' }))
    return user
  }
  const address = () => screen.getByRole('textbox', { name: 'Address' })

  it('says how it connects, in one field with a Connect button that waits for a valid address', async () => {
    await open()
    expect(screen.getByText('Maiker connects over SSH, using your keys. It never asks for or keeps passwords.')).toBeInTheDocument()
    expect(address()).toHaveAttribute('placeholder', 'user@host, or a name from your SSH config')
    expect(address()).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('lists the hosts of the SSH config, and connects the moment one is clicked', async () => {
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await open({ loadHosts: () => Promise.resolve(hosts), onAdd })
    await user.click(await screen.findByRole('button', { name: 'Connect to build' }))
    expect(onAdd).toHaveBeenCalledWith('build', 'build', undefined)
    expect(screen.queryByText('From your SSH config')).toBeNull()
  })

  it('says it is reading the config, then lists it, and filters it as you type', async () => {
    let answer: (list: typeof hosts) => void = () => undefined
    const user = await open({ loadHosts: () => new Promise((resolve) => { answer = resolve }) })
    expect(screen.getByRole('status', { name: /Reading hosts/ })).toBeInTheDocument()
    answer(hosts)
    expect(await screen.findByText('From your SSH config')).toBeInTheDocument()
    await user.type(address(), 'la')
    expect(screen.queryByRole('button', { name: 'Connect to build' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Connect to lab' })).toBeInTheDocument()
  })

  it('says why the config could not be read', async () => {
    await open({ loadHosts: () => Promise.reject(new Error('config unreadable')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('config unreadable')
  })

  it('connects a typed address on Enter, naming it from the address', async () => {
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(onAdd).toHaveBeenCalledWith('cydo@10.0.4.50', 'server-50', undefined)
    expect(screen.getByRole('status')).toHaveTextContent('Reaching server-50…')
  })

  it('sends a port that was typed', async () => {
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await open({ onAdd })
    await user.type(address(), 'me@box.example:2222{Enter}')
    expect(onAdd).toHaveBeenCalledWith('me@box.example', 'box', 2222)
  })

  it('shows what is wrong with an address only after Enter, hides it on editing, and sends nothing', async () => {
    const onAdd = vi.fn()
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.0.4')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('An IP address has 4 numbers, like 192.168.1.20. This one has 3.')
    await user.type(address(), '.9')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('shows the error when Connect is pressed on an invalid address', async () => {
    const user = await open()
    await user.type(address(), 'you @host')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(screen.getByRole('alert')).toHaveTextContent("An address can't have spaces.")
  })

  it('says a machine that is already in Maiker is already there', async () => {
    const onAdd = vi.fn()
    const user = await open({ onAdd })
    await user.type(address(), 'devbox{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('devbox is already in Maiker.')
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('cancels with Cancel or Esc, and keeps Settings and the screen', async () => {
    const onCancel = vi.fn()
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await open({ onAdd, onCancel })
    await user.type(address(), 'slow.example{Enter}')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).toBeNull()
    await user.type(address(), '{Enter}')
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('region', { name: 'Add a machine' })).toBeInTheDocument()
  })

  it('cancels the connection when you leave the screen', async () => {
    const onCancel = vi.fn()
    const user = await open({ onAdd: vi.fn().mockReturnValue(new Promise(() => undefined)), onCancel })
    await user.type(address(), 'slow.example{Enter}')
    await user.click(screen.getByRole('button', { name: 'Remote machines' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('goes back to the list by itself when it connects, with the machine marked as just added', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('server-50'))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText('1 machine')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Add a machine' })).toBeNull()
  })

  it('says a machine that does not answer cannot be reached, with the words ssh gave', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('ssh: connect to host 10.9.9.9 port 22: Connection timed out'))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.9.9.9{Enter}')
    expect(await screen.findByText("Can't reach 10.9.9.9.")).toBeInTheDocument()
    expect(screen.getByText("Check it's on, and on your network or VPN.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByText('ssh: connect to host 10.9.9.9 port 22: Connection timed out')).toBeInTheDocument()
  })

  it('says a refused port and a name that does not resolve in their own words', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('Connection refused')).mockRejectedValueOnce(new Error('Could not resolve hostname nope'))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.0.4.9:2200{Enter}')
    expect(await screen.findByText("It's on, but nothing is listening for SSH on port 2200.")).toBeInTheDocument()
    await user.clear(address())
    await user.type(address(), 'nope.example{Enter}')
    expect(await screen.findByText("Couldn't find a computer called nope.example. Check the spelling, or use its IP address.")).toBeInTheDocument()
  })

  it('tries the whole sequence again, and Edit address clears the block and focuses the field', async () => {
    const onAdd = vi.fn().mockRejectedValueOnce(new Error('timed out')).mockReturnValue(new Promise(() => undefined))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.9.9.9{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(onAdd).toHaveBeenCalledTimes(2)
    expect(onAdd).toHaveBeenLastCalledWith('cydo@10.9.9.9', 'server-9', undefined)
  })

  it('clears a failure when you type again', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('timed out'))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.9.9.9{Enter}')
    await screen.findByText("Can't reach 10.9.9.9.")
    await user.type(address(), '1')
    expect(screen.queryByText("Can't reach 10.9.9.9.")).toBeNull()
  })

  it('asks before installing Maiker, then installs it and goes back to the list', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('server-50', 'missing'))
    const onUpdate = vi.fn(() => Promise.resolve())
    const user = await open({ onAdd }, { onUpdate })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText("Maiker isn't on server-50 yet.")).toBeInTheDocument()
    expect(screen.getByText('It installs in ~/.maiker (about 40 MB). No admin rights needed.')).toBeInTheDocument()
    expect(onUpdate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Install Maiker' }))
    expect(onUpdate).toHaveBeenCalledWith('server-50', 'install', false)
    expect(await screen.findByText('1 machine')).toBeInTheDocument()
  })

  it('adds the machine without Maiker when asked to', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('server-50', 'missing'))
    const onUpdate = vi.fn()
    const user = await open({ onAdd }, { onUpdate })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Add without it' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Add a machine' })).toBeNull()
  })

  it('offers to update an older Maiker, or keep it', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('server-50', 'older'))
    const user = await open({ onAdd })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText('server-50 has an older Maiker (0.45.2).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Update it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep 0.45.2' })).toBeInTheDocument()
  })

  it('stays on the screen with the way back when the install fails', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('server-50', 'missing'))
    const user = await open({ onAdd }, { onUpdate: vi.fn(() => Promise.reject(new Error('no space'))) })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Install Maiker' }))
    expect(await screen.findByRole('button', { name: 'Install Maiker' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Add a machine' })).toBeInTheDocument()
  })

  it('says a key that was refused, with the command to run once', async () => {
    const onCopyCommand = vi.fn()
    const onAdd = vi.fn().mockResolvedValue(login('server-50', 'me@10.0.4.50: Permission denied (publickey).'))
    const user = await open({ onAdd }, { onCopyCommand })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText("server-50 didn't accept your key.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy the ssh-copy-id command' }))
    expect(onCopyCommand).toHaveBeenCalledWith('ssh-copy-id me@server-50.lan')
  })

  it('asks to trust a host key it has not seen, and shows the fingerprint', async () => {
    const onAdd = vi.fn().mockResolvedValue(login('server-50', 'Host key verification failed.'))
    const inspect = vi.fn(() => Promise.resolve<HostKeyReport>({ status: 'unknown', host: '10.0.4.50', port: 22, key_type: 'ssh-ed25519', fingerprint: 'SHA256:q3Vt9kQ0x1y' }))
    const user = await open({ onAdd }, { hostKey: { inspect, trust: vi.fn(() => Promise.resolve()) } })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText('First time connecting to server-50.')).toBeInTheDocument()
    expect(screen.getByText('SHA256:q3Vt9kQ0x1y')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trust and connect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit address' })).toBeInTheDocument()
  })

  it('says Maiker is installed but did not start, and tries again', async () => {
    const onRetry = vi.fn()
    const onAdd = vi.fn().mockResolvedValue(added('server-50', 'not-running'))
    const user = await open({ onAdd }, { onRetry })
    await user.type(address(), 'cydo@10.0.4.50{Enter}')
    expect(await screen.findByText("Maiker is installed on server-50 but couldn't start.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('server-50')
  })

  it('returns to the list from its breadcrumb', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Remote machines' }))
    expect(screen.getByText('1 machine')).toBeInTheDocument()
  })
})
