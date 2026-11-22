import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Added } from '@/api/machines'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { LOCAL_HEAD, type MachineHead } from '@/features/workspace/model/machines'
import { OpenProjectPalette, type PaletteStart } from './OpenProjectPalette'
import type { PaletteMachine } from './openPalette'
import type { PaletteServices } from './paletteShell'

type AddedOutcome = Extract<Added, { outcome: 'added' }>
const added = (extra: Partial<AddedOutcome> = {}): Added => ({ outcome: 'added', name: 'server-15', version: '0.46.0', reach: 'answered', took_ms: 90, reach_ms: 38, key: 'id_ed25519', ...extra })
const NO_ANSWER = "Can't reach 100.78.214.15: check the name or address, and that the machine is on."
const unreachable: Added = { outcome: 'failed', message: NO_ANSWER, failure: 'unreachable', fix_command: null }
const REFUSED_KEY = 'server-15 refused your key: run `ssh-copy-id dev@100.78.214.15` in a terminal, then try again.'
const refused: Added = { outcome: 'login', name: 'server-15', target: 'dev@100.78.214.15', said: 'Permission denied (publickey).', message: REFUSED_KEY, failure: 'key-refused', fix_command: 'ssh-copy-id dev@100.78.214.15', command: null }
const needsPerson: Added = { ...refused, message: 'server-15 asks for a password or a code.', failure: 'needs-person', fix_command: null }

const head = (name: string, machine: number, word = 'connected'): MachineHead => ({ ...LOCAL_HEAD, key: `machine-${String(machine)}`, machine, name, label: name, chip: { glyph: '●', word, tone: word === 'connected' ? 'ok' : 'bad' }, target: `dev@${name}.lan` })
const LOCAL: PaletteMachine = { machine: 0, name: null, label: 'This computer', address: null, ready: true, why: null, start: '/home/me/code' }
const NEW: PaletteMachine = { machine: 7, name: 'server-15', label: 'server-15', address: 'dev@100.78.214.15', ready: true, why: null, start: '~' }

function info(overrides: Partial<MachinesInfo> = {}, add: Partial<MachinesInfo['add']> = {}): MachinesInfo {
  return {
    known: true, list: [], onRetry: vi.fn(), onRemove: vi.fn(() => Promise.resolve(true)), onGrant: vi.fn(), onUpdate: vi.fn(() => Promise.resolve()), onCheckActivity: vi.fn(() => Promise.resolve(null)),
    onCopyCommand: vi.fn(), onOpenLogin: vi.fn(), onRename: vi.fn(),
    add: { loadHosts: () => Promise.resolve([{ alias: 'build', detail: 'me@build.example', added: false }]), onAdd: vi.fn(() => Promise.resolve(added())), onCancel: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn(), ...add },
    ...overrides,
  }
}

const SERVICES: PaletteServices = {
  list: (_machine, path) => Promise.resolve({ path, exists: true, entries: [{ name: 'infra', git: 'main', has_children: true }], truncated: false, can_create: true }),
  create: (_machine, parent, name) => Promise.resolve({ kind: 'created', path: `${parent}/${name}` }),
  closed: () => Promise.resolve([]),
  chooseSystemFolder: null,
}

function show(adding: MachinesInfo, { start = { kind: 'machine' }, machines = [LOCAL] }: { start?: PaletteStart; machines?: readonly PaletteMachine[] } = {}) {
  const onClose = vi.fn()
  const view = render(<OpenProjectPalette mode="open" start={start} machines={machines} localOs="linux" home="/home/me" opened={[]} onTake={() => Promise.resolve()} adding={adding} onClose={onClose} services={SERVICES} />)
  return { onClose, view, user: userEvent.setup(), field: () => screen.getByRole('combobox') }
}

/** A host that answers only when the test says so. */
function answerLater() {
  let answer: (result: Added) => void = () => undefined
  const onAdd = vi.fn(() => new Promise<Added>((resolve) => { answer = resolve }))
  return { onAdd, answer: async (result: Added) => { await act(async () => { answer(result); await Promise.resolve() }) } }
}

describe('New machine, the field', () => {
  it('is reached from the sources, and Backspace on the empty field goes back to them', async () => {
    const { user, field } = show(info(), { start: { kind: 'sources' } })
    await user.type(field(), 'add a remote{Enter}')
    expect(await screen.findByRole('option', { name: /build/ })).toBeInTheDocument()
    await user.type(field(), '{Backspace}')
    expect(await screen.findByRole('option', { name: /This computer/ })).toBeInTheDocument()
  })

  it('answers a wrong address in words after Enter, and sends nothing', async () => {
    const machines = info()
    const { user, field } = show(machines)
    await user.type(field(), 'me@10.0.4{Enter}')
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(machines.add.onAdd).not.toHaveBeenCalled()
    expect(field()).toHaveValue('me@10.0.4')
  })

  it('sends the port and the key file typed under Options, with Enter from either', async () => {
    const machines = info()
    const { user, field } = show(machines)
    await user.type(field(), 'dev@10.0.4.12')
    await user.click(screen.getByRole('button', { name: 'Options' }))
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '2222')
    await user.type(screen.getByRole('textbox', { name: 'Key file' }), '~/.ssh/work_ed25519{Enter}')
    await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalledWith('dev@10.0.4.12', 'server-12', 2222, { keyFile: '~/.ssh/work_ed25519', installHelper: true }) })
  })

  it('adds a host of the SSH config when its row is chosen, under its alias', async () => {
    const machines = info()
    const { user } = show(machines)
    await user.click(await screen.findByRole('option', { name: /build/ }))
    await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalledWith('build', 'build', undefined, { keyFile: null, installHelper: true }) })
  })

  it('browses a machine that is already added instead of adding it again', async () => {
    const machines = info({ list: [{ ...head('server-15', 7), target: 'dev@100.78.214.15' }] })
    const { user, field } = show(machines, { machines: [LOCAL, NEW] })
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    expect(await screen.findByRole('option', { name: /infra/ })).toBeInTheDocument()
    expect(machines.add.onAdd).not.toHaveBeenCalled()
  })
})

