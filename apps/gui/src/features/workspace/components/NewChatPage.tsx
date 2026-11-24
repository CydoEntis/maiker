import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useWarmAgent, type WarmAgent, type WarmSpec } from '../useWarmAgent'
import { buildAttachmentMessage } from '@/features/chat/attachmentMessage'
import { updateComposer, useComposerState } from '@/features/chat/composerStore'
import { revokePreviews, useAttachmentIntake } from '@/features/chat/useAttachmentIntake'
import { WorkingMark } from '@/features/chat/components/WorkingMark'
import { explainError, explainStartFailure, PICK_ANOTHER_BRANCH, type ExplainedError } from '@/lib/error-message'
import { DEFAULT_PICK, START_REASONING, type AgentChoice } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { BYPASS_MODE, CODEX_FULL_MODE, DANGER_MODES, modeLabel, START_MODE } from '@/features/chat/chatMeta'
import { Composer, type ComposerFacts } from '@/features/chat/components/Composer'
import { FolderChip } from '@/features/chat/place/FolderChip'
import { MachineChip } from '@/features/chat/place/MachineChip'
import type { SessionPlace } from '@/features/chat/components/SessionBar'
import type { ChatComposer } from '@/features/chat/useChatComposer'
import type { PlacePicking } from '@/features/chat/place/picking'
import { openAgentDocs, pullFolder } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { chatAgentOf, type ChatAgent } from '../model/chatView'
import { abilitiesOf } from '../model/agentAbilities'
import { useFolderBranches, useFolderSync, useInstalledAgents } from '../model/newChatHost'
import type { BusyBranches, NewSessionProject } from '../model/newSession'
import { nameForTask, slugFromTask, suggestBranchName } from '../model/worktreeName'
import { carriesCredentials, cloneTargetOf, explainCloneFailure, parseRepoAddress, type CloneProblem, type RepoAddress } from '../model/repoAddress'
import { readLastWho, rememberWho } from '../model/lastWho'
import { discardDraft, parkDraft, parkedDraft } from '../model/newSessionDraft'
import { FolderMark, Icon } from './glyphs'
import { type ChipItem } from './NewChatMenus'
import { NEW_SESSION } from '../model/sidebar'
import { Tag } from '@/components/ui/tag'
import { loadAcpAgents } from '@/api/acpAgents'
import { failedStartLabel, useBackgroundStarts } from '../useBackgroundStarts'
import type { PickedFolder } from '../model/folderPick'
import { CopyDetails, FeedbackButton, InlineNote } from '@/components/ui/feedback'
import { copyText } from '@/lib/clipboard'
import { AcpAgentsDialog, type OtherAgent } from './AcpAgentsDialog'
import { IconButton } from '@/components/ui/icon-button'

/**
 * The branch a session starts on when it is not the folder's current one: switch to it, or work in a new worktree of it.
 * With `base`, the worktree is a copy of that branch on a new branch of its own, `name`.
 */
export type BranchChoice = { name: string; create: boolean; worktree: boolean; base?: string }

/**
 * What the page asks the window to start: a session with this agent, model and effort, in this folder, and its first
 * message; `resume` names a saved conversation to continue. `view` is which view it opens in (its chat or its terminal),
 * `bypass` is this session's Bypass Permissions choice over Settings, and `name` a name for it; without one the first
 * message names the session.
 */
export type NewChatRequest = { folder: string; agent: ChatAgent; model: string; reasoning: AgentChoice['reasoning']; mode: string; message: string; branch: BranchChoice | null; machine: number; machineName: string; resume: string | null; /** An agent run over ACP by this id, in place of `agent` (ADR 0021); the model, effort and mode are then its own. */ acp?: string; name?: string; /** When the saved conversation being resumed was last used (unix seconds): the chat's age counts from then. */ lastActive?: number; bypass?: boolean | undefined }

/** What the draft opens with: a folder and a first message (a chat continued from a full one), and the agent a + menu pick asked for. */
export type NewChatSeed = {
  folder: string
  message: string
  agent?: ChatAgent
  /** Start with Own worktree on: a project's New worktree, asked where no session is open to make one from. */
  worktree?: boolean
}

/** How a start is asked for: `background` starts the session without opening it, and the page stays for the next; `onPlaced` hears its id. */
export type NewChatStartOptions = { background?: boolean; /** Told the new session's id once it is in the sidebar (this computer's sessions only). */ onPlaced?: (id: string) => void }

