import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { machineHeads, type MachineHead, type RemoteMachine } from '@/features/workspace/model/machines'
import type { MachinesInfo } from './DesktopSettings'
import { MachinesPage } from './MachinesPage'

vi.mock('@/TerminalView', () => ({ TerminalView: ({ conversation }: { conversation: { id: string } }) => <div data-testid="key-terminal">{conversation.id}</div> }))

type State = RemoteMachine['state']
/** The host's sentences and failure kinds (crates/maitty-machines link_failure), NAME standing for the machine. */
const OLDER: Partial<State> = { why: 'NAME runs an older Maiker: run `maiker machine update NAME`, then try again.', failure: 'update', fix_command: 'maiker machine update NAME' }
const MISSING: Partial<State> = { why: "Maiker isn't installed on NAME: run `maiker machine update NAME --install` (Linux and macOS machines only), then try again.", failure: 'install', fix_command: 'maiker machine update NAME --install' }
const REFUSED_KEY: Partial<State> = { why: 'NAME refused your key: run `ssh-copy-id me@NAME.lan` in a terminal, then try again.', failure: 'key-refused', fix_command: 'ssh-copy-id me@NAME.lan' }

function machine(id: number, name: string, state: State['state'], extra: Partial<State> = {}): RemoteMachine {
  const named = (text: string | null | undefined) => text?.replaceAll('NAME', name) ?? null
  const why = named(extra.why)
  const fixCommand = named(extra.fix_command)
  return { state: { machine: id, name, state, why, attempt: null, since: Date.now() - 14 * 60_000, target: `me@${name}.lan`, ...extra, ...(why === null ? {} : { why }), ...(fixCommand === null ? {} : { fix_command: fixCommand }) }, conversations: [], heard: true, listedAt: 0 }
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
    add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn() },
    ...overrides,
  }
}

function renderPage(machines: MachinesInfo, appVersion = '0.46.0') {
  render(<QueryClientProvider client={new QueryClient()}><MachinesPage daemon={{ online: true, sessionCount: 7, version: '0.46.0' }} machines={machines} github={undefined} appVersion={appVersion} /></QueryClientProvider>)
  return userEvent.setup()
}

const rowOf = (name: string) => screen.getByRole('listitem', { name })
const names = () => within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))

describe('the machine list', () => {

  it('retries in place without leaving the list', async () => {
    const onRetry = vi.fn()
    const user = renderPage(info({ list: heads(machine(1, 'gone', 'unreachable')), onRetry }))
    await user.click(screen.getByRole('button', { name: 'Retry gone' }))
    expect(onRetry).toHaveBeenCalledWith('gone')
    expect(within(rowOf('gone')).getByText('Retrying…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry gone' })).toBeNull()
    expect(screen.getByText('1 machine')).toBeInTheDocument()
  })

  it('finds a machine by name or address once there are many', async () => {
    const list = heads(...Array.from({ length: 13 }, (_, index) => machine(index + 1, `host-${String(index + 1)}`, 'connected')))
    const user = renderPage(info({ list }))
    await user.type(screen.getByRole('searchbox', { name: 'Find a machine' }), 'host-13')
    expect(names()).toEqual(['host-13'])
  })
})

describe('updating from the list', () => {
  const older = (name: string, id: number) => machine(id, name, 'needs-update', OLDER)

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

  it('installs on a machine with none after one question, without counting what is open', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const onCheckActivity = vi.fn(() => Promise.resolve(null))
    const user = renderPage(info({ list: heads(machine(1, 'bare', 'needs-update', MISSING)), onUpdate, onCheckActivity }))
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
})

describe("a machine's More fold", () => {
  const unfold = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
    await user.click(screen.getByRole('button', { name: `More about ${name}` }))
    return screen.getByRole('group', { name: `More about ${name}` })
  }

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

  it('gives a rejected key the host\'s sentence and its command with Copy and Try again, but no terminal', async () => {
    const onRetry = vi.fn()
    const onCopyCommand = vi.fn()
    const user = renderPage(info({ list: heads(machine(7, 'studio', 'needs-login', { ...REFUSED_KEY, said: 'me@studio.lan: Permission denied (publickey).' })), onRetry, onCopyCommand }))
    await user.click(screen.getByRole('button', { name: 'Fix studio' }))
    const fold = screen.getByRole('group', { name: 'More about studio' })
    expect(within(fold).getByRole('status')).toHaveTextContent('Key rejected. studio refused your key: run `ssh-copy-id me@studio.lan` in a terminal, then try again.')
    expect(within(fold).queryByRole('button', { name: 'Open a terminal' })).toBeNull()
    await user.click(within(fold).getByRole('button', { name: 'Copy the command' }))
    expect(onCopyCommand).toHaveBeenCalledWith('ssh-copy-id me@studio.lan')
    expect(within(fold).getByText('Copied')).toBeInTheDocument()
    await user.click(within(fold).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('studio')
  })

  it('offers the terminal sign-in only for a password or a second code, with the host\'s sentence', async () => {
    const onOpenLogin = vi.fn()
    const why = "studio asks for a password or a second code, which Maiker can't answer: set up a key, or sign in in a terminal."
    const user = renderPage(info({ list: heads(machine(7, 'studio', 'needs-login', { why, failure: 'needs-person' })), onOpenLogin }))
    await user.click(screen.getByRole('button', { name: 'Fix studio' }))
    const fold = screen.getByRole('group', { name: 'More about studio' })
    expect(within(fold).getByRole('status')).toHaveTextContent(`Needs a sign-in. ${why}`)
    await user.click(within(fold).getByRole('button', { name: 'Open a terminal' }))
    expect(onOpenLogin).toHaveBeenCalledWith(7)
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
    await user.click(screen.getByRole('button', { name: 'More about devbox' }))
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
    await user.click(screen.getByRole('button', { name: 'More about gpu' }))
    await user.click(screen.getByRole('button', { name: 'Remove gpu…' }))
    await user.click(screen.getByRole('button', { name: 'Remove gpu' }))
    expect(onRemove).toHaveBeenCalledWith('gpu')
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Remove gpu' })).toBeNull()
  })
})

describe('a machine whose host key changed', () => {
  const why = "new's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R 'new.lan'` in a terminal and try again."
  const stopped = () => heads(machine(1, 'new', 'needs-login', { why, failure: 'host-key-changed', fix_command: "ssh-keygen -R 'new.lan'", said: 'Host key verification failed.' }))

  it('says so with the host\'s sentence and Try again, never offering to trust the key', async () => {
    const onRetry = vi.fn()
    const user = renderPage(info({ list: stopped(), onRetry }))
    await user.click(screen.getByRole('button', { name: 'Fix new' }))
    const fold = screen.getByRole('group', { name: 'More about new' })
    expect(within(fold).getByRole('status')).toHaveTextContent(`Host key changed. ${why}`)
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    expect(screen.queryByText(/ssh-copy-id/)).toBeNull()
    await user.click(within(fold).getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('new')
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
