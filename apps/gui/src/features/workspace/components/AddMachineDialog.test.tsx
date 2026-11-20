import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Added } from '@/api/machines'
import type { Conversation } from '@/data/preview'
import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import type { KeyTerminalHost } from '@/features/settings/components/KeyTerminal'

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), failed: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast }))
vi.mock('@/TerminalView', () => ({ TerminalView: ({ conversation }: { conversation: { id: string } }) => <div data-testid="key-terminal">{conversation.id}</div> }))

import { AddMachineDialog } from './AddMachineDialog'

const added = (reach: Extract<Added, { outcome: 'added' }>['reach']): Added => ({ outcome: 'added', name: 'build', version: null, reach, took_ms: 9 })
const refused: Added = { outcome: 'login', name: 'build', target: 'me@build.example', said: 'me@build.example: Permission denied (publickey).', command: null }

function info(overrides: Partial<MachinesInfo>, add: Partial<MachinesInfo['add']> = {}): MachinesInfo {
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
    add: { loadHosts: () => Promise.resolve([{ alias: 'build', detail: 'me@build.example' }]), onAdd: vi.fn(), onCancel: vi.fn(), ...add },
    ...overrides,
  }
}

describe('the Add a remote machine dialog', () => {
  it('connects to a machine picked from the SSH config, then closes and says it is connected', async () => {
    const onClose = vi.fn()
    const onAdd = vi.fn().mockResolvedValue(added('answered'))
    render(<AddMachineDialog machines={info({}, { onAdd })} onClose={onClose} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Connect to build' }))
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(onAdd).toHaveBeenCalledWith('build', 'build', undefined)
    expect(toast.success).toHaveBeenCalledWith('Connected to build')
  })

  it('closes and says it is connected once a machine that needed a login connects', async () => {
    const onClose = vi.fn()
    const onAdd = vi.fn().mockResolvedValue({ outcome: 'added', name: 'build', version: null, reach: 'not-running', took_ms: 9 } satisfies Added)
    const { rerender } = render(<AddMachineDialog machines={info({}, { onAdd })} onClose={onClose} />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Connect to build' }))
    await screen.findByText("Maiker is installed on build but couldn't start.")
    expect(onClose).not.toHaveBeenCalled()
    const head = { key: 'machine-1', machine: 1, name: 'build', label: 'build', chip: { glyph: '●', word: 'connected', tone: 'ok' }, why: null, said: null, loginCommand: null, target: null, down: false, downSince: null, grants: { clipboard: false, notices: false }, updateCommand: null, updateAction: null } as const
    rerender(<AddMachineDialog machines={info({ list: [head] }, { onAdd })} onClose={onClose} />)
    await waitFor(() => { expect(onClose).toHaveBeenCalled() })
    expect(toast.success).toHaveBeenCalledWith('Connected to build')
  })

  describe('closing before the machine connected', () => {
    const closeAfter = async (answer: Added, extra: (user: ReturnType<typeof userEvent.setup>) => Promise<void> = () => Promise.resolve()) => {
      const machines = info({}, { onAdd: vi.fn().mockResolvedValue(answer) })
      const view = render(<AddMachineDialog machines={machines} onClose={vi.fn()} />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Connect to build' }))
      await screen.findByRole('status', { hidden: true }).catch(() => undefined)
      await extra(user)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      view.unmount()
      return machines
    }

    it('removes a machine that was saved but refused the key, so nothing invisible is left', async () => {
      const machines = await closeAfter(refused, async () => { await screen.findByText("build didn't accept your key.") })
      expect(machines.onRemove).toHaveBeenCalledWith('build')
    })

    it('keeps a machine the person chose to add without Maiker on it', async () => {
      const machines = await closeAfter(added('missing'), async (user) => { await user.click(await screen.findByRole('button', { name: 'Add without it' })) })
      expect(machines.onRemove).not.toHaveBeenCalled()
    })

    it('keeps a machine that connected', async () => {
      const machines = await closeAfter(added('answered'))
      expect(machines.onRemove).not.toHaveBeenCalled()
    })
  })

  describe('a key that was refused', () => {
    const session = { id: '7' } as Conversation
    const head = { key: 'machine-1', machine: 1, name: 'build', label: 'build', chip: { glyph: '●', word: 'connected', tone: 'ok' }, why: null, said: null, loginCommand: null, target: null, down: false, downSince: null, grants: { clipboard: false, notices: false }, updateCommand: null, updateAction: null } as const
    const host = () => ({ start: vi.fn(() => Promise.resolve(session)), end: vi.fn(() => Promise.resolve()), watch: vi.fn(() => vi.fn()), fontSize: 13, look: {} }) satisfies KeyTerminalHost
    const open = async (keyTerminal: KeyTerminalHost, onClose = vi.fn()) => {
      const onAdd = vi.fn().mockResolvedValue(refused)
      const view = render(<AddMachineDialog machines={info({ keyTerminal }, { onAdd })} onClose={onClose} />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Connect to build' }))
      await user.click(await screen.findByRole('button', { name: 'Set up the key here' }))
      await screen.findByTestId('key-terminal')
      return { user, view, onClose, onAdd }
    }

    it('shows the terminal inside the dialog with the command typed, not run, and keeps the dialog open', async () => {
      const keyTerminal = host()
      const { onClose } = await open(keyTerminal)
      expect(keyTerminal.start).toHaveBeenCalledWith('ssh-copy-id me@build.example')
      expect(keyTerminal.watch).toHaveBeenCalledWith('build')
      expect(within(screen.getByRole('dialog', { name: 'Add a remote machine' })).getByTestId('key-terminal')).toHaveTextContent('7')
      expect(screen.getByText(/Maiker does not read or keep it/)).toBeInTheDocument()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('ends the terminal session when the dialog is closed', async () => {
      const keyTerminal = host()
      const { user, onClose, view } = await open(keyTerminal)
      await user.click(screen.getByRole('button', { name: 'Close' }))
      expect(onClose).toHaveBeenCalled()
      view.unmount()
      expect(keyTerminal.end).toHaveBeenCalledWith(session)
    })

    it('leaves Esc to the terminal while it has focus, and closes on Esc anywhere else', async () => {
      const { user, onClose } = await open(host())
      await user.keyboard('{Escape}')
      await waitFor(() => { expect(onClose).toHaveBeenCalledTimes(1) })
    })

    it('does not close on Esc typed in the terminal', async () => {
      const { onClose } = await open(host())
      const terminal = screen.getByTestId('key-terminal')
      terminal.tabIndex = 0
      terminal.focus()
      await userEvent.setup().keyboard('{Escape}')
      expect(onClose).not.toHaveBeenCalled()
    })

    it('says connected, then closes with the toast, once the machine connects', async () => {
      toast.success.mockClear()
      const keyTerminal = host()
      const onClose = vi.fn()
      const onAdd = vi.fn().mockResolvedValue(refused)
      const { rerender } = render(<AddMachineDialog machines={info({ keyTerminal }, { onAdd })} onClose={onClose} />)
      const user = userEvent.setup()
      await user.click(await screen.findByRole('button', { name: 'Connect to build' }))
      await user.click(await screen.findByRole('button', { name: 'Set up the key here' }))
      await screen.findByTestId('key-terminal')
      rerender(<AddMachineDialog machines={info({ keyTerminal, list: [head] }, { onAdd })} onClose={onClose} />)
      expect(await screen.findByText('Connected to build.')).toBeInTheDocument()
      expect(screen.queryByTestId('key-terminal')).toBeNull()
      await waitFor(() => { expect(onClose).toHaveBeenCalled() }, { timeout: 3000 })
      expect(toast.success).toHaveBeenCalledWith('Connected to build')
    })
  })
  describe('mending a machine that is not connected', () => {
    const down = (word: string, extra: Record<string, unknown> = {}) => ({ key: 'machine-1', machine: 1, name: 'build', label: 'build', chip: { glyph: '✕', word, tone: 'bad' }, why: null, said: null, loginCommand: null, target: 'me@build.example', down: true, downSince: null, grants: { clipboard: false, notices: false }, updateCommand: null, updateAction: null, ...extra }) as const
    const keyTerminal = () => ({ start: vi.fn(() => Promise.resolve({ id: '7' } as Conversation)), end: vi.fn(() => Promise.resolve()), watch: vi.fn(() => vi.fn()), fontSize: 13, look: {} }) satisfies KeyTerminalHost

    it('opens a machine that needs a login on the key step, and puts the terminal under it with the command typed', async () => {
      const host = keyTerminal()
      const head = down('needs login', { loginCommand: 'ssh me@build.example', said: 'Permission denied (publickey).' })
      render(<AddMachineDialog machines={info({ keyTerminal: host, list: [head] })} fixing={head} onClose={vi.fn()} />)
      expect(screen.getByRole('dialog', { name: 'Fix build' })).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Address' })).toBeNull()
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Set up the key here' }))
      expect(await screen.findByTestId('key-terminal')).toBeInTheDocument()
      expect(host.start).toHaveBeenCalledWith('ssh-copy-id me@build.example')
    })

    it('shows one panel for any other state, with the reason, Try again and a way to Settings', async () => {
      const onRetry = vi.fn()
      const onOpenSettings = vi.fn()
      const head = down('unreachable', { why: 'connection refused' })
      render(<AddMachineDialog machines={info({ list: [head], onRetry })} fixing={head} onClose={vi.fn()} onOpenSettings={onOpenSettings} />)
      expect(screen.getByText('build is not connected.')).toBeInTheDocument()
      expect(screen.getByText('connection refused')).toBeInTheDocument()
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Try again' }))
      expect(onRetry).toHaveBeenCalledWith('build')
      await user.click(screen.getByRole('button', { name: 'Open in Settings' }))
      expect(onOpenSettings).toHaveBeenCalled()
    })

    it('says connected and closes with the toast once the machine is back', async () => {
      toast.success.mockClear()
      const onClose = vi.fn()
      const before = down('reconnecting', { why: 'dialling' })
      const { rerender } = render(<AddMachineDialog machines={info({ list: [before] })} fixing={before} onClose={onClose} />)
      rerender(<AddMachineDialog machines={info({ list: [{ ...before, chip: { glyph: '●', word: 'connected', tone: 'ok' }, down: false }] })} fixing={before} onClose={onClose} />)
      expect(await screen.findByText('Connected to build.')).toBeInTheDocument()
      await waitFor(() => { expect(onClose).toHaveBeenCalled() }, { timeout: 3000 })
      expect(toast.success).toHaveBeenCalledWith('Connected to build')
    })
  })
})
