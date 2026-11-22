import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  installed: ['claude', 'codex'] as string[],
  progress: vi.fn<(progress: { agent: string; percent: number | null; line: string }) => void>(),
  command: vi.fn((agent: string) => Promise.resolve(`install-${agent} --yes`)),
  install: vi.fn<(agent: string) => Promise<{ version: string | null }>>(),
}))

vi.mock('@/api/daemon', () => ({ agentsInstalled: () => Promise.resolve(host.installed) }))
vi.mock('@/api/agentInstall', () => ({
  agentInstallCommand: host.command,
  installAgent: host.install,
  listenInstallProgress: (handler: (progress: { agent: string; percent: number | null; line: string }) => void) => { host.progress.mockImplementation(handler); return Promise.resolve(() => undefined) },
}))
vi.mock('@/api/folders', () => ({
  listFolders: (_machine: number, path: string) => Promise.resolve(path.endsWith('code')
    ? { path, exists: true, entries: [{ name: 'api', git: 'main', has_children: true }, { name: 'web', git: 'dev', has_children: true }, { name: 'notes', git: null, has_children: false }], truncated: false, can_create: true }
    : { path, exists: false, entries: [], truncated: false, can_create: false }),
}))

import { THEMES } from '@/features/workspace/theme/themes'
import { Onboarding } from './Onboarding'
import { themeCaption } from './setup'

const HOME = '/home/ada'
const START_THEME = THEMES[0]?.name ?? ''
const NEXT_THEME = THEMES[1]

function setup(over: { reducedMotion?: boolean; startFolder?: string } = {}) {
  const props = {
    home: HOME,
    startFolder: over.startFolder ?? '',
    onChooseFolder: vi.fn(() => Promise.resolve<string | null>(null)),
    theme: START_THEME,
    onPreviewTheme: vi.fn(),
    reducedMotion: over.reducedMotion ?? true,
    portalContainer: null,
    onFinish: vi.fn(),
    onSkip: vi.fn(),
  }
  const { unmount } = render(<Onboarding {...props} />)
  return { ...props, unmount }
}

/** Past the drawing, as any key takes it. */
async function toWindow(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('a')
  return screen.findByRole('heading', { name: /Welcome/ })
}

const group = (name: string) => screen.getByRole('list', { name })

/** Install, then the confirm under the command it shows. */
async function confirmInstall(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('button', { name: `Install ${label}` }))
  const run = await screen.findByRole('button', { name: `Run the install of ${label}` })
  await waitFor(() => { expect(run).toBeEnabled() })
  await user.click(run)
}

beforeEach(() => { host.install.mockReset(); host.command.mockClear(); host.installed = ['claude', 'codex'] })

describe('the drawing', () => {
  it('gives way to the window on any key, and the scans have started under it', async () => {
    const user = userEvent.setup()
    setup({ reducedMotion: false })
    expect(screen.queryByRole('heading', { name: /Welcome/ })).toBeNull()
    await toWindow(user)
    expect(await screen.findByRole('list', { name: 'Installed' })).toBeInTheDocument()
  })

  it('gives way by itself, and leaves no timer running after it', async () => {
    vi.useFakeTimers()
    try {
      setup({ reducedMotion: false })
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(screen.getByRole('heading', { name: /Welcome/ })).toBeInTheDocument()
      // Whatever was queued when the window came up runs once; nothing re-arms itself.
      await act(async () => { await vi.runOnlyPendingTimersAsync() })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps Esc for the drawing: it shows the window and ends nothing', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.keyboard('{Escape}')
    expect(await screen.findByRole('heading', { name: /Welcome/ })).toBeInTheDocument()
    expect(props.onSkip).not.toHaveBeenCalled()
  })
})

describe('the setup screen', () => {
  it('offers the folder that holds git projects and names what it found', async () => {
    const user = userEvent.setup()
    setup()
    await toWindow(user)
    const folder = screen.getByRole('group', { name: 'Projects folder' })
    expect(await within(folder).findByText(`${HOME}/code`)).toBeInTheDocument()
    const projects = await within(folder).findByRole('list', { name: 'Git projects found' })
    expect(within(projects).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['api', 'web'])
  })

  it('takes a folder from the system picker', async () => {
    const user = userEvent.setup()
    const props = setup()
    props.onChooseFolder.mockResolvedValue('/srv/work')
    await toWindow(user)
    await user.click(screen.getByRole('button', { name: 'Change the projects folder' }))
    await user.click(await screen.findByRole('menuitem', { name: /Choose another folder/ }))
    expect(await within(screen.getByRole('group', { name: 'Projects folder' })).findByText('/srv/work')).toBeInTheDocument()
  })

  it('lists the installed agents first, and offers an install by name for the others', async () => {
    const user = userEvent.setup()
    setup()
    await toWindow(user)
    const installed = await screen.findByRole('list', { name: 'Installed' })
    expect(within(installed).getAllByRole('listitem')).toHaveLength(2)
    const missing = group('Not installed')
    expect(within(missing).getByRole('button', { name: 'Install Gemini' })).toBeInTheDocument()
    expect(within(missing).getByRole('button', { name: 'Install OpenCode' })).toBeInTheDocument()
    expect(within(missing).queryByRole('button', { name: /Cursor/ })).toBeNull()
  })

  it('shows the exact command and runs nothing until it is confirmed', async () => {
    const user = userEvent.setup()
    setup()
    await toWindow(user)
    await user.click(await screen.findByRole('button', { name: 'Install Gemini' }))
    expect(await screen.findByText('install-gemini --yes')).toBeInTheDocument()
    expect(host.install).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel installing Gemini' }))
    expect(screen.getByRole('button', { name: 'Install Gemini' })).toBeInTheDocument()
    expect(host.install).not.toHaveBeenCalled()
  })

  it('installs in the background: Continue still works, and the agent moves up when it is done', async () => {
    const user = userEvent.setup()
    let finish: (result: { version: string | null }) => void = () => undefined
    host.install.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    setup()
    await toWindow(user)
    await confirmInstall(user, 'Gemini')
    expect(await screen.findByRole('progressbar', { name: 'Installing Gemini' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(await screen.findByRole('button', { name: 'Back' }))
    await act(async () => { finish({ version: '0.6.1' }); await Promise.resolve() })
    await waitFor(() => { expect(within(group('Installed')).getAllByRole('listitem')).toHaveLength(3) })
    expect(screen.queryByRole('button', { name: 'Install Gemini' })).toBeNull()
  })

  it('runs a second install after the first, since the shell runs one at a time', async () => {
    const user = userEvent.setup()
    let finish: (result: { version: string | null }) => void = () => undefined
    host.install.mockReturnValueOnce(new Promise((resolve) => { finish = resolve })).mockReturnValue(new Promise(() => undefined))
    setup()
    await toWindow(user)
    await confirmInstall(user, 'Gemini')
    await confirmInstall(user, 'OpenCode')
    expect(host.install).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ version: null }); await Promise.resolve() })
    await waitFor(() => { expect(host.install).toHaveBeenLastCalledWith('opencode') })
  })

  it('says why an install failed and offers it again', async () => {
    const user = userEvent.setup()
    host.install.mockRejectedValue(new Error('npm is not on this computer'))
    setup()
    await toWindow(user)
    await confirmInstall(user, 'Gemini')
    expect(await screen.findByRole('alert')).toHaveTextContent(/not on this computer/)
    expect(screen.getByRole('button', { name: 'Try installing Gemini again' })).toBeInTheDocument()
  })
})

