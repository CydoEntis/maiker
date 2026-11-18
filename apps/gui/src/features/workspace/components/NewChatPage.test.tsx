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

import { NewChatPage, type NewChatRequest } from './NewChatPage'
import type { BusyBranches } from '../model/newSession'
import type { PaneView } from '../model/chatView'
import type { RepoCloner } from './NewChatPage'
import type { PickedFolder } from '../model/folderPick'
import { discardDraft, parkedDraft } from '../model/newSessionDraft'

const PROJECTS = [{ folder: '/dev/growth', name: 'growth', color: 'teal', sessions: 6 }, { folder: '/dev/api', name: 'api', color: 'blue', sessions: 2 }]
const HERE = [{ machine: 0, label: 'This computer', local: true }]
/** Another chat, "Fix login", already works on dev in growth. */
const DEV_BUSY: BusyBranches = new Map([['/dev/growth', new Map([['dev', 'Fix login']])]])
const TWO_WORDS = /^[a-z]+-[a-z]+(-[0-9]+)?$/

type Extra = {
  busy?: BusyBranches
  onCancel?: () => void
  openIn?: PaneView
  cloner?: RepoCloner
  machines?: { machine: number; label: string; local: boolean; down?: string | null }[]
  onWarm?: (spec: unknown) => void
  pickFolder?: (machine: number) => Promise<PickedFolder | null>
  defaultAgent?: 'claude' | 'codex' | 'gemini'
  bypassOff?: readonly ('claude' | 'codex' | 'gemini')[]
  seed?: { folder: string; message: string }
  projects?: typeof PROJECTS
  onAddMachine?: () => void
  onOtherMachine?: (machine: number) => void
}

/** Bypass Permissions switched off for every agent, so a mode is picked as before it was on by default. */
const ALL_OFF = ['claude', 'codex', 'gemini'] as const

function dialog(onStart: (request: NewChatRequest) => Promise<void> = () => Promise.resolve(), extra: Extra = {}) {
  const { pickFolder = null, onCancel = () => undefined, onOtherMachine = () => undefined, defaultAgent = 'claude', projects = PROJECTS, bypassOff = ALL_OFF, machines = HERE, ...rest } = extra
  return render(
    <NewChatPage machine={0} machines={machines} projects={projects} defaultAgent={defaultAgent} bypassOff={bypassOff} pickFolder={pickFolder} onStart={onStart} onOtherMachine={onOtherMachine} onCancel={onCancel} {...rest} />,
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

/** Opens the agent dropdown, picks the agent in its list and closes it with Esc. */
async function chooseAgent(name: string) {
  await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
  await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name }))
  await userEvent.keyboard('{Escape}')
}
const box = () => screen.getByRole('textbox', { name: 'What should we work on?' })
const startButton = () => screen.getByRole('button', { name: 'Start session' })
const worktree = () => screen.getByRole('switch', { name: 'Own worktree' })
/** The permission choice is under More options, folded until asked for. */
async function openMore() {
  await userEvent.click(screen.getByRole('button', { name: 'More options' }))
}

beforeEach(() => {
  host.installed = ['claude', 'codex', 'gemini']
  host.branches = { current: 'dev', branches: [{ name: 'dev', current: true, when: 10 }, { name: 'feature/refunds', current: false, when: 20 }], worktrees: [{ path: '/dev/growth', branch: 'dev', main: true, when: 10 }] }
  host.openAgentDocs.mockClear()
  window.localStorage.clear()
  discardDraft()
})

