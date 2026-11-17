import { describe, expect, it } from 'vitest'
import { buildRows } from './chatRows'
import { lastReply, permissionsCard, statusCard, transcriptMarkdown, type StatusFacts } from './commandCards'
import { CODEX_START_MODES } from './chatMeta'
import { messageEvent } from './eventFixtures'

const facts: StatusFacts = { agent: 'claude', model: 'opus', effort: 'high', mode: 'plan', folder: '/home/me/app', usage: undefined, now: 0, working: false, online: true }

describe('the status card', () => {
  it('says the agent, model, effort, mode, folder and what it is doing now', () => {
    expect(statusCard(facts)).toBe([
      '- **Agent:** Claude',
      '- **Model:** `opus`, effort high',
      '- **Permissions:** Plan mode',
      '- **Folder:** `/home/me/app`',
      '- **Now:** waiting for you',
    ].join('\n'))
  })

  it('says what the agent has not reported instead of a made-up value', () => {
    const card = statusCard({ ...facts, agent: 'codex', model: null, effort: null, mode: null, folder: null, working: true })

    expect(card).toContain('- **Model:** not reported yet')
    expect(card).toContain('- **Permissions:** not reported yet')
    expect(card).toContain('- **Folder:** not reported yet')
    expect(card).toContain('- **Now:** working')
  })

  it('lists the context and plan limits the agent reported, with when a limit starts over', () => {
    const usage = { context: 42, limits: [{ name: '5h', used: 30, resetsAt: 7200 }] }

    const card = statusCard({ ...facts, usage, now: 0 })

    expect(card).toContain('- **Context:** 42% used')
    expect(card).toContain('- **5-hour limit:** 30% used, starts over in 2h')
    expect(card).toContain('- **Weekly limit:** not reported yet')
  })

  it('cannot be cut short by a backtick in a folder name', () => {
    expect(statusCard({ ...facts, folder: '/home/me/we`ird' })).toContain("`/home/me/we'ird`")
  })

  it('says the daemon is offline rather than idle', () => {
    expect(statusCard({ ...facts, online: false })).toContain('the daemon is offline')
  })
})

describe('the permissions card', () => {
  it('marks the current mode, says what each does, and says Maitty changes none of them', () => {
    const card = permissionsCard('codex', 'codexAuto', CODEX_START_MODES)

    expect(card).toContain('Codex is set to **Auto**')
    expect(card).toContain('- **Read only**: Reads files and answers.')
    expect(card).toContain('- **Auto** (now): Follows your Codex settings')
    expect(card).toContain('- **Full access**: Changes any file')
    expect(card).toContain('Maitty never changes it for you.')
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
