import { describe, expect, it } from 'vitest'
import { stepRows, unreachableKind, type StepFacts } from './addSteps'

const facts: StepFacts = { name: 'homelab', user: 'cydo', tookMs: 18, version: 'maiker 1.2.3', skipped: false }
const marks = (rows: ReturnType<typeof stepRows>) => rows.map((row) => row.mark)

describe('the four steps', () => {
  it('lists all four from the start, the first one running', () => {
    const rows = stepRows(facts, { stop: null, running: true })
    expect(marks(rows)).toEqual(['run', 'wait', 'wait', 'wait'])
    expect(rows[0]?.text).toBe('Looking for homelab…')
    expect(rows[1]?.text).toBe('Maiker uses your key. It never asks for or keeps passwords.')
  })

  it('marks the steps before a stop done and the stop as asking, with the rest waiting', () => {
    const rows = stepRows(facts, { stop: { step: 'setup', mark: 'needs' }, running: false })
    expect(marks(rows)).toEqual(['done', 'done', 'needs', 'wait'])
    expect(rows[0]?.text).toBe('Found it · answered in 18 ms')
    expect(rows[1]?.text).toBe('Logged in as cydo with your SSH key')
  })

  it('shows a failure where it happened', () => {
    expect(marks(stepRows(facts, { stop: { step: 'find', mark: 'bad' }, running: false }))).toEqual(['bad', 'wait', 'wait', 'wait'])
  })

  it('shows every step done when the look ran to its end', () => {
    const rows = stepRows(facts, { stop: null, running: false })
    expect(marks(rows)).toEqual(['done', 'done', 'done', 'done'])
    expect(rows[2]?.text).toBe('maiker 1.2.3 is already there')
    expect(rows[3]?.text).toBe('Linked to this computer')
  })

  it('says an install left for later was skipped', () => {
    const rows = stepRows({ ...facts, skipped: true, version: null }, { stop: null, running: false })
    expect(rows[2]?.text).toBe('Skipped · you can install it later from Remote machines')
  })
})

describe('why a computer could not be reached', () => {
  it('tells no answer, refused and an unknown name apart', () => {
    expect(unreachableKind('ssh: connect to host 10.9.9.9 port 22: Connection timed out')).toBe('no-answer')
    expect(unreachableKind('connect to host box port 22: Connection refused')).toBe('refused')
    expect(unreachableKind('ssh: Could not resolve hostname nope.example')).toBe('cannot-resolve')
    expect(unreachableKind('something else')).toBe('other')
  })
})
