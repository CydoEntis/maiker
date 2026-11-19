import type { PaneView } from '@/features/workspace/model/chatView'

export const SETUP_STEPS = ['Welcome', 'How you work', 'Get started'] as const
export const LAST_STEP = SETUP_STEPS.length - 1

export type StartChoice = 'folder' | 'machine'

/** The agent programs the welcome lists, by the name `agents_installed` finds them under. */
export const SETUP_AGENTS: ReadonlyArray<{ program: string; label: string }> = [
  { program: 'claude', label: 'Claude Code' },
  { program: 'codex', label: 'Codex' },
  { program: 'gemini', label: 'Gemini' },
  { program: 'opencode', label: 'OpenCode' },
  { program: 'cursor-agent', label: 'Cursor' },
]

/** What the primary button says for the step and what is picked so far. */
export function nextLabel(step: number, mode: PaneView | null, start: StartChoice | null, folderName: string | null): string {
  if (step === 0) return 'Get started'
  if (step === 1) return mode === null ? 'Pick one to continue' : 'Continue'
  if (start === 'folder') return folderName === null ? 'Pick a folder' : `Start in ${folderName}`
  return 'Pick one to continue'
}

/** The last part of a typed path: the project's name. Null when nothing is typed. */
export function folderNameOf(path: string): string | null {
  const parts = path.trim().split(/[\\/]+/).filter((part) => part !== '' && part !== '~')
  return parts[parts.length - 1] ?? null
}
