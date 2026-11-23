import { describe, expect, it } from 'vitest'
import type { ChatEvent, ItemFields } from './chatEvents'
import { countUserMessages, describeWork } from './workPhase'

const fields = (id: string, status: ItemFields['status'] = 'running'): ItemFields => ({
  id,
  turnId: 't1',
  status,
  observed: { firstSeenAtMs: 0 } as ItemFields['observed'],
  timing: { startedAtMs: null, completedAtMs: null },
})

const tool = (id: string, name: string, target: string | null, status: ItemFields['status'] = 'running'): ChatEvent =>
  ({ ...fields(id, status), kind: 'tool', name, target, input: null, detail: '' })
const user = (id: string, text: string): ChatEvent => ({ ...fields(id, 'completed'), kind: 'message', role: 'user', text })

describe('what the working line says', () => {
  it('says thinking when no step is running', () => {
    expect(describeWork([], null)).toBe('thinking')
    expect(describeWork([tool('a', 'Read', 'src/a.ts', 'completed')], null)).toBe('thinking')
  })

  it('names what a running tool is doing and what it acts on', () => {
    expect(describeWork([tool('a', 'Read', '/work/src/app.ts')], '/work')).toBe('reading src/app.ts')
    expect(describeWork([tool('a', 'Grep', 'TODO')], null)).toBe('searching TODO')
    expect(describeWork([tool('a', 'Frobnicate', null)], null)).toBe('using Frobnicate')
  })

  it('reports the newest step still running, not an older one', () => {
    const events = [tool('a', 'Read', 'old.ts'), tool('b', 'Read', 'new.ts')]
    expect(describeWork(events, null)).toBe('reading new.ts')
  })
})

describe('telling a message just sent from the same words said before', () => {
  it('counts the person\'s messages that hold those words', () => {
    const events = [user('a', 'hello'), user('b', ' hello '), user('c', 'say goodbye')]
    expect(countUserMessages(events, 'hello')).toBe(2)
    expect(countUserMessages(events, 'goodbye')).toBe(1)
    expect(countUserMessages(events, 'farewell')).toBe(0)
  })

  it('counts a message whose spacing came back different from what was typed', () => {
    const events = [user('a', 'first\nsecond  third')]
    expect(countUserMessages(events, 'first\r\nsecond\t\tthird')).toBe(1)
  })

  it('counts a message the agent took as part of one sent before it', () => {
    const events = [user('a', 'set it up\nthen go over the integrations')]
    expect(countUserMessages(events, 'then go over the integrations')).toBe(1)
  })
})
