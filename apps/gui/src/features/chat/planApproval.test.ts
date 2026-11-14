import { describe, expect, it } from 'vitest'
import { inputText } from './claudeTools'
import { toolEvent } from './eventFixtures'
import { askedPlan, planMenuChoices, planOfInput } from './planApproval'

describe('the plan an approval is about', () => {
  it('reads the plan from the ExitPlanMode input', () => {
    expect(planOfInput(inputText({ plan: '## Refunds\n1. Add the endpoint' }))).toEqual({ text: '## Refunds\n1. Add the endpoint', cut: false })
  })

  it('reads as much of a long plan as the history kept, and says it was cut', () => {
    const plan = `# Plan\n${'Step "one" \\ done.\n'.repeat(400)}`
    const read = planOfInput(inputText({ plan }))
    expect(read?.cut).toBe(true)
    expect(plan.startsWith(read?.text ?? 'missing')).toBe(true)
  })

  it('is nothing where the history kept no plan', () => {
    expect([planOfInput(null), planOfInput('{}'), planOfInput('{"plan": "  "}'), planOfInput('not json')]).toEqual([null, null, null, null])
  })

  it('takes the latest ExitPlanMode call, not an earlier one', () => {
    const events = [
      toolEvent('1', { name: 'ExitPlanMode', input: inputText({ plan: 'first' }) }),
      toolEvent('2', { name: 'Read', input: inputText({ file_path: 'a.ts' }) }),
      toolEvent('3', { name: 'ExitPlanMode', input: inputText({ plan: 'second' }) }),
    ]
    expect(askedPlan(events)?.text).toBe('second')
    expect(askedPlan([toolEvent('1')])).toBeNull()
  })
})

// The menu as Claude Code 2.1.325 drew it under a one-step plan, read the way the daemon passes it on (`asking`):
// the lines above, then every numbered line it found near the bottom, the plan's own step among them.
const ASKING_2_1_325 = [
  'Step',
  'Verification',
  'ls -l PROBE.txt shows a 0-byte file; git status lists it as untracked. No commit unless asked.',
  'Claude has written up a plan and is ready to execute. Would you like to proceed?',
  '1. Create an empty PROBE.txt at the repo root (e.g. touch PROBE.txt).',
  '1. Yes, and use auto mode',
  '2. Yes, manually approve edits',
  '3. Tell Claude what to change',
].join('\n')

describe("Claude's plan menu", () => {
  it('is the choices from the last one numbered 1, in their words, without the steps of the plan above', () => {
    expect(planMenuChoices(ASKING_2_1_325)).toEqual(['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change'])
  })

  it('takes a cursor mark on a choice as part of the menu', () => {
    expect(planMenuChoices('Would you like to proceed?\n❯ 1. Yes\n2. No, keep planning')).toEqual(['Yes', 'No, keep planning'])
  })

  it('is nothing when the numbers skip, so a menu read in part is never offered as the whole', () => {
    expect(planMenuChoices('Proceed?\n1. Yes\n3. Tell Claude what to change')).toEqual([])
  })

  it('is nothing when the screen shows no menu, or a single numbered line', () => {
    expect(planMenuChoices('')).toEqual([])
    expect(planMenuChoices('Plan\n1. Add the endpoint')).toEqual([])
  })
})

