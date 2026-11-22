import { describe, expect, it } from 'vitest'
import { agentsSummary, relativePath, todoProgress } from './stepInfo'
import { subagentEvent, todoEvent } from './eventFixtures'

describe('relativePath', () => {
  it.each([
    ['/repo/src/a.ts', '/repo', 'src/a.ts'],
    ['/repo/src/a.ts', '/repo/', 'src/a.ts'],
    ['C:\\Work\\app\\src\\a.ts', 'c:\\work\\app', 'src/a.ts'],
    ['/other/a.ts', '/repo', '/other/a.ts'],
    ['/repository/a.ts', '/repo', '/repository/a.ts'],
    ['/Repo/a.ts', '/repo', '/Repo/a.ts'],
    ['src/a.ts', '/repo', 'src/a.ts'],
    ['/repo/a.ts', null, '/repo/a.ts'],
  ])('%s under %s -> %s', (file, root, expected) => {
    expect(relativePath(file, root)).toBe(expected)
  })
})

describe('step descriptions and summaries', () => {

  it('counts checklist progress and helper agents', () => {
    const list = todoEvent('d', [{ text: 'a', state: 'done' }, { text: 'b', state: 'current' }, { text: 'c', state: 'pending' }])
    expect(todoProgress(list.items ?? [])).toEqual({ done: 1, total: 3 })
    expect(agentsSummary([subagentEvent('1', { status: 'running' }), subagentEvent('2')])).toBe('2 agents, 1 working')
    expect(agentsSummary([subagentEvent('1')])).toBe('1 agent, all done')
  })
})
