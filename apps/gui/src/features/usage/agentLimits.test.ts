import { describe, expect, it } from 'vitest'
import { agentUsages } from './agentLimits'

const NOW = 1_000_000
const limit = (name: string, used: number, resetsAt = NOW + 3600) => ({ name, used, resetsAt })

describe('agentUsages', () => {
  it('shows the limit closest to full for each agent', () => {
    const [claude] = agentUsages([{ process: 'claude', limits: [limit('5h', 30), limit('week', 62)] }], {}, NOW)
    expect(claude?.tightest).toMatchObject({ window: 'week', percent: 62 })
    expect(claude?.items).toHaveLength(2)
  })

  it('leaves out the 5-hour limit on Claude Max, which has none', () => {
    const [claude] = agentUsages([{ process: 'claude', limits: [limit('5h', 90), limit('week', 40)] }], { claude: 'Max' }, NOW)
    expect(claude?.tightest).toMatchObject({ window: 'week', percent: 40 })
    expect(claude?.items.map((item) => item.window)).toEqual(['week'])
  })

  it('keeps the 5-hour limit on a plan that has it', () => {
    const [claude] = agentUsages([{ process: 'claude', limits: [limit('5h', 90), limit('week', 40)] }], { claude: 'pro' }, NOW)
    expect(claude?.tightest).toMatchObject({ window: '5h', percent: 90 })
  })

  it('leaves out an agent that has reported nothing, and shells', () => {
    const usages = agentUsages([{ process: 'gemini', limits: [] }, { process: 'shell', limits: [] }, { process: 'codex', limits: [limit('week', 10)] }], {}, NOW)
    expect(usages.map((usage) => usage.agent)).toEqual(['codex'])
  })

  it('takes each window from the session that reported it last', () => {
    const [claude] = agentUsages([
      { process: 'claude', limits: [limit('week', 20, NOW + 100)] },
      { process: 'claude', limits: [limit('week', 25, NOW + 900)] },
    ], {}, NOW)
    expect(claude?.tightest.percent).toBe(25)
  })
})
