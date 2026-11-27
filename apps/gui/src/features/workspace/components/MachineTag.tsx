import type { CSSProperties, MouseEvent } from 'react'
import { downSentence, machineTitle, UPDATE_WORDS, type MachineHead } from '../model/machines'
import { machineColor } from '../model/sidebar'
import { MachineIcon } from './glyphs'

/** The server mark inside a tag. */
const MARK_PX = 10

type Props = {
  head: MachineHead
  /** How far an install or update of the machine has got, 0 to 100, while one runs. */
  progress?: number | undefined
  /** Opens the machine's menu under the tag. */
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void
  /** Installs or updates Maiker there, for a machine that cannot connect until it is. */
  onUpdate: () => void
}

/**
 * The tag on a project of another machine: the machine's mark and name in its own colour (`machineColor`), amber while that machine is not connected. Its tooltip is
 * the host's one sentence for what failed (ADR 0017), and it opens the machine's menu, where Retry and the other fixes are.
 * A machine that only needs Maiker installed or updated is not offline: the tag says so, and its Install or Update button
 * sits right beside it, since that is the one thing that brings the machine back.
 */
export function MachineTag({ head, progress, onMenu, onUpdate }: Props) {
  const label = machineTitle(head)
  const fix = head.down && progress === undefined ? head.updateAction : null
  const state = progress !== undefined ? `updating, ${String(progress)}%` : fix !== null ? UPDATE_WORDS[fix].state : head.down ? 'not connected' : 'connected'
  return (
    <>
    <button
      type="button"
      className={`mx-sb-tag${head.down ? ' is-down' : ''}`}
      style={{ '--machine': machineColor(head.name ?? label) } as CSSProperties}
      aria-haspopup="menu"
      aria-label={`${label}, ${state}`}
      title={head.down ? downSentence(head) : `Runs on ${label}`}
      onClick={onMenu}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onMenu(event) }}
    >
      <MachineIcon remote size={MARK_PX} />
      <span className="mx-sb-tag-name">{label}</span>
      {progress !== undefined && <span className="mx-sb-tag-progress">{`${String(progress)}%`}</span>}
    </button>
    {fix !== null && (
      <button type="button" className="mx-sb-tag-fix" title={downSentence(head)} aria-label={`${UPDATE_WORDS[fix].verb} Maiker on ${label}`} onClick={onUpdate}>
        {UPDATE_WORDS[fix].verb}
      </button>
    )}
    </>
  )
}
