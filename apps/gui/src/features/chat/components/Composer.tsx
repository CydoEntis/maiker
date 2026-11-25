import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { recallStep, type Recalled } from '../promptRecall'
import { toast } from '@/lib/toast'
import { ProblemLine } from '@/components/ui/feedback'
import { pasteFromHost, pickFromClipboard, unsupportedMessage } from '@/features/terminal/clipboardImage'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { abilitiesOf, runsMidTurn } from '@/features/workspace/model/agentAbilities'
import { AppIcon, Icon } from '@/features/workspace/components/glyphs'
import { registerComposerDrop } from '../composerDrop'
import { clearQuotes, removeQuote, updateComposer, useComposerDraft, useComposerSlice } from '../composerStore'
import type { ChatComposer } from '../useChatComposer'
import { defaultChoice, useAgentChoice, type AgentChoice } from '../agentChoice'
import { rememberChoice } from '@/features/workspace/model/lastWho'
import { DraftAttachments } from './Attachments'
import { QuoteStrip } from './QuoteStubs'
import { AgentPicker, type OtherAgents } from './AgentPicker'
import { modelName } from '../modelName'
import { PLAN_MODE } from '../chatMeta'
import { permissionWords, placeChipsShown, workingLock } from '../boxRow'
import { usePlaceActions } from '../place/placeActions'
import { PermissionMenu } from './PermissionMenu'
import { SessionBar, type SessionPlace } from './SessionBar'
import { QueuedMessages } from './QueuedMessages'
import { MAX_SHOWN, SlashPicker } from './SlashPicker'
import { FilePicker } from './FilePicker'
import { useFileMention } from '../useFileMention'
import type { FileSearchPlace } from '../fileMention'
import { asSkills, commandText, matchCommands, skillQuery, slashQuery, useSlashCommands, withTerminalCommands, type SlashCommand } from '../slashCommands'
import { CLAUDE_HIDDEN_COMMANDS, CLAUDE_TERMINAL_COMMANDS } from '../terminalCommands'
import { terminalOnlyNote, typedCommand, windowRouteOf, withWindowRoutes, type WindowRoute } from '../windowCommands'
import { CODEX_COMMANDS } from '../codexCommands'
import { GEMINI_COMMANDS, geminiRouteOf, withGeminiRoutes } from '../geminiCommands'
import { isBangLine, namedCommand } from '../slashCommands'
import { usageItems, type SessionUsage } from '../usageStrip'
import { UsageMeter } from '@/features/usage/UsageMeter'
import { nowSeconds, useInstalledAgents } from '@/features/workspace/model/newChatHost'
import { IconButton } from '@/components/ui/icon-button'
import { useKeepTyping } from '../useKeepTyping'
import { agentLabel } from '@/features/workspace/model/session'
import { keysAreNowhere } from '@/lib/focus'

/** A key with nothing stored under it, for a composer whose view holds its own draft. */
const NO_CONVERSATION = -1

/** What the chat box's row says about the session: its model, permission mode and context. */
export type ComposerFacts = {
  /** What the session's agent reported using; the context bar shows how full its context is, and is not drawn when it has not said. */
  usage?: SessionUsage | undefined
  /** Opens Usage & cost, from a click on the context bar; without it the bar is only read. */
  onOpenUsage?: (() => void) | undefined
  /** The permission mode in words, from the agent's own file; null when it has not said. */
  mode: string | null
  /** The mode asks about nothing, so it is drawn in the danger colour. */
  modeDanger: boolean
  /** The model the agent's own file says it uses; null when it has not said. */
  model: string | null
  /** The agent runs over ACP: its model and permissions are its own settings, so the box names the agent and offers neither. */
  ownSettings?: boolean | undefined
  /** The effort the agent's own files say it runs at, when they do. */
  effort?: string | null | undefined
  /** For a chat that follows the agent's terminal and can type into it: send the agent one of its own commands (`/model x`). */
  onCommand?: ((text: string) => void) | undefined
  /** For a chat whose agent has a model menu only its terminal draws (Codex): opens that menu here. Absent where the model is only said. */
  onOpenModelMenu?: (() => void) | undefined
  /** Why the model menu cannot open right now. */
  modelMenuLocked?: string | null | undefined
  /** The same, for the permission mode: moves the agent to the picked mode (by its Shift+Tab). */
  onPickMode?: ((mode: string) => void) | undefined
  /** The modes the dropdown offers and whose they are; Claude's when not given. */
  modes?: readonly string[] | undefined
  modeAgent?: string | undefined
  /** Why the mode cannot be picked yet, for a chat that will offer it: the button is drawn now, greyed, so it does not change shape later. */
  modeLocked?: string | undefined
  /** The mode as the agent's file or screen wrote it, to tick it in the dropdown. */
  modeKey?: string | null | undefined
  /** Bypass permissions can be picked: this session started with Claude allowing it. */
  bypassAllowed?: boolean | undefined
  /**
   * Set for an agent whose model and mode can be changed (Claude): both chips are always drawn, and when they cannot be used right
   * now (the agent is starting or working) they stay where they are, greyed out with `locked` as the reason, so the box never
   * rearranges. `start` is what a chat with no conversation yet was started with.
   */
  agentChips?: {
    readonly locked: string | null
    /** Why the model and effort cannot be picked, when that differs from `locked`: a pick made while the agent works is held for the turn's end, so only the mode waits. */
    readonly pickerLocked?: string | null
    readonly start?: AgentChoice
    /** The chat runs on another machine: this computer's model list says nothing of what it has. */
    readonly remote?: boolean
    /** Given by a draft (a session not started), whose picks are kept for its start: the picker changes the choice and the agent. */
    readonly onChange?: (change: Partial<AgentChoice>) => void
    readonly onAgent?: (agent: ChatAgent) => void
    /** The agent programs on the draft's machine, for the picker's rail; null while unknown. */
    readonly installed?: readonly string[] | null
    /** The agents a draft can start over ACP instead, offered on the picker's rail. */
    readonly others?: OtherAgents | undefined
  } | undefined
}

