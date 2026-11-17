import { describe, expect, it } from 'vitest'
import type { Extension } from '@/api/extensions'
import { detailLine, itemKey, itemsOf, scopesFor } from './model'

const item = (over: Partial<Extension>): Extension => ({ agent: 'Claude', kind: 'Plugin', scope: 'User', id: 'a@b', name: 'a', detail: '', enabled: true, ...over })

describe('the extensions page model', () => {
  it('lists one agent and kind, the user\'s before the project\'s, then by name', () => {
    const items = [item({ name: 'zed', scope: 'Project' }), item({ name: 'beta' }), item({ name: 'alpha' }), item({ agent: 'Codex', name: 'other' }), item({ kind: 'Skill', name: 'skill' })]
    expect(itemsOf(items, 'Claude', 'Plugin').map((each) => each.name)).toEqual(['alpha', 'beta', 'zed'])
  })

  it('tells the same plugin at two scopes apart', () => {
    expect(itemKey(item({}))).not.toBe(itemKey(item({ scope: 'Project' })))
  })

  it('offers Codex and marketplaces the user\'s scope only', () => {
    expect(scopesFor('Codex', 'Plugin')).toEqual(['User'])
    expect(scopesFor('Claude', 'Marketplace')).toEqual(['User'])
    expect(scopesFor('Claude', 'McpServer')).toEqual(['User', 'Project', 'Local'])
  })

  it('says where a project item applies and leaves the user\'s unsaid', () => {
    expect(detailLine({ kind: 'Plugin', scope: 'User', detail: 'version 1.0.0' })).toBe('version 1.0.0')
    expect(detailLine({ kind: 'McpServer', scope: 'Project', detail: 'https://x' })).toBe('https://x · in this project')
    expect(detailLine({ kind: 'Skill', scope: 'Local', detail: '' })).toBe('in this project, only on this computer')
  })
})
