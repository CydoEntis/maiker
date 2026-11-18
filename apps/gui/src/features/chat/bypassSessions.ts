/**
 * Where the sessions started with their agent's Bypass Permissions flag are remembered: the mode dropdown says which may
 * pick Bypass permissions, and a move to a worktree resumes them the same way. The key keeps its first name, so sessions
 * remembered before the rename still count.
 */
const KEY = 'maitty.gui.yoloSessions.v1'

function read(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** The most sessions kept; older ones are long closed. */
const KEEP = 200

export function rememberBypassSession(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read().filter((known) => known !== id), id].slice(-KEEP)))
  } catch {
    // Without storage the dropdown simply keeps Bypass off for this session, which is the safe side.
  }
}

/** The session started with its agent's Bypass Permissions flag, so Bypass permissions can be picked in it. */
export function startedBypassed(id: string | undefined): boolean {
  return id !== undefined && read().includes(id)
}
