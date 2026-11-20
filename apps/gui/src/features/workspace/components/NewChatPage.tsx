import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import { useWarmAgent, type WarmAgent, type WarmSpec } from '../useWarmAgent'
import { PopupContent } from '@/components/ui/popup'
import { toast } from '@/lib/toast'
import { pasteFromHost, pickFromClipboard, unsupportedMessage } from '@/features/terminal/clipboardImage'
import { buildAttachmentMessage } from '@/features/chat/attachmentMessage'
import { registerComposerDrop } from '@/features/chat/composerDrop'
import { updateComposer, useComposerState } from '@/features/chat/composerStore'
import { revokePreviews, useAttachmentIntake } from '@/features/chat/useAttachmentIntake'
import { DraftAttachments } from '@/features/chat/components/Attachments'
import { useKeepTyping } from '@/features/chat/useKeepTyping'
import { WorkingMark } from '@/features/chat/components/WorkingMark'
import { Switch } from '@/components/ui/switch'
import { explainError, explainStartFailure, PICK_ANOTHER_BRANCH, type ExplainedError } from '@/lib/error-message'
import { DEFAULT_PICK, START_REASONING, type AgentChoice } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { BYPASS_MODE, CODEX_FULL_MODE, DANGER_MODES, modeLabel, START_MODE } from '@/features/chat/chatMeta'
import { AgentPicker } from '@/features/chat/components/AgentPicker'
import { MAX_SHOWN, SlashPicker } from '@/features/chat/components/SlashPicker'
import { commandText, matchCommands, slashQuery, useSlashCommands, type SlashCommand } from '@/features/chat/slashCommands'
import { openAgentDocs, pullFolder } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { chatAgentOf, type ChatAgent } from '../model/chatView'
import { abilitiesOf } from '../model/agentAbilities'
import { useFolderBranches, useFolderSync, useInstalledAgents } from '../model/newChatHost'
import { branchNameError, BRANCH_NAME } from '../model/branchName'
import type { BusyBranches, NewSessionProject } from '../model/newSession'
import { nameForTask, slugFromTask, suggestBranchName } from '../model/worktreeName'
import { carriesCredentials, cloneTargetOf, explainCloneFailure, parseRepoAddress, type CloneProblem, type RepoAddress } from '../model/repoAddress'
import { readLastWho, rememberWho } from '../model/lastWho'
import { discardDraft, parkDraft, parkedDraft } from '../model/newSessionDraft'
import { FolderMark, Icon } from './glyphs'
import { ChipMenu, type ChipItem } from './NewChatMenus'
import { failedStartLabel, useBackgroundStarts } from '../useBackgroundStarts'
import { isMacPlatform } from '../model/shortcuts'
import type { PickedFolder } from '../model/folderPick'
import { CopyDetails, FeedbackButton, InlineNote } from '@/components/ui/feedback'
import { copyText } from '@/lib/clipboard'

/** The branch a session starts on when it is not the folder's current one: switch to it, or work in a new worktree of it. */
export type BranchChoice = { name: string; create: boolean; worktree: boolean }

/**
 * What the page asks the window to start: a session with this agent, model and effort, in this folder, and its first
 * message; `resume` names a saved conversation to continue. `view` is which view it opens in (its chat or its terminal),
 * `bypass` is this session's Bypass Permissions choice over Settings, and `name` a name for it; without one the first
 * message names the session.
 */
export type NewChatRequest = { folder: string; agent: ChatAgent; model: string; reasoning: AgentChoice['reasoning']; mode: string; message: string; branch: BranchChoice | null; machine: number; machineName: string; resume: string | null; name?: string; bypass?: boolean | undefined }

/** How a start is asked for: `background` starts the session without opening it, and the page stays for the next; `onPlaced` hears its id. */
export type NewChatStartOptions = { background?: boolean; /** Told the new session's id once it is in the sidebar (this computer's sessions only). */ onPlaced?: (id: string) => void }

/** A computer a session could start on. `down` is why it cannot, in words, when it cannot. */
export type NewChatMachine = { machine: number; label: string; local: boolean; down?: string | null }

/** What the clone window opens with: its first view, and an address and folder already filled in (a clone that needs another folder). */
export type CloneOpening = { start: 'link' | 'repos'; address?: string; parent?: string }

/** How the page brings a repository onto the machine it is on: the window's clone for it. */
export type RepoCloner = {
  /** The folder a clone goes inside unless said otherwise: the last one used on this machine, else `~/Projects`. */
  parent: string
  /** Clones `address` into a new folder inside `parent` and answers with that folder; rejects with the machine's reason. */
  run: (address: string, parent: string) => Promise<string>
  /** Keeps the folder a clone went inside, for the next one on this machine. */
  remember: (parent: string) => void
  /** Opens the clone window (a link, or the account's repositories) and answers with the folder, or null when it is cancelled. */
  open: (opening?: CloneOpening) => Promise<string | null>
  /** Opens Settings where the machine can be signed in to GitHub. */
  onOpenGitHubSettings: () => void
}

