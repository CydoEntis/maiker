import { beforeEach, describe, expect, it } from 'vitest'
import { readLastWho, rememberChoice, rememberWho, startChoiceFor } from './lastWho'

describe('the model and effort a start without the draft uses', () => {
  beforeEach(() => { window.localStorage.clear() })

  it('is the agent default, which adds nothing to the command line, until something was picked', () => {
    expect(startChoiceFor('claude')).toEqual({ model: 'default', reasoning: 'default' })
  })

  it('is what the agent was last started with', () => {
    rememberWho({ agent: 'codex', choices: { claude: { model: 'opus', reasoning: 'high' } } })
    expect(startChoiceFor('claude')).toEqual({ model: 'opus', reasoning: 'high' })
    expect(startChoiceFor('codex')).toEqual({ model: 'default', reasoning: 'default' })
  })

  it('follows a pick made in a chat, and keeps the last agent and the other agents as they were', () => {
    rememberWho({ agent: 'codex', choices: { codex: { model: 'gpt-x', reasoning: 'low' } } })
    rememberChoice('claude', { model: 'sonnet', reasoning: 'max' })
    expect(startChoiceFor('claude')).toEqual({ model: 'sonnet', reasoning: 'max' })
    expect(readLastWho()).toEqual({ agent: 'codex', choices: { codex: { model: 'gpt-x', reasoning: 'low' }, claude: { model: 'sonnet', reasoning: 'max' } } })
  })
})
