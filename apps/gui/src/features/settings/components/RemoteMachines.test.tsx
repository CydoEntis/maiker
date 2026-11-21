import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { machineHeads, type MachineHead, type RemoteMachine } from '@/features/workspace/model/machines'
import type { MachinesInfo } from './DesktopSettings'
import { MachinesPage } from './MachinesPage'

vi.mock('@/TerminalView', () => ({ TerminalView: ({ conversation }: { conversation: { id: string } }) => <div data-testid="key-terminal">{conversation.id}</div> }))

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
    add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn(), inspect: vi.fn(), trust: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn() },
    ...overrides,
  }
}

function renderPage(machines: MachinesInfo, appVersion = '0.46.0') {
  render(<QueryClientProvider client={new QueryClient()}><MachinesPage daemon={{ online: true, sessionCount: 7, version: '0.46.0' }} machines={machines} github={undefined} appVersion={appVersion} /></QueryClientProvider>)
  return userEvent.setup()
}

const rowOf = (name: string) => screen.getByRole('listitem', { name })
const names = () => within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))
const buttonsOf = (name: string) => within(rowOf(name)).getAllByRole('button').map((button) => button.textContent)

describe('the machine list', () => {
  it('shows a placeholder until the host has answered, and cannot add yet', () => {
    renderPage(info({ known: false }))
    expect(screen.getByRole('status', { name: 'Reading machines' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add machine' })).toBeDisabled()
  })

  it('invites adding the first machine when there are none', async () => {
    const open = vi.fn()
    const user = renderPage(info({ add: { ...info().add, open } }))
    expect(screen.getByText('No remote machines yet')).toBeInTheDocument()
    expect(screen.getByText(/Maiker connects over SSH, and their sessions show in your sidebar next to these\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '+ Add a machine' }))
    expect(open).toHaveBeenCalledTimes(1)
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
    expect(buttonsOf('gone')).toEqual(['Retry', 'More', 'Remove'])
    expect(buttonsOf('locked')).toEqual(['Fix', 'More', 'Remove'])
    expect(buttonsOf('older')).toEqual(['Update', 'More', 'Remove'])
    expect(buttonsOf('bare')).toEqual(['Install', 'More', 'Remove'])
    expect(buttonsOf('fine')).toEqual(['More', 'Remove'])
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

  it('has no page per machine: More folds its settings open under its row, and Fix opens that fold', async () => {
    const list = heads(machine(1, 'locked', 'needs-login', { said: 'x: Permission denied (publickey).' }), machine(2, 'fine', 'connected'))
    const user = renderPage(info({ list }))
    const more = screen.getByRole('button', { name: 'More about fine' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await user.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(rowOf('fine')).getByRole('group', { name: 'More about fine' })).toBeInTheDocument()
    expect(screen.queryByRole('heading')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Fix locked' }))
    expect(within(rowOf('locked')).getByRole('group', { name: 'More about locked' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'More about fine' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More about locked' }))
    expect(screen.queryByRole('group')).toBeNull()
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

describe("a machine's More fold", () => {
  const unfold = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole('button', { name: `More about ${name}` }))
    return screen.getByRole('group', { name: `More about ${name}` })
  }

  it('says where it is and that its Maiker is up to date, and offers no fix when it is connected', async () => {
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), sessionsOn: () => 2 }))
    const fold = await unfold(user, 'devbox')
    expect(within(fold).getByText('Up to date')).toBeInTheDocument()
    expect(within(fold).getByText('me@devbox.lan')).toBeInTheDocument()
    expect(within(fold).queryByRole('status')).toBeNull()
    expect(within(fold).queryByRole('button')).toBeNull()
  })

  it('renames the machine as you type, as a local label', async () => {
    const onRename = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onRename }))
    const fold = await unfold(user, 'devbox')
    await user.type(within(fold).getByRole('textbox', { name: 'Name' }), '!')
    expect(onRename).toHaveBeenLastCalledWith('devbox', 'devbox!')
  })

  it('says how long a machine that is down has been unreachable, and why; Retry stays on the row', async () => {
    const onRetry = vi.fn()
    const said = 'ssh: connect to host gpu.lan port 22: No route to host'
    const user = renderPage(info({ list: heads(machine(1, 'gpu', 'unreachable', { why: 'Maiker keeps trying.', said })), onRetry }))
    const fold = await unfold(user, 'gpu')
    expect(within(fold).getByRole('status')).toHaveTextContent("Can't reach it for 14 min. Maiker keeps trying.")
    expect(within(fold).queryByRole('button', { name: /Retry|Try again/ })).toBeNull()
    await user.click(within(fold).getByRole('button', { name: 'Details' }))
    expect(within(fold).getByText(said)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry gpu' }))
    expect(onRetry).toHaveBeenCalledWith('gpu')
  })

  it('gives a rejected login its command with Copy, Try again and a terminal to sign in', async () => {
    const onRetry = vi.fn()
    const onCopyCommand = vi.fn()
    const onOpenLogin = vi.fn()
    const user = renderPage(info({ list: heads(machine(7, 'studio', 'needs-login', { said: 'me@studio.lan: Permission denied (publickey).' })), onRetry, onCopyCommand, onOpenLogin }))
    await user.click(screen.getByRole('button', { name: 'Fix studio' }))
    const fold = screen.getByRole('group', { name: 'More about studio' })
    expect(within(fold).getByRole('status')).toHaveTextContent('Key rejected. Run this once on this computer, then try again.')
    await user.click(within(fold).getByRole('button', { name: 'Copy the ssh-copy-id command' }))
    expect(onCopyCommand).toHaveBeenCalledWith('ssh-copy-id me@studio.lan')
    expect(within(fold).getByText('Copied')).toBeInTheDocument()
    await user.click(within(fold).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('studio')
    await user.click(within(fold).getByRole('button', { name: 'Open a terminal' }))
    expect(onOpenLogin).toHaveBeenCalledWith(7)
  })

  it('says its Maiker is older, while Update stays on the row', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'needs-update', { why: OLDER })), onUpdate }))
    const fold = await unfold(user, 'devbox')
    expect(within(fold).getByText('Older · this computer has 0.46.0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update devbox' }))
    await user.click(await screen.findByRole('button', { name: 'Update devbox now' }))
    expect(onUpdate).toHaveBeenCalledWith('devbox', 'update', false)
  })

  it('is off for the clipboard and notifications until allowed, and each switch asks for just its own power', async () => {
    const onGrant = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onGrant }))
    const fold = await unfold(user, 'devbox')
    const clipboard = within(fold).getByRole('switch', { name: 'Allow devbox to copy to your clipboard' })
    const notices = within(fold).getByRole('switch', { name: 'Allow devbox to notify you' })
    expect(clipboard).toHaveAttribute('aria-checked', 'false')
    expect(notices).toHaveAttribute('aria-checked', 'false')
    await user.click(notices)
    expect(onGrant).toHaveBeenCalledWith('devbox', 'notices', true)
    await user.click(clipboard)
    expect(onGrant).toHaveBeenLastCalledWith('devbox', 'clipboard', true)
    expect(onGrant).toHaveBeenCalledTimes(2)
  })

  it('turns a switch that is on back off', async () => {
    const onGrant = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected', { clipboard: true, notices: true })), onGrant }))
    const fold = await unfold(user, 'devbox')
    await user.click(within(fold).getByRole('switch', { name: 'Allow devbox to copy to your clipboard' }))
    expect(onGrant).toHaveBeenCalledWith('devbox', 'clipboard', false)
    await user.click(within(fold).getByRole('switch', { name: 'Allow devbox to notify you' }))
    expect(onGrant).toHaveBeenLastCalledWith('devbox', 'notices', false)
  })
})