describe('the style screen', () => {
  async function toStyle(user: ReturnType<typeof userEvent.setup>) {
    await toWindow(user)
    await user.keyboard('{Enter}')
    return screen.findByRole('heading', { name: /yours/ })
  }

  it('is reached with Enter, with Chat picked', async () => {
    const user = userEvent.setup()
    setup()
    await toStyle(user)
    const views = screen.getByRole('radiogroup', { name: 'Sessions open as' })
    expect(within(views).getByRole('radio', { name: /Chat/ })).toBeChecked()
    expect(within(views).getByRole('radio', { name: /Terminal/ })).not.toBeChecked()
  })

  it('shows each theme on the app as it is slid to, by the arrows and by the buttons', async () => {
    const user = userEvent.setup()
    const props = setup()
    await toStyle(user)
    const themes = screen.getByRole('radiogroup', { name: 'Theme' })
    expect(within(themes).getAllByRole('radio')).toHaveLength(THEMES.length)
    await user.keyboard('{ArrowRight}')
    expect(props.onPreviewTheme).toHaveBeenLastCalledWith(NEXT_THEME?.name)
    expect(within(themes).getByRole('radio', { name: themeCaption(NEXT_THEME ?? { name: '', light: false }) })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Previous theme' }))
    expect(props.onPreviewTheme).toHaveBeenLastCalledWith(START_THEME)
    await user.click(screen.getByRole('button', { name: 'Previous theme' }))
    expect(props.onPreviewTheme).toHaveBeenLastCalledWith(THEMES[THEMES.length - 1]?.name)
  })

  it('ends by handing over the folder, the view and the theme slid to', async () => {
    const user = userEvent.setup()
    const props = setup()
    await toWindow(user)
    await within(screen.getByRole('group', { name: 'Projects folder' })).findByText(`${HOME}/code`)
    await user.keyboard('{Enter}')
    await screen.findByRole('heading', { name: /yours/ })
    await user.click(screen.getByRole('radio', { name: /Terminal/ }))
    await user.click(screen.getByRole('button', { name: 'Next theme' }))
    await user.click(screen.getByRole('button', { name: /first project/ }))
    const mode = NEXT_THEME?.light === true ? { themeMode: 'light', lightTheme: NEXT_THEME.name } : { themeMode: 'dark', darkTheme: NEXT_THEME?.name }
    expect(props.onFinish).toHaveBeenCalledWith({ startFolder: `${HOME}/code`, openSessionsIn: 'terminal', ...mode }, `${HOME}/code`)
    expect(props.onSkip).not.toHaveBeenCalled()
  })

  it('leaves the theme settings alone when no theme was slid to', async () => {
    const user = userEvent.setup()
    const props = setup({ startFolder: '/work' })
    await toStyle(user)
    await user.keyboard('{Enter}')
    expect(props.onFinish).toHaveBeenCalledWith({ startFolder: '/work', openSessionsIn: 'chat' }, '/work')
  })
})

describe('skipping', () => {
  it('ends on Esc from the window and saves nothing', async () => {
    const user = userEvent.setup()
    const props = setup()
    await toWindow(user)
    await user.keyboard('{Escape}')
    expect(props.onSkip).toHaveBeenCalledOnce()
    expect(props.onFinish).not.toHaveBeenCalled()
  })

  it('ends on Skip from the second screen without saving the theme slid to', async () => {
    const user = userEvent.setup()
    const props = setup()
    await toWindow(user)
    await user.keyboard('{Enter}')
    await screen.findByRole('heading', { name: /yours/ })
    await user.click(screen.getByRole('button', { name: 'Next theme' }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(props.onSkip).toHaveBeenCalledOnce()
    expect(props.onFinish).not.toHaveBeenCalled()
  })

  it('takes its preview off the window when it goes away', () => {
    const props = setup()
    props.onPreviewTheme.mockClear()
    props.unmount()
    expect(props.onPreviewTheme).toHaveBeenLastCalledWith(null)
  })
})
