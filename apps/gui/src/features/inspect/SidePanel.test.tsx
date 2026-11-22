import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { closeOtherTabs, closeTab, EMPTY_PANEL, openTab, pinTerminal, showTab, tabOf, type PanelTabs, type SurfaceKind } from './panelTabs'
import { SidePanel } from './SidePanel'
import { SURFACES } from './surfaces'

const ALL: readonly SurfaceKind[] = ['files', 'changes', 'terminal']

/** The panel over the real tab model, as the window holds it: each terminal it starts is `new1`, `new2`, … */
function Panel({ start = EMPTY_PANEL, offered = ALL, onClosePanel = vi.fn() }: { start?: PanelTabs; offered?: readonly SurfaceKind[]; onClosePanel?: () => void }) {
  const [panel, setPanel] = useState(start)
  const [started, setStarted] = useState(0)
  return (
    <SidePanel
      tabs={panel.tabs}
      active={panel.active}
      offered={offered}
      nameOf={(tab) => (tab.kind === 'terminal' ? `Terminal ${tab.id}` : SURFACES[tab.kind].label)}
      menuRoot={null}
      onOpen={(kind) => {
        setPanel((current) => openTab(current, kind === 'terminal' ? tabOf(kind, `new${String(started + 1)}`) : tabOf(kind)))
        if (kind === 'terminal') setStarted(started + 1)
      }}
      onShow={(id) => { setPanel((current) => showTab(current, id)) }}
      onClose={(id) => { setPanel((current) => closeTab(current, id)) }}
      onCloseOthers={(id) => { setPanel((current) => closeOtherTabs(current, id)) }}
      onPin={(id) => { setPanel((current) => pinTerminal(current, id)) }}
      onClosePanel={onClosePanel}
    >
      {(tab) => (tab.kind === 'terminal' ? <div data-terminal-surface><input aria-label={`Shell ${tab.id}`} /></div> : <p>Body of {tab.id}</p>)}
    </SidePanel>
  )
}

const tabNames = () => screen.queryAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))
const selected = () => screen.getByRole('tab', { selected: true }).getAttribute('aria-label')
const filesAndTerminal = openTab(openTab(EMPTY_PANEL, tabOf('files')), tabOf('terminal', 't1'))

describe('the side panel', () => {
  it('offers the surfaces while it has no tab, and opens the one picked as a tab with its body', async () => {
    const user = userEvent.setup()
    render(<Panel />)
    const picker = screen.getByRole('group', { name: 'Open a surface' })
    expect(within(picker).getAllByRole('button')).toHaveLength(ALL.length)
    expect(screen.queryByRole('tab')).toBeNull()

    await user.click(within(picker).getByRole('button', { name: /Files/ }))

    expect(screen.queryByRole('group', { name: 'Open a surface' })).toBeNull()
    expect(selected()).toBe('Files')
    const body = screen.getByRole('tabpanel', { name: 'Files' })
    expect(body).toHaveTextContent('Body of files')
  })

  it('opens a surface on its letter while the picker has the keys, and only one it offers', async () => {
    const user = userEvent.setup()
    render(<Panel offered={['files', 'changes']} />)
    expect(screen.getByRole('group', { name: 'Open a surface' })).toHaveFocus()

    // No terminal for this session, so its letter opens nothing.
    await user.keyboard('t')
    expect(screen.queryByRole('tab')).toBeNull()
    // A letter held with Ctrl is the window's or the terminal's key, never the picker's.
    await user.keyboard('{Control>}d{/Control}')
    expect(screen.queryByRole('tab')).toBeNull()

    await user.keyboard('d')
    expect(selected()).toBe('Changes')
  })

  it('shows the tab that is clicked, and moves along the tabs with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<Panel start={filesAndTerminal} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(selected()).toBe('Terminal t1')

    await user.click(screen.getByRole('tab', { name: 'Files' }))
    expect(selected()).toBe('Files')
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(selected()).toBe('Terminal t1')
    expect(screen.getByRole('tab', { name: 'Terminal t1' })).toHaveFocus()
  })

  it('adds a surface from the + menu: an open Files comes forward, and a terminal is a new one each time', async () => {
    const user = userEvent.setup()
    render(<Panel start={filesAndTerminal} />)

    await user.click(screen.getByRole('button', { name: 'Open a surface' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Files/ }))
    expect(tabNames()).toEqual(['Files', 'Terminal t1'])
    expect(selected()).toBe('Files')

    await user.click(screen.getByRole('button', { name: 'Open a surface' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Terminal/ }))
    expect(tabNames()).toHaveLength(['Files', 'Terminal t1', 'new'].length)
  })

  it('closes the tab in front from its own close, and goes back to the picker after the last one', async () => {
    const user = userEvent.setup()
    render(<Panel start={openTab(EMPTY_PANEL, tabOf('changes'))} />)
    await user.click(screen.getByRole('button', { name: 'Close Changes' }))
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByRole('group', { name: 'Open a surface' })).toBeInTheDocument()
  })

  it('offers Close and Close others on a right-click, and pinning and a new terminal only on a terminal', async () => {
    render(<Panel start={filesAndTerminal} />)

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Files' }))
    const plain = within(await screen.findByRole('menu'))
    expect(plain.getAllByRole('menuitem')).toHaveLength(['close', 'close others'].length)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Terminal t1' }))
    const terminal = within(await screen.findByRole('menu'))
    expect(terminal.getByRole('menuitem', { name: 'New terminal' })).toBeInTheDocument()
    fireEvent.click(terminal.getByRole('menuitem', { name: 'Pin to the bottom' }))
    // Pinned, it is no longer a tab here: the drawer under the pane shows it.
    expect(tabNames()).toEqual(['Files'])
  })

  it('closes the other tabs from a right-click and keeps the one it was asked on', async () => {
    render(<Panel start={openTab(filesAndTerminal, tabOf('changes'))} />)
    fireEvent.contextMenu(screen.getByRole('tab', { name: 'Files' }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Close others' }))
    expect(tabNames()).toEqual(['Files'])
    expect(selected()).toBe('Files')
  })

  it('pins the terminal in front from the header, which other surfaces do not offer', async () => {
    const user = userEvent.setup()
    render(<Panel start={filesAndTerminal} />)
    await user.click(screen.getByRole('button', { name: 'Pin terminal to the bottom' }))
    expect(tabNames()).toEqual(['Files'])
    expect(screen.queryByRole('button', { name: 'Pin terminal to the bottom' })).toBeNull()
  })

  it('closes on Esc and on its close button, but leaves Esc to the program in a terminal', async () => {
    const user = userEvent.setup()
    const onClosePanel = vi.fn()
    render(<Panel start={filesAndTerminal} onClosePanel={onClosePanel} />)

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Shell t1' }), { key: 'Escape' })
    expect(onClosePanel).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Terminal t1' }), { key: 'Escape' })
    expect(onClosePanel).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClosePanel).toHaveBeenCalledTimes(['esc', 'button'].length)
  })
})
