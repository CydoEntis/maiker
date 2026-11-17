import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ServiceStatus } from './ServiceStatus'

const base = { online: false, mismatch: false, retryAt: null, detail: null, restart: null, appBehind: null, sessions: 2, onRetry: vi.fn(), onOpenLog: vi.fn() }

describe('the service status', () => {
  it('shows the stopped banner without taking the focus, so the next Enter is not a restart', () => {
    render(<><input aria-label="message" autoFocus /><ServiceStatus {...base} failures={99} /></>)
    expect(screen.getByRole('region', { name: 'Maitty service stopped' })).toBeInTheDocument()
    expect(screen.getByLabelText('message')).toHaveFocus()
  })

  it('keeps Tab inside the app-behind card, and Esc is Later', async () => {
    const appBehind = { label: 'Update Maitty', disabled: false, onPress: vi.fn(), appProtocol: 1, serviceProtocol: 2 }
    render(<ServiceStatus {...base} failures={1} mismatch appBehind={appBehind} />)
    expect(screen.getByRole('region', { name: 'Update Maitty to reconnect' })).toBeInTheDocument()
    const update = screen.getByRole('button', { name: 'Update Maitty' })
    const later = screen.getByRole('button', { name: 'Later' })
    expect(update).toHaveFocus()
    await userEvent.tab()
    expect(later).toHaveFocus()
    await userEvent.tab()
    expect(update).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('region', { name: 'Update Maitty to reconnect' })).toBeNull()
  })
})
