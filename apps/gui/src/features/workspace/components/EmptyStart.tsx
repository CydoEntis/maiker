import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MaikerMark } from '@/components/ui/maiker-mark'
import type { ChatAgent } from '../model/chatView'
import { agentForDigit, agentsToStart, type StartPlace } from '../model/emptyStart'
import { agentLabel } from '../model/session'
import { AppIcon } from './glyphs'
import { MenuPopup, type MenuEntry } from './MenuPopup'
import { ProjectBadge } from './ProjectBadge'

/** The mark over the heading, in the proportions of the title bar's. */
const LOGO_WIDTH = 54
const LOGO_HEIGHT = 42
const AGENT_MARK_PX = 18

/** Where a key press types its character instead of acting: a field, a list being typed in, a terminal. */
const TYPING_TARGETS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .xterm'
/** What sits over the screen while it is open; a number pressed then is that surface's, as a menu's own numbers are. */
const COVERING = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

type Props = {
  /** Sessions exist but none is shown: the heading must not say nothing runs. */
  running: boolean
  places: readonly StartPlace[]
  /** The project the agents start in; null with no project open. */
  place: StartPlace | null
  /** The agent programs on this computer; null while that is unknown. */
  installed: readonly string[] | null
  /** A session can be started now (the service is up and no start is under way). */
  canStart: boolean
  /** A dialog or the palette the window knows of is open over this screen. */
  covered: boolean
  /** The keys that open a project on this platform, '' when there are none. */
  openProjectKeys: string
  /** Where the picker's menu mounts, so it reads the theme's colours. */
  portalContainer: HTMLElement | null
  onPick: (place: StartPlace) => void
  onStart: (place: StartPlace, agent: ChatAgent) => void
  onOpenProject: () => void
  onAddMachine: () => void
}

/**
 * What the main area shows with nothing in it: where an agent would start, one row per agent that can start there
 * with the number key that picks it, and the two ways to bring in somewhere else to work. The number keys are this
 * screen's own, not bindings: they act only while it is what the window shows and no field has the press.
 */
export function EmptyStart({ running, places, place, installed, canStart, covered, openProjectKeys, portalContainer, onPick, onStart, onOpenProject, onAddMachine }: Props) {
  const headingId = useId()
  const section = useRef<HTMLElement>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const agents = place === null ? [] : agentsToStart(installed, place.remote)
  const startable = canStart && place !== null && !place.down

  // Focus that is nowhere (the session on screen just ended) comes here, so Tab reaches the rows first; focus that is
  // somewhere, like the sidebar, is left alone.
  useEffect(() => {
    if (document.activeElement === null || document.activeElement === document.body) section.current?.focus()
  }, [])

  const live = useRef({ agents, place, startable, covered, onStart })
  useEffect(() => { live.current = { agents, place, startable, covered, onStart } })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const now = live.current
      if (event.defaultPrevented || event.repeat || now.place === null || !now.startable) return
      const target = event.target instanceof Element ? event.target : null
      const agent = agentForDigit({
        key: event.key,
        modified: event.ctrlKey || event.metaKey || event.altKey,
        typing: target?.closest(TYPING_TARGETS) != null,
        covered: now.covered || document.querySelector(COVERING) !== null,
      }, now.agents)
      if (agent === null) return
      event.preventDefault()
      now.onStart(now.place, agent)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [])

  const menuItems: MenuEntry[] = [
    ...places.map((each): MenuEntry => ({ label: each.label, icon: <ProjectBadge name={each.name} />, ...(each === place ? { hint: 'picked' } : {}), run: () => { onPick(each) } })),
    'separator',
    { label: 'Open a project…', ...(openProjectKeys === '' ? {} : { hint: openProjectKeys }), run: onOpenProject },
  ]

  return (
    <section ref={section} className="mx-es" aria-labelledby={headingId} tabIndex={-1}>
      <div className="mx-es-column">
        <span className="mx-es-logo"><MaikerMark width={LOGO_WIDTH} height={LOGO_HEIGHT} decorative /></span>
        <h1 id={headingId}>{running ? 'No session open' : 'Nothing running'}</h1>
        <p className="mx-es-where">
          Start an agent in
          {place === null ? (
            <button type="button" className="mx-es-project" onClick={onOpenProject}>Open a project…</button>
          ) : (
            <button
              type="button"
              className="mx-es-project"
              aria-haspopup="menu"
              aria-expanded={menuAt !== null}
              aria-label={`Project: ${place.label}`}
              title="Choose another project"
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect()
                setMenuAt({ x: box.left, y: box.bottom })
              }}
            >
              <ProjectBadge name={place.name} />
              {place.label}
              <ChevronDown className="mx-es-chevron" strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </p>
        {place !== null && agents.length > 0 && (
          <div className="mx-es-agents">
            {agents.map((agent, index) => {
              const key = String(index + 1)
              return (
                <button key={agent} type="button" className="mx-es-agent" disabled={!startable} aria-label={`Start ${agentLabel(agent)} in ${place.label}`} aria-keyshortcuts={key} onClick={() => { onStart(place, agent) }}>
                  <AppIcon process={agent} size={AGENT_MARK_PX} />
                  <span className="mx-es-agent-name">{agentLabel(agent)}</span>
                  <kbd className="mx-es-key" aria-hidden="true">{key}</kbd>
                </button>
              )
            })}
          </div>
        )}
        {place !== null && agents.length === 0 && <p className="mx-es-none">No agent is installed on this computer.</p>}
        {place?.down === true && <p className="mx-es-none" role="status">{place.label} is not reachable now.</p>}
        <div className="mx-es-links">
          <button type="button" onClick={onOpenProject}>Open a project{openProjectKeys !== '' && <kbd className="mx-es-key" aria-hidden="true">{openProjectKeys}</kbd>}</button>
          <button type="button" onClick={onAddMachine}>Add a remote machine</button>
        </div>
        <p className="mx-es-fine">Sessions keep running when you close this window.</p>
      </div>
      {menuAt !== null && <MenuPopup title="Start an agent in" at={menuAt} items={menuItems} portalContainer={portalContainer} onClose={() => { setMenuAt(null) }} />}
    </section>
  )
}
