import { useRef, useState, type KeyboardEvent } from 'react'
import { Popover } from 'radix-ui'
import { ChoiceItem, ChoiceList } from '@/components/ui/choice-list'
import { PopupContent } from '@/components/ui/popup'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { AppIcon, Icon } from '@/features/workspace/components/glyphs'
import { AGENT_LABEL, modelName } from '../modelName'
import {
  choiceFor, DEFAULT_PICK, effortAllowed, effortInUse, effortWord, KNOWN_MODELS, menuModels, modelInUse, pickedModel, useAgentModels, useDiscoveredModels,
  type AgentChoice, type ModelOption, type Reasoning, type ReasoningPick,
} from '../agentChoice'
import { acpIdOf, acpKey, railAgents, reasoningRows, shownModels, type OtherAgent, type RailAgent } from '../modelPicker'
import './model-picker.css'

/** The level a chat drops to when its new model does not take the one it had. */
const FALLBACK_LEVEL: Reasoning = 'medium'

/** The agents that run over ACP, offered on the rail of a session that has not started. */
export type OtherAgents = {
  readonly list: readonly OtherAgent[]
  /** The id of the one picked, null while a built-in agent is. */
  readonly current: string | null
  readonly onPick: (id: string | null) => void
}

type PickerProps = {
  agent: ChatAgent
  choice: AgentChoice
  onChange: (change: Partial<AgentChoice>) => void
  /** The model the agent's own file says it runs; null when it has not said. */
  currentModel?: string | null
  /** The effort the agent's own files say it runs at, which is what the button shows while none was picked; null when they do not say. */
  currentEffort?: string | null
  /** Given where the agent is still to be chosen (a session that has not started): a mark on the rail switches to that agent. */
  onAgent?: (agent: ChatAgent) => void
  /** Given for a session that runs: its agent cannot change, so a model picked under another agent starts a new session with that agent. */
  onStartWith?: (agent: ChatAgent) => void
  /** Given for a chat that follows the agent's own terminal: a pick is sent to it now, as its own `/model` and `/effort` commands. */
  live?: (command: string) => void
  /** Why the choice cannot be changed right now. The button stays where it is, greyed out, so the chat box never rearranges. */
  locked?: string | undefined
  /**
   * Only the models every install of the agent takes by name. The account's extra models are read from this computer's
   * agent, so for a chat on another machine they may not exist there.
   */
  fixedModels?: boolean
  /** The agent programs on this computer; null while unknown, or for another machine, where every agent is offered. */
  installed?: readonly string[] | null
  others?: OtherAgents | undefined
}

type Column = 'rail' | 'models' | 'reasoning'

const MODEL_LIST = 'mx-mp-models'
const modelRowId = (index: number): string => `mx-mp-model-${String(index)}`

/**
 * The chat box's model button and its picker (handoff 5, screenshot 31): a float anchored to the box with three
 * columns. The rail holds the agents (a dot on the one this session runs), the middle a search field over that agent's
 * models, the right the reasoning levels the model takes with the default marked. The picked row wears the one
 * selection fill, never a tick.
 *
 * Keys are the palette's: the search field has the typing, ↑ and ↓ move through the models and Enter picks the lit one
 * and closes; Esc closes. Tab, or ← and → at the ends of the search text, move between the columns, where the arrows
 * move and Enter picks. A click picks and leaves the picker open, so a model and a level can be set in one visit.
 *
 * What is picked goes to the agent with the next message; the account's default model and a level that was never
 * picked send nothing, so the chat keeps what it started with.
 */
