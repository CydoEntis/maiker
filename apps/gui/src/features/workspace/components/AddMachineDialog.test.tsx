import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Added } from '@/api/machines'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'

import { AddMachineDialog } from './AddMachineDialog'

type AddedOutcome = Extract<Added, { outcome: 'added' }>
const added = (extra: Partial<AddedOutcome> = {}): Added => ({ outcome: 'added', name: 'server-15', version: '0.46.0', reach: 'answered', took_ms: 90, reach_ms: 38, key: 'id_ed25519', ...extra })
const REFUSED_KEY = 'server-15 refused your key: run `ssh-copy-id dev@100.78.214.15` in a terminal, then try again.'
const refused: Added = { outcome: 'login', name: 'server-15', target: 'dev@100.78.214.15', said: 'dev@100.78.214.15: Permission denied (publickey).', message: REFUSED_KEY, failure: 'key-refused', fix_command: 'ssh-copy-id dev@100.78.214.15', command: null }

const connectedHead = (name = 'server-15', machine = 3): MachineHead => ({ ...LOCAL_HEAD, key: `machine-${String(machine)}`, machine, name, label: name, chip: { glyph: '●', word: 'connected', tone: 'ok' }, target: 'dev@server-15.lan' })

function info(overrides: Partial<MachinesInfo> = {}, add: Partial<MachinesInfo['add']> = {}): MachinesInfo {
  return {
    known: true,
    list: [],
    onRetry: vi.fn(),
    onRemove: vi.fn(() => Promise.resolve(true)),
    onGrant: vi.fn(),
    onUpdate: vi.fn(() => Promise.resolve()),
    onCheckActivity: vi.fn(() => Promise.resolve(null)),
    onCopyCommand: vi.fn(),
    onOpenLogin: vi.fn(),
    onRename: vi.fn(),
    add: {
      loadHosts: () => Promise.resolve([{ alias: 'build', detail: 'me@build.example', added: false }, { alias: 'kingdom', detail: 'dev@kingdom.lan', added: true }]),
      onAdd: vi.fn(() => Promise.resolve(added())),
      onCancel: vi.fn(),
      onProgress: vi.fn(() => Promise.resolve(vi.fn())),
      open: vi.fn(),
      ...add,
    },
    ...overrides,
  }
}

/** Types an address into the dialog and presses Enter. */
async function connectTo(machines: MachinesInfo, address = 'dev@100.78.214.15', props: Partial<Parameters<typeof AddMachineDialog>[0]> = {}) {
  const view = render(<AddMachineDialog machines={machines} onClose={vi.fn()} {...props} />)
  const user = userEvent.setup()
  await user.type(await screen.findByRole('textbox', { name: 'Address' }), `${address}{Enter}`)
  return { user, view }
}

describe('the field', () => {

  it('answers a wrong address in plain words after Enter, and sends nothing', async () => {
    const machines = info()
    await connectTo(machines, 'me@10.0.4')
    expect(await screen.findByRole('alert')).toHaveTextContent('That IP address is incomplete.')
    expect(machines.add.onAdd).not.toHaveBeenCalled()
  })

  it('sends the port and the key file typed under Port and key', async () => {
    const machines = info()
    const view = render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Address' }), 'dev@10.0.4.12')
    await user.click(screen.getByRole('button', { name: 'Port and key' }))
    await user.type(screen.getByRole('textbox', { name: 'Port' }), '2222')
    await user.type(screen.getByRole('textbox', { name: 'Key file' }), '~/.ssh/work_ed25519{Enter}')
    await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalled() })
    expect(machines.add.onAdd).toHaveBeenCalledWith('dev@10.0.4.12', 'server-12', 2222, { keyFile: '~/.ssh/work_ed25519', installHelper: true })
    view.unmount()
  })

  it('adds a host of the SSH config the moment it is clicked, and keeps its name', async () => {
    const machines = info()
    render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Add build' }))
    await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalledWith('build', 'build', undefined, { keyFile: null, installHelper: true }) })
  })

  describe('a host of the SSH config that is already a machine', () => {
    const kingdom = (word: string, tone: 'ok' | 'bad'): MachineHead => ({ ...connectedHead('kingdom', 5), target: 'kingdom', chip: { glyph: '●', word, tone } })

    it('opens where machines are managed when it is connected, and adds nothing', async () => {
      const onOpenSettings = vi.fn()
      const machines = info({ list: [kingdom('connected', 'ok')] })
      render(<AddMachineDialog machines={machines} onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
      await userEvent.setup().click(await screen.findByRole('button', { name: 'kingdom: Already added' }))
      expect(onOpenSettings).toHaveBeenCalled()
      expect(machines.add.onAdd).not.toHaveBeenCalled()
    })
  })

  it('opens where machines are managed when a typed address is already a machine, and adds nothing', async () => {
    const onOpenSettings = vi.fn()
    const machines = info({ list: [{ ...connectedHead('build'), target: 'me@build.example' }] })
    await connectTo(machines, 'me@build.example', { onOpenSettings })
    expect(onOpenSettings).toHaveBeenCalled()
    expect(machines.add.onAdd).not.toHaveBeenCalled()
    expect(machines.onRetry).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^(Retry|Remove) build$/ })).toBeNull()
  })
})


