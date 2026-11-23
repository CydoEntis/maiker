import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Conversation } from '@/data/preview'
import { toSessionView, type SessionView } from './model/session'
import { useSessionAlerts } from './useSessionAlerts'

const sound = vi.hoisted(() => ({ play: vi.fn() }))
vi.mock('@/data/notificationSound', () => ({ enableNotificationSound: vi.fn(), playNotificationSound: sound.play }))
vi.mock('@/features/notifications/notify', () => ({ showSessionNotice: vi.fn(), dismissSessionNotice: vi.fn() }))
vi.mock('@/features/notifications/native', () => ({ sendNativeNotice: vi.fn(() => Promise.resolve()) }))
vi.mock('@/api/daemon', () => ({ isDesktop: () => false, terminalOf: () => 1 }))

function chat(status: Conversation['status']): SessionView {
  return toSessionView(
    { id: 'c1', generation: 0, kind: 'conversation', execution: 'Structured', chat: { conversation: 1, generation: 0 }, title: 'Fix it', project: '', folder: '/w', cwd: '/w', repo: null, branch: 'main', provider: 'Claude', status, updated: null, model: '', permission: '', context: null, nativePane: null, hasDiff: false, agent: 'claude' } as unknown as Conversation,
    '/home/me',
  )
}

describe('a chat session alert', () => {
  it('rings the same tone a terminal session does when it starts needing you', () => {
    const props = (session: SessionView) => ({
      sessions: [session], sessionMap: new Map([[session.id, session]]), machines: new Map(), projectOf: new Map(), online: true, focusedId: null,
      preferences: { notifyNeedsYou: true, notifyFinished: true, notificationSound: true },
      showSessionById: vi.fn(), answerSession: vi.fn(), saidByOwnToast: () => false,
    })
    const { rerender } = renderHook((session: SessionView) => { useSessionAlerts(props(session)) }, { initialProps: chat('working') })
    expect(sound.play).not.toHaveBeenCalled()
    rerender(chat('needs-you'))
    expect(sound.play).toHaveBeenCalledTimes(1)
  })
})
