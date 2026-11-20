import { StatusIcon } from '@/components/ui/status-icon'
import { Tag } from '@/components/ui/tag'
import { machineLabel } from '@/data/machineNicknames'
import { agentName } from '../model/agentMessage'
import { STATUS_WORD, type SessionView } from '../model/session'

/**
 * The header's left: the status mark, the machine the session runs on (a remote one only; a session here needs no tag),
 * and the whole path. The path is cut from its start when it is too long, so the folder it ends in stays in view: the box
 * reads right to left, and `<bdi>` keeps the path itself reading left to right.
 */
export function PaneHeadId({ session }: { session: Pick<SessionView, 'status' | 'process' | 'machineName' | 'cwd'> }) {
  return (
    <>
      <span className="mx-pane-mark" role="img" aria-label={`${agentName(session.process)} · ${STATUS_WORD[session.status]}`}>
        <StatusIcon status={session.status} />
      </span>
      {session.machineName !== null && <Tag className="mx-pane-machine">{machineLabel(session.machineName)}</Tag>}
      <span className="mx-pane-path" title={session.cwd}><bdi>{session.cwd}</bdi></span>
    </>
  )
}
