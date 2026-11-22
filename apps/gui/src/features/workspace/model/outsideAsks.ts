import { isChatSession } from './chatSession'
import type { SecretAsk, SessionView } from './session'
import { isShell, projectOf, rowTitle } from './sidebar'

/**
 * What a session shown as a terminal asks of the person, or has to tell them, that Maiker says outside its pane: the pane
 * is the agent's own CLI and Maiker draws nothing in it (DESIGN › *Design language*). Each one is a toast; the two
 * requests open a dialog from it.
 */
export type OutsideAsk =
  /** The session asked to start helpers and waits for the person (ADR 0016). */
  | { readonly kind: 'helpers'; readonly key: string; readonly sessionId: string; readonly tasks: readonly string[] }
  /** Its agent asked for a secret (ADR 0006). The value is never here. */
  | { readonly kind: 'secret'; readonly key: string; readonly sessionId: string; readonly ask: SecretAsk }
  /** The daemon no longer lists it, and its pane still shows what it last drew. */
  | { readonly kind: 'ended'; readonly key: string; readonly sessionId: string }

/**
 * What `session` has to say outside its pane. A plain shell that ended says nothing: a shell whose command finished is
 * the person's own terminal, and its pane's menu restarts it. A chat with no terminal has nothing to restart.
 */
export function outsideAsksOf(session: SessionView): OutsideAsk[] {
  const asks: OutsideAsk[] = []
  if (session.ended) {
    if (!isShell(session) && !isChatSession(session.conversation)) asks.push({ kind: 'ended', key: `ended:${session.id}`, sessionId: session.id })
    // An ended session can be given nothing: what it asked went with it.
    return asks
  }
  if (session.helperAsk.length > 0) asks.push({ kind: 'helpers', key: `helpers:${session.id}`, sessionId: session.id, tasks: session.helperAsk })
  for (const ask of session.secretAsk) asks.push({ kind: 'secret', key: `secret:${session.id}:${String(ask.id)}`, sessionId: session.id, ask })
  return asks
}

/** Whether `session` waits on the person for something `outsideAsksOf` says, so its own toast is the one that tells it. */
export function asksOutside(session: SessionView): boolean {
  return outsideAsksOf(session).some((ask) => ask.kind !== 'ended')
}

/** What was said of each ask at the last look, by its key: the words that would be said again. */
export type AsksSaid = ReadonlyMap<string, string>

/** What an ask says that a second look must not repeat: a request for more or other helpers is a new one. */
function sayingOf(ask: OutsideAsk): string {
  return ask.kind === 'helpers' ? ask.tasks.join('\n') : ask.kind === 'secret' ? `${ask.ask.label}\n${ask.ask.reason}` : ''
}

/**
 * The asks to say now (`raised`: new since the last look, or asking something else), the ones that are over (`gone`, by
 * key) and what this look saw. An ask already pending when the window opens is raised too: it still waits for an answer.
 */
export function asksToSay(before: AsksSaid, asks: readonly OutsideAsk[]): { said: AsksSaid; raised: OutsideAsk[]; gone: string[] } {
  const said = new Map<string, string>()
  const raised: OutsideAsk[] = []
  for (const ask of asks) {
    const saying = sayingOf(ask)
    said.set(ask.key, saying)
    if (before.get(ask.key) !== saying) raised.push(ask)
  }
  return { said, raised, gone: [...before.keys()].filter((key) => !said.has(key)) }
}

/** `Wants to start 3 helpers`. */
export function helpersRequestWords(count: number): string {
  return `Wants to start ${String(count)} helper${count === 1 ? '' : 's'}`
}

/** What an ask's toast says: the session by the name its row has, its project, and what it wants or what happened. */
export type AskToast = {
  /** `needs` waits for an answer; `warning` is news that is not a failure. */
  readonly kind: 'needs' | 'warning'
  readonly title: string
  readonly context: string
  readonly description: string
  /** The first button: what opens the answer, or the fix. */
  readonly action: string
}

export function askToastOf(ask: OutsideAsk, session: SessionView): AskToast {
  const name = rowTitle(session)
  const context = projectOf(session)
  switch (ask.kind) {
    case 'helpers':
      return { kind: 'needs', title: `${name} needs you`, context, description: helpersRequestWords(ask.tasks.length), action: 'Review' }
    case 'secret':
      return { kind: 'needs', title: `${name} needs you`, context, description: `Wants a secret: ${ask.ask.label}`, action: 'Provide…' }
    case 'ended':
      return { kind: 'warning', title: `${name} ended`, context, description: 'Its pane keeps what it last showed.', action: 'Restart shell' }
  }
}
