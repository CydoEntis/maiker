
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { ServiceBehindNotice } from './ServiceBehindNotice'
import { SERVICE_STATUS_POLL_MS } from './serviceRestart'

const daemon = vi.hoisted(() => ({
  loadDaemonUpdateStatus: vi.fn(),
  restartStaleDaemon: vi.fn<(version: string) => Promise<void>>(),
}))
vi.mock('@/api/daemon', () => daemon)

const toasts = vi.hoisted(() => ({
  warning: vi.fn<(title: string, options?: { action?: { label: string; onClick: () => void } }) => void>(),
  error: vi.fn(),
  failed: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ toast: toasts }))

const behind = { daemonVersion: '0.71.0', behind: true, canRestart: true, sessionCount: 11, activeTurnCount: 1 }

function renderNotice(restartServiceWhenIdle = false, { statuses = [] as string[], starting = false, afterAppUpdate = false } = {}) {
  const refetch = vi.fn(() => Promise.resolve())
  const sessionsQuery = { isSuccess: true, refetch, data: statuses.map((status) => ({ status })) } as unknown as UseQueryResult<Conversation[]>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ServiceBehindNotice sessionsQuery={sessionsQuery} restartServiceWhenIdle={restartServiceWhenIdle} starting={starting} afterAppUpdate={afterAppUpdate} />
    </QueryClientProvider>,
  )
  return { refetch }
}

beforeEach(() => {
  vi.clearAllMocks()
  daemon.loadDaemonUpdateStatus.mockResolvedValue(behind)
  daemon.restartStaleDaemon.mockResolvedValue()
})

describe('a service a release behind, with nobody mid-turn', () => {
  const idle = { ...behind, activeTurnCount: 0 }

  it('is restarted without asking, once, and says the sessions came back', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
    const { refetch } = renderNotice(true)

    await waitFor(() => { expect(toasts.success).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).toHaveBeenCalledExactlyOnceWith('0.71.0')
    expect(refetch).toHaveBeenCalled()
    expect(toasts.success.mock.calls[0]).toEqual(['Service restarted', { description: 'It restarted by itself to finish the update. 11 sessions came back.' }])
    expect(toasts.warning).not.toHaveBeenCalled()
  })

  it('is left alone and asked about when an agent is working', async () => {
    renderNotice(true)
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
  })

  it.each([
    ['an agent is working', { statuses: ['idle', 'working'] }],
    ['an agent needs the user', { statuses: ['needs-you'] }],
    ['a session is being restored', { statuses: ['recovery'] }],
    ['a session status is unknown', { statuses: ['unknown'] }],
    ['a session is starting', { starting: true }],
  ])('is left alone and the notice stays while %s, though the service counts nobody', async (_name, options) => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
    renderNotice(true, options)
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
  })

  it('restarts when every session rests', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
    renderNotice(true, { statuses: ['idle', 'done'] })
    await waitFor(() => { expect(daemon.restartStaleDaemon).toHaveBeenCalledExactlyOnceWith('0.71.0') })
  })

  it('falls back to the notice and its button when the restart fails', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
    daemon.restartStaleDaemon.mockRejectedValueOnce(new Error('busy'))
    renderNotice(true)

    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).toHaveBeenCalledTimes(1)
    expect(toasts.warning.mock.calls[0]?.[1]?.action?.label).toBe('Restart…')
  })
})