export function AgentPicker({ agent, choice, onChange, currentModel = null, currentEffort = null, onAgent, onStartWith, live, locked, fixedModels = false, installed = null, others }: PickerProps) {
  const [open, setOpen] = useState(false)
  // The agent whose models show, when it is not the session's own: a running session can look at another agent's.
  const [browsed, setBrowsed] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [lit, setLit] = useState<{ on: string; index: number } | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const otherNow = others?.list.find((other) => other.id === others.current) ?? null
  const canBrowse = onAgent !== undefined || onStartWith !== undefined
  const rail = canBrowse ? railAgents(agent, installed, onAgent === undefined ? [] : others?.list ?? [], otherNow?.id ?? null) : railAgents(agent, [agent])
  const currentKey = otherNow === null ? agent : acpKey(otherNow.id)
  const shownKey = rail.some((entry) => entry.key === browsed) ? browsed ?? currentKey : currentKey
  const shownEntry = rail.find((entry) => entry.key === shownKey)
  const shownAgent = shownEntry?.agent ?? null
  const own = shownKey === currentKey
  // The hooks need an agent; an ACP agent lists no models, so the session's own stands in and its rows are not drawn.
  const listAgent = shownAgent ?? agent
  useDiscoveredModels(agent)
  useDiscoveredModels(listAgent)
  const readOwn = useAgentModels(agent)
  const readShown = useAgentModels(listAgent)
  const models = fixedModels ? KNOWN_MODELS[listAgent] : readShown
  const rows = shownAgent === null ? [] : menuModels(models)
  // Nothing picked means the agent's own: the picker selects the model it says it runs, as the button names it,
  // and only falls back to the default's row when it has not said.
  const ownModels = fixedModels ? KNOWN_MODELS[agent] : readOwn
  const model = (choice.model === DEFAULT_PICK ? modelInUse(ownModels, currentModel) : undefined) ?? pickedModel(ownModels, choice.model)
  const selectedId = own && shownAgent !== null ? model?.id ?? DEFAULT_PICK : null
  const shown = shownModels(rows, selectedId ?? '', query, expanded)
  const litKey = `${shownKey}\n${query}\n${String(expanded)}`
  const litIndex = Math.min(lit?.on === litKey ? lit.index : Math.max(0, shown.rows.findIndex((row) => row.id === selectedId)), Math.max(0, shown.rows.length - 1))

  // Nothing picked means the agent's own, and its files may say which: that is what is true, so that is what shows.
  const effort = effortInUse(agent, model, choice.reasoning, currentEffort)
  // The column of another agent has nothing in use: it shows that agent's levels for its first model.
  const levels = shownAgent === null ? [] : own ? reasoningRows(agent, model, effort.level) : reasoningRows(shownAgent, rows[0], null)
  const summary = otherNow === null ? `${AGENT_LABEL[agent]} · ${model?.label ?? ''} · ${effort.word ?? 'no effort setting'}` : otherNow.name
  // The button names the model (the agent's own name for it when none was picked), then the level; the agent is its mark.
  const fullName = modelName(agent, choice.model === DEFAULT_PICK && currentModel !== null ? undefined : model, currentModel)
  const modelOnly = fullName.slice(AGENT_LABEL[agent].length).trim() || (model?.id === DEFAULT_PICK || model === undefined ? AGENT_LABEL[agent] : model.label)
  const face = otherNow === null ? [modelOnly, effortWord(effort.level) ?? ''].filter((part) => part !== '').join(' · ') : otherNow.name

  const close = () => { setOpen(false) }
  const change = (next: boolean) => {
    if (locked !== undefined) return
    setOpen(next)
    if (!next) { setBrowsed(null); setQuery(''); setExpanded(false); setLit(null) }
  }
  const pickLevel = (level: ReasoningPick) => {
    onChange({ reasoning: level })
    if (level !== DEFAULT_PICK) live?.(`/effort ${level}`)
  }
  const pickModel = (option: ModelOption) => {
    if (!own) {
      // The session's agent is already running, so another agent's model is a new session's.
      if (shownAgent !== null) { change(false); onStartWith?.(shownAgent) }
      return
    }
    onChange({ model: choiceFor(option) })
    live?.(`/model ${choiceFor(option)}`)
    if (choice.reasoning !== DEFAULT_PICK && !effortAllowed(agent, option, choice.reasoning)) pickLevel(effortAllowed(agent, option, FALLBACK_LEVEL) ? FALLBACK_LEVEL : DEFAULT_PICK)
    // A running session's pick is made: the menu goes, as a picked menu does. Before the start it stays for the effort.
    if (live !== undefined) change(false)
  }
  const showAgent = (entry: RailAgent) => {
    setQuery('')
    setExpanded(false)
    if (onAgent === undefined) { setBrowsed(entry.key); return }
    // Before the session starts the rail chooses: the agent picked is the one it starts with.
    const acp = acpIdOf(entry.key)
    others?.onPick(acp)
    if (entry.agent !== null) onAgent(entry.agent)
  }

  const focusIn = (column: Column) => {
    if (column === 'models') { search.current?.focus(); return }
    const group = content.current?.querySelector<HTMLElement>(column === 'rail' ? '[role="tablist"]' : '[data-column="reasoning"]')
    const target = group?.querySelector<HTMLElement>('[aria-selected="true"], [aria-checked="true"]') ?? group?.querySelector<HTMLElement>('button:not(:disabled)')
    target?.focus()
  }
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget
    const count = shown.rows.length
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (count > 0) setLit({ on: litKey, index: (litIndex + (event.key === 'ArrowDown' ? 1 : count - 1)) % count })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = shown.rows[litIndex]
      if (chosen !== undefined) pickModel(chosen)
      close()
    } else if (event.key === 'ArrowRight' && field.selectionStart === field.value.length && field.selectionEnd === field.value.length) {
      if (levels.some((row) => !row.fixed)) { event.preventDefault(); focusIn('reasoning') }
    } else if (event.key === 'ArrowLeft' && field.selectionStart === 0 && field.selectionEnd === 0) {
      if (rail.length > 1) { event.preventDefault(); focusIn('rail') }
    }
  }
  // In a column of rows the arrows already move (the list's own); these add the way out, and Enter picking then closing.
  const onColumnKey = (column: Column) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowLeft' || (column === 'rail' && event.key === 'ArrowRight')) {
      event.preventDefault()
      focusIn('models')
    } else if (event.key === 'Enter' && event.target instanceof HTMLButtonElement && column !== 'rail' && event.target.closest('.mx-mp-more') === null) {
      event.preventDefault()
      event.target.click()
      close()
    }
  }
  const onRailKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { onColumnKey('rail')(event); return }
    event.preventDefault()
    const at = rail.findIndex((entry) => entry.key === shownKey)
    const next = rail[(at + (event.key === 'ArrowDown' ? 1 : rail.length - 1)) % rail.length]
    if (next === undefined) return
    showAgent(next)
    content.current?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(next.key)}"]`)?.focus()
  }

  const mark = otherNow === null ? agent : otherNow.name
  const label = `Agent, model and reasoning: ${summary}`
  return (
    // aria-disabled, not disabled: a disabled button gets no focus or tooltip, and the reason is the point.
    <Popover.Root open={open && locked === undefined} onOpenChange={change}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={locked === undefined ? label : `${label}. ${locked}`} title={locked ?? 'Model and reasoning for this session'} aria-disabled={locked !== undefined} className={`mx-row-button mx-model-button${locked === undefined ? '' : ' is-locked'}`}>
          <span className="mx-model-icon"><AppIcon process={mark} size={14} /></span>
          <span className="mx-model-line">{face}</span>
        </button>
      </Popover.Trigger>
      <PopupContent ref={content} side="top" align="start" sideOffset={6} aria-label="Agent, model and reasoning" className="mx-mp" onOpenAutoFocus={(event) => { event.preventDefault(); (search.current?.disabled === false ? search.current : content.current)?.focus() }}>
        <div className="mx-mp-rail" role="tablist" aria-label="Agents" aria-orientation="vertical" onKeyDown={onRailKey}>
          {rail.map((entry) => (
            <button key={entry.key} type="button" role="tab" data-agent={entry.key} aria-selected={entry.key === shownKey} aria-label={entry.label} aria-current={entry.current ? 'true' : undefined} tabIndex={entry.key === shownKey ? 0 : -1}
              title={entry.current ? `${entry.label} (this session)` : entry.label} className="mx-mp-agent" onClick={() => { showAgent(entry) }}>
              <AppIcon process={entry.mark} size={14} />
            </button>
          ))}
        </div>
        <div className="mx-mp-mid">
          <label className="mx-mp-search">
            <Icon name="search" size={14} />
            <input ref={search} role="combobox" aria-label="Search models" aria-expanded="true" aria-controls={MODEL_LIST} aria-activedescendant={shown.rows.length > 0 ? modelRowId(litIndex) : undefined} placeholder="Search models…" value={query} disabled={shownAgent === null}
              onChange={(event) => { setQuery(event.target.value) }} onKeyDown={onSearchKey} />
          </label>
          {!own && shownAgent !== null && <p className="mx-mp-note">{`This session runs ${AGENT_LABEL[agent]}. Picking a ${AGENT_LABEL[shownAgent]} model starts a new session.`}</p>}
          {shownAgent === null && shownEntry !== undefined && <p className="mx-mp-note">{`${shownEntry.label} runs over ACP, with its own model and permission settings.`}</p>}
          <ChoiceList id={MODEL_LIST} aria-label="Model" current={selectedId} className="mx-mp-list" onKeyDown={onColumnKey('models')}>
            {shown.rows.map((option, index) => (
              <ChoiceItem key={option.id} id={modelRowId(index)} value={option.id} title={option.blurb === '' ? undefined : option.blurb} data-lit={index === litIndex ? true : undefined} className="mx-mp-row mx-menu-row" onPick={() => { pickModel(option) }}>
                <span className="mx-mp-row-mark"><AppIcon process={shownEntry?.mark ?? agent} size={14} /></span>
                <span className="mx-mp-row-text">{option.label}</span>
                {option.isDefault === true && <small>default</small>}
              </ChoiceItem>
            ))}
            {shown.rows.length === 0 && shownAgent !== null && <p className="mx-mp-none" role="status">No model matches</p>}
          </ChoiceList>
          {shown.canShowMore && <button type="button" className="mx-mp-more" onClick={() => { setExpanded(true); search.current?.focus() }}>Show more</button>}
        </div>
        <div className="mx-mp-side" data-column="reasoning">
          <p className="mx-mp-head"><span>Reasoning</span><span className="mx-mp-head-model">{shownAgent === null ? '' : own ? model?.label ?? '' : rows[0]?.label ?? ''}</span></p>
          {levels.length > 0 ? (
            <ChoiceList aria-label="Reasoning" current={levels.find((row) => row.selected)?.value ?? null} className="mx-mp-levels" onKeyDown={onColumnKey('reasoning')}>
              {levels.map((row) => (
                <ChoiceItem key={row.value} value={row.value} disabled={row.fixed || !own} className="mx-mp-level mx-menu-row"
                  title={row.fixed ? `${AGENT_LABEL[agent]} runs at ${row.label}. Change it in its own settings.` : undefined}
                  // A second press on the picked level lets go of it: the chat keeps the agent's own again.
                  onPick={() => { pickLevel(row.value === choice.reasoning ? DEFAULT_PICK : (row.value as Reasoning)) }}>
                  <span>{row.label}</span>
                  {row.isDefault && <small>Default</small>}
                </ChoiceItem>
              ))}
            </ChoiceList>
          ) : (
            <p className="mx-mp-none">{shownEntry === undefined || shownAgent === null ? 'Its reasoning level is its own setting.' : `${shownEntry.label} has no reasoning level to pick here.`}</p>
          )}
        </div>
      </PopupContent>
    </Popover.Root>
  )
}
