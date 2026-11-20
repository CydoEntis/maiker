import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  installed: ['claude', 'codex'] as string[],
  progress: vi.fn<(progress: { agent: string; percent: number | null; line: string }) => void>(),
  finish: vi.fn<(result: { version: string | null }) => void>(),
  command: vi.fn((agent: string) => Promise.resolve(`install-${agent} --yes`)),
  install: vi.fn(),
}))

vi.mock('@/api/daemon', () => ({ agentsInstalled: () => Promise.resolve(host.installed) }))
vi.mock('./agentInstall', () => ({
  agentInstallCommand: host.command,
  installAgent: host.install,
  listenInstallProgress: (handler: (progress: { agent: string; percent: number | null; line: string }) => void) => { host.progress.mockImplementation(handler); return Promise.resolve(() => undefined) },
}))
vi.mock('@/api/folders', () => ({
  listFolders: (_machine: number, path: string) => Promise.resolve(path.endsWith('code')
    ? { path, exists: true, entries: [{ name: 'api', git: 'main', has_children: true }, { name: 'web', git: 'dev', has_children: true }, { name: 'notes', git: null, has_children: false }], truncated: false, can_create: true }
    : { path, exists: false, entries: [], truncated: false, can_create: false }),
}))

import { Onboarding } from './Onboarding'

const HOME = '/home/ada'

function setup(over: { validateFolder?: (path: string) => Promise<boolean>; onChooseFolder?: (current: string) => Promise<string | null>; reducedMotion?: boolean; startFolder?: string } = {}) {
  const props = {
    home: HOME,
    startFolder: over.startFolder ?? '',
    validateFolder: over.validateFolder ?? (() => Promise.resolve(true)),
    onChooseFolder: over.onChooseFolder ?? (() => Promise.resolve(null)),
    onApply: vi.fn(),
    reducedMotion: over.reducedMotion ?? true,
    portalContainer: null,
    onClose: vi.fn(),
  }
  render(<Onboarding {...props} />)
  return props
}

const press = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(screen.getByRole('button', { name }))
const heading = (name: string | RegExp) => screen.getByRole('heading', { name })

async function toStyle(user: ReturnType<typeof userEvent.setup>) {
  await press(user, 'Continue')
  await press(user, 'Continue')
  expect(heading('How do you work?')).toBeInTheDocument()
}

async function answer(user: ReturnType<typeof userEvent.setup>, picks: Record<string, string>) {
  for (const [question, title] of Object.entries(picks)) {
    await user.click(within(screen.getByRole('radiogroup', { name: question })).getByRole('radio', { name: new RegExp(title) }))
  }
}

const ALL_TERMINAL = { 'Where do you spend most of your day?': 'In a terminal', 'When an agent wants to run a command, you’d rather…': 'See the raw output', 'How do you like to review changes?': 'git diff in the shell' }

