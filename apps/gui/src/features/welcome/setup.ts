import type { InstallableAgent } from '@/api/agentInstall'
import type { PaneView } from '@/features/workspace/model/chatView'
import type { ThemeMode } from '@/features/workspace/theme/themes'

/*
 * The first run's rules, with no React and no host calls: which stage follows which, what Enter, Esc and the arrows
 * do, which folder is offered, how the agents are grouped, and what the last button saves.
 */

/** The agent programs the setup lists, by the name `agents_installed` finds them under. Gemini has no chat view. */
export const SETUP_AGENTS: ReadonlyArray<{ program: string; label: string; detail: string }> = [
  { program: 'claude', label: 'Claude Code', detail: 'Anthropic’s coding agent' },
  { program: 'codex', label: 'Codex', detail: 'OpenAI’s coding agent' },
  { program: 'gemini', label: 'Gemini', detail: 'Google’s coding agent · terminal only' },
  { program: 'opencode', label: 'OpenCode', detail: 'Open-source agent for any model' },
  { program: 'cursor-agent', label: 'Cursor', detail: 'Cursor’s agent in your terminal' },
]

export type SetupAgent = (typeof SETUP_AGENTS)[number]

export const agentLabel = (program: string): string => SETUP_AGENTS.find((agent) => agent.program === program)?.label ?? program

/** The agents on the desktop shell's install list (src-tauri/src/agent_install.rs). Any other is listed but never offered an Install. */
const INSTALLABLE: readonly string[] = ['claude', 'codex', 'gemini', 'opencode'] satisfies readonly InstallableAgent[]

/** The agent as the installer names it, or null for one the desktop shell has no install for. */
export const installableAgent = (program: string): InstallableAgent | null => (INSTALLABLE.includes(program) ? (program as InstallableAgent) : null)

/** The mark drawing itself, then the two screens of the one window. */
export type Stage = 'intro' | 'setup' | 'style'

/** The two screens, in order: one dot each. */
export const SCREENS = ['setup', 'style'] as const satisfies readonly Stage[]

/** How the first run ends: by its last button, or by Skip or Esc. */
export type SetupEnd = 'finish' | 'skip'

/** Where a key or a button takes the first run: to a stage, or to its end. */
export type Step = { stage: Stage } | { end: SetupEnd }

/** Continue, the last button and Enter: the next screen, and from the last one the end that applies the choices. */
export function continueFrom(stage: Stage): Step {
  if (stage === 'intro') return { stage: 'setup' }
  return stage === 'setup' ? { stage: 'style' } : { end: 'finish' }
}

/** Back: the screen before. The first screen has none. */
export const backFrom = (stage: Stage): Stage => (stage === 'style' ? 'setup' : stage)

/** Esc and Skip: the drawing gives way to the window; from the window they end the first run and apply nothing. */
export const skipFrom = (stage: Stage): Step => (stage === 'intro' ? { stage: 'setup' } : { end: 'skip' })

/** What a key was pressed on: a button that acts by itself, a text field, a choice group (which owns its arrows), or anything else. */
export type KeyTarget = 'action' | 'field' | 'choice' | 'other'

/** What a key does in the window, beyond what the control under it does by itself. */
export type KeyStep = { kind: 'continue' } | { kind: 'theme'; by: -1 | 1 } | null

/**
 * Enter continues from anywhere but a button, which it presses, and a field. The left and right arrows slide the theme
 * on the style screen from anywhere but a field and a choice group, whose own arrows pick in it.
 */
export function keyStep(stage: Stage, key: string, target: KeyTarget): KeyStep {
  if (stage === 'intro') return null
  if (key === 'Enter') return target === 'action' || target === 'field' ? null : { kind: 'continue' }
  if (stage !== 'style' || target === 'field' || target === 'choice') return null
  if (key === 'ArrowLeft') return { kind: 'theme', by: -1 }
  if (key === 'ArrowRight') return { kind: 'theme', by: 1 }
  return null
}

