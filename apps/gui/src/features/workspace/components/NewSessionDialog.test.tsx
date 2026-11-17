import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  installed: ['claude', 'codex', 'gemini'] as string[],
  branches: null as null | { current: string | null; branches: { name: string; current: boolean; when: number | null }[]; worktrees: { path: string; branch: string | null; main: boolean; when: number | null }[] },
  openAgentDocs: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/api/daemon', () => ({
  loadAgentModels: () => Promise.resolve([]),
  agentsInstalled: () => Promise.resolve(host.installed),
  folderBranches: () => Promise.resolve(host.branches),
  loadAgentCommands: () => Promise.resolve([]),
  openAgentDocs: host.openAgentDocs,
}))

import { NewSessionDialog, type NewChatRequest } from './NewSessionDialog'
import type { BusyBranches } from '../model/newSession'
import type { ChatViewDefaults } from '../model/chatView'
import type { PickedFolder } from '../model/folderPick'

const PROJECTS = [{ folder: '/dev/growth', name: 'growth', color: 'teal', sessions: 6 }, { folder: '/dev/api', name: 'api', color: 'blue', sessions: 2 }]
const HERE = [{ machine: 0, label: 'This computer', local: true }]
/** Another chat, "Fix login", already works on dev in growth. */
const DEV_BUSY: BusyBranches = new Map([['/dev/growth', new Map([['dev', 'Fix login']])]])
const TWO_WORDS = /^[a-z]+-[a-z]+(-[0-9]+)?$/

type Extra = {
  busy?: BusyBranches
  onCancel?: () => void
  onNewShell?: (machine: number) => void
  viewDefaults?: ChatViewDefaults
  clone?: () => Promise<string | null>
  onWarm?: (spec: unknown) => void
  pickFolder?: (machine: number) => Promise<PickedFolder | null>
  defaultAgent?: 'claude' | 'codex' | 'gemini'
  codexYolo?: boolean
  fullAccess?: boolean
  seed?: { folder: string; message: string }
  projects?: typeof PROJECTS
  onAddMachine?: () => void
  onOtherMachine?: (machine: number) => void
}

function dialog(onStart: (request: NewChatRequest) => Promise<void> = () => Promise.resolve(), extra: Extra = {}) {
  const { pickFolder = null, onCancel = () => undefined, onOtherMachine = () => undefined, defaultAgent = 'claude', projects = PROJECTS, ...rest } = extra
  return render(
    <NewSessionDialog machine={0} machines={HERE} projects={projects} defaultAgent={defaultAgent} pickFolder={pickFolder} onStart={onStart} onOtherMachine={onOtherMachine} onCancel={onCancel} {...rest} />,
    { container: windowRoot() },
  )
}

/** The window's root exists before the dialog opens, as it does in the app: the dialog and its lists mount into it. */
function windowRoot(): HTMLElement {
  const root = document.createElement('div')
  root.className = 'mx-app'
  document.body.appendChild(root)
  return root
}

/** Waits until the dialog has picked this project: the project token names it. */
async function pickedProject(name: string) {
  expect(await screen.findByRole('button', { name: `Project: ${name}` })).toBeInTheDocument()
}

/** Waits until git has answered for the folder: the branch token shows. */
async function ready() {
  await screen.findByRole('button', { name: /^Branch: / })
}

/** The list opened last. */
async function lastPopup() {
  const open = await screen.findAllByRole('dialog')
  const last = open.at(-1)
  if (last === undefined) throw new Error('no list is open')
  return last
}

const box = () => screen.getByRole('textbox', { name: 'First message' })
const startButton = () => screen.getByRole('button', { name: 'Start' })
const worktree = () => screen.getByRole('switch', { name: 'Own worktree' })

beforeEach(() => {
  host.installed = ['claude', 'codex', 'gemini']
  host.branches = { current: 'dev', branches: [{ name: 'dev', current: true, when: 10 }, { name: 'feature/refunds', current: false, when: 20 }], worktrees: [{ path: '/dev/growth', branch: 'dev', main: true, when: 10 }] }
  host.openAgentDocs.mockClear()
})

