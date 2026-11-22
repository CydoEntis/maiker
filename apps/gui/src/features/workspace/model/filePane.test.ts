import { describe, expect, it } from 'vitest'
import { openFileOf, panelPlacement } from './filePane'
import { activeArrangement, openArrangement, openDocumentBeside, toggleMaximize, type Layout } from './layout'

const ids = () => { let next = 0; return (prefix: string) => `${prefix}${String(next++)}` }

function withFile(): Layout {
  const makeId = ids()
  const opened = openArrangement({ arrangements: [], activeId: null }, 'chat', makeId)
  return openDocumentBeside(opened, 'chat', 'src/a.ts', makeId, { mode: 'changes', key: 1 }) ?? opened
}

describe('the file pane and the side panel', () => {
  it('floats the panel over the file pane while a file is open, and docks it beside the main pane otherwise', () => {
    expect(panelPlacement(false, false)).toBe('docked')
    expect(panelPlacement(true, false)).toBe('floating')
  })

  it('floats the panel in a narrow window, which has no room beside the pane', () => {
    expect(panelPlacement(false, true)).toBe('floating')
  })

  it('names the file a session’s file pane shows, with what it was asked to open as', () => {
    const shown = activeArrangement(withFile())
    expect(openFileOf(shown, 'chat')).toBe('src/a.ts')
    expect(shown?.panes.find((pane) => pane.doc)?.doc?.ask?.mode).toBe('changes')
    expect(openFileOf(shown, 'other')).toBeNull()
    expect(openFileOf(undefined, 'chat')).toBeNull()
  })

  it('counts no file as open while the session’s own pane is maximised over it', () => {
    const layout = withFile()
    const session = activeArrangement(layout)?.panes.find((pane) => !pane.doc)
    const maximised = toggleMaximize(layout, session?.id ?? '')
    expect(openFileOf(activeArrangement(maximised), 'chat')).toBeNull()
  })
})
