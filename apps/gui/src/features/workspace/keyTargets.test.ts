import { afterEach, describe, expect, it } from 'vitest'
import { focusChatBox, focusSidebar, SESSION_ROW_ATTRIBUTE, sidebarRowOrder } from './keyTargets'

/** A window with a sidebar of `rows` and one pane per entry of `panes`, each with a chat box. */
function draw(rows: readonly string[], panes: readonly { focused?: boolean; kept?: boolean }[]): HTMLElement {
  const root = document.createElement('div')
  const sidebar = document.createElement('nav')
  sidebar.className = 'mx-sidebar'
  for (const id of rows) {
    const row = document.createElement('button')
    row.setAttribute(SESSION_ROW_ATTRIBUTE, id)
    sidebar.append(row)
  }
  root.append(sidebar)
  for (const pane of panes) {
    const card = document.createElement('div')
    card.className = `mx-pane${pane.focused ? ' is-focused' : ''}`
    if (pane.kept) card.setAttribute('inert', '')
    const box = document.createElement('textarea')
    box.className = 'mx-box-text'
    card.append(box)
    root.append(card)
  }
  document.body.append(root)
  return root
}

const boxes = (root: HTMLElement) => Array.from(root.querySelectorAll('textarea'))

afterEach(() => { document.body.replaceChildren() })

describe('what the go-to keys find on screen', () => {
  it('puts the keyboard in the focused pane\'s chat box, never one kept behind another tab', () => {
    const root = draw([], [{ kept: true }, {}, { focused: true }])
    expect(focusChatBox(root)).toBe(true)
    expect(boxes(root)[2]).toHaveFocus()
  })

  it('says so when no chat box is on screen', () => {
    expect(focusChatBox(draw([], [{ kept: true }]))).toBe(false)
    expect(focusChatBox(null)).toBe(false)
  })

  it('reads the sessions in the order the sidebar draws them, and none while it draws no row', () => {
    expect(sidebarRowOrder(draw(['b', 'a', 'c'], []))).toEqual(['b', 'a', 'c'])
    document.body.replaceChildren()
    expect(sidebarRowOrder(draw([], []))).toBeNull()
  })

  it('puts the keyboard on the row of the session in front', () => {
    const root = draw(['a', 'b'], [])
    const rows = Array.from(root.querySelectorAll('button'))
    rows[1]?.setAttribute('aria-current', 'page')
    expect(focusSidebar(root)).toBe(true)
    expect(rows[1]).toHaveFocus()
  })
})
