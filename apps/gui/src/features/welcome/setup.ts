import type { PaneView } from '@/features/workspace/model/chatView'

export const SETUP_STEPS = ['Welcome', 'Agents', 'Your style', 'Your view', 'Review'] as const
export const STEP_WELCOME = 0
export const STEP_AGENTS = 1
export const STEP_STYLE = 2
export const STEP_VIEW = 3
export const STEP_REVIEW = 4

/** The agent programs the setup lists, by the name `agents_installed` finds them under. Gemini has no chat view. */
export const SETUP_AGENTS: ReadonlyArray<{ program: string; label: string; detail: string; installable: boolean }> = [
  { program: 'claude', label: 'Claude Code', detail: 'Anthropic’s coding agent', installable: true },
  { program: 'codex', label: 'Codex', detail: 'OpenAI’s coding agent', installable: true },
  { program: 'gemini', label: 'Gemini', detail: 'Google’s coding agent · terminal only', installable: true },
  { program: 'opencode', label: 'OpenCode', detail: 'Open-source agent for any model', installable: true },
  // Not on the desktop shell's install list (src-tauri/src/agent_install.rs), so it is listed but never offered an Install.
  { program: 'cursor-agent', label: 'Cursor', detail: 'Cursor’s agent in your terminal', installable: false },
]

export const agentLabel = (program: string): string => SETUP_AGENTS.find((agent) => agent.program === program)?.label ?? program

type StyleOption = {
  value: string
  title: string
  detail: string
  /** The small mark above the title. */
  icon: string
  /** The view this answer points to. */
  points: PaneView
  /** The answer as the person says it, for the sentence that explains the recommendation ("work in a terminal"). */
  quote: string
}

export type StyleQuestion = { id: string; question: string; options: readonly StyleOption[] }

export const STYLE_QUESTIONS: readonly StyleQuestion[] = [
  { id: 'where', question: 'Where do you spend most of your day?', options: [
    { value: 'terminal', title: 'In a terminal', detail: 'tmux, vim, the shell', icon: '>_', points: 'terminal', quote: 'work in a terminal' },
    { value: 'editor', title: 'In an editor', detail: 'VS Code, Cursor, JetBrains', icon: '▢', points: 'chat', quote: 'work in an editor' },
    { value: 'all', title: 'All over', detail: 'Browser, chat, docs', icon: '○', points: 'chat', quote: 'work all over the place' },
  ] },
  { id: 'run', question: 'When an agent wants to run a command, you’d rather…', options: [
    { value: 'raw', title: 'See the raw output', detail: 'and decide from that', icon: '$', points: 'terminal', quote: 'see the raw output' },
    { value: 'summary', title: 'Get a clear summary', detail: 'and click Allow or Deny', icon: '!', points: 'chat', quote: 'get a clear summary' },
  ] },
  { id: 'diff', question: 'How do you like to review changes?', options: [
    { value: 'shell', title: 'git diff in the shell', detail: 'I know the tools', icon: '±', points: 'terminal', quote: 'review changes with git diff in the shell' },
    { value: 'readable', title: 'Readable diffs', detail: 'folded steps I can open', icon: '⇆', points: 'chat', quote: 'see readable diffs' },
  ] },
]

/** Answers by question id; a question left alone has no entry. */
export type StyleAnswers = Readonly<Record<string, string>>

const answeredOptions = (answers: StyleAnswers): StyleOption[] =>
  STYLE_QUESTIONS.flatMap((question) => question.options.filter((option) => option.value === answers[question.id]))

export const allAnswered = (answers: StyleAnswers): boolean => STYLE_QUESTIONS.every((question) => answers[question.id] !== undefined)

/** How many answers must point to a view for it to be recommended. */
const ANSWERS_NEEDED = 2

/** The view two or more answers point to; Chat when no view has two. */
export function recommendView(answers: StyleAnswers): PaneView {
  return answeredOptions(answers).filter((option) => option.points === 'terminal').length >= ANSWERS_NEEDED ? 'terminal' : 'chat'
}

const VIEW_NAME: Record<PaneView, string> = { terminal: 'Terminal', chat: 'Chat' }
export const viewName = (view: PaneView): string => VIEW_NAME[view]

const VIEW_RESULT: Record<PaneView, string> = {
  terminal: 'so sessions open as each agent’s own CLI, exactly as it ships.',
  chat: 'so sessions open as a clean conversation with approvals you click.',
}
const DEFAULT_REASON = 'Chat is a clean conversation with approvals you click. Terminal is each agent’s own CLI.'

function joinWords(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`
}

/** One sentence that quotes the person's own answers that led to the recommendation. */
export function recommendationReason(answers: StyleAnswers): string {
  const view = recommendView(answers)
  const quotes = answeredOptions(answers).filter((option) => option.points === view).map((option) => option.quote)
  return quotes.length === 0 ? DEFAULT_REASON : `You said you ${joinWords(quotes)}, ${VIEW_RESULT[view]}`
}

/** The note under the two previews: a changed mind is fine, where to change it later, and Gemini's terminal. */
export function viewNote(chosen: PaneView, recommended: PaneView, geminiInstalled: boolean): string {
  const parts = [
    chosen === recommended ? '' : `You picked ${VIEW_NAME[chosen]} over our suggestion. That works too.`,
    'You can change this any time in Settings.',
    geminiInstalled && chosen === 'chat' ? 'Gemini has no chat view, so Gemini sessions open in Terminal.' : '',
  ]
  return parts.filter((part) => part !== '').join(' ')
}

/** What the primary button says on a step. */
export function nextLabel(step: number, answers: StyleAnswers): string {
  if (step === STEP_REVIEW) return 'Get started'
  if (step === STEP_STYLE) return allAnswered(answers) ? 'See my recommendation' : 'Skip questions'
  return 'Continue'
}
