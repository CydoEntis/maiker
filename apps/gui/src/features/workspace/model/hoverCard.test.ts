import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/data/preview'
import { HOVER_CARD_WIDTH_PX, hoverCardText, placeHoverCard } from './hoverCard'
import { toSessionView } from './session'

describe('where the hover card goes', () => {
  it('sits to the right of the row, 4px above it, for a row in the upper half', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 200, bottom: 240 }, 1400, 900)).toEqual({ left: 288, top: 196 })
  })

  it('stands on the row, growing up, for a row in the lower half, so it never runs past the window', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 800, bottom: 840 }, 1400, 900)).toEqual({ left: 288, bottom: 56 })
  })

  it('keeps 8px from the window edge', () => {
    expect(placeHoverCard({ left: 20, right: 280, top: 2, bottom: 40 }, 1400, 900)).toEqual({ left: 288, top: 8 })
    expect(placeHoverCard({ left: 20, right: 280, top: 860, bottom: 899 }, 1400, 900)).toEqual({ left: 288, bottom: 8 })
  })

  it('goes to the left of a sidebar that is on the right', () => {
    expect(placeHoverCard({ left: 1120, right: 1380, top: 200, bottom: 240 }, 1400, 900).left).toBe(1120 - 8 - HOVER_CARD_WIDTH_PX)
  })
})

function view(extra: Partial<Conversation> = {}) {
  return toSessionView(
    { id: 't1', generation: 0, kind: 'terminal', title: '', project: '', folder: '/home/me/app', cwd: '/home/me/app', repo: 'app', branch: 'feat/x', provider: 'Claude', status: 'working', updated: null, model: '', permission: '', context: null, nativePane: 1, hasDiff: false, agent: 'claude', summary: 'Upgrade React', ...extra },
    '/home/me',
  )
}

describe('what the hover card says', () => {
  it('names the project, the branch, the line changes and where the agent runs', () => {
    const text = hoverCardText({ ...view(), diffAdded: 12, diffRemoved: 3 }, 'Upgrade to React 19', true)
    expect(text).toMatchObject({ title: 'Upgrade to React 19', activity: 'Upgrade React', folder: { text: 'app', mono: false, ownWorktree: false }, branch: 'feat/x', changes: { added: 12, removed: 3 }, pr: null, who: 'Claude · This computer' })
  })

  it('tags a branch that has a worktree of its own', () => {
    expect(hoverCardText({ ...view(), worktree: true }, 'x', true).folder.ownWorktree).toBe(true)
  })

  it('falls back to the status word when the session said nothing, and leaves the changes out when none', () => {
    const text = hoverCardText(view({ summary: '' }), 'x', true)
    expect(text.activity).toBeNull()
    expect(text.word).toBe('Working')
    expect(text.changes).toBeNull()
  })

  it('shows a shell by its working directory and gives it no branch row', () => {
    const text = hoverCardText(view({ agent: null, process: 'zsh' }), 'zsh', true)
    expect(text.folder).toMatchObject({ text: '~/app', mono: true })
    expect(text.branch).toBeNull()
    expect(text.activity).toBeNull()
  })
})
