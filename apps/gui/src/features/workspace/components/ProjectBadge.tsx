import type { CSSProperties } from 'react'
import { projectColor } from '../model/sidebar'
import { badgeLetters } from '../model/sidebarTree'
import { Icon } from './glyphs'

/** The folder drawn in the No project group's plain mark, inside the 18px badge. */
const LOOSE_MARK_PX = 11

/**
 * A project's badge: two letters of its name (`badgeLetters`) on a tint of one of the project colours, chosen from the
 * name so a project is the same colour wherever it is listed. The No project group (`loose`) is no project, so it has a
 * plain folder in the muted grey instead of letters and a colour. Decoration: the name beside it says which it is.
 */
export function ProjectBadge({ name, loose = false }: { name: string; loose?: boolean }) {
  if (loose) return <span className="mx-sb-badge is-loose" aria-hidden="true"><Icon name="folder" size={LOOSE_MARK_PX} /></span>
  return <span className="mx-sb-badge" style={{ '--badge': projectColor(name) } as CSSProperties} aria-hidden="true">{badgeLetters(name)}</span>
}
