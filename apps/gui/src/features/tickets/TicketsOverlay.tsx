import { LOCAL_MACHINE } from '@/api/machines'
import type { TicketDetail } from '@/api/tickets'
import { DEFAULT_PICK } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { useWorkspace } from '@/features/workspace/workspaceContext'
import { toast } from '@/lib/toast'
import { ticketProjectOf, type TicketsProject } from './model/ticketProjects'
import { ticketKey } from './model/tickets'
import type { StartChoice } from './TicketDialogs'
import { TicketsPage, type TicketsHost } from './TicketsPage'

/**
 * Tickets over the chat area for the chat in front, wired to the window: starting an agent opens a new chat (in a new
 * worktree when asked) named after the ticket.
 */
/** How long Tickets takes to slide out (`--panel-out`). */
export const TICKETS_EXIT_MS = 220

export function TicketsOverlay({ leaving }: { leaving: boolean }) {
  const { focusedSession, root, preferences, setTicketsOpen, setSettingsSection, signInGitHub, startNewChat, saveName, showSessionById, ticketSetup } = useWorkspace()
  const session = focusedSession ?? null
  const project: TicketsProject | null = session === null ? null : ticketProjectOf(session)
  if (project === null || session === null) {
    return (
      <div className={`mx-tk${leaving ? ' is-leaving' : ''}`} data-label="Tickets page">
        <div className="mx-tk-head"><span className="mx-tk-head-title">Tickets</span><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Close" onClick={() => { setTicketsOpen(false) }}>✕</button></div>
        <div className="mx-tk-none"><span className="mx-tk-none-title">Open a chat first</span><span className="mx-tk-none-sub">Tickets shows the tickets of the project the chat in front works in.</span></div>
      </div>
    )
  }
  const host: TicketsHost = {
    container: root,
    defaultAgent: preferences.defaultAgent,
    onClose: () => { setTicketsOpen(false) },
    onSettings: () => { setSettingsSection('tickets') },
    onSignInGitHub: () => { signInGitHub(LOCAL_MACHINE, 'This computer') },
    onStart: async (ticket: TicketDetail, choice: StartChoice) => {
      const key = ticketKey(ticket)
      await startNewChat({
        folder: project.folder,
        agent: choice.agent,
        model: DEFAULT_PICK,
        reasoning: DEFAULT_PICK,
        mode: 'default',
        message: choice.message,
        branch: choice.worktree ? { name: choice.branch, create: true, worktree: true } : null,
        machine: project.machine,
        machineName: session.machineName ?? 'This computer',
        resume: null,
      }, {
        background: true,
        onPlaced: (id) => {
          saveName(id, `${key} ${ticket.title}`)
          toast.success(`Started ${AGENT_LABEL[choice.agent]} on ${key}`, { action: { label: 'Open chat', onClick: () => { setTicketsOpen(false); showSessionById(id) } } })
        },
      })
    },
  }
  return <TicketsPage key={project.linkKey} project={project} host={host} leaving={leaving} setupAsk={ticketSetup} />
}
