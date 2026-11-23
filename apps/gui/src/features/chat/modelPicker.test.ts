import { describe, expect, it } from 'vitest'
import type { ModelOption } from './agentChoice'
import { railAgents, reasoningRows, shownModels } from './modelPicker'

const MODELS: readonly ModelOption[] = [
  { id: 'opus', label: 'Opus 5.5', blurb: '' },
  { id: 'sonnet', label: 'Sonnet 5.5', blurb: '' },
  { id: 'opus-5', label: 'Opus 5', blurb: '', more: true },
  { id: 'sonnet-5', label: 'Sonnet 5', blurb: '', more: true },
]
const ids = (rows: readonly ModelOption[]) => rows.map((row) => row.id)

describe('the agent rail', () => {
  it('lists the installed agents and marks the one the session runs', () => {
    const rail = railAgents('claude', ['claude', 'gemini'])
    expect(rail.map((entry) => entry.key)).toEqual(['claude', 'gemini'])
    expect(rail.filter((entry) => entry.current).map((entry) => entry.key)).toEqual(['claude'])
  })

  it('keeps the session\'s own agent even when it is not installed here, and offers every agent while that is unknown', () => {
    expect(railAgents('codex', ['claude']).map((entry) => entry.key)).toEqual(['claude', 'codex'])
    expect(railAgents('claude', null)).toHaveLength(3)
  })

  it('adds the agents that run over ACP, and moves the mark to one that is picked', () => {
    const rail = railAgents('claude', null, [{ id: 'goose', name: 'Goose' }], 'goose')
    const goose = rail.at(-1)
    expect(goose?.label).toBe('Goose')
    expect(goose?.agent).toBeNull()
    expect(rail.filter((entry) => entry.current)).toEqual([goose])
  })
})

describe('the model list', () => {
  it('keeps the earlier models behind Show more, but never the picked one', () => {
    expect(ids(shownModels(MODELS, 'opus', '', false).rows)).toEqual(['opus', 'sonnet'])
    expect(shownModels(MODELS, 'opus', '', false).canShowMore).toBe(true)
    expect(ids(shownModels(MODELS, 'sonnet-5', '', false).rows)).toEqual(['opus', 'sonnet', 'sonnet-5'])
    expect(shownModels(MODELS, 'opus', '', true)).toEqual({ rows: MODELS, canShowMore: false })
  })

  it('searches every model, whatever case is typed', () => {
    const found = shownModels(MODELS, 'opus', 'OPUS', false)
    expect(ids(found.rows)).toEqual(['opus', 'opus-5'])
    expect(found.canShowMore).toBe(false)
  })

  it('has no Show more when every model already shows', () => {
    expect(shownModels(MODELS.slice(0, 2), 'opus', '', false).canShowMore).toBe(false)
  })
})

describe('the reasoning column', () => {
  it('lists the levels the model takes, marks the default and selects the one in use', () => {
    const rows = reasoningRows('claude', { id: 'x', label: 'X', blurb: '', efforts: ['low', 'medium', 'high'] }, 'high')
    expect(rows.map((row) => row.value)).toEqual(['low', 'medium', 'high'])
    expect(rows.filter((row) => row.isDefault).map((row) => row.value)).toEqual(['medium'])
    expect(rows.filter((row) => row.selected).map((row) => row.value)).toEqual(['high'])
  })

  it('shows a level the agent runs at that cannot be picked here, without offering it', () => {
    const extra = reasoningRows('codex', undefined, 'xhigh').at(-1)
    expect(extra).toMatchObject({ value: 'xhigh', selected: true, fixed: true })
  })

  it('is empty for an agent with no reasoning setting', () => {
    expect(reasoningRows('gemini', undefined, null)).toEqual([])
  })
})
