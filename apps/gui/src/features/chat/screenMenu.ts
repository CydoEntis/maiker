const ESC_CODE = 27
const ENTER_CODE = 13
const ESC = String.fromCharCode(ESC_CODE)
const ENTER = String.fromCharCode(ENTER_CODE)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`

/** A menu the agent is stopped on, as the daemon read it off the terminal screen. */
export type ScreenMenu = { question: string; options: readonly string[]; cursor: number }

const OPTION_LINE = /^(❯\s*)?\d+\.\s+(.+)$/
/** The label's group in `OPTION_LINE`, and the fewest choices that make a menu. */
const LABEL_GROUP = 2
const MIN_CHOICES = 2

/**
 * Reads the daemon's `asking` text: the lines of the question, then the choices one per line as
 * `N. label`, the one under the cursor marked `❯`. Null when it holds no choices.
 */
export function parseScreenMenu(asking: string): ScreenMenu | null {
  const lines = asking.split('\n')
  let first = lines.length
  while (first > 0 && OPTION_LINE.test((lines[first - 1] ?? '').trim())) first -= 1
  const rows = lines.slice(first).map((line) => OPTION_LINE.exec(line.trim()))
  if (rows.length < MIN_CHOICES) return null
  const options = rows.map((row) => row?.[LABEL_GROUP] ?? '')
  const marked = rows.findIndex((row) => row?.[1] !== undefined)
  return { question: lines.slice(0, first).join('\n').trim(), options, cursor: Math.max(marked, 0) }
}

/** The keys that move the cursor from where it is to option `index` and press Enter, one send each. */
export function keysToPick(menu: ScreenMenu, index: number): string[] {
  const steps = index - menu.cursor
  return [...Array.from({ length: Math.abs(steps) }, () => (steps > 0 ? DOWN : UP)), ENTER]
}

const MARKED_LINE = /^❯/
/** The most choices a card shows with a number key each: 1 to 9. */
const MOST_NUMBERED_CHOICES = 9
const MOST_LABEL_CHARS = 200
const NUMBER_GROUP = /^(?:❯\s*)?(\d+)\./

/**
 * The menu of a prompt the hooks did not report, read for a card with a button and a number key per choice. Stricter than
 * `parseScreenMenu`, since a wrong key is a wrong answer: the choices must be numbered 1, 2, 3 and so on with no gap,
 * there are two to nine of them, each has words, and the cursor mark must be on exactly one, so the keys that move it are
 * known. Anything else is null and stays a screen the person reads and keys through.
 */
export function parseChoiceMenu(asking: string): ScreenMenu | null {
  const menu = parseScreenMenu(asking)
  if (menu === null || menu.options.length > MOST_NUMBERED_CHOICES) return null
  const rows = asking.split('\n').slice(-menu.options.length).map((line) => line.trim())
  const numbered = rows.every((row, at) => Number(NUMBER_GROUP.exec(row)?.[1]) === at + 1)
  const marks = rows.filter((row) => MARKED_LINE.test(row))
  const wordy = menu.options.every((option) => option.trim() !== '' && option.length <= MOST_LABEL_CHARS)
  return numbered && wordy && marks.length === 1 ? menu : null
}

/** Types each key in turn: a pick is the arrow presses that reach the choice, then Enter. */
export const typeEach = (sendKeys: (keys: string) => Promise<void>) => async (keys: readonly string[]) => {
  for (const key of keys) await sendKeys(key)
}