/** A computer a session could start on. `down` is why it cannot, in words, when it cannot. */
export type NewChatMachine = { machine: number; /** What the machine is called on screen. */ label: string; /** What the daemon calls it; null for this computer. */ name?: string | null; local: boolean; down?: string | null }

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
  /** Opens the palette's folder browser on that machine and answers with the folder chosen (and the machine it is on), or null when it is cancelled. Null when there is none. */
  pickFolder: ((machine: number) => Promise<PickedFolder | null>) | null
  /** Brings a repository onto this machine. Without it the project list has no clone rows. */
  cloner?: RepoCloner | null
  /** Opens the Open a project window (clone from a link, a GitHub repository, a folder here); its pick comes back as a new seed. This computer only. */
  onOpenProject?: (() => void) | undefined
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
  seed?: NewChatSeed | null
  /** Before the where chips: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
  /** The Chat view is on, so a session on this computer can start another agent over ACP (ADR 0021). */
  otherAgents?: boolean
  /** Where a session with no project runs on this machine (Settings' start folder); without it there is no such choice. */
  looseFolder?: string
}

/** The key the first message's files are kept under: no conversation exists yet, and a real one is never negative. */
const NEW_CHAT_DRAFT = -1

const lastPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const isPath = (text: string): boolean => /^(~|\/|[A-Za-z]:[\\/])/.test(text)
const NO_BUSY: BusyBranches = new Map()
const NO_BUSY_HERE: ReadonlyMap<string, string> = new Map()
/** No agent switched off: every one starts on its skip-permissions mode. */
const NONE_OFF: readonly ChatAgent[] = []
const FIRST_CHOICE: AgentChoice = { model: DEFAULT_PICK, reasoning: START_REASONING }
/** Said under the agent when Gemini is picked in the Terminal view: it has no chat events, so it stays a terminal. In the Chat view it runs over ACP. */
const GEMINI_TERMINAL_LINE = 'Gemini has no chat view yet, so this session opens in its terminal.'

/** Where the session works: in the checkout, a worktree of its own, or `auto`: a worktree only when another session is on that branch here. */
type WorkIn = 'auto' | 'folder' | 'tree'

/** A folder the person picked, with the machine it is on: a folder means nothing on another machine. */
type Picked = { machine: number; folder: string }

/** A clone the page is running or that failed: what it was for, and where it went. */
type CloneState = { repo: string; address: string; parent: string; problem: CloneProblem | null }

/** The agent's permission mode for a session that skips its prompts: Bypass permissions, or Codex's Full access. */
const skipMode = (agent: ChatAgent): string => (agent === 'codex' ? CODEX_FULL_MODE : BYPASS_MODE)

/** Gemini has no mode switch of its own: the draft offers asking, or skipping its prompts. */
const GEMINI_MODES: readonly string[] = [START_MODE.gemini, BYPASS_MODE]

const NO_QUEUE: ChatComposer['queue'] = []
const nothing = (): void => undefined
const refused = (): Promise<boolean> => Promise.resolve(false)

/**
 * The New session draft: a chat that has not been sent yet, in the main area, never a dialog. It is the pane a started chat
 * has, drawn from the same parts: the chat pane's header (`project / New session` and ×, which discards the draft), an
 * empty conversation that asks "What are we building today?", the one chat box (`Composer`: agent, model and reasoning
 * level, permission mode, attach and send inside it) and under it the chips row (`SessionBar`): machine, folder, branch
 * and sync. Before the first message those chips choose instead of show: the machine's menu picks another computer, the folder's opens a recent project,
 * a folder or a clone (a pasted GitHub link becomes a Clone row), the branch's picks, names or makes a worktree. Nothing
 * starts before Enter; then the session starts with all of it and this same view shows the Starting card until the window
 * swaps in the session's pane in one update. It is always an agent session (ADR 0003); Settings says which view it opens
 * in. Ctrl+Enter (⌘Enter on macOS) starts from anywhere, Ctrl+Shift+Enter starts it in the background and keeps the draft
 * for the next one, Esc discards it. A plain shell is "New terminal", not here.
 */
