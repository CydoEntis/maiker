import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useWarmAgent, type WarmAgent, type WarmSpec } from '../useWarmAgent'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Segmented, SegmentedItem } from '@/components/ui/radio-group'
import { errorMessage } from '@/lib/error-message'
import { DEFAULT_PICK, START_REASONING, type AgentChoice } from '@/features/chat/agentChoice'
import { AGENT_LABEL } from '@/features/chat/modelName'
import { BYPASS_MODE, CODEX_FULL_MODE, START_MODE } from '@/features/chat/chatMeta'
import { AgentPicker } from '@/features/chat/components/AgentPicker'
import { MAX_SHOWN, SlashPicker } from '@/features/chat/components/SlashPicker'
import { commandText, matchCommands, slashQuery, useSlashCommands, type SlashCommand } from '@/features/chat/slashCommands'
import { openAgentDocs } from '@/api/daemon'
import { LOCAL_MACHINE } from '@/api/machines'
import { chatAgentOf, DEFAULT_CHAT_VIEWS, type ChatAgent, type ChatViewDefaults, type PaneView } from '../model/chatView'
import { abilitiesOf } from '../model/agentAbilities'
import { useFolderBranches, useInstalledAgents } from '../model/newChatHost'
import type { BusyBranches, NewSessionProject } from '../model/newSession'
import { suggestBranchName } from '../model/worktreeName'
import { Icon } from './glyphs'
import { ChipMenu, type ChipItem } from './NewChatMenus'
import { failedStartLabel, useBackgroundStarts } from '../useBackgroundStarts'
import { isMacPlatform } from '../model/shortcuts'
import type { PickedFolder } from '../model/folderPick'

/** The branch a chat starts on when it is not the folder's current one: switch to it, or work in a new worktree of it. */
export type BranchChoice = { name: string; create: boolean; worktree: boolean }

/**
 * What the dialog asks the window to start: a chat with this agent, model and effort, in this folder, and its first message;
 * `resume` names a saved conversation to continue. `view` is how it opens (its chat or its terminal), and `name` a name
 * for it; without one the first message names the chat.
 */
export type NewChatRequest = { folder: string; agent: ChatAgent; model: string; reasoning: AgentChoice['reasoning']; mode: string; message: string; branch: BranchChoice | null; machine: number; machineName: string; resume: string | null; view?: PaneView; name?: string }

/** How a start is asked for: `background` starts the chat without opening it, and the dialog stays for the next; `onPlaced` hears its id. */
export type NewChatStartOptions = { background?: boolean; /** Told the new session's id once it is in the sidebar (this computer's chats only). */ onPlaced?: (id: string) => void }

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
  /** How each agent's chat opens unless the dialog picks the other view (Settings › Chat). */
  viewDefaults?: ChatViewDefaults
  /** Yolo mode is on for Claude, so a Claude chat may start in Bypass permissions. */
  bypassAllowed?: boolean
  /** Yolo mode is on for Codex, so every Codex chat starts with full access whatever is picked here. */
  codexYolo?: boolean
  /** Settings › Chat › Full access in new chats: the mode starts on the agent's full-access one, where it has one it may take. */
  fullAccess?: boolean
  /** Opens the folder picker on that machine and answers with the folder chosen (and the machine it is on), or null when it is cancelled. Null when there is none. */
  pickFolder: ((machine: number) => Promise<PickedFolder | null>) | null
  /** Clones a repository from GitHub onto that computer and answers with its new folder, or null when it is cancelled. Without it the dialog has no such button. */
  clone?: (() => Promise<string | null>) | null
  onStart: (request: NewChatRequest, options?: NewChatStartOptions) => Promise<void>
  /** Starts the chat's agent while the first message is written (`useWarmAgent`); without it the agent starts on send. */
  onWarm?: WarmAgent
  onOtherMachine: (machine: number) => void
  /** Opens the dialog that adds a machine; without it the machine list has no such row. */
  onAddMachine?: () => void
  /** Opens a plain shell on that computer, with no agent in it: the dialog's Terminal choice. Without it the dialog has no such choice. */
  onNewShell?: (machine: number) => void
  /** Closes the dialog. */
  onCancel: () => void
  /** Told the agent the chat will start with, at first and on each change, so the sidebar's draft row shows it. */
  onAgentChange?: ((agent: ChatAgent) => void) | undefined
  /** A folder and first message to open with (a chat continued from a full one). */
  seed?: { folder: string; message: string } | null
}

