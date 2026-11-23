import type { CSSProperties } from 'react'
import { projectColor } from '../model/sidebar'
import { badgeLetters } from '../model/sidebarTree'

/**
 * A project's badge: two letters of its name (`badgeLetters`) on a tint of one of the project colours, chosen from the
 * name so a project is the same colour wherever it is listed. Decoration: the name beside it says which project it is.
 */
export function ProjectBadge({ name }: { name: string }) {
  return <span className="mx-sb-badge" style={{ '--badge': projectColor(name) } as CSSProperties} aria-hidden="true">{badgeLetters(name)}</span>
}
