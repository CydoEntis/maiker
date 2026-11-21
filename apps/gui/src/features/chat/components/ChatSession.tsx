import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from '@/lib/toast'
import { allowAlways, answerUserInput, approveRequest, loadTerminalScreen } from '@/api/daemon'
import { LOCAL_MACHINE, machineNameOf, parseSessionId, terminalOf } from '@/api/machines'
import { readConversationPermissions } from '@/data/conversationPermissions'
import type { ChatAgent, ChatLink } from '@/features/workspace/model/chatView'
import { abilitiesOf } from '@/features/workspace/model/agentAbilities'
import type { SessionStatus } from '@/features/workspace/model/session'
import type { SubagentView } from '@/features/workspace/model/subagents'
import { hasPendingApproval, runningTurnStartedAt, type ChatFeed } from '../chatFeed'
import { buildRows, type ChatRow } from '../chatRows'
import { findRow, registerChatFind } from '../chatSearch'
import { useLatest } from '@/lib/useLatest'
import { useChatFeed } from '../useChatFeed'
import { MAX_QUOTES } from '../quoteMessage'
import { COMMAND_SUBMIT_GAP_MS, typeMessage, useChatComposer, type PaneQueue } from '../useChatComposer'
import { countUserMessages } from '../workPhase'
import { sentTexts } from '../promptRecall'
import { startedBypassed } from '../bypassSessions'
import { CODEX_MODE_COMMAND, CODEX_MODE_REFUSED, CODEX_START_MODES, DANGER_MODES, modeFromScreen, modeLabel, PICKABLE_MODES, PLAN_MODE } from '../chatMeta'
import type { ApprovalDecision } from '../chatEvents'
import type { PermissionAsk } from '@/data/preview'
import { ANSWER_KEY, ANSWER_KEYS, ANSWER_STEP_MS, answerKeys, choiceKey, formQuestions, ownAnswerKeys, type AskChoice, type FormAnswer } from '../permissionAsk'
import { pickedText, type PickedText } from '../selectionActions'
import { addQuote } from '../composerStore'
import { ChatActionsContext, RevealContext, type ChatActions, type Reveal } from '../chatActions'
import { quoteSourceRow } from '../quoteJump'
import type { Askable } from '../plainQuestions'
import { forgetReplyDraft } from '../quickReply'
import { agentName } from '../commandCards'
import { ReplyTray } from './ReplyTray'
import { ReducedMotionContext } from '@/features/workspace/components/motion'
import { COPY_TOAST_ID, COPY_TOAST_MS } from '@/features/terminal/copyToast'
import { SelectionBar } from './SelectionBar'
import { OpenFileContext, type OpenFile } from '../openFile'
import { keepComposerFocus } from '../keepComposerFocus'
import { followComposer } from '../composerStore'
import type { SessionUsage } from '../usageStrip'
import { releaseFirstMessage, releaseStartChoice, startChoiceOf, takeCarriedDraft, useHeldByDaemon, useHeldFirstMessage } from '../firstMessage'
import { DEFAULT_PICK, noteAgentSaid, writeChoice } from '../agentChoice'
import { Composer, type DockOpen, type EndedActions } from './Composer'
import type { SessionPlace } from './SessionBar'
import { HelpersDock } from './HelpersDock'
import { dockHelpers, HelpersLiveContext, liveAgentsRow, type HelpersLive } from '../helpersDock'
import { ChatItem, type ChatItemContext } from './ChatItems'
import { KnownRowsContext } from '../knownRows'
import { ChatSkeleton } from './ChatSkeleton'
import { FilesHereContext } from '../filesHere'
import { askedPlan, PLAN_TOOL, planMenuChoices } from '../planApproval'
import { ApprovalTray, HelpersTray, PromptTray, type HelperAsk } from './QuestionTray'
import { keysToPick, parseChoiceMenu, typeEach } from '../screenMenu'
import { CommandMenuTray } from './CommandMenuTray'
import { useChatProblem } from './ChatProblem'
import { ProblemLine } from '@/components/ui/feedback'
import { summaryOf } from '../summary'
import type { ChatProblem } from '../problem'
import { SubagentBar, SubagentChat } from './SubagentChat'
import { VirtualList } from './VirtualList'
import { copyText } from '@/lib/clipboard'
import { ConfirmCloseDialog } from '@/features/workspace/components/ConfirmCloseDialog'
import type { DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { InspectView } from '@/features/inspect/InspectPanel'
import type { ConfirmAsk, WindowRoute } from '../windowCommands'
import { namedCommand } from '../slashCommands'
import { CLAUDE_TERMINAL_COMMANDS } from '../terminalCommands'
import { useAside } from '../useAside'
import { lastReply, permissionsCard, statusCard, transcriptMarkdown } from '../commandCards'
import { copyBlock, saveBlock } from '../saveBlock'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { SignInCard } from '@/features/signin/SignInCard'
import { useAgentSignIn } from '@/features/signin/useAgentSignIn'
import { AsideCard } from './AsideCard'
import type { RewindPlace } from '../editFromHere'
import type { FileSearchPlace } from '../fileMention'
import { useEditFromHere } from '../useEditFromHere'
import { agentLabel } from '@/features/workspace/model/session'

/** When a turn ends the status changes at once, but the agent's last words may not be read yet: read now and again soon, instead of waiting for the idle poll. */
const END_OF_TURN_READ_MS = 600
/** How long the working line stays after a turn ends with no reply read yet, so the pane is never blank between the two. */
const SETTLE_MS = 650
/** Shift+Tab, which cycles the agent's permission mode, and how long after it the new mode is read back. */
const SHIFT_TAB = '\x1b[Z'
const MODE_READ_MS = 400
/**
 * How long after typing a Codex command its Enter is pressed. Codex takes keys that arrive together for a paste, and an Enter
 * that comes with them for a line break: the command then sits in its box unsent (seen on Codex 0.166 on Windows).
 */
/** The most presses of Shift+Tab a full turn of Claude's modes takes. */
const MODE_CYCLE_MAX = 5

/** A row not yet measured is drawn as if it were this tall, which a message or a card usually is. */
const ESTIMATED_ROW_PX = 72

/** What a screen reader hears when the conversation changes state: one short line per change, never the text. */
function announcement(feed: ChatFeed, agent: ChatAgent, working: boolean): string {
  if (hasPendingApproval(feed) || feed.status === 'Blocked') return `${agentLabel(agent)} is waiting for your answer`
  if (working) return `${agentLabel(agent)} is working`
  if (feed.status === 'Done') return `${agentLabel(agent)} finished`
  return ''
}

const rowKey = (row: ChatRow) => row.key
/** A message the person sent: the row the view stands on after a send. */
const isSentRow = (row: ChatRow) => row.kind === 'user' || row.kind === 'echo'

/** A pending request is asked in the tray over the message box, so it is not also a row of the list. */
const isPendingApproval = (row: ChatRow) => row.kind === 'approval' && row.event.resolution.status === 'pending'

/** The keys that answer the question tray, as typing the same letters in the terminal would. */
const KEY_DECISION: Readonly<Record<string, ApprovalDecision>> = Object.fromEntries(Object.entries(ANSWER_KEY).map(([decision, key]) => [key, decision as ApprovalDecision]))

/** Whether a key press belongs to a field, where a letter is text and not an answer. */
const typedInField = (target: EventTarget) => target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') !== null

/** The message box with nothing in it: y, a and n are not text there yet, so they answer the tray. Numbers stay the box's. */
const inEmptyBox = (target: EventTarget) => target instanceof HTMLTextAreaElement && target.classList.contains('mx-box-text') && target.value === ''


const NO_SUBAGENTS: readonly SubagentView[] = []
/** How long a jump marks the message it lands on, and how many frames it waits for the list to draw it. */
const FLASH_MS = 1200
const FLASH_FRAMES_MAX = 40
const ERROR_WORDS_MAX = 140
const truncateError = (reason: string) => (reason.length > ERROR_WORDS_MAX ? `${reason.slice(0, ERROR_WORDS_MAX)}…` : reason)

type Props = {
  link: ChatLink
  agent: ChatAgent
  /** The daemon is connected: a message or an answer can be sent. */
  online: boolean
  /** The session's folder, so file names read relative to it. */
  root?: string | null
  /** Opens a file's diff, or a turn's, in the Changes panel; absent where there is none. */
  onOpenDiff?: ChatItemContext['openDiff']
  /** Opens a file a reply names, at its line when it gave one. */
  onOpenFile?: OpenFile | null
  /** Types into the terminal the agent runs in, for a chat that follows it (ADR 0003). */
  typeInto?: ((text: string) => Promise<void>) | undefined
  /** What the pane's daemon holds for its working agent: a message or a pick made while it works joins it. */
  paneQueue?: PaneQueue | undefined
  /** The permission prompt the agent's hook says its terminal is stopped on, for a chat that follows it. */
  ask?: PermissionAsk | null
  /** What the daemon read off the agent's screen while it is stopped: the lines asked and the numbered choices. */
  asking?: string
  /** The pane's own status, live in the sidebar: the chat shows working at once and reads then, instead of at its next poll. */
  paneStatus?: SessionStatus
  /**
   * Helpers keeping the session working after the agent's own turn ended: the agent is at its prompt, so the chat
   * takes a message at once and says so, instead of "thinking" and queueing.
   */
  helpersOnly?: number
  /** The helpers the session waits on the person to allow, asked in the tray over the message box. */
  helperAsk?: HelperAsk | undefined
  /** The session's id: a message typed while its agent was starting is held under it, and goes out from here. */
  sessionId?: string
  /** A subagent whose own chat shows instead of the session's, and the way back. */
  subagent?: SubagentView | null
  /** The helpers the runtime lists for this session, for what each is doing in the helpers line. */
  subagents?: readonly SubagentView[]
  onBackToMain?: () => void
  /** What the session's agent reported using (context, plan limits), for the strip under the message box. */
  usage?: SessionUsage
  /** Shows the session's terminal log over this chat, for a command whose menu only the terminal draws; the app's view is unchanged. */
  onShowTerminal?: () => void
  /** What is wrong with the chat, if anything: shown as a banner over the message box when nothing else is asked of the person. */
  problem?: ChatProblem | null
  /** The effort the agent's own files say it runs at; null when they do not say. */
  effort?: string | null | undefined
  /** Where a sent message's Edit from here restores the files from; absent where it is not offered. */
  rewind?: RewindPlace | undefined
  /** Where an `@` in the message box looks for files; absent where it is not offered. */
  fileSearch?: FileSearchPlace | undefined
  /** Leaves out runs of reads and searches that succeeded (Settings › Chat). */
  hideSuccessfulTools?: boolean
  /** The window's own screens a command opens instead of Claude Code's menu (`windowCommands.ts`); absent where there are none. */
  windowActions?: WindowActions | undefined
  /** Where the session runs, for the row under the message box. */
  place?: SessionPlace | undefined
  /** Set once the session has ended: the message box gives way to a read-only line. */
  ended?: EndedActions | undefined
  /** The chat is mounted out of sight, behind the tab showing: it keeps what it shows but reads nothing until it is shown. */
  paused?: boolean
}

/** The screens a command can open beside the chat: a Settings page, a tab of the session's side panel, the closed sessions. */
export type WindowActions = {
  readonly openSettings: (section: DesktopSettingsSection) => void
  readonly openPanel: (view: InspectView) => void
  readonly openRecent: () => void
  /** Gives the session a new name in Maiker, as the sidebar's rename does. */
  readonly renameSession: (name: string) => void
}

/** The chat of one session: its history as a virtualised list, the daemon's status, and the composer under it. */
export function ChatSession({ link, agent, online, root = null, onOpenDiff = null, onOpenFile = null, typeInto, paneQueue, ask = null, asking = '', helperAsk, sessionId, paneStatus, helpersOnly = 0, subagent = null, subagents = NO_SUBAGENTS, onBackToMain, onShowTerminal, usage, problem = null, effort = null, rewind, hideSuccessfulTools = false, fileSearch, windowActions, place, ended, paused = false }: Props) {
  const { feed, events, offline, readError, refresh, recordAnswer, unwatchedReads } = useChatFeed({ conversation: link.conversation, generation: link.generation, provider: agent, paused })
  const agentFree = helpersOnly > 0
  const paneWorking = paneStatus === 'working' && !agentFree
  const working = !agentFree && (feed.status === 'Working' || paneWorking)
  const workingSince = working ? runningTurnStartedAt(feed) : null
  const wasWorking = useRef(false)
  // The turn has ended but its reply is not in the history yet: the working line holds until it is, or SETTLE_MS.
  const [settling, setSettling] = useState(false)
  const repliedRef = useRef(false)
  useEffect(() => {
    const changed = wasWorking.current !== working
    const ended = wasWorking.current && !working
    wasWorking.current = working
    if (!changed) return undefined
    if (ended && !repliedRef.current) {
      setSettling(true)
      const settle = window.setTimeout(() => { setSettling(false) }, SETTLE_MS)
      const read = window.setTimeout(refresh, END_OF_TURN_READ_MS)
      refresh()
      return () => { window.clearTimeout(settle); window.clearTimeout(read) }
    }
    // Read as the turn starts (its first words) and as it ends (its last), not at the next poll.
    refresh()
    if (!ended) return undefined
    const timer = window.setTimeout(refresh, END_OF_TURN_READ_MS)
    return () => { window.clearTimeout(timer) }
  }, [working, refresh])
  // The transcript has no entry for a terminal agent's prompt until it is answered, so the chat shows it from the hook's report.
  const stoppedOnPrompt = link.readOnly === true && feed.status === 'Blocked'
  const promptKeys = abilitiesOf(agent).answerKeys
  const answerPrompt = typeInto === undefined || promptKeys === null ? undefined : (choice: AskChoice) => typeInto(promptKeys[choice]).then(refresh)
  // A menu the chat has no buttons for is answered with the keys a person would press, in the agent's own terminal.
  const sendKeys = typeInto === undefined ? undefined : (keys: string) => typeInto(keys).then(refresh)
  const readScreen = useMemo(() => (sessionId === undefined ? undefined : () => loadTerminalScreen({ id: sessionId, generation: 0 })), [sessionId])
  const pickChoice = typeInto === undefined ? undefined : (index: number) => typeInto(choiceKey(index)).then(refresh)
  // A form is answered a key at a time, as a person would: the prompt redraws after each.
  const typeKeys = typeInto === undefined ? undefined : async (keys: readonly string[]) => {
    for (const [at, key] of keys.entries()) {
      if (at > 0) await new Promise<void>((resolve) => { window.setTimeout(resolve, ANSWER_STEP_MS) })
      await typeInto(key)
    }
    refresh()
  }
  const pickChoices = typeKeys === undefined ? undefined : (answers: readonly FormAnswer[]) => typeKeys(answerKeys(formQuestions(ask), answers))
  const answerOwn = typeKeys === undefined ? undefined : (text: string) => typeKeys(ownAnswerKeys(ask?.choices?.length ?? 0, text))
  // A chat that follows the agent's own terminal changes its mode, model and reasoning the way its user would: by typing the agent's commands
  // (Shift+Tab, /model, /effort). A mode picked while it works is held and typed once the turn ends, so no key lands in the turn.
  // What it shows meanwhile is read back from its screen (mode) or taken from what was picked (model, effort), until the agent's own file says it.
  // The agent's files are the one record of what it runs, so a terminal command and a pick here always show the same.
  const [liveMode, setLiveMode] = useState<{ base: string | null; value: string } | null>(null)
  const [liveModel, setLiveModel] = useState<{ base: string | null; value: string } | null>(null)
  const [liveEffort, setLiveEffort] = useState<{ base: string | null; value: string } | null>(null)
  const metaMode = feed.meta?.mode ?? null
  const metaModel = feed.meta?.model ?? null
  // What the chat was started with, until the agent's own file says it: the chips the starting chat drew stay as they were.
  const [started] = useState(() => startChoiceOf(sessionId))
  const shownMode = (liveMode !== null && liveMode.base === metaMode ? liveMode.value : metaMode) ?? started?.mode ?? null
  const startedModel = started === null || started.model === DEFAULT_PICK ? null : started.model
  const startedEffort = started === null || started.reasoning === DEFAULT_PICK ? null : started.reasoning
  const shownModel = (liveModel !== null && liveModel.base === metaModel ? liveModel.value : metaModel) ?? startedModel
  const shownEffort = (liveEffort !== null && liveEffort.base === effort ? liveEffort.value : effort) ?? startedEffort
  const abilities = abilitiesOf(agent)
  const canChangeAgent = typeInto !== undefined && abilities.changeAgent && link.readOnly === true
  // Another machine's chat: its screen cannot be read from here, so a mode that must be checked on screen is not picked
  // from here, and its commands and models are that machine's, not this computer's.
  const remote = sessionId !== undefined && machineNameOf(sessionId) !== null
  // Whose commands the box lists: the machine the chat runs on. A machine this window has not been told of has none.
  const commandsMachine = sessionId !== undefined && remote ? (parseSessionId(sessionId)?.machine ?? null) : LOCAL_MACHINE
  const canPickCodexMode = typeInto !== undefined && abilities.permissionModes?.switchBy === 'command' && link.readOnly === true && !remote
  // The chips stay drawn while their keys would land in a turn or nowhere; they are only greyed out, so the box does not rearrange.
  const pickerLocked = !online ? 'The Maiker service is offline' : stoppedOnPrompt ? `${agentLabel(agent)} is asking something. Answer it first.` : null
  const chipsLocked = !online ? 'The Maiker service is offline' : working ? `${agentLabel(agent)} is working. Change this when it finishes.` : null
  // Picked commands are typed one after another: each waits for its Enter, so a model and an effort picked together do not interleave.
  const commandChain = useRef<Promise<void>>(Promise.resolve())
  // A mode picked while the agent works, typed in once the turn ends; numbered, so each is typed once.
  const [heldMode, setHeldMode] = useState<{ mode: string; pick: number } | null>(null)
  const appliedPick = useRef(0)
  // A menu the agent's own command opened (Codex's /model), drawn in the chat until it is closed.
  const [menuOpen, setMenuOpen] = useState(false)
  const agentControls = useMemo(() => {
    if (canPickCodexMode) {
      return {
        // Codex has no model flag a chat can set on a running session: its /model menu is typed and shown here, and the person picks in it.
        onOpenModelMenu: () => {
          if (pickerLocked !== null || chipsLocked !== null) return
          setMenuOpen(true)
          const typed = commandChain.current.then(() => typeMessage(typeInto, agent, '/model')).then(refresh)
          commandChain.current = typed.catch((error: unknown) => {
            setMenuOpen(false)
            toast.failed('Could not open the model menu', error)
          })
        },
        modelMenuLocked: pickerLocked ?? chipsLocked,
        modes: CODEX_START_MODES,
        modeAgent: 'Codex',
        onPickMode: (target: string) => {
          const command = CODEX_MODE_COMMAND[target]
          if (sessionId === undefined || command === undefined) return
          // Codex has no file that says its mode, so the pick stands unless its screen says the command was refused.
          const before = shownMode
          setLiveMode({ base: metaMode, value: target })
          const step = async () => {
            await typeInto(command)
            await new Promise<void>((resolve) => { window.setTimeout(resolve, COMMAND_SUBMIT_GAP_MS) })
            await typeInto('\r')
            await new Promise<void>((resolve) => { window.setTimeout(resolve, MODE_READ_MS) })
            if (CODEX_MODE_REFUSED.test(await loadTerminalScreen({ id: sessionId, generation: 0 }))) {
              setLiveMode(before === null ? null : { base: metaMode, value: before })
              toast.error(`Codex did not switch to ${modeLabel(target) ?? target}. Its terminal says why.`)
            }
            refresh()
          }
          void step().catch((error: unknown) => {
            setLiveMode(before === null ? null : { base: metaMode, value: before })
            toast.failed('Could not change the permission mode', error)
          })
        },
      }
    }
    if (!canChangeAgent) return {}
    return {
      // A question the agent is asking holds the picker, since typed text would answer it; the composer also greys the model
      // and effort while the agent works, and the mode waits for the turn's end here.
      agentChips: { locked: pickerLocked, pickerLocked, remote },
      onCommand: (text: string) => {
        if (pickerLocked !== null) return
        const model = /^\/model (\S+)/.exec(text)?.[1]
        if (model !== undefined) setLiveModel({ base: metaModel, value: model })
        const level = /^\/effort (\S+)/.exec(text)?.[1]
        if (level !== undefined) setLiveEffort({ base: effort, value: level })
        // Through typeMessage, so Claude Code gets its Enter after a pause: sent with the command, the Enter is taken
        // for the completion it is showing and the command never runs.
        const typed = commandChain.current.then(() => typeMessage(typeInto, agent, text)).then(refresh)
        commandChain.current = typed.catch((error: unknown) => {
          if (model !== undefined) setLiveModel(null)
          if (level !== undefined) setLiveEffort(null)
          toast.failed('Could not type the command', error)
        })
      },
      ...(remote ? {} : { onPickMode: (target: string) => {
        if (sessionId === undefined) return
        const before = shownMode
        // Shift+Tab only cycles, so press it until the screen shows the picked mode; a mode that never comes up is not allowed in this session.
        // The chip shows the pick at once and the presses happen behind it; the screen has the last word when they end.
        setLiveMode({ base: metaMode, value: target })
        const step = async () => {
          for (let press = 0; press <= MODE_CYCLE_MAX; press += 1) {
            const mode = modeFromScreen(await loadTerminalScreen({ id: sessionId, generation: 0 }))
            if (mode === target) {
              refresh()
              return
            }
            if (press === MODE_CYCLE_MAX) break
            await typeInto(SHIFT_TAB)
            await new Promise<void>((resolve) => { window.setTimeout(resolve, MODE_READ_MS) })
          }
          const now = modeFromScreen(await loadTerminalScreen({ id: sessionId, generation: 0 }))
          setLiveMode(now === null ? null : { base: metaMode, value: now })
          toast.error(`${modeLabel(target) ?? target} is not available in this session. Claude has to be started allowing it.`)
          refresh()
        }
        void step().catch((error: unknown) => {
          setLiveMode(before === null ? null : { base: metaMode, value: before })
          toast.failed('Could not change the permission mode', error)
        })
      } }),
    }
  }, [agent, canChangeAgent, canPickCodexMode, chipsLocked, typeInto, refresh, sessionId, metaMode, metaModel, effort, shownMode, pickerLocked, remote])
  // The mode is picked at any time but typed only between turns: a pick while the agent works shows at once and is held.
  const applyNow = 'onPickMode' in agentControls ? agentControls.onPickMode : undefined
  const pickHeld = useCallback((target: string) => {
    if (applyNow === undefined) return
    if (pickerLocked !== null) {
      toast.info(pickerLocked)
      return
    }
    if (!working) {
      applyNow(target)
      return
    }
    setHeldMode((was) => ({ mode: target, pick: (was?.pick ?? 0) + 1 }))
    setLiveMode({ base: metaMode, value: target })
    toast.info(`${modeLabel(target) ?? target} from the next turn`, { description: `${agentLabel(agent)} is working, so the mode changes once this turn ends.` })
  }, [applyNow, pickerLocked, working, metaMode, agent])
  const pickMode = applyNow === undefined ? undefined : pickHeld
  useEffect(() => {
    if (applyNow === undefined || heldMode === null || heldMode.pick <= appliedPick.current || working || pickerLocked !== null) return
    appliedPick.current = heldMode.pick
    applyNow(heldMode.mode)
  }, [applyNow, heldMode, working, pickerLocked])
  const composer = useChatComposer({ link, agent, feed, online, refresh, paneWorking, ...(typeInto ? { typeInto } : {}), ...(paneQueue ? { paneQueue } : {}) })
  // A command that opens a menu of its own is typed into the agent's terminal, whose log is shown over the chat: the chat cannot draw the menu.
  const runInTerminal = typeInto === undefined || onShowTerminal === undefined || link.readOnly !== true ? undefined : (command: string) => {
    onShowTerminal()
    toast.info(`${command.split(/\s/, 1)[0] ?? command} has no chat version, so its menu is in the terminal log.`)
    void typeMessage(typeInto, agent, command).catch((error: unknown) => { toast.failed(`Could not run ${command}`, error) })
  }
  const { sendText, setDraft: setComposerDraft, ready, sending, echo } = composer
  // A command that ends or empties the session waits here for a yes, then goes to the agent as it was typed.
  // `then` is what a yes does when it is not the command itself: moving the session to plan mode.
  const [confirming, setConfirming] = useState<{ ask: ConfirmAsk; typed: string; then?: () => void } | null>(null)
  const aside = useAside(link.conversation)
  const signIn = useAgentSignIn(undefined)
  const signInView = signIn.view
  // Once confirmed it runs where Claude Code runs it: one only the terminal answers is typed there and shown, the rest are sent.
  const runConfirmed = (typed: string) => {
    if (runInTerminal !== undefined && namedCommand(CLAUDE_TERMINAL_COMMANDS, typed)?.terminal === true) runInTerminal(typed)
    else void sendText(typed)
  }
  // A message just sent shows at once, with the agent taken to be at work on it, until the history has it.
  // A first message typed while the agent started is held, and shows exactly as the starting chat showed it (the bubble, then the
  // working line) until it is sent and the history has it, so the chat never says "No messages yet" in between.
  const held = useHeldFirstMessage(sessionId)
  const heldByDaemon = useHeldByDaemon(sessionId)
  const sentText = echo !== null && countUserMessages(events, echo.text) <= echo.baseline ? echo.text : null
  const echoText = sentText ?? held
  const echoThinking = sentText === null ? held !== null : echo !== null && !echo.quiet
  // What the history says without the working line or hidden runs: whether the agent has answered what was last asked,
  // and the summary a new chat starts from, which reads the last reply as it was said.
  const bareRows = useMemo(() => buildRows(events, false, root, echoText, false), [events, root, echoText])
  // A command the window answers from what the chat holds, or by a control it already has. Nothing here changes a permission
  // mode without a click: /plan asks first, and /permissions only says what the modes are.
  const runInWindow = windowActions === undefined ? undefined : (route: WindowRoute, typed: string) => {
    switch (route.kind) {
      case 'settings': windowActions.openSettings(route.section); return
      case 'panel': windowActions.openPanel(route.view); return
      case 'recent': windowActions.openRecent(); return
      case 'confirm': setConfirming({ ask: route.ask, typed }); return
      case 'aside': aside.ask(route.title, route.ask); return
      case 'note': aside.show(route.title, route.text); return
      case 'signIn': signIn.begin(route.agent); return
      case 'rename': windowActions.renameSession(route.name); void sendText(typed); return
      case 'card':
        if (route.card === 'status') aside.show('Status', statusCard({ agent, model: shownModel, effort, mode: shownMode, folder: root, usage, now: nowSeconds(), working, online }))
        else aside.show('Permissions', permissionsCard(agent, shownMode, agent === 'codex' ? CODEX_START_MODES : PICKABLE_MODES))
        return
      case 'copy': {
        const reply = lastReply(bareRows)
        if (reply === null) toast.info(`${agentLabel(agent)} has not said anything yet.`)
        else copyBlock(reply, 'Could not copy the reply')
        return
      }
      case 'export': {
        const text = transcriptMarkdown(bareRows, agent)
        if (text === null) toast.info('There is nothing to export yet.')
        else saveBlock('conversation', 'md', text)
        return
      }
      case 'plan':
        if (shownMode === PLAN_MODE) aside.show('Plan mode', `${agentLabel(agent)} is already in plan mode. It reads and plans, and changes nothing until you approve the plan.`)
        else if (pickMode === undefined) aside.show('Plan mode', 'This chat cannot change its permission mode from here.')
        else setConfirming({ ask: { title: 'Switch to plan mode?', body: `${agentLabel(agent)} will read and plan and change nothing until you approve the plan. You can pick another mode with the shield button.`, confirmLabel: 'Plan mode' }, typed, then: () => { pickMode(PLAN_MODE) } })
        return
      case 'commands':
      case 'complete': return
    }
  }
  const lastKind = bareRows.at(-1)?.kind
  const replied = lastKind !== undefined && lastKind !== 'user' && lastKind !== 'echo'
  useEffect(() => { repliedRef.current = replied })
  const holdWorking = settling && !replied
  const freePhrase = agentFree ? `free · ${String(helpersOnly)} ${helpersOnly === 1 ? 'helper' : 'helpers'} working` : null
  const allRows = useMemo(() => buildRows(events, working || holdWorking || agentFree, root, echoText, echoThinking, hideSuccessfulTools, freePhrase), [events, working, holdWorking, agentFree, root, echoText, echoThinking, hideSuccessfulTools, freePhrase])
  // The turn's rows are drawn as they arrive; only a pending request stays out, since the tray over the box asks it.
  const rows = useMemo(() => allRows.filter((row) => !isPendingApproval(row)), [allRows])
  // The dock above the box: the helpers line while helpers work (the last agents row with one running, and only while
  // the session itself is not at rest, or a history that never recorded their end would keep the line for ever), the
  // queue under it. One of the two lists is open at a time.
  const [dockOpen, setDockOpen] = useState<DockOpen>(null)
  const helpersMayRun = paneStatus === undefined || paneStatus === 'working' || paneStatus === 'needs' || helpersOnly > 0
  const liveRow = useMemo(() => (helpersMayRun ? liveAgentsRow(rows) : null), [helpersMayRun, rows])
  const dockedHelpers = useMemo(() => (liveRow === null ? [] : dockHelpers(liveRow.events, subagents)), [liveRow, subagents])
  const queuedCount = composer.queue.length
  // A list with nothing left to list folds itself, so it is closed the next time it has something.
  if ((dockOpen === 'helpers' && liveRow === null) || (dockOpen === 'queue' && queuedCount <= 1)) setDockOpen(null)
  const helpersLive = useMemo<HelpersLive | null>(() => (liveRow === null ? null : { key: liveRow.key, open: () => { setDockOpen('helpers') } }), [liveRow])
  const dock = useMemo(() => ({ open: dockOpen, set: setDockOpen }), [dockOpen])
  // A session that failed keeps what was queued; it goes when the agent runs again.
  const queueNote = paneStatus === 'error' && queuedCount > 0 ? 'This session failed. Your queued messages are kept and go out when it runs again.' : null
  // What ↑ in the box brings back: the messages sent in this chat, each once in a row, the newest last.
  const sentMessages = useMemo(() => sentTexts(events), [events])
  // Text selected in the chat gets a small bar where the mouse let go: Copy, and Quote into the message box. It goes
  // when the selection does (a click elsewhere), on Esc, and when the chat scrolls away from under it.
  const [picked, setPicked] = useState<PickedText | null>(null)
  const chat = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (picked === null) return
    const drop = () => { setPicked(null) }
    const dropIfUnselected = () => { if (window.getSelection()?.isCollapsed !== false) drop() }
    const dropOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') drop() }
    document.addEventListener('selectionchange', dropIfUnselected)
    document.addEventListener('keydown', dropOnEscape)
    document.addEventListener('scroll', drop, true)
    return () => {
      document.removeEventListener('selectionchange', dropIfUnselected)
      document.removeEventListener('keydown', dropOnEscape)
      document.removeEventListener('scroll', drop, true)
    }
  }, [picked])
  const copyPicked = () => {
    if (picked === null) return
    setPicked(null)
    copyText(picked.text).then(
      () => { toast.success('Copied', { id: COPY_TOAST_ID, duration: COPY_TOAST_MS }) },
      (failure: unknown) => {
        // Why it was refused is the web view's to say; without it a refusal cannot be told from a bug here.
        console.warn('The web view refused to copy the selection', failure)
        toast.error('Could not copy the selection')
      },
    )
  }
  const [quoteNote, setQuoteNote] = useState('')
  // Words go to the strip above the message box, and the box takes the keys so the reply is typed under them.
  const quote = useCallback((who: string, text: string) => {
    const added = addQuote(link.conversation, { who, text })
    if (added === 'full') toast.info(`A message can carry ${String(MAX_QUOTES)} quotes. Send it, or remove one.`)
    else setQuoteNote(added === 'added' ? 'Quote added' : 'Already quoted')
    window.getSelection()?.removeAllRanges()
    window.requestAnimationFrame(() => {
      const field = chat.current?.querySelector<HTMLTextAreaElement>('textarea.mx-box-text:not(:disabled)')
      field?.focus({ preventScroll: true })
      field?.setSelectionRange(field.value.length, field.value.length)
    })
  }, [link.conversation])
  const quotePicked = () => {
    if (picked === null) return
    quote(picked.speaker === 'user' ? 'You' : agentName(agent), picked.text)
    setPicked(null)
  }
  // Rows are known, and so shown whole, once a read has brought them without the person watching: the first read after
  // the chat opened (until then it shows what this window remembered, which may be behind) and one after the window was
  // hidden. Only a reply that comes while the chat is being looked at is typed in.
  const [known, setKnown] = useState<Set<string> | null>(null)
  const [knownAsOf, setKnownAsOf] = useState(0)
  if (feed.loaded && knownAsOf !== unwatchedReads) {
    setKnownAsOf(unwatchedReads)
    setKnown(new Set(rows.map(rowKey)))
  }
  const pending = useMemo(() => allRows.find((row): row is Extract<ChatRow, { kind: 'approval' }> => isPendingApproval(row))?.event ?? null, [allRows])
  // The model and effort picked on the New session dialog are this conversation's choice from its first frame, so the picker shows them.
  // A chat that follows the terminal keeps no choice of its own: what its agent says it runs is the choice.
  const followsTerminal = link.readOnly === true
  useLayoutEffect(() => {
    if (sessionId === undefined) return
    if (started !== null && !followsTerminal) writeChoice(link.conversation, { model: started.model, reasoning: started.reasoning })
    releaseStartChoice(sessionId)
  }, [sessionId, started, link.conversation, followsTerminal])
  // Once the agent says it runs another model or effort than it last said, that is what the message box shows and
  // what the next message keeps. After the start choice above, so it is not undone.
  useEffect(() => { if (!followsTerminal) noteAgentSaid(link.conversation, { model: metaModel, effort }) }, [link.conversation, metaModel, effort, followsTerminal])
  // The session's unsent text comes along when its chat was given a new conversation number.
  useEffect(() => {
    if (sessionId !== undefined) followComposer(sessionId, link.conversation)
  }, [sessionId, link.conversation])
  // A draft typed while the agent started comes over once, and a message sent then goes out as soon as the agent takes input.
  useEffect(() => {
    if (sessionId === undefined) return
    const carried = takeCarriedDraft(sessionId)
    if (carried !== null) setComposerDraft(carried)
  }, [sessionId, setComposerDraft])
  useEffect(() => {
    if (sessionId === undefined || held === null || heldByDaemon || !ready || sending) return
    releaseFirstMessage(sessionId)
    void sendText(held).then((delivered) => { if (!delivered) setComposerDraft(held) })
  }, [sessionId, held, heldByDaemon, ready, sending, sendText, setComposerDraft])
  // The daemon types in a message it holds: once the history has what the person said, the stand-in for it goes.
  const personSpoke = useMemo(() => events.some((event) => event.kind === 'message' && event.role === 'user'), [events])
  useEffect(() => {
    if (sessionId !== undefined && held !== null && heldByDaemon && personSpoke) releaseFirstMessage(sessionId)
  }, [sessionId, held, heldByDaemon, personSpoke])
  // The daemon does not report how a session was started, so the window remembers the sessions it started with full access.
  const fullAccess = useMemo(() => readConversationPermissions()[String(link.conversation)] === 'full-access', [link.conversation])

  const [answering, setAnswering] = useState(false)
  const answer = useCallback((requestId: number | string, decision: ApprovalDecision) => {
    setAnswering(true)
    approveRequest({ id: String(link.conversation), generation: link.generation }, requestId, decision)
      .then(() => { recordAnswer(requestId, decision); refresh() })
      .catch((error: unknown) => { toast.failed('Could not send your answer', error) })
      .finally(() => { setAnswering(false) })
  }, [link.conversation, link.generation, recordAnswer, refresh])
  // "Always in this project": this one is allowed now, and the daemon allows the same command in this project from then on.
  const remember = useCallback((requestId: number | string) => {
    setAnswering(true)
    allowAlways({ id: String(link.conversation), generation: link.generation }, requestId)
      .then(() => { recordAnswer(requestId, 'Accept'); refresh() })
      .catch((error: unknown) => { toast.failed('Could not remember your answer', error) })
      .finally(() => { setAnswering(false) })
  }, [link.conversation, link.generation, recordAnswer, refresh])
  // A user-input answer is relayed once and recorded nowhere: it can be a secret.
  const answerInput = useCallback((requestId: number | string, answers: Record<string, string[]>) => {
    setAnswering(true)
    answerUserInput({ id: String(link.conversation), generation: link.generation }, requestId, answers)
      .then(refresh)
      .catch((error: unknown) => { toast.failed('Could not send your answer', error) })
      .finally(() => { setAnswering(false) })
  }, [link.conversation, link.generation, refresh])
  // A chat that follows a terminal pane is answered in that terminal (ADR 0003), so it offers no buttons.
  const approval = useMemo(() => (online && link.readOnly !== true ? { answer, answerInput, remember, busy: answering } : null), [online, link.readOnly, answer, answerInput, remember, answering])

  // An approval's link to its tool step scrolls the list there; the nonce makes a second click on the same link scroll again.
  const [scrollTarget, setScrollTarget] = useState<{ key: string; nonce: number } | null>(null)
  // A message sent takes the chat to it: it stands at the top of the view and the reply fills in below it. One queued
  // behind the running turn is not in the chat yet (it shows in the dock), so the view stays where it is.
  const [sentCount, setSentCount] = useState(0)
  // A message is its words and how often they were said before it, so the same words sent again count, and the echo
  // going quiet does not.
  const sentKey = echo === null ? null : `${echo.text}\u0000${String(echo.baseline)}`
  const [seenSend, setSeenSend] = useState({ sentKey, queued: composer.queue.length })
  if (seenSend.sentKey !== sentKey || seenSend.queued !== composer.queue.length) {
    if (sentKey !== null && sentKey !== seenSend.sentKey) setSentCount(sentCount + 1)
    setSeenSend({ sentKey, queued: composer.queue.length })
  }
  const goToStep = useCallback((key: string) => { setScrollTarget((current) => ({ key, nonce: (current?.nonce ?? 0) + 1 })) }, [])

  // A quote's stub goes to the message it came from: the view scrolls there, a folded block that holds it opens, and the
  // row is outlined for a moment (not at all with reduced motion, where the scroll alone says where).
  const reducedMotion = useContext(ReducedMotionContext)
  const [reveal, setReveal] = useState<Reveal>({ key: null, nonce: 0 })
  const [flash, setFlash] = useState<{ key: string; nonce: number } | null>(null)
  const rowsLatest = useLatest(() => rows)
  const jump = useCallback((text: string, from: string) => {
    const key = quoteSourceRow(rowsLatest(), text, from)
    if (key === null) {
      toast.info('The message this quotes is no longer in the chat.')
      return
    }
    setReveal((current) => ({ key, nonce: current.nonce + 1 }))
    goToStep(key)
    setFlash((current) => ({ key, nonce: (current?.nonce ?? 0) + 1 }))
  }, [rowsLatest, goToStep])
  useEffect(() => {
    if (flash === null || reducedMotion) return undefined
    let frames = 0
    let frame = 0
    let timer = 0
    let marked: HTMLElement | null = null
    // The row may not be drawn yet: the list draws it once the scroll gets there.
    const mark = () => {
      const row = Array.from(chat.current?.querySelectorAll<HTMLElement>('[data-key]') ?? []).find((element) => element.dataset.key === flash.key)
      if (row === undefined) {
        frames += 1
        if (frames < FLASH_FRAMES_MAX) frame = window.requestAnimationFrame(mark)
        return
      }
      marked = row
      row.classList.add('is-flash')
      timer = window.setTimeout(() => { row.classList.remove('is-flash') }, FLASH_MS)
    }
    frame = window.requestAnimationFrame(mark)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      marked?.classList.remove('is-flash')
    }
  }, [flash, reducedMotion])

  // Questions the agent asked in plain words, answered one by one in a tray over the box. What was written stays with the
  // message when the tray closes, and goes when its reply is sent.
  const [replying, setReplying] = useState<{ row: string; who: string; asked: readonly Askable[]; focus: string | null; nonce: number } | null>(null)
  const reply = useCallback((row: string, who: string, asked: readonly Askable[], focus: string | null) => {
    setReplying((current) => ({ row, who, asked, focus, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])
  const { sendReply } = composer
  const sendReplies = async (message: string, count: number) => {
    const went = await sendReply(message)
    if (went) {
      setQuoteNote(count === 1 ? 'Reply sent' : `Reply sent, ${String(count)} answers`)
      if (replying !== null) forgetReplyDraft(replying.row)
    }
    return went
  }
  // A message that is gone (regenerated, or the chat changed) takes its tray with it.
  const replyRowGone = replying !== null && !rows.some((row) => row.key === replying.row)
  if (replyRowGone) setReplying(null)

  // Find (the window's search bar) looks through this chat while it shows: the row that holds the text is scrolled to and marked.
  const [found, setFound] = useState<string | null>(null)
  const rowsNow = useLatest(() => rows)
  const foundNow = useLatest(() => found)
  useEffect(() => {
    if (sessionId === undefined) return undefined
    return registerChatFind(sessionId, {
      find: (query, direction) => {
        const key = findRow(rowsNow(), query, foundNow(), direction)
        setFound(key)
        if (key !== null) goToStep(key)
        return key !== null
      },
      clear: () => { setFound(null) },
    })
  }, [sessionId, rowsNow, foundNow, goToStep])

  const waitingStep = pending?.stepId ?? null
  const draftable = composer.draftable
  const actions = useMemo<ChatActions | null>(() => (draftable ? { quote, jump, reply, retry: (text: string) => { void sendText(text) }, canReply: true } : null), [draftable, quote, jump, reply, sendText])
  const plan = useMemo(() => (ask?.tool === PLAN_TOOL ? askedPlan(events) : null), [ask?.tool, events])
  // The daemon refuses a restore while the agent works too: its files would be rolled back under it.
  const rewindBusy = !online ? 'The Maiker service is offline' : working ? `${agentLabel(agent)} is working. Edit from here when it finishes.` : null
  const editFromHere = useEditFromHere({ place: rewind ?? null, conversation: link.conversation, events, agent, busy: rewindBusy })
  const editAction = editFromHere.action
  const renderRow = useCallback(
    (row: ChatRow) => {
      const item = <ChatItem row={row} agent={agent} workingSince={workingSince} approval={approval} root={root} openDiff={onOpenDiff} goToStep={goToStep} waitingStep={waitingStep} editFromHere={editAction} />
      return row.key === found ? <div className="mx-chat-found" data-found="true">{item}</div> : item
    },
    [agent, workingSince, approval, root, onOpenDiff, goToStep, found, waitingStep, editAction],
  )

  // y, a and n answer the tray from anywhere in the chat but a field with text in it, as the same letters do in the terminal.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const inField = typedInField(event.target)
    if (inField && !inEmptyBox(event.target)) return
    // A question's number picks its choice, as it does in the agent's own menu.
    const choice = inField ? Number.NaN : Number(event.key) - 1
    // A plan is answered from Claude's own menu as the screen shows it, never a guessed key (see PlanTray).
    if (ask?.tool === PLAN_TOOL) {
      const menu = sendKeys === undefined ? [] : planMenuChoices(asking)
      if (!stoppedOnPrompt || !online || sendKeys === undefined || menu.length === 0) return
      if (Number.isInteger(choice) && choice >= 0 && choice < menu.length) {
        event.preventDefault()
        void sendKeys(String(choice + 1))
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void sendKeys(ANSWER_KEYS.deny)
      }
      return
    }
    // A menu with no hook behind it: its number picks, never while typing (the check above) so the box keeps its digits.
    if (ask === null && stoppedOnPrompt && online && sendKeys !== undefined) {
      const menu = parseChoiceMenu(asking)
      if (menu !== null && Number.isInteger(choice) && choice >= 0 && choice < menu.options.length) {
        event.preventDefault()
        void typeEach(sendKeys)(keysToPick(menu, choice))
        return
      }
    }
    const choices = ask?.choices ?? []
    if (stoppedOnPrompt && online && pickChoice !== undefined && formQuestions(ask).length === 0 && Number.isInteger(choice) && choice >= 0 && choice < choices.length) {
      event.preventDefault()
      void pickChoice(choice)
      return
    }
    const decision = KEY_DECISION[event.key.toLowerCase()]
    if (decision === undefined) return
    if (pending !== null && approval !== null && !approval.busy && pending.approvalKind !== 'UserInput' && pending.choices.includes(decision)) {
      event.preventDefault()
      answer(pending.requestId, decision)
    } else if (stoppedOnPrompt && answerPrompt !== undefined && ask?.answerable === true && decision !== 'AcceptForSession') {
      event.preventDefault()
      void answerPrompt(decision === 'Accept' ? 'approve' : 'deny')
    }
  }

  // The pane hands a new function on every render; the rows are given one that stays the same, so they are not drawn again for it.
  const openFileRef = useRef(onOpenFile)
  useEffect(() => { openFileRef.current = onOpenFile }, [onOpenFile])
  const canOpenFile = onOpenFile !== null
  const openFile = useMemo<OpenFile | null>(() => (canOpenFile ? (path, line) => { openFileRef.current?.(path, line) } : null), [canOpenFile])

  // The menu's keys would answer a question or land in a turn, so it goes when the agent asks or works.
  if (menuOpen && (stoppedOnPrompt || working)) setMenuOpen(false)
  // Keyed by the question: a new one starts with nothing typed, and its answers sized for its own questions.
  const askKey = `${ask?.tool ?? ''}:${ask?.detail ?? ''}:${JSON.stringify(ask?.questions ?? ask?.choices ?? [])}`
  const question = pending !== null
    ? <ApprovalTray key={pending.requestId} event={pending} actions={approval} agent={agent} />
    : helperAsk !== undefined ? <HelpersTray ask={helperAsk} online={online} agent={agent} />
    : menuOpen && sendKeys !== undefined && online ? <CommandMenuTray agent="Codex" topic="model" readScreen={readScreen} sendKeys={sendKeys} onClose={() => { setMenuOpen(false) }} />
    : stoppedOnPrompt ? <PromptTray key={askKey} agent={agent} ask={ask} online={online} answer={answerPrompt} pick={pickChoice} pickAll={pickChoices} answerOwn={answerOwn} sendKeys={sendKeys} readScreen={readScreen} plan={plan} asking={asking} />
    : replying !== null && !replyRowGone
      ? (
        <ReplyTray
          key={`${replying.row}:${String(replying.nonce)}`}
          who={replying.who}
          asked={replying.asked}
          focus={replying.focus}
          message={replying.row}
          blocked={composer.disabledReason}
          onSend={sendReplies}
          onClose={() => { setReplying(null) }}
        />
      )
      : null
  const shieldDanger = shownMode !== null && DANGER_MODES.includes(shownMode)
  // A bypassed chat always shows it (ADR 0005). The message box's red shield says it where it shows the mode; the tag is
  // for a chat whose shield does not, so the same thing is not flagged twice on nearly every chat.
  const bypassTag = fullAccess && !shieldDanger
  const problemView = useChatProblem(problem, () => summaryOf(bareRows))
  // The chat's own read: while it reconnects, or when it failed, one line in the dock says so, under any real problem.
  // A lost service is the window's news, said once by its bar (lib/toast.ts), so the chat speaks only while the service is up.
  const readLine = offline && online
    ? <ProblemLine tone="working" running title="Reconnecting to this chat…" reason={`What is shown may be out of date.${readError !== null ? ` ${truncateError(readError)}` : ''}`} />
    : feed.error !== null ? <ProblemLine tone="error" title="Could not read this chat" reason={feed.error} /> : null
  const dockProblem = problemView.line ?? readLine

  return (
    <FilesHereContext.Provider value={sessionId === undefined || machineNameOf(sessionId) === null}>
    <div ref={chat} className="mx-chat" onKeyDown={onKeyDown} onClick={keepComposerFocus} onMouseUp={(event) => { const next = pickedText(event); if (next !== undefined) setPicked(next) }}>
      {confirming !== null && <ConfirmCloseDialog title={confirming.ask.title} body={confirming.ask.body} confirmLabel={confirming.ask.confirmLabel} onConfirm={() => { const { typed, then } = confirming; setConfirming(null); if (then === undefined) runConfirmed(typed); else then() }} onCancel={() => { setConfirming(null) }} firstFocus="cancel" />}
      {editFromHere.ask !== null && <ConfirmCloseDialog title="Restore the files and edit this message?" body={editFromHere.ask.body} confirmLabel={editFromHere.ask.confirmLabel} onConfirm={editFromHere.confirm} onCancel={editFromHere.cancel} firstFocus="cancel" />}
      {picked !== null && <SelectionBar picked={picked} onCopy={copyPicked} onQuote={composer.draftable ? quotePicked : undefined} />}
      {bypassTag && (
        <div className="mx-chat-notices">
          <span className="mx-chat-tag is-danger" title="No sandbox and no approval prompts. End the session and start a new one to change this.">Bypass permissions</span>
        </div>
      )}
      {/* Politely announces a change of state only; the log itself is not a live region, so streaming text never floods a screen reader. */}
      <div role="status" aria-live="polite" className="sr-only">{announcement(feed, agent, working)}</div>
      <div role="status" aria-live="polite" className="sr-only">{quoteNote}</div>
      {subagent !== null ? (
        <>
          <SubagentBar subagent={subagent} onBack={() => { onBackToMain?.() }} />
          <SubagentChat subagent={subagent} agent={agent} root={root} term={sessionId !== undefined && machineNameOf(sessionId) === null ? terminalOf(sessionId) : null} />
        </>
      ) : feed.loaded && rows.length === 0 ? (
        // The design's empty chat is blank: the box below is the invitation. A screen reader still hears that there is nothing yet.
        <div className="mx-chat-empty"><span className="sr-only">No messages yet.</span></div>
      ) : feed.loaded || rows.length > 0 ? (
        // A message held from the starting chat is a row before the history is read, so it stays where it was and no skeleton replaces it.
        <KnownRowsContext.Provider value={known}>
          <OpenFileContext.Provider value={openFile}>
          <HelpersLiveContext.Provider value={helpersLive}>
          <ChatActionsContext.Provider value={actions}>
          <RevealContext.Provider value={reveal}>
          <VirtualList items={rows} getKey={rowKey} estimate={ESTIMATED_ROW_PX} renderItem={renderRow} label={`Conversation with ${agentLabel(agent)}`} scrollTarget={scrollTarget} toLatest={sentCount} isSent={isSentRow} />
          </RevealContext.Provider>
          </ChatActionsContext.Provider>
          </HelpersLiveContext.Provider>
          </OpenFileContext.Provider>
        </KnownRowsContext.Provider>
      ) : (
        <ChatSkeleton />
      )}
      {signInView !== null && <SignInCard view={signInView} onCancel={() => { signIn.cancel(signInView.agent) }} onClose={signIn.close} onRetry={() => { signIn.begin(signInView.agent) }} />}
      {aside.aside !== null && <OpenFileContext.Provider value={openFile}><AsideCard aside={aside.aside} onClose={aside.close} onAskInConversation={(question) => { aside.close(); void sendText(question) }} /></OpenFileContext.Provider>}
      <Composer
        agent={agent}
        composer={composer}
        conversation={link.conversation}
        // The agent says which commands it takes, in its folder on its machine; Codex's own are a list the window keeps. Gemini has none yet,
        // and a chat over ACP offers none: the lists and the window's own answers are read from the agent's terminal program.
        {...(link.acp !== true && abilities.slashCommands !== null && root !== null && commandsMachine !== null ? { commandsFrom: { agent, folder: root, machine: commandsMachine, inTerminal: runInTerminal, inWindow: runInWindow } } : {})}
        problem={dockProblem}
        question={question}
        helpers={dockedHelpers.length > 0 ? <HelpersDock helpers={dockedHelpers} open={dock.open === 'helpers'} onOpenChange={(open) => { setDockOpen(open ? 'helpers' : null) }} /> : null}
        dock={dock}
        queueNote={queueNote}
        waiting={held !== null}
        files={fileSearch}
        facts={{ ...(usage === undefined ? {} : { usage }), ...(windowActions === undefined ? {} : { onOpenUsage: () => { windowActions.openSettings('usage') } }), mode: modeLabel(shownMode), modeDanger: shieldDanger, model: shownModel, effort: shownEffort, modeKey: shownMode, bypassAllowed: startedBypassed(sessionId), ...(link.acp === true ? { ownSettings: true } : {}), ...agentControls, ...(applyNow === undefined ? {} : { onPickMode: pickHeld }) }}
        sent={sentMessages}
        place={place}
        ended={ended}
      />
      {problemView.alert}
    </div>
    </FilesHereContext.Provider>
  )
}
