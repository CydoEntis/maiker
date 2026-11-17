/** One of Claude's own "don't ask again" choices on a permission menu: its number's place and its words. */
export type AlwaysAllowChoice = {
  /** Zero-based place in the menu; the key that picks it is `choiceKey(index)`. */
  readonly index: number
  /** Claude's words for it, as the menu shows them: they name what is allowed and, where Claude says, where. */
  readonly label: string
}

/** A numbered menu line as the daemon's `asking` text holds it, with or without the `❯` cursor. */
const MENU_LINE = /^(?:❯\s*)?(\d+)\.\s+(.*\S)\s*$/
const NUMBER_GROUP = 1
const LABEL_GROUP = 2
/** A permission menu has at least Yes, one more and No. */
const FEWEST_CHOICES = 3
/**
 * The wording checked on a Claude permission menu ("2. Yes, and don't ask again", the fixture in the daemon's
 * prompt reader, which goes on with what it covers). Any other second choice, such as one that only says "Yes, allow
 * all edits", is not offered: Maitty names what an answer allows only in words it has seen.
 */
const DONT_ASK_AGAIN = /^Yes, and don['’]t ask again\b/
/** A label longer than this is not shown whole in a button; the card leaves such a menu to the terminal. */
const LONGEST_LABEL = 300

/**
 * The "don't ask again" choices of Claude's permission menu, read off the daemon's `asking` text, or none when the
 * menu is not the one checked: the last numbered lines must run 1, 2, 3… with "Yes" first and a "No" last, so a
 * numbered list in the question or a menu of another shape offers nothing. Never invented: a choice is only
 * returned when Claude's own menu shows it, in Claude's own words.
 */
export function alwaysAllowChoices(asking: string): AlwaysAllowChoice[] {
  const rows = asking.trimEnd().split('\n').map((line) => MENU_LINE.exec(line.trim()))
  let first = rows.length
  while (first > 0 && rows[first - 1] !== null) first -= 1
  const menu = rows.slice(first)
  if (menu.length < FEWEST_CHOICES) return []
  const labels = menu.map((row) => row?.[LABEL_GROUP] ?? '')
  const numbered = menu.every((row, at) => Number(row?.[NUMBER_GROUP]) === at + 1)
  const last = labels[labels.length - 1] ?? ''
  if (!numbered || labels[0] !== 'Yes' || !last.startsWith('No')) return []
  return labels
    .slice(1, -1)
    .map((label, at) => ({ index: at + 1, label }))
    .filter((choice) => DONT_ASK_AGAIN.test(choice.label) && choice.label.length <= LONGEST_LABEL)
}
