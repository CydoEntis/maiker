import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalServiceReport } from '@/api/daemon'
import { RestartServiceDialog } from './RestartServiceDialog'
import { RestartServiceButton } from './RestartServiceButton'

const daemon = vi.hoisted(() => ({
  isDesktop: vi.fn(() => true),
  loadLocalServiceReport: vi.fn(),
  repairLocalService: vi.fn<(discardUnsaved: boolean) => Promise<unknown>>(),
}))
vi.mock('@/api/daemon', () => daemon)

const toasts = vi.hoisted(() => ({ success: vi.fn(), failed: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: toasts }))

const copied = vi.hoisted(() => ({ copyText: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/clipboard', () => copied)

const report: LocalServiceReport = { appVersion: '0.84.0', running: true, daemonVersion: '0.83.0', fileVersion: '0.84.0', behind: true, fileBehind: false, canRestart: true, sessionCount: 3, activeTurnCount: 1 }

function renderDialog(props: Partial<Parameters<typeof RestartServiceDialog>[0]> = {}) {
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RestartServiceDialog open onOpenChange={onOpenChange} report={report} {...props} />
    </QueryClientProvider>,
  )
  return { onOpenChange }
}

beforeEach(() => {
  vi.clearAllMocks()
  daemon.isDesktop.mockReturnValue(true)
  daemon.repairLocalService.mockResolvedValue({ ...report, behind: false, sessionCount: 3 })
})

describe('the confirm in front of a restart', () => {
  it('says what will happen before anything runs, and runs nothing until confirmed', () => {
    renderDialog()
    expect(screen.getByText('Restart the Maiker service?')).toBeTruthy()
    expect(screen.getByText('Your 3 chats are saved.')).toBeTruthy()
    expect(screen.getByText('1 turn in progress will stop.')).toBeTruthy()
    expect(screen.getByText('Chats come back asleep. After the restart you can press Resume 3 chats.')).toBeTruthy()
    expect(daemon.repairLocalService).not.toHaveBeenCalled()
  })

  it('restarts without discarding anything, closes, and says the chats came back asleep', async () => {
    const { onOpenChange } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Restart service' }))
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false) })
    expect(daemon.repairLocalService).toHaveBeenCalledExactlyOnceWith(false)
    expect(toasts.success).toHaveBeenCalledWith('Service restarted', { description: 'The service is up to date. Your 3 chats came back asleep.' })
  })

  it('will not restart a service whose chats are not saved, but a force update goes ahead and says so', async () => {
    const unsaved = { ...report, canRestart: false }
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><RestartServiceDialog open onOpenChange={vi.fn()} report={unsaved} /></QueryClientProvider>)
    expect(screen.getByRole('button', { name: 'Restart service' })).toBeDisabled()
    unmount()

    renderDialog({ report: unsaved, force: true })
    expect(screen.getByText(/cannot confirm that this service's chats are saved/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Force update' }))
    await waitFor(() => { expect(daemon.repairLocalService).toHaveBeenCalledExactlyOnceWith(true) })
  })

  it('shows the real error and copies the details when the restart fails, and can try again', async () => {
    daemon.repairLocalService.mockRejectedValueOnce(new Error('the old Maiker service (process 4242) did not stop within 5 seconds'))
    const { onOpenChange } = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Restart service' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('did not stop within 5 seconds')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(copied.copyText).toHaveBeenCalledOnce()
    const text = (copied.copyText.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('App: 0.84.0')
    expect(text).toContain('Service: 0.83.0')
    expect(text).toContain('process 4242')

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => { expect(daemon.repairLocalService).toHaveBeenCalledTimes(2) })
  })

  it('reads the service itself when it is opened without a report', async () => {
    daemon.loadLocalServiceReport.mockResolvedValue({ ...report, sessionCount: 0, activeTurnCount: 0 })
    renderDialog({ report: undefined })
    expect(await screen.findByText('No chats are open.')).toBeTruthy()
  })
})

describe('the restart button in a message about a service that is too old', () => {
  it('opens the same confirm instead of only telling you to restart', async () => {
    daemon.loadLocalServiceReport.mockResolvedValue(report)
    render(<QueryClientProvider client={new QueryClient()}><RestartServiceButton /></QueryClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Restart the Maiker service' }))
    expect(await screen.findByText('Restart the Maiker service?')).toBeTruthy()
  })

  it('is not offered outside the desktop app', () => {
    daemon.isDesktop.mockReturnValue(false)
    render(<QueryClientProvider client={new QueryClient()}><RestartServiceButton /></QueryClientProvider>)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
