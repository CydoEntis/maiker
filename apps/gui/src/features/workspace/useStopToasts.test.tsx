import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { Toaster } from '@/components/ui/toaster'
import { resetToasts } from '@/lib/toast'
import { toSessionView, type SessionView } from './model/session'
import { useStopToasts } from './useStopToasts'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(1)), agentsInstalled: () => Promise.resolve(['claude']) }))

function session(extra: Partial<Conversation> = {}): SessionView {
  return toSessionView({ id: 't1', kind: 'terminal', title: '', project: '', folder: '/home/me/api', cwd: '/home/me/api', repo: 'api-server', branch: '', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, agent: 'gemini', ...extra }, '/home/me')
}
const stopped = (): SessionView => session({ details: { asking: '', interrupted: null, timeline: [], usage: { context: null, cost: null, tokens: null }, exit: { code: 127, at: 5 } } })

function Harness({ sessions, onShow }: { sessions: readonly SessionView[]; onShow: (id: string) => void }) {
  useStopToasts({ sessions, listed: true, online: true, showSessionById: onShow })
  return <Toaster />
}

describe('the toast for a session that stopped', () => {
  beforeEach(() => { resetToasts() })
  afterEach(() => { resetToasts() })

  it('is raised once, names the project, and offers the fix first and then Open, which selects the session', async () => {
    const onShow = vi.fn()
    const { rerender } = render(<Harness sessions={[session()]} onShow={onShow} />)
    rerender(<Harness sessions={[stopped()]} onShow={onShow} />)
    const toast = await screen.findByRole('alert')
    expect(within(toast).getByText('api-server')).toBeInTheDocument()
    const actions = within(toast).getAllByRole('button').map((button) => button.textContent)
    expect(actions.indexOf('Install Gemini')).toBe(0)
    expect(actions).toContain('Open')
    // The same stop read again in a new list raises nothing more.
    rerender(<Harness sessions={[stopped()]} onShow={onShow} />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    await userEvent.click(within(toast).getByRole('button', { name: 'Open' }))
    expect(onShow).toHaveBeenCalledWith('t1')
  })

  it('goes when the session runs again', async () => {
    const { rerender } = render(<Harness sessions={[session()]} onShow={vi.fn()} />)
    rerender(<Harness sessions={[stopped()]} onShow={vi.fn()} />)
    await screen.findByRole('alert')
    rerender(<Harness sessions={[session({ status: 'working' })]} onShow={vi.fn()} />)
    await waitFor(() => { expect(screen.queryByRole('alert')).not.toBeInTheDocument() })
  })
})