/** The theme `by` places along from `current`, going round at either end. */
export function stepTheme(names: readonly string[], current: string, by: number): string {
  if (names.length === 0) return current
  const at = Math.max(0, names.indexOf(current))
  return names[(((at + by) % names.length) + names.length) % names.length] ?? current
}

const FAMILY_PREFIX = 'Maiker '

/** A theme's name under the carousel: "Midnight · Dark", and plain "Dark" for the theme that is named after its kind. */
export function themeCaption(theme: { name: string; light: boolean }): string {
  const name = theme.name.startsWith(FAMILY_PREFIX) ? theme.name.slice(FAMILY_PREFIX.length) : theme.name
  const kind = theme.light ? 'Light' : 'Dark'
  return name === kind ? name : `${name} · ${kind}`
}

/** A folder that was looked into, with the git projects directly inside it. */
export type FolderFound = { path: string; projects: readonly string[] }

/** Why a folder is the one offered: it was saved before, it holds the most git projects, or nothing better was found. */
export type FolderOrigin = 'saved' | 'detected' | 'home'

/**
 * The projects folder to offer: the saved one, else the looked-into folder with the most git projects (the first of
 * equals), else the home folder.
 */
export function detectProjectsFolder(saved: string, home: string, found: readonly FolderFound[]): { path: string; origin: FolderOrigin } {
  if (saved.trim() !== '') return { path: saved.trim(), origin: 'saved' }
  const best = found.reduce<FolderFound | null>((most, folder) => (folder.projects.length > (most?.projects.length ?? 0) ? folder : most), null)
  return best === null ? { path: home, origin: 'home' } : { path: best.path, origin: 'detected' }
}

/** How many project names are shown before the rest become a count. */
export const PROJECT_TAGS = 5

/** The first project names, and how many more there are. */
export function projectTags(projects: readonly string[]): { shown: readonly string[]; more: number } {
  return { shown: projects.slice(0, PROJECT_TAGS), more: Math.max(0, projects.length - PROJECT_TAGS) }
}

export const projectCount = (count: number): string => `${String(count)} git project${count === 1 ? '' : 's'}`

/** One agent in the list, with the version the installer reported when it was installed from here. */
export type AgentRow = { agent: SetupAgent; version: string | null }

/**
 * The agents in their two groups, installed first; null while the scan has not answered. An agent installed from here
 * counts as installed whatever the scan said, so it moves up when its install finishes.
 */
export function agentGroups(found: readonly string[] | null, installedHere: Readonly<Record<string, string | null>>): { installed: readonly AgentRow[]; missing: readonly AgentRow[] } | null {
  if (found === null) return null
  const rows = SETUP_AGENTS.map((agent) => ({ agent, version: installedHere[agent.program] ?? null }))
  const here = (row: AgentRow) => row.agent.program in installedHere || found.includes(row.agent.program)
  return { installed: rows.filter(here), missing: rows.filter((row) => !here(row)) }
}

/** What the first run saves. The theme keys are there only when a theme was slid to. */
export type SetupSettings = {
  startFolder: string
  openSessionsIn: PaneView
  themeMode?: ThemeMode
  darkTheme?: string
  lightTheme?: string
}

/**
 * What the last button saves: the projects folder (empty for the home folder, which is what "no folder set" already
 * means), the view, and the theme slid to, in a fixed mode so that it is the one showing whatever the system asks for.
 * With no theme slid to, the theme settings are left as they are.
 */
export function settingsFromSetup(choice: { folder: string; home: string; view: PaneView; theme: { name: string; light: boolean } | null }): SetupSettings {
  const folder = choice.folder.trim()
  const base: SetupSettings = { startFolder: folder === choice.home ? '' : folder, openSessionsIn: choice.view }
  if (choice.theme === null) return base
  return choice.theme.light ? { ...base, themeMode: 'light', lightTheme: choice.theme.name } : { ...base, themeMode: 'dark', darkTheme: choice.theme.name }
}
