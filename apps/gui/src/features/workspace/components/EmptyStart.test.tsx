import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_HEAD, type MachineHead } from '../model/machines'
import { startPlaces } from '../model/emptyStart'
import { EmptyStart } from './EmptyStart'

const DEVBOX: MachineHead = { ...LOCAL_HEAD, key: 'machine-4', machine: 4, name: 'devbox', label: 'devbox' }
const PLACES = startPlaces([LOCAL_HEAD, DEVBOX], [
  { machineName: null, projects: [{ project: { machineName: null, folder: '/home/me/shop' }, sessions: [] }, { project: { machineName: null, folder: '/home/me/docs' }, sessions: [] }] },
  { machineName: 'devbox', projects: [{ project: { machineName: 'devbox', folder: '/srv/api' }, sessions: [] }] },
])
const [SHOP, DOCS] = PLACES

type Props = ComponentProps<typeof EmptyStart>

function show(extra: Partial<Props> = {}) {
  const calls = { onPick: vi.fn(), onStart: vi.fn(), onOpenProject: vi.fn(), onAddMachine: vi.fn() }
  const view = render(<EmptyStart running={false} places={PLACES} place={SHOP ?? null} installed={['claude', 'gemini']} canStart covered={false} openProjectKeys="Ctrl+Shift+O" portalContainer={null} {...calls} {...extra} />)
  return { ...calls, ...view, user: userEvent.setup() }
}

const agentButtons = () => screen.getAllByRole('button', { name: /^Start .+ in / })

describe('the empty state', () => {
  it('has a heading and one button per installed agent, named with the agent and the project', () => {
    show()
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(agentButtons().map((button) => button.getAttribute('aria-label'))).toEqual(['Start Claude in shop', 'Start Gemini in shop'])
  })

  it('does not say nothing runs while sessions exist', () => {
    const { rerender } = render(<EmptyStart running={false} places={PLACES} place={SHOP ?? null} installed={[]} canStart covered={false} openProjectKeys="" portalContainer={null} onPick={vi.fn()} onStart={vi.fn()} onOpenProject={vi.fn()} onAddMachine={vi.fn()} />)
    const idle = screen.getByRole('heading').textContent
    rerender(<EmptyStart running places={PLACES} place={SHOP ?? null} installed={[]} canStart covered={false} openProjectKeys="" portalContainer={null} onPick={vi.fn()} onStart={vi.fn()} onOpenProject={vi.fn()} onAddMachine={vi.fn()} />)
    expect(screen.getByRole('heading').textContent).not.toBe(idle)
  })

  it('starts the agent whose row is clicked, in the picked project', async () => {
    const { user, onStart } = show()
    await user.click(screen.getByRole('button', { name: 'Start Gemini in shop' }))
    expect(onStart).toHaveBeenCalledExactlyOnceWith(SHOP, 'gemini')
  })

  it('starts the agent at a number key, and nothing for a number with no agent', async () => {
    const { user, onStart } = show()
    await user.keyboard('3')
    expect(onStart).not.toHaveBeenCalled()
    await user.keyboard('2')
    expect(onStart).toHaveBeenCalledExactlyOnceWith(SHOP, 'gemini')
  })

  it('leaves a number typed in a field or with Ctrl alone', async () => {
    const { user, onStart } = show()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    await user.keyboard('1')
    field.remove()
    await user.keyboard('{Control>}1{/Control}')
    expect(onStart).not.toHaveBeenCalled()
  })

  it('leaves the number keys alone while something is open over it, and while nothing can start', async () => {
    const { user, onStart, rerender } = show({ covered: true })
    await user.keyboard('1')
    rerender(<EmptyStart running={false} places={PLACES} place={SHOP ?? null} installed={['claude']} canStart={false} covered={false} openProjectKeys="" portalContainer={null} onPick={vi.fn()} onStart={onStart} onOpenProject={vi.fn()} onAddMachine={vi.fn()} />)
    await user.keyboard('1')
    expect(onStart).not.toHaveBeenCalled()
    for (const button of agentButtons()) expect(button).toBeDisabled()
  })

  it('stops answering number keys once it is gone', async () => {
    const { user, onStart, unmount } = show()
    unmount()
    await user.keyboard('1')
    expect(onStart).not.toHaveBeenCalled()
  })

  it('picks another project from the picker with the keyboard, and a number then belongs to the menu', async () => {
    const { user, onPick, onStart } = show()
    const picker = screen.getByRole('button', { name: 'Project: shop' })
    picker.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').length).toBe(PLACES.length + 1)
    await user.keyboard('1')
    expect(onStart).not.toHaveBeenCalled()
    await user.click(within(menu).getByRole('menuitem', { name: /docs/ }))
    expect(onPick).toHaveBeenCalledExactlyOnceWith(DOCS)
  })

  it('offers to open a project in the picker’s place when none is open, and lists no agent', async () => {
    const { user, onOpenProject, onStart } = show({ places: [], place: null })
    expect(screen.queryByRole('button', { name: /^Start / })).toBeNull()
    await user.keyboard('1')
    expect(onStart).not.toHaveBeenCalled()
    for (const button of screen.getAllByRole('button', { name: /^Open a project/ })) await user.click(button)
    expect(onOpenProject).toHaveBeenCalledTimes(2)
  })

  it('opens the palette for a project and for a new machine', async () => {
    const { user, onOpenProject, onAddMachine } = show()
    await user.click(screen.getByRole('button', { name: /^Open a project/ }))
    await user.click(screen.getByRole('button', { name: 'Add a remote machine' }))
    expect(onOpenProject).toHaveBeenCalledOnce()
    expect(onAddMachine).toHaveBeenCalledOnce()
  })

  it('takes focus when focus is nowhere, so Tab reaches the picker first', async () => {
    const { user } = show()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Project: shop' })).toHaveFocus()
  })
})
