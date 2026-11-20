import { describe, expect, it } from 'vitest'
import { outputSegments } from './commandOutput'

const SUITE = '✓ total.test.ts > adds items (3)\n✗ total.test.ts > empty coupon\n  expected NaN to be 84\n\nTests  2 failed | 9 passed (11)'

describe('what a command printed, in colour', () => {
  it('keeps every word and line of the output', () => {
    expect(outputSegments(SUITE).map((run) => run.text).join('')).toBe(SUITE)
  })

  it('marks a passing line green and a failing line and its reason red', () => {
    const runs = outputSegments(SUITE)
    expect(runs.find((run) => run.tone === 'pass' && run.text === '✓')).toBeDefined()
    expect(runs.find((run) => run.tone === 'fail' && run.text === '✗')).toBeDefined()
    expect(runs.find((run) => run.tone === 'error')?.text).toBe('  expected NaN to be 84\n')
  })

  it('colours the counts in the summary line and nothing else on it', () => {
    const runs = outputSegments('Tests  2 failed | 9 passed (11)')
    expect(runs.filter((run) => run.tone === 'fail').map((run) => run.text)).toEqual(['2 failed'])
    expect(runs.filter((run) => run.tone === 'pass').map((run) => run.text)).toEqual(['9 passed'])
    expect(runs[0]).toEqual({ text: 'Tests', tone: 'label' })
  })

  it('leaves ordinary output plain, as one run', () => {
    expect(outputSegments('changed 3 packages\n\nfound 0 vulnerabilities')).toEqual([{ text: 'changed 3 packages\n\nfound 0 vulnerabilities', tone: 'plain' }])
  })
})
