import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPreferences } from '../preferences'
import { machineHeads, type RemoteMachine } from '@/features/workspace/model/machines'
import { DesktopSettings, type DesktopSettingsSection, type MachinesInfo } from './DesktopSettings'
import { DAEMON_NAME } from '@/brand'

const PREFS: SettingsPreferences = { exportFolder: '', accent: 'teal', spinner: 'braille', restoreLayout: true, reduceMotion: false, animateSidebarActivity: true, compactSidebar: false, toastPosition: 'bottom-right', notifyNeedsYou: true, notifyFinished: true, notifyError: true, notificationSound: false, terminalFontSize: 13, terminalFontFamily: '', terminalFontWeight: 400, terminalFontWeightBold: 700, startFolder: '', themeMode: 'dark', darkTheme: 'Maitty Dark', lightTheme: 'Maitty Day', cursorStyle: 'block', scrollback: 10000, scrollSpeed: 1, density: 'comfortable', sidebarTextSize: 13.5, tabTextSize: 13.5, sidebarWidth: 264, sidebarSide: 'left', sidebarOrder: 'creation', sidebarGroup: 'status', terminalDock: 'bottom', terminalScreenReader: false, autoDownloadUpdates: true, restartWhenIdle: false, restartServiceWhenIdle: false, monthlyBudget: null, iconSize: 'medium', iconColor: 'color', chatViewDefault: { claude: 'terminal', codex: 'terminal', gemini: 'terminal' }, defaultAgent: 'claude', hideSuccessfulTools: false, yoloClaude: false, yoloCodex: false, yoloGemini: false, fullAccessNewChats: false, perfOverlay: false, terminalPlainDrawing: false, cursorBlink: false, corners: 'square', chatWidth: 'auto', chatTextSize: 100, keyOverrides: {} }

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
  return { known: true, list: [], onRetry: vi.fn(), onRemove: vi.fn(), onGrant: vi.fn(), onUpdate: vi.fn(() => Promise.resolve()), onCheckActivity: vi.fn(() => Promise.resolve(null)), onCopyCommand: vi.fn(), add: { windows: false, loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn() }, ...overrides }
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
    expect(nav).toHaveTextContent('APPGeneralGAppearanceANotificationsNHotkeys?AGENTSChatCPermissionsETerminalTExtensionsXMACHINESRemote machinesM')
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

  it('sets which view a Claude, Codex or Gemini session opens in, one agent at a time', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    const claude = screen.getByRole('radiogroup', { name: 'Claude sessions open in' })
    expect(within(claude).getByRole('radio', { name: 'Terminal' })).toBeChecked()
    await user.click(within(claude).getByRole('radio', { name: 'Chat' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ chatViewDefault: { claude: 'chat', codex: 'terminal', gemini: 'terminal' } }))
  })

  it('chooses the default agent and what a new session opens as', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    const agent = screen.getByRole('radiogroup', { name: 'Default agent' })
    expect(within(agent).getByRole('radio', { name: 'Claude' })).toBeChecked()
    await user.click(within(agent).getByRole('radio', { name: 'Codex' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ defaultAgent: 'codex' }))
  })

  it('has a yolo switch for each agent, all off, set from the settings screen', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    for (const agent of ['Claude', 'Codex', 'Gemini']) expect(screen.getByRole('switch', { name: `Yolo mode for ${agent}` })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Yolo mode for Codex' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ yoloCodex: true, yoloClaude: false, yoloGemini: false }))
  })

  it('turns on hiding successful tool calls, off by default', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('chat')

    expect(screen.getByRole('switch', { name: 'Hide successful tool calls' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Hide successful tool calls' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideSuccessfulTools: true }))
  })

  it('picks where notifications appear and shows a test card', async () => {
    const user = userEvent.setup()
    const onTestNotice = vi.fn()
    const { onChange } = renderSettings('notifications', { onTestNotice })

    expect(screen.getByRole('button', { name: 'Bottom right' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Bottom left' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ toastPosition: 'bottom-left' }))
    await user.click(screen.getByRole('button', { name: 'Show a test' }))
    expect(onTestNotice).toHaveBeenCalledTimes(1)
  })

  it('keeps the two update switches on General, and the update itself at the foot of the nav', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'Maitty 0.61.0 is available.', status: 'available' as const, version: '0.61.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
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
    const updates = { summary: 'Downloading Maitty 0.72.0…', status: 'downloading' as const, version: '0.72.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    expect(within(screen.getByRole('group', { name: 'Updates' })).getByRole('status')).toHaveTextContent('Downloading v0.72.0')
    expect(within(screen.getByRole('group', { name: 'Updates' })).queryByRole('button')).toBeNull()
  })

  it('shows how far a download is: a bar, what has arrived, the percent and the time left', () => {
    const download = { progress: 0.42, transfer: { received: 42 * 1024 * 1024, total: 100 * 1024 * 1024, bytesPerSecond: 1024 * 1024 } }
    const updates = { summary: 'Downloading Maitty 0.74.0…', status: 'downloading' as const, version: '0.74.0', download, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    expect(screen.getByRole('progressbar', { name: 'Download' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('42.0 MB of 100 MB')).toBeInTheDocument()
    expect(screen.getByText('42% · about 1 min left')).toBeInTheDocument()
    expect(screen.getByText('Downloading v0.74.0 · 42%')).toBeInTheDocument()
  })

  it('keeps the bar moving before the size of a download is known', () => {
    const updates = { summary: 'Downloading Maitty 0.74.0…', status: 'downloading' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
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

    expect(screen.getByText('Geist Mono · 13px')).toBeInTheDocument()
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
    expect(within(dark).queryByRole('radio', { name: /Maitty Day/ })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search dark themes' }), 'tokyo')
    expect(within(dark).getAllByRole('radio')).toHaveLength(1)
    await user.click(within(dark).getByRole('radio', { name: /Tokyo Night/ }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ darkTheme: 'Tokyo Night' }))
    expect(screen.queryByRole('radiogroup', { name: 'Dark themes' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Light theme: Maitty Day' }))
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

    await user.click(screen.getByRole('button', { name: 'Dark theme: Maitty Dark' }))
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

    await user.click(screen.getByRole('button', { name: 'Dark theme: Maitty Dark' }))
    await user.hover(within((await screen.findByRole('radiogroup', { name: 'Dark themes' }))).getByRole('radio', { name: /Gruvbox Dark/ }))
    expect(onPreviewTheme).toHaveBeenLastCalledWith('Gruvbox Dark')
    await user.hover(screen.getByRole('textbox', { name: 'Search dark themes' }))
    expect(onPreviewTheme).toHaveBeenLastCalledWith(null)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Light theme: Maitty Day' }))
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
    await user.click(screen.getByRole('button', { name: /This computer/ }))
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

  it('offers square or rounded corners, with the current one checked', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('appearance', { preferences: { ...PREFS, corners: 'square' } })
    const corners = screen.getByRole('radiogroup', { name: 'Corners' })

    expect(within(corners).getAllByRole('radio').map((item) => item.textContent)).toEqual(['Square', 'Rounded', 'Folded'])
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


function box(kind: RemoteMachine['state']['state'], why: string | null = null): RemoteMachine {
  return { state: { machine: 1, name: 'box', state: kind, why, attempt: null, since: Date.now() - 180_000 }, conversations: [], heard: true, listedAt: 0 }
}

describe('the Machines page', () => {
  const others = (kind: RemoteMachine['state']['state'], why: string | null = null) => machineHeads(new Map([[1, box(kind, why)]])).filter((head) => head.name !== null)
  /** Renders the page with the one machine and opens its settings from its tile. */
  const openBox = async (machines: MachinesInfo, extra: Partial<Parameters<typeof DesktopSettings>[0]> = {}) => {
    const user = userEvent.setup()
    const rendered = renderSettings('machines', { machines, ...extra })
    await user.click(screen.getByRole('button', { name: /^box/ }))
    return { user, ...rendered }
  }

  it('shows placeholders until the host has answered', () => {
    renderSettings('machines', { machines: info({ known: false }) })
    expect(within(screen.getByRole('region', { name: 'Remote machines' })).getByRole('status', { name: 'Reading machines' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add machine' })).toBeDisabled()
  })

  it('says where machines come from when there are none', () => {
    renderSettings('machines')
    expect(screen.getByText(/No other machines/)).toBeInTheDocument()
  })

  it('counts machines by state, filters them, and finds one by name', async () => {
    const user = userEvent.setup()
    const list = machineHeads(new Map([[1, box('connected')], [2, { ...box('unreachable', 'no answer'), state: { ...box('unreachable').state, machine: 2, name: 'lab' } }]])).filter((head) => head.name !== null)
    renderSettings('machines', { machines: info({ list, sessionsOn: (machine) => (machine === 1 ? 2 : 0) }) })

    expect(screen.getByText('2 machines · 1 connected · 1 unreachable')).toBeInTheDocument()
    const tiles = () => screen.getAllByRole('button', { name: /^(box|lab)/ }).map((tile) => tile.querySelector('.mx-mach-name')?.textContent)
    expect(tiles()).toEqual(['lab', 'box'])
    expect(screen.getByRole('button', { name: /^box/ })).toHaveTextContent('2 sessions')

    await user.click(screen.getByRole('radio', { name: /Needs attention/ }))
    expect(tiles()).toEqual(['lab'])
    await user.click(screen.getByRole('radio', { name: /All/ }))
    await user.type(screen.getByRole('textbox', { name: 'Find a machine' }), 'bo')
    expect(tiles()).toEqual(['box'])
  })

  it('opens a machine from its tile, and closes it again', async () => {
    const { user } = await openBox(info({ list: others('connected') }))
    expect(screen.getByRole('region', { name: 'Connection' })).toHaveTextContent('connected')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Connection' })).toBeNull()
  })

  it('shows a machine that is down with its word, how long, and its fix in full', async () => {
    await openBox(info({ list: others('needs-login', 'run ssh box once to log in') }))
    expect(screen.getAllByText(/needs login/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('disconnected since 3m ago').length).toBeGreaterThan(0)
    expect(screen.getByText('run ssh box once to log in')).toBeInTheDocument()
  })

  it('shows a refused machine with the reason, the fix, and Remove to act on it', async () => {
    const why = 'a different machine answers at box (id bbbbbbbb instead of aaaaaaaa). If you replaced that machine, open Machines, remove it and add it again; otherwise check the host name and DNS.'
    await openBox(info({ list: others('refused', why) }))
    expect(screen.getAllByText(/refused/i).length).toBeGreaterThan(0)
    expect(screen.getByText(why)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove box' })).toBeEnabled()
  })

  it('offers to copy the update command, and never runs it', async () => {
    const onCopyCommand = vi.fn()
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box --install` (or set `remote_cmd` to its path), then retry'), onCopyCommand }))
    expect(screen.getByText('maitty machine update box --install')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy the update command for box' }))
    expect(onCopyCommand).toHaveBeenCalledWith('maitty machine update box --install')
  })

  it('asks before updating a machine, says what happens to its sessions, then updates it', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box`, then retry'), onUpdate }))
    expect(screen.getByText('box runs another version of Maitty.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update Maitty on box' }))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(await screen.findByText(/come back with their agents resumed/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Update box now' }))
    expect(onUpdate).toHaveBeenCalledWith('box', 'update', false)
  })

  it('installs on a machine with none in one confirmed click, without asking what is open there', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const onCheckActivity = vi.fn(() => Promise.resolve(null))
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box --install` (or set `remote_cmd` to its path), then retry'), onUpdate, onCheckActivity }))
    expect(screen.getByText('Maitty is not installed on box.')).toBeInTheDocument()
    expect(screen.queryByText(/set `remote_cmd`/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Install Maitty on box' }))
    expect(screen.getByText(/Puts this version of Maitty on box over ssh/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Install on box now' }))
    expect(onUpdate).toHaveBeenCalledWith('box', 'install', false)
    expect(onCheckActivity).not.toHaveBeenCalled()
  })

  it('does not update when the question is cancelled', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box`, then retry'), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'Update Maitty on box' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('can wait for the machine to be idle before it updates', async () => {
    const onUpdate = vi.fn(() => Promise.resolve())
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box`, then retry'), onUpdate }))
    await user.click(screen.getByRole('button', { name: 'Update Maitty on box' }))
    await user.click(await screen.findByRole('button', { name: 'Update box when idle' }))
    expect(onUpdate).toHaveBeenCalledWith('box', 'update', true)
  })

  it('says how many sessions are open and how many are busy before it updates', async () => {
    const onCheckActivity = vi.fn(() => Promise.resolve({ sessions: 3, busy: 1, current: false }))
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box`, then retry'), onCheckActivity }))
    await user.click(screen.getByRole('button', { name: 'Update Maitty on box' }))
    expect(await screen.findByText(/box has 3 sessions open, 1 busy\./)).toBeInTheDocument()
    expect(onCheckActivity).toHaveBeenCalledWith('box')
  })

  it('still asks, and says it could not see what is open, when the machine cannot say', async () => {
    const { user } = await openBox(info({ list: others('needs-update', 'run `maitty machine update box`, then retry'), onCheckActivity: vi.fn(() => Promise.reject(new Error('no route'))) }))
    await user.click(screen.getByRole('button', { name: 'Update Maitty on box' }))
    expect(await screen.findByText(/box could not say what is open on it\./)).toBeInTheDocument()
  })

  it('has no command to copy for a machine that needs nothing installed', async () => {
    await openBox(info({ list: others('unreachable', 'no answer') }))
    expect(screen.queryByRole('button', { name: /Copy the update command/ })).toBeNull()
  })

  it('retries a machine that is down', async () => {
    const onRetry = vi.fn()
    const { user, onChange } = await openBox(info({ list: others('unreachable', 'no answer'), onRetry }))
    await user.click(screen.getByRole('button', { name: 'Retry box' }))
    expect(onRetry).toHaveBeenCalledWith('box')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not offer a retry for a machine that is connected', async () => {
    await openBox(info({ list: others('connected') }))
    expect(screen.queryByRole('button', { name: 'Retry box' })).toBeNull()
  })

  it('asks before removing, and says what stays', async () => {
    const onRemove = vi.fn()
    const { user } = await openBox(info({ list: others('connected'), onRemove }))
    await user.click(screen.getByRole('button', { name: 'Remove box' }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('Removes box from this list. Its sessions keep running on box.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep' }))
    expect(onRemove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove box' }))
    await user.click(screen.getByRole('button', { name: 'Remove box' }))
    expect(onRemove).toHaveBeenCalledWith('box')
  })
})

describe('what a machine may do to this computer', () => {
  it('is off until allowed, and each switch asks for just its own power', async () => {
    const user = userEvent.setup()
    const onGrant = vi.fn()
    const list = machineHeads(new Map([[1, box('connected')]])).filter((head) => head.name !== null)
    renderSettings('machines', { machines: info({ list, onGrant }) })
    await user.click(screen.getByRole('button', { name: /^box/ }))
    const clipboard = screen.getByRole('switch', { name: 'Allow box to copy to your clipboard' })
    const notices = screen.getByRole('switch', { name: 'Allow box to notify you' })
    expect(clipboard).toHaveAttribute('aria-checked', 'false')
    expect(notices).toHaveAttribute('aria-checked', 'false')
    await user.click(notices)
    expect(onGrant).toHaveBeenCalledWith('box', 'notices', true)
    await user.click(clipboard)
    expect(onGrant).toHaveBeenLastCalledWith('box', 'clipboard', true)
  })

  it('shows a power the machine has, and turns it off', async () => {
    const user = userEvent.setup()
    const onGrant = vi.fn()
    const on = box('connected')
    const list = machineHeads(new Map([[1, { ...on, state: { ...on.state, notices: true } }]])).filter((head) => head.name !== null)
    renderSettings('machines', { machines: info({ list, onGrant }) })
    await user.click(screen.getByRole('button', { name: /^box/ }))
    const notices = screen.getByRole('switch', { name: 'Allow box to notify you' })
    expect(notices).toHaveAttribute('aria-checked', 'true')
    await user.click(notices)
    expect(onGrant).toHaveBeenCalledWith('box', 'notices', false)
  })
})

describe('adding a machine', () => {
  const hosts = [{ alias: 'build', detail: 'me@build.example' }, { alias: 'lab', detail: 'lab.example' }]
  const added = (name: string) => ({ outcome: 'added' as const, name, version: 'maitty 1.2.3' })
  /** Opens the add flow from the Machines page. */
  const startAdding = async (add: Partial<MachinesInfo['add']> = {}, extra: Partial<Parameters<typeof DesktopSettings>[0]> = {}) => {
    const user = userEvent.setup()
    renderSettings('machines', { machines: info({ add: { ...info().add, ...add } }), ...extra })
    await user.click(screen.getByRole('button', { name: 'Add machine' }))
    return user
  }
  /** Switches the flow to typing an address, and types it. */
  const byAddress = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
    await user.click(screen.getByRole('radio', { name: 'By address' }))
    await user.type(screen.getByRole('textbox', { name: 'Address' }), text)
  }

  it('says it is loading the hosts, then lists them', async () => {
    let answer: (list: typeof hosts) => void = () => undefined
    await startAdding({ loadHosts: () => new Promise((resolve) => { answer = resolve }) })
    expect(screen.getByRole('status', { name: /Reading hosts/ })).toBeInTheDocument()
    answer(hosts)
    const list = await screen.findByRole('radiogroup', { name: 'Hosts in your ssh config' })
    expect(within(list).getByRole('radio', { name: /build/ })).toBeInTheDocument()
    expect(within(list).getByRole('radio', { name: /lab/ })).toBeInTheDocument()
  })

  it('says so when there are no hosts', async () => {
    await startAdding()
    expect(await screen.findByText(/No new hosts in ~\/\.ssh\/config/)).toBeInTheDocument()
  })

  it('shows why the hosts could not be read', async () => {
    await startAdding({ loadHosts: () => Promise.reject(new Error('config unreadable')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('config unreadable')
  })

  it('connects nothing until a host is picked, then adds it and says what answered', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('build'))
    const user = await startAdding({ loadHosts: () => Promise.resolve(hosts), onAdd })
    expect(screen.getByRole('button', { name: 'Connect machine' })).toBeDisabled()
    await user.click(await screen.findByRole('radio', { name: /build/ }))
    await user.click(screen.getByRole('button', { name: 'Connect build' }))
    expect(onAdd).toHaveBeenCalledWith('build', undefined)
    expect(await screen.findByText(/build is added and connecting\. maitty 1\.2\.3 answered there\./)).toBeInTheDocument()
  })

  it('adds the address as typed, under the name given', async () => {
    const onAdd = vi.fn().mockResolvedValue(added('box'))
    const user = await startAdding({ onAdd })
    await byAddress(user, 'me@box.example')
    await user.type(screen.getByRole('textbox', { name: 'Name in Maitty' }), 'box{Enter}')
    expect(onAdd).toHaveBeenCalledWith('me@box.example', 'box')
  })

  it('shows the words of a machine that cannot be added, and goes back to the form to try again', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('nope.example: could not resolve'))
    const user = await startAdding({ onAdd })
    await byAddress(user, 'nope.example{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('nope.example: could not resolve')
    await user.click(screen.getByRole('button', { name: 'Edit and try again' }))
    expect(screen.getByRole('textbox', { name: 'Address' })).toHaveValue('nope.example')
  })

  it('asks for a name when none can be made', async () => {
    const onAdd = vi.fn().mockResolvedValueOnce({ outcome: 'needs-name' })
    const user = await startAdding({ onAdd })
    await byAddress(user, 'me@{Enter}')
    expect(await screen.findByText('Give me@ a name in Maitty to add it.')).toBeInTheDocument()
  })

  it('shows checking with a way to cancel while ssh is looked at', async () => {
    const onCancel = vi.fn()
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await startAdding({ onAdd, onCancel })
    await byAddress(user, 'slow.example{Enter}')
    expect(within(screen.getByRole('region', { name: 'Add a machine' })).getByText('Reaching slow.example over ssh…')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('ends the look with Esc, and keeps Settings open', async () => {
    const onCancel = vi.fn()
    const onClose = vi.fn()
    const onAdd = vi.fn().mockReturnValue(new Promise(() => undefined))
    const user = await startAdding({ onAdd, onCancel }, { onClose })
    await byAddress(user, 'slow.example{Enter}')
    screen.getByRole('button', { name: 'Cancel' }).focus()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('points at the session to log in with when ssh needs a person', async () => {
    const onAdd = vi.fn().mockResolvedValue({ outcome: 'login', name: 'box' })
    const user = await startAdding({ onAdd })
    await byAddress(user, 'box{Enter}')
    expect(await screen.findByText(/ssh needs you to log in: use the session named “ssh box”/)).toBeInTheDocument()
  })

  it('says that Windows wants keys or an agent, on Windows only', async () => {
    await startAdding({ windows: true })
    expect(screen.getByText(/Windows: use ssh keys or an agent/)).toBeInTheDocument()
  })

  it('goes back to the machines from its breadcrumb', async () => {
    const user = await startAdding()
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('button', { name: 'Remote machines' }))
    expect(screen.getByRole('button', { name: 'Add machine' })).toBeInTheDocument()
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
