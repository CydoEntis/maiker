import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsPreferences } from '../preferences'
import { bindingFor, reservedReason } from '@/features/workspace/model/shortcuts'
import { DesktopSettings, type DesktopSettingsSection, type MachinesInfo } from './DesktopSettings'

const PREFS: SettingsPreferences = { exportFolder: '', confirmSkipped: [], spinner: 'braille', restoreLayout: true, statusBar: true, reduceMotion: false, compactSidebar: false, notifyNeedsYou: true, notifyFinished: true, notificationSound: false, terminalFontSize: 13, terminalFontFamily: '', terminalFontWeight: 400, terminalFontWeightBold: 700, startFolder: '', themeMode: 'dark', darkTheme: 'Maiker Dark', lightTheme: 'Maiker Day', cursorStyle: 'block', scrollback: 10000, scrollSpeed: 1, terminalLineHeight: 1.2, sidebarWidth: 264, sidebarSide: 'left', sidebarSort: 'recent', terminalDock: 'bottom', terminalScreenReader: false, autoDownloadUpdates: true, restartWhenIdle: false, restartServiceWhenIdle: false, monthlyBudget: null, openSessionsIn: 'terminal', defaultAgent: 'claude', hideSuccessfulTools: false, colourFileNames: true, bypassOff: [], updateMachines: true, cursorBlink: false, chatWidth: 'auto', chatTextSize: 100, chatFont: 'inter', interfaceSize: 110, keyOverrides: {} }

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
  return { known: true, list: [], onRetry: vi.fn(), onRemove: vi.fn(), onGrant: vi.fn(), onUpdate: vi.fn(() => Promise.resolve()), onCheckActivity: vi.fn(() => Promise.resolve(null)), onCopyCommand: vi.fn(), onOpenLogin: vi.fn(), onRename: vi.fn(), add: { loadHosts: () => Promise.resolve([]), onAdd: vi.fn(), onCancel: vi.fn(), onProgress: vi.fn(() => Promise.resolve(vi.fn())), open: vi.fn() }, ...overrides }
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
    renderSettings('chat')

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
    renderSettings('chat')

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
    renderSettings('chat', { onSignInAgent })

    await user.click(await screen.findByRole('button', { name: 'Sign in to Codex' }))
    expect(await screen.findByText('Nobody finished the Codex sign-in in time.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign in to Codex in a terminal' }))

    expect(onSignInAgent).toHaveBeenCalledExactlyOnceWith('codex')
  })

  it('says when an agent could not be asked', async () => {
    accounts.loadAgentAuth.mockReset().mockRejectedValue(new Error('The agent did not answer in time'))
    renderSettings('chat')

    expect((await screen.findAllByText('Could not check. The agent did not answer in time.')).length).toBe(2)
  })
})