/** A host that answers only when the test says so. */
function answerLater() {
  let answer: (result: Added) => void = () => undefined
  const onAdd = vi.fn(() => new Promise<Added>((resolve) => { answer = resolve }))
  return { onAdd, answer: async (result: Added) => { await act(async () => { answer(result); await Promise.resolve() }) } }
}

describe('after Add', () => {
  it('spins on one line while the host connects, with no steps, and closes with the machine in once it answers', async () => {
    const later = answerLater()
    const onClose = vi.fn()
    const machines = info({}, { onAdd: later.onAdd })
    await connectTo(machines, 'dev@100.78.214.15', { onClose })
    expect(await screen.findByText('Connecting to 100.78.214.15…')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Steps to connect' })).toBeNull()
    expect(machines.add.onAdd).toHaveBeenCalledWith('dev@100.78.214.15', 'server-15', undefined, { keyFile: null, installHelper: true })
    expect(onClose).not.toHaveBeenCalled()
    await later.answer(added())
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(machines.onRemove).not.toHaveBeenCalled()
    expect(screen.queryByText('Machine added')).toBeNull()
  })

  it('Cancel during the spinner ends the look and gives the field back, as typed', async () => {
    const onClose = vi.fn()
    const machines = info({}, { onAdd: vi.fn(() => new Promise<Added>(() => undefined)) })
    const { user } = await connectTo(machines, 'dev@100.78.214.15', { onClose })
    await screen.findByText('Connecting to 100.78.214.15…')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(machines.add.onCancel).toHaveBeenCalled()
    expect(screen.queryByText('Connecting to 100.78.214.15…')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('dev@100.78.214.15')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('takes out a machine a cancelled add saved after all, so nothing unseen is left', async () => {
    const later = answerLater()
    const machines = info({}, { onAdd: later.onAdd })
    const { user } = await connectTo(machines)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await later.answer(refused)
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
    expect(screen.queryByText(REFUSED_KEY)).toBeNull()
  })

  it('cancels the look when the dialog closes during the spinner', async () => {
    const machines = info({}, { onAdd: vi.fn(() => new Promise<Added>(() => undefined)) })
    const { view } = await connectTo(machines)
    await screen.findByText('Connecting to 100.78.214.15…')
    view.unmount()
    expect(machines.add.onCancel).toHaveBeenCalled()
  })
})

describe('a failure', () => {
  const UNREACHED = "Can't reach 10.9.9.9: check the name or address, and that the machine is on (ssh: connect to host 10.9.9.9 port 22: Connection timed out)."
  const CHANGED = "100.78.214.15's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R '100.78.214.15'` in a terminal and try again."
  const unreachable: Added = { outcome: 'failed', message: UNREACHED, failure: 'unreachable', fix_command: null }
  const changed: Added = { outcome: 'failed', message: CHANGED, failure: 'host-key-changed', fix_command: "ssh-keygen -R '100.78.214.15'" }
  // The machine the host saved for a login it could not do, as the window then lists it.
  const savedHead: MachineHead = { ...connectedHead(), chip: { glyph: '!', word: 'needs login', tone: 'bad' }, target: 'dev@100.78.214.15' }

  it('says a machine that does not answer in the host\'s one sentence, with Try again', async () => {
    await connectTo(info({}, { onAdd: vi.fn(() => Promise.resolve(unreachable)) }), 'dev@10.9.9.9')
    expect(await screen.findByText(UNREACHED)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy the command' })).toBeNull()
  })

  it('says a changed host key in its sentence with its command to copy, never as unreachable and never with Trust', async () => {
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(changed)) })
    const { user } = await connectTo(machines)
    expect(await screen.findByText(CHANGED)).toBeInTheDocument()
    expect(screen.queryByText(/couldn't reach|unreachable/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Copy the command' }))
    expect(machines.onCopyCommand).toHaveBeenCalledWith("ssh-keygen -R '100.78.214.15'")
  })

  it('offers Sign in in a terminal for a login that needs a person, on the machine the host saved', async () => {
    const message = 'server-15 needs a password or a code: sign in in a terminal, then try again.'
    const needsPerson: Added = { ...refused, message, failure: 'needs-person', fix_command: null }
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(needsPerson)) })
    const { user, view } = await connectTo(machines)
    expect(await screen.findByText(message)).toBeInTheDocument()
    view.rerender(<AddMachineDialog machines={{ ...machines, list: [savedHead] }} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Sign in in a terminal' }))
    expect(machines.onOpenLogin).toHaveBeenCalledWith(3)
  })

  it('says the host\'s words for a request it refused before looking', async () => {
    const words = 'You already have a machine called server-15. Remove it in Remote machines, or pick another name.'
    await connectTo(info({}, { onAdd: vi.fn(() => Promise.reject(new Error(words))) }))
    expect(await screen.findByText(words)).toBeInTheDocument()
  })

  it('Try again asks the host again', async () => {
    const onAdd = vi.fn<MachinesInfo['add']['onAdd']>().mockResolvedValueOnce(unreachable).mockResolvedValue(added())
    const onClose = vi.fn()
    const machines = info({}, { onAdd })
    const { user } = await connectTo(machines, 'dev@10.9.9.9', { onClose })
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(onAdd).toHaveBeenCalledTimes(2)
    expect(onAdd).toHaveBeenLastCalledWith('dev@10.9.9.9', 'server-9', undefined, { keyFile: null, installHelper: true })
    expect(machines.onRemove).not.toHaveBeenCalled()
  })

  it('Try again takes out the machine the host saved first, so the name is free, then asks again', async () => {
    const onAdd = vi.fn<MachinesInfo['add']['onAdd']>().mockResolvedValueOnce(refused).mockResolvedValue(added())
    const onClose = vi.fn()
    const machines = info({}, { onAdd })
    const { user, view } = await connectTo(machines, 'dev@100.78.214.15', { onClose })
    await screen.findByText(REFUSED_KEY)
    view.rerender(<AddMachineDialog machines={{ ...machines, list: [savedHead] }} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
    expect(onAdd).toHaveBeenLastCalledWith('dev@100.78.214.15', 'server-15', undefined, { keyFile: null, installHelper: true })
  })

  it('stays on the sentence when the saved machine could not be taken out', async () => {
    const onAdd = vi.fn<MachinesInfo['add']['onAdd']>().mockResolvedValue(refused)
    const machines = info({ onRemove: vi.fn(() => Promise.resolve(false)) }, { onAdd })
    const { user } = await connectTo(machines)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(machines.onRemove).toHaveBeenCalled() })
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(screen.getByText(REFUSED_KEY)).toBeInTheDocument()
  })

  it('takes a new address typed after a failure, without calling the saved machine already added', async () => {
    const onAdd = vi.fn<MachinesInfo['add']['onAdd']>().mockResolvedValueOnce(refused).mockResolvedValue(added())
    const machines = info({}, { onAdd })
    const { user, view } = await connectTo(machines)
    await screen.findByText(REFUSED_KEY)
    const onOpenSettings = vi.fn()
    view.rerender(<AddMachineDialog machines={{ ...machines, list: [savedHead] }} onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
    await user.type(screen.getByRole('textbox', { name: 'Address' }), '{Enter}')
    expect(onOpenSettings).not.toHaveBeenCalled()
    await waitFor(() => { expect(onAdd).toHaveBeenCalledTimes(2) })
  })

  it('closes by itself when the saved machine connects meanwhile (a key installed, a sign-in done)', async () => {
    const onClose = vi.fn()
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(refused)) })
    const { view } = await connectTo(machines, 'dev@100.78.214.15', { onClose })
    await screen.findByText(REFUSED_KEY)
    view.rerender(<AddMachineDialog machines={{ ...machines, list: [connectedHead()] }} onClose={onClose} />)
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    view.unmount()
    expect(machines.onRemove).not.toHaveBeenCalled()
  })

  it('takes out the machine the host saved when the dialog closes before it connected', async () => {
    const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(refused)) })
    const { view } = await connectTo(machines)
    await screen.findByText(REFUSED_KEY)
    view.unmount()
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
  })
})
