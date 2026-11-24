import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalServiceReport } from '@/api/daemon'
import type { MachineHead } from '@/features/workspace/model/machines'
import type { MachinesInfo, SettingsUpdates } from './DesktopSettings'
import { UpdatesPage } from './UpdatesPage'

const daemon = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true),
  loadLocalServiceReport: vi.fn(),
  repairLocalService: vi.fn(),
}))
vi.mock('@/api/daemon', () => daemon)
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), failed: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() } }))

const report: LocalServiceReport = { appVersion: '0.84.0', running: true, daemonVersion: '0.83.0', fileVersion: '0.84.0', behind: true, fileBehind: false, canRestart: true, sessionCount: 2, activeTurnCount: 0 }

const head = (name: string, updateAction: MachineHead['updateAction']): MachineHead => ({
  key: name, machine: 1, name, label: name, chip: null, why: null, failure: null, fixCommand: null, said: null, loginCommand: null,
  target: `me@${name}`, down: false, downSince: null, grants: { clipboard: false, notices: false }, updateCommand: null, updateAction,
})

function machines(list: MachineHead[]): MachinesInfo {
  return { known: true, list, onRetry: vi.fn(), onRemove: vi.fn(), onGrant: vi.fn(), onUpdate: vi.fn(() => Promise.resolve()), onCheckActivity: vi.fn(() => Promise.resolve({ sessions: 2, busy: 0, current: false })), onCopyCommand: vi.fn(), onOpenLogin: vi.fn(), onRename: vi.fn(), add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn() } }
}

const updates = (change: Partial<SettingsUpdates> = {}): SettingsUpdates => ({ summary: 'You are on the latest version.', status: 'current', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn(), ...change })

function renderPage(props: { updates?: SettingsUpdates; machines?: MachinesInfo } = {}) {
  const shown = props.updates ?? updates()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UpdatesPage updates={shown} appVersion="0.84.0" machines={props.machines ?? machines([])} />
    </QueryClientProvider>,
  )
  return shown
}

beforeEach(() => {
  vi.clearAllMocks()
  daemon.isDesktop.mockReturnValue(true)
  daemon.loadLocalServiceReport.mockResolvedValue(report)
  daemon.repairLocalService.mockResolvedValue({ ...report, behind: false })
})

describe('Updates & repair', () => {
  it('lists the app, the service and the machines, each with what it is and its version', async () => {
    renderPage({ machines: machines([head('devbox', 'update')]) })
    expect(screen.getByText(/The window you are using\. Version v0\.84\.0\./)).toBeTruthy()
    expect(await screen.findByText(/Needs a restart to finish updating\..*Running v0\.83\.0, this app is v0\.84\.0\. 2 chats open\./)).toBeTruthy()
    expect(screen.getByText('devbox')).toBeTruthy()
    expect(screen.getByText('Needs an update. me@devbox')).toBeTruthy()
  })

  it('checks for updates on the app and reads the service again', async () => {
    const shown = renderPage()
    await screen.findByText(/Running v0\.83\.0/)
    await userEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(shown.onCheck).toHaveBeenCalledOnce()
    await waitFor(() => { expect(daemon.loadLocalServiceReport).toHaveBeenCalledTimes(2) })
  })

  it('offers the app its next step by its state', () => {
    const shown = renderPage({ updates: updates({ status: 'ready', version: '0.85.0' }) })
    return userEvent.click(screen.getByRole('button', { name: 'Restart to update' })).then(() => { expect(shown.onRestart).toHaveBeenCalledOnce() })
  })

  it('restarts a service that is behind only after saying what it will do', async () => {
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Restart now' }))
    expect(await screen.findByText('Your 2 chats are saved.')).toBeTruthy()
    expect(daemon.repairLocalService).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Restart service' }))
    await waitFor(() => { expect(daemon.repairLocalService).toHaveBeenCalledExactlyOnceWith(false) })
  })

  it('starts a service that is not running, which needs no protocol to be understood', async () => {
    daemon.loadLocalServiceReport.mockResolvedValue({ ...report, running: false, behind: false, daemonVersion: null, sessionCount: 0, activeTurnCount: null })
    renderPage()
    expect(await screen.findByText(/Not running\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start service' }))
    expect(await screen.findByText('Start the Maiker service?')).toBeTruthy()
  })

  it('hides the plain restart for chats that are not saved, and keeps the explicit Force update', async () => {
    daemon.loadLocalServiceReport.mockResolvedValue({ ...report, canRestart: false })
    renderPage()
    await screen.findByText(/Running v0\.83\.0/)
    expect(screen.queryByRole('button', { name: 'Restart now' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Force update' }))
    expect(await screen.findByText('Force update the Maiker service?')).toBeTruthy()
    expect(screen.getByText(/cannot confirm that this service's chats are saved/)).toBeTruthy()
  })

  it('asks before updating a machine and updates all that are behind', async () => {
    const info = machines([head('devbox', 'update'), head('build', 'update'), head('ok', null)])
    renderPage({ machines: info })
    await userEvent.click(screen.getAllByRole('button', { name: 'Update' })[0] as HTMLElement)
    expect(await screen.findByRole('button', { name: 'Update devbox now' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await userEvent.click(screen.getByRole('button', { name: 'Update all 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Update all now' }))
    expect(info.onUpdate).toHaveBeenCalledWith('devbox', 'update', false)
    expect(info.onUpdate).toHaveBeenCalledWith('build', 'update', false)
    expect(info.onUpdate).not.toHaveBeenCalledWith('ok', expect.anything(), expect.anything())
  })
})
