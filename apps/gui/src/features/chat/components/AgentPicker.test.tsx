import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { everywhereModel, forgetChoices, forgetDiscoveredModels, noteAgentSaid, setDiscoveredModels, readChoice, useAgentChoice, wireChoice, writeChoice } from '../agentChoice'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { AgentPicker } from './AgentPicker'

const writeChoiceFor = writeChoice

vi.mock('@/api/daemon', () => ({ loadAgentModels: () => Promise.resolve([]) }))

function Harness({ agent = 'claude' as ChatAgent, conversation = 7 }) {
  const [choice, change] = useAgentChoice(conversation, agent)
  return <AgentPicker agent={agent} choice={choice} onChange={change} />
}

const models = () => within(screen.getByRole('radiogroup', { name: 'Model' }))
const levels = () => within(screen.getByRole('radiogroup', { name: 'Reasoning' }))
const level = (name: string) => levels().getByRole('radio', { name: new RegExp(`^${name}`) })
const open = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Agent, model and reasoning/ }))

beforeEach(() => {
  window.localStorage.clear()
  forgetChoices()
  forgetDiscoveredModels()
})

describe('the model button and its menu', () => {

  it('offers only its own agent in a chat that cannot start another, and switches the agent where it is still to be chosen', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await open(user)
    expect(within(screen.getByRole('tablist', { name: 'Agents' })).getAllByRole('tab')).toHaveLength(1)
    unmount()

    const onAgent = vi.fn()
    render(<AgentPicker agent="claude" choice={{ model: 'default', reasoning: 'default' }} onChange={() => undefined} onAgent={onAgent} />)
    await open(user)
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Codex' }))
    expect(onAgent).toHaveBeenCalledWith('codex')
  })

  it('leaves out an agent that is not installed, and offers the ones that run over ACP before the session starts', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<AgentPicker agent="claude" choice={{ model: 'default', reasoning: 'default' }} onChange={() => undefined} onAgent={() => undefined} installed={['claude', 'gemini']} others={{ list: [{ id: 'goose', name: 'Goose' }], current: null, onPick }} />)
    await open(user)
    expect(screen.queryByRole('tab', { name: 'Codex' })).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Goose' }))
    expect(onPick).toHaveBeenCalledWith('goose')
  })

  it('starts a new session with another agent when one of its models is picked in a session that runs', async () => {
    const user = userEvent.setup()
    const onStartWith = vi.fn()
    const onChange = vi.fn()
    render(<AgentPicker agent="claude" choice={{ model: 'default', reasoning: 'default' }} onChange={onChange} onStartWith={onStartWith} />)
    await open(user)
    await user.click(screen.getByRole('tab', { name: 'Codex' }))
    // Claude keeps the mark of the agent this session runs.
    expect(screen.getByRole('tab', { name: 'Claude' })).toHaveAttribute('aria-current', 'true')
    await user.click(models().getAllByRole('radio')[0] as HTMLElement)
    expect(onStartWith).toHaveBeenCalledWith('codex')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('picks a model and a reasoning level without closing, and remembers them for the chat', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)
    await user.click(models().getByRole('radio', { name: /Opus/ }))
    await user.click(level('Max'))
    // Still open, both picked.
    expect(models().getByRole('radio', { name: /Opus/ })).toBeChecked()
    expect(level('Max')).toBeChecked()
    expect(readChoice(7, 'claude')).toEqual({ model: 'opus', reasoning: 'max' })
    expect(readChoice(8, 'claude')).toEqual({ model: 'default', reasoning: 'default' })
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('radiogroup', { name: 'Model' })).toBeNull()
    expect(screen.getByRole('button', { name: /Claude · Opus · Max/ })).toBeInTheDocument()
  })

  it('finds a model by typing, moves through the matches with the arrows, and picks and closes on Enter', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)
    const search = screen.getByRole('combobox', { name: 'Search models' })
    expect(search).toHaveFocus()
    await user.keyboard('o')
    // Sonnet and Opus both hold an o; Haiku does not.
    expect(models().queryByRole('radio', { name: /Haiku/ })).toBeNull()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(readChoice(7, 'claude').model).toBe('sonnet')
    expect(screen.queryByRole('radiogroup', { name: 'Model' })).toBeNull()
  })

  it('moves to the reasoning column with the right arrow, where Enter picks a level and closes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)
    await user.keyboard('{ArrowRight}')
    expect(levels().getAllByRole('radio').some((row) => row === document.activeElement)).toBe(true)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(readChoice(7, 'claude').reasoning).toBe('high')
    expect(screen.queryByRole('radiogroup', { name: 'Reasoning' })).toBeNull()
  })

  it('marks the level a model runs at when none is picked', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)
    expect(level('Medium')).toHaveAccessibleName(/Default/)
    expect(level('High')).not.toHaveAccessibleName(/Default/)
  })

  it('lets go of a level when it is pressed again, back to the agent\'s own', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await open(user)
    const high = () => level('High')
    await user.click(high())
    expect(readChoice(7, 'claude').reasoning).toBe('high')
    await user.click(high())
    expect(readChoice(7, 'claude').reasoning).toBe('default')
  })

  it('offers only the efforts the agent listed for a model, and drops to Medium when the picked one is not among them', async () => {
    const user = userEvent.setup()
    setDiscoveredModels('claude', [
      { id: 'opus', label: 'Opus 5.5', blurb: '', efforts: ['low', 'medium', 'high', 'max'] },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', blurb: '', efforts: ['low', 'medium'] },
      { id: 'claude-haiku-4-5', label: 'Haiku 4.5', blurb: '', efforts: [] },
    ])
    writeChoiceFor(7, { model: 'opus', reasoning: 'max' })
    render(<Harness />)
    await open(user)
    // The agent's own name for the alias, not the fixed word.
    expect(models().getByRole('radio', { name: /Opus 5\.5/ })).toBeChecked()
    await user.click(models().getByRole('radio', { name: /Sonnet 4\.6/ }))
    expect(readChoice(7, 'claude')).toEqual({ model: 'claude-sonnet-4-6', reasoning: 'medium' })
    // A level the model does not take has no row.
    expect(levels().getAllByRole('radio')).toHaveLength(2)
    // A model that takes no effort at all keeps none.
    await user.click(models().getByRole('radio', { name: /Haiku 4\.5/ }))
    expect(readChoice(7, 'claude')).toEqual({ model: 'claude-haiku-4-5', reasoning: 'default' })
  })

  it('has no Max for Codex until its own list says the model takes it', async () => {
    const user = userEvent.setup()
    setDiscoveredModels('codex', [{ id: 'gpt-x', label: 'GPT-X', blurb: '', efforts: ['low', 'medium', 'high', 'max'] }])
    render(<Harness agent="codex" />)
    await open(user)
    // Default: which model it is cannot be read, so neither can its levels.
    expect(levels().queryByRole('radio', { name: /^Max/ })).toBeNull()
    expect(level('High')).toBeInTheDocument()
    await user.click(models().getByRole('radio', { name: /GPT-X/ }))
    expect(level('Max')).toBeInTheDocument()
  })

  it('lists the models Codex itself offers after Default, and a stored one is kept', async () => {
    const user = userEvent.setup()
    setDiscoveredModels('codex', [{ id: 'gpt-x', label: 'GPT-X', blurb: 'The newest' }])
    writeChoiceFor(7, { model: 'gpt-x' })
    expect(readChoice(7, 'codex').model).toBe('gpt-x')
    render(<Harness agent="codex" />)
    await open(user)
    const rows = models().getAllByRole('radio')
    expect(rows.map((model) => model.textContent)).toEqual(['Default', 'GPT-X'])
    expect(rows[1]).toBeChecked()
    expect(rows[1]).toHaveAttribute('title', 'The newest')
  })

  it('adds the extra models Claude reports to its fixed aliases, once each', async () => {
    const user = userEvent.setup()
    setDiscoveredModels('claude', [{ id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', blurb: 'Most capable' }, { id: 'opus', label: 'Opus', blurb: 'x' }])
    render(<Harness agent="claude" />)
    await open(user)
    expect(models().getAllByRole('radio').map((model) => model.textContent)).toEqual(['Default', 'Fable 5.1', 'Opus', 'Fable', 'Sonnet', 'Haiku'])
  })

  it('names a model read by its id, and lets the account default stand in for the Default row', async () => {
    const user = userEvent.setup()
    setDiscoveredModels('claude', [{ id: 'claude-sonnet-5-5', label: 'claude-sonnet-5-5', blurb: '' }, { id: 'claude-fable-5-2', label: 'claude-fable-5-2', blurb: '', isDefault: true }])
    render(<Harness agent="claude" />)
    await open(user)
    const rows = models().getAllByRole('radio')
    expect(rows.map((model) => model.textContent)).toEqual(['Sonnet 5.5', 'Fable 5.2default', 'Fable', 'Opus', 'Sonnet', 'Haiku'])
    // Nothing is picked, so the default's row is the picked one, and picking it sends no model.
    expect(rows[1]).toBeChecked()
    await user.click(rows[0] as HTMLElement)
    expect(wireChoice(7, 'claude')).toEqual({ model: 'claude-sonnet-5-5' })
    await user.click(models().getByRole('radio', { name: /Fable 5\.2/ }))
    expect(wireChoice(7, 'claude')).toBeNull()
  })
})

describe('what the picker sends with a message', () => {
  it('sends nothing until something is picked, then only what was picked', () => {
    expect(wireChoice(7, 'claude')).toBeNull()
    writeChoiceFor(7, { reasoning: 'high' })
    expect(wireChoice(7, 'claude')).toEqual({ effort: 'high' })
    writeChoiceFor(7, { model: 'opus' })
    expect(wireChoice(7, 'claude')).toEqual({ model: 'opus', effort: 'high' })
    writeChoiceFor(7, { model: 'default', reasoning: 'default' })
    expect(wireChoice(7, 'claude')).toBeNull()
  })

  it('gives way to a model or effort the agent says it changed to, even one changed while the chat was closed', () => {
    writeChoiceFor(7, { model: 'opus', reasoning: 'low' })
    noteAgentSaid(7, { model: null, effort: null })
    expect(wireChoice(7, 'claude')).toEqual({ model: 'opus', effort: 'low' })
    // The first word from the agent, then a /model typed in its terminal: each time the agent's word stands.
    noteAgentSaid(7, { model: 'claude-opus-5-5', effort: null })
    expect(wireChoice(7, 'claude')).toEqual({ effort: 'low' })
    writeChoiceFor(7, { model: 'sonnet' })
    noteAgentSaid(7, { model: 'claude-opus-5-5', effort: null })
    expect(wireChoice(7, 'claude')).toEqual({ model: 'sonnet', effort: 'low' })
    forgetChoices()
    noteAgentSaid(7, { model: 'Haiku 5.5', effort: 'max' })
    expect(wireChoice(7, 'claude')).toBeNull()
  })

  it('ignores a stored model the agent does not offer, once its list has come', () => {
    writeChoiceFor(9, { model: 'opus' })
    setDiscoveredModels('codex', [{ id: 'gpt-x', label: 'GPT X', blurb: '' }])
    expect(wireChoice(9, 'codex')).toBeNull()
  })

  it('keeps a stored model while the agent has not yet said its list, so a pick of an extra model is not lost', () => {
    writeChoiceFor(9, { model: 'claude-fable-5-1' })
    expect(wireChoice(9, 'claude')).toEqual({ model: 'claude-fable-5-1' })
  })
})

describe('the picker for a chat on another machine', () => {
  it('offers the models every install takes by name, not the extras read from this computer, and the effort', async () => {
    setDiscoveredModels('claude', [{ id: 'claude-fable-5-1[1m]', label: 'Fable 5.1', blurb: 'Most capable' }])
    render(<AgentPicker agent="claude" choice={{ model: 'default', reasoning: 'default' }} onChange={() => undefined} fixedModels />)
    await userEvent.click(screen.getByRole('button', { name: /Agent, model and reasoning/ }))
    const rows = models().getAllByRole('radio').map((row) => row.textContent)
    expect(rows.join(' ')).not.toContain('Fable 5.1')
    expect(rows).toEqual(expect.arrayContaining(['Fable', 'Opus']))
    expect(levels().getAllByRole('radio').length).toBeGreaterThan(0)
  })

  it('starts there with a fixed alias as picked, and with the default for a model only this computer knows', () => {
    expect(everywhereModel('claude', 'opus')).toBe('opus')
    expect(everywhereModel('claude', 'claude-fable-5-1[1m]')).toBe('default')
    expect(everywhereModel('codex', 'gpt-x')).toBe('default')
  })
})
