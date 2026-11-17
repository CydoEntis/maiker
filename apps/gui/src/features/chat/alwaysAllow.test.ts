import { describe, expect, it } from 'vitest'
import { alwaysAllowChoices } from './alwaysAllow'

// The shape of the daemon's reading of Claude's Bash menu (`prompt.rs` fixture, `CLAUDE_BASH_PROMPT`).
const BASH_MENU = "Bash command\nrm -rf target/debug\nDelete the build folder\nDo you want to proceed?\n❯ 1. Yes\n2. Yes, and don't ask again\n3. No, and tell Claude what to do"

describe('the "don\'t ask again" choices of Claude\'s permission menu', () => {
  it("offers the choice Claude's menu shows, in Claude's words, at its place", () => {
    expect(alwaysAllowChoices(BASH_MENU)).toEqual([{ index: 1, label: "Yes, and don't ask again" }])
  })

  it('keeps what Claude says the choice covers, and reads a curly apostrophe', () => {
    const menu = 'Do you want to proceed?\n1. Yes\n2. Yes, and don’t ask again for `npm test` commands in /work/app\n3. No, and tell Claude what to do differently'
    expect(alwaysAllowChoices(menu)).toEqual([{ index: 1, label: 'Yes, and don’t ask again for `npm test` commands in /work/app' }])
  })

  it('offers nothing for wording it has not seen, a menu of another shape or none at all', () => {
    expect(alwaysAllowChoices('Do you want to proceed?\n1. Yes\n2. Yes, allow all edits during this session\n3. No')).toEqual([])
    expect(alwaysAllowChoices('Do you want to proceed?\n1. Yes\n2. No')).toEqual([])
    expect(alwaysAllowChoices("1. Yes\n2. Yes, and don't ask again\n3. Maybe")).toEqual([])
    expect(alwaysAllowChoices("Which?\n1. Yes, and don't ask again\n2. Yes\n3. No")).toEqual([])
    expect(alwaysAllowChoices("Plan\n1. Yes, and don't ask again\n2. Yes\n3. No\n")).toEqual([])
    expect(alwaysAllowChoices('1. Yes\n3. Yes, and don\'t ask again\n4. No')).toEqual([])
    expect(alwaysAllowChoices('')).toEqual([])
  })

  it('leaves a menu whose choice is too long to show whole to the terminal', () => {
    const long = `Yes, and don't ask again for ${'x'.repeat(300)}`
    expect(alwaysAllowChoices(`Do you want to proceed?\n1. Yes\n2. ${long}\n3. No`)).toEqual([])
  })

  it('ignores a numbered list in the question above the menu', () => {
    const menu = "Steps\n1. Yes, and don't ask again\nDo you want to proceed?\n1. Yes\n2. Yes, and don't ask again for `ls`\n3. No"
    expect(alwaysAllowChoices(menu)).toEqual([{ index: 1, label: "Yes, and don't ask again for `ls`" }])
  })
})
