/**
 * The window opened a pull request itself (the Changes surface's Create PR). Whoever lists pull requests listens, so the
 * new one shows without waiting for the next look at GitHub.
 */
const listeners = new Set<() => void>()

/** Says a pull request was just opened from this window. */
export function pullRequestOpened(): void {
  for (const listener of listeners) listener()
}

/** Calls `listener` each time this window opens a pull request; the returned function stops it. */
export function onPullRequestOpened(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
