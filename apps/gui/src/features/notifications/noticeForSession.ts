import { agentLabel, askWords, displayName, STATUS_WORD, truncatePrompt, type SessionView } from '@/features/workspace/model/session'
import { abilitiesOf } from '@/features/workspace/model/agentAbilities'
import type { SessionNoticeProps } from './SessionNotice'

/** Finished and failed cards go by themselves, with a thin line showing how long is left; one that needs you waits. */
export const SELF_DISMISS_MS = 7000

type Project = { name: string } | undefined
type Handlers = {
  open: () => void
  /** Types "yes, once" into the session's own prompt; null when there is nothing to allow. */
  allow: (() => void) | null
}


/** The in-window card for a session that just needed you, finished or failed. The card may show what it is asking: it is in your own window, unlike a system notification. */
export function sessionNoticeFor(session: SessionView, _project: Project, handlers: Handlers): SessionNoticeProps | null {
  const kind = session.status
  if (kind !== 'needs' && kind !== 'done' && kind !== 'error') return null
  const name = displayName(session)
  // Claude reports what it asks through its own hooks, so its screen is never read for the card: a question
  // is not a permission prompt, and the screen text of one is the banner and whatever else is drawn around it.
  const hooked = abilitiesOf(session.process).hookedAsks
  const asked = session.ask !== null ? askWords(session.ask) : hooked || session.asking === '' ? '' : `Wants to run ${session.asking}`
  // A finished or failed card says so in its state word; a body repeating it ("finished its work") is left out.
  const body = kind === 'needs' ? (asked === '' ? `${agentLabel(session.process)} is waiting on you` : truncatePrompt(asked)) : undefined
  // Codex's keys are verified only for the screen shape the daemon marks answerable; Claude's ask is hooked.
  const answerable = hooked || abilitiesOf(session.process).sidebarNeedsAnswerable ? session.ask?.answerable === true : session.asking !== ''
  const allow = kind === 'needs' && answerable ? handlers.allow : null
  return {
    kind,
    process: session.process,
    status: kind,
    title: name,
    state: STATUS_WORD[kind],
    ...(body === undefined ? {} : { body }),
    actions: [...(allow ? [{ label: 'Allow', primary: true, onClick: allow }] : []), { label: 'Open session', onClick: handlers.open }],
    ...(kind === 'needs' ? {} : { countdownMs: SELF_DISMISS_MS }),
  }
}
