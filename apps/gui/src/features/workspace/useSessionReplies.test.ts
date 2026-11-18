import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionView } from './model/session'

const sendTerminalInput = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>())
vi.mock('@/api/daemon', () => ({ sendTerminalInput }))
vi.mock('@/lib/toast', () => ({ toast: { failed: vi.fn(), error: vi.fn() } }))

import { useSessionReplies } from './useSessionReplies'

function session(process: string, ask: { answerable: boolean } | null): SessionView {
  return { id: 't1', name: null, title: 't', process, status: 'needs', ask, conversation: { generation: 1 } } as unknown as SessionView
}

function answer(target: SessionView, choice: 'y' | 'a' | 'n') {
  const flash = vi.fn()
  const { result } = renderHook(() => useSessionReplies({ sessionMap: new Map([[target.id, target]]), flash, showSessionById: vi.fn(), setDismissedRestores: vi.fn() }))
  result.current.answerSession(target.id, choice)
  return flash
}

describe('answering a session from the sidebar or a notification', () => {
  beforeEach(() => { sendTerminalInput.mockReset().mockResolvedValue(undefined) })

  it('sends y to an answerable Codex ask to approve and Esc to decline', () => {
    answer(session('codex', { answerable: true }), 'y')
    answer(session('codex', { answerable: true }), 'n')
    expect(sendTerminalInput.mock.calls.map((call: unknown[]) => call[1] as string)).toEqual(['y', '\x1b'])
  })

  it('never sends a key for a Codex ask the daemon did not mark answerable, or none', () => {
    for (const ask of [{ answerable: false }, null]) for (const choice of ['y', 'a', 'n'] as const) answer(session('codex', ask), choice)
    expect(sendTerminalInput).not.toHaveBeenCalled()
  })

  it('never sends a to Codex, even when answerable', () => {
    answer(session('codex', { answerable: true }), 'a')
    expect(sendTerminalInput).not.toHaveBeenCalled()
  })

  it('keeps Claude as it was: 1 to allow, with no screen check', () => {
    answer(session('claude', { answerable: false }), 'y')
    expect(sendTerminalInput.mock.calls.map((call: unknown[]) => call[1] as string)).toEqual(['1'])
  })
})