export function NewChatPage({ machines, machine, projects, busy: busyBranches = NO_BUSY, defaultAgent, bypassOff = NONE_OFF, pickFolder, cloner = null, onOpenProject, onStart, onWarm, onOtherMachine, onAddMachine, onCancel, onAgentChange, seed = null, otherAgents = false, leading, looseFolder }: Props) {
  // On another machine the session is the agent started in a shell there: this computer's extra models, branches and installed agents say nothing of it.
  const remote = machine !== LOCAL_MACHINE
  const target = machines.find((candidate) => candidate.machine === machine)
  const targetLabel = target?.label ?? 'This computer'
  const targetName = target?.name ?? targetLabel
  const targetDown = target?.down ?? null
  // The agent and the model and effort each was left at start as they were last used.
  const [last] = useState(readLastWho)
  const [agent, setAgent] = useState<ChatAgent>(seed?.agent ?? last?.agent ?? defaultAgent)
  useEffect(() => { onAgentChange?.(agent) }, [agent, onAgentChange])
  const bypassOn = (which: ChatAgent) => !bypassOff.includes(which)
  // The mode the session starts in. Bypass Permissions (Settings) starts Claude in Bypass permissions and Codex in Full access; the
  // permission control changes it for this session, and it is kept until another agent is picked.
  const modeAtStart = (which: ChatAgent) => (bypassOn(which) ? skipMode(which) : START_MODE[which])
  const [mode, setMode] = useState(() => modeAtStart(seed?.agent ?? last?.agent ?? defaultAgent))
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
  const [workIn, setWorkIn] = useState<WorkIn>(seed?.worktree === true ? 'tree' : 'auto')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<ExplainedError | null>(null)
  // A clone started from the project list's own row; the clone window has its own state.
  const [cloning, setCloning] = useState<CloneState | null>(null)
  const background = useBackgroundStarts(onStart)
  // Branch names sessions started from this dialog took, which the branch list may not show yet: the next suggestion avoids them.
  const [takenNames, setTakenNames] = useState<ReadonlySet<string>>(() => new Set())
  const page = useRef<HTMLElement>(null)
  const focusBox = () => { page.current?.querySelector<HTMLTextAreaElement>('.mx-box-text')?.focus() }
  const { attachments } = useComposerState(NEW_CHAT_DRAFT)
  // A new session runs where the folder is, so files are copied to this computer and named by path in the first message.
  const attach = useAttachmentIntake({ conversation: NEW_CHAT_DRAFT, blocked: remote ? `Files stay on this computer, not on ${targetLabel}` : starting ? 'The session is starting' : null })
  // Files meant for a session that was never started are not kept for the next one.
  useEffect(() => () => {
    updateComposer(NEW_CHAT_DRAFT, (state) => { revokePreviews(state.attachments); return { ...state, attachments: [] } })
  }, [])
  // It opens ready to type, on the most recent project.
  const folder = picked?.machine === machine ? picked.folder : projects[0]?.folder ?? ''
  const added = extra?.machine === machine ? extra : null
  const shown = added === null || projects.some((project) => project.folder === added.folder) ? projects : [...projects, added]
  const current = shown.find((project) => project.folder === folder)
  const folderName = current?.name ?? (folder === '' ? 'Choose a project' : lastPart(folder))
  const installed = useInstalledAgents()
  const [branches, reloadBranches, branchesRead] = useFolderBranches(remote ? '' : folder)
  const { sync, read: syncRead, reload: reloadSync } = useFolderSync(remote ? '' : folder)
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
    // A worktree of a picked branch is a copy of it on a new branch, so the branch itself stays free for its checkout.
    if (explicit !== null && treeMode && !explicit.create && suggested !== null) return { name: suggested, create: true, worktree: true, base: explicit.name }
    if (explicit !== null) return { ...explicit, worktree: treeMode }
    return treeMode && suggested !== null ? { name: suggested, create: true, worktree: true } : null
  }, [explicit, treeMode, suggested])
  const isInstalled = (id: string) => (installed === null ? chatAgentOf(id) !== null : installed.includes(id))
  // Another agent, run over ACP in place of the one picked: only for a chat on this computer.
  const [other, setOther] = useState<OtherAgent | null>(null)
  const [othersOpen, setOthersOpen] = useState(false)
  const acp = otherAgents && !remote ? other : null
  // The ACP agents that are ready to run here, for the picker's rail; read again once the Other agents dialog (which installs and removes them) closes.
  const [readyOthers, setReadyOthers] = useState<readonly OtherAgent[]>([])
  useEffect(() => {
    if (!otherAgents || remote || othersOpen) return undefined
    let live = true
    loadAcpAgents().then(
      (agents) => { if (live) setReadyOthers(agents.filter((candidate) => candidate.source === 'config' || candidate.installed !== null).map(({ id, name }) => ({ id, name }))) },
      (error: unknown) => { console.warn('Could not list the agents that run over ACP', error) },
    )
    return () => { live = false }
  }, [otherAgents, remote, othersOpen])
  // The one picked is on the rail even before the list has been read again.
  const railOthers = acp === null || readyOthers.some((candidate) => candidate.id === acp.id) ? readyOthers : [...readyOthers, acp]
  const agentMissing = !remote && acp === null && !isInstalled(agent)

  // The message box takes the keys when the draft opens, and again after a start that did not go through.
  useEffect(() => { if (!starting) focusBox() }, [folder, starting])

  const pickAgent = (next: ChatAgent) => {
    setAgent(next)
    // Whether it skips permission prompts is the agent's own setting too.
    setMode(modeAtStart(next))
  }
  const modes = abilitiesOf(agent).permissionModes?.modes ?? []
  const bypass = DANGER_MODES.includes(mode)
  // Bypass Permissions already starts Codex with full access, and its flag cannot be combined with a mode's.
  const forcedFull = abilitiesOf(agent).yoloExcludesMode && bypass
  const startMode = !forcedFull && modes.includes(mode) ? mode : 'default'
  // A branch or a worktree is made when the session starts, so only a session on the folder as it is can have its agent started ahead.
  const warmSpec = useMemo<WarmSpec | null>(
    () => (remote || folder === '' || agentMissing || branch !== null ? null : { folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, bypass }),
    [remote, folder, agentMissing, branch, agent, choice.model, choice.reasoning, startMode, bypass],
  )
  // A start in the background takes the warm agent; asking again while it starts would make a second one.
  useWarmAgent(onWarm, warmSpec, starting || background.pending > 0)
  const requestFor = (task: string): NewChatRequest => ({
    folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, message: buildAttachmentMessage(task.trim(), attachments), bypass,
    branch: remote && branch?.worktree !== true ? null : branch, machine, machineName: targetName, resume: null, ...(acp === null ? {} : { acp: acp.id }),
  })
  const empty = message.trim() === '' && attachments.length === 0
  // Why the box cannot start anything now, said in its own place; typing stays open.
  const blocked = starting ? 'The session is starting'
    : folder === '' ? 'Choose a folder first'
    : agentMissing ? `${AGENT_LABEL[agent]} is not installed on this computer`
    : targetDown !== null ? `${targetLabel} is not reachable`
    : cloning !== null ? 'Cloning the repository…'
    : null
  const off = blocked !== null || empty
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
    focusBox()
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
    }).finally(() => { focusBox() })
  }
  // The clone window (a link typed there, or the account's repositories) answers with the new folder.
  const openCloneWindow = (opening: CloneOpening) => {
    if (cloner === null) return
    void cloner.open(opening).then((cloned) => { if (cloned !== null) openFolder(cloned) }).finally(() => { focusBox() })
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

  // The agent's commands, offered by the message box while a slash and a name are typed.
  const commandsFrom = abilitiesOf(agent).slashCommands === null || folder === '' ? undefined : { agent, folder, machine }
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
  const branchLabel = branch?.create === true && branch.base === undefined ? branch.name : onBranch ?? 'detached'
  const busyLine = busyWith !== undefined && workIn !== 'folder' && onBranch !== null
    ? `${busyWith} is already working on ${onBranch} here, so this session gets its own worktree. Your checkout stays untouched.`
    : null
  const treeLine = busyLine ?? (treeMode && branch !== null ? `A copy of ${branch.base ?? 'the repository'} on its own branch, ${branch.name}. Your checkout stays untouched.` : null)
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

  const folderRows = (shown.map(folderItem))
  // What the row under the box chooses with before the first message (docs/DESIGN.md, Under the box).
  const picking: PlacePicking = {
    machine: {
      label: targetLabel, remote, down: targetDown,
      sections: [{ heading: 'Machine', items: machineRows }],
      footer: onAddMachine === undefined ? undefined : <button type="button" className="mx-chip-action" onClick={onAddMachine}><span className="mx-nsd-foot-mark" aria-hidden="true">+</span>Add a machine…</button>,
    },
    folder: {
      search: cloner === null ? 'Find a project or folder' : 'Find a project, or paste a GitHub link',
      sections: [{ heading: 'Recent projects', items: folderRows }],
      fromQuery: fromTyped,
      footer: (
        <>
          <div className="mx-nc-menu-foot">
            {pickFolder !== null && <button type="button" className="mx-chip-action" onClick={openPicker}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="folder" size={12} /></span>Open folder…</button>}
            {cloner === null && onOpenProject !== undefined && !remote && <button type="button" className="mx-chip-action" onClick={onOpenProject}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>Clone a repository…</button>}
            {cloner !== null && <button type="button" className="mx-chip-action" onClick={() => { openCloneWindow({ start: 'link' }) }}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>Clone from link…</button>}
            {cloner !== null && <button type="button" className="mx-chip-action" onClick={() => { openCloneWindow({ start: 'repos' }) }}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>My GitHub repos…</button>}
          </div>
          <p className="mx-nsd-foot-hint">Type a path starting with ~ or / to open any folder.</p>
        </>
      ),
    },
    branch: {
      onPick: (name, create) => { setBranchPick({ folder, pick: { name, create, worktree: treeMode } }) },
      worktree: treeMode,
      onWorktree: (on) => { setWorkIn(on ? 'tree' : 'folder') },
      busy: remote || busyHere === undefined ? NO_BUSY_HERE : busyHere,
      open: branchOpen,
      onOpenChange: setBranchOpen,
    },
    // On another machine the worktree is still a choice; elsewhere without a repository nothing is.
    noBranch: branches !== null && !remote ? null : remote
      ? { ...branchNote, label: treeMode ? 'new worktree' : branchNote.label, worktree: { on: treeMode, onChange: (on) => { setWorkIn(on ? 'tree' : 'folder') } } }
      : branchNote,
    sync: !treeMode && explicit === null,
  }
  const place: SessionPlace = {
    machine: null, project: folderName, branch: branches !== null && !remote && folder !== '' ? branchLabel : null, worktree: treeMode, folder, machineId: machine, worktreeName: null, picking,
  }
  const abilities = abilitiesOf(agent)
  const facts: ComposerFacts = {
    mode: modeLabel(mode), modeDanger: bypass, modeKey: mode, model: null,
    modes: abilities.permissionModes?.modes ?? GEMINI_MODES, modeAgent: agent, onPickMode: setMode, bypassAllowed: true,
    agentChips: {
      locked: null, start: choice, remote, onChange: changeChoice, onAgent: pickAgent, installed: remote ? null : installed,
      ...(otherAgents && !remote ? { others: { list: railOthers, current: acp?.id ?? null, onPick: (id: string | null) => { setOther(id === null ? null : railOthers.find((candidate) => candidate.id === id) ?? null) } } } : {}),
    },
  }
  const composer: ChatComposer = {
    draft: message, setDraft: setMessage, attachments, attach, readOnly: false, attachable: !remote,
    queue: NO_QUEUE, removeQueued: nothing, editQueued: nothing, moveQueuedUp: nothing, clearQueued: nothing,
    submit: () => { start() }, stop: nothing, running: false, sending: starting, disabledReason: blocked, draftable: !starting, ready: !off,
    error: null, sendText: refused, sendReply: refused, echo: null,
  }
  const notes = (
    <>
    <StartNotes error={error} treeLine={treeLine} syncNote={syncNote} onUpdate={updateFirst} onUseWorktree={() => { setWorkIn('tree') }} onFix={() => { setBranchOpen(true) }} background={background} onPutBack={putBack} agentMissing={agentMissing ? agent : null} onSetUp={() => { void openAgentDocs(agent).catch((failure: unknown) => { setError(explainError(failure, 'Could not open the setup page')) }) }}
      machineDown={targetDown === null ? null : { label: targetLabel, why: targetDown }} geminiLine={agent === 'gemini' && !otherAgents}
      clone={cloning} onUseFolder={(path) => { setCloning(null); openFolder(path) }} onDismissClone={() => { setCloning(null) }}
      onPickAnotherFolder={cloner === null || cloning === null ? undefined : () => { const again = cloning; setCloning(null); openCloneWindow({ start: 'link', address: again.address, parent: again.parent }) }}
      onOpenGitHubSettings={cloner?.onOpenGitHubSettings} />
    {otherAgents && !remote && (acp === null ? (
      <p className="mx-nsd-note">
        {'Want another agent? '}
        <button type="button" className="mx-text-button" disabled={starting} onClick={() => { setOthersOpen(true) }}>Other agents…</button>
      </p>
    ) : (
      <p className="mx-nsd-note" role="status">
        {`This session starts ${acp.name} over ACP, with its own model and permission settings. `}
        <button type="button" className="mx-text-button" disabled={starting} onClick={() => { setOthersOpen(true) }}>Change</button>
        {' '}
        <button type="button" className="mx-text-button" disabled={starting} onClick={() => { setOther(null) }}>{`Use ${AGENT_LABEL[agent]} instead`}</button>
      </p>
    ))}
    {othersOpen && <AcpAgentsDialog onPick={(picked) => { setOther(picked); setOthersOpen(false) }} onCancel={() => { setOthersOpen(false) }} />}
    </>
  )
  return (
    <section ref={page} className="mx-newchat" aria-label="New session" onKeyDown={onKeyDown}>
      <header className="mx-pane-head">
        {leading}
        {remote && <Tag className="mx-pane-machine">{targetLabel}</Tag>}
        <span className="mx-pane-title" title={folder === '' ? 'No folder chosen yet' : folder}>
          <span className="mx-pane-project">{folderName}</span><span className="mx-pane-slash" aria-hidden="true">/</span>
          <span className="mx-pane-name">{NEW_SESSION}</span>
        </span>
        {onCancel !== undefined && <IconButton label="Discard draft" tip="Discard draft (Esc)" disabled={starting} onClick={discard}><Icon name="close" /></IconButton>}
      </header>
      <div className="mx-newchat-body">
        <div className="mx-chat is-starting">
          {sent === null ? (
            // The question and where the session runs, over the box and centred with it: the machine and the project are the
            // two choices a new session most often needs changed, so they are large here and not only in the row under the box.
            <div className="mx-nc-hero">
              <h1 className="mx-chat-hello">{folder === '' || folder === looseFolder ? 'What are we building today?' : `What should we build in ${folderName}?`}</h1>
              <div className="mx-nc-hero-where">
                <MachineChip machine={picking.machine} hero />
                <FolderChip folder={folder} text={folder === '' ? 'Choose a project' : folder === looseFolder ? 'No project' : folderName} machine={machine} projects={[]} onNewSessionIn={openFolder} picking={picking.folder} hero />
                {looseFolder !== undefined && looseFolder !== '' && folder !== looseFolder && (
                  <button type="button" className="mx-nc-hero-loose" disabled={starting} title={`Runs in ${looseFolder}`} onClick={() => { openFolder(looseFolder) }}>or start without a project</button>
                )}
              </div>
            </div>
          ) : (
            // The same rows the session's chat draws until its agent reports in, so the swap to the real pane changes nothing the eye sees.
            <div className="mx-chat-scroller min-h-0 flex-1 overflow-y-auto" role="status">
              <div className="mx-chat-row"><div className="mx-msg-user is-echo" aria-label="Sending"><p>{sent}</p></div></div>
              <div className="mx-chat-row"><div className="mx-working"><WorkingMark agent={agent} /><span>Working…</span></div></div>
            </div>
          )}
          <Composer agent={agent} composer={composer} facts={facts} place={place} problem={notes} hint="Describe the task, or type / for commands" commandsFrom={commandsFrom} />
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
  /** Gemini is picked: it has no chat view, so the session opens in its terminal. */
  geminiLine: boolean
  /** The clone the project list's row is running, or that failed. */
  clone: CloneState | null
  onUseFolder: (path: string) => void
  onDismissClone: () => void
  onPickAnotherFolder: (() => void) | undefined
  onOpenGitHubSettings: (() => void) | undefined
}

/** What went wrong or is going on, under the boxes: a machine that is down, a clone, the start's own failure, the background starts that failed, a missing agent; and the worktree line. */
function StartNotes({ error, treeLine, syncNote, onUpdate, onUseWorktree, onFix, background, onPutBack, agentMissing, onSetUp, machineDown, geminiLine, clone, onUseFolder, onDismissClone, onPickAnotherFolder, onOpenGitHubSettings }: NotesProps) {
  const problem = clone?.problem ?? null
  return (
    <>
      {geminiLine && <p className="mx-nsd-note">{GEMINI_TERMINAL_LINE}</p>}
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
