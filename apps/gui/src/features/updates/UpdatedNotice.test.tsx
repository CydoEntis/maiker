
import { beforeEach, describe, expect, it } from 'vitest'
import { markRestarting, takeRestarted } from './updateMemory'

const update = { version: '0.65.0', previous: '0.64.0', notes: '- Faster switching\n- Idle updates', automatic: true }

describe('update memory across a relaunch', () => {
  beforeEach(() => { localStorage.clear() })

  it('remembers the version, the one before it and the notes once', () => {
    markRestarting(update)
    expect(takeRestarted()).toEqual(update)
    expect(takeRestarted()).toBeNull()
  })

  it('reads the plain version an older launch stored', () => {
    localStorage.setItem('maiker.gui.update.restarted', '0.63.0')
    expect(takeRestarted()).toEqual({ version: '0.63.0', previous: null, notes: '', automatic: false })
  })
})