describe('desktop settings', () => {
  it.each<[DesktopSettingsSection, string, boolean, Partial<SettingsPreferences>]>([
    ['general', 'Status bar', true, { statusBar: false }],
    ['general', 'Update remote machines too', true, { updateMachines: false }],
    ['general', 'Restart the service when idle', false, { restartServiceWhenIdle: true, restartWhenIdle: false }],
    ['permissions', 'Bypass Permissions for Codex', true, { bypassOff: ['codex'] }],
    ['chat', 'Hide successful tool calls', false, { hideSuccessfulTools: true }],
    ['notifications', 'Notify when a session finishes', true, { notifyFinished: false }],
    ['notifications', 'Notify when a session needs you', true, { notifyNeedsYou: false }],
  ])('on %s, the %s switch shows the saved value and saves a flip', async (section, name, checked, patch) => {
    const user = userEvent.setup()
    accounts.loadAgentAuth.mockReset().mockResolvedValue({ installed: false, signedIn: null, account: '', plan: '' })
    const { onChange } = renderSettings(section)
    const toggle = screen.getByRole('switch', { name })
    if (checked) expect(toggle).toBeChecked()
    else expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, ...patch })
  })

  it.each<[DesktopSettingsSection, string, string, Partial<SettingsPreferences>]>([
    ['chat', 'Default agent', 'Codex', { defaultAgent: 'codex' }],
    ['terminal', 'Terminal text size', '15', { terminalFontSize: 15 }],
    ['terminal', 'Cursor', 'Underline', { cursorStyle: 'underline' }],
    ['terminal', 'Lines kept per pane', '100k', { scrollback: 100000 }],
    ['appearance', 'Appearance', 'Light', { themeMode: 'light' }],
    ['appearance', 'Interface size', '125%', { interfaceSize: 125 }],
    ['appearance', 'Chat text size', '90%', { chatTextSize: 90 }],
    ['appearance', 'Chat font', 'Serif', { chatFont: 'serif' }],
  ])('on %s, choosing %s: %s saves it and says so', async (section, group, choice, patch) => {
    const user = userEvent.setup()
    const { onChange } = renderSettings(section)
    expect(screen.getByRole('status', { name: '' })).toBeEmptyDOMElement()
    await user.click(within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: choice }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, ...patch })
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('keeps the rarely changed terminal settings folded under Advanced until Show, and saves them from there', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('terminal')
    expect(screen.queryByRole('radiogroup', { name: 'Terminal text weight' })).toBeNull()
    const show = within(screen.getByRole('region', { name: 'Advanced' })).getByRole('button', { name: 'Show' })
    expect(show).toHaveAttribute('aria-expanded', 'false')
    await user.click(show)
    await user.click(within(screen.getByRole('radiogroup', { name: 'Terminal text weight' })).getByRole('radio', { name: 'Medium' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, terminalFontWeight: 500 })
    await user.click(within(screen.getByRole('radiogroup', { name: 'Terminal bold weight' })).getByRole('radio', { name: 'Extra bold' }))
    expect(onChange).toHaveBeenLastCalledWith({ ...PREFS, terminalFontWeightBold: 800 })
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('radiogroup', { name: 'Terminal text weight' })).toBeNull()
  })

  it('asks once before the view changes, changes nothing on Cancel, and saves the view with the answer', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('general')
    const chat = within(screen.getByRole('radiogroup', { name: 'View' })).getByRole('radio', { name: 'Chat' })

    await user.click(chat)
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(chat)
    const question = await screen.findByRole('alertdialog')
    await user.click(within(question).getByRole('checkbox', { name: 'Don’t ask again' }))
    await user.click(within(question).getByRole('button', { name: 'Switch to Chat' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ...PREFS, openSessionsIn: 'chat', confirmSkipped: ['switch-view'] })
  })

  it('changes the view without asking once Don\'t ask again was ticked', async () => {
    const user = userEvent.setup()
    const preferences: SettingsPreferences = { ...PREFS, confirmSkipped: ['switch-view'] }
    const { onChange } = renderSettings('general', { preferences })
    await user.click(within(screen.getByRole('radiogroup', { name: 'View' })).getByRole('radio', { name: 'Chat' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith({ ...preferences, openSessionsIn: 'chat' })
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

  it('shows a test toast', async () => {
    const user = userEvent.setup()
    const onTestNotice = vi.fn()
    renderSettings('notifications', { onTestNotice })

    await user.click(screen.getByRole('button', { name: 'Show a test' }))
    expect(onTestNotice).toHaveBeenCalledTimes(1)
  })

  it('downloads an available update and turns installing when idle on', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'Maiker 0.61.0 is available.', status: 'available' as const, version: '0.61.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    const { onChange } = renderSettings('general', { updates })

    const box = screen.getByRole('group', { name: 'Updates' })
    await user.click(within(box).getByRole('button', { name: 'Download' }))
    expect(updates.onDownload).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('switch', { name: 'Download updates automatically' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Install updates when idle' })).not.toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Install updates when idle' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ restartWhenIdle: true }))
  })

  it('offers Restart to update once the update is downloaded', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'ready', status: 'ready' as const, version: '0.65.0', onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })

    await user.click(screen.getByRole('button', { name: 'Restart to update' }))

    expect(updates.onRestart).toHaveBeenCalledTimes(1)
  })

  it('checks for an update again on request', async () => {
    const user = userEvent.setup()
    const updates = { summary: 'You are on the latest version.', status: 'current' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() }
    renderSettings('general', { updates })
    await user.click(screen.getByRole('button', { name: 'Check now' }))
    expect(updates.onCheck).toHaveBeenCalledTimes(1)
  })

  it('says a failed update in its own words, with a way to try again', () => {
    renderSettings('general', { updates: { summary: 'The download broke off.', status: 'failed' as const, onCheck: vi.fn(), onDownload: vi.fn(), onRestart: vi.fn() } })
    const box = screen.getByRole('group', { name: 'Updates' })
    expect(box).toHaveTextContent('The download broke off.')
    expect(within(box).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
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

  it('has no switch for errors on Notifications: a stopped agent always says so', () => {
    renderSettings('notifications')
    expect(screen.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'))).toEqual(['Notify when a session needs you', 'Notify when a session finishes'])
  })

  it('asks again about everything Don\'t ask again was ticked on', async () => {
    const user = userEvent.setup()
    const preferences: SettingsPreferences = { ...PREFS, confirmSkipped: ['close-session', 'switch-view'] }
    const { onChange } = renderSettings('general', { preferences })
    await user.click(screen.getByRole('button', { name: 'Ask again' }))
    expect(onChange).toHaveBeenCalledWith({ ...preferences, confirmSkipped: [] })
  })

  it('has nothing to ask again while every question still asks', () => {
    renderSettings('general')
    expect(screen.getByRole('button', { name: 'Ask again' })).toBeDisabled()
  })

  it('replays the welcome from General', async () => {
    const user = userEvent.setup()
    const { onShowWelcome } = renderSettings('general')

    await user.click(screen.getByRole('button', { name: 'Show the welcome again' }))

    expect(onShowWelcome).toHaveBeenCalledTimes(1)
  })
})

describe('the nav', () => {
  it('lists the pages as buttons, marks the current one and opens another', async () => {
    const user = userEvent.setup()
    const { onSection } = renderSettings('appearance')
    const nav = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(nav).getAllByRole('button', { current: 'page' })).toHaveLength(1)
    expect(within(nav).getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).queryByRole('button', { name: /Performance/ })).not.toBeInTheDocument()

    await user.click(within(nav).getByRole('button', { name: 'Remote machines' }))
    expect(onSection).toHaveBeenCalledWith('machines')
  })

  it('does not change page on a letter pressed in the dialog', async () => {
    const user = userEvent.setup()
    const { onSection } = renderSettings('general')
    await user.keyboard('m')
    expect(onSection).not.toHaveBeenCalled()
  })

  it('closes on Esc', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderSettings('general', { onClose })
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
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
    await search('reduce motion')
    expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument()
    expect(await screen.findByText(/setting(s)? match(es)? “reduce motion”/)).toBeInTheDocument()
    expect(screen.getByText('Reduce motion')).toBeInTheDocument()
    expect(screen.queryByText('Dark theme')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Appearance · / }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { current: 'page' })).not.toBeInTheDocument()
  })

  it('opens the page of a result from its title and leaves the search', async () => {
    const { onSection } = renderSettings('general')
    const user = await search('sidebar position')
    const [result] = screen.getAllByRole('button', { name: /^Appearance · / })
    if (result === undefined) throw new Error('no Appearance result')
    await user.click(result)
    expect(onSection).toHaveBeenCalledWith('appearance')
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveValue('')
  })

  it('empties the search on Esc before it closes Settings', async () => {
    const onClose = vi.fn()
    renderSettings('general', { onClose })
    const user = await search('sidebar position')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveValue('')
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('puts the window\'s Find key in the search field', async () => {
    renderSettings('general')
    const user = userEvent.setup()
    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}')
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveFocus()
  })
})


