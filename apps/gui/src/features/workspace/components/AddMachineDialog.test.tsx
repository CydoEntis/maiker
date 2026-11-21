import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Added, UpdateProgress } from '@/api/machines'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), failed: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))

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

describe('the address step', () => {
  it('opens inside the themed window, so the corners and colours are the theme’s and not the bare page’s', () => {
    const root = document.createElement('div')
    root.className = 'mx-app'
    document.body.append(root)
    render(<AddMachineDialog machines={info()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog').closest('.mx-app')).toBe(root)
    root.remove()
  })

  it('is one field, and Connect waits for an address that holds up', () => {
    render(<AddMachineDialog machines={info()} onClose={vi.fn()} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveAttribute('placeholder', 'user@host, an IP address, or a name from your SSH config')
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveAttribute('aria-disabled', 'true')
  })

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

  it('connects the moment a host of the SSH config is clicked, and keeps its name', async () => {
    const machines = info()
    render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Connect to build' }))
    await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalledWith('build', 'build', undefined, { keyFile: null, installHelper: true }) })
  })

  describe('a host of the SSH config that is already a machine', () => {
    const kingdom = (word: string, tone: 'ok' | 'bad'): MachineHead => ({ ...connectedHead('kingdom', 5), target: 'kingdom', chip: { glyph: '●', word, tone } })

    it('stays in the list, dimmed, saying Already added, and cannot be connected again', async () => {
      render(<AddMachineDialog machines={info({ list: [kingdom('connected', 'ok')] })} onClose={vi.fn()} />)
      const row = await screen.findByRole('button', { name: 'kingdom: Already added' })
      expect(row).toHaveClass('is-added')
      expect(screen.queryByRole('button', { name: 'Connect to kingdom' })).toBeNull()
    })

    it('opens where machines are managed when it is connected, and adds nothing', async () => {
      const onOpenSettings = vi.fn()
      const machines = info({ list: [kingdom('connected', 'ok')] })
      render(<AddMachineDialog machines={machines} onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
      await userEvent.setup().click(await screen.findByRole('button', { name: 'kingdom: Already added' }))
      expect(onOpenSettings).toHaveBeenCalled()
      expect(machines.add.onAdd).not.toHaveBeenCalled()
    })

    it('says it is offline, and opens the Fix step for it', async () => {
      const machines = info({ list: [{ ...kingdom('unreachable', 'bad'), why: 'connection refused' }] })
      render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'kingdom: Already added · unreachable' }))
      expect(await screen.findByRole('dialog', { name: 'Fix kingdom' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(machines.onRetry).toHaveBeenCalledWith('kingdom')
    })

    it('offers one button to update an older Maiker there, not a command to type', async () => {
      const machines = info({ list: [{ ...kingdom('older Maiker', 'bad'), updateAction: 'update', said: 'run `maiker machine update kingdom`, then retry' }] })
      render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: /^kingdom: Already added/ }))
      expect(await screen.findByText('kingdom needs a Maiker update')).toBeInTheDocument()
      expect(screen.queryByText(/maiker machine update/)).toBeNull()
      await user.click(screen.getByRole('button', { name: 'Update Maiker on kingdom' }))
      expect(machines.onUpdate).toHaveBeenCalledWith('kingdom', 'update', false)
    })
  })

  it('says a machine that is already in Maiker is already there', async () => {
    await connectTo(info({ list: [{ ...connectedHead('build'), target: 'me@build.example' }] }), 'build')
    expect(await screen.findByRole('alert')).toHaveTextContent('build is already in Maiker.')
  })
})