describe('removing a machine from its row', () => {
  it('asks first, says what stays, and can be cancelled', async () => {
    const onRemove = vi.fn(() => Promise.resolve(true))
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), onRemove }))
    await user.click(screen.getByRole('button', { name: 'Remove devbox…' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(within(rowOf('devbox')).getByRole('status')).toHaveTextContent('Remove devbox? Its sessions stop showing here. Nothing on devbox is deleted.')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Remove devbox' })).toBeNull()
  })

  it('removes the machine once you say so', async () => {
    const onRemove = vi.fn(() => Promise.resolve(true))
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected'), machine(2, 'gpu', 'unreachable')), onRemove }))
    await user.click(screen.getByRole('button', { name: 'Remove gpu…' }))
    await user.click(screen.getByRole('button', { name: 'Remove gpu' }))
    expect(onRemove).toHaveBeenCalledWith('gpu')
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Remove gpu' })).toBeNull()
  })
})

describe('adding a machine from Settings', () => {
  it('opens the Add a remote machine dialog from + Add machine, not a page of its own', async () => {
    const open = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'devbox', 'connected')), add: { ...info().add, open } }))
    await user.click(screen.getByRole('button', { name: '+ Add machine' }))
    expect(open).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Add a machine' })).toBeNull()
  })
})
