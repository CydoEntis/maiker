import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({ installed: ['claude', 'codex'] as string[] }))

vi.mock('@/api/daemon', () => ({
  agentsInstalled: () => Promise.resolve(host.installed),
}))

import type { MachinesInfo } from '@/features/settings/components/DesktopSettings'
import { Onboarding } from './Onboarding'

const ADD = {
  loadHosts: () => Promise.resolve([{ alias: 'devbox', detail: 'ada@10.0.0.4' }]),
  onAdd: vi.fn(() => Promise.resolve({ outcome: 'added' as const, name: 'devbox', target: 'devbox', version: '0.80.0', reach: 'answered' as const })),
  onCancel: vi.fn(),
}
const MACHINES = { known: true, list: [], add: ADD } as unknown as MachinesInfo

function setup(over: { validateFolder?: (path: string) => Promise<boolean>; onChooseFolder?: (current: string) => Promise<string | null> } = {}) {
  const props = {
    onStartFolder: vi.fn(),
    validateFolder: over.validateFolder ?? (() => Promise.resolve(true)),
    onChooseFolder: over.onChooseFolder ?? (() => Promise.resolve(null)),
    machines: MACHINES,
    reducedMotion: false,
    portalContainer: null,
    onClose: vi.fn(),
  }
  render(<Onboarding {...props} />)
  return props
}

describe('Onboarding', () => {
  beforeEach(() => { host.installed = ['claude', 'codex'] })

  it('shows what is installed on step 1 and says Gemini is missing', async () => {
    setup()
    expect(screen.getByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Gemini shows up here once its CLI is installed.')).toBeInTheDocument()
  })

  it('goes back with the button and with Esc', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Get started' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Get started' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
  })

  it('moves a step on with Enter', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Enter}')
    await waitFor(() => { expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument() })
  })

  it('starts in a typed folder that exists', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: 'Get started' }))
    await user.click(screen.getByRole('radio', { name: /Add a project folder/ }))
    expect(screen.getByRole('button', { name: 'Pick a folder' })).toHaveAttribute('aria-disabled', 'true')
    await user.type(screen.getByRole('textbox', { name: 'Folder' }), '~/code/acme-store')
    await user.click(screen.getByRole('button', { name: 'Start in acme-store' }))
    await waitFor(() => { expect(props.onClose).toHaveBeenCalledWith(true) })
    expect(props.onStartFolder).toHaveBeenCalledWith('~/code/acme-store')
  })

  it('says so when the folder is not there and stays put', async () => {
    const user = userEvent.setup()
    const props = setup({ validateFolder: () => Promise.resolve(false) })
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('radio', { name: /Add a project folder/ }))
    await user.type(screen.getByRole('textbox', { name: 'Folder' }), '/nope{Enter}')
    expect(await screen.findByText(/That folder was not found/)).toBeInTheDocument()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onStartFolder).not.toHaveBeenCalled()
  })

  it('fills the path from Browse', async () => {
    const user = userEvent.setup()
    setup({ onChooseFolder: () => Promise.resolve('/home/ada/api') })
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('radio', { name: /Add a project folder/ }))
    await user.click(screen.getByRole('button', { name: 'Browse…' }))
    expect(await screen.findByDisplayValue('/home/ada/api')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start in api' })).toBeInTheDocument()
  })

  it('skips from any step without saving a choice', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(props.onClose).toHaveBeenCalledWith(false)
    expect(props.onStartFolder).not.toHaveBeenCalled()
  })

  it('embeds the add-a-machine panel and finishes once the machine is added', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: 'Get started' }))
    await user.click(screen.getByRole('radio', { name: /Connect a remote machine/ }))
    expect(screen.queryByRole('button', { name: 'Pick one to continue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Connect to devbox' }))
    await waitFor(() => { expect(props.onClose).toHaveBeenCalledWith(false) })
    expect(ADD.onAdd).toHaveBeenCalledWith('devbox', 'devbox', undefined)
  })

  it('leaves Esc to the add-a-machine panel', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Enter}')
    await user.click(screen.getByRole('radio', { name: /Connect a remote machine/ }))
    await user.click(await screen.findByRole('textbox', { name: 'Address' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('heading', { name: 'Get started' })).toBeInTheDocument()
  })
})
