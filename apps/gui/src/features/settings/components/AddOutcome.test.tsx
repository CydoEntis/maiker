import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { MachinesInfo } from './DesktopSettings'
import { AddOutcome, type Stage } from './AddOutcome'

function show(stage: Stage) {
  const machines = { onRetry: vi.fn(), onRemove: vi.fn(), onCopyCommand: vi.fn() } as unknown as MachinesInfo
  render(<AddOutcome stage={stage} machines={machines} onTryAgain={vi.fn()} onEdit={vi.fn()} onCancel={vi.fn()} onInstall={vi.fn()} onSkip={vi.fn()} keyCommand={null} onSetUpKey={null} terminal={null} />)
  return machines
}

describe('a failed add', () => {
  it('says a saved name is taken, and retries or removes that machine from the box itself', async () => {
    const user = userEvent.setup()
    const machines = show({ kind: 'failed', message: 'You already have a machine called server-15. Remove it in Remote machines, or pick another name.', host: '100.78.214.15', port: null })
    expect(screen.getByText('server-15 is already added.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry server-15' }))
    expect(machines.onRetry).toHaveBeenCalledWith('server-15')
    await user.click(screen.getByRole('button', { name: 'Remove server-15' }))
    expect(machines.onRemove).toHaveBeenCalledWith('server-15')
  })

  it('shows what ssh said when it is none of the known reasons, without opening anything', () => {
    show({ kind: 'failed', message: 'Something odd happened in ssh', host: 'box', port: null })
    expect(screen.getByText("Couldn't add box.")).toBeInTheDocument()
    expect(screen.getByText('Something odd happened in ssh')).toBeInTheDocument()
  })
})
