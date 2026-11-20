import { useCallback, useEffect, useState } from 'react'
import { agentsInstalled, folderBranches, folderSyncState, savedConversations, type FolderBranches, type FolderSync, type SavedConversation } from '@/api/daemon'
import { DEFAULT_PICK, type ReasoningPick } from '@/features/chat/agentChoice'
import { BYPASS_MODE, CODEX_FULL_MODE, PICKABLE_MODES } from '@/features/chat/chatMeta'
import type { ChatAgent } from './chatView'

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]*$/
const CLAUDE_EFFORT = new Set<ReasoningPick>(['low', 'medium', 'high', 'max'])
const CODEX_EFFORT = new Set<ReasoningPick>(['low', 'medium', 'high', 'max'])
/** What each Codex start mode puts on the launch line: its sandbox and when it asks. Auto is absent: it sends nothing, so the settings Codex has stand. */
const CODEX_MODE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  codexReadOnly: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
  [CODEX_FULL_MODE]: ['--sandbox', 'danger-full-access', '--ask-for-approval', 'never'],
}

/**
 * The flags that put a picked permission mode, model and effort on an agent's launch line (the text after its name,
 * with a leading space, or nothing). Claude: `--model`, `--effort`. Codex: `-m`, and the effort as
 * the `model_reasoning_effort` setting. Gemini: `-m` only. A name that is not plain model-id
 * characters is dropped rather than typed into a shell, and so is any level the agent lacks.
 */
export function launchFlags(agent: ChatAgent, model: string, effort: ReasoningPick, mode = 'default'): string {
  const flags: string[] = []
  if (agent === 'claude' && mode !== 'default' && PICKABLE_MODES.includes(mode)) flags.push('--permission-mode', mode)
  const named = model !== DEFAULT_PICK && MODEL_ID.test(model)
  if (agent === 'claude') {
    if (named) flags.push('--model', model)
    if (CLAUDE_EFFORT.has(effort)) flags.push('--effort', effort)
  } else if (agent === 'codex') {
    flags.push(...(CODEX_MODE_FLAGS[mode] ?? []))
    if (named) flags.push('-m', model)
    if (CODEX_EFFORT.has(effort)) flags.push('-c', `model_reasoning_effort=${effort}`)
  } else if (named) {
    // Gemini CLI: `-m`/`--model` takes an alias or a model name. It documents no effort setting and a mode would need
    // `--approval-mode`, whose only wider choices are not offered (docs/adr/0005).
    flags.push('-m', model)
  }
  return flags.length === 0 ? '' : ` ${flags.join(' ')}`
}

/**
 * Each agent's own flag that starts it without permission prompts: the same as the daemon's `BYPASS_FLAGS`
 * (maitty-settings), which tells from it that a resumed session started this way.
 */
export const BYPASS_FLAG: Readonly<Record<ChatAgent, string>> = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox',
  gemini: '--yolo',
}
/** Lets Claude switch to Bypass permissions later (Shift+Tab) when it starts in another mode picked for it. */
const CLAUDE_ALLOW_BYPASS = '--allow-dangerously-skip-permissions'
/** `--permission-mode` and the mode it names. */
const MODE_WORDS = 2

/**
 * The words an agent starts with once Bypass Permissions is taken into account (`on`: its switch). Claude started in a
 * picked mode keeps that mode and may switch to Bypass later; picked in Bypass, or with no mode, it starts in it by its
 * own flag. With the switch off nothing is added, and a picked Bypass mode is dropped, since Claude would refuse it.
 * The flag goes first, as the daemon puts it right after the program: Codex reads it there before `resume`.
 */
export function withBypass(agent: ChatAgent, words: readonly string[], on: boolean): string[] {
  const at = words.indexOf('--permission-mode')
  const picked = at === -1 ? null : words[at + 1]
  const withoutMode = at === -1 ? [...words] : [...words.slice(0, at), ...words.slice(at + MODE_WORDS)]
  if (!on) return picked === BYPASS_MODE ? withoutMode : [...words]
  if (agent !== 'claude' || picked === null) return [BYPASS_FLAG[agent], ...words]
  if (picked === BYPASS_MODE) return [BYPASS_FLAG.claude, ...withoutMode]
  return [CLAUDE_ALLOW_BYPASS, ...words]
}

/** Whether these start words run the agent without permission prompts. */
export function startsBypassed(agent: ChatAgent, words: readonly string[]): boolean {
  return words.includes(BYPASS_FLAG[agent])
}

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400
const WEEK = 604_800
const TWO_WEEKS = 1_209_600
const MS_PER_SECOND = 1000

/** Now as Unix seconds, to measure `ageOf` against. */
export const nowSeconds = (): number => Math.floor(Date.now() / MS_PER_SECOND)

/** "4m", "1h", "1d", "3w": how long ago a Unix time was; empty when unknown. */
export function ageOf(when: number | null, now: number): string {
  if (when === null) return ''
  const seconds = Math.max(0, now - when)
  if (seconds < HOUR) return `${String(Math.max(1, Math.floor(seconds / MINUTE)))}m`
  if (seconds < DAY) return `${String(Math.floor(seconds / HOUR))}h`
  if (seconds < TWO_WEEKS) return `${String(Math.floor(seconds / DAY))}d`
  return `${String(Math.floor(seconds / WEEK))}w`
}

