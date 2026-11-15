import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/daemon', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/daemon')>()), agentsInstalled: () => Promise.resolve(['claude', 'codex', 'gemini']), loadAgentModels: () => Promise.resolve([]), loadAgentCommands: () => Promise.resolve([]), folderBranches: () => Promise.resolve({ current: 'dev', branches: [{ name: 'dev', current: true, when: 10 }], worktrees: [{ path: '/dev/growth', branch: 'dev', main: true, when: 10 }] }) }))

const attach = vi.hoisted(() => ({ attachLocalFile: vi.fn(), chooseFilesToAttach: vi.fn() }))
vi.mock('@/api/attachments', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/attachments')>()), ...attach }))

import { NewChatPage, type NewChatRequest } from './NewChatPage'
import type { BusyBranches } from '../model/newSession'
import type { ChatViewDefaults } from '../model/chatView'

const PROJECTS = [{ folder: '/dev/growth', name: 'growth', color: 'teal', sessions: 6 }, { folder: '/dev/api', name: 'api', color: 'blue', sessions: 2 }]
const HERE = [{ machine: 0, label: 'This computer', local: true }]
/** Another chat, "Fix login", already works on dev in growth. */
const DEV_BUSY: BusyBranches = new Map([['/dev/growth', new Map([['dev', 'Fix login']])]])
const TWO_WORDS = /^[a-z]+-[a-z]+(-[0-9]+)?$/

type Extra = { busy?: BusyBranches; onCancel?: () => void; viewDefaults?: ChatViewDefaults; clone?: () => Promise<string | null>; onWarm?: (spec: unknown) => void }

function page(onStart: (request: NewChatRequest) => Promise<void> = () => Promise.resolve(), extra: Extra = {}) {
  return render(
    <div className="mx-app">
      <NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="claude" browse={() => Promise.resolve(null)} onStart={onStart} onOtherMachine={() => undefined} onCancel={() => undefined} {...extra} />
    </div>,
  )
}

function codexPage(onStart: () => Promise<void>, codexYolo = false) {
  return render(
    <div className="mx-app">
      <NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="codex" codexYolo={codexYolo} browse={() => Promise.resolve(null)} onStart={onStart} onOtherMachine={() => undefined} onCancel={() => undefined} />
    </div>,
  )
}

/** Waits until the page has picked this project: the project crumb in its header names it. */
async function pickProject(name: string) {
  expect(await screen.findByRole('button', { name: `Project folder and machine: ${name}` })).toBeInTheDocument()
}

/** Waits until git has answered for the folder: the branch crumb shows. */
async function ready() {
  await screen.findByRole('button', { name: /^Branch: / })
}

/** The menu opened last. */
async function lastPopup() {
  const open = await screen.findAllByRole('dialog')
  const last = open.at(-1)
  if (last === undefined) throw new Error('no menu is open')
  return last
}

async function workIn(choice: 'This folder' | 'New worktree') {
  await userEvent.click(await screen.findByRole('button', { name: /^Work in: / }))
  await userEvent.click(within(await lastPopup()).getByRole('radio', { name: new RegExp(`^${choice}`) }))
}

const box = () => screen.getByRole('textbox', { name: 'First message' })

describe('the new chat page', () => {
  it('opens ready to type on the most recent project, with the question over the box', async () => {
    page()
    expect(screen.getByRole('heading', { name: 'What are we building today?' })).toBeInTheDocument()
    await pickProject('growth')
    expect(box()).toHaveFocus()
  })

  it('says in its header where the chat works: its name, the project, the branch and the folder or a worktree', async () => {
    page()
    expect(screen.getByRole('textbox', { name: 'Chat name' })).toHaveValue('')
    await pickProject('growth')
    expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Work in: This folder' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Chat' })).toBeChecked()
  })

  it('swaps the project from the menu under its crumb', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Project folder and machine: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('radio', { name: /^api/ }))
    await pickProject('api')
  })

  it('opens a pasted path as the folder when there is no project yet', async () => {
    render(
      <div className="mx-app">
        <NewChatPage machine={0} machines={HERE} projects={[]} defaultAgent="claude" browse={() => Promise.resolve(null)} onStart={() => Promise.resolve()} onOtherMachine={() => undefined} onCancel={() => undefined} />
      </div>,
    )
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Project folder and machine: Choose a folder' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search folders or paste a path' }), '/srv/new-app')
    await userEvent.click(screen.getByRole('radio', { name: 'Use /srv/new-app' }))
    await pickProject('new-app')
  })

  it('clones a repository from the project menu and opens on the folder it was cloned into', async () => {
    const clone = vi.fn<() => Promise<string | null>>().mockResolvedValue('/dev/widgets')
    page(undefined, { clone })
    await userEvent.click(await screen.findByRole('button', { name: 'Project folder and machine: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Clone from GitHub…' }))
    await pickProject('widgets')
  })

  it('has no clone button when the window gives it no way to clone', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Project folder and machine: growth' }))
    expect(within(await lastPopup()).queryByRole('button', { name: 'Clone from GitHub…' })).not.toBeInTheDocument()
  })

  it('works in the checkout by default, so it starts the agent ahead; a worktree stops that, and so does leaving', async () => {
    const onWarm = vi.fn()
    const { unmount } = page(undefined, { onWarm })
    await ready()
    await waitFor(() => { expect(onWarm).toHaveBeenLastCalledWith({ folder: '/dev/growth', agent: 'claude', model: 'default', reasoning: 'medium', mode: 'default' }) })
    await workIn('New worktree')
    await waitFor(() => { expect(onWarm).toHaveBeenLastCalledWith(null) })
    unmount()
    expect(onWarm).toHaveBeenLastCalledWith(null)
  })

  it('starts in the folder on its branch, with no new branch, when no other chat is on it', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart)
    await ready()
    await userEvent.type(box(), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    expect(onStart.mock.calls[0]?.[0].branch).toBeNull()
  })

  it('gives the chat a worktree of its own when another chat works on that branch here, and says why', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart, { busy: DEV_BUSY })
    await userEvent.click(await screen.findByRole('button', { name: 'Work in: New worktree' }))
    expect(await lastPopup()).toHaveTextContent('Fix login is already working on dev here, so this chat gets its own worktree. Your checkout stays untouched.')
    await userEvent.keyboard('{Escape}')
    await userEvent.type(box(), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    expect(onStart.mock.calls[0]?.[0].branch).toMatchObject({ create: true, worktree: true, name: expect.stringMatching(TWO_WORDS) as unknown })
  })

  it('marks a branch another chat is on as in use', async () => {
    page(undefined, { busy: DEV_BUSY })
    await userEvent.click(await screen.findByRole('button', { name: /^Branch: / }))
    expect(within(await lastPopup()).getByRole('radio', { name: /^dev/ })).toHaveTextContent('in use')
  })

  it('names a new worktree\'s branch with two words and never copies the message into it', async () => {
    page()
    await ready()
    await workIn('New worktree')
    const named = (await screen.findByRole('button', { name: /^Branch: [a-z]+-[a-z]+$/ })).getAttribute('aria-label')
    await userEvent.type(box(), 'Fix the login bug')
    expect(screen.getByRole('button', { name: /^Branch: / })).toHaveAttribute('aria-label', named)
  })

  it('starts on a branch typed into the branch menu, made from where the checkout is', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart)
    await userEvent.click(await screen.findByRole('button', { name: 'Branch: dev' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find or create a branch' }), 'my-own')
    await userEvent.click(screen.getByRole('radio', { name: '+ Create my-own from dev' }))
    expect(screen.getByRole('button', { name: 'Branch: my-own' })).toBeInTheDocument()
    await userEvent.type(box(), 'Fix the login bug')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(onStart.mock.calls[0]?.[0].branch).toEqual({ name: 'my-own', create: true, worktree: false }) })
  })

  it('names the chat with what was typed in the header', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart)
    await ready()
    await userEvent.type(screen.getByRole('textbox', { name: 'Chat name' }), 'Login fix')
    await userEvent.type(box(), 'hello{Enter}')
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Login fix', view: 'chat' })) })
  })

  it('opens as its terminal when Terminal is picked, and takes the first task on the prompt line', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart)
    await ready()
    await userEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
    expect(screen.queryByRole('textbox', { name: 'First message' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft terminal')).toHaveTextContent('cwd: /dev/growth')
    await userEvent.type(screen.getByRole('textbox', { name: 'First task' }), 'go{Enter}')
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ message: 'go', view: 'terminal' })) })
  })

  it('opens as the agent\'s default view from Settings', () => {
    page(undefined, { viewDefaults: { claude: 'terminal', codex: 'chat', gemini: 'chat' } })
    expect(screen.getByRole('radio', { name: 'Terminal' })).toBeChecked()
  })

  it('goes back on Close or Escape, and has no Close when there is nothing to go back to', async () => {
    const onCancel = vi.fn()
    const first = page(undefined, { onCancel })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.type(box(), '{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
    first.unmount()

    render(
      <div className="mx-app">
        <NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="claude" browse={null} onStart={() => Promise.resolve()} onOtherMachine={() => undefined} />
      </div>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('attaches a picked file to the first message, shows it, and names it in the message', async () => {
    attach.chooseFilesToAttach.mockResolvedValue(['/home/me/errors.log'])
    attach.attachLocalFile.mockResolvedValue({ path: '/data/attachments/attach-1-errors.log', name: 'errors.log', size: 120, kind: 'file' })
    const onStart = vi.fn<(request: { message: string }) => Promise<void>>().mockResolvedValue(undefined)
    page(onStart)
    await pickProject('growth')
    await userEvent.type(box(), 'why does this fail?')
    await userEvent.click(screen.getByRole('button', { name: 'Attach files' }))
    expect(await screen.findByText('errors.log')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    const message = onStart.mock.calls[0]?.[0].message ?? ''
    expect(message).toContain('why does this fail?')
    expect(message).toContain('/data/attachments/attach-1-errors.log')
  })

  it('starts on medium effort and says so on the button and in the menu', async () => {
    page()
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · .* · Medium/ })).toHaveTextContent('Medium')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked()
  })

  it('has the agent, model and effort on one button in the box, and the permission mode beside it', async () => {
    page()
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude/ }))
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Effort' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: /^Starting permission mode: Ask before edits/ })).toBeInTheDocument()
  })

  it('offers the three Codex modes for a Codex chat and starts it in the picked one', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    codexPage(onStart)
    await pickProject('growth')
    await userEvent.click(screen.getByRole('button', { name: /^Starting permission mode: Auto/ }))
    expect(await screen.findAllByRole('menuitemradio')).toHaveLength(3)
    expect(screen.getByRole('menuitemradio', { name: /^Full access/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Read only/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }))
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', mode: 'codexReadOnly' })) })
  })

  it('says a Codex chat starts with full access while its Yolo setting is on, and sends no mode of its own', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    codexPage(onStart, true)
    expect(screen.getByRole('img', { name: 'Permission mode: Full access' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Starting permission mode/ })).toBeNull()
    await pickProject('growth')
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }))
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', mode: 'default' })) })
  })
})

