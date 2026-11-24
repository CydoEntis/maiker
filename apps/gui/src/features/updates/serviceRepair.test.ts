import { describe, expect, it } from 'vitest'
import type { LocalServiceReport } from '@/api/daemon'
import { canOfferRestart, restartCopy, serviceState } from './serviceRepair'

const report: LocalServiceReport = { appVersion: '0.84.0', running: true, daemonVersion: '0.83.0', fileVersion: '0.84.0', behind: true, fileBehind: false, canRestart: true, sessionCount: 3, activeTurnCount: 1 }

describe('the state of the service', () => {
  it.each([
    [{ running: false }, 'not-running'],
    [{ behind: true }, 'behind'],
    [{ behind: false, fileBehind: true }, 'file-behind'],
    [{ behind: false }, 'current'],
  ])('%j reads as %s', (change, state) => {
    expect(serviceState({ ...report, ...change })).toBe(state)
  })
})

describe('what a restart says before it runs', () => {
  it('says the chats are saved, a turn stops, they come back asleep and how to resume them', () => {
    const copy = restartCopy(report, false)
    expect(copy.title).toBe('Restart the Maiker service?')
    expect(copy.lines).toEqual([
      'Your 3 chats are saved.',
      '1 turn in progress will stop.',
      'Chats come back asleep. After the restart you can press Resume 3 chats.',
    ])
    expect(copy.confirm).toBe('Restart service')
  })

  it('says nothing is working and nothing is open when that is so', () => {
    expect(restartCopy({ ...report, sessionCount: 0, activeTurnCount: 0 }, false).lines).toEqual(['No chats are open.', 'No chat is working right now.'])
  })

  it('owns up when the service cannot say who is working', () => {
    expect(restartCopy({ ...report, activeTurnCount: null }, false).lines[1]).toMatch(/cannot say which chats are working/)
  })

  it('refuses to promise saved chats when they are not, and points at Force update', () => {
    const copy = restartCopy({ ...report, canRestart: false }, false)
    expect(copy.lines[0]).toMatch(/not saved, so Maiker will not restart it/)
    expect(canOfferRestart({ ...report, canRestart: false })).toBe(false)
  })

  it('a force update says it can lose unsaved chats and ends the process when asking fails', () => {
    const copy = restartCopy({ ...report, canRestart: false }, true)
    expect(copy.title).toBe('Force update the Maiker service?')
    expect(copy.confirm).toBe('Force update')
    expect(copy.lines[0]).toMatch(/cannot confirm .* saved. Going on can lose 3 chats/)
    expect(copy.lines.at(-1)).toMatch(/ends its process/)
  })

  it('starting a service that is not running says nothing is lost', () => {
    const copy = restartCopy({ ...report, running: false }, false)
    expect(copy.title).toBe('Start the Maiker service?')
    expect(copy.lines[0]).toMatch(/no chat is working/)
  })
})