describe('the New session draft', () => {
  it('opens a chat view in the main area, never a dialog, ready to type on the most recent project, with Start off until something is written', async () => {
    dialog()
    expect(screen.getByRole('region', { name: 'New session' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await pickedProject('growth')
    expect(box()).toHaveFocus()
    expect(startButton()).toBeDisabled()
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeEnabled()
  })

  it('says where the session works as one line: machine, project and branch, with Own worktree beside the branch', async () => {
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
    await userEvent.type(within(list).getByRole('textbox', { name: /^Find a project/ }), 'api')
    expect(within(list).queryByRole('radio', { name: /^growth/ })).not.toBeInTheDocument()
    await userEvent.click(within(list).getByRole('radio', { name: /^api/ }))
    await pickedProject('api')
  })

  it('opens a pasted path as the folder when there is no project yet', async () => {
    dialog(undefined, { projects: [] })
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Project: Choose a project' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), '/srv/new-app')
    await userEvent.click(screen.getByRole('radio', { name: 'Use /srv/new-app' }))
    await pickedProject('new-app')
    expect(startButton()).toBeEnabled()
  })

  it('has one project list: Recent, then Open folder, Clone from link and My GitHub repos', async () => {
    const cloner = fakeCloner()
    dialog(undefined, { cloner, pickFolder: () => Promise.resolve(null) })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    const list = await lastPopup()
    expect(within(list).getByRole('group', { name: 'Recent' })).toBeInTheDocument()
    for (const name of ['Open folder…', 'Clone from link…', 'My GitHub repos…']) expect(within(list).getByRole('button', { name })).toBeInTheDocument()
  })

  it('opens the clone window on its link view or on the account\'s repositories, and takes the folder it answers with', async () => {
    const cloner = fakeCloner()
    cloner.open.mockResolvedValueOnce('/dev/widgets').mockResolvedValueOnce(null)
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Clone from link…' }))
    expect(cloner.open).toHaveBeenCalledWith({ start: 'link' })
    await pickedProject('widgets')
    await userEvent.click(screen.getByRole('button', { name: 'Project: widgets' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'My GitHub repos…' }))
    expect(cloner.open).toHaveBeenLastCalledWith({ start: 'repos' })
    await pickedProject('widgets')
  })

  it('has no clone rows or folder picker when the window gives it none', async () => {
    dialog()
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    const list = await lastPopup()
    for (const name of ['Open folder…', 'Clone from link…', 'My GitHub repos…']) expect(within(list).queryByRole('button', { name })).not.toBeInTheDocument()
  })

  it('makes a pasted GitHub link the top row, Clone owner/name to the default folder, and clones it in place', async () => {
    const cloner = fakeCloner()
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find a project, or paste a GitHub link' }), 'https://github.com/octo/widgets/tree/main?tab=1')
    const rows = within(await lastPopup()).getAllByRole('radio')
    expect(rows[0]).toHaveTextContent('Clone octo/widgets to ~/Projects/widgets')
    await userEvent.click(rows[0] as HTMLElement)
    expect(cloner.run).toHaveBeenCalledWith('https://github.com/octo/widgets.git', '~/Projects')
    await pickedProject('widgets')
    expect(cloner.remember).toHaveBeenCalledWith('~/Projects')
  })

  it('clones into the last folder used on that machine when there is one', async () => {
    const cloner = fakeCloner('/srv/code')
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'git@github.com:octo/widgets.git')
    expect(within(await lastPopup()).getAllByRole('radio')[0]).toHaveTextContent('Clone octo/widgets to /srv/code/widgets')
  })

  it('never carries a pasted user name or token: the row refuses it and nothing is cloned', async () => {
    const cloner = fakeCloner()
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'https://me:ghp_secret@github.com/octo/widgets.git')
    const row = within(await lastPopup()).getAllByRole('radio')[0] as HTMLElement
    expect(row).toHaveTextContent('Remove the user name and password from that link first')
    await userEvent.click(row)
    expect(cloner.run).not.toHaveBeenCalled()
  })

  it('treats a bare owner/name as a clone only when no listed project matches it', async () => {
    const cloner = fakeCloner()
    dialog(undefined, { cloner, projects: [{ folder: '/dev/octo/widgets', name: 'widgets', color: 'teal', sessions: 1 }] })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: widgets' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'octo/widgets')
    expect(within(await lastPopup()).queryByRole('radio', { name: /^Clone / })).not.toBeInTheDocument()
    await userEvent.clear(screen.getByRole('textbox', { name: /^Find a project/ }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'octo/other')
    expect(within(await lastPopup()).getAllByRole('radio')[0]).toHaveTextContent('Clone octo/other to ~/Projects/other')
  })

  it('offers Use it and Pick another folder when the folder is already there', async () => {
    const cloner = fakeCloner()
    cloner.run.mockRejectedValue(new Error('/home/me/Projects/widgets is already there'))
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'octo/widgets')
    await userEvent.click(within(await lastPopup()).getAllByRole('radio')[0] as HTMLElement)
    expect(await screen.findByText('There is already a folder called widgets there. Use it, or pick another folder.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pick another folder' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use it' }))
    await pickedProject('widgets')
  })

  it('says plainly that GitHub sign-in is not done here, and offers the GitHub settings, when git needs a sign-in', async () => {
    const cloner = fakeCloner()
    cloner.run.mockRejectedValue(new Error("fatal: could not read Username for 'https://github.com': terminal prompts disabled"))
    dialog(undefined, { cloner })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Find a project/ }), 'octo/private-thing')
    await userEvent.click(within(await lastPopup()).getAllByRole('radio')[0] as HTMLElement)
    expect(await screen.findByText(/cannot sign you in to GitHub yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open GitHub settings' }))
    expect(cloner.onOpenGitHubSettings).toHaveBeenCalledOnce()
  })

  it('keeps the draft in sight and its text while the folder picker is open, and takes the folder it chose', async () => {
    let choose: (picked: PickedFolder | null) => void = () => undefined
    const pickFolder = vi.fn(() => new Promise<PickedFolder | null>((resolve) => { choose = resolve }))
    dialog(undefined, { pickFolder })
    await userEvent.type(await screen.findByRole('textbox', { name: 'What should we work on?' }), 'keep this')
    await userEvent.click(screen.getByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open folder…' }))
    expect(pickFolder).toHaveBeenCalledWith(0)
    expect(screen.getByRole('region', { name: 'New session' })).toBeInTheDocument()
    choose({ machine: 0, folder: '/home/me/code/widgets' })
    await pickedProject('widgets')
    expect(box()).toHaveValue('keep this')
  })

  it('stays as it was when the folder picker is cancelled', async () => {
    const pickFolder = vi.fn(() => Promise.resolve(null))
    dialog(undefined, { pickFolder })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open folder…' }))
    await pickedProject('growth')
  })

  it('moves to another machine when the picker chose a folder there', async () => {
    const onOtherMachine = vi.fn()
    const pickFolder = vi.fn(() => Promise.resolve({ machine: 2, folder: '/srv/app' }))
    dialog(undefined, { pickFolder, onOtherMachine })
    await userEvent.click(await screen.findByRole('button', { name: 'Project: growth' }))
    await userEvent.click(within(await lastPopup()).getByRole('button', { name: 'Open folder…' }))
    await waitFor(() => { expect(onOtherMachine).toHaveBeenCalledWith(2) })
  })

  it('works in the checkout by default, so it starts the agent ahead; a worktree stops that, and so does leaving', async () => {
    const onWarm = vi.fn()
    const { unmount } = dialog(undefined, { onWarm })
    await ready()
    await waitFor(() => { expect(onWarm).toHaveBeenLastCalledWith({ folder: '/dev/growth', agent: 'claude', model: 'default', reasoning: 'medium', mode: 'default', bypass: false }) })
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
    expect(screen.getByText('Fix login is already working on dev here, so this session gets its own worktree. Your checkout stays untouched.')).toBeInTheDocument()
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

  it('keeps the branch chip and Own worktree for a folder that is not a git repository, disabled, each with its reason', async () => {
    host.branches = null
    dialog()
    await pickedProject('growth')
    const chip = await screen.findByRole('button', { name: 'Branch unavailable: no git repo' })
    expect(chip).toHaveAttribute('aria-disabled', 'true')
    expect(chip).toHaveAttribute('title', 'growth is not a git repository, so there is no branch to pick. Pick a project folder that is, or clone one.')
    expect(worktree()).toBeDisabled()
    expect(worktree()).not.toBeChecked()
    expect(screen.getByTitle(/growth is not a git repository, so a worktree cannot be made/)).toBeInTheDocument()
  })

  it('shows Own worktree outside More options, with its state in words', async () => {
    dialog()
    await ready()
    const chip = () => worktree().closest('label')
    expect(within(screen.getByRole('group', { name: 'Where it works' })).getByRole('switch', { name: 'Own worktree' })).toBeInTheDocument()
    expect(chip()).toHaveTextContent('Auto')
    expect(screen.getByTitle(/Work in a separate copy of the repository on its own branch, so your checkout stays untouched\./)).toBeInTheDocument()
    await userEvent.click(worktree())
    expect(worktree()).toBeChecked()
    expect(chip()).toHaveTextContent('On')
    await userEvent.click(worktree())
    expect(chip()).toHaveTextContent('Off')
    await openMore()
    expect(within(screen.getByRole('dialog', { name: 'More options' })).queryByRole('switch', { name: 'Own worktree' })).not.toBeInTheDocument()
  })

  it('has no Opens as control: no Chat or Terminal switch, and no plain-shell path', async () => {
    dialog()
    await ready()
    expect(screen.queryByText('Opens as')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Terminal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Chat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open terminal' })).not.toBeInTheDocument()
  })

  it('asks Where, What, Who in that order, with More options in a popover', async () => {
    dialog()
    await ready()
    // Where is the line of chips in the header, What the box, Who the agent, the permission chip and More options in the box's foot.
    const where = screen.getByRole('group', { name: 'Where it works' })
    expect(within(where).getAllByRole('button').map((chip) => chip.getAttribute('aria-label'))).toEqual(['Machine: This computer', 'Project: growth', 'Branch: dev'])
    expect(within(where).getByRole('switch', { name: 'Own worktree' })).toBeInTheDocument()
    expect(where.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box().compareDocumentPosition(screen.getByRole('button', { name: /^Agent, model and reasoning/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('status', { name: /^Permissions: / })).toBeInTheDocument()
    const more = screen.getByRole('button', { name: 'More options' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('switch', { name: 'Skip permission prompts' })).not.toBeInTheDocument()
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('dialog', { name: 'More options' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Skip permission prompts' })).toBeInTheDocument()
  })

  it.each([['chat', 'claude'], ['terminal', 'claude'], ['terminal', 'codex'], ['chat', 'codex']] as const)('opens the session in the view Settings chose (%s) for %s', async (openIn, agent) => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { openIn, defaultAgent: agent })
    await ready()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ view: openIn })) })
  })

  it('opens a Gemini session in the terminal whatever Settings says, and says why in one line', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { openIn: 'chat', defaultAgent: 'gemini' })
    await ready()
    expect(screen.getByText('Gemini has no chat view yet, so this session opens in its terminal.')).toBeInTheDocument()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'gemini', view: 'terminal' })) })
  })

  it('says nothing about Gemini for the other agents', async () => {
    dialog()
    await ready()
    expect(screen.queryByText(/has no chat view/)).not.toBeInTheDocument()
  })

  it('shows the permission mode as a chip and changes it for this session from More options', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart, { bypassOff: [] })
    await ready()
    expect(screen.getByRole('status', { name: 'Permissions: Bypass permissions' })).toBeInTheDocument()
    await openMore()
    await userEvent.click(screen.getByRole('switch', { name: 'Skip permission prompts' }))
    expect(screen.getByRole('status', { name: 'Permissions: Ask before edits' })).toBeInTheDocument()
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', mode: 'default', bypass: false })) })
  })

  it('shows Codex\'s Full access in the chip while its Bypass Permissions is on', async () => {
    dialog(undefined, { defaultAgent: 'codex', bypassOff: [] })
    await ready()
    expect(screen.getByRole('status', { name: 'Permissions: Full access' })).toBeInTheDocument()
  })

  it('starts on Enter and keeps Shift+Enter as a new line', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    dialog(onStart)
    await ready()
    await userEvent.type(box(), 'one{Shift>}{Enter}{/Shift}two')
    expect(box()).toHaveValue('one\ntwo')
    expect(onStart).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => { expect(onStart).toHaveBeenCalledTimes(1) })
    expect(onStart.mock.calls[0]?.[0].message).toBe('one\ntwo')
  })

  it('opens on the agent it was last started with', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    const first = dialog(onStart)
    await ready()
    await chooseAgent('Codex')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalled() })
    first.unmount()
    dialog()
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Codex/ })).toBeInTheDocument()
  })

  it('lists a machine that is down with the reason, will not pick it, and will not start on it', async () => {
    const machines = [{ machine: 0, label: 'This computer', local: true }, { machine: 2, label: 'Shipyard', local: false, down: 'ssh: connection refused' }]
    const onOtherMachine = vi.fn()
    dialog(undefined, { machines, onOtherMachine })
    await userEvent.click(screen.getByRole('button', { name: 'Machine: This computer' }))
    const list = await lastPopup()
    const row = within(list).getByRole('radio', { name: /^Shipyard/ })
    expect(row).toHaveTextContent('ssh: connection refused')
    expect(row).toHaveTextContent('not reachable')
    await userEvent.click(row)
    expect(onOtherMachine).not.toHaveBeenCalled()
  })

  it('says why the machine it opened on is down, from its chip and under the boxes, and keeps Start off', async () => {
    const machines = [{ machine: 0, label: 'This computer', local: true, down: 'the service is not running' }]
    dialog(undefined, { machines })
    await ready()
    expect(screen.getByRole('button', { name: 'Machine: This computer, not reachable' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('This computer is not reachable: the service is not running')
    await userEvent.type(box(), 'hello')
    expect(startButton()).toBeDisabled()
  })

  it('closes on Close and on Escape', async () => {
    const onCancel = vi.fn()
    dialog(undefined, { onCancel })
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.type(box(), '{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('has no name field, and attaches files only on this computer', async () => {
    dialog()
    await pickedProject('growth')
    expect(screen.queryByRole('textbox', { name: 'Chat name' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument()
  })

  it('has one dropdown for the agent, its model and its effort, in one line', async () => {
    dialog()
    const button = screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · .* · Medium/ })
    expect(button).toHaveTextContent(/^Claude · .*Medium$/)
    expect(screen.queryByRole('radiogroup', { name: 'Agent' })).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(within(screen.getByRole('radiogroup', { name: 'Agent' })).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Claude', 'Codex', 'Gemini'])
    expect(screen.getByRole('radiogroup', { name: 'Model' })).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Effort' })).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Low', 'Medium', 'High', 'Max'])
  })

  it('stays open while the agent, model and effort are changed, jumps to an agent by typing, and closes on Enter', async () => {
    dialog()
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    const agents = () => within(screen.getByRole('radiogroup', { name: 'Agent' }))
    agents().getByRole('radio', { name: 'Claude' }).focus()
    await userEvent.keyboard('cod')
    expect(agents().getByRole('radio', { name: 'Codex' })).toBeChecked()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'High' }))
    expect(screen.getByRole('radiogroup', { name: 'Agent' })).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(screen.queryByRole('radiogroup', { name: 'Agent' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Codex · .* · High/ })).toBeInTheDocument()
  })

  it('gives each agent back the model and effort it was left at', async () => {
    dialog()
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'Max' }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name: 'Codex' }))
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Codex · .* · Medium/ })).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name: 'Claude' }))
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · .* · Max/ })).toBeInTheDocument()
  })

  it('has no effort part in the menu of an agent without an effort setting', async () => {
    dialog(undefined, { defaultAgent: 'gemini' })
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning: Gemini/ }))
    expect(screen.queryByRole('radiogroup', { name: 'Effort' })).not.toBeInTheDocument()
    expect(screen.queryByText(/no effort setting to pick/)).not.toBeInTheDocument()
  })

  it('starts on medium effort and says so on the model and effort button', async () => {
    dialog()
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude · .* · Medium/ })).toHaveTextContent('Medium')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    expect(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'Medium' })).toBeChecked()
  })

  it('switches the agent with the toggle, and sends one that is not installed to its setup page', async () => {
    host.installed = ['claude']
    dialog()
    await pickedProject('growth')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning/ }))
    expect(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name: 'Claude' })).toBeChecked()
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Agent' })).getByRole('radio', { name: 'Codex' }))
    await userEvent.keyboard('{Escape}')
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

  it('starts Claude in Bypass permissions by default', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { bypassOff: [] })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', mode: 'bypassPermissions' })) })
  })

  it('keeps Claude on its usual mode while its Bypass Permissions is off', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { bypassOff: ['claude'] })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude', mode: 'default' })) })
  })

  it('sends no mode of its own for a Codex chat while its Bypass Permissions is on: its flag already gives full access', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    dialog(onStart, { defaultAgent: 'codex', bypassOff: [] })
    await pickedProject('growth')
    await userEvent.type(box(), 'hello')
    await userEvent.click(startButton())
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', mode: 'default' })) })
  })
})