describe('the notice that the service is a release behind', () => {
  it('says nothing when the service is current', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue({ daemonVersion: null, behind: false, canRestart: false, sessionCount: 3, activeTurnCount: 0 })
    renderNotice()

    await waitFor(() => { expect(daemon.loadDaemonUpdateStatus).toHaveBeenCalled() })
    expect(toasts.warning).not.toHaveBeenCalled()
  })

  it('offers no restart when the sessions are not saved', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue({ ...behind, canRestart: false })
    renderNotice()

    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(toasts.warning.mock.calls[0]?.[1]?.action).toBeUndefined()
  })

  it('says what the restart costs before it restarts anything', async () => {
    renderNotice()
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalled() })

    toasts.warning.mock.calls[0]?.[1]?.action?.onClick()

    expect(await screen.findByText(/11 sessions are saved and come back\. 1 agent turn in progress will stop/)).toBeTruthy()
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
  })

  it('restarts the version it was shown, then reconnects', async () => {
    const { refetch } = renderNotice()
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalled() })
    toasts.warning.mock.calls[0]?.[1]?.action?.onClick()

    await userEvent.click(await screen.findByRole('button', { name: 'Restart service' }))

    await waitFor(() => { expect(refetch).toHaveBeenCalled() })
    expect(daemon.restartStaleDaemon).toHaveBeenCalledWith('0.71.0')
  })

  it('keeps the dialog open and says why when the restart is refused', async () => {
    daemon.restartStaleDaemon.mockRejectedValue(new Error('the local Maiker service changed since the restart prompt opened'))
    renderNotice()
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalled() })
    toasts.warning.mock.calls[0]?.[1]?.action?.onClick()

    await userEvent.click(await screen.findByRole('button', { name: 'Restart service' }))

    // The dialog stays open and says why in its own body, not in a toast.
    expect(await screen.findByRole('alert')).toHaveTextContent('the local Maiker service changed since the restart prompt opened')
    expect(toasts.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restart service' })).toBeTruthy()
  })
})

describe('a service a release behind, right after the app updated', () => {
  it('is updated as part of the app update: restarted once no agent works, with no question and no second toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderNotice(false, { afterAppUpdate: true })
      await vi.advanceTimersByTimeAsync(0)
      // An agent is at work: nothing is asked and nothing is restarted yet.
      expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
      expect(toasts.warning).not.toHaveBeenCalled()

      daemon.loadDaemonUpdateStatus.mockResolvedValue({ ...behind, activeTurnCount: 0 })
      await vi.advanceTimersByTimeAsync(10_000)
      await waitFor(() => { expect(daemon.restartStaleDaemon).toHaveBeenCalledExactlyOnceWith('0.71.0') })
      expect(toasts.warning).not.toHaveBeenCalled()
      expect(toasts.success).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still asks when the service cannot be restarted with nothing lost', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue({ ...behind, canRestart: false })
    renderNotice(false, { afterAppUpdate: true })
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
  })
})

describe('a service left behind by an update that did not go through Restart now', () => {
  const idle = { ...behind, activeTurnCount: 0 }

  function renderByDefault() {
    const sessionsQuery = { isSuccess: true, refetch: vi.fn(() => Promise.resolve()), data: [] } as unknown as UseQueryResult<Conversation[]>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ServiceBehindNotice sessionsQuery={sessionsQuery} />
      </QueryClientProvider>,
    )
  }

  it('restarts by itself with no setting passed and no update flag: the real version mismatch is enough', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
    renderByDefault()
    await waitFor(() => { expect(daemon.restartStaleDaemon).toHaveBeenCalledExactlyOnceWith('0.71.0') })
  })

  it('says it will restart when no chat is busy while one is, and never restarts under it', async () => {
    renderByDefault()
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(toasts.warning.mock.calls[0]?.[1]).toMatchObject({ description: expect.stringContaining('restart it by itself when no chat is busy') as string })
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
  })

  it('never restarts by itself when its sessions are not saved, and does not promise to', async () => {
    daemon.loadDaemonUpdateStatus.mockResolvedValue({ ...idle, canRestart: false })
    renderByDefault()
    await waitFor(() => { expect(toasts.warning).toHaveBeenCalledTimes(1) })
    expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()
    expect(toasts.warning.mock.calls[0]?.[1]).toMatchObject({ description: expect.stringContaining('not saved') as string })
  })

  it('reads the mismatch again on a timer, so a service that fell behind while the app ran is noticed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      daemon.loadDaemonUpdateStatus.mockResolvedValue({ daemonVersion: null, behind: false, canRestart: true, sessionCount: 0, activeTurnCount: 0 })
      renderByDefault()
      await vi.advanceTimersByTimeAsync(0)
      expect(daemon.restartStaleDaemon).not.toHaveBeenCalled()

      daemon.loadDaemonUpdateStatus.mockResolvedValue(idle)
      await vi.advanceTimersByTimeAsync(SERVICE_STATUS_POLL_MS)
      await waitFor(() => { expect(daemon.restartStaleDaemon).toHaveBeenCalledExactlyOnceWith('0.71.0') })
    } finally {
      vi.useRealTimers()
    }
  })
})
