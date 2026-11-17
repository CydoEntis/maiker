import { describe, expect, it } from 'vitest'
import { heldAgain, letGoOf, NO_LET_GO, oneLeft, shownQueued, stillLetGo } from './letGo'

describe('queued messages a box let go of', () => {
  it('hides only the one taken back when two say the same', () => {
    const queued = ['yes', 'yes']
    const letGo = letGoOf(NO_LET_GO, queued, 'yes')
    expect(shownQueued(queued, letGo)).toEqual([{ index: 1, text: 'yes' }])
  })

  it('forgets each one only once the pane has let go of it', () => {
    let letGo = letGoOf(NO_LET_GO, ['a', 'a'], 'a')
    letGo = letGoOf(letGo, ['a', 'a'], 'a')
    expect(shownQueued(['a', 'a'], letGo)).toEqual([])
    letGo = stillLetGo(letGo, ['a'])
    expect(letGo).toHaveLength(1)
    expect(shownQueued(['a'], letGo)).toEqual([])
    expect(stillLetGo(letGo, [])).toEqual([])
  })

  it('shows the same words queued again later', () => {
    const letGo = stillLetGo(letGoOf(NO_LET_GO, ['go'], 'go'), [])
    expect(shownQueued(['go'], letGo)).toEqual([{ index: 0, text: 'go' }])
  })

  it('puts back one the daemon would not let go of', () => {
    const letGo = heldAgain(letGoOf(NO_LET_GO, ['x', 'x'], 'x'), 'x')
    expect(shownQueued(['x', 'x'], letGo)).toHaveLength(2)
  })
})

describe('a message leaving the pane queue', () => {
  it('is the daemon typing it in only when it was first', () => {
    expect(oneLeft(['a', 'b'], ['b'])).toEqual({ text: 'a', first: true })
    expect(oneLeft(['a', 'b', 'c'], ['a', 'c'])).toEqual({ text: 'b', first: false })
    expect(oneLeft(['a', 'b'], ['a'])).toEqual({ text: 'b', first: false })
  })

  it('is nothing to say when more than one changed', () => {
    expect(oneLeft(['a', 'b', 'c'], ['c'])).toBeNull()
    expect(oneLeft(['a'], ['a'])).toBeNull()
    expect(oneLeft(['a', 'b'], ['x'])).toBeNull()
  })
})