describe('the checklist', () => {
  it('adds a host this computer has never seen without asking about its key, then shows Machine added', async () => {
    const machines = info()
    await connectTo(machines)
    expect(await screen.findByText('Machine added')).toBeInTheDocument()
    expect(machines.add.onAdd).toHaveBeenCalledTimes(1)
    expect(machines.add.onAdd).toHaveBeenCalledWith('dev@100.78.214.15', 'server-15', undefined, { keyFile: null, installHelper: true })
  })

  it('shows every step with its result while the host signs in, in the same dialog', async () => {
    let finish: (result: Added) => void = () => undefined
    const onAdd = vi.fn(() => new Promise<Added>((resolve) => { finish = resolve }))
    await connectTo(info({}, { onAdd }))
    const steps = await screen.findByRole('list', { name: 'Steps to connect' })
    await waitFor(() => { expect(within(steps).getByText('Reached 100.78.214.15')).toBeInTheDocument() })
    expect(within(steps).queryByText("Check it's the right computer")).toBeNull()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    for (const name of ['Sign in as dev with your SSH key', 'Set up the Maiker helper', 'Connected']) expect(within(steps).getByText(name)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Change address' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await act(async () => { finish(added()); await Promise.resolve() })
  })

  it('says a changed host key at Reach in the host\'s sentence, with no Trust, and saves nothing', async () => {
    const refusal = "100.78.214.15's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R '100.78.214.15'` in a terminal and try again."
    const machines = info({}, { onAdd: vi.fn(() => Promise.reject(new Error(refusal))) })
    await connectTo(machines)
    expect(await screen.findByText(refusal)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(machines.onRemove).not.toHaveBeenCalled()
  })

  describe('a machine that would not sign in', () => {
    const open = async (said = refused.said, extra: Partial<MachinesInfo> = {}) => {
      const onAdd = vi.fn<MachinesInfo['add']['onAdd']>().mockResolvedValueOnce({ ...refused, said }).mockResolvedValue(added())
      const machines = info(extra, { onAdd })
      const { user, view } = await connectTo(machines)
      await screen.findByText("Couldn't sign in to dev@100.78.214.15")
      return { user, view, machines }
    }

    it('says the host\'s one sentence, with no terminal, command run or password', async () => {
      await open()
      expect(screen.getByText(REFUSED_KEY)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
      expect(screen.queryByTestId('key-terminal')).toBeNull()
      expect(screen.queryByText('Checking your key…')).toBeNull()
    })

    it('shows the host’s own reason', async () => {
      await open('dev@100.78.214.15: Permission denied (publickey).')
      expect(screen.getByText(/SSH said: dev@100\.78\.214\.15: Permission denied \(publickey\)\./)).toBeInTheDocument()
    })

    it('copies the command the host named', async () => {
      const { user, machines } = await open()
      await user.click(screen.getByRole('button', { name: 'Copy the command' }))
      expect(machines.onCopyCommand).toHaveBeenCalledWith('ssh-copy-id dev@100.78.214.15')
    })

    it('Try again takes the saved machine out and goes through the whole checklist again', async () => {
      const { user, machines } = await open()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(machines.onRemove).toHaveBeenCalledWith('server-15')
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
      expect(machines.add.onAdd).toHaveBeenCalledTimes(2)
    })

    it('removes the machine the host saved when the dialog is closed before it connected', async () => {
      const { machines, view } = await open()
      view.unmount()
      expect(machines.onRemove).toHaveBeenCalledWith('server-15')
    })

    it('carries on by itself, to Machine added, if the machine connects meanwhile', async () => {
      const { machines, view } = await open()
      view.rerender(<AddMachineDialog machines={{ ...machines, list: [connectedHead()] }} onClose={vi.fn()} />)
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
    })
  })

  describe('the Maiker helper', () => {
    it('installs by itself as a step with a progress bar that follows the host', async () => {
      let listener: (progress: UpdateProgress) => void = () => undefined
      let finish: (result: Added) => void = () => undefined
      const onProgress = vi.fn((on: (progress: UpdateProgress) => void) => { listener = on; return Promise.resolve(vi.fn()) })
      const onAdd = vi.fn(() => new Promise<Added>((resolve) => { finish = resolve }))
      await connectTo(info({}, { onAdd, onProgress }), 'dev@100.78.214.15', { appVersion: '0.46.0' })
      await waitFor(() => { expect(onProgress).toHaveBeenCalled() })
      await screen.findByText('Reached 100.78.214.15')
      act(() => { listener({ name: 'server-15', percent: 40 }) })
      expect(await screen.findByText('Not installed yet. Copying Maiker 0.46.0 to server-15…')).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'Setting up the Maiker helper' })).toHaveAttribute('aria-valuenow', '40')
      expect(onAdd).toHaveBeenCalledWith('dev@100.78.214.15', 'server-15', undefined, { keyFile: null, installHelper: true })
      await act(async () => { finish(added({ reach: 'missing', helper_install: { installed: true, said: 'Installed' } })); await Promise.resolve() })
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
    })

    it('says so when the install did not work, and tries it again from the step', async () => {
      const message = 'Maiker could not be installed or started on server-15 (No space left on the device.); only Linux and macOS machines are supported.'
      const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(added({ reach: 'missing', version: null, helper_install: { installed: false, said: 'No space left on the device.' }, message }))) })
      const { user } = await connectTo(machines)
      expect(await screen.findByText("Couldn't put Maiker on server-15")).toBeInTheDocument()
      expect(screen.getByText(message)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(machines.onUpdate).toHaveBeenCalledWith('server-15', 'install', false)
    })

    it('keeps a machine the person chose to add without Maiker on it, and says so', async () => {
      const onClose = vi.fn()
      const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(added({ reach: 'missing', version: null }))) })
      const { user, view } = await connectTo(machines, 'dev@100.78.214.15', { onClose })
      await user.click(await screen.findByRole('button', { name: 'Add without it' }))
      view.unmount()
      expect(machines.onRemove).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith('Added server-15')
      expect(onClose).toHaveBeenCalled()
    })

    it('offers to update an older Maiker, or keep it', async () => {
      const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(added({ reach: 'older', version: '0.45.2' }))) })
      const { user } = await connectTo(machines)
      expect(await screen.findByText('server-15 has an older Maiker (0.45.2)')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Keep 0.45.2' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Update it' }))
      expect(machines.onUpdate).toHaveBeenCalledWith('server-15', 'update', false)
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
    })

    it('says Maiker is installed but did not start, and tries again', async () => {
      const machines = info({}, { onAdd: vi.fn(() => Promise.resolve(added({ reach: 'not-running' }))) })
      const { user } = await connectTo(machines)
      expect(await screen.findByText("Maiker is on server-15 but couldn't start")).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(machines.onRetry).toHaveBeenCalledWith('server-15')
    })
  })

  describe('a machine that does not answer', () => {
    const UNREACHED = "Can't reach 10.9.9.9: check the name or address, and that the machine is on (ssh: connect to host 10.9.9.9 port 22: Connection timed out)."
    const silent = () => info({}, { onAdd: vi.fn(() => Promise.reject(new Error(UNREACHED))) })

    it("says it couldn't reach the machine, in the host's one sentence", async () => {
      await connectTo(silent(), 'dev@10.9.9.9')
      expect(await screen.findByText("Couldn't reach 10.9.9.9")).toBeInTheDocument()
      expect(screen.getByText(UNREACHED)).toBeInTheDocument()
    })

    it('tries the whole sequence again', async () => {
      const machines = silent()
      const { user } = await connectTo(machines, 'dev@10.9.9.9')
      await user.click(await screen.findByRole('button', { name: 'Try again' }))
      await waitFor(() => { expect(machines.add.onAdd).toHaveBeenCalledTimes(2) })
    })

    it('goes back to the address, as typed, with Edit the address', async () => {
      const { user } = await connectTo(silent(), 'dev@10.9.9.9')
      await user.click(await screen.findByRole('button', { name: 'Edit the address' }))
      expect(await screen.findByRole('textbox', { name: 'Address' })).toHaveValue('dev@10.9.9.9')
    })

    it('says what ssh said when it is none of the known reasons', async () => {
      const machines = info({}, { onAdd: vi.fn(() => Promise.reject(new Error('Something odd happened in ssh'))) })
      await connectTo(machines)
      expect(await screen.findByText("Couldn't reach 100.78.214.15")).toBeInTheDocument()
      expect(screen.getByText('Something odd happened in ssh')).toBeInTheDocument()
    })

    it('offers Retry and Remove for a saved machine of the same name', async () => {
      const machines = info({}, { onAdd: vi.fn(() => Promise.reject(new Error('You already have a machine called server-15. Remove it in Remote machines, or pick another name.'))) })
      const { user } = await connectTo(machines)
      expect(await screen.findByText('server-15 is already added')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Remove server-15' }))
      expect(machines.onRemove).toHaveBeenCalledWith('server-15')
    })
  })

  describe('a machine of the same name that is already saved', () => {
    const taken = new Error('You already have a machine called server-15. Remove it in Remote machines, or pick another name.')
    const takenOnce = () => vi.fn<MachinesInfo['add']['onAdd']>().mockRejectedValueOnce(taken).mockResolvedValue(added())
    const saved = (word: string, extra: Partial<MachineHead> = {}): MachineHead => ({ ...connectedHead(), chip: { glyph: '▲', word, tone: 'bad' }, ...extra })

    it('removes it, says so while it does, then runs the whole checklist again', async () => {
      let finish: (removed: boolean) => void = () => undefined
      const onRemove = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
      const machines = info({ onRemove }, { onAdd: takenOnce() })
      const { user } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Remove server-15' }))
      expect(await screen.findByText('Removing server-15…')).toBeInTheDocument()
      await act(async () => { finish(true); await Promise.resolve() })
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
      expect(machines.add.onAdd).toHaveBeenCalledTimes(2)
    })

    it('goes back to the choice when it could not be removed', async () => {
      const machines = info({ onRemove: vi.fn(() => Promise.resolve(false)) }, { onAdd: takenOnce() })
      const { user } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Remove server-15' }))
      expect(await screen.findByText('server-15 is already added')).toBeInTheDocument()
      expect(machines.add.onAdd).toHaveBeenCalledTimes(1)
    })

    it('Retry dials it again and shows it signing in, never the same screen', async () => {
      const machines = info({}, { onAdd: takenOnce() })
      const { user } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Retry server-15' }))
      expect(machines.onRetry).toHaveBeenCalledWith('server-15')
      expect(await screen.findByText('Signing in to server-15…')).toBeInTheDocument()
      expect(screen.queryByText('server-15 is already added')).toBeNull()
    })

    it('Retry carries on at the key step when the machine needs a login, then to Machine added once it connects', async () => {
      const machines = info({}, { onAdd: takenOnce() })
      const { user, view } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Retry server-15' }))
      view.rerender(<AddMachineDialog machines={{ ...machines, list: [saved('needs login', { said: 'Permission denied (publickey).' })] }} onClose={vi.fn()} />)
      expect(await screen.findByText("Couldn't sign in to dev@server-15.lan")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
      view.rerender(<AddMachineDialog machines={{ ...machines, list: [connectedHead()] }} onClose={vi.fn()} />)
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
    })

    it('Retry carries on at the helper step when Maiker is missing there, and installs it from the step', async () => {
      const machines = info({}, { onAdd: takenOnce() })
      const { user, view } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Retry server-15' }))
      view.rerender(<AddMachineDialog machines={{ ...machines, list: [saved('not installed', { updateAction: 'install' })] }} onClose={vi.fn()} />)
      expect(await screen.findByText('Maiker is not on server-15')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Install it' }))
      expect(machines.onUpdate).toHaveBeenCalledWith('server-15', 'install', false)
      expect(await screen.findByText('Machine added')).toBeInTheDocument()
    })

    it('Retry says so, with Try again, when the machine still does not answer', async () => {
      const machines = info({}, { onAdd: takenOnce() })
      const { user, view } = await connectTo(machines)
      await user.click(await screen.findByRole('button', { name: 'Retry server-15' }))
      view.rerender(<AddMachineDialog machines={{ ...machines, list: [saved('unreachable', { why: 'ssh: connect to host 100.78.214.15 port 22: Connection timed out' })] }} onClose={vi.fn()} />)
      expect(await screen.findByText('server-15 is not connected')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(machines.onRetry).toHaveBeenCalledTimes(2)
    })
  })

  it('goes back to the address with ← Change address, and cancels the look that is running', async () => {
    const onAdd = vi.fn(() => new Promise<Added>(() => undefined))
    const machines = info({}, { onAdd })
    const { user } = await connectTo(machines)
    await user.click(await screen.findByRole('button', { name: '← Change address' }))
    expect(await screen.findByRole('textbox', { name: 'Address' })).toHaveValue('dev@100.78.214.15')
    expect(machines.add.onCancel).toHaveBeenCalled()
    expect(machines.onRemove).not.toHaveBeenCalled()
  })
})

describe('Machine added', () => {
  const addedDialog = async (props: Partial<Parameters<typeof AddMachineDialog>[0]> = {}, machines = info({ list: [connectedHead()] })) => {
    const { user } = await connectTo(machines, 'dev@100.78.214.15', props)
    await screen.findByText('Machine added')
    return { user, machines }
  }

  it('says it is connected, with the name selected so typing replaces it, and the details that are known', async () => {
    await addedDialog()
    expect(screen.getByText('Connected. Its sessions show up in your sidebar under this name.')).toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('server-15')
    expect((name as HTMLInputElement).selectionStart).toBe(0)
    expect((name as HTMLInputElement).selectionEnd).toBe('server-15'.length)
    const details = screen.getByText('Address').closest('dl') as HTMLElement
    expect(within(details).getByText('dev@100.78.214.15')).toBeInTheDocument()
    expect(within(details).getByText('0.46.0')).toBeInTheDocument()
  })

  it('leaves out the system and agents rows until the host reports them', async () => {
    await addedDialog()
    expect(screen.queryByText('System')).toBeNull()
    expect(screen.queryByText('Agents found')).toBeNull()
  })

  it('shows the system and the agents found when the host reports them', async () => {
    await addedDialog({ facts: { system: 'Ubuntu 24.04 · 8 cores', agents: ['Claude Code', 'Codex'] } })
    expect(screen.getByText('Ubuntu 24.04 · 8 cores')).toBeInTheDocument()
    expect(screen.getByText('Claude Code, Codex')).toBeInTheDocument()
  })

  it('saves a name that was typed when Done is pressed, and closes', async () => {
    const onClose = vi.fn()
    const { user, machines } = await addedDialog({ onClose })
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'gpu box')
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(machines.onRename).toHaveBeenCalledWith('server-15', 'gpu box')
    expect(onClose).toHaveBeenCalled()
  })

  it('saves nothing when the name was left as it is', async () => {
    const { user, machines } = await addedDialog()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(machines.onRename).not.toHaveBeenCalled()
  })

  it('saves the name and starts a session on that machine with Start a session', async () => {
    const onStartSession = vi.fn()
    const onClose = vi.fn()
    const { user, machines } = await addedDialog({ onStartSession, onClose })
    // The name is selected when the step opens, so the first key typed replaces it.
    await user.keyboard('x')
    await user.click(screen.getByRole('button', { name: 'Start a session' }))
    expect(machines.onRename).toHaveBeenCalledWith('server-15', 'x')
    expect(onStartSession).toHaveBeenCalledWith(3)
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps the name of an SSH config host, and suggests the reported name for a bare address', async () => {
    const machines = info({ list: [connectedHead('build', 4)] }, { onAdd: vi.fn(() => Promise.resolve(added({ name: 'build' }))) })
    render(<AddMachineDialog machines={machines} onClose={vi.fn()} facts={{ reportedName: 'gpu-box' }} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Connect to build' }))
    expect(await screen.findByRole('textbox', { name: 'Name' })).toHaveValue('build')
  })

  it('follows the name the machine reports when it arrives after the screen, and keeps what was typed', async () => {
    const machines = info({ list: [connectedHead()] })
    const { user, view } = await connectTo(machines)
    await screen.findByText('Machine added')
    view.rerender(<AddMachineDialog machines={machines} onClose={vi.fn()} facts={{ reportedName: 'gpu-box' }} />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('gpu-box')
    await user.clear(name)
    await user.type(name, 'mine')
    view.rerender(<AddMachineDialog machines={machines} onClose={vi.fn()} facts={{ reportedName: 'other' }} />)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('mine')
  })

  it('suggests the name the machine reports for a bare address', async () => {
    await addedDialog({ facts: { reportedName: 'gpu-box' } })
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('gpu-box')
  })
})

describe('mending a machine that is not connected', () => {
  const down = (word: string, extra: Partial<MachineHead> = {}): MachineHead => ({ ...LOCAL_HEAD, key: 'machine-1', machine: 1, name: 'build', label: 'build', chip: { glyph: '✕', word, tone: 'bad' }, target: 'me@build.example', down: true, ...extra })

  it('opens a machine that needs a login on the plain sign-in step, in the host\'s words, with Try again dialling it again', async () => {
    const why = 'build refused your key: run `ssh-copy-id me@build.example` in a terminal, then try again.'
    const head = down('needs login', { loginCommand: 'ssh me@build.example', said: 'Permission denied (publickey).', why, failure: 'key-refused', fixCommand: 'ssh-copy-id me@build.example' })
    const machines = info({ list: [head] })
    render(<AddMachineDialog machines={machines} fixing={head} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Fix build' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Address' })).toBeNull()
    expect(screen.getByText("Couldn't sign in to me@build.example")).toBeInTheDocument()
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(machines.onRetry).toHaveBeenCalledWith('build')
  })

  it('stops a machine whose host key changed at Reach, with the host\'s sentence and Try again, never Trust', async () => {
    const onRetry = vi.fn()
    const why = "build's host key has changed, so Maiker won't connect: confirm with whoever runs it that the change is expected, then run `ssh-keygen -R 'build.example'` in a terminal and try again."
    const head = down('needs login', { said: 'Host key verification failed.', failure: 'host-key-changed', why })
    render(<AddMachineDialog machines={info({ list: [head], onRetry })} fixing={head} onClose={vi.fn()} />)
    expect(screen.getByText("build's host key has changed")).toBeInTheDocument()
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Trust/ })).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('build')
  })

  it('shows the reason for any other state, with Try again and a way to Settings', async () => {
    const onRetry = vi.fn()
    const onOpenSettings = vi.fn()
    const head = down('unreachable', { why: 'connection refused' })
    render(<AddMachineDialog machines={info({ list: [head], onRetry })} fixing={head} onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
    expect(screen.getByText('build is not connected')).toBeInTheDocument()
    expect(screen.getByText('connection refused')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledWith('build')
    await user.click(screen.getByRole('button', { name: 'Open in Settings' }))
    expect(onOpenSettings).toHaveBeenCalled()
  })

  it('ticks Connected and closes with the toast once the machine is back', async () => {
    toast.success.mockClear()
    const onClose = vi.fn()
    const before = down('reconnecting', { why: 'dialling' })
    const { rerender } = render(<AddMachineDialog machines={info({ list: [before] })} fixing={before} onClose={onClose} />)
    rerender(<AddMachineDialog machines={info({ list: [{ ...before, chip: { glyph: '●', word: 'connected', tone: 'ok' }, down: false }] })} fixing={before} onClose={onClose} />)
    await waitFor(() => { expect(onClose).toHaveBeenCalled() }, { timeout: 3000 })
    expect(toast.success).toHaveBeenCalledWith('Connected to build')
  })
})
