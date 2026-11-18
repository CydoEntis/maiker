import { describe, expect, it } from 'vitest'
import { activeArrangement, dropSession, EMPTY_LAYOUT, MAX_PANES, openArrangement, openDocumentBeside, parseLayout, removePane, removeSessions, setPaneHeights, showSession, splitPane, swapSessions, type Layout, type MakeId } from './layout'

function ids(): MakeId {
  let next = 0
  return (prefix) => `${prefix}${String((next += 1))}`
}

const chat = (makeId = ids()) => ({ layout: openArrangement(EMPTY_LAYOUT, 'chat', makeId), makeId })
const panesOf = (layout: Layout) => activeArrangement(layout)?.panes ?? []

describe('a document beside the chat', () => {
  it('opens in a new column to the right and takes the focus', () => {
    const { layout, makeId } = chat()
    const next = openDocumentBeside(layout, 'chat', 'README.md', makeId)
    const tab = next === null ? undefined : activeArrangement(next)
    expect(tab?.panes.map((pane) => [pane.sessionId, pane.col, pane.doc?.path])).toEqual([['chat', 0, undefined], ['chat', 1, 'README.md']])
    expect(tab?.panes.find((pane) => pane.id === tab.focus)?.doc?.path).toBe('README.md')
  })

  it('points the arrangement\'s document pane at the next file instead of adding another', () => {
    const { layout, makeId } = chat()
    const once = openDocumentBeside(layout, 'chat', 'README.md', makeId) ?? layout
    const twice = openDocumentBeside(once, 'chat', 'docs/setup.md', makeId) ?? layout
    expect(panesOf(twice).map((pane) => pane.doc?.path)).toEqual([undefined, 'docs/setup.md'])
  })

  it('says no when the window is full or the session is not shown', () => {
    const makeId = ids()
    let layout = openArrangement(EMPTY_LAYOUT, 'chat', makeId)
    for (let i = 1; i < MAX_PANES; i += 1) layout = splitPane(layout, null, 'right', `s${String(i)}`, makeId)
    expect(openDocumentBeside(layout, 'chat', 'README.md', makeId)).toBeNull()
    expect(openDocumentBeside(chat().layout, 'missing', 'README.md', makeId)).toBeNull()
  })

  it('is never what a click on its session finds, trades places, or is dropped on', () => {
    const { layout, makeId } = chat()
    const base = openDocumentBeside(layout, 'chat', 'README.md', makeId) ?? layout
    const docPane = panesOf(base).find((pane) => pane.doc)
    const chatPane = panesOf(base).find((pane) => !pane.doc)
    expect(docPane && chatPane).toBeTruthy()
    const shown = showSession(base, 'chat', makeId)
    expect(activeArrangement(shown)?.focus).toBe(chatPane?.id)
    expect(swapSessions(base, docPane?.id ?? '', chatPane?.id ?? '')).toBe(base)
    expect(dropSession(base, docPane?.id ?? '', 'other')).toBe(base)
  })

  it('goes with its session and alone when closed, and keeps its file through a resize and a reload', () => {
    const { layout, makeId } = chat()
    const base = openDocumentBeside(layout, 'chat', 'README.md', makeId) ?? layout
    const docPane = panesOf(base).find((pane) => pane.doc)
    expect(panesOf(removePane(base, docPane?.id ?? '')).map((pane) => pane.doc)).toEqual([undefined])
    expect(removeSessions(base, new Set(['chat'])).arrangements).toEqual([])
    const resized = setPaneHeights(base, activeArrangement(base)?.id ?? '', 1, [1])
    expect(panesOf(resized).find((pane) => pane.doc)?.doc?.path).toBe('README.md')
    expect(panesOf(parseLayout(JSON.parse(JSON.stringify(base)))).find((pane) => pane.doc)?.doc?.path).toBe('README.md')
  })

  it('drops a stored document with no path', () => {
    const stored = { arrangements: [{ id: 't', focus: 'p', max: null, panes: [{ id: 'p', sessionId: 's', col: 0, doc: { path: '' } }] }], activeId: 't' }
    expect(panesOf(parseLayout(stored))[0]?.doc).toBeUndefined()
  })
})
