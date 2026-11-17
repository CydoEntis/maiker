import { displayName, folderNameOf, type SessionView } from '@/features/workspace/model/session'
import { projectFolder } from '@/features/tickets/model/ticketProjects'
import { isFactoryChat } from '@/features/tickets/model/tickets'

/** A chat in the project that runs a factory, as a pick lists it: its name, and where it is with how many runs go. */
export type FactoryChat = { id: string; label: string; sub: string }

/** The chats on `session`'s machine and in its project that report workflow runs and have not ended. */
export function factoryChatsOf(session: SessionView, sessions: readonly SessionView[]): FactoryChat[] {
  const folder = projectFolder(session)
  return sessions
    .filter((each) => each.machine === session.machine && projectFolder(each) === folder && !each.ended && isFactoryChat(each))
    .map((each) => ({ id: each.id, label: displayName(each), sub: `${each.repoName ?? folderNameOf(each)} · ${String(each.workflows.filter((run) => run.active).length)} running` }))
}