const lastPart = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const isPath = (text: string): boolean => /^(~|\/|[A-Za-z]:[\\/])/.test(text)
/** The key that starts a chat, as this platform writes it in the Start button. */
const START_KEY = isMacPlatform(navigator.userAgent) ? '⌘ ↵' : 'Ctrl ↵'
/** A name git takes for a new branch. */
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
/** The width of a token's list, as the design draws it. */
const TOKEN_LIST_WIDTH = 320
const NO_BUSY: BusyBranches = new Map()
const FIRST_CHOICE: AgentChoice = { model: DEFAULT_PICK, reasoning: START_REASONING }

/** Where the chat works: in the checkout, a worktree of its own, or `auto`: a worktree only when another chat is on that branch here. */
type WorkIn = 'auto' | 'folder' | 'tree'

/** A folder the person picked, with the machine it is on: a folder means nothing on another machine. */
type Picked = { machine: number; folder: string }

/**
 * The New session dialog: centred and compact. Its header band says where the chat works as three tokens, machine, project
 * and branch, each opening a searchable list, then the Own worktree switch and close. Under it the first message, and a
 * row for the agent, its model and effort, how the session opens (Chat or Terminal) and Start. Ctrl+Enter (⌘Enter on
 * macOS) starts, Ctrl+Shift+Enter starts it in the background and keeps the dialog for the next one, Esc closes. The chat
 * it starts is the agent in a terminal the daemon owns, shown as its chat (ADR 0003).
 */