describe('the hotkeys page', () => {
  it('takes down a new key for an action and saves it in place of its own', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('keys')

    await user.click(screen.getByRole('button', { name: 'Change the keys for Command palette' }))
    const field = screen.getByRole('button', { name: /^Press the new keys for Command palette/ })
    expect(field).toHaveFocus()
    await user.keyboard('{Control>}{Shift>}h{/Shift}{/Control}')

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keyOverrides: { palette: { mods: ['ctrl', 'shift'], key: 'H' } } }))
  })

  it('refuses a reserved key, or one another action has, saying why, and keeps listening', async () => {
    const user = userEvent.setup()
    const { onChange } = renderSettings('keys')

    await user.click(screen.getByRole('button', { name: 'Change the keys for Command palette' }))
    await user.keyboard('{Control>}c{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent(reservedReason({ mods: ['ctrl'], key: 'C' }, 'linux') ?? 'no reason')
    await user.keyboard('{Control>}{Shift>}v{/Shift}{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent(reservedReason({ mods: ['ctrl', 'shift'], key: 'V' }, 'linux') ?? 'no reason')
    await user.keyboard('{Control>}{Shift>}f{/Shift}{/Control}')
    expect(screen.getByRole('alert')).toHaveTextContent(bindingFor('find').label)

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
    const { onChange } = renderSettings('keys', { preferences: { ...PREFS, keyOverrides: { palette: { mods: ['ctrl', 'shift'], key: 'H' } } } })

    expect(screen.getByRole('group', { name: 'Ctrl Shift H' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change the keys for Interrupt' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset Command palette' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keyOverrides: {} }))
  })
})
