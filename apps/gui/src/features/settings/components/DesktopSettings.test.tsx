import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPreferences } from '../preferences'
import { DesktopSettings, type DesktopSettingsSection, type MachinesInfo } from './DesktopSettings'
import { DAEMON_NAME } from '@/brand'

const PREFS: SettingsPreferences = { exportFolder: '', accent: 'teal', spinner: 'braille', restoreLayout: true, reduceMotion: false, animateSidebarActivity: true, compactSidebar: false, notifyNeedsYou: true, notifyFinished: true, notifyError: true, notificationSound: false, toastPosition: 'bottom', terminalFontSize: 13, terminalFontFamily: '', terminalFontWeight: 400, terminalFontWeightBold: 700, startFolder: '', themeMode: 'dark', darkTheme: 'Maiker Dark', lightTheme: 'Maiker Day', cursorStyle: 'block', scrollback: 10000, scrollSpeed: 1, terminalLineHeight: 1.2, density: 'comfortable', sidebarTextSize: 13.5, tabTextSize: 13.5, sidebarWidth: 264, sidebarSide: 'left', sidebarStatusHeadings: true, terminalDock: 'bottom', terminalScreenReader: false, autoDownloadUpdates: true, restartWhenIdle: false, restartServiceWhenIdle: false, monthlyBudget: null, iconSize: 'medium', iconColor: 'color', openSessionsIn: 'terminal', defaultAgent: 'claude', hideSuccessfulTools: false, colourFileNames: true, bypassOff: [], updateMachines: true, perfOverlay: false, terminalPlainDrawing: false, cursorBlink: false, corners: 'square', chatWidth: 'auto', chatTextSize: 100, keyOverrides: {} }

const accounts = vi.hoisted(() => ({
  loadAgentAuth: vi.fn<(agent: string) => Promise<{ installed: boolean; signedIn: boolean | null; account: string; plan: string }>>(),
  signOutAgent: vi.fn<(agent: string) => Promise<void>>(),
}))

const signIn = vi.hoisted(() => ({
  agentSignIn: vi.fn<(agent: string, request: string) => Promise<{ kind: string; link?: string | null; code?: string | null; failure?: string }>>(),
}))

vi.mock('@/api/agentSignIn', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/agentSignIn')>()),
  agentSignIn: signIn.agentSignIn,
}))

vi.mock('@/api/daemon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/daemon')>()),
  loadAgentAuth: accounts.loadAgentAuth,
  signOutAgent: accounts.signOutAgent,
}))

function info(overrides: Partial<MachinesInfo> = {}): MachinesInfo {
  return { known: true, list: [], onRetry: vi.fn(), onRemove: vi.fn(), onGrant: vi.fn(), onUpdate: vi.fn(() => Promise.resolve()), onCheckActivity: vi.fn(() => Promise.resolve(null)), onCopyCommand: vi.fn(), onOpenLogin: vi.fn(), onRename: vi.fn(), hostKey: { inspect: vi.fn(), trust: vi.fn(() => Promise.resolve()) }, add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn(), inspect: vi.fn(), trust: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn() }, ...overrides }
}

function renderSettings(section: DesktopSettingsSection, overrides: Partial<Parameters<typeof DesktopSettings>[0]> = {}) {
  const onChange = vi.fn()
  const onSection = vi.fn()
  const onPreviewTheme = vi.fn()
  const onShowWelcome = vi.fn()
  render(<QueryClientProvider client={new QueryClient()}><DesktopSettings usage={{ budget: null, onBudget: vi.fn(), sessionForTerm: () => null, onOpenSession: vi.fn() }} section={section} onSection={onSection} preferences={PREFS} onChange={onChange} systemReducedMotion={false} systemDark onPreviewTheme={onPreviewTheme} onShowWelcome={onShowWelcome} platform="linux" daemon={{ online: true, sessionCount: 3 }} machines={info()} appVersion="0.64.0" onClose={vi.fn()} {...overrides} /></QueryClientProvider>)
  return { onChange, onSection, onPreviewTheme, onShowWelcome }
}

