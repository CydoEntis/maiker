import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  installed: ['claude', 'opencode'] as string[],
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

const PROJECTS = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ folder: `/dev/${name}`, name, color: 'teal', sessions: 1 }))
const NOW = Math.floor(Date.now() / 1000)
const GIT = {
  current: 'main',
  branches: [
    { name: 'main', current: true, when: NOW - 3600 },
    { name: 'dev', current: false, when: NOW - 120 },
    { name: 'agent/grow-028', current: false, when: NOW - 240 },
  ],
  worktrees: [
    { path: '/dev/a', branch: 'main', main: true, when: NOW - 3600 },
    { path: '/dev/a-agent-grow-028', branch: 'agent/grow-028', main: false, when: NOW - 240 },
  ],
}

function page(onStart: (request: NewChatRequest) => Promise<void> = () => Promise.resolve(), onAddMachine?: () => void) {
  return render(
    <div className="mx-app">
      <NewChatPage machine={0} machines={[{ machine: 0, label: 'This computer', local: true }]} projects={PROJECTS} defaultAgent="claude" browse={() => Promise.resolve(null)}
        onStart={onStart} onOtherMachine={() => undefined} {...(onAddMachine ? { onAddMachine } : {})} onCancel={() => undefined} />
    </div>,
  )
}

beforeEach(() => {
  host.installed = ['claude', 'opencode']
  host.branches = null
  host.openAgentDocs.mockClear()
})

/** Waits until the page has picked this project: the project crumb in its header names it. */
async function pickProject(name: string) {
  expect(await screen.findByRole('button', { name: `Project folder and machine: ${name}` })).toBeInTheDocument()
}

/** The menu opened last. */
async function lastPopup() {
  const open = await screen.findAllByRole('dialog')
  const last = open.at(-1)
  if (last === undefined) throw new Error('no menu is open')
  return last
}

describe('the new chat page, against this computer', () => {
  it('shows no branch or Work in crumb for a folder that is not a git repository', async () => {
    page()
    await pickProject('a')
    expect(screen.queryByRole('button', { name: /^Branch/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Work in/ })).not.toBeInTheDocument()
  })

  it('lists the real branches with their ages under the folder\'s name, the current branch ticked', async () => {
    host.branches = GIT
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Branch: main' }))
    const menu = await lastPopup()
    expect(menu).toHaveTextContent('Branch in a')
    expect(within(menu).getByRole('radio', { name: /^dev/ })).toHaveTextContent('2m')
    expect(within(menu).getByRole('radio', { name: /^main/ })).toBeChecked()
  })

  it('starts the chat on a branch that was picked, or on a new one that was typed', async () => {
    host.branches = GIT
    const started: NewChatRequest[] = []
    page((request) => { started.push(request); return Promise.resolve() })
    await userEvent.click(await screen.findByRole('button', { name: 'Branch: main' }))
    await userEvent.click(within(await lastPopup()).getByRole('radio', { name: /^dev/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }))
    expect(started[0]?.branch).toEqual({ name: 'dev', create: false, worktree: false })

    await userEvent.click(screen.getByRole('button', { name: 'Work in: This folder' }))
    await userEvent.click(within(await lastPopup()).getByRole('radio', { name: /^New worktree/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Branch: dev' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Find or create a branch' }), 'agent/grow-030')
    await userEvent.click(screen.getByRole('radio', { name: '+ Create agent/grow-030 from main' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start chat' }))
    expect(started[1]?.branch).toEqual({ name: 'agent/grow-030', create: true, worktree: true })
  })

  it('lists every project of the computer in the project menu, the one picked ticked', async () => {
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Project folder and machine: a' }))
    const menu = await lastPopup()
    expect(within(within(menu).getByRole('group', { name: 'Folder' })).getAllByRole('radio')).toHaveLength(5)
    expect(within(menu).getByRole('radio', { name: /^a/ })).toBeChecked()
  })

  it('switches the agent from the model button, and sends one that is not installed to its setup page', async () => {
    page()
    await pickProject('a')
    await userEvent.click(screen.getByRole('button', { name: /^Agent, model and reasoning: Claude/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'Codex' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/Codex is not installed on this computer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'set it up' }))
    expect(host.openAgentDocs).toHaveBeenCalledWith('codex')
  })

  it('will not start with an agent that is not installed', async () => {
    host.installed = ['codex']
    page()
    await pickProject('a')
    expect(await screen.findByText(/Claude is not installed on this computer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start chat' })).toBeDisabled()
  })

  it('offers adding a machine from Remote machine when no other machine is known', async () => {
    const add = vi.fn()
    page(undefined, add)
    await userEvent.click(await screen.findByRole('button', { name: 'Project folder and machine: a' }))
    await userEvent.click(within(await lastPopup()).getByRole('radio', { name: 'Remote machine' }))
    expect(add).toHaveBeenCalledOnce()
  })
})
