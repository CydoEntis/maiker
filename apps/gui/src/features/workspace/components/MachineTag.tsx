import type { MouseEvent } from 'react'
import { downSentence, machineTitle, type MachineHead } from '../model/machines'
import { MachineIcon } from './glyphs'

/** The server mark inside a tag. */
const MARK_PX = 10

type Props = {
  head: MachineHead
  /** How far an install or update of the machine has got, 0 to 100, while one runs. */
  progress?: number | undefined
  /** Opens the machine's menu under the tag. */
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * The tag on a project of another machine: the machine's name, amber while that machine is not connected. Its tooltip is
 * the host's one sentence for what failed (ADR 0017), and it opens the machine's menu, where Retry and the other fixes are.
 */
export function MachineTag({ head, progress, onMenu }: Props) {
  const label = machineTitle(head)
  return (
    <button
      type="button"
      className={`mx-sb-tag${head.down ? ' is-down' : ''}`}
      aria-haspopup="menu"
      aria-label={`${label}, ${progress !== undefined ? `updating, ${String(progress)}%` : head.down ? 'not connected' : 'connected'}`}
      title={head.down ? downSentence(head) : `Runs on ${label}`}
      onClick={onMenu}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onMenu(event) }}
    >
      <MachineIcon remote size={MARK_PX} />
      <span className="mx-sb-tag-name">{label}</span>
      {progress !== undefined && <span className="mx-sb-tag-progress">{`${String(progress)}%`}</span>}
    </button>
  )
}
