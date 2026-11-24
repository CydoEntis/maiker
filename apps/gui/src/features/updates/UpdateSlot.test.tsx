import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { UpdateSlot } from './UpdateSlot'
import type { UpdaterState } from './useUpdater'

function setup(state: UpdaterState, extra: { skipped?: string | null } = {}) {
  const actions = { onInstall: vi.fn(), onRestartNow: vi.fn(), onCheck: vi.fn(), onSkip: vi.fn() }
  render(<UpdateSlot state={state} version="0.60.2" skipped={extra.skipped ?? null} portalContainer={null} {...actions} />)
  return actions
}

/** The hover card has no role (a tooltip must not hold buttons), so it is found by its class. */
async function findCard(): Promise<HTMLElement> {
  await waitFor(() => { expect(document.querySelector('.mx-upd-card')).not.toBeNull() })
  return document.querySelector<HTMLElement>('.mx-upd-card') as HTMLElement
}

describe('update slot', () => {

  it('offers an available update as an icon button, with a card of the versions and what is new, and downloads on click', async () => {
    const user = userEvent.setup()
    const actions = setup({ status: 'available', version: '0.61.0', notes: '- Faster start\n- Fewer flashes' })

    const button = screen.getByRole('button', { name: 'Update to 0.61.0' })
    await user.hover(button)
    const card = await findCard()
    expect(card).toHaveTextContent('Update ready')
    expect(card).toHaveTextContent('v0.60.2 → v0.61.0')
    expect(card).toHaveTextContent('Faster start')
    expect(card).toHaveTextContent('Click to download · installs on restart')
    await user.click(button)
    expect(actions.onInstall).toHaveBeenCalledTimes(1)
  })

  it('lets a keyboard skip a version and reach the failure text without the hover card', async () => {
    const user = userEvent.setup()
    const actions = setup({ status: 'available', version: '0.61.0', notes: '- Faster start' })
    expect(screen.getByRole('button', { name: 'Update to 0.61.0' })).toHaveAccessibleDescription('Faster start')

    await user.click(screen.getByRole('button', { name: 'Skip version 0.61.0' }))

    expect(actions.onSkip).toHaveBeenCalledWith('0.61.0')
  })

  it('shows no button for a skipped version', () => {
    setup({ status: 'available', version: '0.61.0', notes: '' }, { skipped: '0.61.0' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('restarts on a click of the restart icon and says sessions are saved and a turn in progress stops', async () => {
    const user = userEvent.setup()
    const actions = setup({ status: 'ready', version: '0.61.0' })

    const button = screen.getByRole('button', { name: 'Restart to update' })
    await user.hover(button)
    expect(await findCard()).toHaveTextContent('Click to restart · sessions are saved, a turn in progress stops')
    await user.click(button)

    expect(actions.onRestartNow).toHaveBeenCalledTimes(1)
  })

  it('shows the real error on failure and retries on a click', async () => {
    const user = userEvent.setup()
    const actions = setup({ status: 'failed', message: 'signature mismatch', during: 'update' })

    const button = screen.getByRole('button', { name: 'Update failed' })
    expect(button).toHaveAccessibleDescription('signature mismatch')
    await user.hover(button)
    expect(await findCard()).toHaveTextContent('signature mismatch')
    await user.click(button)

    expect(actions.onCheck).toHaveBeenCalledTimes(1)
  })

  it('shows no button for a failed check, which you did not start', () => {
    setup({ status: 'failed', message: 'offline', during: 'check' })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
