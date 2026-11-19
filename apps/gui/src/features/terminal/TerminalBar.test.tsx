import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { toSessionView, type SessionView } from '@/features/workspace/model/session'
import { ShellHint, TerminalBar } from './TerminalBar'
import { showsShellHint, terminalBarOf } from './terminalBar'

vi.mock('@/api/daemon', () => ({ terminalOf: (id: string) => Number(id.slice(id.indexOf('t') + 1)) }))

afterEach(cleanup)

function session(extra: Partial<Conversation> = {}): SessionView {
  return toSessionView(
    { id: 't1', generation: 0, kind: 'terminal', title: '', project: '', folder: '/home/me/app', cwd: '/home/me/app', repo: 'app', branch: 'dev', provider: 'Claude', status: 'idle', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, agent: 'claude', process: 'claude', ...extra },
    '/home/me',
  )
}

const usage = (context: number) => ({ asking: '', interrupted: null, timeline: [], usage: { context, cost: null, tokens: null }, limits: [] })

describe('terminalBarOf', () => {
  it('reads machine, project, branch, usage and agent from the session', () => {
    const facts = terminalBarOf(session({ machine: 4, machineName: 'devbox', linked: true, details: { ...usage(42), limits: [{ name: '5h', used: 80, resetsAt: 0 }] } }))
    expect(facts).toMatchObject({ machine: 'devbox', project: 'app', branch: 'dev', worktree: true, agent: 'claude', contextAlways: true })
    expect(facts?.usage).toEqual({ context: 42, limits: [{ name: '5h', used: 80, resetsAt: 0 }] })
  })

  it('gives a plain shell no bar but a hint', () => {
    const shell = session({ agent: null, process: 'shell' })
    expect(terminalBarOf(shell)).toBeNull()
    expect(showsShellHint(shell)).toBe(true)
    expect(showsShellHint(session())).toBe(false)
  })

  it('gives a program that is no agent no bar', () => {
    expect(terminalBarOf(session({ agent: null, process: 'ssh' }))).toBeNull()
  })
})

describe('TerminalBar', () => {
  it('shows where it runs, the context meter and the agent name', () => {
    const facts = terminalBarOf(session({ details: usage(42) }))
    if (facts === null) throw new Error('no bar')
    render(<TerminalBar facts={facts} />)
    expect(screen.getByText('app')).toBeTruthy()
    expect(screen.getByText('dev')).toBeTruthy()
    expect(screen.getByRole('meter', { name: 'Context' }).getAttribute('aria-valuenow')).toBe('42')
    expect(screen.getByText('claude')).toBeTruthy()
  })

  it('tags a worktree, and names the machine', () => {
    const facts = terminalBarOf(session({ machine: 4, machineName: 'devbox', linked: true }))
    if (facts === null) throw new Error('no bar')
    render(<TerminalBar facts={facts} />)
    expect(screen.getByText('worktree')).toBeTruthy()
    expect(screen.getByText('devbox')).toBeTruthy()
  })

  it('opens Usage & cost from a meter', async () => {
    const open = vi.fn()
    const facts = terminalBarOf(session())
    if (facts === null) throw new Error('no bar')
    render(<TerminalBar facts={facts} onOpenUsage={open} />)
    await userEvent.click(screen.getByRole('button', { name: /Ctx/ }))
    expect(open).toHaveBeenCalledOnce()
  })
})

describe('ShellHint', () => {
  it('starts the agent that is clicked, and offers none while offline', async () => {
    const start = vi.fn()
    const { rerender } = render(<ShellHint onStart={start} disabled={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'codex' }))
    expect(start).toHaveBeenCalledWith('codex')
    rerender(<ShellHint onStart={start} disabled />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'claude' }).disabled).toBe(true)
  })
})
