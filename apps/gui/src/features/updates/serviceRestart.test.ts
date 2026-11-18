import { describe, expect, it } from 'vitest'
import { serviceRestartStep, type ServiceRestartReading } from './serviceRestart'

const quiet: ServiceRestartReading = {
  enabled: true,
  restarting: false,
  starting: false,
  service: { canRestart: true, activeTurnCount: 0 },
  sessionStatuses: ['idle', 'done'],
}
const step = (change: Partial<ServiceRestartReading>) => serviceRestartStep({ ...quiet, ...change })

describe('when an older service may restart by itself', () => {
  it('does nothing while the setting is off, however quiet it is', () => {
    expect(step({ enabled: false })).toBe('off')
  })

  it('restarts when nothing is working, waiting, starting or restarting', () => {
    expect(step({})).toBe('restart')
    expect(step({ sessionStatuses: [] })).toBe('restart')
  })

  it('restarts from the service count alone when the sessions cannot be read', () => {
    expect(step({ sessionStatuses: null })).toBe('restart')
  })

  it.each(['working', 'needs-you', 'recovery', 'unknown'])('waits while a session is %s', (status) => {
    expect(step({ sessionStatuses: ['idle', status] })).toBe('wait')
  })

  it('waits while the service counts an agent working or waiting', () => {
    expect(step({ service: { canRestart: true, activeTurnCount: 2 } })).toBe('wait')
  })

  it('waits when the service cannot say how many agents are busy', () => {
    expect(step({ service: { canRestart: true, activeTurnCount: null } })).toBe('wait')
  })

  it('waits when the service has not answered, or its sessions are not saved', () => {
    expect(step({ service: undefined })).toBe('wait')
    expect(step({ service: { canRestart: false, activeTurnCount: 0 } })).toBe('wait')
  })

  it('waits while a session is starting or a restart is already running', () => {
    expect(step({ starting: true })).toBe('wait')
    expect(step({ restarting: true })).toBe('wait')
  })
})
