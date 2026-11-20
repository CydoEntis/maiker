import type { ReactNode } from 'react'
import type { ChipItem, ChipSection } from '@/features/workspace/components/NewChatMenus'

/** The folder menu of a session that has not started: the folders to run in, and the ways to find another one. */
export type FolderPicking = {
  search: string
  sections: readonly ChipSection[]
  /** What typing can make a row of: a pasted path, a link to clone. */
  fromQuery: (query: string) => ChipItem | null
  /** Open folder…, Clone a repository…, and the line that says what else can be typed. */
  footer: ReactNode
}

/** The branch menu of a session that has not started: a pick is kept for the start, git is not touched before it. */
export type BranchPicking = {
  /** The session starts on this branch; `create` makes it from where the checkout is. */
  onPick: (name: string, create: boolean) => void
  /** The session works in a worktree of its own. */
  worktree: boolean
  onWorktree: (on: boolean) => void
  /** The branches other sessions work on, and the session on each. */
  busy: ReadonlyMap<string, string>
  /** The menu can be opened from outside: a failed start that asks for another branch. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** The machine menu: where the session runs. `down` is why it cannot be used, in words. */
export type MachinePicking = {
  label: string
  remote: boolean
  down: string | null
  sections: readonly ChipSection[]
  footer?: ReactNode
}

/** What makes the row under a draft's box choose: before the first message the place is picked, not shown. */
export type PlacePicking = {
  machine: MachinePicking
  folder: FolderPicking
  branch: BranchPicking
  /** Why no branch can be picked (not a repository, still being read, another machine); null when one can. `workIn` is the one choice that still can be made (a worktree on another machine). */
  noBranch: { label: string; tip: string; /** Given where the worktree is still a choice (another machine). */ worktree?: { on: boolean; onChange: (on: boolean) => void } } | null
  /** The checkout's sync chip is true of what the session starts on (the folder as it is, not a new branch or worktree). */
  sync: boolean
}
