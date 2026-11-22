import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { TerminalView } from '@/TerminalView'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import type { TerminalDock as Dock } from '@/features/settings/preferences'
import { useWorkspace } from '../workspaceContext'
import type { SessionView } from '../model/session'
import { clampDockSize, readDockSize, writeDockSize, type DockAxis } from '../model/terminalDock'
import { MAX_SPLITS, splitCount, tabIndexOf, tabIds } from '../model/terminalTabs'
import { shortcutText } from '../model/shortcuts'
import { Icon, type IconName } from './glyphs'

/** How long the dock takes to slide out (`--panel-out`), so it stays on screen until then. */
export const TERMINAL_DOCK_EXIT_MS = 220

const DOCKS: readonly { id: Dock; label: string; icon: IconName }[] = [
  { id: 'bottom', label: 'Dock at the bottom', icon: 'drawer' },
  { id: 'right', label: 'Dock on the right', icon: 'sidePanel' },
  { id: 'full', label: 'Fill the pane', icon: 'maximize' },
]

const AXIS: Readonly<Record<Dock, DockAxis | null>> = { bottom: 'height', right: 'width', full: null }

/** A shell tab is named for what it runs; the daemon only says it is a shell, so the first is "shell" and the next "shell 2". */
function tabName(index: number): string {
  return index === 0 ? 'shell' : `shell ${String(index + 1)}`
}

/**
 * The terminal dock (layout 2h): one card beside the chat, at the bottom, on the right or in its place, for the focused
 * session's own terminals. Tabs across the top, and each tab split into up to four shells. Every shell is a session the
 * daemon owns; closing the dock only hides them.
 */
