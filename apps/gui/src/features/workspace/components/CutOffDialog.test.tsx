import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SessionView } from '../model/session'
import { CutOffDialog } from './CutOffDialog'

function cut(id: string, title: string, machineName: string | null = null): SessionView {
  return { id, title, name: null, machineName, repoName: 'app', cwdLabel: '~/app', process: 'claude', chatCutOff: true } as SessionView
}

const SESSIONS = [cut('1', 'Fix the login'), cut('2', 'Write the tests', 'build')]

describe('Pick up where you left off', () => {
  it('lists every session the restart cut, all ticked, and resumes them all only when the button is pressed', async () => {
    const onContinue = vi.fn()
    render(<div className="mx-app"><CutOffDialog sessions={SESSIONS} onContinue={onContinue} onNotNow={() => undefined} /></div>)

    const list = screen.getByRole('list', { name: 'Sessions cut off mid-reply' })
    expect(within(list).getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)).toEqual([true, true])
    expect(within(list).getByText('app · build')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume 2 chats' }))
    expect(onContinue).toHaveBeenCalledWith(SESSIONS)
  })

  it('resumes only the ticked ones, and not at all when none is ticked', async () => {
    const onContinue = vi.fn()
    render(<div className="mx-app"><CutOffDialog sessions={SESSIONS} onContinue={onContinue} onNotNow={() => undefined} /></div>)

    await userEvent.click(screen.getByRole('checkbox', { name: /Fix the login/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Resume 1 chat' }))
    expect(onContinue).toHaveBeenCalledWith([SESSIONS[1]])
    await userEvent.click(screen.getByRole('checkbox', { name: /Write the tests/ }))
    expect(screen.getByRole('button', { name: 'Resume 0 chats' })).toBeDisabled()
  })

  it('leaves them as they are with Not now, the close button or Escape', async () => {
    const onNotNow = vi.fn()
    render(<div className="mx-app"><CutOffDialog sessions={SESSIONS} onContinue={() => undefined} onNotNow={onNotNow} /></div>)

    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Escape}')
    expect(onNotNow).toHaveBeenCalledTimes(3)
  })
})
