import { describe, expect, it } from 'vitest'
import { permissionWords, placeChipsShown, workingLock } from './boxRow'
import { modeLabel } from './chatMeta'

describe('the words beside the shield', () => {
  it('says nothing on the mode the agent starts in', () => {
    expect(permissionWords('claude', 'default', modeLabel('default'))).toBeNull()
    expect(permissionWords('codex', 'codexAuto', modeLabel('codexAuto'))).toBeNull()
  })

  it('names any other mode', () => {
    expect(permissionWords('claude', 'plan', modeLabel('plan'))).toBe(modeLabel('plan'))
    expect(permissionWords('claude', 'bypassPermissions', modeLabel('bypassPermissions'))).not.toBeNull()
    // Claude's usual mode is not Codex's.
    expect(permissionWords('codex', 'default', modeLabel('default'))).not.toBeNull()
  })

  it('goes by the name when only the name is known, and says nothing before the agent has said a mode', () => {
    expect(permissionWords('claude', undefined, modeLabel('default'))).toBeNull()
    expect(permissionWords('claude', undefined, modeLabel('plan'))).toBe(modeLabel('plan'))
    expect(permissionWords('claude', null, null)).toBeNull()
  })
})

describe('the model lock', () => {
  it('holds only while the agent works, and gives the reason', () => {
    expect(workingLock('claude', false)).toBeNull()
    expect(workingLock('codex', true)).toMatch(/Codex/)
  })
})

describe('the chips under the chat box', () => {
  it('show on a draft and on a session that has run nothing', () => {
    expect(placeChipsShown({ picking: {} }, false)).toBe(true)
    expect(placeChipsShown({ picking: {} }, true)).toBe(true)
    expect(placeChipsShown({}, false)).toBe(true)
  })

  it('are gone once the session has run, and where the place is not known', () => {
    expect(placeChipsShown({}, true)).toBe(false)
    expect(placeChipsShown(undefined, false)).toBe(false)
  })
})
