import { useRef, useState, type KeyboardEvent } from 'react'
import { RadioGroup, RadioGroupItem, Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { Popover } from 'radix-ui'
import { PopupContent } from '@/components/ui/popup'
import { StopSlider } from '@/components/ui/stop-slider'
import { CHAT_AGENTS, type ChatAgent } from '@/features/workspace/model/chatView'
import { AppIcon, Icon } from '@/features/workspace/components/glyphs'
import { abilitiesOf } from '@/features/workspace/model/agentAbilities'
import { AGENT_LABEL, modelName } from '../modelName'
import {
  choiceFor, DEFAULT_PICK, effortAllowed, KNOWN_MODELS, effortInUse, effortWord, leadingModels, menuModels, modelInUse, pickedModel, REASONING_LABEL, REASONING_LEVELS, useAgentModels, useDiscoveredModels,
  type AgentChoice, type ModelOption, type Reasoning, type ReasoningPick,
} from '../agentChoice'

/** The level a chat drops to when its new model does not take the one it had. */
const FALLBACK_LEVEL: Reasoning = 'medium'

/**
 * The agent, as a segmented control across the top of the menu (layout 2h): a column per agent with its icon and
 * name. It is there only before a chat starts.
 */
function AgentSelect({ agent, onAgent }: { agent: ChatAgent; onAgent: (agent: ChatAgent) => void }) {
  return (
    <Segmented aria-label="Agent" full value={agent} className="mx-mm-agents"
      onValueChange={(value) => { const next = CHAT_AGENTS.find((name) => name === value); if (next !== undefined) onAgent(next) }}>
      {CHAT_AGENTS.map((name) => (
        <SegmentedItem key={name} value={name} icon={<AppIcon process={name} size={14} />}>{AGENT_LABEL[name]}</SegmentedItem>
      ))}
    </Segmented>
  )
}

/** How long typed letters keep adding to one search of the agent list. */
const TYPE_AHEAD_MS = 700

/**
 * The agent as a list in the New session dialog's menu: each agent's flat mark and name, the current one highlighted. Typing
 * letters jumps to the agent that starts with them; arrows and Space work as on any radio list.
 */
function AgentList({ agent, onAgent }: { agent: ChatAgent; onAgent: (agent: ChatAgent) => void }) {
  const typed = useRef({ text: '', at: 0 })
  const refs = useRef(new Map<ChatAgent, HTMLButtonElement>())
  const typeAhead = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === ' ') return
    const now = event.timeStamp
    typed.current = { text: (now - typed.current.at > TYPE_AHEAD_MS ? '' : typed.current.text) + event.key.toLowerCase(), at: now }
    const found = CHAT_AGENTS.find((name) => AGENT_LABEL[name].toLowerCase().startsWith(typed.current.text))
    if (found === undefined) return
    onAgent(found)
    refs.current.get(found)?.focus()
  }
  return (
    <RadioGroup aria-label="Agent" value={agent} onValueChange={(value) => { const next = CHAT_AGENTS.find((name) => name === value); if (next !== undefined) onAgent(next) }} onKeyDown={typeAhead} className="mx-mm-models mx-mm-agent-list">
      {CHAT_AGENTS.map((name) => (
        <RadioGroupItem key={name} ref={(node: HTMLButtonElement | null) => { if (node === null) refs.current.delete(name); else refs.current.set(name, node) }} value={name} className="mx-mm-model mx-menu-row">
          <AppIcon process={name} size={14} />
          <span>{AGENT_LABEL[name]}</span>
        </RadioGroupItem>
      ))}
    </RadioGroup>
  )
}

type PickerProps = {
  agent: ChatAgent
  choice: AgentChoice
  onChange: (change: Partial<AgentChoice>) => void
  /** The model the agent's own file says it runs; null when it has not said. */
  currentModel?: string | null
  /** The effort the agent's own files say it runs at, which is what the button shows while none was picked; null when they do not say. */
  currentEffort?: string | null
  /** Given where the agent is still to be chosen (a chat that has not started): the menu has the agent switch. */
  onAgent?: (agent: ChatAgent) => void
  /** Given for a chat that follows the agent's own terminal: a pick is sent to it now, as its own `/model` and `/effort` commands. */
  live?: (command: string) => void
  /** Why the choice cannot be changed right now. The button stays where it is, greyed out, so the message box never rearranges. */
  locked?: string | undefined
  /**
   * Only the models every install of the agent takes by name. The account's extra models are read from this computer's
   * agent, so for a chat on another machine they may not exist there.
   */
  fixedModels?: boolean
  /**
   * The New session dialog's one dropdown: the agent's mark, name, model and effort in one line of fixed width, and a menu with
   * the agent list, the models and the efforts as a segmented control (none when the agent has no effort setting). Enter closes it.
   */
  compact?: boolean
  /** Which side of the button the menu opens on (it flips when there is no room). The message box in a chat is at the foot of the window, so up; the draft's is mid-page and keeps the box clear by opening down. */
  side?: 'top' | 'bottom'
}