describe('the New session dialog', () => {
  it('opens ready to type on the most recent project, with a four-row message box and Start off until something is written', async () => {
    dialog()
    expect(screen.getByRole('dialog', { name: 'New session' })).toBeInTheDocument()
    await pickedProject('growth')
    expect(box()).toHaveFocus()
    expect(box()).toHaveAttribute('rows', '4')
    expect(startButton()).toBeDisabled()
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeEnabled()
  })

  it('says in its header band where the session works: machine, project and branch, then the Own worktree switch', async () => {
    dialog()
    await pickedProject('growth')
    expect(screen.getByRole('button', { name: 'Machine: This computer' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument()
    expect(worktree()).not.toBeChecked()
    expect(screen.queryByRole('textbox', { name: 'Chat name' })).not.toBeInTheDocument()
  })

  it('swaps the project from the list under its token, which is searchable', async () => {
    dialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    const list = await lastPopup()
    await userEvent.type(within(list).getByRole('textbox', { name: 'Find a project or folder' }), 'api')
    expect(within(list).queryByRole('radio', { name: /^growth/ })).not.toBeInTheDocument()
    await userEvent.click(within(list).getByRole('radio', { name: /^api/ }))
    await pickedProject('api')
  })

  it('opens a pasted path as the folder when there is no project yet', async () => {
    dialog(undefined, { projects: [] })
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Project: Choose a folder' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a project or folder' }), '/srv/new-app')
    await userEvent.click(screen.getByRole('radio', { name: 'Use /srv/new-app' }))
    await pickedProject('new-app')
    expect(startButton()).toBeEnabled()
  })

  it('clones a repository from the project list and opens on the folder it was cloned into', async () => {
    const clone = vi.fn<() => Promise<string | null>>().mockResolvedValue('/dev/widgets')
    dialog(undefined, { clone })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Clone from GitHub…' }))
    await pickedProject('widgets')
  })

  it('has no clone button or folder picker when the window gives it none', async () => {
    dialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    const list = await lastPopup()
    expect(within(list).queryByRole('button', { name: 'Clone from GitHub…' })).not.toBeInTheDocument()
    expect(within(list).queryByRole('button', { name: 'Open a folder…' })).not.toBeInTheDocument()
  })

  it('hides while the folder picker is open and comes back with the folder it chose', async () => {
    let choose: (picked: PickedFolder | null) => void = () => undefined
    const pickFolder = vi.fn(() => new Promise<PickedFolder | null>((resolve) => { choose = resolve }))
    dialog(undefined, { pickFolder })
    await userEvent.type(await screen.findByRole('textbox', { name: 'First message' }), 'keep this')
    await userEvent.click(screen.getByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open a folder…' }))
    expect(pickFolder).toHaveBeenCalledWith(0)
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New session' })).not.toBeInTheDocument() })
    choose({ machine: 0, folder: '/home/me/code/widgets' })
    await pickedProject('widgets')
    expect(box()).toHaveValue('keep this')
  })

  it('stays as it was when the folder picker is cancelled', async () => {
    const pickFolder = vi.fn(() => Promise.resolve(null))
    dialog(undefined, { pickFolder })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open a folder…' }))
    await pickedProject('growth')
  })

  it('moves to another machine when the picker chose a folder there', async () => {
    const onOtherMachine = vi.fn()
    const pickFolder = vi.fn(() => Promise.resolve({ machine: 2, folder: '/srv/app' }))
    dialog(undefined, { pickFolder, onOtherMachine })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open a folder…' }))
    await waitFor(() => { expect(onOtherMachine).toHaveBeenCalledWith(2) })
  })

  it('works in the checkout by default, so it starts the agent ahead; a worktree stops that, and so does leaving', async () => {
    const onWarm = vi.fn()
    const { unmount } = dialog(undefined, { onWarm })
    await ready()
    await waitFor(() => { expect(onWarm).toHaveBeenLastCalledWith({ folder: '/dev/growth', agent: 'claude', model: 'default', reasoning: 'medium', mode: 'default' }) })
    await userEvent.click(worktree())
    await waitFor(() => { expect(onWarm).toHaveBeenLastCalledWith(null) })
    unmount()
    expect(onWarm).toHaveBeenLastCalledWith(null)
  })

  it('starts in the folder on its branch, with no new branch, when no other chat is on it', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart)
    await ready()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    expect(onStart.mock.calls[0]?.[0]).toMatchObject({ branch: null, message: 'hello', machine: 0, view: 'chat' })
  })

  it('gives the session a worktree of its own when another chat works on that branch here, and says why', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { busy: DEV_BUSY })
    await ready()
    expect(worktree()).toBeChecked()
    expect(screen.getByText('Fix login is already working on dev here, so this chat gets its own worktree. Your checkout stays untouched.')).toBeInTheDocument()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    expect(onStart.mock.calls[0]?.[0].branch).toMatchObject({ create: true, worktree: true, name: expect.stringMatching(TWO_WORDS) as unknown })
  })

  it('lets the switch put a busy branch back to the folder as it is', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { busy: DEV_BUSY })
    await ready()
    await userEvent.click(worktree())
    expect(worktree()).not.toBeChecked()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    expect(onStart.mock.calls[0]?.[0].branch).toBeNull()
  })

  it('marks a branch another chat is on as in use', async () => {
    dialog(undefined, { busy: DEV_BUSY })
    await userEvent.click(await screen.findByRole('button', { name: /^Branch: / }))
    expect(within(await lastPopup()).getByRole('radio', { name: /^dev/ })).toHaveTextContent('in use')
  })

  it('names a new worktree\'s branch with two words and never copies the message into it', async () => {
    dialog()
    await ready()
    await userEvent.click(worktree())
    const named = (await screen.findByRole('button', { name: /^Branch: [a-z]+-[a-z]+$/ })).getAttribute('aria-label')
    await userEvent.type(box(), 'Fix the login bug')
    expect(screen.getByRole('button', { name: /^Branch: / })).toHaveAttribute('aria-label', named)
  })

  it('starts on a branch typed into the branch list, made from where the checkout is', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart)
    await userEvent.click(await screen.findByRole('button', { name: 'Branch: dev' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find or name a new branch' }), 'my-own')
    await userEvent.click(screen.getByRole('radio', { name: '+ Create my-own from dev' }))
    expect(screen.getByRole('button', { name: 'Branch: my-own' })).toBeInTheDocument()
    await userEvent.type(box(), 'Fix the login bug')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart.mock.calls[0]?.[0].branch).toEqual({ name: 'my-own', create: true, worktree: false }) })
  })

  it('shows no branch token or worktree switch for a folder that is not a git repository', async () => {
    host.branches = null
    dialog()
    await pickedProject('growth')
    expect(screen.queryByRole('button', { name: /^Branch/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Own worktree' })).not.toBeInTheDocument()
  })

  it('opens a plain shell on the picked computer when Terminal is picked, with no agent in it', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    const onNewShell = vi.fn()
    dialog(onStart, { onNewShell })
    await ready()
    await userEvent.click(screen.getByRole('radio', { name: 'Terminal' }))
    expect(screen.queryByRole('textbox', { name: 'First message' })).not.toBeInTheDocument()
    expect(screen.getByText(/run claude, codex or any command/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open terminal' }))
    expect(onNewShell).toHaveBeenCalledWith(0)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('starts as Chat, and the chat opens as the agent\'s default view from Settings', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { viewDefaults: { claude: 'terminal', codex: 'chat', gemini: 'chat' }, onNewShell: vi.fn() })
    expect(screen.getByRole('radio', { name: 'Chat' })).toBeChecked()
    await ready()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ view: 'terminal' })) })
  })

  it('closes on Close and on Escape', async () => {
    const onCancel = vi.fn()
    dialog(undefined, { onCancel })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.type(box(), '{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('has no name field, no attachments and no permission shield', async () => {
    dialog()
    await pickedProject('growth')
    expect(screen.queryByRole('textbox', { name: 'Chat name' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /permission mode/i })).not.toBeInTheDocument()
  })

  it('starts on medium effort and says so on the model and effort button', async () => {
    dialog()
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · .* · Medium/ })).toHaveTextContent('Medium')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    expect(screen.getByRole('radio', { name: 'Medium' })).toBeChecked()
  })

  it('switches the agent with the toggle, and sends one that is not installed to its setup page', async () => {
    host.installed = ['claude']
    dialog()
    await pickedProject('growth')
    expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    expect(await screen.findByText(/Codex is not installed on this computer/)).toBeInTheDocument()
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'set it up' }))
    expect(host.openAgentDocs).toHaveBeenCalledWith('codex')
  })

  it('will not start with an agent that is not installed', async () => {
    host.installed = ['codex']
    dialog()
    await pickedProject('growth')
    expect(await screen.findByText(/Claude is not installed on this computer/)).toBeInTheDocument()
  })

  it('offers adding a machine from the machine list', async () => {
    const add = vi.fn()
    dialog(undefined, { onAddMachine: add })
    await userEvent.click(screen.getByRole('button', { name: 'Machine: This computer' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Add a machine…' }))
    expect(add).toHaveBeenCalledOnce()
  })

  it('starts a Codex chat on the agent\'s full-access mode while Full access in new chats is on', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { defaultAgent: 'codex', fullAccess: true })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', mode: 'codexFullAccess' })) })
  })

  it('keeps Claude on its usual mode with full access on when Yolo mode does not allow Bypass permissions', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { fullAccess: true })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', mode: 'default' })) })
  })

  it('sends no mode of its own for a Codex chat while its Yolo setting is on', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { defaultAgent: 'codex', codexYolo: true })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', mode: 'default' })) })
  })
})