describe('the agents page', () => {
  it('says who each agent is signed in as, signs one out with its own command, and asks again', async () => {
    const user = userEvent.setup()
    accounts.loadAgentAuth.mockReset().mockImplementation((agent) => Promise.resolve(agent === 'claude'
      ? { installed: true, signedIn: true, account: 'me@example.com', plan: 'max' }
      : { installed: true, signedIn: false, account: '', plan: '' }))
    accounts.signOutAgent.mockReset().mockResolvedValue(undefined)
    renderSettings('permissions')

    expect(await screen.findByText('Signed in as me@example.com · max')).toBeInTheDocument()
    expect(screen.getByText('Installed, not signed in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in to Claude' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out of Claude' }))

    expect(accounts.signOutAgent).toHaveBeenCalledExactlyOnceWith('claude')
    await waitFor(() => { expect(accounts.loadAgentAuth.mock.calls.filter(([agent]) => agent === 'claude')).toHaveLength(2) })
  })

  it('signs an agent in from a card that shows its link and code, and offers nothing for one that is not installed', async () => {
    const user = userEvent.setup()
    accounts.loadAgentAuth.mockReset().mockImplementation((agent) => Promise.resolve(agent === 'claude'
      ? { installed: false, signedIn: null, account: '', plan: '' }
      : { installed: true, signedIn: false, account: '', plan: '' }))
    signIn.agentSignIn.mockReset().mockResolvedValue({ kind: 'waiting', link: 'https://auth.example/device', code: 'AB12-CD34' })
    renderSettings('permissions')

    expect(await screen.findByText('Not installed on this computer.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in to Claude' })).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Sign in to Codex' }))

    expect(signIn.agentSignIn).toHaveBeenCalledWith('codex', 'start')
    const card = await screen.findByRole('region', { name: 'Sign in to Codex' })
    expect(within(card).getByLabelText('One-time code')).toHaveTextContent('AB12-CD34')
    expect(within(card).getByRole('button', { name: 'Open link' })).toBeInTheDocument()

    signIn.agentSignIn.mockResolvedValue({ kind: 'idle' })
    await user.click(within(card).getByRole('button', { name: 'Cancel' }))
    expect(signIn.agentSignIn).toHaveBeenCalledWith('codex', 'cancel')
    expect(screen.queryByRole('region', { name: 'Sign in to Codex' })).not.toBeInTheDocument()
  })

  it('says why a sign-in failed and then offers the agent\'s own sign-in in a terminal', async () => {
    const user = userEvent.setup()
    const onSignInAgent = vi.fn()
    accounts.loadAgentAuth.mockReset().mockResolvedValue({ installed: true, signedIn: false, account: '', plan: '' })
    signIn.agentSignIn.mockReset().mockResolvedValue({ kind: 'failed', failure: 'timed-out' })
    renderSettings('permissions', { onSignInAgent })

    await user.click(await screen.findByRole('button', { name: 'Sign in to Codex' }))
    expect(await screen.findByText('Nobody finished the Codex sign-in in time.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to Codex in a terminal' }))

    expect(onSignInAgent).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('says when an agent could not be asked', async () => {
    accounts.loadAgentAuth.mockReset().mockRejectedValue(new Error('The agent did not answer in time'))
    renderSettings('permissions')

    expect((await screen.findAllByText('Could not check: The agent did not answer in time')).length).toBe(2)
  })
})

describe('desktop settings', () => {
  it('groups the sections the way the design does', () => {
    renderSettings('general')
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(nav).toHaveTextContent('APPGeneralGAppearanceAPerformancePNotificationsNHotkeys?AGENTSChatCPermissionsETerminalTExtensionsXMACHINESRemote machinesM')
    expect(within(nav).getByRole('button', { name: /General/ })).toHaveAttribute('aria-current', 'page')
  })

  it('closes with a plain icon button, not a labelled one', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderSettings('general', { onClose })
    const close = screen.getByRole('button', { name: 'Close settings' })

    expect(close).toHaveAttribute('title', 'Close (Esc)')
    expect(close).toHaveTextContent('')
    await user.click(close)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('saves exports to Downloads until a folder is picked with the system picker', async () => {
    const user = userEvent.setup()
    const onChooseFolder = vi.fn().mockResolvedValue('/home/casey/exports')
    const { onChange } = renderSettings('general', { onChooseFolder })

    expect(screen.getByText('Your Downloads folder')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose the export folder' }))

    await waitFor(() => { expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ exportFolder: '/home/casey/exports' })) })
  })

  it('picks the start folder with the system picker and saves it like a typed one', async () => {
    const user = userEvent.setup()
    const onChooseFolder = vi.fn().mockResolvedValue('/home/casey/dev')
    const { onChange } = renderSettings('general', { onChooseFolder })

    // The folder is picked, never typed: there is no field to type a path into.
    expect(screen.queryByRole('textbox', { name: 'Start folder' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Start folder' })).getByText('Your home folder')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose the start folder' }))

    expect(onChooseFolder).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startFolder: '/home/casey/dev' })) })
  })

  it('leaves the start folder alone when the picker is cancelled', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('general', { onChooseFolder: vi.fn().mockResolvedValue(null) })
    await user.click(screen.getByRole('button', { name: 'Choose the start folder' }))

    expect(within(screen.getByRole('region', { name: 'Start folder' })).getByText('Your home folder')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('chooses the default agent and what a new session opens as', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    const agent = screen.getByRole('radiogroup', { name: 'Default agent' })
    expect(within(agent).getByRole('radio', { name: 'Claude' })).toBeChecked()
    await user.click(within(agent).getByRole('radio', { name: 'Codex' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ defaultAgent: 'codex' }))
  })

  it('has a switch to update remote machines after this computer, on by default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('general')
    const remote = screen.getByRole('switch', { name: 'Update remote machines too' })
    expect(remote).toBeChecked()
    await user.click(remote)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ updateMachines: false }))
  })

  it('has a Bypass Permissions switch for each agent on the Permissions page, all on, shared with the terminal app', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('permissions')

    for (const agent of ['Claude', 'Codex', 'Gemini']) expect(screen.getByRole('switch', { name: `Bypass Permissions for ${agent}` })).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Bypass Permissions for Codex' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bypassOff: ['codex'] }))
  })

  it('turns on hiding successful tool calls, off by default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    expect(screen.getByRole('switch', { name: 'Hide successful tool calls' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Hide successful tool calls' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideSuccessfulTools: true }))
  })

  it('shows a test toast, and moves the toasts to the top right when asked', async () => {
    const user = userEvent.setup()
    const onTestNotice = vi.fn()
    const { onChange } = renderSettings('notifications', { onTestNotice })

    await user.click(screen.getByRole('button', { name: 'Show a test' }))
    expect(onTestNotice).toHaveBeenCalledTimes(1)
    await user.click(within(screen.getByRole('radiogroup', { name: 'Toast position' })).getByRole('radio', { name: 'Top right' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, toastPosition: 'top' })
  })

  it('keeps the two update switches on General, and the update itself at the foot of the nav', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'Maiker 0.61.0 is available.', status: 'available' as const, version: '0.61.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    const { onChange } = renderSettings('general', { updates })

    const box = within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('group', { name: 'Updates' })
    expect(within(box).getByRole('status')).toHaveTextContent('v0.61.0 is available')
    expect(box).toHaveTextContent('v0.64.0')
    await user.click(within(box).getByRole('button', { name: 'Download' }))
    expect(updates.onDownload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch', { name: 'Download updates automatically' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Install updates when idle' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Install updates when idle' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ restartWhenIdle: true }))
  })

  it('keeps restarting the service when idle apart from installing app updates, and off by default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('general')
    expect(screen.getByRole('switch', { name: 'Restart the service when idle' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Restart the service when idle' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ restartServiceWhenIdle: true, restartWhenIdle: false }))
  })

  it('offers Restart to update once the update is downloaded', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'ready', status: 'ready' as const, version: '0.65.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    expect(screen.getByRole('group', { name: 'Updates' })).toHaveTextContent('v0.65.0 is ready')
    await user.click(screen.getByRole('button', { name: 'Restart to update' }))

    expect(updates.onRestart).toHaveBeenCalledTimes(1)
  })

  it('offers nothing to press while a download runs', () => {
    const updates = { summary: 'Downloading Maiker 0.72.0…', status: 'downloading' as const, version: '0.72.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    expect(within(screen.getByRole('group', { name: 'Updates' })).getByRole('status')).toHaveTextContent('Downloading v0.72.0')
    expect(within(screen.getByRole('group', { name: 'Updates' })).queryByRole('button')).toBeNull()
  })

  it('shows how far a download is: a bar, what has arrived, the percent and the time left', () => {
    const download = { progress: 0.42, transfer: { received: 42 * 1024 * 1024, total: 100 * 1024 * 1024, bytesPerSecond: 1024 * 1024 } }
    const updates = { summary: 'Downloading Maiker 0.74.0…', status: 'downloading' as const, version: '0.74.0', download, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    expect(screen.getByRole('progressbar', { name: 'Download' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42.0 MB of 100 MB')).toBeInTheDocument()
    expect(screen.getByText('42% · about 1 min left')).toBeInTheDocument()
    expect(screen.getByText('Downloading v0.74.0 · 42%')).toBeInTheDocument()
  })

  it('keeps the bar moving before the size of a download is known', () => {
    const updates = { summary: 'Downloading Maiker 0.74.0…', status: 'downloading' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })
    const bar = screen.getByRole('progressbar', { name: 'Download' })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveClass('is-unknown')
    expect(screen.getByText('Starting…')).toBeInTheDocument()
  })

  it('shows no download bar when nothing is downloading, and checks again on request', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'You are on the latest version.', status: 'current' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Updates' })).toHaveTextContent('Up to date')
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(updates.onCheck).toHaveBeenCalledTimes(1)
  })

  it('says a failed update in its own words, with a way to try again', () => {
    renderSettings('general', { updates: { summary: 'The download broke off.', status: 'failed' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() } })
    const box = screen.getByRole('group', { name: 'Updates' })
    expect(box).toHaveTextContent('Update failed')
    expect(box).toHaveTextContent('The download broke off.')
    expect(within(box).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('has one switch each for needs you, done and error notifications', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('notifications')

    await user.click(screen.getByRole('switch', { name: 'Notify when a session errors' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, notifyError: false })
    await user.click(screen.getByRole('switch', { name: 'Notify when a session finishes' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, notifyFinished: false })
    await user.click(screen.getByRole('switch', { name: 'Notify when a session needs you' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, notifyNeedsYou: false })
  })

  it('sets the text size, cursor and scrollback for every pane', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('terminal')

    expect(within(screen.getByRole('radiogroup', { name: 'Terminal text size' })).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['11', '12', '13', '14', '15', '16'])
    await user.click(screen.getByRole('radio', { name: '15' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, terminalFontSize: 15 })
    await user.click(screen.getByRole('radio', { name: 'Underline' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, cursorStyle: 'underline' })
    await user.click(screen.getByRole('radio', { name: '50k' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, scrollback: 50000 })
    await user.click(screen.getByRole('radio', { name: '100k' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, scrollback: 100000 })
  })

  it('offers no working-spinner choice: the M loader is the one spinner', () => {
    renderSettings('appearance')
    expect(screen.queryByRole('button', { name: /^Working spinner/ })).toBeNull()
  })

  it('measures running animations on the Performance page and offers no animation level to choose', () => {
    renderSettings('performance')

    expect(screen.getByText('Animations running')).toBeInTheDocument()
    expect(screen.queryByText('Animations')).not.toBeInTheDocument()
  })

  it('picks a dark and a light theme separately, from searchable dropdowns that list the one in use first', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance', { preferences: { ...PREFS, darkTheme: 'Gruvbox Dark' } })
    expect(screen.queryByText(/themes installed/)).not.toBeInTheDocument()
    expect(screen.queryByText('in use')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dark theme: Gruvbox Dark' }))
    const dark = (await screen.findByRole('radiogroup', { name: 'Dark themes' }))
    expect(within(dark).getAllByRole('radio')[0]).toHaveTextContent('Gruvbox Dark')
    expect(within(dark).queryByRole('radio', { name: /Maiker Day/ })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search dark themes' }), 'tokyo')
    expect(within(dark).getAllByRole('radio')).toHaveLength(1)
    await user.click(within(dark).getByRole('radio', { name: /Tokyo Night/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ darkTheme: 'Tokyo Night' }))
    expect(screen.queryByRole('radiogroup', { name: 'Dark themes' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Light theme: Maiker Day' }))
    expect(within((await screen.findByRole('radiogroup', { name: 'Light themes' }))).getByRole('radio', { name: /GitHub Light/ })).toBeInTheDocument()
  })

  it('switches between System, Dark and Light', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance', { preferences: { ...PREFS, themeMode: 'system' } })
    expect(within(screen.getByRole('radiogroup', { name: 'Appearance' })).getByRole('radio', { name: 'System' })).toBeChecked()

    await user.click(within(screen.getByRole('radiogroup', { name: 'Appearance' })).getByRole('radio', { name: 'Light' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ themeMode: 'light' }))
  })

  it('opens the theme list outside its card, so the card cannot clip it, and closes it on Escape', async () => {
    const user = userEvent.setup()
    renderSettings('appearance')

    await user.click(screen.getByRole('button', { name: 'Dark theme: Maiker Dark' }))
    const list = (await screen.findByRole('radiogroup', { name: 'Dark themes' }))
    expect(list.closest('.mx-scard')).toBeNull()
    expect(list.closest('.mx-picker-menu')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search dark themes' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('radiogroup', { name: 'Dark themes' })).not.toBeInTheDocument()
  })

  it('previews a hovered theme only for the slot that is in use, and ends the preview on leaving', async () => {
    const user = userEvent.setup()
    const { onPreviewTheme } = renderSettings('appearance', { preferences: { ...PREFS, themeMode: 'dark' } })

    await user.click(screen.getByRole('button', { name: 'Dark theme: Maiker Dark' }))
    await user.hover(within((await screen.findByRole('radiogroup', { name: 'Dark themes' }))).getByRole('radio', { name: /Gruvbox Dark/ }))
    expect(onPreviewTheme).toHaveBeenLastCalledWith('Gruvbox Dark')
    await user.hover(screen.getByRole('textbox', { name: 'Search dark themes' }))
    expect(onPreviewTheme).toHaveBeenLastCalledWith(null)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Light theme: Maiker Day' }))
    onPreviewTheme.mockClear()
    await user.hover(within((await screen.findByRole('radiogroup', { name: 'Light themes' }))).getByRole('radio', { name: /GitHub Light/ }))
    expect(onPreviewTheme).not.toHaveBeenCalledWith('GitHub Light')
  })

  it('has no status effect, animation level or working-effect controls', () => {
    renderSettings('appearance')
    expect(screen.queryByRole('radiogroup', { name: 'Animations' })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Working effect' })).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Needs you' })).toBeNull()
  })

  it(`shows only what ${DAEMON_NAME} reports about itself, as This computer on the Machines page`, async () => {
    const user = userEvent.setup()
    renderSettings('machines', { daemon: { online: false, sessionCount: 3 } })
    await user.click(screen.getByRole('button', { name: 'Details' }))
    const here = screen.getByRole('region', { name: 'This computer' })
    expect(within(here).getByRole('status')).toHaveTextContent('Disconnected')
    expect(within(here).getByText('Sessions').parentElement?.parentElement).toHaveTextContent('3')
    expect(within(here).queryByText('Version')).not.toBeInTheDocument()
    expect(within(here).queryByText('Socket')).not.toBeInTheDocument()
  })

  it('picks the terminal font from a list that starts with the bundled one, and keeps a saved family that is not installed', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('terminal', { preferences: { ...PREFS, terminalFontFamily: 'Fira Code' } })
    const button = screen.getByRole('button', { name: 'Terminal font family: Fira Code' })
    expect(button).toHaveTextContent('Saved choice')

    await user.click(button)
    const list = await screen.findByRole('menu', { name: /^Terminal font family/ })
    expect(within(list).getByRole('menuitemradio', { name: /Fira Code/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(within(list).getByRole('menuitemradio', { name: /Geist Mono/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ terminalFontFamily: '' }))
  })

  it('sets the normal and the bold weight of the terminal text', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('terminal')

    await user.click(within(screen.getByRole('radiogroup', { name: 'Terminal text weight' })).getByRole('radio', { name: 'Medium' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ terminalFontWeight: 500 }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Terminal bold weight' })).getByRole('radio', { name: 'Extra bold' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ terminalFontWeightBold: 800 }))
  })

  it('sets how big the sidebar icons are, from the Appearance page', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance')

    await user.click(within(screen.getByRole('radiogroup', { name: 'Sidebar icon size' })).getByRole('radio', { name: 'Small' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ iconSize: 'small' }))
  })

  it('has a Show status headings switch beside the sidebar settings, on by default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance')
    const headings = screen.getByRole('switch', { name: 'Show status headings' })
    expect(headings).toBeChecked()
    await user.click(headings)
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sidebarStatusHeadings: false }))
  })

  it('has no sidebar grouping or order control: the sidebar is one tree', () => {
    renderSettings('appearance')
    expect(screen.getByRole('switch', { name: 'Show status headings' })).toBeTruthy()
    expect(screen.queryByText('Group sessions by')).toBeNull()
    expect(screen.queryByText('Session order')).toBeNull()
  })

  it('offers square or rounded corners, with the current one checked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance', { preferences: { ...PREFS, corners: 'square' } })
    const corners = screen.getByRole('radiogroup', { name: 'Corners' })

    expect(within(corners).getAllByRole('radio').map((item) => item.textContent)).toEqual(['Square', 'Rounded'])
    expect(within(corners).getByRole('radio', { name: 'Square' })).toHaveAttribute('aria-checked', 'true')

    await user.click(within(corners).getByRole('radio', { name: 'Rounded' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ corners: 'rounded' }))
  })

  it('replays the welcome from General', async () => {
    const user = userEvent.setup()
    const { onShowWelcome } = renderSettings('general')

    await user.click(screen.getByRole('button', { name: 'Show the welcome again' }))

    expect(onShowWelcome).toHaveBeenCalledTimes(1)
  })
})

describe('performance section', () => {
  it('shows what it measures and turns the overlay on', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('performance')
    expect(screen.getByRole('region', { name: 'Web view' })).toHaveTextContent('Frames')
    expect(screen.getByRole('region', { name: 'Processes' })).toHaveTextContent('Daemons')
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Show the performance overlay' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ perfOverlay: true }))
  })

  it('turns terminal drawing without the GPU on, for a web view that shows typed text late', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('performance')
    await user.click(screen.getByRole('switch', { name: 'Draw terminals without the GPU' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ terminalPlainDrawing: true }))
  })
})

describe('searching settings', () => {
  // A search draws every page, Permissions with its accounts among them.
  beforeEach(() => {
    accounts.loadAgentAuth.mockReset().mockResolvedValue({ installed: false, signedIn: null, account: '', plan: '' })
  })

  const search = async (text: string) => {
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Search settings' }), text)
    return user
  }

  it('shows the matching rows of every page, titled with their page', async () => {
    renderSettings('general')
    await search('corners')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(await screen.findByText(/setting(s)? match(es)? “corners”/)).toBeInTheDocument()
    expect(screen.getByText('Corners')).toBeInTheDocument()
    expect(screen.queryByText('Dark theme')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Appearance · / }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { current: 'page' })).not.toBeInTheDocument()
  })

  it('draws nothing but groups while searching, so no page shows what was not asked for', async () => {
    renderSettings('general')
    await search('zzzz')
    expect(await screen.findByText('No settings match “zzzz”.')).toBeInTheDocument()
    const strays = Array.from(document.querySelectorAll('.mx-settings-sections > *')).filter((child) => !child.matches('.mx-scard, .mx-settings-none'))
    expect(strays.map((child) => child.className)).toEqual([])
  })

  it('shows every group of a page whose name matches', async () => {
    renderSettings('general')
    await search('machines')
    expect(within(screen.getByRole('region', { name: 'This computer' })).getAllByText(/./).length).toBeGreaterThan(1)
  })

  it('opens the page of a result from its title and leaves the search', async () => {
    const { onSection } = renderSettings('general')
    const user = await search('corners')
    const [result] = screen.getAllByRole('button', { name: /^Appearance · / })
    if (result === undefined) throw new Error('no Appearance result')
    await user.click(result)
    expect(onSection).toHaveBeenCalledWith('appearance')
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveValue('')
  })

  it('empties the search on Esc before it closes Settings', async () => {
    const onClose = vi.fn()
    renderSettings('general', { onClose })
    const user = await search('corners')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('does not jump pages on a letter typed into the search', async () => {
    const { onSection } = renderSettings('general')
    await search('m')
    expect(onSection).not.toHaveBeenCalled()
  })
})


describe('the hotkeys page', () => {
  it('takes down a new key for an action and saves it in place of its own', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('keys')

    await user.click(screen.getByRole('button', { name: 'Change the keys for Command palette' }))
    const field = screen.getByRole('button', { name: /^Press the new keys for Command palette/ })
    expect(field).toHaveFocus()
    await user.keyboard('{Control>}{Alt>}p{/Alt}{/Control}')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keyOverrides: { palette: { mods: ['ctrl', 'alt'], key: 'P' } } }))
  })

  it('refuses a key the shell owns, or one another action has, saying why, and keeps listening', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('keys')

    await user.click(screen.getByRole('button', { name: 'Change the keys for Command palette' }))
    await user.keyboard('{Control>}c{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent("Ctrl+C is the shell's own key. Add Shift or Alt.")
    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent('Ctrl+Shift+F is already Find in the pane or every session.')

    expect(screen.getByRole('button', { name: /^Press the new keys for Command palette/ })).toHaveFocus()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('cancels on Esc without closing Settings', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { onChange } = renderSettings('keys', { onClose })

    await user.click(screen.getByRole('button', { name: 'Change the keys for Command palette' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: /^Press the new keys/ })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows a chosen key with Reset, which goes back to the action\'s own, and lists the terminal\'s keys without Change', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('keys', { preferences: { ...PREFS, keyOverrides: { palette: { mods: ['ctrl', 'alt'], key: 'P' } } } })

    expect(screen.getByRole('group', { name: 'Ctrl Alt P' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change the keys for Interrupt' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset Command palette' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keyOverrides: {} }))
  })
})
