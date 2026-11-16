import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loadGitHubAccounts } from '@/api/githubAccounts'
import { queueFollowUp } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import type { TicketDetail, TicketSummary } from '@/api/tickets'
import { DEFAULT_PICK } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { terminalSendOperation } from '@/features/chat/sendOperation'
import { sendAgentMessage } from '@/features/workspace/model/agentMessage'
import { displayName, folderNameOf, type SessionView } from '@/features/workspace/model/session'
import { useWorkspace } from '@/features/workspace/workspaceContext'
import { toast } from '@/lib/toast'
import { errorMessage } from '@/lib/error-message'
import { projectFolder, ticketProjectOf, type TicketsProject } from './model/ticketProjects'
import { isKitchenChat, kitchenCommand, kitchenRunOf, ticketKey } from './model/tickets'
import { NEW_KITCHEN, type KitchenTarget, type StartChoice } from './TicketDialogs'
import { TicketsPage, type TicketsHost } from './TicketsPage'

/** Leaves each command with a chat's daemon, typed in turn as the agent finishes the one before. */
async function queueAll(session: Pick<SessionView, 'id'>, commands: readonly string[]): Promise<void> {
  for (const command of commands) await queueFollowUp(session, command, false, terminalSendOperation())
}

/**
 * Tickets over the chat area for the chat in front, wired to the window: starting an agent opens a new chat (in a new
 * worktree when asked) named after the ticket, Send to this chat sends the framed ticket into the chat in front, and
 * Send to Kitchen leaves Kitchen's own run command with a chat that runs it, or a new one.
 */
/** How long Tickets takes to slide out (`--panel-out`). */
export const TICKETS_EXIT_MS = 220

/** `suggestedLink`: a link the setup's paste box starts with (`TicketSetupProps.suggestedLink`); nothing is saved until the person presses Use link. */
export function TicketsOverlay({ leaving, suggestedLink }: { leaving: boolean; suggestedLink?: string | undefined }) {
  const { focusedSession, sessions, root, preferences, setTicketsOpen, setSettingsSection, signInGitHub, startNewChat, saveName, showSessionById, paneViews } = useWorkspace()
  const github = useQuery({ queryKey: ['tickets', 'github-login'], queryFn: () => loadGitHubAccounts(LOCAL_MACHINE), retry: false, staleTime: Infinity })
  const session = focusedSession ?? null
  const project: TicketsProject | null = session === null ? null : ticketProjectOf(session)
  const kitchenChats = useMemo<KitchenTarget[]>(() => {
    if (session === null) return []
    const folder = projectFolder(session)
    return sessions
      .filter((each) => each.machine === session.machine && projectFolder(each) === folder && !each.ended && isKitchenChat(each))
      .map((each) => ({ id: each.id, label: displayName(each), sub: `${each.repoName ?? folderNameOf(each)} · ${String(each.workflows.filter((run) => run.active).length)} running` }))
  }, [session, sessions])
  if (project === null || session === null) {
    return (
      <div className={`mx-tk${leaving ? ' is-leaving' : ''}`} data-label="Tickets page">
        <div className="mx-tk-head"><span className="mx-tk-head-title">Tickets</span><span className="mx-spacer" /><button type="button" className="mx-tk-x" aria-label="Close" onClick={() => { setTicketsOpen(false) }}>✕</button></div>
        <div className="mx-tk-none"><span className="mx-tk-none-title">Open a chat first</span><span className="mx-tk-none-sub">Tickets shows the tickets of the project the chat in front works in.</span></div>
      </div>
    )
  }
  const openWork = (id: string) => {
    setTicketsOpen(false)
    showSessionById(id)
    paneViews.showWork(id)
  }
  const host: TicketsHost = {
    container: root,
    defaultAgent: preferences.defaultAgent,
    githubLogin: github.data?.accounts.find((account) => account.active)?.login ?? github.data?.accounts[0]?.login ?? null,
    kitchenChats,
    runOf: (key) => kitchenRunOf(sessions, key),
    canSendHere: session.process !== '' && !session.ended,
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
    onSendHere: async (ticket: TicketDetail, text: string) => {
      await sendAgentMessage(session, text)
      toast.success(`Sent ${ticketKey(ticket)} to this chat`)
    },
    onSendKitchen: async (target: string, chosen: readonly TicketSummary[]) => {
      const fresh = chosen.filter((ticket) => kitchenRunOf(sessions, ticketKey(ticket)) === null)
      if (fresh.length === 0) {
        toast.message('Already in Kitchen')
        return
      }
      const commands = fresh.map(kitchenCommand)
      if (target !== NEW_KITCHEN) {
        const chat = sessions.find((each) => each.id === target)
        if (chat === undefined) throw new Error('That Kitchen chat has closed')
        await queueAll(chat, commands)
        toast.success(`Sent ${String(fresh.length)} to ${displayName(chat)}`, { action: { label: 'Open Work', onClick: () => { openWork(chat.id) } } })
        return
      }
      const [first, ...rest] = commands
      if (first === undefined) return
      await startNewChat({ folder: project.folder, agent: 'claude', model: DEFAULT_PICK, reasoning: DEFAULT_PICK, mode: 'default', message: first, branch: null, machine: project.machine, machineName: session.machineName ?? 'This computer', resume: null }, {
        background: true,
        onPlaced: (id) => {
          saveName(id, `Kitchen: ${fresh.length === 1 ? ticketKey(fresh[0] ?? { id: '', url: '' }) : `${String(fresh.length)} tickets`}`)
          queueAll({ id }, rest).catch((error: unknown) => { toast.error(errorMessage(error, 'Could not queue the other tickets')) })
          toast.success(`Sent ${String(fresh.length)} to a new Kitchen chat`, { action: { label: 'Open Work', onClick: () => { openWork(id) } } })
        },
      })
    },
    onOpenWork: openWork,
  }
  return <TicketsPage key={project.linkKey} project={project} host={host} leaving={leaving} suggestedLink={suggestedLink} />
}
