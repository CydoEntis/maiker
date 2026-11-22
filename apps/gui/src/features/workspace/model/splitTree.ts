/**
 * A session's own terminal panes (the Terminal view's splits): a small binary tree per session. A leaf is the agent's
 * pane (`AGENT_LEAF`) or the id of a shell that belongs to the session; a branch divides its room between two subtrees.
 * Splitting replaces a leaf with a branch, closing replaces a branch with its other child. The shells are the daemon's
 * sessions; only this arrangement is the window's.
 */
export const AGENT_LEAF = 'm'

/** The most panes one session holds, its agent's included. */
export const MAX_SESSION_PANES = 6

const HALF = 0.5
/** The least share of a branch either side keeps, so a pane can never be dragged shut. */
const MIN_RATIO = 0.15

export type SplitDir = 'right' | 'down'
/** `ratio` is the share of the branch's room that `a` takes (the left side of `right`, the top of `down`). */
export type SplitBranch = { dir: SplitDir; a: SplitTree; b: SplitTree; ratio: number }
export type SplitTree = string | SplitBranch

/** `focus` is the leaf the keys go to; `numbers` is each shell's `Split n`, kept while the shell lives. */
export type SessionSplits = { tree: SplitTree; focus: string; numbers: Readonly<Record<string, number>> }

/** A session with no splits: its agent's pane alone. */
export const UNSPLIT: SessionSplits = { tree: AGENT_LEAF, focus: AGENT_LEAF, numbers: {} }

/** Where a pane sits in its session's room, as shares of it (0 to 1). */
export type PaneRect = { id: string; x: number; y: number; w: number; h: number }
/** The line between a branch's two sides: `path` names the branch (`a`/`b` steps from the root), the rect is the branch's own room. */
export type Divider = { path: string; dir: SplitDir; ratio: number; x: number; y: number; w: number; h: number }

const isLeaf = (tree: SplitTree): tree is string => typeof tree === 'string'

/** The panes in reading order: a branch's first side before its second. */
export function leavesOf(tree: SplitTree): string[] {
  return isLeaf(tree) ? [tree] : [...leavesOf(tree.a), ...leavesOf(tree.b)]
}

function clampRatio(ratio: number): number {
  return Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, ratio))
}

function lowestFree(taken: readonly number[]): number {
  let n = 1
  while (taken.includes(n)) n += 1
  return n
}

function replaceLeaf(tree: SplitTree, id: string, branch: SplitBranch): SplitTree {
  if (isLeaf(tree)) return tree === id ? branch : tree
  return { ...tree, a: replaceLeaf(tree.a, id, branch), b: replaceLeaf(tree.b, id, branch) }
}

/**
 * Halves the pane `leaf`: it keeps the first half and the new shell `id` takes the other, with the focus and the
 * lowest free `Split n`. Unchanged when the session is full, `leaf` is not one of its panes, or `id` already is.
 */
export function splitLeaf(splits: SessionSplits, leaf: string, dir: SplitDir, id: string): SessionSplits {
  const leaves = leavesOf(splits.tree)
  if (leaves.length >= MAX_SESSION_PANES || !leaves.includes(leaf) || leaves.includes(id) || id === AGENT_LEAF) return splits
  const tree = replaceLeaf(splits.tree, leaf, { dir, a: leaf, b: id, ratio: HALF })
  return { tree, focus: id, numbers: { ...splits.numbers, [id]: lowestFree(Object.values(splits.numbers)) } }
}

/** `tree` without the leaf `id`, and the pane that took its room: the nearest one of the side that stays. */
function dropLeaf(tree: SplitTree, id: string): { tree: SplitTree; heir: string | null } {
  if (isLeaf(tree)) return { tree, heir: null }
  if (tree.a === id) return { tree: tree.b, heir: leavesOf(tree.b)[0] ?? null }
  if (tree.b === id) return { tree: tree.a, heir: leavesOf(tree.a).at(-1) ?? null }
  const a = dropLeaf(tree.a, id)
  if (a.heir !== null) return { tree: { ...tree, a: a.tree }, heir: a.heir }
  const b = dropLeaf(tree.b, id)
  return b.heir === null ? { tree, heir: null } : { tree: { ...tree, b: b.tree }, heir: b.heir }
}

/**
 * Takes the shell `id` out: its branch becomes the other side, which takes the room. The focus, when it was on the
 * closed pane, moves to the pane that grew into its place. The agent's pane is never closed here: that is closing the session.
 */