export function NewSessionDialog({ machines, machine, projects, busy: busyBranches = NO_BUSY, defaultAgent, viewDefaults = DEFAULT_CHAT_VIEWS, bypassAllowed = false, codexYolo = false, fullAccess = false, pickFolder, clone = null, onStart, onWarm, onOtherMachine, onAddMachine, onNewShell, onCancel, onAgentChange, seed = null }: Props) {
  // On another machine the chat is the agent started in a shell there: this computer's extra models, branches and installed agents say nothing of it.
  const remote = machine !== LOCAL_MACHINE
  // The window's root, where the theme's variables live; read once, so the dialog's portal never moves.
  const [root] = useState(() => window.document.querySelector<HTMLElement>('.mx-app'))
  const target =machines.find((candidate) => candidate.machine === machine)
  const targetLabel = target?.label ?? 'This computer'
  const [agent, setAgent] = useState<ChatAgent>(defaultAgent)
  useEffect(() => { onAgentChange?.(agent) }, [agent, onAgentChange])
  // Full access in new chats starts Claude in Bypass permissions (only where Yolo mode allows it) and Codex in Full access.
  const firstMode = (next: ChatAgent): string => (!fullAccess ? START_MODE[next] : next === 'codex' ? CODEX_FULL_MODE : next === 'claude' && bypassAllowed ? BYPASS_MODE : START_MODE[next])
  const [mode, setMode] = useState(() => firstMode(defaultAgent))
  // Each agent keeps its own model and effort while the dialog is open, so going back to one finds what it was left at.
  const [choices, setChoices] = useState<Partial<Record<ChatAgent, AgentChoice>>>({})
  const choice = choices[agent] ?? FIRST_CHOICE
  const changeChoice = (change: Partial<AgentChoice>) => { setChoices((was) => ({ ...was, [agent]: { ...(was[agent] ?? FIRST_CHOICE), ...change } })) }
  const [picked, setPicked] = useState<Picked | null>(seed === null ? null : { machine, folder: seed.folder })
  const [extra, setExtra] = useState<(NewSessionProject & { machine: number }) | null>(seed === null ? null : { machine, folder: seed.folder, name: lastPart(seed.folder), color: 'var(--dim)' })
  const [message, setMessage] = useState(seed?.message ?? '')
  // Chat starts an agent; Terminal opens a plain shell with no agent in it.
  const [kind, setKind] = useState<'chat' | 'terminal'>('chat')
  const [branchPick, setBranchPick] = useState<{ folder: string; pick: BranchChoice } | null>(null)
  const [workIn, setWorkIn] = useState<WorkIn>('auto')
  const [starting, setStarting] = useState(false)
  // The folder picker is over the dialog: the dialog is out of sight meanwhile and comes back with its folder.
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const background = useBackgroundStarts(onStart)
  // Branch names chats started from this dialog took, which the branch list may not show yet: the next suggestion avoids them.
  const [takenNames, setTakenNames] = useState<ReadonlySet<string>>(() => new Set())
  const text = useRef<HTMLTextAreaElement>(null)
  // It opens ready to type, on the most recent project.
  const folder = picked?.machine === machine ? picked.folder : projects[0]?.folder ?? ''
  const added = extra?.machine === machine ? extra : null
  const shown = added === null || projects.some((project) => project.folder === added.folder) ? projects : [...projects, added]
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
  // On another machine its branches are not read from here, so only an asked-for worktree is made there.
  const treeMode = workIn === 'tree' || (!remote && workIn === 'auto' && busyWith !== undefined)
  const takenBranches = useMemo(() => new Set([...(branches?.branches ?? []).map((entry) => entry.name), ...takenNames]), [branches, takenNames])
  // In a worktree of its own with no branch chosen, the chat gets a new branch with a two-word name. It is rolled once
  // per list of names in use and never copies the message, which is no name for a branch.
  const suggested = useMemo(() => (treeMode && (remote || branches !== null) ? suggestBranchName(takenBranches) : null), [treeMode, remote, branches, takenBranches])
  const branch = useMemo<BranchChoice | null>(() => {
    if (explicit !== null) return { ...explicit, worktree: treeMode }
    return treeMode && suggested !== null ? { name: suggested, create: true, worktree: true } : null
  }, [explicit, treeMode, suggested])
  const isInstalled = (id: string) => (installed === null ? chatAgentOf(id) !== null : installed.includes(id))
  const agentMissing = !remote && !isInstalled(agent)
  // The agent's chat opens as Settings › Chat says for it; it can be switched once it runs.
  const opensAs: PaneView = viewDefaults[agent]

  // The message box takes the keys once there is a folder, and again when the picker hands the dialog back.
  useEffect(() => { if (folder !== '' && !picking) text.current?.focus() }, [folder, picking])

  const pickAgent = (next: ChatAgent) => {
    setAgent(next)
    // A mode is the agent's own too.
    setMode(firstMode(next))
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
  const requestFor = (task: string): NewChatRequest => ({
    folder, agent, model: choice.model, reasoning: choice.reasoning, mode: startMode, message: task.trim(),
    branch: remote && branch?.worktree !== true ? null : branch, machine, machineName: targetLabel, resume: null, view: opensAs,
  })
  const terminal = kind === 'terminal' && onNewShell !== undefined
  const empty = message.trim() === ''
  const off = starting || (terminal ? false : folder === '' || agentMissing || empty)
  const start = (task: string = message) => {
    if (off) return
    if (terminal) {
      onNewShell(machine)
      return
    }
    setStarting(true)
    setError(null)
    const request = requestFor(task)
    onStart(request)
      // Another machine's branches are not read again, so the name it took is kept here and the next start gets another.
      .then(() => { const made = request.branch; if (remote && made !== null) setTakenNames((now) => new Set([...now, made.name])) })
      .catch((failure: unknown) => { setError(errorMessage(failure, 'Could not start the chat')) })
      .finally(() => { setStarting(false); reloadBranches() })
  }
  // The box is emptied for the next chat and every other choice stays. A new branch's name is taken, so the next start
  // gets another. Another machine's chat is typed into a shell there and opened to do it, so there it is a plain start.
  const startInBackground = () => {
    if (terminal || remote) {
      start()
      return
    }
    if (off) return
    const request = requestFor(message)
    if (request.branch?.create === true) setTakenNames((now) => new Set([...now, request.branch?.name ?? '']))
    if (request.branch?.create === true && explicit?.create === true) setBranchPick(null)
    background.launch([request], { text: message, attachments: [] })
    setMessage('')
  }
  // A failed start's message comes back after whatever has been typed since, never over it.
  const putBack = (key: number) => {
    const draft = background.takeBack(key)
    if (draft === null) return
    setMessage((now) => (now.trim() === '' ? draft.text : draft.text.trim() === '' ? now : `${now}\n\n${draft.text}`))
    text.current?.focus()
  }
  const openFolder = (path: string) => {
    setExtra({ machine, folder: path, name: lastPart(path), color: 'var(--dim)' })
    setPicked({ machine, folder: path })
  }
  const openPicker = () => {
    if (pickFolder === null) return
    setPicking(true)
    void pickFolder(machine).then((chosen) => {
      if (chosen === null) return
      // A folder on another machine takes the dialog to that machine with the folder filled in.
      setExtra({ machine: chosen.machine, folder: chosen.folder, name: lastPart(chosen.folder), color: 'var(--dim)' })
      setPicked({ machine: chosen.machine, folder: chosen.folder })
      if (chosen.machine !== machine) onOtherMachine(chosen.machine)
    }).finally(() => { setPicking(false) })
  }
  const cloneOne = () => {
    if (clone === null) return
    setPicking(true)
    void clone().then((cloned) => { if (cloned !== null) openFolder(cloned) }).finally(() => { setPicking(false) })
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
  const onTextKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (pickerKey(event)) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  // Ctrl+Enter starts from anywhere in the dialog; Ctrl+Shift+Enter starts it in the background. Plain Enter is a new line.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.defaultPrevented) return
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      if (event.shiftKey) startInBackground()
      else start()
    }
  }

  const dot = (colour: string): ReactNode => <span className="mx-nsd-dot" style={{ background: colour }} aria-hidden="true" />
  const machineRows: ChipItem[] = machines.map((candidate) => ({ key: `machine:${String(candidate.machine)}`, label: candidate.label, icon: dot('var(--ok)'), checked: candidate.machine === machine, onPick: () => { if (candidate.machine !== machine) onOtherMachine(candidate.machine) } }))
  const folderItem = (project: NewSessionProject): ChipItem => ({
    key: project.folder,
    label: project.name,
    sub: project.folder,
    icon: dot(project.color),
    checked: project.folder === folder,
    onPick: () => { setPicked({ machine, folder: project.folder }) },
  })
  const fromPath = (typed: string): ChipItem | null => {
    if (!isPath(typed)) return null
    return { key: 'path', label: `Use ${typed}`, icon: <Icon name="folder" size={12} />, checked: false, onPick: () => { openFolder(typed) } }
  }
  const branchRows: ChipItem[] = (branches?.branches ?? []).map((entry) => {
    const who = busyHere?.get(entry.name) ?? null
    return {
      key: `branch:${entry.name}`,
      label: entry.name,
      mono: true,
      right: who === null ? undefined : <span className="mx-nc-in-use" title={`${who} is working on it`}>in use</span>,
      checked: (explicit?.name ?? here) === entry.name && explicit?.create !== true,
      onPick: () => { setBranchPick({ folder, pick: { name: entry.name, create: false, worktree: treeMode } }) },
    }
  })
  const fromBranchName = (typed: string): ChipItem | null => {
    if (!BRANCH_NAME.test(typed) || (branches?.branches ?? []).some((entry) => entry.name === typed)) return null
    return { key: 'new-branch', label: `+ Create ${typed} from ${here ?? 'here'}`, checked: false, onPick: () => { setBranchPick({ folder, pick: { name: typed, create: true, worktree: treeMode } }) } }
  }
  const branchLabel = branch?.create === true ? branch.name : onBranch ?? 'detached'
  const busyLine = busyWith !== undefined && workIn !== 'folder' && onBranch !== null
    ? `${busyWith} is already working on ${onBranch} here, so this chat gets its own worktree. Your checkout stays untouched.`
    : null
  const treeLine = busyLine ?? (treeMode && branch !== null ? `A copy of the repository on its own branch, ${branch.name}. Your checkout stays untouched.` : null)
  const worktreeTip = busyLine !== null ? 'This branch is in use by another chat, so a separate worktree is safer' : 'Work in a separate copy of the repo'
  const showWorktree = folder !== '' && (remote || branches !== null)

  if (picking) return null
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent unstyled container={root} overlayClassName="mx-nsd-scrim" aria-label="New session" aria-describedby={undefined} className="mx-ns-dialog" onKeyDown={onKeyDown}
        onEscapeKeyDown={(event) => { if (slashing) event.preventDefault() }} onOpenAutoFocus={(event) => { event.preventDefault(); text.current?.focus() }}>
        <DialogTitle className="sr-only">New session</DialogTitle>
        <div className="mx-nsd-head">
          <ChipMenu variant="token" triggerClass="mx-nsd-token is-machine" side="bottom" width={TOKEN_LIST_WIDTH} title="Machine" hint="Where it runs" summary={targetLabel}
            icon={<Icon name={remote ? 'server' : 'laptop'} size={13} />} label={<span className="mx-nsd-token-text">{targetLabel}</span>}
            search="Find a machine" sections={[{ heading: 'Machine', items: machineRows }]}
            footer={onAddMachine === undefined ? undefined : <button type="button" className="mx-chip-action" onClick={onAddMachine}><span className="mx-nsd-foot-mark" aria-hidden="true">+</span>Add a machine…</button>} />
          <span className="mx-nsd-sep" aria-hidden="true">/</span>
          <ChipMenu variant="token" triggerClass="mx-nsd-token" side="bottom" width={TOKEN_LIST_WIDTH} title="Project" hint={`on ${targetLabel}`} summary={folderName}
            icon={dot(current?.color ?? 'var(--dim)')} label={<span className="mx-nsd-token-text">{folderName}</span>}
            search="Find a project or folder" sections={[{ heading: 'Project', items: shown.map(folderItem) }]} fromQuery={fromPath}
            footer={(
              <div className="mx-nc-menu-foot">
                {pickFolder !== null && <button type="button" className="mx-chip-action" onClick={openPicker}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="folder" size={12} /></span>Open a folder…</button>}
                {clone !== null && <button type="button" className="mx-chip-action" onClick={cloneOne}><span className="mx-nsd-foot-mark" aria-hidden="true"><Icon name="repo" size={12} /></span>Clone from GitHub…</button>}
              </div>
            )} />
          {branches !== null && (
            <>
              <span className="mx-nsd-sep" aria-hidden="true">/</span>
              <ChipMenu variant="token" triggerClass="mx-nsd-token is-branch" side="bottom" width={TOKEN_LIST_WIDTH} title="Branch" hint={`in ${folderName}`} summary={branchLabel}
                icon={<Icon name="branch" size={12} />} label={<span className="mx-nsd-token-text is-mono">{branchLabel}</span>}
                search="Find or name a new branch" sections={[{ heading: 'Branches', items: branchRows }]} fromQuery={fromBranchName} />
            </>
          )}
          <span className="mx-nsd-grow" />
          {/* Hidden, not removed, where it does not apply (a terminal, a folder not read yet): the header keeps its shape. */}
          <label className={`mx-nsd-worktree${showWorktree && !terminal ? '' : ' is-away'}`} title={worktreeTip} aria-hidden={showWorktree && !terminal ? undefined : true}>
            <Switch aria-label="Own worktree" checked={treeMode} disabled={!showWorktree || terminal} onCheckedChange={(on) => { setWorkIn(on ? 'tree' : 'folder') }} />
            <span className="mx-nsd-worktree-word">Own worktree</span>
          </label>
          <button type="button" className="mx-nsd-close" aria-label="Close" title="Close (Esc)" onClick={onCancel}><Icon name="close" size={13} /></button>
        </div>
        <div className="mx-nsd-text">
          {terminal ? (
            <p className="mx-nsd-terminal">A plain terminal on {targetLabel}. Go to any folder and run claude, codex or any command.</p>
          ) : (
            <>
              {slashing && <SlashPicker agent={AGENT_LABEL[agent]} typed={message.trim()} matches={matches} active={active} loading={slash.loading} error={slash.error} onPick={complete} onHover={(index) => { setCursor({ query, index }) }} />}
              <textarea ref={text} onKeyDown={onTextKey} aria-label="First message" rows={4} value={message} placeholder="What should it work on?" className="mx-nsd-input" onChange={(event) => { setMessage(event.target.value) }}
              {...(slashing && matches.length > 0 ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-slash-list', 'aria-activedescendant': `mx-slash-${String(active)}` } : {})} />
            </>
          )}
        </div>
        <div className="mx-nsd-notes">
          <StartNotes error={error} treeLine={terminal ? null : treeLine} background={background} onPutBack={putBack} agentMissing={agentMissing && !terminal ? agent : null} onSetUp={() => { void openAgentDocs(agent).catch((failure: unknown) => { setError(errorMessage(failure, 'Could not open the setup page')) }) }} />
        </div>
        <div className="mx-nsd-foot">
          {/* The agent means nothing to a plain shell, so in Terminal the dropdown keeps its place and goes unseen and out of reach. */}
          <div className={`mx-nsd-agent${terminal ? ' is-away' : ''}`} aria-hidden={terminal ? true : undefined}>
            <AgentPicker compact fixedModels={remote} agent={agent} choice={choice} onChange={changeChoice} onAgent={pickAgent} />
          </div>
          {onNewShell !== undefined && (
            <Segmented aria-label="Opens as" className="mx-nsd-view" value={kind} onValueChange={(next) => { if (next === 'chat' || next === 'terminal') setKind(next) }}>
              <SegmentedItem value="chat" icon={<Icon name="chat" size={13} />}>Chat</SegmentedItem>
              <SegmentedItem value="terminal" icon={<Icon name="terminal" size={13} />}>Terminal</SegmentedItem>
            </Segmented>
          )}
          <button type="button" className="mx-nsd-start" aria-label={terminal ? 'Open terminal' : 'Start'} aria-keyshortcuts="Control+Enter" disabled={off} title={folder === '' && !terminal ? 'Pick a folder first' : `Ctrl+Shift+Enter starts it in the background${remote ? ' (on another machine it starts and opens)' : ''}`} onClick={() => { start() }}>
            {terminal ? 'Open terminal' : 'Start'}<span className="mx-nsd-start-key">{START_KEY}</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** What went wrong with a start, under the message: the start's own failure, the background starts that failed, a missing agent; and the worktree line. */
function StartNotes({ error, treeLine, background, onPutBack, agentMissing, onSetUp }: { error: string | null; treeLine: string | null; background: ReturnType<typeof useBackgroundStarts>; onPutBack: (key: number) => void; agentMissing: ChatAgent | null; onSetUp: () => void }) {
  return (
    <>
      {treeLine !== null && <p className="mx-nsd-note">{treeLine}</p>}
      {error !== null && <p role="alert" className="mx-nsd-note is-error">{error}</p>}
      {background.failed.map((failed) => (
        <p key={failed.key} role="alert" className="mx-nsd-note is-error">
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
        <p role="alert" className="mx-nsd-note is-error">
          {`${AGENT_LABEL[agentMissing]} is not installed on this computer. Pick another agent, or `}
          <button type="button" className="mx-text-button" onClick={onSetUp}>set it up</button>.
        </p>
      )}
    </>
  )
}
