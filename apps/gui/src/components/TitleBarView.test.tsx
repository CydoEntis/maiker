import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TitleBarView, type TitleBarActions } from './TitleBarView'
import { titleBarPlatform, type TitleBarPlatform } from './title-bar-platform'

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'

function actions(overrides: Partial<TitleBarActions> = {}): TitleBarActions {
  return { maximized: false, onMinimize: vi.fn(), onToggleMaximize: vi.fn(), onClose: vi.fn(), ...overrides }
}

describe('titleBarPlatform', () => {
  it('reads the platform from the user agent', () => {
    expect(titleBarPlatform(MAC_UA)).toBe('macos')
    expect(titleBarPlatform(WINDOWS_UA)).toBe('windows')
    expect(titleBarPlatform(LINUX_UA)).toBe('linux')
  })
})

describe('TitleBarView', () => {

  it.each<TitleBarPlatform>(['macos', 'windows', 'linux'])('keeps the drag region and calls the window on %s', async (platform) => {
    const calls = actions()
    render(<TitleBarView platform={platform} actions={calls} />)
    expect(screen.getByRole('banner')).toHaveAttribute('data-tauri-drag-region')
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Minimize'))
    await user.click(screen.getByLabelText('Maximize'))
    await user.click(screen.getByLabelText('Close window'))
    expect(calls.onMinimize).toHaveBeenCalledOnce()
    expect(calls.onToggleMaximize).toHaveBeenCalledOnce()
    expect(calls.onClose).toHaveBeenCalledOnce()
  })

  it.each<TitleBarPlatform>(['macos', 'windows', 'linux'])('offers Restore when maximized on %s', (platform) => {
    render(<TitleBarView platform={platform} actions={actions({ maximized: true })} />)
    expect(screen.getByLabelText('Restore')).toBeInTheDocument()
    expect(screen.queryByLabelText('Maximize')).toBeNull()
  })
})
