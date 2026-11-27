import { describe, expect, it, vi } from 'vitest'
import { contextFull, problemWords } from './problem'

describe('what makes a problem', () => {
  it('counts a context as full from 95%, and not before or when unreported', () => {
    expect(contextFull({ context: 94.4, limits: [] })).toBeNull()
    expect(contextFull({ context: 95, limits: [] })).toBe(95)
    expect(contextFull({ context: null, limits: [] })).toBeNull()
    expect(contextFull(undefined)).toBeNull()
  })

  it('says why a stopped agent was stopped in plain words, and keeps the code for Copy details', () => {
    const words = problemWords({ kind: 'stopped', agent: 'Claude', code: 137, onRestart: vi.fn() }, 0)
    expect(words.line).toMatch(/^Claude stopped in the middle of a step\. The system stopped it, most often because the computer ran out of memory\./)
    expect(words.details).toContain('(exit code 137)')
  })

  it('says a machine on another version needs an update, not that it stopped answering', () => {
    const machine = { kind: 'machine' as const, machine: 'kingdom', since: null, onRetry: vi.fn() }
    expect(problemWords({ ...machine, update: { word: 'needs update', onUpdate: vi.fn() } }, 0)).toMatchObject({ title: 'kingdom needs update', reason: expect.stringContaining('runs another version of Maiker') as unknown })
    expect(problemWords({ ...machine, update: { word: 'newer than this app', onUpdate: null } }, 0).reason).toContain('until this app is updated')
    expect(problemWords(machine, 0).title).toBe('kingdom stopped answering')
  })
})
