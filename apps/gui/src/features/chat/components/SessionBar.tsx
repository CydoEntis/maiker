import type { ReactNode } from 'react'
import { Monitor } from 'lucide-react'
import { Icon } from '@/features/workspace/components/glyphs'

/** Where a session runs, as the session list already knows it. The view never reads git for it. */
export type SessionPlace = {
  /** The machine's name when it is not this computer; null on this computer, where only the icon shows. */
  machine: string | null
  /** The project (repository) name, or the folder's when there is no repository. */
  project: string
  /** The branch the daemon reports; null outside git. */
  branch: string | null
  /** The session works in a linked worktree. */
  worktree: boolean
  /** The full folder path, for the hover tooltip. */
  folder?: string | undefined
}

type Props = {
  /** Without it (the place is not known) the row holds the controls alone. */
  place?: SessionPlace | undefined
  /** The controls at the right (usage meters, model, permissions): the chat and the terminal each bring their own. */
  children?: ReactNode
}

/**
 * The one row under a session's input: machine, project and branch at the left, the session's controls at the right.
 * It knows nothing of chat or terminal internals, so both views draw the same row (docs/DESIGN.md, Under the box).
 */
export function SessionBar({ place, children }: Props) {
  return (
    <div className="mx-session-bar" data-screen-label="Under the box">
      {place !== undefined && <Place place={place} />}
      <span className="mx-spacer" />
      {children}
    </div>
  )
}

function Place({ place }: { place: SessionPlace }) {
  return (
    <span className="mx-session-place" role="group" aria-label="Session location" title={place.folder}>
      <span className="mx-session-machine">
        <Monitor size={13} strokeWidth={1.8} aria-hidden="true" />
        {place.machine !== null && <span>{place.machine}</span>}
      </span>
      <span className="mx-session-project">
        <Icon name="folderPlain" size={13} />
        <span className="mx-session-project-name">{place.project}</span>
      </span>
      {place.branch !== null && (
        <>
          <span className="mx-session-sep" aria-hidden="true">/</span>
          <span className="mx-session-branch">
            <Icon name="branch" size={12} />
            <span className="mx-session-branch-name">{place.branch}</span>
            {place.worktree && <span className="mx-session-tag">worktree</span>}
          </span>
        </>
      )}
    </span>
  )
}
