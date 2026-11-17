import type { ChatEvent } from './chatEvents'

/** The tool Claude asks to leave plan mode with; its input holds the plan it wants approved. */
export const PLAN_TOOL = 'ExitPlanMode'

const CUT_MARK = '\n[cut]'
const PLAN_START = '"plan": "'

export type AskedPlan = {
  readonly text: string
  /** The history kept only the start of a long plan. */
  readonly cut: boolean
}

/** A JSON string's body read as far as it goes: the history cuts a long input mid-string. */
function readCutString(body: string): string | null {
  // Drop a half escape at the cut, then any quote and brace after the string's end.
  const end = body.search(/(?<!\\)"/)
  const inside = (end === -1 ? body : body.slice(0, end)).replace(/\\u[0-9a-fA-F]{0,3}$|\\$/, '')
  try {
    return JSON.parse(`"${inside}"`) as string
  } catch {
    return null
  }
}

/** The plan in an ExitPlanMode input as the history kept it, or null where it kept none. */
export function planOfInput(input: string | null): AskedPlan | null {
  if (input === null) return null
  const cut = input.endsWith(CUT_MARK)
  if (!cut) {
    try {
      const parsed: unknown = JSON.parse(input)
      const plan = typeof parsed === 'object' && parsed !== null && 'plan' in parsed ? parsed.plan : null
      return typeof plan === 'string' && plan.trim() !== '' ? { text: plan, cut: false } : null
    } catch {
      return null
    }
  }
  const start = input.indexOf(PLAN_START)
  if (start === -1) return null
  const text = readCutString(input.slice(start + PLAN_START.length, -CUT_MARK.length))
  return text === null || text.trim() === '' ? null : { text, cut: true }
}

/** The plan of the latest ExitPlanMode call in the history: the one a plan-approval prompt is about. */
export function askedPlan(events: readonly ChatEvent[]): AskedPlan | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind === 'tool' && event.name === PLAN_TOOL) return planOfInput(event.input)
  }
  return null
}

const MENU_LINE = /^(?:❯\s*)?(\d+)\.\s+(.*\S)\s*$/
/** A menu offers at least this many choices; one numbered line is a step of the plan, not a menu. */
const FEWEST_CHOICES = 2

/**
 * The choices of Claude's plan menu, in its order and words, from the daemon's reading of the screen (`asking`):
 * the lines from the last one numbered 1, which must run 1, 2, 3… to the end. The daemon takes in every numbered
 * line near the menu, and a plan's own steps are numbered too, so anything before that last 1 is the plan.
 * Empty when there is no such menu, and the card then leaves the answer to the terminal.
 */
export function planMenuChoices(asking: string): string[] {
  const rows = asking.split('\n').map((line) => MENU_LINE.exec(line.trim()))
  const start = rows.findLastIndex((row) => row?.[1] === '1')
  if (start === -1) return []
  const menu = rows.slice(start)
  const inOrder = menu.every((row, at) => row !== null && Number(row[1]) === at + 1)
  return inOrder && menu.length >= FEWEST_CHOICES ? menu.map((row) => row?.[2] ?? '') : []
}