describe('the New session dialog opened from a full chat', () => {
  it('opens on that chat\'s folder with the summary as the first message, ready to edit', async () => {
    dialog(undefined, { seed: { folder: '/dev/api', message: 'This continues an earlier chat' } })
    await pickedProject('api')
    expect(box()).toHaveValue('This continues an earlier chat')
  })
})

describe('starting a session and going on writing', () => {
  type Start = (request: NewChatRequest, options?: { background?: boolean }) => Promise<void>

  it('starts the chat on Ctrl+Enter from the message box', async () => {
    const onStart = vi.fn<Start>(() => new Promise(() => undefined))
    dialog(onStart)
    await ready()
    await userEvent.type(box(), 'open it')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart.mock.calls[0]).toHaveLength(1)
    expect(box()).toHaveValue('open it')
    expect(startButton()).toBeDisabled()
  })

  it('makes Enter a new line, not a start', async () => {
    const onStart = vi.fn<Start>(() => Promise.resolve())
    dialog(onStart)
    await ready()
    await userEvent.type(box(), 'one{Enter}two')
    expect(box()).toHaveValue('one\ntwo')
    expect(onStart).not.toHaveBeenCalled()
  })

  it('starts the chat in the background on Ctrl+Shift+Enter, and empties the box with every other choice kept', async () => {
    const onStart = vi.fn<Start>().mockResolvedValue(undefined)
    dialog(onStart)
    await ready()
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    await userEvent.type(box(), 'first task')
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ folder: '/dev/growth', message: 'first task', agent: 'codex' }), { background: true })
    expect(box()).toHaveValue('')
    await pickedProject('growth')
    expect(screen.getByRole('radio', { name: 'Codex' })).toBeChecked()
  })

  it('starts a second while the first is still starting, each in a worktree of its own', async () => {
    const onStart = vi.fn<Start>(() => new Promise(() => undefined))
    dialog(onStart)
    await ready()
    await userEvent.click(worktree())
    await userEvent.type(box(), 'first task')
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    await userEvent.type(box(), 'second task')
    await userEvent.keyboard('{Meta>}{Shift>}{Enter}{/Shift}{/Meta}')

    expect(onStart.mock.calls.map(([request]) => request.message)).toEqual(['first task', 'second task'])
    const [first, second] = onStart.mock.calls.map(([request]) => request.branch)
    expect(first).toMatchObject({ create: true, worktree: true })
    expect(second).toMatchObject({ create: true, worktree: true })
    expect(second?.name).not.toBe(first?.name)
  })

  it('names a start that failed and puts its message back after what was typed since', async () => {
    let fail: (reason: Error) => void = () => undefined
    const onStart = vi.fn<Start>(() => new Promise((_, reject) => { fail = reject }))
    dialog(onStart)
    await ready()
    await userEvent.type(box(), 'fix the login')
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    await userEvent.type(box(), 'a new draft')
    fail(new Error('The worktree could not be made'))

    expect(await screen.findByText(/Could not start “fix the login”: The worktree could not be made/)).toBeInTheDocument()
    expect(box()).toHaveValue('a new draft')
    await userEvent.click(screen.getByRole('button', { name: 'Put back “fix the login”' }))
    expect(box()).toHaveValue('a new draft\n\nfix the login')
    expect(screen.queryByText(/Could not start/)).not.toBeInTheDocument()
  })
})

