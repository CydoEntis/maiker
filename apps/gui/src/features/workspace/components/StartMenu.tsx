import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useShortcutText } from '@/features/shortcuts/platform'
import { SETUP_AGENTS } from '@/features/welcome/setup'
import { LOCAL_MACHINE } from '@/api/machines'
import { machineTitle, type MachineHead } from '../model/machines'
import { AppIcon, Icon } from './glyphs'
import { EDGE_PX } from './menuPoint'

export type StartMenuProps = {
  /** The machine a session starts on: this computer, or the one whose + this is. */
  machine: number
  /** The machines the menu can name: this computer first, then the others. */
  machines: readonly MachineHead[]
  /** The project the window is in, when it is on `machine`; it is named on the menu's first line. */
  project: string | null
  /** The agent programs found on this computer, or null while that is not known; another machine's are not known, so all are offered. */
  installed: readonly string[] | null
  /** Controlled open state, for a caller that opens the menu itself (Get started); absent, the button opens it. */
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  portalContainer: HTMLElement | null
  /** Starts a plain terminal; absent in the Chat view, where a terminal is the dock under a chat and the menu offers none. */
  onTerminal?: ((machine: number) => void) | undefined
  onAgent: (program: string, machine: number) => void
  onAddMachine: () => void
  /** The + button. */
  children: ReactElement
}

/** Which page of the menu is showing, and the machine its starts go to. */
type Page = { view: 'root' | 'remote' | 'machine'; machine: number }

const DIGIT = /^[1-9]$/

/** The first page for a + that belongs to `machine`: another machine's + opens straight on that machine, with nothing to go back to. */
function firstPage(machine: number): Page {
  return { view: machine === LOCAL_MACHINE ? 'root' : 'machine', machine }
}

/**
 * The + menu: the one way to start anything. Its pages are the root (a terminal, an agent, a remote machine), the
 * machines, and one machine's own terminal and agents. Number keys start the agent with that number, Backspace
 * or the left arrow goes back a page, Esc closes it. It is the shared dropdown menu, so Radix keeps it in the window and moves
 * with the arrows.
 */
