import { beforeEach, describe, expect, it } from 'vitest'
import { closeOtherTabs, closeTab, EMPTY_PANEL, livePanel, openTab, panelTabsOf, pinTerminal, showTab, tabOf, terminalTabIds, unpinTerminal, withPinned, type PanelTabs } from './panelTabs'
import { readPanelTabs, writePanelTabs } from './panelTabsStorage'

const ids = (panel: PanelTabs) => panel.tabs.map((tab) => tab.id)

/** Files and Changes, with Changes in front. */
const full = (): PanelTabs => openTab(openTab(EMPTY_PANEL, tabOf('files')), tabOf('changes'))

describe('the side panel’s tabs', () => {
  it('opens a surface in front, and brings an open Files or Changes forward instead of opening it twice', () => {
    const files = openTab(EMPTY_PANEL, tabOf('files'))
    const both = openTab(files, tabOf('changes'))
    expect(ids(both)).toEqual(['files', 'changes'])
    expect(both.active).toBe('changes')
    const again = openTab(both, tabOf('files'))
    expect(ids(again)).toEqual(['files', 'changes'])
    expect(again.active).toBe('files')
  })

  it('holds several terminals, each a tab of its own', () => {
    const panel = openTab(openTab(EMPTY_PANEL, tabOf('terminal', 't1')), tabOf('terminal', 't2'))
    expect(terminalTabIds(panel)).toEqual(['t1', 't2'])
    expect(panel.active).toBe('t2')
  })

  it('shows a tab it has and ignores one it has not', () => {
    const panel = full()
    expect(showTab(panel, 'files').active).toBe('files')
    expect(showTab(panel, 'gone')).toBe(panel)
  })

  it('closes a tab and shows the one that took its place, or the last one', () => {
    const panel = openTab(full(), tabOf('terminal', 't1'))
    // The one in front closes: the last tab left shows.
    expect(closeTab(panel, 't1')).toMatchObject({ active: 'changes' })
    // A tab before the one in front closes: the same tab stays in front.
    expect(closeTab(panel, 'files')).toMatchObject({ active: 't1' })
    const inFront = showTab(panel, 'files')
    expect(closeTab(inFront, 'files').active).toBe('changes')
    expect(closeTab(closeTab(closeTab(panel, 'files'), 'changes'), 't1')).toEqual(EMPTY_PANEL)
  })

  it('closes the others and keeps the one asked for in front', () => {
    const panel = openTab(full(), tabOf('terminal', 't1'))
    const alone = closeOtherTabs(panel, 'changes')
    expect(ids(alone)).toEqual(['changes'])
    expect(alone.active).toBe('changes')
  })

  it('pins a terminal to the bottom, which takes its tab away, and moves it back as a tab in front', () => {
    const panel = openTab(full(), tabOf('terminal', 't1'))
    const pinned = pinTerminal(panel, 't1')
    expect(ids(pinned)).toEqual(['files', 'changes'])
    expect(pinned.pinned).toEqual(['t1'])
    expect(pinned.active).toBe('changes')
    const back = unpinTerminal(pinned, 't1')
    expect(ids(back)).toEqual(['files', 'changes', 't1'])
    expect(back.pinned).toEqual([])
    expect(back.active).toBe('t1')
  })

  it('pins only a terminal, and unpins only what is pinned', () => {
    const panel = full()
    expect(pinTerminal(panel, 'files')).toBe(panel)
    expect(unpinTerminal(panel, 't9')).toBe(panel)
  })

  it('takes a terminal started at the bottom as pinned, never as a tab too', () => {
    const panel = withPinned(full(), 't1')
    expect(panel.pinned).toEqual(['t1'])
    expect(terminalTabIds(panel)).toEqual([])
  })
})

describe('the tabs a session is shown with', () => {
  it('drops the terminals that are gone and gives a terminal it has not placed a tab, so none is lost', () => {
    const saved: PanelTabs = { tabs: [tabOf('files'), tabOf('terminal', 'gone'), tabOf('terminal', 't1')], active: 'gone', pinned: ['t2', 'gone-too'] }
    const live = livePanel(saved, ['t1', 't2', 't3'])
    expect(ids(live)).toEqual(['files', 't1', 't3'])
    expect(live.pinned).toEqual(['t2'])
    // The tab that was in front is gone: the last one shows.
    expect(live.active).toBe('t3')
  })

  it('is the empty panel for a session with nothing remembered and no terminal', () => {
    expect(livePanel(undefined, [])).toEqual(EMPTY_PANEL)
  })

  it('keeps a pinned terminal out of the tabs even when both were saved', () => {
    const saved: PanelTabs = { tabs: [tabOf('terminal', 't1')], active: 't1', pinned: ['t1'] }
    const live = livePanel(saved, ['t1'])
    expect(live.tabs).toEqual([])
    expect(live.pinned).toEqual(['t1'])
  })
})

describe('the remembered tabs', () => {
  beforeEach(() => { localStorage.clear() })

  it('come back as they were saved, for each session', () => {
    const panel = pinTerminal(openTab(openTab(EMPTY_PANEL, tabOf('files')), tabOf('terminal', 't1')), 't1')
    writePanelTabs(new Map([['s1', panel], ['s2', openTab(EMPTY_PANEL, tabOf('changes'))]]))
    const read = readPanelTabs()
    expect(read.get('s1')).toEqual(panel)
    expect(read.get('s2')?.active).toBe('changes')
  })

  it('leave out a tab of a kind this version does not know, and anything that is not tabs at all', () => {
    expect(panelTabsOf({ tabs: [{ kind: 'files', id: 'files' }, { kind: 'pull-requests', id: 'pull-requests' }], active: 'pull-requests', pinned: [] })).toEqual({ tabs: [tabOf('files')], active: 'files', pinned: [] })
    expect(panelTabsOf({ tabs: 'files' })).toBeNull()
    expect(panelTabsOf(null)).toBeNull()
    localStorage.setItem('maiker.gui.panel-tabs.v1', '{"s1":7,"s2":{"tabs":[]}}')
    expect([...readPanelTabs().keys()]).toEqual(['s2'])
    localStorage.setItem('maiker.gui.panel-tabs.v1', 'not json')
    expect(readPanelTabs().size).toBe(0)
  })
})