describe('the New session draft opened from a full chat', () => {
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

  it('starts the chat in the background on Ctrl+Shift+Enter, and empties the box with every other choice kept', async () => {
    const onStart = vi.fn<Start>().mockResolvedValue(undefined)
    dialog(onStart)
    await ready()
    await chooseAgent('Codex')
    await userEvent.type(box(), 'first task')
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ folder: '/dev/growth', message: 'first task', agent: 'codex' }), { background: true })
    expect(box()).toHaveValue('')
    await pickedProject('growth')
    expect(screen.getByRole('button', { name: /^Agent, model and reasoning: Codex/ })).toBeInTheDocument()
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

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not start “fix the login”\s*The worktree could not be made/)
    expect(box()).toHaveValue('a new draft')
    await userEvent.click(screen.getByRole('button', { name: 'Put back “fix the login”' }))
    expect(box()).toHaveValue('a new draft\n\nfix the login')
    expect(screen.queryByText(/Could not start/)).not.toBeInTheDocument()
  })
})

describe('the New session draft on another machine', () => {
  const MACHINES = [{ machine: 0, label: 'This computer', local: true }, { machine: 2, label: 'Shipyard', local: false }]
  const folders = [{ folder: '/srv/app', name: 'app', color: 'teal', sessions: 3 }]
  function remote(onStart: (request: { machine: number; machineName: string; branch: unknown; folder: string; message: string }) => Promise<void>, onOtherMachine = vi.fn()) {
    return render(
      <NewChatPage machine={2} machines={MACHINES} projects={folders} defaultAgent="claude" pickFolder={null} onStart={onStart} onOtherMachine={onOtherMachine} onCancel={() => undefined} />,
      { container: windowRoot() },
    )
  }

  it('lists that machine\'s projects and starts there with no branch', async () => {
    const onStart = vi.fn(() => Promise.resolve())
    remote(onStart)
    await pickedProject('app')
    expect(screen.getByRole('button', { name: 'Machine: Shipyard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Branch unavailable: not read here' })).toHaveAttribute('title', expect.stringContaining('Shipyard\'s branches are not read from here, so the session starts on what is checked out there'))
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
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Model' })).getByRole('radio', { name: /Opus/ }))
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Effort' })).getByRole('radio', { name: 'High' }))
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

/** The window's clone for the dialog, with the machine's usual destination. */
function fakeCloner(parent = '~/Projects') {
  return {
    parent,
    run: vi.fn<(address: string, into: string) => Promise<string>>((_address, into) => Promise.resolve(`${into}/widgets`)),
    remember: vi.fn(),
    open: vi.fn<RepoCloner['open']>().mockResolvedValue(null),
    onOpenGitHubSettings: vi.fn(),
  }
}

describe('the New session draft as a chat that has not been sent', () => {
  it('shows the Starting card in the same view while the start runs, then keeps the message if it fails', async () => {
    let fail: (reason: Error) => void = () => undefined
    const onStart = vi.fn(() => new Promise<void>((_, reject) => { fail = reject }))
    dialog(onStart)
    await pickedProject('growth')
    await userEvent.type(box(), 'fix the build{Enter}')
    const view = screen.getByRole('region', { name: 'New session' })
    expect(within(view).getByText('Starting Claude…')).toBeInTheDocument()
    expect(within(view.querySelector<HTMLElement>('.mx-nc-start') as HTMLElement).getByText('fix the build')).toBeInTheDocument()
    fail(new Error('no daemon'))
    await waitFor(() => { expect(screen.queryByText('Starting Claude…')).not.toBeInTheDocument() })
    expect(box()).toHaveValue('fix the build')
    expect(parkedDraft()).toBe('fix the build')
  })

  it('keeps the same view mounted from the first key to the start', async () => {
    dialog()
    await pickedProject('growth')
    const view = screen.getByRole('region', { name: 'New session' })
    await userEvent.type(box(), 'hello{Enter}')
    expect(screen.getByRole('region', { name: 'New session' })).toBe(view)
  })

  it('keeps its text when it is left and comes back, and drops it on Esc; an empty draft is never kept', async () => {
    const first = dialog()
    await pickedProject('growth')
    await userEvent.type(box(), 'half a thought')
    first.unmount()
    expect(parkedDraft()).toBe('half a thought')
    const second = dialog()
    expect(box()).toHaveValue('half a thought')
    await userEvent.type(box(), '{Escape}')
    expect(parkedDraft()).toBe('')
    second.unmount()
    dialog()
    expect(box()).toHaveValue('')
    await userEvent.type(box(), '   ')
    expect(parkedDraft()).toBe('')
  })

  it('has no close button when it is the home screen, with no session to go back to', async () => {
    render(<NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="claude" bypassOff={ALL_OFF} pickFolder={null} onStart={() => Promise.resolve()} onOtherMachine={() => undefined} />, { container: windowRoot() })
    await pickedProject('growth')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('starts the home draft on Ctrl+Shift+Enter as a plain start: there is no session to stay on', async () => {
    const onStart = vi.fn<(request: NewChatRequest) => Promise<void>>().mockResolvedValue(undefined)
    render(<NewChatPage machine={0} machines={HERE} projects={PROJECTS} defaultAgent="claude" bypassOff={ALL_OFF} pickFolder={null} onStart={onStart} onOtherMachine={() => undefined} />, { container: windowRoot() })
    await pickedProject('growth')
    await userEvent.type(box(), 'go')
    await userEvent.keyboard('{Control>}{Shift>}{Enter}{/Shift}{/Control}')
    await waitFor(() => { expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ message: 'go' })) })
  })

  it('attaches nothing on another machine and says why', async () => {
    dialog(undefined, { machines: [...HERE, { machine: 2, label: 'devbox', local: false }] })
    await pickedProject('growth')
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeInTheDocument()
  })
})
