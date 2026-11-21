import { describe, expect, it, vi } from 'vitest'
import { agoWords, contextFull, exitWords, problemWords } from './problem'

describe('what makes a problem', () => {
  it('counts a context as full from 95%, and not before or when unreported', () => {
    expect(contextFull({ context: 94.4, limits: [] })).toBeNull()
    expect(contextFull({ context: 95, limits: [] })).toBe(95)
    expect(contextFull({ context: null, limits: [] })).toBeNull()
    expect(contextFull(undefined)).toBeNull()
  })

  it('tells a time and an exit in words', () => {
    expect(agoWords(null, 5)).toBeNull()
    expect(agoWords(1000, 41_000)).toBe('40s')
    expect(agoWords(0, 180_000)).toBe('3m')
    expect(exitWords(1)).toBe('Its process ended with an error (exit code 1).')
    expect(exitWords(null)).toBe('Its process ended.')
  })

  it('says why a stopped agent was stopped in plain words, and keeps the code for Copy details', () => {
    const words = problemWords({ kind: 'stopped', agent: 'Claude', code: 137, onRestart: vi.fn() }, 0)
    expect(words.reason).toMatch(/^Claude stopped in the middle of a step\. The system stopped it, most often because the computer ran out of memory\./)
    expect(words.reason).toMatch(/Restart to carry on from the last message\.$/)
    expect(words.details).toContain('(exit code 137)')
  })

  it('names a plain exit code in the reason', () => {
    const words = problemWords({ kind: 'stopped', agent: 'Codex', code: 1, onRestart: null }, 0)
    expect(words.reason).toMatch(/^Codex exited with code 1 in the middle of a step\./)
  })

  it('points to where the reason is: a restart, or for a chat with no terminal the line under its box', () => {
    const stopped = (onRestart: (() => void) | null) => problemWords({ kind: 'stopped', agent: 'Claude', code: null, onRestart }, 0).reason
    expect(stopped(vi.fn())).toContain('Restart to carry on from the last message.')
    expect(stopped(null)).toContain('The reason is under the message box.')
    expect(stopped(null)).not.toContain('terminal')
  })
})
