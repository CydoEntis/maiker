import type { AlwaysAllowChoice } from './alwaysAllow'
import type { ApprovalDecision, ApprovalEvent } from './chatEvents'
import { ANSWER_KEY } from './permissionAsk'

/**
 * One answer of a needs-you card, a row of its column. The rows are the provider's own options and nothing else: a
 * row exists only where the request offers that answer, so no card shows a choice its agent would not take.
 */
export type AnswerRow<Id extends string = string> = {
  /** What picking it sends, unique in its card: a decision's name, `remember`, or a card's own word. */
  readonly id: Id
  readonly label: string
  /** The letter that picks it while the card has the keys; null for a row picked by the arrows and Enter, or a click. */
  readonly key: string | null
  /** The plain line under the answers: a standing choice (always, don't ask again), never the highlighted first row. */
  readonly quiet?: boolean
  /** What it does in more words, as its tooltip. */
  readonly hint?: string
}

type Answer = Exclude<ApprovalDecision, 'Cancel'>

const ANSWER_LABEL: Readonly<Record<Answer, string>> = { Accept: 'Yes once', AcceptForSession: 'This session', Decline: 'No' }

/** The row that has the daemon remember a command for the project (`allowAlways`). */
export const REMEMBER_ROW = 'remember'

/** What a row of a chat's own request sends: one of the provider's decisions, or the daemon's remember. */
export type ApprovalRowId = Answer | typeof REMEMBER_ROW

/**
 * The rows of a request the daemon holds for a chat. Each decision the provider offers is a row on its letter (`y`
 * once, `a` this session, `n` no), in the provider's order and, where it named them (an ACP agent), in its words.
 * Cancel is left out: it ends the turn, which Esc in the message box does. "Always in this project" is the plain line,
 * only for a request the daemon can remember and a chat that can send it.
 */
export function approvalRows(event: Pick<ApprovalEvent, 'choices' | 'choiceLabels' | 'canRemember'>, canRemember: boolean): AnswerRow<ApprovalRowId>[] {
  const rows: AnswerRow<ApprovalRowId>[] = []
  event.choices.forEach((choice, at) => {
    if (choice === 'Cancel') return
    rows.push({ id: choice, label: event.choiceLabels?.[at] ?? ANSWER_LABEL[choice], key: ANSWER_KEY[choice] })
  })
  if (event.canRemember && canRemember && rows.some((row) => row.id === 'Accept')) {
    rows.push({ id: REMEMBER_ROW, label: 'Always in this project', key: null, quiet: true, hint: 'Allows this exact command in this project from now on, without asking' })
  }
  return rows
}

/** What a row of a terminal prompt sends: yes once, no, or the place of one of the agent's own "don't ask again" choices. */
export type PromptRowId = 'Accept' | 'Decline' | `own:${string}`
/** The place in the agent's menu a row's id names; null for yes and no. */
export const ownChoiceIndex = (id: PromptRowId): number | null => (id === 'Accept' || id === 'Decline' ? null : Number(id.slice(OWN_PREFIX_LENGTH)))
const OWN_PREFIX_LENGTH = 'own:'.length

/**
 * The rows of a prompt an agent's terminal is stopped on, answered by the keys the daemon knows for that agent: yes
 * once and no, then the agent's own "don't ask again" choices in its own words. It has no "this session": the hook
 * reports none.
 */
export function promptRows(own: readonly AlwaysAllowChoice[]): AnswerRow<PromptRowId>[] {
  return [
    { id: 'Accept', label: ANSWER_LABEL.Accept, key: ANSWER_KEY.Accept },
    { id: 'Decline', label: ANSWER_LABEL.Decline, key: ANSWER_KEY.Decline },
    ...own.map((choice) => ({ id: `own:${String(choice.index)}` as const, label: choice.label, key: null, quiet: true, hint: 'The agent’s own choice, in its words. The agent keeps it; Maiker adds no rule.' })),
  ]
}

/** What the person answers a request to start helpers with (ADR 0016). */
export type HelpersChoice = 'allow' | 'always' | 'no'

/** The rows of a request to start helpers. "Always" is a standing grant for the project, so it has no letter. */
export const HELPERS_ROWS: readonly AnswerRow<HelpersChoice>[] = [
  { id: 'allow', label: 'Allow', key: 'y', hint: 'This session may start helpers from now on' },
  { id: 'no', label: 'No, do it yourself', key: 'n', hint: 'It does the work alone' },
  { id: 'always', label: 'Always for this project', key: null, quiet: true, hint: 'Every session of this project may, from now on' },
]

/** The row a typed letter picks, whatever its case; null when no row is on that key. */
export function rowForKey<Id extends string>(rows: readonly AnswerRow<Id>[], key: string): AnswerRow<Id> | null {
  const letter = key.toLowerCase()
  return rows.find((row) => row.key !== null && row.key === letter) ?? null
}

/** Where the highlight goes for a key that moves it (the arrows, Home, End), staying inside the rows; null for any other key. */
export function movedHighlight(count: number, from: number, key: string): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown': return Math.min(count - 1, from + 1)
    case 'ArrowUp': return Math.max(0, from - 1)
    case 'Home': return 0
    case 'End': return count - 1
    default: return null
  }
}
