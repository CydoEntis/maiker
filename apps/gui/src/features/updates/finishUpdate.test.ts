import { describe, expect, it } from 'vitest'
import { serviceStep } from './finishUpdate'

const base = { afterAppUpdate: false, restartWhenIdle: false, canRestart: true, activeTurnCount: 0 }

describe('finishing the service after an update', () => {
  it('restarts the service as part of an app update, with no second question, once no agent is at work', () => {
    expect(serviceStep({ ...base, afterAppUpdate: true })).toBe('restart')
    expect(serviceStep({ ...base, afterAppUpdate: true, activeTurnCount: 2 })).toBe('wait')
  })

  it('asks when the service cannot be restarted with nothing lost, or cannot say who is working', () => {
    expect(serviceStep({ ...base, afterAppUpdate: true, canRestart: false })).toBe('ask')
    expect(serviceStep({ ...base, afterAppUpdate: true, activeTurnCount: null })).toBe('ask')
  })

  it('outside an app update, restarts unasked only under Install updates when idle', () => {
    expect(serviceStep(base)).toBe('ask')
    expect(serviceStep({ ...base, restartWhenIdle: true })).toBe('restart')
    expect(serviceStep({ ...base, restartWhenIdle: true, activeTurnCount: 1 })).toBe('ask')
  })
})