describe('the new chat page opened from a full chat', () => {
  it('opens on that chat\'s folder with the summary as the first message, ready to edit', async () => {
    render(
      <div className="mx-app">
        <NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="claude" browse={() => Promise.resolve(null)} onStart={() => Promise.resolve()} onOtherMachine={() => undefined} onCancel={() => undefined} seed={{ folder: '/dev/api', message: 'This continues an earlier chat' }} />
      </div>,
    )
    await pickProject('api')
    expect(box()).toHaveValue('This continues an earlier chat')
  })
})

describe('starting a chat and going on writing', () => {
  type Start = (request: NewChatRequest, options?: { background?: boolean }) => Promise<void>

  it('starts the chat in the background on Ctrl+Enter, and empties the box with every other choice kept', async () => {
    const onStart = vi.fn<Start>().mockResolvedValue(undefined)
    page(onStart)
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /^Starting permission mode/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Plan mode/ }))
    await userEvent.type(box(), 'first task')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ folder: '/dev/growth', message: 'first task', mode: 'plan' }), { background: true })
    expect(box()).toHaveValue('')
    await pickProject('growth')
    expect(screen.getByRole('button', { name: 'Work in: This folder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Starting permission mode: Plan mode/ })).toBeInTheDocument()
  })

  it('starts a second while the first is still starting, each in a worktree of its own', async () => {
    const onStart = vi.fn<Start>(() => new Promise(() => undefined))
    page(onStart)
    await ready()
    await workIn('New worktree')
    await userEvent.type(box(), 'first task')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await userEvent.type(box(), 'second task')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

    expect(onStart.mock.calls.map(([request]) => request.message)).toEqual(['first task', 'second task'])
    const [first, second] = onStart.mock.calls.map(([request]) => request.branch)
    expect(first).toMatchObject({ create: true, worktree: true })
    expect(second).toMatchObject({ create: true, worktree: true })
    expect(second?.name).not.toBe(first?.name)
  })

  it('names a start that failed and puts its message back after what was typed since', async () => {
    let fail: (reason: Error) => void = () => undefined
    const onStart = vi.fn<Start>(() => new Promise((_, reject) => { fail = reject }))
    page(onStart)
    await ready()
    await userEvent.type(box(), 'fix the login')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await userEvent.type(box(), 'a new draft')
    fail(new Error('The worktree could not be made'))

    expect(await screen.findByText(/Could not start “fix the login”: The worktree could not be made/)).toBeInTheDocument()
    expect(box()).toHaveValue('a new draft')
    await userEvent.click(screen.getByRole('button', { name: 'Put back “fix the login”' }))
    expect(box()).toHaveValue('a new draft\n\nfix the login')
    expect(screen.queryByText(/Could not start/)).not.toBeInTheDocument()
  })

  it('starts and opens the chat on plain Enter, as before', async () => {
    const onStart = vi.fn<Start>(() => new Promise(() => undefined))
    page(onStart)
    await ready()
    await userEvent.type(box(), 'open it{Enter}')

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart.mock.calls[0]).toHaveLength(1)
    expect(box()).toHaveValue('open it')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })
})

