import { describe, expect, it } from 'vitest'
import { buildRows } from './chatRows'
import { lastReply, statusCard, transcriptMarkdown, type StatusFacts } from './commandCards'
import { messageEvent } from './eventFixtures'

const facts: StatusFacts = { agent: 'claude', model: 'opus', effort: 'high', mode: 'plan', folder: '/home/me/app', usage: undefined, now: 0, working: false, online: true }

describe('the status card', () => {

  it('says what the agent has not reported instead of a made-up value', () => {
    const card = statusCard({ ...facts, agent: 'codex', model: null, effort: null, mode: null, folder: null, working: true })

    expect(card).toContain('- **Model:** not reported yet')
    expect(card).toContain('- **Permissions:** not reported yet')
    expect(card).toContain('- **Folder:** not reported yet')
    expect(card).toContain('- **Now:** working')
  })

  it('cannot be cut short by a backtick in a folder name', () => {
    expect(statusCard({ ...facts, folder: '/home/me/we`ird' })).toContain("`/home/me/we'ird`")
  })

  it('says the daemon is offline rather than idle', () => {
    expect(statusCard({ ...facts, online: false })).toContain('the Maiker service is offline')
  })
})

describe('the conversation as the box commands use it', () => {
  const rows = buildRows([messageEvent('u1', 'user', 'fix it'), messageEvent('a1', 'agent', 'First.\n\nSecond.'), messageEvent('u2', 'user', 'thanks'), messageEvent('a2', 'agent', 'Welcome.')], false)

  it('copies the last thing the agent said', () => {
    expect(lastReply(rows)).toBe('Welcome.')
    expect(lastReply(buildRows([messageEvent('u1', 'user', 'hi')], false))).toBeNull()
  })

  it('writes the conversation out as Markdown, in order, and nothing when there is none', () => {
    expect(transcriptMarkdown(rows, 'claude')).toBe('## You\n\nfix it\n\n## Claude\n\nFirst.\n\nSecond.\n\n## You\n\nthanks\n\n## Claude\n\nWelcome.\n')
    expect(transcriptMarkdown([], 'claude')).toBeNull()
  })
})
