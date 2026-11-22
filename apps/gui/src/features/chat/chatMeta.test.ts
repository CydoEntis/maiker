import { describe, expect, it } from 'vitest'
import { asksToSwitchModel, modeFromScreen, modelLabel } from './chatMeta'

describe('the mode and model in plain words', () => {

  it('names a model by family and version, with or without a date', () => {
    expect(modelLabel('claude-sonnet-5-5')).toBe('sonnet 5.5')
    expect(modelLabel('claude-opus-4-1-20250805')).toBe('opus 4.1')
  })

  it('keeps a model name it cannot read, minus the vendor prefix', () => {
    expect(modelLabel('claude-haiku-latest')).toBe('haiku-latest')
    expect(modelLabel('gpt-6-luna')).toBe('gpt-6-luna')
    expect(modelLabel(null)).toBeNull()
  })
})

describe('reading the permission mode from the agent\'s screen', () => {
  const screen = (footer: string) => `> hello\n\n  Hey! What are we working on?\n\n────────\n❯ \n────────\n  dev · Sonnet 5.5\n  ${footer}\n`

  it('names each mode the footer shows', () => {
    expect(modeFromScreen(screen('⏵⏵ auto mode on (shift+tab to cycle)'))).toBe('auto')
    expect(modeFromScreen(screen('⏵⏵ accept edits on (shift+tab to cycle)'))).toBe('acceptEdits')
    expect(modeFromScreen(screen('⏸ plan mode on (shift+tab to cycle)'))).toBe('plan')
    expect(modeFromScreen(screen('⏵⏵ bypass permissions on (shift+tab to cycle)'))).toBe('bypassPermissions')
  })

  it('is the default mode when the footer shows none, and unknown on an empty screen', () => {
    expect(modeFromScreen(screen('? for shortcuts'))).toBe('default')
    expect(modeFromScreen('  \n')).toBeNull()
  })
})

describe('Claude Code asking to switch the model', () => {
  const ask = ['> /model opus', '', 'Switch model?', 'Your next response will be slower and use more tokens', '', '  1 Yes, switch to Opus 5.5', '  2 No, go back'].join('\n')

  it('is read from the last lines of the screen', () => {
    expect(asksToSwitchModel(ask)).toBe(true)
    expect(asksToSwitchModel(`${'older line\n'.repeat(40)}${ask}`)).toBe(true)
  })

  it('is not read from a screen where it has scrolled away, or one that only says the words', () => {
    expect(asksToSwitchModel(`${ask}\n${'later line\n'.repeat(40)}`)).toBe(false)
    expect(asksToSwitchModel('Set model to Haiku 5.5')).toBe(false)
    expect(asksToSwitchModel('Switch model? is a question Claude asks')).toBe(false)
  })
})
