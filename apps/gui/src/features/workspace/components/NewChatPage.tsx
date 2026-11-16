import { Button } from '@/components/ui/button'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useWarmAgent, type WarmAgent, type WarmSpec } from '../useWarmAgent'
import { toast } from '@/lib/toast'
import { pasteFromHost, pickFromClipboard, unsupportedMessage } from '@/features/terminal/clipboardImage'
import { buildAttachmentMessage } from '@/features/chat/attachmentMessage'
import { registerComposerDrop } from '@/features/chat/composerDrop'
import { updateComposer, useComposerState } from '@/features/chat/composerStore'
import { revokePreviews, useAttachmentIntake } from '@/features/chat/useAttachmentIntake'
import { DraftAttachments } from '@/features/chat/components/Attachments'
import { useKeepTyping } from '@/features/chat/useKeepTyping'
import { errorMessage } from '@/lib/error-message'
import { DEFAULT_PICK, modelsFor, START_REASONING, type AgentChoice } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { BYPASS_MODE, CODEX_FULL_MODE, DANGER_MODES, modeLabel, START_MODE } from '@/features/chat/chatMeta'
import { AgentPicker } from '@/features/chat/components/AgentPicker'
import { PermissionMenu } from '@/features/chat/components/PermissionMenu'
import { MAX_SHOWN, SlashPicker } from '@/features/chat/components/SlashPicker'
import { commandText, matchCommands, slashQuery, useSlashCommands, type SlashCommand } from '@/features/chat/slashCommands'
import { openAgentDocs } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { RadioGroup, RadioGroupItem, Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { chatAgentOf, DEFAULT_CHAT_VIEWS, type ChatAgent, type ChatViewDefaults, type PaneView } from '../model/chatView'
import { abilitiesOf } from '../model/agentAbilities'
import { ageOf, nowSeconds, useFolderBranches, useInstalledAgents } from '../model/newChatHost'
import type { BusyBranches, NewSessionProject } from '../model/newSession'
import { MAX_SESSION_NAME_LENGTH } from '../model/session'
import { suggestBranchName } from '../model/worktreeName'
import { AppIcon, Icon } from './glyphs'
import { ChipMenu, type ChipItem } from './NewChatMenus'
import { failedStartLabel, useBackgroundStarts } from '../useBackgroundStarts'
import { isMacPlatform } from '../model/shortcuts'

/** The branch a chat starts on when it is not the folder's current one: switch to it, or work in a new worktree of it. */
export type BranchChoice = { name: string; create: boolean; worktree: boolean }

/**
 * What the page asks the window to start: a chat with this agent, model and effort, in this folder, and its first message;
 * `resume` names a saved conversation to continue. `view` is how it opens (its chat or its terminal), and `name` the name
 * typed for it; without one the first message names it.
 */
export type NewChatRequest = { folder: string; agent: ChatAgent; model: string; reasoning: AgentChoice['reasoning']; mode: string; message: string; branch: BranchChoice | null; machine: number; machineName: string; resume: string | null; view?: PaneView; name?: string }

/** How a start is asked for: `background` starts the chat without opening it, and the page stays for the next; `onPlaced` hears its id. */
export type NewChatStartOptions = { background?: boolean; /** Told the new session's id once it is in the sidebar (this computer's chats only). */ onPlaced?: (id: string) => void }

/** The key the first message's files are kept under: no conversation exists yet, and a real one is never negative. */
const NEW_CHAT_DRAFT = -1

/** A computer a chat could start on. */
export type NewChatMachine = { machine: number; label: string; local: boolean }

type Props = {
  machines: readonly NewChatMachine[]
  /** The computer the chat starts on. */
  machine: number
  /** The projects that computer has sessions in, the focused one first. */
  projects: readonly NewSessionProject[]
  /** The branches other chats are working on, per folder: a chat started on one gets a worktree of its own. */
  busy?: BusyBranches
  defaultAgent: ChatAgent
  /** How each agent's chat opens unless this page picks the other view (Settings › Chat). */
  viewDefaults?: ChatViewDefaults
  /** Yolo mode is on for Claude, so a Claude chat may start in Bypass permissions. */
  bypassAllowed?: boolean
  /** Yolo mode is on for Codex, so every Codex chat starts with full access whatever is picked here. */
  codexYolo?: boolean
  /** Settings › Chat › Full access in new chats: the mode starts on the agent's full-access one, where it has one it may take. */
  fullAccess?: boolean
  /** A folder picker whose answer is null when it is cancelled: the system's for this computer, the window's own for another machine. Null when there is none. */
  browse: (() => Promise<string | null>) | null
  /** Clones a repository from GitHub onto that computer and answers with its new folder, or null when it is cancelled. Without it the page has no such button. */
  clone?: (() => Promise<string | null>) | null
  onStart: (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>
  /** Starts the chat's agent while the first message is written (`useWarmAgent`); without it the agent starts on send. */
  onWarm?: WarmAgent
  onOtherMachine: (machine: number) => void
  /** Opens the dialog that adds a machine; without it the machine list has no such row. */
  onAddMachine?: () => void
  /** Opens a plain shell on that computer, with no agent in it: the page's Terminal choice. Without it the page has no such choice. */
  onNewShell?: (machine: number) => void
  /** Leaves the page; absent when there is nothing to go back to (no chat is open yet). */
  onCancel?: (() => void) | undefined
  /** Told the agent the chat will start with, at first and on each change, so the sidebar's draft row shows it. */
  onAgentChange?: ((agent: ChatAgent) => void) | undefined
  /** A folder and first message to open with (a chat continued from a full one). */
  seed?: { folder: string; message: string } | null
  /** Before the agent's tile: a control the window puts there (Show sidebar, while the sidebar is hidden). */
  leading?: ReactNode
}

const lastPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const isPath = (text: string): boolean => /^(~|\/|[A-Za-z]:[\\/])/.test(text)
/** The key that starts a chat in the background, as this platform writes it. */
const BACKGROUND_KEY = isMacPlatform(navigator.userAgent) ? '⌘Enter' : 'Ctrl+Enter'
/** A name git takes for a new branch. */
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
/** The width of the header's menus. */
const MENU_WIDTH = 300
const NO_BUSY: BusyBranches = new Map()

/** Where the chat works: in the checkout, a worktree of its own, or `auto`: a worktree only when another chat is on that branch here. */
type WorkIn = 'auto' | 'folder' | 'tree'

/**
 * A new agent chat (layout 2h). The header says where it works, as the pane header of a running chat does: its name
 * (typed here, or the first message's words), then the project, the branch and whether it works in this folder or a
 * worktree of its own, each a menu; at its right, whether it opens as its chat or its terminal. Under it, the question
 * and the message box, or the terminal it will start in. The chat it starts is the agent in a terminal the daemon owns,
 * shown as its chat (ADR 0003). Enter sends, Ctrl+Enter (⌘Enter on macOS) starts it in the background and keeps the
 * page for the next one, Esc goes back.
 */
export function NewChatPage({ machines, machine, projects, busy: busyBranches = NO_BUSY, defaultAgent, viewDefaults = DEFAULT_CHAT_VIEWS, bypassAllowed = false, codexYolo = false, fullAccess = false, browse, clone = null, onStart, onWarm, onOtherMachine, onAddMachine, onNewShell, onCancel, onAgentChange, seed = null, leading }: Props) {
  // On another machine the chat is the agent started in a shell there: this computer's extra models, branches, files and installed agents say nothing of it.
  const remote = machine !== LOCAL_MACHINE
  const target = machines.find((candidate) => candidate.machine === machine)
  const targetLabel = target?.label ?? 'This computer'
  const [agent, setAgent] = useState<ChatAgent>(defaultAgent)
  useEffect(() => { onAgentChange?.(agent) }, [agent, onAgentChange])
  // Full access in new chats starts Claude in Bypass permissions (only where Yolo mode allows it) and Codex in Full access.
  const firstMode = (next: ChatAgent): string => (!fullAccess ? START_MODE[next] : next === 'codex' ? CODEX_FULL_MODE : next === 'claude' && bypassAllowed ? BYPASS_MODE : START_MODE[next])
  const [mode, setMode] = useState(() => firstMode(defaultAgent))
  const [choice, setChoice] = useState<AgentChoice>({ model: DEFAULT_PICK, reasoning: START_REASONING })
  const [picked, setFolder] = useState<string | null>(seed?.folder ?? null)
  const [extra, setExtra] = useState<NewSessionProject | null>(seed === null ? null : { folder: seed.folder, name: lastPart(seed.folder), color: 'var(--dim)' })
  const [message, setMessage] = useState(seed?.message ?? '')
  const [name, setName] = useState('')
  // Chat starts an agent; Terminal opens a plain shell with no agent in it.
  const [kind, setKind] = useState<'chat' | 'terminal'>('chat')
  const [branchPick, setBranchPick] = useState<{ folder: string; pick: BranchChoice } | null>(null)
  const [workIn, setWorkIn] = useState<WorkIn>('auto')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const background = useBackgroundStarts(onStart)
  // Branch names chats started from this page took, which the branch list may not show yet: the next suggestion avoids them.
  const [takenNames, setTakenNames] = useState<ReadonlySet<string>>(() => new Set())
  const text = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { attachments } = useComposerState(NEW_CHAT_DRAFT)
  useKeepTyping(text, attachments.length)
  // A new chat runs on this computer, so its files are copied here and named by path in the first message.
  const attach = useAttachmentIntake({ conversation: NEW_CHAT_DRAFT, blocked: remote ? `Files stay on this computer, not on ${targetLabel}` : starting ? 'The chat is starting' : null })
  const { addPaths } = attach
  useEffect(() => {
    const element = box.current
    return element === null || remote ? undefined : registerComposerDrop(element, addPaths)
  }, [addPaths, remote])
  // Files meant for a chat that was never started are not kept for the next one.
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
  const folder = picked ?? projects[0]?.folder ?? ''
  const shown = extra === null || projects.some((project) => project.folder === extra.folder) ? projects : [...projects, extra]
  const current = shown.find((project) => project.folder === folder)
  const folderName = current?.name ?? (folder === '' ? 'Choose a folder' : lastPart(folder))
  const installed = useInstalledAgents()
  const [branches, reloadBranches] = useFolderBranches(remote ? '' : folder)
  // A branch chosen for one folder means nothing in another.
  const explicit = branchPick?.folder === folder ? branchPick.pick : null
  const here = branches?.current ?? null
  // The branch the chat would be on, and the chat already working on it here, if one is.
  const onBranch = explicit !== null && !explicit.create ? explicit.name : here
  const busyHere = busyBranches.get(folder)
  const busyWith = onBranch === null ? undefined : busyHere?.get(onBranch)
  // Auto works in the folder unless another chat is on that branch, which would then be edited by two at once.
  const treeMode = workIn === 'tree' || (workIn === 'auto' && busyWith !== undefined)
  const takenBranches = useMemo(() => new Set([...(branches?.branches ?? []).map((entry) => entry.name), ...takenNames]), [branches, takenNames])
  // In a worktree of its own with no branch chosen, the chat gets a new branch with a two-word name. It is rolled once
  // per list of names in use and never copies the message, which is no name for a branch.
  const suggested = useMemo(() => (treeMode && branches !== null ? suggestBranchName(takenBranches) : null), [treeMode, branches, takenBranches])
  const branch = useMemo<BranchChoice | null>(() => {
    if (explicit !== null) return { ...explicit, worktree: treeMode }
    return treeMode && suggested !== null ? { name: suggested, create: true, worktree: true } : null
  }, [explicit, treeMode, suggested])
  const isInstalled = (id: string) => (installed === null ? chatAgentOf(id) !== null : installed.includes(id))
  const agentMissing = !remote && !isInstalled(agent)
  // The agent's chat opens as Settings › Chat says for it; it can be switched once it runs.
  const opensAs: PaneView = viewDefaults[agent]

  // The message box takes the keys once there is a folder.
  useEffect(() => { if (folder !== '') text.current?.focus() }, [folder])

  const pickAgent = (next: ChatAgent) => {
    setAgent(next)
    // A mode is the agent's own too.
    setMode(firstMode(next))
    // A model is the agent's own; the other agent's name means nothing to it.
    if (!modelsFor(next).some((option) => option.id === choice.model)) setChoice((now) => ({ ...now, model: DEFAULT_PICK }))
  }
  const modes = abilitiesOf(agent).permissionModes?.modes ?? []
  // The Yolo setting already starts Codex with full access, and its flag cannot be combined with a mode's.
  const forcedFull = abilitiesOf(agent).yoloExcludesMode && codexYolo
  const startMode = !forcedFull && modes.includes(mode) ? mode : 'default'
  // A branch or a worktree is made when the chat starts, so only a chat on the folder as it is can have its agent started ahead.
  const warmSpec = useMemo<WarmSpec | null>(
    () => (remote || folder === '' || agentMissing || branch !== null ? null : { folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode }),
    [remote, folder, agentMissing, branch, agent, choice.model, choice.reasoning, startMode],
  )
  // A start in the background takes the warm agent; asking again while it starts would make a second one.
  useWarmAgent(onWarm, warmSpec, starting || background.pending > 0)
  const typedName = name.trim()
  const requestFor = (task: string): NewChatRequest => ({
    folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, message: buildAttachmentMessage(task.trim(), attachments),
    branch: remote ? null : branch, machine, machineName: targetLabel, resume: null, view: opensAs, ...(typedName === '' ? {} : { name: typedName }),
  })
  const start = (task: string = message) => {
    if (starting || folder === '' || agentMissing) return
    setStarting(true)
    setError(null)
    onStart(requestFor(task))
      .catch((failure: unknown) => { setError(errorMessage(failure, 'Could not start the chat')) })
      .finally(() => { setStarting(false); reloadBranches() })
  }
  // The box is emptied for the next chat and every other choice stays. A new branch's name is taken, so the next start
  // gets another. Another machine's chat is typed into a shell there and opened to do it, so there it is a plain start.
  const startInBackground = () => {
    if (remote) {
      start()
      return
    }
    if (starting || folder === '' || agentMissing) return
    const request = requestFor(message)
    if (request.branch?.create === true) setTakenNames((now) => new Set([...now, request.branch?.name ?? '']))
    if (request.branch?.create === true && explicit?.create === true) setBranchPick(null)
    background.launch([request], { text: message, attachments })
    setMessage('')
    setName('')
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
    setExtra({ folder: path, name: lastPart(path), color: 'var(--dim)' })
    setFolder(path)
  }
  const pickOther = () => {
    if (browse === null) return
    void browse().then((chosen) => { if (chosen !== null) openFolder(chosen) })
  }
  const cloneOne = () => {
    if (clone === null) return
    void clone().then((cloned) => { if (cloned !== null) openFolder(cloned) })
  }

  // The agent's commands, offered while a slash and a name are typed: picking one writes it into the first message.
  const query = slashQuery(message)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const commandsFrom = abilitiesOf(agent).slashCommands === null || remote || folder === '' ? null : { agent, folder }
  const picking = query !== null && closedFor !== message && commandsFrom !== null
  const slash = useSlashCommands(commandsFrom, picking)
  const matches = useMemo(() => (query === null ? [] : matchCommands(slash.commands, query)), [slash.commands, query])
  const [cursor, setCursor] = useState({ query: '', index: 0 })
  const active = cursor.query === query ? Math.min(cursor.index, Math.max(0, Math.min(matches.length, MAX_SHOWN) - 1)) : 0
  const complete = (command: SlashCommand) => {
    setMessage(commandText(command))
    text.current?.focus()
  }
  const pickerKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!picking) return false
    if (event.key === 'Escape') {
      setClosedFor(message)
      return true
    }
    const chosen = matches[active]
    if (chosen === undefined) return false
    const count = Math.min(matches.length, MAX_SHOWN)
    if (event.key === 'ArrowDown') setCursor({ query, index: (active + 1) % count })
    else if (event.key === 'ArrowUp') setCursor({ query, index: (active + count - 1) % count })
    else if ((event.key === 'Tab' && !event.shiftKey) || (event.key === 'Enter' && !event.shiftKey)) complete(chosen)
    else return false
    return true
  }
  const onTextKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (pickerKey(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    const typing = event.target === text.current || (event.target instanceof HTMLElement && event.target.dataset.prompt === 'true')
    if (event.key === 'Enter' && !event.shiftKey && typing) {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) startInBackground()
      else start()
    } else if (event.key === 'Escape' && onCancel !== undefined && event.target instanceof Node && event.currentTarget.contains(event.target)) {
      // An Escape from a menu (portalled, so outside this element) closes only that.
      event.preventDefault()
      onCancel()
    }
  }

  const empty = message.trim() === '' && attachments.length === 0
  const off = starting || folder === '' || agentMissing
  const [now] = useState(nowSeconds)

  const folderItem = (project: NewSessionProject): ChipItem => ({
    key: project.folder,
    label: project.name,
    sub: project.folder,
    icon: <span className="mx-ns-square" style={{ background: project.color }} aria-hidden="true" />,
    checked: project.folder === folder,
    onPick: () => { setFolder(project.folder) },
  })
  const fromPath = (typed: string): ChipItem | null => {
    if (!isPath(typed)) return null
    return { key: 'path', label: `Use ${typed}`, icon: <Icon name="folder" size={12} />, checked: false, onPick: () => { openFolder(typed) } }
  }
  const elsewhere = machines.filter((candidate) => !candidate.local)
  const machineChoice = (
    <>
      <Segmented aria-label="Machine" value={remote ? 'remote' : 'local'} className="mx-where-work"
        onValueChange={(next) => {
          if (next === 'local') onOtherMachine(LOCAL_MACHINE)
          else if (next === 'remote' && elsewhere[0] !== undefined) onOtherMachine(elsewhere[0].machine)
          else if (next === 'remote') onAddMachine?.()
        }}>
        <SegmentedItem value="local" className="mx-where-work-option">This computer</SegmentedItem>
        <SegmentedItem value="remote" className="mx-where-work-option">Remote machine</SegmentedItem>
      </Segmented>
      {remote && (
        <div className="mx-nc-machines">
          {elsewhere.map((candidate) => (
            <button key={candidate.machine} type="button" className={`mx-nc-machine-chip${candidate.machine === machine ? ' is-on' : ''}`} onClick={() => { onOtherMachine(candidate.machine) }}>
              <span aria-hidden="true">■</span>{candidate.label}
            </button>
          ))}
          {onAddMachine !== undefined && <button type="button" className="mx-nc-machine-chip" onClick={onAddMachine}>+ Add a machine…</button>}
        </div>
      )}
    </>
  )
  const machinePick = (
    <div className="mx-nc-machine">
      <h3 className="mx-chip-title">Machine</h3>
      {machineChoice}
      <h3 className="mx-chip-title">Folder</h3>
    </div>
  )
  const branchRows: ChipItem[] = (branches?.branches ?? []).map((entry) => {
    const who = busyHere?.get(entry.name) ?? null
    return {
      key: `branch:${entry.name}`,
      label: entry.name,
      right: who === null ? <span className="mx-chip-count">{ageOf(entry.when, now)}</span> : <span className="mx-nc-in-use" title={`${who} is working on it`}>in use</span>,
      checked: (explicit?.name ?? here) === entry.name && explicit?.create !== true,
      onPick: () => { setBranchPick({ folder, pick: { name: entry.name, create: false, worktree: treeMode } }) },
    }
  })
  const fromBranchName = (typed: string): ChipItem | null => {
    if (!BRANCH_NAME.test(typed) || (branches?.branches ?? []).some((entry) => entry.name === typed)) return null
    return { key: 'new-branch', label: `+ Create ${typed} from ${here ?? 'here'}`, checked: false, onPick: () => { setBranchPick({ folder, pick: { name: typed, create: true, worktree: treeMode } }) } }
  }
  const branchLabel = branch?.create === true ? branch.name : onBranch ?? 'detached'
  const workRows: ChipItem[] = [
    { key: 'folder', label: 'This folder', sub: `Edits your checkout of ${onBranch ?? 'its branch'} directly.`, checked: !treeMode, onPick: () => { setWorkIn('folder') } },
    { key: 'tree', label: 'New worktree', sub: 'Its own copy on a new branch. Your checkout stays untouched.', checked: treeMode, onPick: () => { setWorkIn('tree') } },
  ]
  const notes = <StartNotes error={error} background={background} onPutBack={putBack} agentMissing={agentMissing ? agent : null} onSetUp={() => { void openAgentDocs(agent).catch((failure: unknown) => { setError(errorMessage(failure, 'Could not open the setup page')) }) }} />
  const busyLine = busyWith !== undefined && workIn !== 'folder' && onBranch !== null
    ? `${busyWith} is already working on ${onBranch} here, so this chat gets its own worktree. Your checkout stays untouched.`
    : null

  return (
    <section className="mx-newchat" aria-label="New agent chat" onKeyDown={onKeyDown}>
      <header className="mx-nc-head">
        {leading}
        {kind === 'terminal' ? (
          <span className="mx-nc-where"><span className="mx-nc-shell-title">New terminal</span></span>
        ) : (<>
        <span className="mx-nc-agent" title={AGENT_LABEL[agent]}><AppIcon process={agent} size={26} /></span>
        <span className="mx-nc-where">
          <input className="mx-nc-name" value={name} placeholder="Name this chat" aria-label="Chat name" maxLength={MAX_SESSION_NAME_LENGTH}
            title="Type a name, or leave it empty and your first message names the chat" onChange={(event) => { setName(event.target.value) }} />
          <span className="mx-crumb-sep" aria-hidden="true">/</span>
          <ChipMenu variant="crumb" side="bottom" width={MENU_WIDTH} title="Project folder and machine" summary={remote ? `${folderName} on ${targetLabel}` : folderName}
            label={<span className="mx-nc-crumb-name">{folderName}{remote && <span className="mx-nc-crumb-machine">@{targetLabel}</span>}</span>}
            icon={<span className="mx-crumb-square is-project" style={{ background: current?.color ?? 'var(--dim)' }} aria-hidden="true" />}
            search="Search folders or paste a path" extra={machinePick} sections={[{ heading: 'Folder', items: shown.map(folderItem) }]} fromQuery={fromPath}
            footer={(
              <div className="mx-nc-menu-foot">
                {browse !== null && <button type="button" className="mx-chip-action" onClick={pickOther}>Browse…</button>}
                {clone !== null && <button type="button" className="mx-chip-action" onClick={cloneOne}>Clone from GitHub…</button>}
              </div>
            )} />
          {branches !== null && (
            <>
              <span className="mx-crumb-sep" aria-hidden="true">/</span>
              <ChipMenu variant="crumb" side="bottom" width={MENU_WIDTH} title="Branch" summary={branchLabel} heading={`Branch in ${folderName}`}
                label={<span className="mx-crumb-branch">{branchLabel}</span>} icon={<span className="mx-crumb-branch-icon"><Icon name="branch" size={12} /></span>}
                search="Find or create a branch" sections={[{ heading: 'Branches', items: branchRows }]} fromQuery={fromBranchName} />
              <span className="mx-crumb-sep" aria-hidden="true">·</span>
              <ChipMenu variant="crumb" side="bottom" width={MENU_WIDTH} title="Work in" summary={treeMode ? 'New worktree' : 'This folder'} heading="Work in"
                label={<span className={treeMode ? 'mx-nc-worktree' : 'mx-nc-here'}>{treeMode ? 'new worktree' : 'this folder'}</span>}
                sections={[{ heading: 'Work in', items: workRows }]} below={busyLine === null ? undefined : <p className="mx-chip-note">{busyLine}</p>} />
            </>
          )}
        </span>
        </>)}
        <span className="mx-nc-head-end">
          {onNewShell !== undefined && (
            <RadioGroup aria-label="Start" title="Chat starts an agent. Terminal opens a plain shell: cd anywhere and run what you like." orientation="horizontal" value={kind}
              onValueChange={(next) => { if (next === 'chat' || next === 'terminal') setKind(next) }} className="mx-view-switch">
              <RadioGroupItem value="chat" className="mx-view-option">Chat</RadioGroupItem>
              <RadioGroupItem value="terminal" className="mx-view-option">Terminal</RadioGroupItem>
            </RadioGroup>
          )}
          {onCancel !== undefined && <button type="button" className="mx-pane-control" aria-label="Close" title="Close (Esc)" onClick={onCancel}><Icon name="close" size={13} /></button>}
        </span>
      </header>
      {kind === 'terminal' && onNewShell !== undefined ? (
        <ShellStart where={targetLabel} machineChoice={elsewhere.length > 0 || onAddMachine !== undefined ? machineChoice : null} onOpen={() => { onNewShell(machine) }} />
      ) : (
        <div className="mx-nc-start"><h1 className="mx-nc-title">What are we building today?</h1></div>
      )}
      {kind === 'chat' && (
      <div ref={box} className="mx-composer">
        <div className="mx-composer-column">
          <div className="mx-box">
            {picking && <SlashPicker agent={AGENT_LABEL[agent]} typed={message.trim()} matches={matches} active={active} loading={slash.loading} error={slash.error} onPick={complete} onHover={(index) => { setCursor({ query, index }) }} />}
            <DraftAttachments attachments={attachments} onRemove={attach.remove} />
            <textarea ref={text} onPaste={onPaste} onKeyDown={onTextKey} aria-label="First message" rows={2} value={message} placeholder="Describe a task, or type / for commands" className="mx-box-text" onChange={(event) => { setMessage(event.target.value) }}
              {...(picking && matches.length > 0 ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-slash-list', 'aria-activedescendant': `mx-slash-${String(active)}` } : {})} />
            {!remote && <button type="button" className="mx-box-attach" aria-label="Attach files" title="Attach files" onClick={attach.pick}><Icon name="plus" size={16} /></button>}
            <div className="mx-box-row">
              <AgentPicker fixedModels={remote} agent={agent} choice={choice} onChange={(change) => { setChoice((was) => ({ ...was, ...change })) }} onAgent={pickAgent} />
              {forcedFull ? (
                <span className="mx-mode-button is-static is-danger" role="img" aria-label={`Permission mode: ${modeLabel(CODEX_FULL_MODE) ?? ''}`} title="Yolo mode is on for Codex (Settings, General), so it starts with full access. Turn the setting off to pick another mode."><Icon name="shield" size={13} /></span>
              ) : modes.length > 0 ? (
                <PermissionMenu agent={AGENT_LABEL[agent]} label="Starting permission mode" mode={mode} modes={modes} onPick={setMode}
                  bypassOff={bypassAllowed ? undefined : { note: 'needs Yolo mode', why: 'Turn on Yolo mode for Claude in Settings, General, to start a chat in this mode.' }}>
                  <button type="button" className={`mx-mode-button${DANGER_MODES.includes(mode) ? ' is-danger' : ''}`} title={`Permissions: ${modeLabel(mode) ?? mode}`} aria-label={`Starting permission mode: ${modeLabel(mode) ?? mode}. Pick another.`}>
                    <Icon name="shield" size={13} /><Icon name="chevronDown" size={10} />
                  </button>
                </PermissionMenu>
              ) : (
                <span className="mx-mode-button is-static" role="img" aria-label="Asks before running" title="This chat asks before it runs a tool"><Icon name="shield" size={13} /></span>
              )}
              <span className="mx-spacer" />
              {remote && <span className="mx-nc-on" title={`The agent starts on ${targetLabel}`}>On {targetLabel}</span>}
              <button type="button" className={`mx-send${off || empty ? ' is-off' : ''}`} aria-label={empty ? 'Start chat' : 'Send message'} title={folder === '' ? 'Pick a folder first' : `${empty ? 'Start an empty chat' : 'Send (Enter)'}${remote ? '' : ` · ${BACKGROUND_KEY} starts it and keeps this page open`}`} disabled={off} onClick={() => { start() }}>
                <Icon name="arrowUp" size={15} strokeWidth={2.2} />
              </button>
            </div>
          </div>
          {notes}
        </div>
      </div>
      )}
    </section>
  )
}

/**
 * The page's Terminal choice: a plain shell on the picked computer, with no agent in it. It opens in that computer's start
 * folder; from there the person goes where they like and runs claude, codex or anything else.
 */
function ShellStart({ where, machineChoice, onOpen }: { where: string; machineChoice: ReactNode; onOpen: () => void }) {
  return (
    <div className="mx-nc-shell" aria-label="New terminal">
      {machineChoice !== null && <div className="mx-nc-machine">{machineChoice}</div>}
      <p className="mx-nc-shell-text">A plain terminal on {where}. Go to any folder and run claude, codex or any command.</p>
      <Button autoFocus className="self-start" onClick={onOpen}>Open terminal</Button>
    </div>
  )
}

/** What went wrong with a start, under the box: the start's own failure, the background starts that failed, a missing agent. */
function StartNotes({ error, background, onPutBack, agentMissing, onSetUp }: { error: string | null; background: ReturnType<typeof useBackgroundStarts>; onPutBack: (key: number) => void; agentMissing: ChatAgent | null; onSetUp: () => void }) {
  return (
    <>
      {error !== null && <p role="alert" className="mx-composer-error">{error}</p>}
      {background.failed.map((failed) => (
        <p key={failed.key} role="alert" className="mx-composer-error">
          {`Could not start ${failedStartLabel(failed)}: ${failed.reason} `}
          {failed.draft !== null && (
            <>
              <button type="button" className="mx-text-button" aria-label={`Put back ${failedStartLabel(failed)}`} onClick={() => { onPutBack(failed.key) }}>Put back</button>
              {' · '}
            </>
          )}
          <button type="button" className="mx-text-button" aria-label={`Dismiss ${failedStartLabel(failed)}`} onClick={() => { background.dismiss(failed.key) }}>Dismiss</button>
        </p>
      ))}
      {agentMissing !== null && (
        <p role="alert" className="mx-composer-error">
          {`${AGENT_LABEL[agentMissing]} is not installed on this computer. Pick another agent from the model button, or `}
          <button type="button" className="mx-text-button" onClick={onSetUp}>set it up</button>.
        </p>
      )}
    </>
  )
}