describe('the New session dialog on another machine', () => {
  const MACHINES = [{ machine: 0, label: 'This computer', local: true }, { machine: 2, label: 'Shipyard', local: false }]
  const folders = [{ folder: '/srv/app', name: 'app', color: 'teal', sessions: 3 }]
  function remote(onStart: (request: { machine: number; machineName: string; branch: unknown; folder: string; message: string }) => Promise<void>, onOtherMachine = vi.fn()) {
    return render(
      <NewSessionDialog machine={2} machines={MACHINES} projects={folders} defaultAgent="claude" pickFolder={null} onStart={onStart} onOtherMachine={onOtherMachine} onCancel={() => undefined} />,
      { container: windowRoot() },
    )
  }

  it('lists that machine\'s projects and starts there with no branch', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    remote(onStart)
    await pickedProject('app')
    expect(screen.getByRole('button', { name: 'Machine: Shipyard' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Branch/ })).not.toBeInTheDocument()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ machine: 2, machineName: 'Shipyard', folder: '/srv/app', message: 'hello', branch: null }))
  })

  it('can start in a new worktree made on that machine, on a new branch, and never the same name twice', async () => {
    const onStart = vi.fn<(request: { branch: unknown }) => Promise<void>>(() => Promise.resolve())
    remote(onStart)
    await pickedProject('app')
    await userEvent.click(worktree())
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledTimes(1) })
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ machine: 2, folder: '/srv/app', branch: { name: expect.stringMatching(TWO_WORDS) as unknown, create: true, worktree: true } }))
    await userEvent.type(box(), 'again')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledTimes(2) })
    const names = onStart.mock.calls.map(([request]) => (request.branch as { name: string }).name)
    expect(names[0]).not.toBe(names[1])
  })

  it('offers the model and effort on the model button, and starts with what was picked', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    remote(onStart)
    await pickedProject('app')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, / }))
    await userEvent.click(screen.getByRole('radio', { name: /Opus/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ machine: 2, model: 'opus', reasoning: 'high' }))
  })

  it('offers this computer in the machine list', async () => {
    const onOtherMachine = vi.fn()
    remote(() => Promise.resolve(), onOtherMachine)
    await userEvent.click(await screen.findByRole('button', { name: 'Machine: Shipyard' }))
    const list = await lastPopup()
    expect(within(list).getByRole('radio', { name: /^Shipyard/ })).toBeChecked()
    await userEvent.click(within(list).getByRole('radio', { name: /^This computer/ }))
    expect(onOtherMachine).toHaveBeenCalledWith(0)
  })
})
