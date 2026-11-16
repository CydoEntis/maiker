import type { AskedQuestion, PermissionAsk } from '@/data/preview'
import type { ApprovalDecision } from './chatEvents'

/** Each answer to a request the chat runs, and the key that gives it: the same letters as typing into the terminal. */
export const ANSWER_KEY: Readonly<Record<Exclude<ApprovalDecision, 'Cancel'>, string>> = { Accept: 'y', AcceptForSession: 'a', Decline: 'n' }

/** How a person answers an agent's permission prompt from the chat. */
export type AskChoice = 'approve' | 'deny'

/**
 * The keys that answer Claude Code's permission menu, checked against Claude Code 2.1.319 (see
 * docs/agent-status.md): the menu numbers its choices with "Yes" first, so `1` allows once; Esc
 * refuses. `y` and `n` do nothing there.
 */
export const ANSWER_KEYS: Record<AskChoice, string> = { approve: '1', deny: '\x1b' }

/**
 * The keys that answer Codex's command and file-change approval menus, checked against codex-cli
 * 0.166.0 in a terminal: `y` ("Yes, proceed") ran the command or applied the patch once, Esc ("No,
 * and tell Codex what to do differently") ran and changed nothing. The daemon marks a Codex prompt
 * answerable only while its screen is that menu (`codex_prompt_answerable`), so any other Codex
 * prompt falls back to the terminal's own menu and the arrow-key row.
 */
export const CODEX_ANSWER_KEYS: Record<AskChoice, string> = { approve: 'y', deny: '\x1b' }

/**
 * The key that picks a choice of a question Claude asks: its menu numbers the choices from 1, so the
 * number is the key. The menu also lists "Type something" and "Chat about this" after them, which
 * are left to the terminal.
 */
export const choiceKey = (index: number): string => String(index + 1)

/**
 * The questions the chat answers as one form: a prompt's questions with one answer each when it asks several, else
 * its form (a prompt with a question that takes several answers, even a lone one). Empty for any other prompt.
 */
export function formQuestions(ask: PermissionAsk | null | undefined): readonly AskedQuestion[] {
  const form = ask?.form ?? []
  if (form.length > 0) return form
  const questions = ask?.questions ?? []
  return questions.length > 1 ? questions : []
}

/**
 * The keys that answer a form, checked against Claude Code 2.1.325, in the order the prompt shows the questions. A
 * question with one answer takes its choice's number, which moves the prompt on; one with several answers takes the
 * number of each choice, which ticks it and stays, then →, which moves on. Last comes `1`, "Submit answers" on the
 * page that reviews them.
 */
export function answerKeys(questions: readonly AskedQuestion[], picked: readonly (readonly number[])[]): string[] {
  const keys = questions.flatMap((question, at) => {
    const chosen = (picked[at] ?? []).map(choiceKey)
    return question.multi === true ? [...chosen, NEXT_QUESTION_KEY] : chosen.slice(0, 1)
  })
  return [...keys, SUBMIT_ANSWERS_KEY]
}
/** → in a terminal: moves a question prompt on from a question that takes several answers. */
const NEXT_QUESTION_KEY = '\x1b[C'
const SUBMIT_ANSWERS_KEY = '1'
/** The prompt redraws after each key; the next one waits this long, so it lands on the question that follows. */
export const ANSWER_STEP_MS = 250
