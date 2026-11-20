import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { StartMenu, type StartMenuProps } from './StartMenu'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox', chip: { glyph: '●', word: 'connected', tone: 'ok' } }
const DOWN: MachineHead = { ...DEVBOX, key: 'machine-5', machine: 5, name: 'attic', label: 'attic', down: true }

function show(more: Partial<StartMenuProps> = {}) {
  const calls = { onTerminal: vi.fn(), onAgent: vi.fn(), onAddMachine: vi.fn() }
  const props: StartMenuProps = {
    machine: 0, machines: [LOCAL_HEAD, DEVBOX, DOWN], project: 'shop', installed: ['claude', 'codex', 'opencode'],
    portalContainer: null, ...calls, children: <button type="button">New session</button>, ...more,
  }
  render(<StartMenu {...props} />)
  return calls
}

async function open() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'New session' }))
  await screen.findByRole('menu', { name: 'Start' })
  return user
}

describe('the + menu', () => {
  it('names where a session starts, then offers a terminal, the installed agents numbered, and the ones not installed greyed, never Copilot', async () => {
    show()
    await open()
    expect(screen.getByText('In shop · This computer')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Terminal/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^Claude Code/ })).toHaveTextContent('1')
    expect(screen.getByRole('menuitem', { name: /^Codex/ })).toHaveTextContent('2')
    expect(screen.getByRole('menuitem', { name: /^OpenCode/ })).toHaveTextContent('3')
    const gemini = screen.getByRole('menuitem', { name: /^Gemini/ })
    expect(gemini).toHaveAttribute('aria-disabled', 'true')
    expect(gemini).toHaveTextContent('not installed')
    expect(screen.queryByText(/copilot/i)).toBeNull()
  })

  it('offers no Terminal when it has no way to start one (the Chat view), only the agents', async () => {
    show({ onTerminal: undefined })
    await open()
    expect(screen.queryByRole('menuitem', { name: /^Terminal/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /^Claude Code/ })).toBeInTheDocument()
  })

  it('starts a terminal on its machine', async () => {
    const calls = show()
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: /^Terminal/ }))
    expect(calls.onTerminal).toHaveBeenCalledWith(0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('starts the agent whose number is pressed, counting only the installed ones, and closes', async () => {
    const calls = show({ installed: ['codex', 'opencode'] })
    const user = await open()
    await user.keyboard('2')
    expect(calls.onAgent).toHaveBeenCalledExactlyOnceWith('opencode', 0)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does nothing for a number with no installed agent behind it', async () => {
    const calls = show({ installed: ['claude'] })
    const user = await open()
    await user.keyboard('4')
    expect(calls.onAgent).not.toHaveBeenCalled()
    expect(screen.getByRole('menu', { name: 'Start' })).toBeInTheDocument()
  })

  it('does not start an agent from a click on one that is not installed', async () => {
    const calls = show({ installed: ['claude'] })
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: /^Gemini/ }))
    expect(calls.onAgent).not.toHaveBeenCalled()
  })

  it('lists the machines, then Add a machine, and opens the add-machine dialog from it', async () => {
    const calls = show()
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: /^On a remote machine/ }))
    expect(screen.getByText('Pick a machine')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^devbox/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /^attic/ })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'Add a machine…' }))
    expect(calls.onAddMachine).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('starts an agent on a picked machine, offering every agent since that machine\'s are not known', async () => {
    const calls = show({ installed: ['claude'] })
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: /^On a remote machine/ }))
    await user.click(screen.getByRole('menuitem', { name: /^devbox/ }))
    expect(screen.getByText('On devbox')).toBeInTheDocument()
    await user.keyboard('2')
    expect(calls.onAgent).toHaveBeenCalledWith('codex', 4)
  })

  it('goes back a page with Backspace or the left arrow, and closes from any page with Escape', async () => {
    show()
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: /^On a remote machine/ }))
    await user.click(screen.getByRole('menuitem', { name: /^devbox/ }))
    await user.keyboard('{Backspace}')
    expect(screen.getByText('Pick a machine')).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('In shop · This computer')).toBeInTheDocument()
    await user.keyboard('{Backspace}')
    expect(screen.getByText('In shop · This computer')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /^On a remote machine/ }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens straight on its own machine when the + belongs to one, with nothing to go back to', async () => {
    const calls = show({ machine: 4 })
    const user = await open()
    expect(screen.getByText('On devbox')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /^Back/ })).toBeNull()
    await user.keyboard('1')
    expect(calls.onAgent).toHaveBeenCalledWith('claude', 4)
  })

  it('offers no worktree rows: a worktree needs a project, so it is started from a session', async () => {
    show()
    await open()
    expect(screen.queryByRole('menuitem', { name: /worktree/i })).toBeNull()
  })

  it('offers Open a project on this computer\'s own +, and opens it there without starting anything', async () => {
    const onOpenProject = vi.fn()
    const calls = show({ onOpenProject })
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: 'Open a project…' }))
    expect(onOpenProject).toHaveBeenCalledWith(0)
    expect(calls.onAgent).not.toHaveBeenCalled()
    expect(calls.onTerminal).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: 'Start' })).toBeNull()
  })

  it('offers Open a project on another machine\'s own +, for that machine', async () => {
    const onOpenProject = vi.fn()
    show({ machine: 4, onOpenProject })
    const user = await open()
    await user.click(screen.getByRole('menuitem', { name: 'Open a project…' }))
    expect(onOpenProject).toHaveBeenCalledWith(4)
  })

  it('offers no Open a project on a + that is not a machine\'s own', async () => {
    show()
    await open()
    expect(screen.queryByRole('menuitem', { name: 'Open a project…' })).toBeNull()
  })

  it('is open when the window says so, with no click, as Get started leaves it', async () => {
    show({ open: true, onOpenChange: vi.fn() })
    expect(await screen.findByRole('menu', { name: 'Start' })).toBeInTheDocument()
  })
})
