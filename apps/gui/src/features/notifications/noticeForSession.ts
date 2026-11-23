import { agentLabel, askWords, displayName, STATUS_WORD, truncatePrompt, type SessionView } from '@/features/workspace/model/session'
import { abilitiesOf } from '@/features/workspace/model/agentAbilities'
import type { Notice } from './notify'

type Project = { name: string } | undefined
type Handlers = {
  open: () => void
  /** Types "yes, once" into the session's own prompt; null when there is nothing to allow. */
  allow: (() => void) | null
}


/**
 * The in-window toast for a session that just needed you or finished. It may show what it is asking: it is in your
 * own window, unlike a system notification. A finished one goes by itself; one that needs you waits. A session that
 * stopped has a toast of its own, with the fix (`stops.ts`), so none is made here.
 */
export function sessionNoticeFor(session: SessionView, _project: Project, handlers: Handlers): Notice | null {
  const kind = session.status
  if (kind !== 'needs' && kind !== 'done') return null
  const name = displayName(session)
  // Claude reports what it asks through its own hooks, so its screen is never read for the card: a question
  // is not a permission prompt, and the screen text of one is the banner and whatever else is drawn around it.
  const hooked = abilitiesOf(session.process).hookedAsks
  const asked = session.ask !== null ? askWords(session.ask) : hooked || session.asking === '' ? '' : `Wants to run ${session.asking}`
  // A finished card says so in its state word; a body repeating it ("finished its work") is left out.
  const body = kind === 'needs' ? (asked === '' ? `${agentLabel(session.process)} is waiting on you` : truncatePrompt(asked)) : undefined
  // Codex's keys are verified only for the screen shape the daemon marks answerable; Claude's ask is hooked.
  const answerable = hooked || abilitiesOf(session.process).sidebarNeedsAnswerable ? session.ask?.answerable === true : session.asking !== ''
  const allow = kind === 'needs' && answerable ? handlers.allow : null
  return {
    kind,
    title: name,
    state: STATUS_WORD[kind],
    ...(body === undefined ? {} : { body }),
    actions: [...(allow ? [{ label: 'Allow', primary: true, onClick: allow }] : []), { label: 'Open session', onClick: handlers.open }],
  }
}
