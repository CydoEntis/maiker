import { Icon } from '@/features/workspace/components/glyphs'
import { ChipMenu } from '@/features/workspace/components/NewChatMenus'
import type { PlacePicking } from './picking'
import { WorkInSwitch } from './WorkInSwitch'

type Props = { note: NonNullable<PlacePicking['noBranch']> }

/** A draft's branch chip when no branch can be picked: it says why, quietly. On another machine it still offers the worktree. */
export function NoBranchChip({ note }: Props) {
  const mark = <span className="mx-place-icon is-branch"><Icon name="branch" size={12} /></span>
  if (note.worktree !== undefined) {
    return (
      <ChipMenu title="Branch" summary={note.label} chevron={false} triggerClass="mx-place-chip is-branch is-quiet" width={300} icon={mark}
        label={<span className="mx-place-text">{note.label}</span>} heading={note.tip} sections={[]} below={<WorkInSwitch worktree={note.worktree.on} onWorktree={note.worktree.onChange} />} />
    )
  }
  // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
  return (
    <button type="button" className="mx-place-chip is-quiet" aria-disabled="true" aria-label={`Branch unavailable: ${note.label}`} title={note.tip}>
      {mark}<span className="mx-place-text">{note.label}</span>
    </button>
  )
}