export function StartMenu({ open, onOpenChange, children, ...rest }: StartMenuProps) {
  const [own, setOwn] = useState(false)
  const shown = open ?? own
  const change = (next: boolean) => { setOwn(next); onOpenChange?.(next) }
  return (
    <DropdownMenu open={shown} onOpenChange={change} modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent container={rest.portalContainer} aria-label="Start" aria-labelledby={undefined} loop side="bottom" align="start" sideOffset={4} collisionPadding={EDGE_PX} className="mx-ctx is-start" style={{ position: 'static' }} onContextMenu={(event) => { event.preventDefault() }}>
        {/* Mounted only while the menu is open, so each opening starts on the first page. */}
        <StartPages {...rest} onClose={() => { change(false) }} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function StartPages(props: Omit<StartMenuProps, 'open' | 'onOpenChange' | 'children'> & { onClose: () => void }) {
  const [page, setPage] = useState<Page>(() => firstPage(props.machine))
  const shortcutText = useShortcutText()
  const body = useRef<HTMLDivElement>(null)
  const base = firstPage(props.machine)
  const atBase = page.view === base.view
  const target = props.machines.find((head) => head.machine === page.machine)
  const title = target === undefined ? 'This computer' : machineTitle(target)
  const agents = agentsOn(page.machine, props.installed)
  const startable = agents.filter((agent) => agent.here)
  const { onTerminal } = props

  // The menu holds the keys only while one of its rows has focus, so the first row takes it whenever the page changes.
  useEffect(() => { body.current?.querySelector<HTMLElement>('[role="menuitem"]:not([data-disabled])')?.focus() }, [page])

  const go = (next: Page) => (event: Event) => {
    event.preventDefault()
    setPage(next)
  }
  const back = () => { setPage(page.view === 'machine' ? { view: 'remote', machine: page.machine } : base) }
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === 'Backspace' || event.key === 'ArrowLeft') && !atBase) {
      event.preventDefault()
      back()
      return
    }
    const agent = DIGIT.test(event.key) && (page.view === 'root' || page.view === 'machine') ? startable[Number(event.key) - 1] : undefined
    if (agent !== undefined) {
      event.preventDefault()
      props.onClose()
      props.onAgent(agent.program, page.machine)
    }
  }

  return (
    <div ref={body} className="mx-start-body" role="presentation" onKeyDown={onKeyDown}>
      {!atBase && <DropdownMenuItem className="mx-ctx-item mx-ctx-back" onSelect={(event) => { event.preventDefault(); back() }}><span aria-hidden="true">‹</span>Back</DropdownMenuItem>}
      <DropdownMenuLabel className="mx-ctx-context"><Icon name={page.machine === LOCAL_MACHINE && page.view !== 'remote' ? 'monitor' : 'server'} size={12} /><span>{contextLine(page, title, props.project)}</span></DropdownMenuLabel>
      {(page.view === 'root' || page.view === 'machine') && (
        <>
          {onTerminal !== undefined && (
            <DropdownMenuItem className="mx-ctx-item" onSelect={() => { onTerminal(page.machine) }}>
              <Icon name="terminal" size={14} /><span className="mx-ctx-label">Terminal</span>
              {page.view === 'root' && <span className="mx-ctx-hint" aria-hidden="true">{shortcutText('new-terminal')}</span>}
            </DropdownMenuItem>
          )}
          <DropdownMenuLabel className="mx-ctx-heading">Start an agent</DropdownMenuLabel>
          {agents.map((agent) => (
            <DropdownMenuItem key={agent.program} className="mx-ctx-item" disabled={!agent.here} onSelect={() => { props.onAgent(agent.program, page.machine) }}>
              <AppIcon process={agent.program} size={14} dimmed={!agent.here} /><span className="mx-ctx-label">{agent.label}</span>
              <span className="mx-ctx-hint" aria-hidden={agent.here}>{agent.here ? String(startable.indexOf(agent) + 1) : 'not installed'}</span>
            </DropdownMenuItem>
          ))}
        </>
      )}
      {page.view === 'root' && (
        <>
          <DropdownMenuSeparator className="mx-ctx-sep" />
          <DropdownMenuItem className="mx-ctx-item" onSelect={go({ view: 'remote', machine: page.machine })}><Icon name="server" size={14} /><span className="mx-ctx-label">On a remote machine</span><span className="mx-ctx-hint" aria-hidden="true">›</span></DropdownMenuItem>
        </>
      )}
      {page.view === 'remote' && (
        <>
          {props.machines.filter((head) => head.name !== null).map((head) => (
            <DropdownMenuItem key={head.key} className="mx-ctx-item" disabled={head.down} onSelect={go({ view: 'machine', machine: head.machine })}>
              <Icon name="server" size={14} /><span className="mx-ctx-label">{machineTitle(head)}</span>
              <span className="mx-ctx-hint" aria-hidden={!head.down}>{head.down ? 'offline' : head.target ?? '›'}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator className="mx-ctx-sep" />
          <DropdownMenuItem className="mx-ctx-item" onSelect={props.onAddMachine}><Icon name="plus" size={14} /><span className="mx-ctx-label">Add a machine…</span></DropdownMenuItem>
        </>
      )}
    </div>
  )
}

/** The agents the menu lists for a machine, in the setup's order, each with whether it can be started there. Copilot is not an agent Maiker starts. */
function agentsOn(machine: number, installed: readonly string[] | null) {
  return SETUP_AGENTS.map(({ program, label }) => ({ program, label, here: machine !== LOCAL_MACHINE || installed === null || installed.includes(program) }))
}

function contextLine(page: Page, machine: string, project: string | null): string {
  if (page.view === 'remote') return 'Pick a machine'
  if (page.view === 'machine') return `On ${machine}`
  return project === null ? machine : `In ${project} · ${machine}`
}
