import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_NAME } from '@/brand'
import { ServiceChip, ServiceStatus } from './ServiceStatus'

const copied = vi.hoisted(() => vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()))
vi.mock('@/lib/clipboard', () => ({ copyText: copied }))

const base = { stage: 'offline' as const, putOff: false, onPutOff: vi.fn(), mismatch: false, retryAt: null, detail: 'connect ECONNREFUSED: no service on the socket', restart: null, appBehind: null, sessions: 2, onStart: vi.fn(() => Promise.resolve()) }
const OFFLINE_TITLE = `${APP_NAME} can’t reach its background service`

describe('the service-offline dialog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('blocks the window with one alert dialog whose first action, Start service, has the keys; Tab stays inside it', async () => {
    render(<><button type="button">behind</button><ServiceStatus {...base} /></>)
    const dialog = screen.getByRole('alertdialog', { name: OFFLINE_TITLE })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const start = screen.getByRole('button', { name: 'Start service' })
    expect(start).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Not now' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Copy details' })).toHaveFocus()
    await userEvent.tab()
    expect(start).toHaveFocus()
  })

  it('starts the service, saying Starting… until the try settles', async () => {
    const started: { settle: () => void } = { settle: () => undefined }
    const onStart = vi.fn(() => new Promise<void>((resolve) => { started.settle = resolve }))
    render(<ServiceStatus {...base} onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: 'Start service' }))
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    await act(() => { started.settle(); return Promise.resolve() })
    expect(screen.getByRole('button', { name: 'Start service' })).toBeEnabled()
  })

  it('takes Esc and Not now as putting it off, and copies the raw failure', async () => {
    const onPutOff = vi.fn()
    render(<ServiceStatus {...base} onPutOff={onPutOff} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(copied).toHaveBeenCalledWith(base.detail)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onPutOff).toHaveBeenCalledTimes(2)
  })

  it('says when it tries next', () => {
    vi.useFakeTimers({ now: 0 })
    render(<ServiceStatus {...base} retryAt={6000} />)
    expect(screen.getByText('Trying again in 6s')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows nothing for a blip or once put off, and turns green while it picks the chats back up', () => {
    const { rerender } = render(<ServiceStatus {...base} stage="blip" />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    rerender(<ServiceStatus {...base} putOff />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    rerender(<ServiceStatus {...base} stage="found" />)
    const found = screen.getByRole('alertdialog', { name: 'Reconnecting…' })
    expect(found).toHaveClass('is-edge-ok')
    expect(found).toHaveTextContent('Found the service. Picking your chats back up.')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('the protocol dialogs', () => {
  afterEach(() => { vi.clearAllMocks() })

  it('keeps Tab inside the app-behind dialog, and Esc is Later', async () => {
    const onPutOff = vi.fn()
    const appBehind = { label: `Update ${APP_NAME}`, disabled: false, onPress: vi.fn(), appProtocol: 1, serviceProtocol: 2 }
    render(<ServiceStatus {...base} stage="ok" mismatch appBehind={appBehind} onPutOff={onPutOff} />)
    expect(screen.getByRole('alertdialog', { name: `Update ${APP_NAME} to reconnect` })).toHaveTextContent('protocol 1 → 2')
    const update = screen.getByRole('button', { name: `Update ${APP_NAME}` })
    expect(update).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Later' })).toHaveFocus()
    await userEvent.tab()
    expect(update).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(onPutOff).toHaveBeenCalledTimes(1)
  })

  it('restarts an older service on the second click only, and lists what a restart keeps and stops', async () => {
    const onRestart = vi.fn()
    const restart = { label: 'Restart and restore 3 sessions', canRestart: true, pending: false, onRestart, from: 75, to: 76, sessions: 3, working: 1 }
    render(<ServiceStatus {...base} stage="ok" mismatch restart={restart} />)
    const dialog = screen.getByRole('alertdialog', { name: `Restart ${APP_NAME} to finish updating` })
    expect(dialog).toHaveTextContent('3 sessions reopen in the same folders')
    expect(dialog).toHaveTextContent('1 agent was working. It will offer Resume.')
    await userEvent.click(screen.getByRole('button', { name: restart.label }))
    expect(onRestart).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Click again to restart' }))
    expect(onRestart).toHaveBeenCalledTimes(1)
  })
})

describe('the title bar chip', () => {
  it('says Reconnecting… through a blip, and once the dialog is put off a red Offline that opens it again', async () => {
    const onReopen = vi.fn()
    const { rerender } = render(<ServiceChip stage="blip" putOff={false} mismatch={false} appBehind={false} onReopen={onReopen} />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
    rerender(<ServiceChip stage="offline" putOff={false} mismatch={false} appBehind={false} onReopen={onReopen} />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<ServiceChip stage="offline" putOff mismatch={false} appBehind={false} onReopen={onReopen} />)
    await userEvent.click(screen.getByRole('button', { name: /^Offline/ }))
    expect(onReopen).toHaveBeenCalledTimes(1)
    rerender(<ServiceChip stage="ok" putOff mismatch appBehind={false} onReopen={onReopen} />)
    expect(screen.getByRole('button', { name: 'Restart needed' })).toBeInTheDocument()
    rerender(<ServiceChip stage="ok" putOff={false} mismatch={false} appBehind={false} onReopen={onReopen} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