export function TerminalDock({ agent, leaving }: { agent: SessionView; leaving: boolean }) {
  const { tabsOf, activeTerminals, setActiveTerminals, addAgentTerminal, closeAgentTerminals, sessionMap, preferences, setPreferences, look, online, canStart, modalOpen, openPath, pasteImage, terminalHandles, toggleTerminal, dockFocused, setDockFocused, platform, root } = useWorkspace()
  const dock = preferences.terminalDock
  const axis = AXIS[dock]
  const tabs = tabsOf(agent.id)
  const picked = activeTerminals.get(agent.id)
  const tabIndex = Math.max(0, tabIndexOf(tabs, picked) === -1 ? tabs.length - 1 : tabIndexOf(tabs, picked))
  const tab = tabs[tabIndex]
  const ids = tab === undefined ? [] : tabIds(tab)
  const focusId = picked !== undefined && ids.includes(picked) ? picked : ids[0]
  const total = tab === undefined ? 0 : splitCount(tab)
  const full = total >= MAX_SPLITS
  const [sizes, setSizes] = useState<Record<DockAxis, number | null>>(() => ({ height: readDockSize('height'), width: readDockSize('width') }))
  const [resizing, setResizing] = useState(false)

  // A dock opened on a session with no terminal yet starts one, once: closing it afterwards leaves the empty note.
  const started = useRef(new Set<string>())
  useEffect(() => {
    if (leaving || tabs.length > 0 || !canStart || started.current.has(agent.id)) return
    started.current.add(agent.id)
    addAgentTerminal(agent.id)
  }, [leaving, tabs.length, canStart, agent.id, addAgentTerminal])

  const pick = (id: string | undefined) => {
    if (id === undefined) return
    setActiveTerminals((current) => new Map(current).set(agent.id, id))
    setDockFocused(true)
  }
  const split = (down: boolean) => {
    if (focusId === undefined) addAgentTerminal(agent.id)
    else addAgentTerminal(agent.id, { beside: focusId, down })
  }
  const setDock = (terminalDock: Dock) => { setPreferences((current) => ({ ...current, terminalDock })) }

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (axis === null) return
    event.preventDefault()
    const card = event.currentTarget.parentElement
    const wrap = card?.parentElement
    const room = (axis === 'height' ? wrap?.getBoundingClientRect().height : wrap?.getBoundingClientRect().width) ?? window.innerHeight
    const from = axis === 'height' ? event.clientY : event.clientX
    const begin = (axis === 'height' ? card?.getBoundingClientRect().height : card?.getBoundingClientRect().width) ?? 0
    // The dock grows away from the chat: up from the bottom, left from the right.
    const at = (now: PointerEvent) => clampDockSize(axis, begin + (from - (axis === 'height' ? now.clientY : now.clientX)), room)
    const move = (now: PointerEvent) => { setSizes((current) => ({ ...current, [axis]: at(now) })) }
    const stop = (now: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      writeDockSize(axis, at(now))
      setResizing(false)
    }
    setResizing(true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const resetSize = () => {
    if (axis === null) return
    writeDockSize(axis, null)
    setSizes((current) => ({ ...current, [axis]: null }))
  }

  const size = axis === null ? null : sizes[axis]
  const style = size === null || axis === null ? undefined : ({ [axis === 'height' ? '--tdock-h' : '--tdock-w']: `${String(size)}px` } as CSSProperties)
  const key = shortcutText('terminal', platform, preferences.keyOverrides)

  const dockChoice = (
    <Segmented aria-label="Dock terminal" className="mx-tdock-docks" value={dock} onValueChange={(value) => { const next = DOCKS.find((each) => each.id === value); if (next) setDock(next.id) }}>
      {DOCKS.map((each) => (
        <SegmentedItem key={each.id} value={each.id} icon={<Icon name={each.icon} />} aria-label={each.label} title={each.label} />
      ))}
    </Segmented>
  )

  return (
    <div
      className={`mx-tdock${resizing ? ' is-resizing' : ''}`}
      data-dock={dock}
      data-leaving={leaving ? 'true' : undefined}
      style={style}
      role="region"
      aria-label="Terminal"
      onPointerDownCapture={() => { setDockFocused(true) }}
    >
      {axis !== null && <div className={`mx-tdock-grip is-${axis}`} role="separator" aria-orientation={axis === 'height' ? 'horizontal' : 'vertical'} aria-label="Resize the terminal" title="Drag to resize · double-click for the usual size" onPointerDown={startResize} onDoubleClick={resetSize} />}
      <div className="mx-tdock-head">
        <div className="mx-tdock-tabs" role="tablist" aria-label="Terminals">
          {tabs.map((each, index) => {
            const lead = tabIds(each)[0]
            const on = index === tabIndex
            return (
              <span key={lead} className={`mx-tdock-tab${on ? ' is-on' : ''}`}>
                <button type="button" role="tab" aria-selected={on} className="mx-tdock-pick" onClick={() => { pick(tabIds(each).includes(picked ?? '') ? picked : lead) }}>
                  <span className="mx-tdock-prompt" aria-hidden="true">&gt;_</span>{tabName(index)}
                </button>
                <button type="button" className="mx-tdock-tab-close" aria-label={`Close ${tabName(index)}`} title="Close this tab · ends its shells" disabled={!online} onClick={() => { closeAgentTerminals(tabIds(each), tabName(index)) }}><Icon name="close" size={10} /></button>
              </span>
            )
          })}
        </div>
        <button type="button" className="mx-tdock-tool" aria-label="New terminal tab" title={`New terminal tab in ${agent.cwdLabel}`} disabled={!canStart} onClick={() => { addAgentTerminal(agent.id) }}><Icon name="plus" size={13} /></button>
        <span className="mx-tdock-spacer" />
        <span className="mx-tdock-path" title={agent.cwd}>{agent.cwdLabel}</span>
        <span className="mx-tdock-rule mx-tdock-path" aria-hidden="true" />
        <span className="mx-tdock-inline">
          <button type="button" className="mx-tdock-tool" aria-label="Split terminal right" title="Split terminal right" disabled={!canStart || full} onClick={() => { split(false) }}><Icon name="splitRight" /></button>
          <button type="button" className="mx-tdock-tool" aria-label="Split terminal down" title="Split terminal down" disabled={!canStart || full} onClick={() => { split(true) }}><Icon name="splitDown" /></button>
          {dockChoice}
        </span>
        <span className="mx-tdock-menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="mx-tdock-tool is-menu" aria-label="Split and dock" title="Split and dock"><Icon name="sidePanel" /><Icon name="chevronDown" size={10} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" container={root} className="mx-tdock-menu-list text-fg">
              <DropdownMenuItem disabled={!canStart || full} onSelect={() => { split(false) }}><Icon name="splitRight" />Split right</DropdownMenuItem>
              <DropdownMenuItem disabled={!canStart || full} onSelect={() => { split(true) }}><Icon name="splitDown" />Split down</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={dock} onValueChange={(value) => { const next = DOCKS.find((each) => each.id === value); if (next) setDock(next.id) }}>
                {DOCKS.map((each) => <DropdownMenuRadioItem key={each.id} value={each.id}><Icon name={each.icon} />{each.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
        <button type="button" className="mx-tdock-tool" aria-label="Hide terminal" title={`Hide terminal (${key})`} onClick={toggleTerminal}><Icon name="chevronDown" size={14} /></button>
        <button type="button" className="mx-tdock-tool" aria-label="Close terminal" title={`Close terminal (${key})`} onClick={toggleTerminal}><Icon name="close" size={13} /></button>
      </div>
      {tab === undefined ? (
        <div className="mx-tdock-empty">
          <strong>No terminal yet</strong>
          <span>A terminal opens in {agent.cwdLabel}, beside the chat.</span>
          <button type="button" className="mx-tdock-start" disabled={!canStart} onClick={() => { addAgentTerminal(agent.id) }}>New terminal</button>
        </div>
      ) : (
        <div className="mx-tdock-body">
          {tab.map((column) => (
            <div key={column[0]} className="mx-tdock-column">
              {column.map((id) => {
                const shell = sessionMap.get(id)
                if (shell === undefined) return null
                const focused = id === focusId
                return (
                  <div key={id} className={`mx-tdock-split${focused && total > 1 ? ' is-focus' : ''}`} onPointerDown={() => { pick(id) }}>
                    <TerminalView
                      conversation={shell.conversation}
                      desktop
                      fontSize={preferences.terminalFontSize}
                      look={look}
                      label={`Terminal in ${shell.cwdLabel}`}
                      inputDisabled={!online}
                      ended={shell.ended}
                      focused={focused && dockFocused && !modalOpen && !leaving}
                      onOpenPath={(path, line) => { openPath(shell, path, line) }}
                      onPasteImage={(image) => { pasteImage(shell.id, image) }}
                      onHandle={(handle) => {
                        if (handle) terminalHandles.current.set(shell.id, handle)
                        else terminalHandles.current.delete(shell.id)
                      }}
                    />
                    {total > 1 && <button type="button" className="mx-tdock-split-close" aria-label="Close this split" title="Close this split · ends its shell" disabled={!online} onClick={(event) => { event.stopPropagation(); closeAgentTerminals([id], 'this split') }}><Icon name="close" size={11} /></button>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