describe('the new chat page on another machine', () => {
  const MACHINES = [{ machine: 0, label: 'This computer', local: true }, { machine: 2, label: 'Shipyard', local: false }]
  const folders = [{ folder: '/srv/app', name: 'app', color: 'teal', sessions: 3 }]
  function remotePage(onStart: (request: { machine: number; machineName: string; branch: unknown; folder: string; message: string }) => Promise<void>, onOtherMachine = vi.fn()) {
    return render(
      <div className="mx-app">
        <NewChatPage machine={2} machines={MACHINES} projects={folders} defaultAgent="claude" browse={null} onStart={onStart} onOtherMachine={onOtherMachine} onCancel={() => undefined} />
      </div>,
    )
  }

  it('lists that machine\'s projects, has no folder picker, and starts there with no branch', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    remotePage(onStart)
    await pickProject('app on Shipyard')
    expect(screen.queryByRole('button', { name: /^Branch/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ machine: 2, machineName: 'Shipyard', folder: '/srv/app', message: 'hello', branch: null }))
  })

  it('offers the model and effort on the model button, and starts with what was picked', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    remotePage(onStart)
    await pickProject('app on Shipyard')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, / }))
    expect(screen.getByRole('radiogroup', { name: 'Agent' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Opus/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(screen.getByRole('textbox', { name: 'First message' }), 'hello')
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ machine: 2, model: 'opus', reasoning: 'high' }))
  })

  it('offers this computer as another place to start, and no folder picker or clone there', async () => {
    const onOtherMachine = vi.fn()
    remotePage(() => Promise.resolve(), onOtherMachine)
    await userEvent.click(await screen.findByRole('button', { name: /^Project folder and machine: / }))
    const menu = await lastPopup()
    expect(within(menu).queryByRole('button', { name: 'Browse…' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('button', { name: 'Clone from GitHub…' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('radio', { name: 'Remote machine' })).toBeChecked()
    await userEvent.click(within(menu).getByRole('radio', { name: 'This computer' }))
    expect(onOtherMachine).toHaveBeenCalledWith(0)
  })
})