describe('New machine, after Enter', () => {
  it('waits on one line with no steps, then asks only for a name', async () => {
    const later = answerLater()
    const machines = info({}, { onAdd: later.onAdd })
    const { user, field, onClose } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
    await later.answer(added())
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('server-15')
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(machines.onRemove).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Done closes and keeps the machine, with the name it was given', async () => {
    const machines = info()
    const { user, field, onClose } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Lab')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(machines.onRename).toHaveBeenCalledWith('server-15', 'Lab')
    expect(onClose).toHaveBeenCalled()
    expect(machines.onRemove).not.toHaveBeenCalled()
  })

  it('Enter in the Name field browses the new machine’s folders, and an untouched name renames nothing', async () => {
    const machines = info({ list: [head('server-15', 7)] }, { onAdd: vi.fn(() => Promise.resolve(added())) })
    // The window lists the machine only once it is in; here it is listed from the start, and found by another address.
    const { user, field } = show(machines, { machines: [LOCAL, NEW] })
    await user.type(field(), 'dev@100.78.214.99{Enter}')
    await user.type(await screen.findByRole('textbox', { name: 'Name' }), '{Enter}')
    expect(await screen.findByRole('option', { name: /infra/ })).toBeInTheDocument()
    expect(machines.onRename).not.toHaveBeenCalled()
  })

  it('Cancel during the wait ends the look and gives the field back, as typed', async () => {
    const machines = info({}, { onAdd: vi.fn(() => new Promise<Added>(() => undefined)) })
    const { user, field, onClose } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(machines.add.onCancel).toHaveBeenCalled()
    expect(field()).toHaveValue('dev@100.78.214.15')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes out a machine a cancelled add saved after all, so nothing unseen is left', async () => {
    const later = answerLater()
    const machines = info({}, { onAdd: later.onAdd })
    const { user, field } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await later.answer(refused)
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('cancels the look when the palette closes during the wait', async () => {
    const machines = info({}, { onAdd: vi.fn(() => new Promise<Added>(() => undefined)) })
    const { user, field, view } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await screen.findByRole('button', { name: 'Cancel' })
    view.unmount()
    expect(machines.add.onCancel).toHaveBeenCalled()
  })
})

describe('New machine, when it fails', () => {
  it('says the host’s one sentence and nothing else, and Enter tries again', async () => {
    const onAdd = vi.fn(() => Promise.resolve(unreachable))
    const machines = info({}, { onAdd })
    const { user, field } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(NO_ANSWER)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByLabelText(/password/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => { expect(onAdd).toHaveBeenCalledTimes(2) })
  })

  it('Edit the address gives the field back as typed, and Backspace does the same', async () => {
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(unreachable)) })
    const { user, field } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Edit the address' }))
    expect(field()).toHaveValue('dev@100.78.214.15')
    expect(screen.queryByRole('alert')).toBeNull()
    await user.type(field(), '{Enter}')
    await screen.findByRole('alert')
    await user.keyboard('{Backspace}')
    expect(field()).toHaveValue('dev@100.78.214.15')
  })

  it('copies the command the sentence names, and takes the saved machine out before trying again', async () => {
    const onAdd = vi.fn(() => Promise.resolve(refused))
    const machines = info({}, { onAdd })
    const { user, field } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED_KEY)
    await user.click(screen.getByRole('button', { name: 'Copy the command' }))
    expect(machines.onCopyCommand).toHaveBeenCalledWith('ssh-copy-id dev@100.78.214.15')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(onAdd).toHaveBeenCalledTimes(2) })
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
  })

  it('takes out the machine a failed try saved when the palette closes', async () => {
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(refused)) })
    const { user, field, view } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await screen.findByRole('alert')
    view.unmount()
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
  })

  it('offers the terminal sign-in only for a login that needs a person, and keeps the machine for it', async () => {
    const machines = info({ list: [head('server-15', 7, 'needs login')] }, { onAdd: vi.fn(() => Promise.resolve(needsPerson)) })
    const { user, field, view, onClose } = show(machines)
    await user.type(field(), 'dev@100.78.214.99{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Sign in in a terminal' }))
    expect(machines.onOpenLogin).toHaveBeenCalledWith(7)
    expect(onClose).toHaveBeenCalled()
    view.unmount()
    expect(machines.onRemove).not.toHaveBeenCalled()
  })

  it('has no terminal sign-in for a refused key', async () => {
    const machines = info({ list: [head('server-15', 7, 'needs login')] }, { onAdd: vi.fn(() => Promise.resolve(refused)) })
    const { user, field } = show(machines)
    await user.type(field(), 'dev@100.78.214.99{Enter}')
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Sign in in a terminal' })).toBeNull()
  })

  it('shows the machine as added when the one it saved connects after all', async () => {
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(refused)) })
    const { user, field, view } = show(machines)
    await user.type(field(), 'dev@100.78.214.15{Enter}')
    await screen.findByRole('alert')
    view.rerender(<OpenProjectPalette mode="open" start={{ kind: 'machine' }} machines={[LOCAL, NEW]} localOs="linux" home="/home/me" opened={[]} onTake={() => Promise.resolve()} adding={{ ...machines, list: [head('server-15', 7)] }} onClose={vi.fn()} services={SERVICES} />)
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeInTheDocument()
  })
})
