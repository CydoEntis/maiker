import { describe, expect, it } from 'vitest'
import type { SessionView } from './session'
import { trayKey, traySessionsOf } from './traySessions'

const session = (id: string, status: SessionView['status'], title: string) => ({ id, status, title }) as SessionView

describe('what the tray menu lists', () => {
  it('is the sessions that need you and the ones that finished, by the name the sidebar shows', () => {
    const tray = traySessionsOf([session('t1', 'working', 'api'), session('t2', 'needs', 'web'), session('t3', 'done', 'docs'), session('t4', 'idle', 'x')])
    expect(tray.needs.map((item) => item.id)).toEqual(['t2'])
    expect(tray.finished.map((item) => item.id)).toEqual(['t3'])
    expect(tray.needs[0]?.label).not.toBe('')
  })

  it('lists no session that stopped, is held by its plan limit or is out of reach: none of them asks anything', () => {
    const tray = traySessionsOf([session('t1', 'error', 'api'), session('t2', 'limited', 'web'), session('t3', 'unknown', 'docs')])
    expect(tray).toEqual({ needs: [], finished: [] })
  })

  it('has a key that changes only when the menu would', () => {
    const before = traySessionsOf([session('t2', 'needs', 'web')])
    expect(trayKey(traySessionsOf([session('t2', 'needs', 'web'), session('t9', 'working', 'other')]))).toBe(trayKey(before))
    expect(trayKey(traySessionsOf([session('t2', 'done', 'web')]))).not.toBe(trayKey(before))
  })
})