export function closeLeaf(splits: SessionSplits, id: string): SessionSplits {
  if (id === AGENT_LEAF) return splits
  const { tree, heir } = dropLeaf(splits.tree, id)
  if (heir === null) return splits
  const numbers = Object.fromEntries(Object.entries(splits.numbers).filter(([shell]) => shell !== id))
  return { tree, focus: splits.focus === id ? heir : splits.focus, numbers }
}

/** The splits whose shells are in `live`: one that is gone leaves the tree as if it had been closed. */
export function liveSplits(splits: SessionSplits, live: ReadonlySet<string>): SessionSplits {
  return leavesOf(splits.tree).filter((id) => id !== AGENT_LEAF && !live.has(id)).reduce(closeLeaf, splits)
}

export function focusLeaf(splits: SessionSplits, id: string): SessionSplits {
  return splits.focus === id || !leavesOf(splits.tree).includes(id) ? splits : { ...splits, focus: id }
}

/** The pane `step` after the focused one in reading order, or null at either end (where the keys go on to another session's pane). */
export function stepFocus(splits: SessionSplits, step: 1 | -1): string | null {
  const leaves = leavesOf(splits.tree)
  return leaves[leaves.indexOf(splits.focus) + step] ?? null
}

function withRatio(tree: SplitTree, path: string, ratio: number): SplitTree {
  if (isLeaf(tree)) return tree
  if (path === '') return { ...tree, ratio }
  const rest = path.slice(1)
  return path.startsWith('a') ? { ...tree, a: withRatio(tree.a, rest, ratio) } : { ...tree, b: withRatio(tree.b, rest, ratio) }
}

/** Gives the branch at `path` its share for the first side; `null` goes back to halves. */
export function setRatio(splits: SessionSplits, path: string, ratio: number | null): SessionSplits {
  return { ...splits, tree: withRatio(splits.tree, path, ratio === null ? HALF : clampRatio(ratio)) }
}

/** Where every pane and every divider sits, worked out from the tree alone. */
export function layoutOf(tree: SplitTree): { panes: PaneRect[]; dividers: Divider[] } {
  const panes: PaneRect[] = []
  const dividers: Divider[] = []
  const walk = (node: SplitTree, path: string, x: number, y: number, w: number, h: number): void => {
    if (isLeaf(node)) {
      panes.push({ id: node, x, y, w, h })
      return
    }
    dividers.push({ path, dir: node.dir, ratio: node.ratio, x, y, w, h })
    if (node.dir === 'right') {
      walk(node.a, `${path}a`, x, y, w * node.ratio, h)
      walk(node.b, `${path}b`, x + w * node.ratio, y, w * (1 - node.ratio), h)
    } else {
      walk(node.a, `${path}a`, x, y, w, h * node.ratio)
      walk(node.b, `${path}b`, x, y + h * node.ratio, w, h * (1 - node.ratio))
    }
  }
  walk(tree, '', 0, 0, 1, 1)
  return { panes, dividers }
}

function parseTree(value: unknown): SplitTree | null {
  if (typeof value === 'string') return value === '' ? null : value
  if (typeof value !== 'object' || value === null) return null
  const node = value as { dir?: unknown; a?: unknown; b?: unknown; ratio?: unknown }
  if (node.dir !== 'right' && node.dir !== 'down') return null
  const a = parseTree(node.a)
  const b = parseTree(node.b)
  if (a === null || b === null) return null
  return { dir: node.dir, a, b, ratio: typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? clampRatio(node.ratio) : HALF }
}

/** Reads one session's stored splits; null for anything that is not a tree of the agent's pane and up to five shells. */
export function parseSplits(value: unknown): SessionSplits | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as { tree?: unknown; focus?: unknown; numbers?: unknown }
  const tree = parseTree(record.tree)
  if (tree === null) return null
  const leaves = leavesOf(tree)
  if (leaves.length > MAX_SESSION_PANES || new Set(leaves).size !== leaves.length || !leaves.includes(AGENT_LEAF)) return null
  const stored = typeof record.numbers === 'object' && record.numbers !== null ? (record.numbers as Record<string, unknown>) : {}
  const numbers: Record<string, number> = {}
  for (const id of leaves) {
    if (id === AGENT_LEAF) continue
    const n = stored[id]
    const taken = Object.values(numbers)
    numbers[id] = typeof n === 'number' && Number.isInteger(n) && n > 0 && !taken.includes(n) ? n : lowestFree(taken)
  }
  return { tree, focus: typeof record.focus === 'string' && leaves.includes(record.focus) ? record.focus : AGENT_LEAF, numbers }
}