/** Which agent programs are on this computer, or null while that is unknown (or could not be read). */
export function useInstalledAgents(): readonly string[] | null {
  const [installed, setInstalled] = useState<readonly string[] | null>(null)
  useEffect(() => {
    const stop = new AbortController()
    void (async () => {
      try {
        const found = await agentsInstalled()
        if (!stop.signal.aborted) setInstalled(found)
      } catch (error) {
        console.warn('Could not look for the installed agents', error)
      }
    })()
    return () => { stop.abort() }
  }, [])
  return installed
}

/**
 * A folder's branches and worktrees (null when it is not a git repository or is still being read), a way to read them again,
 * and whether the answer for this folder is in (`false` while it is being read, so "not a repository" is never guessed).
 */
export function useFolderBranches(folder: string): [FolderBranches | null, () => void, boolean] {
  const [read, setRead] = useState<{ folder: string; data: FolderBranches | null }>({ folder: '', data: null })
  const [again, setAgain] = useState(0)
  useEffect(() => {
    if (folder === '') return
    const stop = new AbortController()
    void (async () => {
      try {
        const data = await folderBranches(folder)
        if (!stop.signal.aborted) setRead({ folder, data })
      } catch (error) {
        if (!stop.signal.aborted) setRead({ folder, data: null })
        console.warn('Could not read the folder\'s branches', error)
      }
    })()
    return () => { stop.abort() }
  }, [folder, again])
  const reload = useCallback(() => { setAgain((count) => count + 1) }, [])
  const settled = folder === '' || read.folder === folder
  return [read.folder === folder ? read.data : null, reload, settled]
}

/** Whether the remote has been asked for the folder: not yet (or it could not answer), being asked, or answered. */
export type FetchState = 'idle' | 'running' | 'done'

/** How a folder's checkout stands against its upstream, and the means to ask the remote again or read it again. */
export type FolderSyncRead = { sync: FolderSync | null; /** The folder has been read: a null `sync` then means it is not in a repository. */ read: boolean; fetch: FetchState; fetchAgain: () => void; reload: () => void }

/**
 * A folder's standing against its upstream. It is read at once from what is already fetched, and the remote is asked
 * once so "behind" is true; an offline remote leaves the first reading. An answer for another folder is dropped.
 */
export function useFolderSync(folder: string): FolderSyncRead {
  const [known, setKnown] = useState<{ folder: string; sync: FolderSync | null }>({ folder: '', sync: null })
  // The last ask that was answered, by folder and number: an ask not answered yet is the one running.
  const [asked, setAsked] = useState<{ folder: string; ask: number; fetched: boolean }>({ folder: '', ask: 0, fetched: false })
  // The first ask is the open's own; each press of the fetch button is another.
  const [fetches, setFetches] = useState(1)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (folder === '') return
    const stop = new AbortController()
    void (async () => {
      try {
        const sync = await folderSyncState(folder, false)
        if (!stop.signal.aborted) setKnown({ folder, sync })
      } catch (error) {
        // The folder is left unread rather than called a non-repository: a failed read says nothing of it.
        console.warn('Could not read where the folder stands against its upstream', error)
      }
    })()
    return () => { stop.abort() }
  }, [folder, reads])
  useEffect(() => {
    if (folder === '') return
    const stop = new AbortController()
    void (async () => {
      try {
        const sync = await folderSyncState(folder, true)
        if (stop.signal.aborted) return
        setKnown({ folder, sync })
        setAsked({ folder, ask: fetches, fetched: sync?.fetched === true })
      } catch (error) {
        if (!stop.signal.aborted) setAsked({ folder, ask: fetches, fetched: false })
        console.warn('Could not ask the remote', error)
      }
    })()
    return () => { stop.abort() }
  }, [folder, fetches])
  const fetchAgain = useCallback(() => { setFetches((count) => count + 1) }, [])
  const reload = useCallback(() => { setReads((count) => count + 1) }, [])
  const answered = asked.folder === folder && asked.ask === fetches
  const fetch: FetchState = folder === '' ? 'idle' : !answered ? 'running' : asked.fetched ? 'done' : 'idle'
  return { sync: known.folder === folder ? known.sync : null, read: known.folder === folder, fetch, fetchAgain, reload }
}

/** What is known of a folder's saved conversations: not asked yet, the list, a service too old to say, or a failed read. */
export type SavedRead = { kind: 'none' } | { kind: 'listed'; list: readonly SavedConversation[] } | { kind: 'older' } | { kind: 'failed' }

const NOT_READ: SavedRead = { kind: 'none' }

/** The conversations `agent` saved for `folder`, read off the UI thread; an empty folder asks nothing. An answer for another folder or agent is dropped. */
export function useSavedConversations(folder: string, agent: 'claude' | 'codex'): SavedRead {
  const key = folder === '' ? '' : `${agent}\n${folder}`
  const [read, setRead] = useState<{ key: string; found: SavedRead }>({ key: '', found: NOT_READ })
  useEffect(() => {
    if (folder === '') return undefined
    const asked = `${agent}\n${folder}`
    const stop = new AbortController()
    void (async () => {
      try {
        const list = await savedConversations(agent, folder)
        if (!stop.signal.aborted) setRead({ key: asked, found: list === null ? { kind: 'older' } : { kind: 'listed', list } })
      } catch (error) {
        if (!stop.signal.aborted) setRead({ key: asked, found: { kind: 'failed' } })
        console.warn('Could not read the saved conversations', error)
      }
    })()
    return () => { stop.abort() }
  }, [agent, folder])
  return key !== '' && read.key === key ? read.found : NOT_READ
}