type Props = {
  machines: readonly NewChatMachine[]
  /** The computer the session starts on. */
  machine: number
  /** The projects that computer has sessions in, the focused one first. */
  projects: readonly NewSessionProject[]
  /** The branches other sessions are working on, per folder: a session started on one gets a worktree of its own. */
  busy?: BusyBranches
  defaultAgent: ChatAgent
  /**
   * The agents whose Bypass Permissions is off (Settings › Permissions). Every other one starts on its skip-permissions
   * mode: Claude on Bypass permissions, Codex on Full access. The page shows it and More options changes it for one session.
   */
  bypassOff?: readonly ChatAgent[]
  /** Opens the folder picker on that machine and answers with the folder chosen (and the machine it is on), or null when it is cancelled. Null when there is none. */
  pickFolder: ((machine: number) => Promise<PickedFolder | null>) | null
  /** Brings a repository onto this machine. Without it the project list has no clone rows. */
  cloner?: RepoCloner | null
  onStart: (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>
  /** Starts the session's agent while the first message is written (`useWarmAgent`); without it the agent starts on send. */
  onWarm?: WarmAgent
  onOtherMachine: (machine: number) => void
  /** Opens where a machine is added; without it the machine list has no such row. */
  onAddMachine?: () => void
  /** Discards the draft and goes back to the session that was in front; absent when there is nothing to go back to (no session exists yet). */
  onCancel?: (() => void) | undefined
  /** Told the agent the session will start with, at first and on each change, so the sidebar's draft row shows it. */
  onAgentChange?: ((agent: ChatAgent) => void) | undefined
  /** A folder and first message to open with (a session continued from a full chat). */
  seed?: { folder: string; message: string } | null
  /** Before the where chips: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
}

/** The key the first message's files are kept under: no conversation exists yet, and a real one is never negative. */
const NEW_CHAT_DRAFT = -1

const lastPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const isPath = (text: string): boolean => /^(~|\/|[A-Za-z]:[\\/])/.test(text)
/** The keys that start a session in the background, as this platform writes them. */
const BACKGROUND_KEY = isMacPlatform(navigator.userAgent) ? '⌘ ⇧ ↵' : 'Ctrl Shift ↵'
/** The width of a token's list, as the design draws it. */
const TOKEN_LIST_WIDTH = 320
const NO_BUSY: BusyBranches = new Map()
/** No agent switched off: every one starts on its skip-permissions mode. */
const NONE_OFF: readonly ChatAgent[] = []
const FIRST_CHOICE: AgentChoice = { model: DEFAULT_PICK, reasoning: START_REASONING }
/** Said under the agent when Gemini is picked: it has no chat events, so it opens in its terminal. */
const GEMINI_TERMINAL_LINE = 'Gemini has no chat view yet, so this session opens in its terminal.'

/** Where the session works: in the checkout, a worktree of its own, or `auto`: a worktree only when another session is on that branch here. */
type WorkIn = 'auto' | 'folder' | 'tree'

/** A folder the person picked, with the machine it is on: a folder means nothing on another machine. */
type Picked = { machine: number; folder: string }

/** A clone the page is running or that failed: what it was for, and where it went. */
type CloneState = { repo: string; address: string; parent: string; problem: CloneProblem | null }

/** The words of the permission chip: what the session will be allowed to do without asking. */
function permissionWords(agent: ChatAgent, bypass: boolean): { text: string; danger: boolean } {
  if (agent === 'gemini') return bypass ? { text: 'Skips permission prompts', danger: true } : { text: 'Asks before acting', danger: false }
  const mode = bypass ? (agent === 'codex' ? CODEX_FULL_MODE : BYPASS_MODE) : START_MODE[agent]
  return { text: modeLabel(mode) ?? mode, danger: DANGER_MODES.includes(mode) }
}

/**
 * The New session draft: a chat that has not been sent yet, in the main area, never a dialog. The header says Where, as one
 * line of chips: machine, project and branch (the project chip opens one list: recent projects, a folder, a clone from a
 * link, the account's repositories; a pasted GitHub link becomes a Clone row). The box is What: Enter starts, Shift+Enter
 * is a new line. Under it are Who: the agent, its model and effort, the permission chip and More options (Skip permission prompts).
 * Branch and Work in (This folder / New worktree) are in the Where line: always there; when the folder is no repository, each shows a quiet "n/a" chip with the reason. It is always an agent session, one daemon-owned session with a chat view and a terminal view
 * (ADR 0003); Settings says which it opens in. While it starts, this same view shows the Starting card until the window
 * swaps in the session's pane in one update. Ctrl+Enter (⌘Enter on macOS) starts from anywhere, Ctrl+Shift+Enter starts it
 * in the background and keeps the draft for the next one, Esc discards it. A plain shell is "New terminal", not here.
 */
export function NewChatPage({ machines, machine, projects, busy: busyBranches = NO_BUSY, defaultAgent, bypassOff = NONE_OFF, pickFolder, cloner = null, onStart, onWarm, onOtherMachine, onAddMachine, onCancel, onAgentChange, seed = null, leading }: Props) {
  // On another machine the session is the agent started in a shell there: this computer's extra models, branches and installed agents say nothing of it.
  const remote = machine !== LOCAL_MACHINE
  const target = machines.find((candidate) => candidate.machine === machine)
  const targetLabel = target?.label ?? 'This computer'
  const targetDown = target?.down ?? null
  // The agent and the model and effort each was left at start as they were last used.
  const [last] = useState(readLastWho)
  const [agent, setAgent] = useState<ChatAgent>(last?.agent ?? defaultAgent)
  useEffect(() => { onAgentChange?.(agent) }, [agent, onAgentChange])
  const bypassOn = (which: ChatAgent) => !bypassOff.includes(which)
  // Bypass Permissions starts Claude in Bypass permissions and Codex in Full access. One session's choice is kept until another agent is picked.
  const [bypass, setBypass] = useState(() => bypassOn(last?.agent ?? defaultAgent))
  // Each agent keeps its own model and effort while the page is open, so going back to one finds what it was left at.
  const [choices, setChoices] = useState<Partial<Record<ChatAgent, AgentChoice>>>(() => last?.choices ?? {})
  const choice = choices[agent] ?? FIRST_CHOICE
  const changeChoice = (change: Partial<AgentChoice>) => { setChoices((was) => ({ ...was, [agent]: { ...(was[agent] ?? FIRST_CHOICE), ...change } })) }
  const [picked, setPicked] = useState<Picked | null>(seed === null ? null : { machine, folder: seed.folder })
  const [extra, setExtra] = useState<(NewSessionProject & { machine: number }) | null>(seed === null ? null : { machine, folder: seed.folder, name: lastPart(seed.folder), color: 'var(--dim)' })
  // A draft left by switching away comes back with its text; a seed (a summary to continue from) replaces it.
  const [message, setMessage] = useState(() => seed?.message ?? parkedDraft())
  useEffect(() => { parkDraft(message) }, [message])
  // What was sent while the start runs, so the Starting card shows it where the box was.
  const [sent, setSent] = useState<string | null>(null)
  const [branchPick, setBranchPick] = useState<{ folder: string; pick: BranchChoice } | null>(null)
  const [workIn, setWorkIn] = useState<WorkIn>('auto')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<ExplainedError | null>(null)
  // A clone started from the project list's own row; the clone window has its own state.
  const [cloning, setCloning] = useState<CloneState | null>(null)
  const background = useBackgroundStarts(onStart)
  // Branch names sessions started from this dialog took, which the branch list may not show yet: the next suggestion avoids them.
  const [takenNames, setTakenNames] = useState<ReadonlySet<string>>(() => new Set())
  const text = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { attachments } = useComposerState(NEW_CHAT_DRAFT)
  useKeepTyping(text, attachments.length)
  // A new session runs where the folder is, so files are copied to this computer and named by path in the first message.
  const attach = useAttachmentIntake({ conversation: NEW_CHAT_DRAFT, blocked: remote ? `Files stay on this computer, not on ${targetLabel}` : starting ? 'The session is starting' : null })
  const { addPaths } = attach
  useEffect(() => {
    const element = box.current
    return element === null || remote ? undefined : registerComposerDrop(element, addPaths)
  }, [addPaths, remote])
  // Files meant for a session that was never started are not kept for the next one.
  useEffect(() => () => {
    updateComposer(NEW_CHAT_DRAFT, (state) => { revokePreviews(state.attachments); return { ...state, attachments: [] } })
  }, [])
  // Text first, as in the terminal: a clipboard with any text pastes the text; only a bare image is attached.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pick = pickFromClipboard(event.clipboardData)
    if (pick.kind === 'none') pasteFromHost(attach.addImage)
    if (pick.kind === 'text' || pick.kind === 'none') return
    event.preventDefault()
    if (pick.kind === 'image') attach.addImage(pick.image)
    else toast.error(unsupportedMessage(pick.type))
  }
  // It opens ready to type, on the most recent project.
  const folder = picked?.machine === machine ? picked.folder : projects[0]?.folder ?? ''
  const added = extra?.machine === machine ? extra : null
  const shown = added === null || projects.some((project) => project.folder === added.folder) ? projects : [...projects, added]
  const current = shown.find((project) => project.folder === folder)
  const folderName = current?.name ?? (folder === '' ? 'Choose a project' : lastPart(folder))
  const installed = useInstalledAgents()
  const [branches, reloadBranches, branchesRead] = useFolderBranches(remote ? '' : folder)
  const { sync, read: syncRead, fetch: fetchState, fetchAgain, reload: reloadSync } = useFolderSync(remote ? '' : folder)
  // Only the folder that was read is known to be no repository; the others are not read until they are picked.
  const notRepo = !remote && folder !== '' && syncRead && sync === null
  // Updating the checkout from origin (Update first), for the folder it was asked on.
  const [pull, setPull] = useState<{ folder: string; state: 'running' | 'done' } | null>(null)
  // The branch list is opened from outside by the failure that asks for another branch.
  const [branchOpen, setBranchOpen] = useState(false)
  // A branch chosen for one folder means nothing in another.
  const explicit = branchPick?.folder === folder ? branchPick.pick : null
  const here = branches?.current ?? null
  // The branch the session would be on, and the session already working on it here, if one is.
  const onBranch = explicit !== null && !explicit.create ? explicit.name : here
  const busyHere = busyBranches.get(folder)
  const busyWith = onBranch === null ? undefined : busyHere?.get(onBranch)
  // Auto works in the folder unless another session is on that branch, which would then be edited by two at once.
  // On another machine its branches are not read from here, so only an asked-for worktree is made there.
  const canTree = folder !== '' && (remote || branches !== null)
  const treeMode = canTree && (workIn === 'tree' || (!remote && workIn === 'auto' && busyWith !== undefined))
  const takenBranches = useMemo(() => new Set([...(branches?.branches ?? []).map((entry) => entry.name), ...takenNames]), [branches, takenNames])
  // In a worktree of its own with no branch chosen, the session gets a new branch named for the task in the message
  // (`fix-login-redirect`), or while there is none a two-word name, rolled once per list of names in use.
  const rolled = useMemo(() => (treeMode && (remote || branches !== null) ? suggestBranchName(takenBranches) : null), [treeMode, remote, branches, takenBranches])
  const suggested = rolled !== null && slugFromTask(message) !== '' ? nameForTask(message, takenBranches) : rolled
  const branch = useMemo<BranchChoice | null>(() => {
    if (explicit !== null) return { ...explicit, worktree: treeMode }
    return treeMode && suggested !== null ? { name: suggested, create: true, worktree: true } : null
  }, [explicit, treeMode, suggested])
  const isInstalled = (id: string) => (installed === null ? chatAgentOf(id) !== null : installed.includes(id))
  const agentMissing = !remote && !isInstalled(agent)

  // The message box takes the keys when the draft opens, and again after a start that did not go through.
  useEffect(() => { if (!starting) text.current?.focus() }, [folder, starting])

  const pickAgent = (next: ChatAgent) => {
    setAgent(next)
    // Whether it skips permission prompts is the agent's own setting too.
    setBypass(bypassOn(next))
  }
  const modes = abilitiesOf(agent).permissionModes?.modes ?? []
  const bypassMode = agent === 'codex' ? CODEX_FULL_MODE : agent === 'claude' ? BYPASS_MODE : START_MODE[agent]
  const mode = bypass ? bypassMode : START_MODE[agent]
  // Bypass Permissions already starts Codex with full access, and its flag cannot be combined with a mode's.
  const forcedFull = abilitiesOf(agent).yoloExcludesMode && bypass
  const startMode = !forcedFull && modes.includes(mode) ? mode : 'default'
  const permission = permissionWords(agent, bypass)
  // A branch or a worktree is made when the session starts, so only a session on the folder as it is can have its agent started ahead.
  const warmSpec = useMemo<WarmSpec | null>(
    () => (remote || folder === '' || agentMissing || branch !== null ? null : { folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, bypass }),
    [remote, folder, agentMissing, branch, agent, choice.model, choice.reasoning, startMode, bypass],
  )
  // A start in the background takes the warm agent; asking again while it starts would make a second one.
  useWarmAgent(onWarm, warmSpec, starting || background.pending > 0)
  const requestFor = (task: string): NewChatRequest => ({
    folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, message: buildAttachmentMessage(task.trim(), attachments), bypass,
    branch: remote && branch?.worktree !== true ? null : branch, machine, machineName: targetLabel, resume: null,
  })
  const empty = message.trim() === '' && attachments.length === 0
  const off = starting || folder === '' || agentMissing || empty || targetDown !== null || cloning !== null
  // What is chosen is what the next draft opens on.
  const remember = () => { rememberWho({ agent, choices: { ...choices, [agent]: choice } }) }
  const start = (task: string = message) => {
    if (off) return
    setStarting(true)
    setSent(task.trim())
    setError(null)
    const request = requestFor(task)
    remember()
    // The draft is being sent: it is no longer one to come back to, unless the start fails.
    discardDraft()
    onStart(request)
      // Another machine's branches are not read again, so the name it took is kept here and the next start gets another.
      .then(() => { const made = request.branch; if (remote && made !== null) setTakenNames((now) => new Set([...now, made.name])) })
      .catch((failure: unknown) => {
        parkDraft(task)
        const explained = explainStartFailure(failure, 'Could not start the session', request.branch)
        // A branch whose worktree folder is in the way is not offered again as the next suggestion.
        if (explained.fix !== undefined && request.branch !== null) { const taken = request.branch.name; setTakenNames((now) => new Set([...now, taken])) }
        setError(explained)
      })
      .finally(() => { setStarting(false); setSent(null); reloadBranches(); reloadSync() })
  }
  // The box is emptied for the next session and every other choice stays. A new branch's name is taken, so the next start
  // gets another. Another machine's session is typed into a shell there and opened to do it, so there it is a plain start.
  const startInBackground = () => {
    // With no session to stay on (the home draft) there is nothing to keep in front: it is a plain start.
    if (remote || onCancel === undefined) {
      start()
      return
    }
    if (off) return
    const request = requestFor(message)
    remember()
    if (request.branch?.create === true) setTakenNames((now) => new Set([...now, request.branch?.name ?? '']))
    if (request.branch?.create === true && explicit?.create === true) setBranchPick(null)
    background.launch([request], { text: message, attachments })
    setMessage('')
    updateComposer(NEW_CHAT_DRAFT, (state) => ({ ...state, attachments: [] }))
  }
  // A failed start's message comes back after whatever has been typed since, never over it.
  const putBack = (key: number) => {
    const draft = background.takeBack(key)
    if (draft === null) return
    setMessage((now) => (now.trim() === '' ? draft.text : draft.text.trim() === '' ? now : `${now}\n\n${draft.text}`))
    updateComposer(NEW_CHAT_DRAFT, (state) => ({ ...state, attachments: [...state.attachments, ...draft.attachments] }))
    text.current?.focus()
  }
  const openFolder = (path: string) => {
    setExtra({ machine, folder: path, name: lastPart(path), color: 'var(--dim)' })
    setPicked({ machine, folder: path })
  }
  const openPicker = () => {
    if (pickFolder === null) return
    void pickFolder(machine).then((chosen) => {
      if (chosen === null) return
      // A folder on another machine takes the draft to that machine with the folder filled in.
      setExtra({ machine: chosen.machine, folder: chosen.folder, name: lastPart(chosen.folder), color: 'var(--dim)' })
      setPicked({ machine: chosen.machine, folder: chosen.folder })
      if (chosen.machine !== machine) onOtherMachine(chosen.machine)
    }).finally(() => { text.current?.focus() })
  }
  // The clone window (a link typed there, or the account's repositories) answers with the new folder.
  const openCloneWindow = (opening: CloneOpening) => {
    if (cloner === null) return
    void cloner.open(opening).then((cloned) => { if (cloned !== null) openFolder(cloned) }).finally(() => { text.current?.focus() })
  }
  // A pasted GitHub link is cloned from the list's own row, in place, into the machine's usual destination.
  const cloneHere = (repo: RepoAddress, into: string) => {
    if (cloner === null) return
    const label = `${repo.owner}/${repo.name}`
    setCloning({ repo: label, address: repo.address, parent: into, problem: null })
    cloner.run(repo.address, into).then(
      (cloned) => { cloner.remember(into); setCloning(null); openFolder(cloned) },
      (failure: unknown) => {
        const said = failure instanceof Error ? failure.message : typeof failure === 'string' ? failure : ''
        setCloning({ repo: label, address: repo.address, parent: into, problem: explainCloneFailure(said) })
      },
    )
  }

  // The agent's commands, offered while a slash and a name are typed: picking one writes it into the first message.
  const query = slashQuery(message)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const commandsFrom = abilitiesOf(agent).slashCommands === null || folder === '' ? null : { agent, folder, machine }
  const slashing = query !== null && closedFor !== message && commandsFrom !== null
  const slash = useSlashCommands(commandsFrom, slashing)
  const matches = useMemo(() => (query === null ? [] : matchCommands(slash.commands, query)), [slash.commands, query])
  const [cursor, setCursor] = useState({ query: '', index: 0 })
  const active = cursor.query === query ? Math.min(cursor.index, Math.max(0, Math.min(matches.length, MAX_SHOWN) - 1)) : 0
  const complete = (command: SlashCommand) => {
    setMessage(commandText(command))
    text.current?.focus()
  }
  const pickerKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!slashing) return false
    if (event.key === 'Escape') {
      setClosedFor(message)
      return true
    }
    const chosen = matches[active]
    if (chosen === undefined) return false
    const count = Math.min(matches.length, MAX_SHOWN)
    if (event.key === 'ArrowDown') setCursor({ query, index: (active + 1) % count })
    else if (event.key === 'ArrowUp') setCursor({ query, index: (active + count - 1) % count })
    else if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey)) complete(chosen)
    else return false
    return true
  }
  // Enter starts; Shift+Enter is a new line. While the slash picker is open Enter picks the command instead.
  const onTextKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (pickerKey(event)) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      start()
    }
  }
  // Esc throws the draft away and goes back to the session that was in front.
  const discard = () => {
    discardDraft()
    onCancel?.()
  }
  // Ctrl+Enter starts from anywhere on the page; Ctrl+Shift+Enter starts it in the background; Esc discards.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (event.shiftKey) startInBackground()
      else start()
    // An Escape from a menu (portalled, so outside this element) closes only that.
    } else if (event.key === 'Escape' && onCancel !== undefined && !starting && event.target instanceof Node && event.currentTarget.contains(event.target)) {
      event.preventDefault()
      discard()
    }
  }

  const dot = (colour: string): ReactNode => <span className="mx-nsd-dot" style={{ background: colour }} aria-hidden="true" />
  // A machine that is down stays in the list with the reason in words, so it is never a silent absence.
  const machineRows: ChipItem[] = machines.map((candidate) => {
    const why = candidate.down ?? null
    return {
      key: `machine:${String(candidate.machine)}`,
      label: candidate.label,
      ...(why === null ? {} : { sub: why, right: <span className="mx-nc-in-use" title={why}>not reachable</span> }),
      icon: dot(why === null ? 'var(--ok)' : 'var(--dim)'),
      checked: candidate.machine === machine,
      disabled: why !== null,
      onPick: () => { if (candidate.machine !== machine) onOtherMachine(candidate.machine) },
    }
  })
  const folderItem = (project: NewSessionProject): ChipItem => ({
    key: project.folder,
    label: project.name,
    sub: project.folder === folder && notRepo ? `${project.folder} \u00b7 not a git repo` : project.folder,
    icon: <FolderMark />,
    checked: project.folder === folder,
    onPick: () => { setPicked({ machine, folder: project.folder }) },
  })
  // What typing in the project search can make: a pasted GitHub link becomes the first row (Clone owner/name to the
  // machine's folder), a path "Use <path>". A bare owner/name is only a clone when no project of that name is listed.
  const fromTyped = (typed: string): ChipItem | null => {
    if (cloner !== null && carriesCredentials(typed)) {
      return { key: 'clone-credentials', label: 'Remove the user name and password from that link first', icon: <Icon name="repo" size={12} />, checked: false, disabled: true, onPick: () => undefined }
    }
    const repo = cloner === null ? null : parseRepoAddress(typed)
    const needle = typed.toLowerCase()
    const listed = shown.some((project) => `${project.name} ${project.folder}`.toLowerCase().includes(needle))
    if (cloner !== null && repo !== null && !(repo.bare && listed)) {
      const into = cloner.parent
      return { key: 'clone-link', label: `Clone ${repo.owner}/${repo.name} to ${cloneTargetOf(into, repo.name)}`, icon: <Icon name="repo" size={12} />, checked: false, onPick: () => { cloneHere(repo, into) } }
    }
    if (!isPath(typed)) return null
    return { key: 'path', label: `Use ${typed}`, icon: <Icon name="folder" size={12} />, checked: false, onPick: () => { openFolder(typed) } }
  }
  const branchRows: ChipItem[] = (branches?.branches ?? []).map((entry) => {
    const who = busyHere?.get(entry.name) ?? null
    const behind = sync?.branch === entry.name ? sync.behind : 0
    return {
      key: `branch:${entry.name}`,
      label: entry.name,
      mono: true,
      ...(who === null ? {} : { sub: `Open in \u201c${who}\u201d` }),
      right: who === null && behind === 0 ? undefined : (
        <>
          {who !== null && <span className="mx-nc-in-use" title={`${who} is working on it`}>in use</span>}
          {behind > 0 && <span className="mx-nc-behind" title="Commits on origin this branch does not have yet">{`${String(behind)} behind`}</span>}
        </>
      ),
      checked: (explicit?.name ?? here) === entry.name && explicit?.create !== true,
      onPick: () => { setBranchPick({ folder, pick: { name: entry.name, create: false, worktree: treeMode } }) },
    }
  })
  const fromBranchName = (typed: string): ChipItem | null => {
    if (!BRANCH_NAME.test(typed) || branchNameError(typed) !== null || (branches?.branches ?? []).some((entry) => entry.name === typed)) return null
    return { key: 'new-branch', label: `+ Create ${typed} from ${here ?? 'here'}`, checked: false, onPick: () => { setBranchPick({ folder, pick: { name: typed, create: true, worktree: treeMode } }) } }
  }
  const branchLabel = branch?.create === true ? branch.name : onBranch ?? 'detached'
  const busyLine = busyWith !== undefined && workIn !== 'folder' && onBranch !== null
    ? `${busyWith} is already working on ${onBranch} here, so this session gets its own worktree. Your checkout stays untouched.`
    : null
  const treeLine = busyLine ?? (treeMode && branch !== null ? `A copy of the repository on its own branch, ${branch.name}. Your checkout stays untouched.` : null)
  const modeLabel = treeMode ? 'New worktree' : 'This folder'
  const modeRows: ChipItem[] = [
    { key: 'mode:folder', label: 'This folder', sub: onBranch === null ? 'Edits your checkout directly.' : `Edits your checkout of ${onBranch} directly.`, checked: !treeMode, onPick: () => { setWorkIn('folder') } },
    { key: 'mode:tree', label: 'New worktree', sub: 'Its own copy on a new branch. Your checkout stays untouched.', checked: treeMode, onPick: () => { setWorkIn('tree') } },
  ]
  // Why the mode list is out of reach, said in the chip's tooltip.
  const modeTip = folder === '' ? 'Pick a project first.' : branchesRead ? `${folderName} is not a git repository, so a worktree cannot be made. Pick a project folder that is, or clone one.` : 'Reading the folder\u2026'
  // The checkout is judged only when the session would edit it, on the branch it is on: another branch is switched to, a new one is made from here.
  const editsCheckout = !remote && !treeMode && sync?.branch != null && sync.branch === onBranch && explicit?.create !== true
  const behindOrigin = editsCheckout ? sync.behind : 0
  const pulled = pull?.folder === folder ? pull.state : null
  const syncNote: SyncNote | null = !editsCheckout ? null
    : pulled === 'running' ? { kind: 'running', branch: sync.branch ?? '' }
    : pulled === 'done' && behindOrigin === 0 ? { kind: 'done', branch: sync.branch ?? '' }
    : behindOrigin > 0 ? { kind: sync.dirty ? 'dirty' : 'behind', branch: sync.branch ?? '', behind: behindOrigin }
    : null
  const updateFirst = () => {
    const name = sync?.branch ?? 'the branch'
    setPull({ folder, state: 'running' })
    setError(null)
    void pullFolder(folder)
      .then(() => { setPull({ folder, state: 'done' }); reloadSync(); reloadBranches() })
      .catch((failure: unknown) => { setPull(null); setError(explainError(failure, `Could not update ${name}`)) })
  }
  // A chip with no branch list, said in words: the folder is not a repository, is still being read, or is on another machine.
  const branchNote = remote
    ? { label: 'not read here', tip: `${targetLabel}'s branches are not read from here, so the session starts on what is checked out there. Set Work in to New worktree to start on a new branch instead.` }
    : folder === '' ? { label: 'no project', tip: 'Pick a project first, then its branch.' }
    : !branchesRead ? { label: 'reading…', tip: `Reading ${folderName}'s branches…` }
    : { label: 'no git repo', tip: `${folderName} is not a git repository, so there is no branch to pick. Pick a project folder that is, or clone one.` }

  const where = (
    <div className="mx-nsd-where" role="group" aria-label="Where it works">
      <span className="mx-nsd-word">Run on</span>
      <ChipMenu variant="token" triggerClass={`mx-nsd-token is-machine${targetDown === null ? '' : ' is-down'}`} side="bottom" width={TOKEN_LIST_WIDTH} title="Machine" hint="Where it runs" summary={targetDown === null ? targetLabel : `${targetLabel}, not reachable`}
        icon={<Icon name={remote ? 'server' : 'laptop'} size={13} />} label={<span className="mx-nsd-token-text">{targetLabel}</span>}
        search="Find a machine" sections={[{ heading: 'Machine', items: machineRows }]}
        footer={onAddMachine === undefined ? undefined : <button type="button" className="mx-chip-action" onClick={onAddMachine}><span className="mx-nsd-foot-mark" aria-hidden="true">+</span>Add a machine…</button>} />
      <span className="mx-nsd-word">in</span>
      <ChipMenu variant="token" triggerClass="mx-nsd-token" side="bottom" width={TOKEN_LIST_WIDTH} title="Project" hint={`on ${targetLabel}`} summary={folderName}
        icon={<FolderMark />} label={<span className="mx-nsd-token-text">{folderName}</span>}
        search={cloner === null ? 'Find a project or folder' : 'Find a project, or paste a GitHub link'} sections={[{ heading: 'Recent', items: shown.map(folderItem) }]} fromQuery={fromTyped}
        footer={(
          <>
          <div className="mx-nc-menu-foot">
            {pickFolder !== null && <button type="button" className="mx-chip-action" onClick={openPicker}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="folder" size={12} /></span>Open folder…</button>}
            {cloner !== null && <button type="button" className="mx-chip-action" onClick={() => { openCloneWindow({ start: 'link' }) }}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>Clone from link…</button>}
            {cloner !== null && <button type="button" className="mx-chip-action" onClick={() => { openCloneWindow({ start: 'repos' }) }}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>My GitHub repos…</button>}
          </div>
          <p className="mx-nsd-foot-hint">Type a path starting with ~ or / to open any folder.</p>
          </>
        )} />
      <span className="mx-nsd-word">from</span>
      {branches !== null && !remote ? (
        <ChipMenu variant="token" triggerClass="mx-nsd-token is-branch" side="bottom" width={TOKEN_LIST_WIDTH} title="Branch" hint={`in ${folderName}`} summary={branchLabel}
          icon={<Icon name="branch" size={12} />} label={<span className="mx-nsd-token-text is-mono">{branchLabel}</span>}
          search="Find or name a new branch" sections={[{ heading: 'Branches', items: branchRows }]} fromQuery={fromBranchName} queryError={branchNameError}
          open={branchOpen} onOpenChange={setBranchOpen}
          searchEnd={(
            <button type="button" className="mx-chip-fetch" title="git fetch origin" disabled={fetchState === 'running'} onClick={fetchAgain}>
              {fetchState === 'running' ? 'Fetching\u2026' : fetchState === 'done' ? 'Fetched just now \u21bb' : 'Fetch \u21bb'}
            </button>
          )} />
      ) : (
        // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
        <button type="button" className="mx-nsd-token is-branch is-quiet" aria-disabled="true" aria-label={`Branch unavailable: ${branchNote.label}`} title={branchNote.tip}>
          <Icon name="branch" size={12} /><span className="mx-nsd-token-text">{branchNote.label}</span>
        </button>
      )}
      {canTree ? (
        <ChipMenu variant="token" triggerClass="mx-nsd-token is-mode" side="bottom" width={TOKEN_LIST_WIDTH} title="Work in" hint={`in ${folderName}`} summary={modeLabel} icon={<Icon name={treeMode ? 'branch' : 'folder'} size={12} />}
          label={<span className="mx-nsd-token-text">{modeLabel}</span>} sections={[{ heading: 'Work in', items: modeRows }]} />
      ) : (
        <button type="button" className="mx-nsd-token is-mode is-quiet" aria-disabled="true" aria-label="Work in unavailable" title={modeTip}>
          <Icon name="folder" size={12} /><span className="mx-nsd-token-text">n/a</span>
        </button>
      )}
    </div>
  )
  const permissionChip = (
    <span className={`mx-nsd-perm${permission.danger ? ' is-danger' : ''}`} role="status" aria-label={`Permissions: ${permission.text}`} title="What the session may do without asking. Change it under More options.">
      <Icon name="shield" size={12} />{permission.text}
    </span>
  )
  const moreOptions = (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="mx-nsd-more-toggle" aria-label="More options" title="More options: Skip permission prompts"><Icon name="more" size={14} /></button>
      </Popover.Trigger>
      <PopupContent side="bottom" align="start" aria-label="More options" className="mx-nsd-more-body" style={{ width: TOKEN_LIST_WIDTH }}>
        <label className="mx-nsd-option">
          <Switch aria-label="Skip permission prompts" checked={bypass} onCheckedChange={setBypass} />
          <span><strong>Skip permission prompts</strong><small>{`On: ${permissionWords(agent, true).text}. Off: ${permissionWords(agent, false).text}.`}</small></span>
        </label>
      </PopupContent>
    </Popover.Root>
  )
  return (
    <section className="mx-newchat" aria-label="New session" onKeyDown={onKeyDown}>
      <header className="mx-pane-head mx-nc-head">
        {leading}
        <span className="mx-nc-mark" aria-hidden="true" />
        <h2 className="mx-nc-draft-name">New session</h2>
        <span className="mx-pane-controls">
          <span className="mx-nc-state">{starting ? 'Starting…' : 'Draft · not started'}</span>
          {onCancel !== undefined && <button type="button" className="mx-pane-control" aria-label="Close" title="Discard (Esc)" disabled={starting} onClick={discard}><Icon name="close" size={13} /></button>}
        </span>
      </header>
      <div className="mx-nc-body">
      {sent === null ? (
        <div className="mx-nc-intro">
          <h1 className="mx-nc-title">What should we build?</h1>
          <p className="mx-nc-sub">{`${AGENT_LABEL[agent]} starts as soon as you send. You can rename the session any time.`}</p>
          {where}
        </div>
      ) : (
        // The same card the session's chat draws until its agent reports in, so the swap to the real pane changes nothing the eye sees.
        <div className="mx-nc-start is-starting" role="status">
          <div className="mx-chat-row"><div className="mx-msg-user is-echo" aria-label="Sending"><p>{sent}</p></div></div>
          <div className="mx-chat-row">
            <div className="mx-chat-starting">
              <span className="mx-chat-starting-title"><WorkingMark agent={agent} />Starting {AGENT_LABEL[agent]}…</span>
              <p>{`Your message is sent as soon as ${agent} is ready.`}</p>
            </div>
          </div>
        </div>
      )}
      <div ref={box} className="mx-composer">
        <div className="mx-composer-column">
          <div className={`mx-box${starting ? ' is-locked' : ''}`}>
            {slashing && <SlashPicker agent={AGENT_LABEL[agent]} typed={message.trim()} matches={matches} active={active} loading={slash.loading} error={slash.error} onPick={complete} onHover={(index) => { setCursor({ query, index }) }} />}
            <DraftAttachments attachments={attachments} onRemove={attach.remove} />
            <textarea ref={text} onKeyDown={onTextKey} onPaste={onPaste} aria-label="What should we work on?" rows={2} value={message} disabled={starting} placeholder="Describe the task, or type / for commands" className="mx-box-text" onChange={(event) => { setMessage(event.target.value) }}
              {...(slashing && matches.length > 0 ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-slash-list', 'aria-activedescendant': `mx-slash-${String(active)}` } : {})} />
            {!remote && <button type="button" className="mx-box-attach" aria-label="Attach files" title="Attach files" onClick={attach.pick}><Icon name="plus" size={16} /></button>}
            <div className="mx-box-row mx-nsd-who">
              <div className="mx-nsd-agent">
                <AgentPicker compact side="bottom" fixedModels={remote} agent={agent} choice={choice} onChange={changeChoice} onAgent={pickAgent} />
              </div>
              {permissionChip}
              {moreOptions}
              <span className="mx-spacer" />
              {remote && <span className="mx-nc-on" title={`The agent starts on ${targetLabel}`}>On {targetLabel}</span>}
              <button type="button" className={`mx-send${off ? ' is-off' : ''}`} aria-label="Start session" aria-keyshortcuts="Enter" disabled={off} title={folder === '' ? 'Pick a project first' : 'Start (Enter)'} onClick={() => { start() }}>
                <Icon name="arrowUp" size={15} strokeWidth={2.2} />
              </button>
            </div>
          </div>
          {agent === 'gemini' && <p className="mx-composer-note">{GEMINI_TERMINAL_LINE}</p>}
          <div className="mx-composer-note mx-nc-foot">
            <span className="mx-nc-works">{remote ? 'On another machine it starts and opens.' : folder === '' ? '' : `Works in ${folder}${branches === null ? '' : ` on ${branchLabel}`}`}</span>
            <span className="mx-nc-keys"><b>Enter</b> start · <b>Shift+Enter</b> new line{onCancel === undefined || remote ? '' : <>{' · '}<b>{BACKGROUND_KEY}</b> in the background</>}</span>
          </div>
          <StartNotes error={error} treeLine={treeLine} syncNote={syncNote} onUpdate={updateFirst} onUseWorktree={() => { setWorkIn('tree') }} onFix={() => { setBranchOpen(true) }} background={background} onPutBack={putBack} agentMissing={agentMissing ? agent : null} onSetUp={() => { void openAgentDocs(agent).catch((failure: unknown) => { setError(explainError(failure, 'Could not open the setup page')) }) }}
            machineDown={targetDown === null ? null : { label: targetLabel, why: targetDown }}
            clone={cloning} onUseFolder={(path) => { setCloning(null); openFolder(path) }} onDismissClone={() => { setCloning(null) }}
            onPickAnotherFolder={cloner === null || cloning === null ? undefined : () => { const again = cloning; setCloning(null); openCloneWindow({ start: 'link', address: again.address, parent: again.parent }) }}
            onOpenGitHubSettings={cloner?.onOpenGitHubSettings} />
        </div>
      </div>
      </div>
    </section>
  )
}

type NotesProps = {
  error: ExplainedError | null
  treeLine: string | null
  syncNote: SyncNote | null
  onUpdate: () => void
  onUseWorktree: () => void
  /** The button a failure offers (Pick another branch): opens the branch list. */
  onFix: () => void
  background: ReturnType<typeof useBackgroundStarts>
  onPutBack: (key: number) => void
  agentMissing: ChatAgent | null
  onSetUp: () => void
  /** The machine is down: why, in words. */
  machineDown: { label: string; why: string } | null
  /** The clone the project list's row is running, or that failed. */
  clone: CloneState | null
  onUseFolder: (path: string) => void
  onDismissClone: () => void
  onPickAnotherFolder: (() => void) | undefined
  onOpenGitHubSettings: (() => void) | undefined
}

/** What went wrong or is going on, under the boxes: a machine that is down, a clone, the start's own failure, the background starts that failed, a missing agent; and the worktree line. */
function StartNotes({ error, treeLine, syncNote, onUpdate, onUseWorktree, onFix, background, onPutBack, agentMissing, onSetUp, machineDown, clone, onUseFolder, onDismissClone, onPickAnotherFolder, onOpenGitHubSettings }: NotesProps) {
  const problem = clone?.problem ?? null
  return (
    <>
      {machineDown !== null && <p role="alert" className="mx-nsd-note is-error">{`${machineDown.label} is not reachable: ${machineDown.why}. Pick another machine, or fix this one in Settings.`}</p>}
      {clone !== null && problem === null && <p role="status" className="mx-nsd-note">{`Cloning ${clone.repo}… A large repository can take a few minutes.`}</p>}
      {clone !== null && problem !== null && (
        <div className="mx-nsd-note">
          <InlineNote
            title={`Could not clone ${clone.repo}`}
            reason={problem.message}
            actions={(
              <>
                {problem.kind === 'exists' && problem.folder !== undefined && <FeedbackButton kind="primary" onClick={() => { onUseFolder(problem.folder ?? '') }}>Use it</FeedbackButton>}
                {(problem.kind === 'exists' || problem.kind === 'no-folder') && onPickAnotherFolder !== undefined && <FeedbackButton kind="text" onClick={onPickAnotherFolder}>Pick another folder</FeedbackButton>}
                {problem.kind === 'auth' && onOpenGitHubSettings !== undefined && <FeedbackButton kind="primary" onClick={onOpenGitHubSettings}>Open GitHub settings</FeedbackButton>}
                <FeedbackButton kind="text" onClick={onDismissClone}>Dismiss</FeedbackButton>
              </>
            )}
          />
        </div>
      )}
      {syncNote !== null && <SyncLine note={syncNote} onUpdate={onUpdate} onUseWorktree={onUseWorktree} />}
      {treeLine !== null && <p className="mx-nsd-note">{treeLine}</p>}
      {error !== null && <div className="mx-nsd-note"><InlineNote title={error.title} reason={error.reason} actions={error.fix === undefined && error.details === null ? undefined : <FixActions error={error} onFix={onFix} />} /></div>}
      {background.failed.map((failed) => (
        <div key={failed.key} className="mx-nsd-note">
          <InlineNote
            title={failed.error.title}
            reason={failed.error.reason}
            actions={(
              <>
                {failed.error.fix === PICK_ANOTHER_BRANCH && <FeedbackButton kind="primary" onClick={onFix}>{failed.error.fix}</FeedbackButton>}
                {failed.draft !== null && <FeedbackButton kind="primary" aria-label={`Put back ${failedStartLabel(failed)}`} onClick={() => { onPutBack(failed.key) }}>Put back</FeedbackButton>}
                <FeedbackButton kind="text" aria-label={`Dismiss ${failedStartLabel(failed)}`} onClick={() => { background.dismiss(failed.key) }}>Dismiss</FeedbackButton>
                {failed.error.details !== null && <CopyDetails text={`${failed.error.title}\n${failed.error.details}`} copy={copyText} />}
              </>
            )}
          />
        </div>
      ))}
      {agentMissing !== null && (
        <p role="alert" className="mx-nsd-note is-error">
          {`${AGENT_LABEL[agentMissing]} is not installed on this computer. Pick another agent, or `}
          <button type="button" className="mx-text-button" onClick={onSetUp}>set it up</button>.
        </p>
      )}
    </>
  )
}

/** How the checkout stands against origin, when the session would edit it: being brought up to date, up to date, behind, or behind and holding uncommitted changes. */
type SyncNote = { kind: 'running' | 'done'; branch: string } | { kind: 'behind' | 'dirty'; branch: string; behind: number }

/** The banner under the message box about the checkout. A dirty checkout cannot be fast-forwarded, so it offers a worktree instead of an update. */
function SyncLine({ note, onUpdate, onUseWorktree }: { note: SyncNote; onUpdate: () => void; onUseWorktree: () => void }) {
  const name = <b className="mx-nsd-sync-name">{note.branch}</b>
  return (
    <p role="status" className="mx-nsd-note mx-nsd-sync">
      <span>
        {note.kind === 'running' && <>Updating {name}…</>}
        {note.kind === 'done' && <>{name} is up to date with origin.</>}
        {note.kind === 'behind' && <>{name} is {note.behind} behind origin.</>}
        {note.kind === 'dirty' && <>{name} is {note.behind} behind origin, and it has changes that aren't committed, so it can't be updated cleanly.</>}
      </span>
      {note.kind === 'behind' && <button type="button" className="mx-text-button" onClick={onUpdate}>Update first</button>}
      {note.kind === 'dirty' && <button type="button" className="mx-text-button" onClick={onUseWorktree}>Use a worktree</button>}
    </p>
  )
}

/** A failure's buttons: what can be done about it, and its own text to copy. */
function FixActions({ error, onFix }: { error: ExplainedError; onFix: () => void }) {
  return (
    <>
      {error.fix === PICK_ANOTHER_BRANCH && <FeedbackButton kind="primary" onClick={onFix}>{error.fix}</FeedbackButton>}
      {error.details !== null && <CopyDetails text={`${error.title}\n${error.details}`} copy={copyText} />}
    </>
  )
}