describe('Onboarding steps', () => {
  beforeEach(() => { host.installed = ['claude', 'codex']; host.install.mockReset(); host.command.mockClear() })

  it('walks the five steps and applies the choices on Get started', async () => {
    const user = userEvent.setup()
    const props = setup()
    expect(heading('Welcome to Maiker')).toBeInTheDocument()
    await press(user, 'Continue')
    expect(heading('Your agents')).toBeInTheDocument()
    await press(user, 'Continue')
    expect(heading('How do you work?')).toBeInTheDocument()
    await press(user, 'Skip questions')
    expect(heading('We’d start you in Chat')).toBeInTheDocument()
    await press(user, 'Continue')
    expect(heading('You’re all set')).toBeInTheDocument()
    await press(user, 'Get started')
    expect(props.onApply).toHaveBeenCalledWith({ startFolder: '', openSessionsIn: 'chat' })
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('goes back with the button, with Esc and from a finished step in the step bar', async () => {
    const user = userEvent.setup()
    setup()
    await press(user, 'Continue')
    await user.keyboard('{Escape}')
    expect(heading('Welcome to Maiker')).toBeInTheDocument()
    await press(user, 'Continue')
    await press(user, 'Back')
    expect(heading('Welcome to Maiker')).toBeInTheDocument()
    await press(user, 'Continue')
    await press(user, 'Continue')
    await user.click(within(screen.getByRole('navigation', { name: 'Setup progress' })).getByRole('button', { name: /Welcome/ }))
    expect(heading('Welcome to Maiker')).toBeInTheDocument()
  })

  it('moves a step on with Enter', async () => {
    const user = userEvent.setup()
    setup()
    await user.keyboard('{Enter}')
    await waitFor(() => { expect(heading('Your agents')).toBeInTheDocument() })
  })

  it('skips the whole setup without applying anything', async () => {
    const user = userEvent.setup()
    const props = setup()
    await press(user, 'Skip setup')
    expect(props.onClose).toHaveBeenCalledOnce()
    expect(props.onApply).not.toHaveBeenCalled()
  })

  it('asks to skip until all three questions are answered, then offers the recommendation', async () => {
    const user = userEvent.setup()
    setup()
    await toStyle(user)
    await answer(user, { 'Where do you spend most of your day?': 'In a terminal' })
    expect(screen.getByRole('button', { name: 'Skip questions' })).toBeInTheDocument()
    await answer(user, { 'When an agent wants to run a command, you’d rather…': 'See the raw output', 'How do you like to review changes?': 'Readable diffs' })
    expect(screen.getByRole('button', { name: 'See my recommendation' })).toBeInTheDocument()
  })

  it('recommends Terminal when two answers point there, quotes them and preselects it', async () => {
    const user = userEvent.setup()
    setup()
    await toStyle(user)
    await answer(user, ALL_TERMINAL)
    await press(user, 'See my recommendation')
    expect(heading('We’d start you in Terminal')).toBeInTheDocument()
    expect(screen.getByText(/You said you work in a terminal, see the raw output and review changes with git diff in the shell/)).toBeInTheDocument()
    const terminal = screen.getByRole('radio', { name: /Terminal/ })
    expect(terminal).toBeChecked()
    expect(terminal).toHaveTextContent('Recommended for you')
    expect(screen.getByRole('radio', { name: /Chat/ })).not.toHaveTextContent('Recommended for you')
  })

  it('lets the person switch views and says that is fine, with the Gemini note when Gemini is here', async () => {
    host.installed = ['claude', 'gemini']
    const user = userEvent.setup()
    const props = setup()
    await toStyle(user)
    await answer(user, ALL_TERMINAL)
    await press(user, 'See my recommendation')
    await user.click(screen.getByRole('radio', { name: /Chat/ }))
    expect(screen.getByText(/You picked Chat over our suggestion\. That works too\./)).toBeInTheDocument()
    expect(await screen.findByText(/Gemini has no chat view/)).toBeInTheDocument()
    await press(user, 'Continue')
    expect(within(screen.getByRole('list', { name: 'Your choices' })).getByText('Chat (Gemini in Terminal)')).toBeInTheDocument()
    await press(user, 'Get started')
    expect(props.onApply).toHaveBeenCalledWith({ startFolder: '', openSessionsIn: 'chat' })
  })

  it('shows the review with Change links back to the step', async () => {
    const user = userEvent.setup()
    setup()
    await toStyle(user)
    await press(user, 'Skip questions')
    await press(user, 'Continue')
    const rows = within(screen.getByRole('list', { name: 'Your choices' }))
    expect(rows.getByText('/home/ada')).toBeInTheDocument()
    expect(rows.getByText('Chat')).toBeInTheDocument()
    await user.click(rows.getByRole('button', { name: 'Change agents' }))
    expect(heading('Your agents')).toBeInTheDocument()
  })
})

describe('Onboarding home directory', () => {
  beforeEach(() => { host.installed = ['claude'] })

  it('starts on the home folder and offers the folders found under it', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByRole('textbox', { name: 'Home directory' })).toHaveValue(HOME)
    const code = await screen.findByRole('button', { name: /\/home\/ada\/code/ })
    expect(code).toHaveTextContent('2 git projects')
    await user.click(code)
    expect(screen.getByRole('textbox', { name: 'Home directory' })).toHaveValue('/home/ada/code')
  })

  it('fills the path from Browse and saves it on Get started', async () => {
    const user = userEvent.setup()
    const props = setup({ onChooseFolder: () => Promise.resolve('/work/api') })
    await press(user, 'Browse…')
    expect(await screen.findByDisplayValue('/work/api')).toBeInTheDocument()
    await toStyle(user)
    await press(user, 'Skip questions')
    await press(user, 'Continue')
    await press(user, 'Get started')
    expect(props.onApply).toHaveBeenCalledWith({ startFolder: '/work/api', openSessionsIn: 'chat' })
  })

  it('says so when the folder is not there and stays on the welcome', async () => {
    const user = userEvent.setup()
    const props = setup({ validateFolder: () => Promise.resolve(false) })
    await user.clear(screen.getByRole('textbox', { name: 'Home directory' }))
    await user.type(screen.getByRole('textbox', { name: 'Home directory' }), '/nope{Enter}')
    expect(await screen.findByText(/That folder was not found/)).toBeInTheDocument()
    expect(heading('Welcome to Maiker')).toBeInTheDocument()
    expect(props.onApply).not.toHaveBeenCalled()
  })
})

