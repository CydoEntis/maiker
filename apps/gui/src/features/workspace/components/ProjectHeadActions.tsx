import type { MouseEvent } from 'react'
import { Icon } from './glyphs'
import type { ProjectCommands } from './projectMenu'

/** The glyphs' size in a project heading's buttons, a step under the machine heading's +. */
const ACTION_ICON_PX = 13

type Props = {
  /** The project's name, for each button's label. */
  name: string
  commands: ProjectCommands
  /** Opens the heading's menu under the ⋯ button: the right-click menu, so the keyboard reaches all of it. */
  onMore: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * The buttons at the right of a project heading, shown while the pointer or focus is on it: New session, New worktree (a
 * git project of this computer), and ⋯ for the heading's menu, which also holds Close project.
 */
export function ProjectHeadActions({ name, commands, onMore }: Props) {
  const { newSession, newWorktree } = commands
  return (
    <span className="mx-project-actions">
      <button type="button" className="mx-head-button mx-project-action" aria-label={`New session in ${name}`} title={newSession.label} disabled={newSession.disabled} onClick={newSession.run}><Icon name="plus" size={ACTION_ICON_PX} /></button>
      {newWorktree !== null && <button type="button" className="mx-head-button mx-project-action" aria-label={`New worktree in ${name}`} title="New worktree" disabled={newWorktree.disabled} onClick={newWorktree.run}><Icon name="worktree" size={ACTION_ICON_PX} /></button>}
      <button type="button" className="mx-head-button mx-project-action" aria-label={`More for ${name}`} aria-haspopup="menu" title="More" onClick={onMore}><Icon name="more" size={ACTION_ICON_PX} /></button>
    </span>
  )
}
