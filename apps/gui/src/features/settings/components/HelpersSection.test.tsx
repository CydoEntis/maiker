import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedSettings } from '@/api/sharedSettings'
import { HelpersSection } from './HelpersSection'

const daemon = vi.hoisted(() => ({
  said: null as ((settings: unknown) => void) | null,
  requestSharedSettings: vi.fn<() => Promise<void>>(),
  setHelperSetting: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}))

vi.mock('@/api/sharedSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/sharedSettings')>()),
  listenSharedSettings: (onSettings: (settings: unknown) => void) => {
    daemon.said = onSettings
    return Promise.resolve(() => { daemon.said = null })
  },
  requestSharedSettings: daemon.requestSharedSettings,
  setHelperSetting: daemon.setHelperSetting,
}))

const SHARED: SharedSettings = { default_agent: 'claude', new_session_view: 'chat', sidebar_side: 'left', theme_dark: 'night', theme_light: 'day', appearance: 'dark', spinner: ['a'], start_dir: '', reduce_motion: false, bypass_off: [], update_machines: true, helpers: 'ask', helpers_at_once: 4 }

function daemonSays(settings: SharedSettings) {
  act(() => { daemon.said?.(settings) })
}

const may = () => screen.getByRole('radiogroup', { name: 'When an agent wants helpers' })
const atOnce = () => screen.getByRole('radiogroup', { name: 'Helpers working at once' })
const picked = (name: string) => screen.getByRole('radio', { name })

describe('Settings › Permissions › Helpers', () => {
  beforeEach(() => {
    daemon.said = null
    daemon.requestSharedSettings.mockReset().mockResolvedValue(undefined)
    daemon.setHelperSetting.mockReset().mockResolvedValue(undefined)
  })

  it('asks the daemon, and picks nothing until it answers', async () => {
    render(<HelpersSection />)
    await vi.waitFor(() => { expect(daemon.requestSharedSettings).toHaveBeenCalledOnce() })
    expect(may()).toBeInTheDocument()
    expect(atOnce()).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked()
      expect(radio).toBeDisabled()
    }
  })

  it('shows what the daemon says, and follows a change made in the other app', async () => {
    render(<HelpersSection />)
    await vi.waitFor(() => { expect(daemon.said).not.toBeNull() })
    daemonSays(SHARED)
    expect(picked('Ask')).toBeChecked()
    expect(picked('4')).toBeChecked()
    daemonSays({ ...SHARED, helpers: 'never', helpers_at_once: 8 })
    expect(picked('Never')).toBeChecked()
    expect(picked('8')).toBeChecked()
    expect(picked('4')).not.toBeChecked()
  })

  it('asks the daemon for a change and shows it only once the daemon says it', async () => {
    const user = userEvent.setup()
    render(<HelpersSection />)
    await vi.waitFor(() => { expect(daemon.said).not.toBeNull() })
    daemonSays(SHARED)

    await user.click(picked('Always allow'))
    expect(daemon.setHelperSetting).toHaveBeenCalledExactlyOnceWith('helpers', 'always')
    expect(picked('Ask')).toBeChecked()
    daemonSays({ ...SHARED, helpers: 'always' })
    expect(picked('Always allow')).toBeChecked()

    await user.click(picked('2'))
    expect(daemon.setHelperSetting).toHaveBeenLastCalledWith('helpers_at_once', 2)
  })

  it('says why a change did not happen, and keeps showing what the daemon has', async () => {
    const user = userEvent.setup()
    daemon.setHelperSetting.mockRejectedValue(new Error('the Maiker service running is older than this app and cannot answer this yet'))
    render(<HelpersSection />)
    await vi.waitFor(() => { expect(daemon.said).not.toBeNull() })
    daemonSays(SHARED)

    await user.click(picked('8'))
    expect(await screen.findByRole('alert')).toHaveTextContent('older than this app')
    expect(picked('4')).toBeChecked()
    // The daemon speaking again clears it.
    daemonSays(SHARED)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when the settings cannot be read', async () => {
    daemon.requestSharedSettings.mockRejectedValue(new Error('This computer is not connected'))
    render(<HelpersSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('not connected')
  })
})
