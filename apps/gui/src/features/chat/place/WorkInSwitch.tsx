import { Switch } from '@/components/ui/switch'

/** Under a draft's branch list: whether the session works in a worktree of its own instead of the checkout. A switch, as it is one choice beside the list's own. */
export function WorkInSwitch({ worktree, onWorktree }: { worktree: boolean; onWorktree: (on: boolean) => void }) {
  return (
    <label className="mx-chip-switch">
      <Switch aria-label="Own worktree" checked={worktree} onCheckedChange={onWorktree} />
      <span><strong>Own worktree</strong><small>Its own copy on a new branch. Your checkout stays untouched.</small></span>
    </label>
  )
}