/**
 * The message box's model button and its menu (layout 2h: 300px, square, opening up from the right of the box): the
 * agent switch, one column with the models, then a foot with the effort as a slider of the levels the model takes. The earlier models wait under "More models", so the newest lead. Picking leaves the menu open, so both can be set in one go; Esc or a click outside closes it.
 * The agent switch is there only before a chat starts: after that its agent is already running.
 * What is picked goes to the agent with the next message; the account's default model and a level
 * that was never picked send nothing, so the chat keeps what it started with.
 */
export function AgentPicker({ agent, choice, onChange, currentModel = null, currentEffort = null, onAgent, live, locked, fixedModels = false, compact = false, side = 'top' }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [allModels, setAllModels] = useState(false)
  useDiscoveredModels(agent)
  const read = useAgentModels(agent)
  const models = fixedModels ? KNOWN_MODELS[agent] : read
  const rows = menuModels(models)
  // Nothing picked means the agent's own: the menu ticks the model it says it runs, as the button names it,
  // and only falls back to the default's row when it has not said.
  const model = (choice.model === DEFAULT_PICK ? modelInUse(models, currentModel) : undefined) ?? pickedModel(models, choice.model)
  const modelId = model?.id ?? DEFAULT_PICK
  const leading = leadingModels(rows, modelId)
  const shown = allModels ? rows : leading
  // Nothing picked means the agent's own, and its files may say which: that is what is true, so that is what shows.
  // An agent with no effort setting shows none, whatever a page started with.
  const takesEffort = abilitiesOf(agent).takesEffort
  const effort = effortInUse(agent, model, choice.reasoning, currentEffort)
  const inUse = effort.level
  // The dialog's line says only what is known, so a level that is merely assumed is left off it.
  const inUseWord = effort.assumed ? null : effort.word
  // Only the levels this model takes get a stop, so the slider is as long as the agent's own list.
  const levels = REASONING_LEVELS.filter((level) => effortAllowed(agent, model, level)).map((level) => ({ value: level, label: REASONING_LABEL[level] }))
  const summary = `${AGENT_LABEL[agent]} · ${model?.label ?? ''} · ${effort.word ?? 'no effort setting'}`
  // The button names the agent, then the model (the agent's own name when none was picked) and the effort.
  const fullName = modelName(agent, choice.model === DEFAULT_PICK && currentModel !== null ? undefined : model, currentModel)
  const modelOnly = fullName.slice(AGENT_LABEL[agent].length).trim() || (model?.label ?? '')
  // Enter in the dialog's menu closes it, the way it does on a list; a button that opens more models keeps its own Enter.
  const closeOnEnter = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || (event.target instanceof HTMLElement && event.target.closest('.mx-mm-more') !== null)) return
    event.preventDefault()
    setOpen(false)
  }
  const pickModel = (option: ModelOption) => {
    onChange({ model: choiceFor(option) })
    live?.(`/model ${choiceFor(option)}`)
    if (choice.reasoning !== DEFAULT_PICK && !effortAllowed(agent, option, choice.reasoning)) pickLevel(effortAllowed(agent, option, FALLBACK_LEVEL) ? FALLBACK_LEVEL : DEFAULT_PICK)
  }
  const pickLevel = (level: ReasoningPick) => {
    onChange({ reasoning: level })
    if (level !== DEFAULT_PICK) live?.(`/effort ${level}`)
  }
  return (
    // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
    <Popover.Root open={open && locked === undefined} onOpenChange={(next) => { if (locked === undefined) setOpen(next) }}>
      <Popover.Trigger asChild>
        <button type="button" aria-label={`Agent, model and reasoning: ${summary}`} title={locked ?? 'Model and effort'} aria-disabled={locked !== undefined} className={`mx-model-button${locked === undefined ? '' : ' is-locked'}`}>
          <span className="mx-model-icon"><AppIcon process={agent} size={14} /></span>
          {/* One line, `Claude · Sonnet 5.5 · Medium`, in the dialog and in the chat's box alike. */}
          <span className="mx-model-line"><span className="mx-model-name">{AGENT_LABEL[agent]}</span><span className="mx-model-effort">{[modelOnly, compact ? inUseWord ?? '' : takesEffort ? effortWord(inUse) ?? '' : ''].filter((part) => part !== '').map((part) => ` · ${part}`).join('')}</span></span>
          {compact && <Icon name="chevronDown" />}
        </button>
      </Popover.Trigger>
      <PopupContent side={side} align={compact ? 'start' : 'end'} aria-label="Model and effort" className="mx-mm" onKeyDown={compact ? closeOnEnter : undefined}>
        {onAgent !== undefined && (compact ? <><p className="mx-mm-head">Agent</p><AgentList agent={agent} onAgent={onAgent} /><p className="mx-mm-head">Model</p></> : <AgentSelect agent={agent} onAgent={onAgent} />)}
        {onAgent === undefined && <p className="mx-mm-head">Model</p>}
        <RadioGroup aria-label="Model" value={modelId} onValueChange={(value) => { const option = rows.find((row) => row.id === value); if (option) pickModel(option) }} className="mx-mm-models">
          {shown.map((option) => (
            <RadioGroupItem key={option.id} value={option.id} title={option.blurb === '' ? undefined : option.blurb} className="mx-mm-model mx-menu-row">
              <span>{option.label}</span>
              {option.isDefault === true && <small>default</small>}
            </RadioGroupItem>
          ))}
        </RadioGroup>
        {leading.length < rows.length && (
          <button type="button" aria-expanded={allModels} className="mx-mm-more" onClick={() => { setAllModels((now) => !now) }}>
            <span>{allModels ? 'Fewer models' : 'More models'}</span>
            <span className="mx-spacer" />
            <Icon name="chevronDown" />
          </button>
        )}
        {compact ? (takesEffort && (
          <div className="mx-mm-reasoning">
            <p className="mx-mm-head">Reasoning</p>
            <Segmented aria-label="Effort" full value={choice.reasoning === DEFAULT_PICK ? '' : choice.reasoning} onValueChange={(value) => { pickLevel(value as Reasoning) }}>
              {REASONING_LEVELS.map((level) => (
                <SegmentedItem key={level} value={level} disabled={!effortAllowed(agent, model, level)} aria-label={REASONING_LABEL[level]} title={effortAllowed(agent, model, level) ? REASONING_LABEL[level] : `${REASONING_LABEL[level]}: not on this model`}
                  // A second press on the picked level lets go of it: the chat keeps the agent's own again.
                  onClick={() => { if (level === choice.reasoning) pickLevel(DEFAULT_PICK) }}>{REASONING_LABEL[level]}</SegmentedItem>
              ))}
            </Segmented>
          </div>
        )) : takesEffort ? (
          <div className="mx-mm-effort">
            <span className="mx-mm-effort-word">Effort</span>
            {/* Nothing picked: the agent runs at its own setting, which is named when its files say it. */}
            {/* The picked stop already says its level; the line at the right says only what the stops cannot: an assumed default, or a level beyond them. */}
            <span className="mx-mm-level" title={choice.reasoning === DEFAULT_PICK ? `${AGENT_LABEL[agent]}'s own setting. Pick a level to change it.` : undefined}>{effort.assumed || !levels.some((stop) => stop.value === inUse) ? effort.word : ''}</span>
            <StopSlider
              aria-label="Effort"
              className="mx-mm-stops"
              stops={levels}
              value={inUse}
              emptyText="The agent's own"
              // A second press on the picked level lets go of it: the chat keeps the agent's own again.
              onValueChange={(level) => { pickLevel(level === choice.reasoning ? DEFAULT_PICK : (level as Reasoning)) }}
            />
          </div>
        ) : (
          <p className="mx-mm-note">{`${AGENT_LABEL[agent]} has no effort setting to pick here.`}</p>
        )}
      </PopupContent>
    </Popover.Root>
  )
}