type Props = {
  agent: ChatAgent
  composer: ChatComposer
  /** The chat's conversation number; with it the composer offers the agent, model and reasoning picker. */
  conversation?: number
  /** Whose slash commands the box offers as a slash is typed, and the folder they are the commands of; absent for an agent with none to list. */
  commandsFrom?: {
    readonly agent: string
    readonly folder: string
    /** The machine the agent runs on, whose commands and skills these are; this computer when left out. */
    readonly machine?: number | undefined
    /** For an agent with a terminal: types a command there and shows it. With it the box also offers the commands only the terminal runs. */
    readonly inTerminal?: ((command: string) => void) | undefined
    /** Answers the commands the window runs itself (`windowCommands.ts`) with the route and the text as typed. Without it they go to the agent. */
    readonly inWindow?: ((route: WindowRoute, typed: string) => void) | undefined
  } | undefined
  /** The chat's one problem line (`ProblemLine`): above everything else in the dock. Null when the chat has none. */
  problem?: ReactNode
  /** The question tray: what the agent asks, slid up from behind the box. Null when it asks nothing. */
  question?: ReactNode
  facts: ComposerFacts
  /** A message went in and the agent has not taken it up yet: the send button shows it is working and sends nothing more. */
  waiting?: boolean
  /** Where an `@` looks for files; absent where the daemon cannot be asked (another machine, no pane). */
  files?: FileSearchPlace | undefined
  /** The messages the person sent in this chat, oldest first, for ↑ to bring back (`promptRecall.ts`). */
  sent?: readonly string[]
  /** The helpers line (`HelpersDock`), drawn between the question tray and the queue. */
  helpers?: ReactNode
  /** Which part of the dock is open: only one is, so opening one folds the other. */
  dock?: DockState
  /** A quiet line under the queue, for a session that stopped or failed with messages still waiting. */
  queueNote?: string | null
  /** Where the session runs, for the chips under the box while it has run nothing (`placeChipsShown`). */
  place?: SessionPlace | undefined
  /** The session has run something: its place is fixed, so the chips under the box are gone. A draft has run nothing. */
  ran?: boolean
  /** Set once the session has ended: the box gives way to a read-only line with these ways on. */
  ended?: EndedActions | undefined
  /** What the empty box says; a draft asks for the task, a started chat for a message. */
  hint?: string | undefined
}

/** What an ended session offers in place of the box. */
export type EndedActions = {
  /** Reopens the conversation; absent when it cannot be reopened from here, with `resumeWhy` saying why. */
  onResume?: (() => void) | undefined
  resumeWhy?: string | undefined
  /** Starts a new session in the same folder. */
  onNewSession: () => void
}

/** The dock above the box has one thing open at a time: the helpers list or the queue's list. */
export type DockOpen = 'helpers' | 'queue' | null
export type DockState = { readonly open: DockOpen; readonly set: (open: DockOpen) => void }
const DOCK_CLOSED: DockState = { open: null, set: () => undefined }

const NO_CHANGE = () => undefined
const NO_MESSAGES: readonly string[] = []

