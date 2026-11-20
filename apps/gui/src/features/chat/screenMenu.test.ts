import { describe, expect, it } from 'vitest'
import { keysToPick, parseChoiceMenu, parseScreenMenu } from './screenMenu'

const TRUST = 'Accessing workspace:\n\n/home/vox\n\nQuick safety check: do you trust this folder?\n❯ 1. No, exit\n2. Yes, I trust this folder'

describe('the menu an agent is stopped on', () => {
  it('reads the question, the choices and where the cursor is', () => {
    const menu = parseScreenMenu(TRUST)
    expect(menu).toEqual({ question: expect.stringContaining('Quick safety check') as string, options: ['No, exit', 'Yes, I trust this folder'], cursor: 0 })
  })

  it('has no menu when the text holds fewer than two choices', () => {
    expect(parseScreenMenu('Allow this?')).toBeNull()
    expect(parseScreenMenu('only\n1. one choice')).toBeNull()
  })

  it('moves the cursor down to the wanted choice, then presses Enter', () => {
    const menu = parseScreenMenu(TRUST)
    if (menu === null) throw new Error('no menu')
    const keys = keysToPick(menu, 1)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(String.fromCharCode(27) + '[B')
    expect(keys[1]).toBe(String.fromCharCode(13))
    expect(keysToPick(menu, 0)).toEqual([String.fromCharCode(13)])
  })

  it('moves up when the cursor is below the wanted choice', () => {
    const menu = parseScreenMenu('Trust?\n1. Yes\n❯ 2. No')
    if (menu === null) throw new Error('no menu')
    expect(menu.cursor).toBe(1)
    expect(keysToPick(menu, 0)[0]).toBe(String.fromCharCode(27) + '[A')
  })
})

describe('a numbered menu read for buttons', () => {
  const SWITCH = 'Switch model?\nYour next response will be slower and use more tokens.\n❯ 1. Yes, switch to Sonnet 5.5\n2. No, go back'

  it('reads the Switch model menu with its cursor on the first choice', () => {
    expect(parseChoiceMenu(SWITCH)).toEqual({ question: expect.stringContaining('Switch model?') as string, options: ['Yes, switch to Sonnet 5.5', 'No, go back'], cursor: 0 })
  })

  it('follows a cursor that is not on the first choice', () => {
    expect(parseChoiceMenu('Go on?\n1. Yes\n❯ 2. No')?.cursor).toBe(1)
  })

  it('is null without a cursor mark, so the keys are never guessed', () => {
    expect(parseChoiceMenu('Go on?\n1. Yes\n2. No')).toBeNull()
  })

  it('is null when the numbers skip or do not start at 1', () => {
    expect(parseChoiceMenu('Go on?\n❯ 1. Yes\n3. No')).toBeNull()
    expect(parseChoiceMenu('Go on?\n❯ 2. Yes\n3. No')).toBeNull()
  })

  it('is null for one choice, for ten, and for two cursor marks', () => {
    expect(parseChoiceMenu('Go on?\n❯ 1. Yes')).toBeNull()
    const ten = Array.from({ length: 10 }, (_, at) => `${at === 0 ? '❯ ' : ''}${String(at + 1)}. choice`).join('\n')
    expect(parseChoiceMenu(`Pick\n${ten}`)).toBeNull()
    expect(parseChoiceMenu('Go on?\n❯ 1. Yes\n❯ 2. No')).toBeNull()
  })

  it('is null for plain text', () => {
    expect(parseChoiceMenu('')).toBeNull()
    expect(parseChoiceMenu('Allow this?')).toBeNull()
  })
})
