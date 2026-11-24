import { describe, expect, it } from 'vitest'
import type { ImportableChat } from '@/api/daemon'
import { groupByFolder, importKey, importStart, maybeOpenElsewhere, OPEN_ELSEWHERE_SECONDS, RECENT_SECONDS, tickedAtFirst } from './importChats'

const NOW = 2_000_000_000

function chat(agent: 'claude' | 'codex', id: string, folder: string, age: number): ImportableChat {
  return { agent, folder, saved: { id, first_message: `Task ${id}`, last_active: NOW - age } }
}

describe('bringing in chats', () => {
  it('starts each chat under its own name and last use, so the sidebar says which it is and how old', () => {
    const named: ImportableChat = { agent: 'claude', folder: '/code/app', saved: { id: 'a', first_message: 'Fix it', title: 'Login bug', last_active: NOW - 90 } }
    const plain: ImportableChat = { agent: 'codex', folder: '/code/api', saved: { id: 'b', first_message: 'Add it', last_active: NOW - 5 } }
    expect(importStart(named)).toMatchObject({ folder: '/code/app', agent: 'claude', resume: 'a', name: 'Login bug', lastActive: NOW - 90 })
    expect(importStart(plain)).toMatchObject({ resume: 'b', name: 'Add it', lastActive: NOW - 5 })
  })

  it('ticks the recent chats, but not old ones or one that may still be open in another terminal', () => {
    const recent = chat('claude', 'a', '/code/app', 3_600)
    const old = chat('codex', 'b', '/code/app', RECENT_SECONDS + 1)
    const live = chat('claude', 'c', '/code/api', OPEN_ELSEWHERE_SECONDS - 1)
    expect([...tickedAtFirst([recent, old, live], NOW)]).toEqual([importKey(recent)])
    expect(maybeOpenElsewhere(live, NOW)).toBe(true)
    expect(maybeOpenElsewhere(recent, NOW)).toBe(false)
  })

  it('keys a chat by its agent too, as two agents can use the same id', () => {
    expect(importKey(chat('claude', 'x', '/a', 0))).not.toBe(importKey(chat('codex', 'x', '/a', 0)))
  })

  it('groups by project in the order the newest chat of each came, keeping each one newest first', () => {
    const groups = groupByFolder([chat('claude', 'a', '/code/api', 1), chat('claude', 'b', '/code/app', 2), chat('codex', 'c', '/code/api', 3)])
    expect(groups.map((group) => [group.name, group.chats.map((each) => each.saved.id)])).toEqual([['api', ['a', 'c']], ['app', ['b']]])
  })
})
