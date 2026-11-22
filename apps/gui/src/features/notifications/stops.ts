import type { InstallableAgent } from '@/api/agentInstall'
import { LOCAL_MACHINE } from '@/api/machines'
import { exitWords } from '@/features/chat/problem'
import { agentLabel, untilWord, type SessionView } from '@/features/workspace/model/session'
import { isShell, projectOf } from '@/features/workspace/model/sidebar'

/**
 * A stop is something that happened to a session the window shows as idle: its agent stopped (the daemon's `error`), or
 * the daemon holds it until its plan limit resets (`limited`). Neither is a question, so neither is needs you; each is
 * said once, in a toast.
 */

const ERROR_KEY = 'error:'

/** Each session's stop as the last look saw it, by a key that names the one occurrence. */
export type StopsSeen = ReadonlyMap<string, string>

/**
 * Names one occurrence of a stop from what the daemon reported, so the same stop read again (a re-render, a new list, a
 * reconnect) is the same key. Null when the session has no stop to tell: a shell whose command failed or that exited is
 * the person's own terminal, not an agent that stopped.
 */
function occurrenceOf(session: SessionView): string | null {
  if (session.status === 'limited') return `limited:${String(session.resumeAt ?? 0)}`
  if (session.status !== 'error' || isShell(session)) return null
  const exit = session.conversation.details?.exit
  return `${ERROR_KEY}${String(exit?.at ?? session.statusSince ?? 0)}:${String(exit?.code ?? '')}`
}

/**
 * The sessions whose stop is new since the last look, the ones whose stop is over (`ended`, by id), and what this look
 * saw. `before` is null until the sessions have been listed once, so opening the app tells of nothing that had already
 * happened. A session out of reach keeps the stop it had: coming back from a lost connection is not a new stop. So does
 * one still stopped that now reads as a shell: a start that never became its agent is claimed as that agent only for a
 * while, and the stop already told is still that one.
 */
export function stopsFor(before: StopsSeen | null, sessions: readonly SessionView[]): { seen: StopsSeen; stopped: SessionView[]; ended: string[] } {
  const seen = new Map<string, string>()
  const stopped: SessionView[] = []
  for (const session of sessions) {
    const known = before?.get(session.id)
    if (session.status === 'unknown') {
      if (known !== undefined) seen.set(session.id, known)
      continue
    }
    const carried = session.status === 'error' && known?.startsWith(ERROR_KEY) === true ? known : null
    const occurrence = occurrenceOf(session) ?? carried
    if (occurrence === null) continue
    seen.set(session.id, occurrence)
    if (before !== null && known !== occurrence) stopped.push(session)
  }
  return { seen, stopped, ended: [...(before?.keys() ?? [])].filter((id) => !seen.has(id)) }
}

/** The agents the app installs from its own list of commands (`api/agentInstall.ts`). */
const INSTALLABLE: ReadonlySet<string> = new Set<InstallableAgent>(['claude', 'codex', 'gemini', 'opencode'])
const isInstallable = (agent: string): agent is InstallableAgent => INSTALLABLE.has(agent)

/** What fixes a stop: installing the agent that is not on this computer, or only opening the session to look. */
export type StopFix = { readonly kind: 'install'; readonly agent: InstallableAgent; readonly label: string } | { readonly kind: 'open' }

export type StopToast = {
  readonly kind: 'error' | 'warning'
  readonly title: string
  /** The session's project. */
  readonly context: string
  readonly description: string
  readonly fix: StopFix
}

/**
 * The agent a stopped session could not start because its program is not on this computer, else null. `installed` is
 * what the host found on the PATH (null when it could not say, and then nothing is claimed); only a session on this
 * computer is judged by it.
 */
export function missingAgent(session: SessionView, installed: readonly string[] | null): InstallableAgent | null {
  const agent = session.process.toLowerCase()
  if (session.status !== 'error' || session.machine !== LOCAL_MACHINE || installed === null || !isInstallable(agent)) return null
  return installed.includes(agent) ? null : agent
}

/** What the toast for a session's stop says and offers; null when the session has no stop. */
export function stopToastOf(session: SessionView, installed: readonly string[] | null, now: number = Date.now()): StopToast | null {
  const context = projectOf(session)
  const label = agentLabel(session.process)
  if (session.status === 'limited') {
    return {
      kind: 'warning',
      title: `${label} hit its plan limit`,
      context,
      description: session.resumeAt === null ? 'It carries on by itself when the limit resets.' : `Limited ${untilWord(session.resumeAt, now)}. It carries on by itself then.`,
      fix: { kind: 'open' },
    }
  }
  if (session.status !== 'error') return null
  const missing = missingAgent(session, installed)
  if (missing !== null) {
    return {
      kind: 'error',
      title: `Couldn’t start ${label}`,
      context,
      description: `${missing} isn’t on your PATH. Install it, or use another agent for this session.`,
      fix: { kind: 'install', agent: missing, label: `Install ${label}` },
    }
  }
  return { kind: 'error', title: `${label} stopped`, context, description: exitWords(session.conversation.details?.exit?.code ?? null), fix: { kind: 'open' } }
}