/** What in the question tray takes the focus when it opens: its first field, else its first button. */
// Only a question that takes keys gets the focus: a card answered only by a click (trusting a folder) must not be
// answered by a stray Enter meant for the box.
const TRAY_FIRST_CONTROL = '[aria-keyshortcuts]:not([disabled])'

/**
 * The chat box (handoff 5): the needs-you cards when the agent asks, then one box: the text, and one compact row under
 * it with the agent's mark, model and reasoning level, the permission shield and the context bar at the left, and
 * attach and send at the right. A session that has run nothing has the folder, branch and sync chips under the box,
 * with the context bar at their right. Enter sends, Shift+Enter
 * adds a line, Esc interrupts the running turn. While the agent works, sending queues the message;
 * while a request waits for an answer the box is off and says why, and the request has the focus; while the daemon is
 * offline the box still takes typing but does not send.
 */
export function Composer({ agent, composer, conversation, commandsFrom, problem = null, question = null, facts, waiting = false, files, sent = NO_MESSAGES, helpers = null, dock = DOCK_CLOSED, queueNote = null, place, ran = true, ended, hint = 'Reply…' }: Props) {
  const { setDraft, attachments, attach, readOnly, queue, removeQueued, editQueued, moveQueuedUp, clearQueued, sendQueuedNow, sendingNow, submit, stop, running, sending, disabledReason, draftable, error } = composer
  const storedDraft = useComposerDraft(composer.conversationKey ?? NO_CONVERSATION)
  const restoreNote = useComposerSlice(composer.conversationKey ?? NO_CONVERSATION, (state) => state.note)
  const draft = composer.draft ?? storedDraft
  const quotes = useComposerSlice(composer.conversationKey ?? NO_CONVERSATION, (state) => state.quotes)
  const off = disabledReason !== null
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  // The sent message ↑ put in the box, while it is still there unedited.
  const recalled = useRef<Recalled | null>(null)
  useKeepTyping(text, attachments.length)
  // A chat that opens takes the typing, as the terminal under it would, when nothing else on the page has it:
  // the New session draft has just closed, or the starting chat's box was replaced by this one.
  useEffect(() => {
    if (!keysAreNowhere()) return
    const pane = text.current?.closest('.mx-pane')
    if (pane?.classList.contains('is-card') === true && !pane.classList.contains('is-focused')) return
    text.current?.focus({ preventScroll: true })
  }, [])
  // A question the agent asks takes the typing from the box: the first control of the card nearest the box has the
  // focus, so y / a / n (or Enter) answer it at once instead of going nowhere. Once it is answered the box has it back.
  // Only when the typing was in this chat's box, or nowhere (the box going off dropped it), never from another pane,
  // and never out of a box that holds a reply being typed: its next letters would answer the card.
  const tray = useRef<HTMLDivElement>(null)
  const asking = question !== null
  useEffect(() => {
    const active = document.activeElement
    const nowhere = keysAreNowhere(active)
    const ours = nowhere || active === text.current || (tray.current?.contains(active) ?? false)
    if (!ours) return
    if (active instanceof HTMLTextAreaElement && active === text.current && !active.disabled && active.value !== '') return
    if (asking) (tray.current?.lastElementChild ?? tray.current)?.querySelector<HTMLElement>(TRAY_FIRST_CONTROL)?.focus({ preventScroll: true })
    else if (nowhere) text.current?.focus({ preventScroll: true })
  }, [asking])
  // The desktop shell takes file drops for itself, so the composer asks to be told of the ones that land on it.
  const { addPaths } = attach
  useEffect(() => {
    const element = box.current
    return element === null ? undefined : registerComposerDrop(element, addPaths)
  }, [addPaths])

  // Text first, as in the terminal: a clipboard with any text pastes the text; only a bare image is attached.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pick = pickFromClipboard(event.clipboardData)
    if (pick.kind === 'none') pasteFromHost(attach.addImage)
    if (pick.kind === 'text' || pick.kind === 'none') return
    event.preventDefault()
    if (pick.kind === 'image') attach.addImage(pick.image)
    else toast.error(unsupportedMessage(pick.type))
  }
  const attachLabel = off ? `Attach files: ${disabledReason}` : 'Attach files'
  const planning = facts.modeKey === PLAN_MODE
  const placeholder = disabledReason ?? (running ? `Queue a message for when ${agentLabel(agent)} finishes` : planning ? 'Reply to the plan…' : hint)
  const empty = draft.trim() === '' && attachments.length === 0
  // With nothing typed while a turn runs, the round button stops the agent instead of sending.
  const stopping = running && empty && !off
  const busy = sending || waiting
  const chips = placeChipsShown(place, ran)
  // The context bar sits in the box's row; with the chips out it moves to the right end of their row, where there is room.
  const context = ended === undefined && facts.usage !== undefined ? <ContextBar usage={facts.usage} agent={agent} onOpen={facts.onOpenUsage} /> : null
  const actions = usePlaceActions()
  const folder = place?.folder ?? ''
  // A running session's agent cannot change, so another agent's model opens a draft for it in the same folder.
  const startWith = place === undefined || place.picking !== undefined || folder === '' ? undefined : (other: ChatAgent) => { actions.onNewSessionIn(folder, other) }

  // The agent's commands, offered while a slash and a name are typed. Esc puts the list away until the text changes.
  // Codex's own box names a skill after a `$`, so that opens the list too, with only its skills.
  const commands = abilitiesOf(commandsFrom?.agent).slashCommands
  const naming = off || commands?.skillsAfterDollar !== true ? null : skillQuery(draft)
  const query = off || commandsFrom === undefined ? null : slashQuery(draft) ?? naming
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const picking = query !== null && closedFor !== draft
  const slash = useSlashCommands(commandsFrom ?? null, picking)
  const inTerminal = commandsFrom?.inTerminal
  const inWindow = commandsFrom?.inWindow
  // Claude's are its own list plus the ones only its terminal runs; Codex's are the window's list and the skills
  // Codex itself lists. The terminal's commands are offered only to an agent that has a terminal to run them in.
  const skillsOnly = naming !== null
  const windowList = commands?.list === 'window'
  const offered = useMemo(() => {
    if (windowList) {
      const skills = asSkills(slash.commands)
      if (skillsOnly) return skills
      const own = agent === 'gemini' ? withGeminiRoutes(GEMINI_COMMANDS) : inWindow === undefined ? CODEX_COMMANDS : withWindowRoutes(CODEX_COMMANDS, 'codex')
      return [...(inTerminal === undefined ? own.filter((command) => command.terminal !== true) : own), ...skills]
    }
    const listed = withTerminalCommands(slash.commands, CLAUDE_TERMINAL_COMMANDS, CLAUDE_HIDDEN_COMMANDS)
    const own = inWindow === undefined ? listed : withWindowRoutes(listed)
    return inTerminal === undefined ? own.filter((command) => command.terminal !== true) : own
  }, [slash.commands, inTerminal, inWindow, windowList, skillsOnly, agent])
  const matches = useMemo(() => (query === null ? [] : matchCommands(offered, query)), [offered, query])
  // The keys start at the closest match each time the typed name changes.
  const [cursor, setCursor] = useState({ query: '', index: 0 })
  const active = cursor.query === query ? Math.min(cursor.index, Math.max(0, Math.min(matches.length, MAX_SHOWN) - 1)) : 0
  const complete = (command: SlashCommand) => {
    setDraft(commandText(command))
    text.current?.focus()
  }
  // A command the window answers itself (`windowCommands.ts`): `/help` lists every command here and `/btw` alone waits
  // for its question, the rest go to the session's chat. One that ends or empties the session is refused while the
  // agent works, as the terminal's are; a side answer may go then, as it leaves the conversation alone.
  const routeOf = (typed: string): WindowRoute | null => {
    // Each agent's routes are by its own names for its commands.
    if (inWindow === undefined || attachments.length > 0) return null
    const parts = typedCommand(typed)
    if (parts === null) return null
    if (agent === 'gemini') return geminiRouteOf(parts.name, parts.args)
    const route = windowRouteOf(parts.name, parts.args, agent)
    // Only Claude's list names the commands that have no use without a terminal (Codex's are sent as typed).
    if (route !== null || inTerminal !== undefined || agent !== 'claude') return route
    // With no terminal, a command only the terminal runs gets a card saying so instead of going nowhere.
    const terminalOnly = namedCommand(CLAUDE_TERMINAL_COMMANDS, typed)
    return terminalOnly === undefined ? null : terminalOnlyNote(terminalOnly.name)
  }
  const inWindowRun = (route: WindowRoute, typed: string) => {
    if (route.kind === 'commands' || route.kind === 'complete') {
      setDraft(route.kind === 'commands' ? '/' : route.text)
      text.current?.focus()
      return
    }
    if (route.kind === 'confirm' && running) {
      toast.info(`${agentLabel(agent)} is working. Run ${typed} when it finishes.`)
      return
    }
    setDraft('')
    inWindow?.(route, typed)
  }
  // A command that takes nothing runs at once, as it does in the terminal; one that takes something waits for it.
  const run = (command: SlashCommand) => {
    const route = routeOf(`/${command.name}`)
    if (route !== null) {
      inWindowRun(route, `/${command.name}`)
      return
    }
    // A skill is named in a message, never run by itself.
    if (command.hint !== '' || command.skill === true) {
      complete(command)
      return
    }
    if (command.terminal === true && inTerminal !== undefined) {
      // Its menu is the terminal's to show, and its keys would land in a running turn.
      if (running) {
        toast.info(`${agentLabel(agent)} is working. Run /${command.name} when it finishes.`)
        return
      }
      setDraft('')
      inTerminal(`/${command.name}`)
      return
    }
    setDraft(`/${command.name}`)
    submit()
    text.current?.focus()
  }
  // A command only the terminal runs, typed out with what it takes ("/btw which file is that?"), goes there too: the
  // agent draws its answer in the terminal and never writes it to the conversation, so the chat would wait for it forever.
  const send = () => {
    const typed = draft.trim()
    // With quotes it is a message to the agent, whatever its first word.
    if (quotes.length > 0) {
      submit()
      return
    }
    const route = routeOf(typed)
    if (route !== null) {
      inWindowRun(route, typed)
      return
    }
    const command = inTerminal === undefined || attachments.length > 0 ? undefined : namedCommand(offered, typed)
    if (command?.terminal !== true || inTerminal === undefined) {
      submit()
      return
    }
    if (running && !runsMidTurn(commandsFrom?.agent, typed)) {
      toast.info(`${agentLabel(agent)} is working. Run /${command.name} when it finishes.`)
      return
    }
    setDraft('')
    inTerminal(typed)
  }
  // The @ picker follows the caret: it is open only while the caret sits, with nothing selected, at the end of the text.
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  const followCaret = (area: HTMLTextAreaElement) => { setCaretAtEnd(area.selectionStart === area.selectionEnd && area.selectionEnd === area.value.length) }
  const mention = useFileMention(off ? null : files ?? null, draft, caretAtEnd, setDraft, () => { text.current?.focus() })
  const pickerKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (mention.onKey(event)) return true
    if (!picking) return false
    if (event.key === 'Escape') {
      setClosedFor(draft)
      return true
    }
    const chosen = matches[active]
    if (chosen === undefined) return false
    const shown = Math.min(matches.length, MAX_SHOWN)
    if (event.key === 'ArrowDown') setCursor({ query, index: (active + 1) % shown })
    else if (event.key === 'ArrowUp') setCursor({ query, index: (active + shown - 1) % shown })
    else if (event.key === 'Tab' && !event.shiftKey) complete(chosen)
    else if (event.key === 'Enter' && !event.shiftKey) run(chosen)
    else return false
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an input method is composing text confirms the text; it is not a send.
    if (event.nativeEvent.isComposing) return
    if (pickerKey(event)) {
      event.preventDefault()
      return
    }
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const area = event.currentTarget
      const step = area.selectionStart === area.selectionEnd ? recallStep(sent, draft, recalled.current, area.selectionStart, event.key === 'ArrowUp' ? 'older' : 'newer') : null
      if (step !== null) {
        event.preventDefault()
        recalled.current = step.recalled
        setDraft(step.draft)
        // The caret goes to the end, as in a shell, once React has put the text in.
        window.requestAnimationFrame(() => { area.setSelectionRange(area.value.length, area.value.length) })
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      recalled.current = null
      send()
    } else if (event.key === 'Escape' && running) {
      event.preventDefault()
      stop()
    }
  }

  return (
    <div ref={box} className="mx-composer">
      <div className="mx-composer-column">
        {/* One line above the box: the chat's own problem first, since a send it refuses fails for that reason. */}
        {problem ?? (error !== null && <ProblemLine tone="error" urgent title="Your message did not send" reason={`${error}. It is still in the box; send it again to retry.`} />)}
        <div ref={tray} className="mx-question-slot">{question}</div>
        {helpers}
        <QueuedMessages
          agent={agent}
          queue={queue}
          open={dock.open === 'queue'}
          onOpenChange={(open) => { dock.set(open ? 'queue' : null) }}
          onRead={() => { if (dock.open === 'helpers') dock.set(null) }}
          helpersOpen={dock.open === 'helpers'}
          onRemove={removeQueued}
          onEdit={(id) => { editQueued(id); text.current?.focus() }}
          onSendNow={sendQueuedNow}
          steers={composer.sendNowSteers}
          onMoveUp={moveQueuedUp}
          onClear={clearQueued}
          sendingNow={sendingNow}
          note={queueNote}
        />
        <QuoteStrip quotes={quotes} onRemove={(id) => { removeQuote(composer.conversationKey ?? NO_CONVERSATION, id) }} onClear={() => { clearQuotes(composer.conversationKey ?? NO_CONVERSATION) }} />
        <div className={`mx-box${off ? ' is-locked' : ''}${ended === undefined ? '' : ' is-ended'}`}>
          {picking && (
            <SlashPicker agent={agent} typed={draft.trim()} matches={matches} active={active} loading={slash.loading} error={slash.error} onPick={run} onHover={(index) => { setCursor({ query, index }) }} />
          )}
          {mention.open && (
            <FilePicker found={mention.found} active={mention.active} onPick={mention.pick} onHover={mention.hover} />
          )}
          <DraftAttachments attachments={attachments} onRemove={attach.remove} />
          <textarea
            ref={text}
            aria-label={`Message ${agentLabel(agent)}`}
            {...(picking && matches.length > 0 ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-slash-list', 'aria-activedescendant': `mx-slash-${String(active)}` } : {})}
            {...(mention.open && (mention.found?.paths.length ?? 0) > 0 ? { role: 'combobox', 'aria-expanded': true, 'aria-controls': 'mx-file-list', 'aria-activedescendant': `mx-file-${String(mention.active)}` } : {})}
            rows={2}
            value={draft}
            disabled={!draftable}
            placeholder={placeholder}
            className="mx-box-text"
            onChange={(event) => { setDraft(event.target.value); followCaret(event.target) }}
            onSelect={(event) => { followCaret(event.currentTarget) }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {planning && (
            <p className="mx-plan-strip">
              <span className="mx-plan-strip-name">Plan mode</span>
              <span>Reads and plans. Changes nothing until you approve.</span>
            </p>
          )}
          <div className="mx-box-row">
            <div className="mx-box-controls" role="group" aria-label="Model and permissions">
              <AgentControls agent={agent} conversation={conversation} facts={facts} readOnly={readOnly} lockedWhileWorking={workingLock(agent, running)} onStartWith={startWith} />
            </div>
            {!chips && context}
            <span className="mx-spacer" />
            {(composer.attachable ?? !readOnly) && (
              // aria-disabled, not disabled: a disabled button gets no focus or tooltip, and the reason is the point.
              <IconButton label={attachLabel} aria-disabled={off} className="mx-box-attach" onClick={() => { if (!off) attach.pick() }}><Icon name="paperclip" /></IconButton>
            )}
            {stopping ? (
              <button type="button" className="mx-send is-stop" aria-label={`Stop ${agentLabel(agent)}`} title={`${agentLabel(agent)} is working. Stop it (Esc)`} onClick={stop}><span className="mx-stop-square" aria-hidden="true" /></button>
            ) : busy ? (
              // Sent, and not yet a turn to stop: the same square, off until there is one.
              <button type="button" className="mx-send is-stop is-off is-busy" aria-label={`${agentLabel(agent)} is working`} aria-busy="true" title={`${agentLabel(agent)} is working`} disabled><span className="mx-stop-square" aria-hidden="true" /></button>
            ) : (
              <button type="button" className={`mx-send${off || empty ? ' is-off' : ''}`} aria-label={running ? 'Queue message' : 'Send message'} disabled={off || sending || empty} onClick={send}>
                <Icon name="arrowUp" size={14} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        {ended !== undefined && <EndedLine ended={ended} />}
        {chips && <SessionBar place={place}>{context}</SessionBar>}
        {readOnly && abilitiesOf(agent).bangToTerminal && isBangLine(draft) && <p className="mx-composer-note">Runs in the terminal, not as a message. Anything it asks can only be answered there.</p>}
        {restoreNote !== null && composer.conversationKey !== undefined && (
          <p className="mx-composer-note">
            Your next message starts with a line telling {agentLabel(agent)} the files were restored.{' '}
            <button type="button" className="mx-composer-note-action" onClick={() => { updateComposer(composer.conversationKey ?? NO_CONVERSATION, (state) => ({ ...state, note: null })) }}>Leave it out</button>
          </p>
        )}
      </div>
    </div>
  )
}

/** The read-only line an ended session shows where the box was, with the two ways on. */
function EndedLine({ ended }: { ended: EndedActions }) {
  const resumable = ended.onResume !== undefined
  return (
    <div className="mx-ended-line" role="status">
      <span className="mx-ended-text">This session has ended. The chat is read-only.</span>
      {/* aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point. */}
      <button type="button" className="mx-ended-button is-primary" aria-disabled={!resumable} title={resumable ? 'Open this conversation again' : ended.resumeWhy} onClick={resumable ? ended.onResume : undefined}>Resume</button>
      <button type="button" className="mx-ended-button" onClick={ended.onNewSession}>New session here</button>
    </div>
  )
}

/**
 * The left of the chat box's row: the agent's mark with its model and reasoning level (it opens the picker), a hairline,
 * then the permission shield. The model and reasoning level lock while the agent works; `lockedWhileWorking` says why.
 */
function AgentControls({ agent, conversation, facts, readOnly, lockedWhileWorking, onStartWith }: { agent: ChatAgent; conversation: number | undefined; facts: ComposerFacts; readOnly: boolean; lockedWhileWorking: string | null; onStartWith: ((agent: ChatAgent) => void) | undefined }) {
  const { agentChips } = facts
  const live = readOnly ? facts.onCommand : undefined
  if (facts.ownSettings === true) {
    return (
      <span className="mx-row-button mx-model-button is-static" title={`${agentLabel(agent)} uses the model and permissions from its own settings.`}>
        <span className="mx-model-icon"><AppIcon process={agent} size={14} /></span>
        <span className="mx-model-line">{agentLabel(agent)}</span>
      </span>
    )
  }
  return (
    <>
      {agentChips !== undefined ? (
        conversation !== undefined
          ? <ModelPicker remote={agentChips.remote === true} agent={agent} conversation={conversation} model={facts.model} effort={facts.effort ?? null} live={live} locked={(agentChips.pickerLocked === undefined ? agentChips.locked : agentChips.pickerLocked) ?? lockedWhileWorking} onStartWith={onStartWith} />
          : <AgentPicker fixedModels={agentChips.remote === true} agent={agent} choice={agentChips.start ?? defaultChoice()} onChange={agentChips.onChange ?? NO_CHANGE} {...(agentChips.onAgent === undefined ? {} : { onAgent: agentChips.onAgent })} installed={agentChips.installed ?? null} others={agentChips.others} locked={agentChips.locked ?? undefined} />
      ) : (
        <>
          {conversation !== undefined && (!readOnly || facts.onCommand !== undefined) && <ModelPicker remote={false} agent={agent} conversation={conversation} model={facts.model} effort={facts.effort ?? null} live={live} locked={lockedWhileWorking} onStartWith={onStartWith} />}
          {readOnly && facts.onCommand === undefined && <ModelLabel agent={agent} model={facts.model} onOpenMenu={facts.onOpenModelMenu} locked={facts.modelMenuLocked ?? null} />}
        </>
      )}
      <span className="mx-row-rule" aria-hidden="true" />
      <ModeControl agent={agent} facts={facts} />
    </>
  )
}

function modeLockedWhy(facts: Pick<ComposerFacts, 'modeLocked' | 'agentChips'>): string {
  return facts.modeLocked ?? facts.agentChips?.locked ?? 'Not available for this chat'
}

/**
 * How full the session's context is: a bar and the figure. An agent that reports its context (the chat agents) has it
 * from the start, a new chat reading 0%. The plan's limits are the status bar's, not the chat box's. A click opens
 * Usage & cost.
 */
function ContextBar({ usage, agent, onOpen }: { usage: SessionUsage; agent: ChatAgent; onOpen: (() => void) | undefined }) {
  const item = usageItems(usage, nowSeconds(), abilitiesOf(agent).structuredChat).find((entry) => entry.window === null)
  if (item === undefined) return null
  return (
    <span className="mx-usage" role="group" aria-label="Usage">
      <UsageMeter item={item} graded onOpen={onOpen} />
    </span>
  )
}

function ModeFace({ agent, facts }: { agent: ChatAgent; facts: ComposerFacts }) {
  // The words show only off the agent's usual mode (`permissionWords`); the name is always in the label and the tooltip.
  const words = permissionWords(agent, facts.modeKey, facts.mode)
  return (
    <>
      <Icon name="shield" size={13} />
      {words !== null && <span className="mx-mode-name">{words}</span>}
      {facts.modeDanger && <span className="mx-mode-dot" aria-hidden="true" />}
    </>
  )
}

/**
 * The permission mode, as a shield in the chat box's row, with its name beside it only when it is not the agent's usual
 * mode: the shield turns red in a mode that asks about nothing. It opens the agent's modes when they can be picked from here.
 */
function ModeControl({ agent, facts }: { agent: ChatAgent; facts: ComposerFacts }) {
  const name = facts.mode ?? 'not reported yet'
  const danger = facts.modeDanger ? ' is-danger' : ''
  if (facts.modeLocked !== undefined || (facts.agentChips !== undefined && (facts.agentChips.locked !== null || facts.onPickMode === undefined))) {
    // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
    return (
      <button type="button" aria-disabled="true" className={`mx-row-button mx-mode-button is-locked${danger}`} title={`Permissions: ${name}. ${modeLockedWhy(facts)}`} aria-label={`Permission mode: ${name}. ${modeLockedWhy(facts)}`}>
        <ModeFace agent={agent} facts={facts} />
      </button>
    )
  }
  if (facts.onPickMode === undefined) {
    return (
      <span className={`mx-row-button mx-mode-button is-static${danger}`} role="img" aria-label={`Permission mode: ${name}`} title={facts.mode === null ? 'Permissions: not reported by the agent yet' : `Permissions: ${name}. Cycle it in the terminal with Shift+Tab.`}>
        <ModeFace agent={agent} facts={facts} />
      </span>
    )
  }
  return (
    <PermissionMenu
      agent={facts.modeAgent ?? 'Claude'}
      label="Permission mode"
      mode={facts.modeKey ?? ''}
      {...(facts.modes === undefined ? {} : { modes: facts.modes })}
      onPick={facts.onPickMode}
      bypassOff={facts.bypassAllowed === true ? undefined : { note: 'needs a new session', why: 'Claude only allows this when it starts with Bypass Permissions on (Settings › Permissions). This session started without it: turn the setting on and start a new session.' }}
    >
      <button type="button" className={`mx-row-button mx-mode-button${danger}`} title={`Permissions: ${name}`} aria-label={`Permission mode: ${name}. Pick another.`}>
        <ModeFace agent={agent} facts={facts} />
      </button>
    </PermissionMenu>
  )
}

/**
 * The model a chat that follows a terminal agent runs. Where the agent's model menu is only drawn by its terminal it opens
 * that menu in the chat; otherwise it is only said, and changed in the terminal. Drawn from the start, with just the agent's
 * name until the agent says its model, so it is never added later.
 */
function ModelLabel({ agent, model, onOpenMenu, locked }: { agent: ChatAgent; model: string | null; onOpenMenu: (() => void) | undefined; locked: string | null }) {
  const name = modelName(agent, undefined, model)
  const face = (
    <>
      <span className="mx-model-icon"><AppIcon process={agent} size={14} /></span>
      <span className="mx-model-line">{name}</span>
    </>
  )
  if (onOpenMenu === undefined) {
    return <span className="mx-row-button mx-model-button is-static" title="The model, from the agent's own file. Change it in the terminal with /model.">{face}</span>
  }
  // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
  return (
    <button
      type="button"
      className={`mx-row-button mx-model-button${locked === null ? '' : ' is-locked'}`}
      aria-disabled={locked === null ? undefined : 'true'}
      aria-label={`Model: ${name}. Open its menu.${locked === null ? '' : ` ${locked}`}`}
      title={locked ?? `The model, from the agent's own file. Opens ${agentLabel(agent)}'s /model menu here.`}
      onClick={locked === null ? onOpenMenu : undefined}
    >
      {face}
    </button>
  )
}

/** The model and reasoning the next message uses, from the agent picker. */
function ModelPicker({ agent, conversation, model, effort, live, locked, remote, onStartWith }: { agent: ChatAgent; conversation: number; model: string | null; effort: string | null; live?: ((command: string) => void) | undefined; locked: string | null; remote: boolean; onStartWith: ((agent: ChatAgent) => void) | undefined }) {
  const [stored, change] = useAgentChoice(conversation, agent)
  // Which agents the rail offers a new session with; another machine's are not read from here.
  const installed = useInstalledAgents()
  // A chat that follows the agent's terminal keeps no pick of its own: a pick is typed in as the agent's command, and
  // the button names what the agent says it runs, so it never disagrees with the terminal. A kept pick could, as one
  // made in the terminal or before a restart would not reach it.
  const choice = live === undefined ? stored : FOLLOWS_AGENT
  return <AgentPicker fixedModels={remote} agent={agent} choice={choice} onChange={live === undefined ? (picked) => { change(picked); rememberChoice(agent, { ...stored, ...picked }) } : ignoreChange} currentModel={model} currentEffort={effort} locked={locked ?? undefined} installed={remote ? null : installed} {...(onStartWith === undefined ? {} : { onStartWith })} {...(live ? { live } : {})} />
}

const FOLLOWS_AGENT: AgentChoice = defaultChoice()
const ignoreChange = (): void => {}