describe('Onboarding agent install', () => {
  beforeEach(() => { host.installed = ['claude']; host.install.mockReset(); host.command.mockClear() })

  async function toAgents(user: ReturnType<typeof userEvent.setup>) {
    await press(user, 'Continue')
    await screen.findByRole('button', { name: 'Install Codex' })
  }

  it('shows the exact command first and installs only after Run it, with progress', async () => {
    const user = userEvent.setup()
    host.install.mockImplementation(() => new Promise<{ version: string | null }>((resolve) => { host.finish.mockImplementation(resolve) }))
    setup()
    await toAgents(user)
    await user.click(screen.getByRole('button', { name: 'Install Codex' }))
    expect(await screen.findByText('install-codex --yes')).toBeInTheDocument()
    expect(host.install).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run it' }))
    expect(host.install).toHaveBeenCalledWith('codex')
    const bar = await screen.findByRole('progressbar', { name: 'Installing Codex' })
    act(() => { host.progress({ agent: 'codex', percent: 42, line: 'Downloading' }) })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByText('Downloading')).toBeInTheDocument()
    act(() => { host.finish({ version: '0.9.2' }) })
    const rows = within(screen.getByRole('list', { name: 'Agents' }))
    await waitFor(() => { expect(rows.getByText('v0.9.2 · OpenAI’s coding agent')).toBeInTheDocument() })
    expect(rows.queryByRole('button', { name: 'Install Codex' })).not.toBeInTheDocument()
  })

  it('lists every supported agent and offers no Install for one the app cannot install', async () => {
    const user = userEvent.setup()
    setup()
    await toAgents(user)
    const rows = within(screen.getByRole('list', { name: 'Agents' }))
    expect(rows.getAllByRole('listitem')).toHaveLength(5)
    const cursor = rows.getByText('Cursor').closest('li')
    expect(cursor).toHaveTextContent('Not installable here')
    expect(rows.queryByRole('button', { name: 'Install Cursor' })).not.toBeInTheDocument()
    expect(host.command).not.toHaveBeenCalledWith('cursor-agent')
  })

  it('shows a failed install as something that needs you, in plain words, and tries again', async () => {
    const user = userEvent.setup()
    host.install.mockRejectedValueOnce(new Error('could not resolve host registry.npmjs.org'))
    setup()
    await toAgents(user)
    await user.click(screen.getByRole('button', { name: 'Install Codex' }))
    await user.click(await screen.findByRole('button', { name: 'Run it' }))
    expect(await screen.findByText('Codex did not install')).toBeInTheDocument()
    expect(screen.getByText('The network could not be reached. Check the connection and try again.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('install-codex --yes')).toBeInTheDocument()
  })

  it('installs all the missing agents after showing every command', async () => {
    const user = userEvent.setup()
    host.install.mockResolvedValue({ version: null })
    setup()
    await toAgents(user)
    await user.click(screen.getByRole('button', { name: 'Install all 3' }))
    await waitFor(() => { expect(screen.getAllByText(/install-.* --yes/)).toHaveLength(3) })
    expect(host.install).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Run all 3' }))
    await waitFor(() => { expect(host.install).toHaveBeenCalledTimes(3) })
  })
})

describe('Onboarding veil', () => {
  it('blurs the whole window with a veil of its own that holds no content', () => {
    setup()
    const veil = document.querySelector('.mx-onb-veil')
    expect(veil).not.toBeNull()
    expect(veil?.childElementCount).toBe(0)
    expect(screen.getByRole('dialog', { name: 'Set up Maiker' })).toHaveClass('mx-onb')
  })

  it('keeps Skip setup in its own slot, after the steps', () => {
    setup()
    const bar = screen.getByRole('navigation', { name: 'Setup progress' })
    expect(bar.lastElementChild).toBe(within(bar).getByRole('button', { name: 'Skip setup' }))
  })
})

describe('Onboarding opening', () => {
  afterEach(() => { vi.useRealTimers() })

  it('draws the mark first and skips to the window on Enter, Esc or Space', async () => {
    const user = userEvent.setup()
    setup({ reducedMotion: false })
    expect(screen.queryByRole('heading', { name: 'Welcome to Maiker' })).not.toBeInTheDocument()
    await user.keyboard(' ')
    expect(await screen.findByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
  })

  it('opens the window by itself once the drawing is over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup({ reducedMotion: false })
    expect(screen.queryByRole('heading', { name: 'Welcome to Maiker' })).not.toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(2400) })
    expect(screen.getByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
  })

  it('goes straight to the window under reduced motion', () => {
    setup({ reducedMotion: true })
    expect(screen.getByRole('heading', { name: 'Welcome to Maiker' })).toBeInTheDocument()
  })
})
