import { useId, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import type { AskedQuestion, PermissionAsk } from '@/data/preview'
import type { ApprovalDecision, ApprovalEvent } from '../chatEvents'
import { ANSWER_KEY, formQuestions, ownAnswerText, type AskChoice, type FormAnswer } from '../permissionAsk'
import { alwaysAllowChoices } from '../alwaysAllow'
import type { AskedPlan } from '../planApproval'
import { PLAN_TOOL, planMenuChoices } from '../planApproval'
import { KEY_ESCAPE } from '../terminalKeys'
import { keysToPick, parseChoiceMenu, typeEach, type ScreenMenu } from '../screenMenu'
import type { TrustPrompt } from '../trustPrompt'
import type { ApprovalActions } from './ApprovalCard'
import { FileBadge } from './cardParts'
import { agentName } from '../commandCards'
import { Markdown } from './Markdown'
import { UserInputForm } from './UserInputForm'
import { TerminalPrompt } from './TerminalPrompt'
import { WaitingCard } from './WaitingCard'
import { agentLabel } from '@/features/workspace/model/session'

/** The number keys that pick a choice: 1 to 9. */
const MAX_DIGIT_KEYS = 9

/** The tool Claude asks a multiple-choice question with; it is a question to the person, not a request to act. */
const QUESTION_TOOL = 'AskUserQuestion'

const TITLE: Record<ApprovalEvent['approvalKind'], string> = {
  Command: 'Wants to run a command',
  FileChange: 'Wants to change files',
  Permission: 'Is requesting additional permissions',
  UserInput: 'Needs your input',
}

type Answer = Exclude<ApprovalDecision, 'Cancel'>

const ANSWER_LABEL: Record<Answer, string> = { Accept: 'Yes once', AcceptForSession: 'This session', Decline: 'No' }

/** One answer: the main one ("Yes once") in the needs colour, the others soft, each with the key that also gives it. */
function AnswerButton({ decision, busy, onAnswer }: { decision: Answer; busy: boolean; onAnswer: () => void }) {
  return (
    <Button variant={decision === 'Accept' ? 'needs' : 'soft'} keyHint={ANSWER_KEY[decision]} disabled={busy} aria-keyshortcuts={ANSWER_KEY[decision]} onClick={onAnswer}>
      {ANSWER_LABEL[decision]}
    </Button>
  )
}

const RUN = (send: () => Promise<void>, setBusy: (busy: boolean) => void) => {
  setBusy(true)
  send()
    .catch((error: unknown) => { toast.failed('Could not send your answer', error) })
    .finally(() => { setBusy(false) })
}

/**
 * A question the agent asks on its screen that its hooks do not report, such as trusting a new
 * folder: its text and one button per choice, each moving the terminal's cursor to the choice and
 * pressing Enter.
 */
export function ScreenMenuTray({ agent, menu, send }: { agent: string; menu: ScreenMenu; send: (keys: string[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const pick = (index: number) => { RUN(() => send(keysToPick(menu, index)), setBusy) }
  return (
    <WaitingCard
      label={`${agentLabel(agent)} is asking`}
      title={`${agentLabel(agent)} is asking`}
      foot={menu.options.map((option, index) => (
        <Button key={`${String(index)}-${option}`} variant={index === 0 ? 'needs' : 'soft'} disabled={busy} onClick={() => { pick(index) }}>{option}</Button>
      ))}
    >
      {menu.question !== '' && <p className="mx-waiting-text is-pre">{menu.question}</p>}
    </WaitingCard>
  )
}

/**
 * An agent asking whether to trust the folder it was started in. It says which folder and what trusting allows, in plain
 * words, and answers only on a click: neither button is the card's Enter default, neither is marked as the one to press,
 * and "Don't trust" comes first so that the habitual press cannot trust.
 */
export function TrustFolderTray({ agent, trust, send }: { agent: string; trust: TrustPrompt; send: (keys: string[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <WaitingCard
      label="Trust this folder?"
      title="Trust this folder?"
      aside={agent}
      foot={(
        <>
          <Button variant="soft" disabled={busy} onClick={() => { RUN(() => send(trust.declineKeys), setBusy) }}>Don’t trust</Button>
          <Button variant="soft" disabled={busy} onClick={() => { RUN(() => send(trust.trustKeys), setBusy) }}>Trust this folder</Button>
        </>
      )}
    >
      <p className="mx-waiting-text">{agentLabel(agent)} was started in a folder it has not seen before:</p>
      <pre className="mx-waiting-command">{trust.folder}</pre>
      <p className="mx-waiting-text">
        Trusting it lets {agentLabel(agent)} read and change the files there, and run commands, hooks and tools that the folder asks for. Trust it only if you know where it came from. Don’t trust closes {agent} without opening the folder.
      </p>
    </WaitingCard>
  )
}

/** What a session wants to start helpers for, and the way to answer; `answer` is absent where it cannot be sent. */
export type HelperAsk = {
  readonly tasks: readonly string[]
  readonly answer: (choice: 'allow' | 'always' | 'no') => void
}

/**
 * A session asking to start helpers. It is asked where every other request is, over the message box, and the agent's
 * start waits on the answer.
 */
export function HelpersTray({ ask, online, agent }: { ask: HelperAsk; online: boolean; agent?: string }) {
  const count = ask.tasks.length
  return (
    <WaitingCard
      label="Wants to start helpers"
      title={`Wants to start ${String(count)} helper${count === 1 ? '' : 's'}`}
      aside={agent === undefined ? undefined : agentLabel(agent)}
      onEnter={online ? () => { ask.answer('allow') } : undefined}
      foot={(
        <>
          <Button variant="needs" disabled={!online} title="This session may start helpers from now on" onClick={() => { ask.answer('allow') }}>Allow</Button>
          <Button variant="soft" disabled={!online} title="It does the work alone" onClick={() => { ask.answer('no') }}>No</Button>
          <span className="mx-spacer" />
          <Button variant="ghost" size="sm" disabled={!online} title="Every session of this project may, from now on" onClick={() => { ask.answer('always') }}>Always in this project</Button>
        </>
      )}
    >
      {ask.tasks.map((task) => <p key={task} className="mx-waiting-text">{task}</p>)}
    </WaitingCard>
  )
}

/** What a request would run or touch: the command on a well, or one badge per file. */
function RequestDetail({ event }: { event: ApprovalEvent }) {
  if (event.command !== null && event.command !== '') {
    return <pre className="mx-waiting-command"><span className="mx-step-prompt" aria-hidden="true">$ </span>{event.command}</pre>
  }
  if (event.changes.length === 0) return null
  return <div className="mx-waiting-files">{event.changes.map((change) => <FileBadge key={change.path} path={change.path} />)}</div>
}

/** A request the daemon holds for a chat it runs: answered by its id, never by typing. */
export function ApprovalTray({ event, actions, agent }: { event: ApprovalEvent; actions: ApprovalActions | null; agent?: string }) {
  const answerable = event.choices.filter((choice): choice is Answer => choice !== 'Cancel')
  const reason = event.reason !== null && event.reason !== '' ? <p className="mx-waiting-text">{event.reason}</p> : null
  const label = `Approval: ${TITLE[event.approvalKind]}`
  if (event.approvalKind === 'UserInput') {
    return (
      <WaitingCard label={label} title={agent === undefined ? TITLE.UserInput : `${agentLabel(agent)} needs your input`}>
        {reason}
        {actions !== null && event.questions.length > 0
          ? <UserInputForm questions={event.questions} busy={actions.busy} onSubmit={(answers) => { actions.answerInput(event.requestId, answers) }} />
          : <p className="mx-waiting-note">Only the agent's terminal can take this answer.</p>}
      </WaitingCard>
    )
  }
  const main = actions !== null && answerable.includes('Accept') ? () => { actions.answer(event.requestId, 'Accept') } : undefined
  const hasCommand = event.command !== null && event.command !== ''
  return (
    <WaitingCard
      label={label}
      title={event.approvalKind === 'FileChange' && event.changes.length > 0 ? `Wants to change ${String(event.changes.length)} ${event.changes.length === 1 ? 'file' : 'files'}` : TITLE[event.approvalKind]}
      aside={agent === undefined ? undefined : agentLabel(agent)}
      flush={hasCommand && reason === null}
      onEnter={main}
      foot={actions === null ? <span className="mx-waiting-note">Only the agent's terminal can take this answer.</span> : (
        <>
          {answerable.map((choice) => <AnswerButton key={choice} decision={choice} busy={actions.busy} onAnswer={() => { actions.answer(event.requestId, choice) }} />)}
          <span className="mx-spacer" />
          {event.canRemember && actions.remember !== undefined && (
            <Button variant="ghost" size="sm" disabled={actions.busy} title="Allows this exact command in this project from now on, without asking" onClick={() => { actions.remember?.(event.requestId) }}>
              Always in this project
            </Button>
          )}
        </>
      )}
    >
      {reason}
      <RequestDetail event={event} />
    </WaitingCard>
  )
}

/**
 * A numbered menu the agent draws on its own screen with no hook behind it (Claude's "Switch model?"): its words, a
 * button and a number key per choice, and Cancel for Esc. Each pick moves the terminal's cursor to the choice and presses
 * Enter, as a person's keys would. The terminal itself stays one click away under "Show terminal".
 */
export function ChoiceMenuTray({ label, title, aside, menu, send, sendKeys, readScreen }: { label: string; title: string; aside: string; menu: ScreenMenu; send: (keys: readonly string[]) => Promise<void>; sendKeys: (keys: string) => Promise<void>; readScreen: (() => Promise<string>) | undefined }) {
  const [busy, setBusy] = useState(false)
  const [terminal, setTerminal] = useState(false)
  return (
    <WaitingCard
      label={label}
      title={title}
      aside={aside}
      foot={(
        <>
          <Button variant="soft" disabled={busy} title="Esc in the terminal: closes the question without choosing" onClick={() => { RUN(() => sendKeys(KEY_ESCAPE), setBusy) }}>Cancel</Button>
          <span className="mx-spacer" />
          <Button variant="ghost" size="sm" aria-expanded={terminal} onClick={() => { setTerminal((now) => !now) }}>{terminal ? 'Hide terminal' : 'Show terminal'}</Button>
        </>
      )}
    >
      {menu.question !== '' && <p className="mx-waiting-text is-pre">{menu.question}</p>}
      <div className="mx-waiting-options" role="group" aria-label={`${aside} choices`}>
        {menu.options.map((option, index) => <Choice key={`${String(index)}-${option}`} label={option} index={index} picked={false} busy={busy} onPick={() => { RUN(() => send(keysToPick(menu, index)), setBusy) }} />)}
      </div>
      {terminal && <TerminalPrompt readScreen={readScreen} sendKeys={sendKeys} />}
    </WaitingCard>
  )
}

type PromptProps = {
  agent: string
  ask: PermissionAsk | null
  online: boolean
  /** Sends the answer to the agent's prompt; absent where the window cannot answer. */
  answer: ((choice: AskChoice) => Promise<void>) | undefined
  /** Picks the numbered choice of a question the agent asks; absent where the window cannot type for the agent. */
  pick?: ((index: number) => Promise<void>) | undefined
  /** Answers a form: what was picked or written for each question, in the prompt's order. */
  pickAll?: ((answers: readonly FormAnswer[]) => Promise<void>) | undefined
  /** Answers a lone question with the person's own words, in its "Type something" row. */
  answerOwn?: ((text: string) => Promise<void>) | undefined
  /** Types a key into the agent's terminal, for a menu the chat has no buttons for; absent where the window cannot type for the agent. */
  sendKeys?: ((keys: string) => Promise<void>) | undefined
  /** Reads the agent's terminal screen, to show that menu; absent where the screen cannot be read. */
  readScreen?: (() => Promise<string>) | undefined
  /** The plan a plan-approval prompt is about, from the conversation's history. */
  plan?: AskedPlan | null
  /** What the daemon read off the agent's screen: for a plan, Claude's own menu of what to do with it. */
  asking?: string
}

/**
 * One choice of a question: its number key, its words and a tick once picked, with no box around it. In a form it is a radio
 * button named `group`, or a checkbox when its question takes several answers (`several`).
 */
function Choice({ label, index, picked, busy, onPick, group, several = false, active = false, onHover }: { label: string; index: number; picked: boolean; busy: boolean; onPick: () => void; group?: string; several?: boolean; active?: boolean; onHover?: () => void }) {
  const body = (
    <>
      <span className="mx-option-key" aria-hidden="true">{index + 1}</span>
      <span className="mx-option-text">{label}</span>
      <span className="mx-option-tick" aria-hidden="true">{picked ? '✓' : ''}</span>
    </>
  )
  if (group === undefined) {
    return <button type="button" className="mx-option" aria-keyshortcuts={String(index + 1)} disabled={busy} onClick={onPick}>{body}</button>
  }
  return (
    <label className={`mx-option${picked ? ' is-picked' : ''}${active ? ' is-active' : ''}${several ? ' is-check' : ''}`} onMouseEnter={onHover}>
      <input type={several ? 'checkbox' : 'radio'} className="sr-only" name={group} checked={picked} disabled={busy} onChange={onPick} />
      {body}
    </label>
  )
}

/**
 * The row after a question's choices where the person writes an answer of their own, as Claude's menu offers with
 * "Type something": a box with its number key, lit once it holds words. In a form it picks the row as it is typed in.
 */
function OwnAnswer({ index, value, picked, busy, onChange, onSend, label = 'Your own answer' }: { index: number; value: string; picked: boolean; busy: boolean; onChange: (text: string) => void; onSend?: () => void; label?: string }) {
  return (
    <div className={`mx-option is-own${picked ? ' is-picked' : ''}`}>
      <span className="mx-option-key" aria-hidden="true">{index + 1}</span>
      <input
        className="mx-option-input"
        aria-label={label}
        placeholder="Or type your own answer"
        value={value}
        disabled={busy}
        onChange={(event) => { onChange(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || onSend === undefined) return
          event.preventDefault()
          onSend()
        }}
      />
      {onSend !== undefined
        ? <Button type="button" variant="needs" size="sm" disabled={busy || ownAnswerText(value) === ''} onClick={onSend}>Send</Button>
        : null}
    </div>
  )
}

const answered = (answer: FormAnswer | undefined) => answer !== undefined && (answer.picked.length > 0 || ownAnswerText(answer.own) !== '')

/** The keys a question card answers to, said in its foot. */
function keysHint(choices: number): string {
  return `1–${String(choices)} pick · ↑↓ move · ←→ question`
}

/** Whether a key press is typing into a field, where a digit or an arrow is text and not an answer. */
const inField = (target: EventTarget) => target instanceof Element && target.closest('input, textarea') !== null

/**
 * A form of questions, shown one at a time (layout 2h): a tab per question at the top, marked ✓ once answered, then
 * the question with its choices to pick from (one, or any number of them for a question that takes several), Back and
 * Next, and on the last one the button that sends them all once every question has an answer. Nothing is typed into
 * the agent until then, so an answer can be changed first.
 */
function QuestionsForm({ questions, busy, onSend }: { questions: readonly AskedQuestion[]; busy: boolean; onSend: (answers: readonly FormAnswer[]) => void }) {
  const name = useId()
  const [answers, setAnswers] = useState<readonly FormAnswer[]>(() => questions.map(() => ({ picked: [], own: '' })))
  const left = answers.filter((answer) => !answered(answer)).length
  const [step, setStep] = useState(0)
  // The choice the arrow keys are on.
  const [hi, setHi] = useState(0)
  const at = Math.min(step, questions.length - 1)
  const asked = questions[at]
  const last = at === questions.length - 1
  // One answer is a choice or the person's own words, never both; several may be both, as Claude's menu allows.
  const choose = (at: number, index: number, several: boolean) => {
    setAnswers((now) => now.map((was, place) => {
      if (place !== at) return was
      if (!several) return { picked: [index], own: '' }
      const picked = was.picked.includes(index) ? was.picked.filter((other) => other !== index) : [...was.picked, index].sort((a, b) => a - b)
      return { ...was, picked }
    }))
  }
  const write = (at: number, own: string, several: boolean) => {
    setAnswers((now) => now.map((was, place) => (place !== at ? was : { picked: several ? was.picked : [], own })))
  }
  const go = (to: number) => {
    if (to < 0 || to >= questions.length) return
    setStep(to)
    setHi(0)
  }
  // 1 to 9 pick, up and down move, left and right change question, Enter goes on: when the keys are not typing into a field.
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (busy || inField(event.target) || event.ctrlKey || event.metaKey || event.altKey || asked === undefined) return
    const several = asked.multi === true
    const count = asked.choices.length
    const digit = Number(event.key)
    if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(count, MAX_DIGIT_KEYS)) {
      event.preventDefault()
      choose(at, digit - 1, several)
      setHi(digit - 1)
      if (!several && !last) go(at + 1)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHi((now) => Math.min(count - 1, Math.max(0, now + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      go(at + (event.key === 'ArrowRight' ? 1 : -1))
    } else if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault()
      if (!last) go(at + 1)
      else if (left === 0) onSend(answers)
    }
  }
  return (
    <form
      className="mx-waiting-form"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault()
        if (left === 0 && !busy) onSend(answers)
      }}
    >
      {questions.length > 1 && (
        <div className="mx-waiting-steps" role="tablist" aria-label="Questions">
          {questions.map((each, place) => {
            const done = answered(answers[place])
            return (
              <button key={`${String(place)}-${each.question}`} type="button" role="tab" aria-selected={place === at} title={each.question} className={`mx-waiting-step${place === at ? ' is-on' : ''}${done ? ' is-done' : ''}`} onClick={() => { go(place) }}>
                <span className="mx-waiting-step-mark" aria-hidden="true">{done ? '✓' : place + 1}</span>
                <span className="mx-waiting-step-text">{each.question}</span>
              </button>
            )
          })}
        </div>
      )}
      {asked !== undefined && (
        <fieldset key={`${String(at)}-${asked.question}`} className="mx-waiting-question">
          <legend>{asked.question}{asked.multi === true && <>{' '}<span className="mx-waiting-any">Pick any</span></>}</legend>
          {asked.choices.map((choice, index) => (
            <Choice key={`${String(index)}-${choice}`} label={choice} index={index} picked={answers[at]?.picked.includes(index) === true} busy={busy} group={`${name}-${String(at)}`} several={asked.multi === true} active={hi === index} onHover={() => { setHi(index) }} onPick={() => { choose(at, index, asked.multi === true); setHi(index) }} />
          ))}
          <OwnAnswer index={asked.choices.length} value={answers[at]?.own ?? ''} picked={ownAnswerText(answers[at]?.own ?? '') !== ''} busy={busy} onChange={(text) => { write(at, text, asked.multi === true) }} />
        </fieldset>
      )}
      <div className="mx-waiting-foot is-form">
        <span className="mx-waiting-note">{keysHint(asked?.choices.length ?? 0)}</span>
        <span className="mx-spacer" />
        {at > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => { go(at - 1) }}>Back</Button>}
        {!last && <Button type="button" variant="ghost" size="sm" onClick={() => { go(at + 1) }}>Skip</Button>}
        {last
          ? <Button type="submit" variant="needs" keyHint="⏎" disabled={busy || left > 0}>{busy ? 'Sending…' : `${questions.length === 1 ? 'Send answer' : 'Send answers'}${left > 0 && questions.length > 1 ? ` (${String(left)} left)` : ''}`}</Button>
          : <Button type="button" variant="needs" keyHint="⏎" onClick={() => { go(at + 1) }}>Next</Button>}
      </div>
    </form>
  )
}

/** The head's quiet words: how many questions are still to answer. */
const sendAllAside = (questions: readonly AskedQuestion[]) => `${String(questions.length)} to answer`

/** Claude's plan, formatted as a reply would be, for the person to approve or send back. */
function PlanBody({ plan }: { plan: AskedPlan | null }) {
  if (plan === null) return <p className="mx-waiting-note">The plan is only in the agent's terminal.</p>
  return (
    <>
      <Markdown className="mx-waiting-plan" text={plan.text} />
      {plan.cut && <p className="mx-waiting-note">The history kept only the start of this plan. The rest is in the agent's terminal.</p>}
    </>
  )
}

/**
 * A plan Claude asks to leave plan mode with, and Claude's own menu for it: each choice as the terminal words it,
 * picked by its number. The menu differs between Claude versions and sessions ("Yes, and use auto mode", "Yes,
 * manually approve edits", "Tell Claude what to change" on 2.1.325), so it is read off the screen, never assumed;
 * where it cannot be read the card leaves the answer to the terminal rather than guess a key. Esc keeps planning.
 */
function PlanTray({ label, plan, asking, send, readScreen }: { label: string; plan: AskedPlan | null; asking: string; send: ((keys: string) => Promise<void>) | undefined; readScreen: (() => Promise<string>) | undefined }) {
  const [busy, setBusy] = useState(false)
  const run = (action: () => Promise<void>) => { RUN(action, setBusy) }
  const choices = send === undefined ? [] : planMenuChoices(asking)
  const press = send === undefined || choices.length === 0 ? undefined : send
  return (
    <WaitingCard
      label={label}
      title="Approve this plan?"
      aside="Plan mode"
      foot={press === undefined
        ? (send === undefined ? <span className="mx-waiting-note">Only the agent's terminal can take this answer.</span> : null)
        : <Button variant="soft" keyHint="n" aria-keyshortcuts="n" disabled={busy} title="Esc in the terminal: Claude stays in plan mode" onClick={() => { run(() => press(KEY_ESCAPE)) }}>Keep planning</Button>}
    >
      <PlanBody plan={plan} />
      {press !== undefined && (
        <div className="mx-waiting-options" role="group" aria-label="Claude's plan menu">
          {choices.map((choice, index) => <Choice key={`${String(index)}-${choice}`} label={choice} index={index} picked={false} busy={busy} onPick={() => { run(() => press(String(index + 1))) }} />)}
        </div>
      )}
      {press === undefined && send !== undefined && <TerminalPrompt readScreen={readScreen} sendKeys={send} />}
    </WaitingCard>
  )
}

/**
 * What an agent in a terminal is stopped on, from its own hook and never the screen (ADR 0003). The
 * buttons exist only where the daemon knows the keys that answer this agent; otherwise the card says
 * to answer in the terminal rather than guess.
 */
export function PromptTray({ agent, ask, online, answer, pick, pickAll, answerOwn, sendKeys, readScreen, plan = null, asking = '' }: PromptProps) {
  const [busy, setBusy] = useState(false)
  const [own, setOwn] = useState('')
  const run = (action: () => Promise<void>) => { RUN(action, setBusy) }
  const choices = ask?.choices ?? []
  const picker = choices.length > 0 && online ? pick : undefined
  const questions = formQuestions(ask)
  const sendAll = questions.length > 0 && online ? pickAll : undefined
  const canAnswer = ask !== null && ask.answerable && online && answer !== undefined
  const isQuestion = ask?.tool === QUESTION_TOOL
  const label = `${agentLabel(agent)} needs your permission`
  const mirror = sendKeys !== undefined && online ? sendKeys : undefined
  // Claude's own "don't ask again" choices, read off its menu; never offered for a question or from another agent.
  const always = canAnswer && pick !== undefined && agent === 'claude' && !isQuestion ? alwaysAllowChoices(asking) : []

  if (ask?.tool === PLAN_TOOL) return <PlanTray label={label} plan={plan} asking={asking} send={mirror} readScreen={readScreen} />

  if (sendAll !== undefined) {
    return (
      <WaitingCard label={label} title={questions.length === 1 ? `${agentName(agent)} has a question` : `${agentName(agent)} has ${String(questions.length)} questions`} aside={sendAllAside(questions)} flush>
        <QuestionsForm questions={questions} busy={busy} onSend={(picked) => { run(() => sendAll(picked)) }} />
      </WaitingCard>
    )
  }

  if (picker !== undefined) {
    return (
      <WaitingCard label={label} title={isQuestion ? `${agentName(agent)} has a question for you` : `${agentName(agent)} is asking`}>
        {ask !== null && ask.detail !== '' && <p className="mx-waiting-question-text">{ask.detail}</p>}
        <div className="mx-waiting-options">
          {choices.map((choice, index) => <Choice key={`${String(index)}-${choice}`} label={choice} index={index} picked={false} busy={busy} onPick={() => { run(() => picker(index)) }} />)}
          {isQuestion && answerOwn !== undefined && (
            <OwnAnswer index={choices.length} value={own} picked={ownAnswerText(own) !== ''} busy={busy} onChange={setOwn} onSend={() => { if (ownAnswerText(own) !== '') run(() => answerOwn(own)) }} />
          )}
        </div>
      </WaitingCard>
    )
  }

  const title = ask === null ? `${agentName(agent)} is waiting ${mirror === undefined ? 'for you' : 'in its own menu'}` : isQuestion ? `${agentName(agent)} has a question for you` : ask.tool === 'Bash' ? 'Wants to run a command' : `Wants to use ${ask.tool}`
  const detail = ask !== null && ask.detail !== '' ? ask.detail : null
  const shownDetail = detail === null ? null : isQuestion ? <p className="mx-waiting-text">{detail}</p> : <pre className="mx-waiting-command">{detail}</pre>

  // The hook reported no question, so the screen is all there is: a clean numbered menu gets buttons, anything else the terminal.
  const screenMenu = ask === null && mirror !== undefined ? parseChoiceMenu(asking) : null
  if (screenMenu !== null && mirror !== undefined) {
    return <ChoiceMenuTray label={label} title={title} aside={agent} menu={screenMenu} send={typeEach(mirror)} sendKeys={mirror} readScreen={readScreen} />
  }

  if (!canAnswer && mirror !== undefined) {
    return (
      <WaitingCard label={label} title={title} aside={agentLabel(agent)} flush>
        {shownDetail}
        <TerminalPrompt readScreen={readScreen} sendKeys={mirror} />
      </WaitingCard>
    )
  }

  return (
    <WaitingCard
      label={label}
      title={title}
      aside={agent}
      flush={detail !== null && !isQuestion}
      onEnter={canAnswer ? () => { run(() => answer('approve')) } : undefined}
      foot={canAnswer ? (
        <>
          <AnswerButton decision="Accept" busy={busy} onAnswer={() => { run(() => answer('approve')) }} />
          <AnswerButton decision="Decline" busy={busy} onAnswer={() => { run(() => answer('deny')) }} />
          {pick !== undefined && always.length > 0 && <span className="mx-spacer" />}
          {pick !== undefined && always.map((choice) => (
            <Button key={choice.index} variant="ghost" size="sm" disabled={busy} title="Claude's own choice, in its words. Claude keeps it; Maiker adds no rule." onClick={() => { run(() => pick(choice.index)) }}>
              {choice.label}
            </Button>
          ))}
        </>
      ) : <span className="mx-waiting-note">Only the agent's terminal can take this answer.</span>}
    >
      {shownDetail}
    </WaitingCard>
  )
}
