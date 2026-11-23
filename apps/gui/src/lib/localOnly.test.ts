import { describe, expect, it } from 'vitest'
import { assertLocal, guardLocal, LOCAL_FEATURES, type LocalFeature } from './localOnly'

const FEATURES = Object.keys(LOCAL_FEATURES) as LocalFeature[]
const remote = { machine: 2, machineName: 'build' }
const here = { machine: 0, machineName: null }

describe('features that need a pane\'s files', () => {
  it.each(FEATURES)('%s is refused for a pane of another machine and allowed here', (feature) => {
    expect(guardLocal(remote, feature)).toBe(`${LOCAL_FEATURES[feature]} is local-only in v1: the files are on build, not on this computer.`)
    expect(guardLocal(here, feature)).toBeNull()
    expect(guardLocal(undefined, feature)).toBeNull()
    expect(() => { assertLocal(remote, feature) }).toThrow(/local-only in v1/)
    expect(() => { assertLocal(here, feature) }).not.toThrow()
  })

})
