import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import { recallStep, type Recalled } from '../promptRecall'
import { toast } from '@/lib/toast'
import { pasteFromHost, pickFromClipboard, unsupportedMessage } from '@/features/terminal/clipboardImage'
import type { ChatAgent } from '@/features/workspace/model/chatView'
import { abilitiesOf, runsMidTurn } from '@/features/workspace/model/agentAbilities'
import { AppIcon, Icon } from '@/features/workspace/components/glyphs'
import { registerComposerDrop } from '../composerDrop'
import { updateComposer, useComposerDraft, useComposerSlice } from '../composerStore'
import type { ChatComposer } from '../useChatComposer'
import { defaultChoice, useAgentChoice, type AgentChoice } from '../agentChoice'
import { DraftAttachments } from './Attachments'
import { AgentPicker } from './AgentPicker'
import { modelName } from '../modelName'
import { PLAN_MODE } from '../chatMeta'
import { PermissionMenu } from './PermissionMenu'
import { QueuedMessages } from './QueuedMessages'
import { MAX_SHOWN, SlashPicker } from './SlashPicker'
import { FilePicker } from './FilePicker'
import { useFileMention } from '../useFileMention'
import type { FileSearchPlace } from '../fileMention'
import { asSkills, commandText, matchCommands, skillQuery, slashQuery, useSlashCommands, withTerminalCommands, type SlashCommand } from '../slashCommands'
import { CLAUDE_HIDDEN_COMMANDS, CLAUDE_TERMINAL_COMMANDS } from '../terminalCommands'
import { terminalOnlyNote, typedCommand, windowRouteOf, withWindowRoutes, type WindowRoute } from '../windowCommands'
import { CODEX_COMMANDS } from '../codexCommands'
import { isBangLine, namedCommand } from '../slashCommands'
import { usageItems, type SessionUsage } from '../usageStrip'
import { nowSeconds } from '@/features/workspace/model/newChatHost'
import { useKeepTyping } from '../useKeepTyping'

/** A key with nothing stored under it, for a composer whose view holds its own draft. */
const NO_CONVERSATION = -1

/** What the box's bottom row says about the session: its model, permission mode and usage. */
export type ComposerFacts = {
  /** What the session's agent reported using; the meters at the right of the box show it, and are not drawn when there is nothing. */
  usage?: SessionUsage | undefined
  /** Opens Usage & cost, from a click on a meter; without it the meters are only read. */
  onOpenUsage?: (() => void) | undefined
  /** The permission mode in words, from the agent's own file; null when it has not said. */
  mode: string | null
  /** The mode asks about nothing, so it is drawn in the danger colour. */
  modeDanger: boolean
  /** The model the agent's own file says it uses; null when it has not said. */
  model: string | null
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
  /** The question tray: what the agent asks, slid up from behind the box. Null when it asks nothing. */
  question?: ReactNode
  facts: ComposerFacts
  /** A message went in and the agent has not taken it up yet: the send button shows it is working and sends nothing more. */
  waiting?: boolean
  /** Where an `@` looks for files; absent where the daemon cannot be asked (another machine, no pane). */
  files?: FileSearchPlace | undefined
  /** The messages the person sent in this chat, oldest first, for ↑ to bring back (`promptRecall.ts`). */
  sent?: readonly string[]
}

const NO_CHANGE = () => undefined
const NO_MESSAGES: readonly string[] = []
const PERCENT = 100

/** What in the question tray takes the focus when it opens: its first field, else its first button. */
// Only a question that takes keys gets the focus: a card answered only by a click (trusting a folder) must not be
// answered by a stray Enter meant for the box.
const TRAY_FIRST_CONTROL = '[aria-keyshortcuts]:not([disabled])'

/**
 * The message box (layout 2h): the question tray when the agent asks, then one box: the text with attach at its top
 * right, and under it the model, the permission mode, the usage meters and send. Enter sends, Shift+Enter
 * adds a line, Esc interrupts the running turn. While the agent works, sending queues the message;
 * while a request waits for an answer the box is off and says why, and the request has the focus; while the daemon is
 * offline the box still takes typing but does not send.
 */
export function Composer({ agent, composer, conversation, commandsFrom, question = null, facts, waiting = false, files, sent = NO_MESSAGES }: Props) {
  const { setDraft, attachments, attach, readOnly, queue, removeQueued, editQueued, sendQueuedNow, sendingNow, submit, stop, running, sending, disabledReason, draftable, error } = composer
  const storedDraft = useComposerDraft(composer.conversationKey ?? NO_CONVERSATION)
  const restoreNote = useComposerSlice(composer.conversationKey ?? NO_CONVERSATION, (state) => state.note)
  const draft = composer.draft ?? storedDraft
  const off = disabledReason !== null
  const box = useRef<HTMLDivElement>(null)
  const text = useRef<HTMLTextAreaElement>(null)
  // The sent message ↑ put in the box, while it is still there unedited.
  const recalled = useRef<Recalled | null>(null)
  useKeepTyping(text, attachments.length)
  // A chat that opens takes the typing, as the terminal under it would, when nothing else on the page has it:
  // the new-chat page has just closed, or the starting chat's box was replaced by this one.
  useEffect(() => {
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const pane = text.current?.closest('.mx-pane')
    if (pane?.classList.contains('is-card') === true && !pane.classList.contains('is-focused')) return
    text.current?.focus({ preventScroll: true })
  }, [])
  // A question the agent asks takes the typing from the box, which goes off while it waits: its first control has the
  // focus, so y / a / n (or Enter) answer it at once instead of going nowhere. Once it is answered the box has it back.
  // Only when the typing was in this chat's box, or nowhere (the box going off dropped it), never from another pane.
  const tray = useRef<HTMLDivElement>(null)
  const asking = question !== null
  useEffect(() => {
    const active = document.activeElement
    const ours = active === null || active === document.body || active === text.current || (tray.current?.contains(active) ?? false)
    if (!ours) return
    if (asking) tray.current?.querySelector<HTMLElement>(TRAY_FIRST_CONTROL)?.focus({ preventScroll: true })
    else if (active === null || active === document.body) text.current?.focus({ preventScroll: true })
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
  const placeholder = disabledReason ?? (running ? `Queue a message for when ${agent} finishes` : planning ? 'Reply to the plan…' : 'Message the agent, or type / for commands')
  const empty = draft.trim() === '' && attachments.length === 0
  // With nothing typed while a turn runs, the round button stops the agent instead of sending.
  const stopping = running && empty && !off
  const busy = sending || waiting

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
      return [...(inTerminal === undefined ? CODEX_COMMANDS.filter((command) => command.terminal !== true) : CODEX_COMMANDS), ...skills]
    }
    const listed = withTerminalCommands(slash.commands, CLAUDE_TERMINAL_COMMANDS, CLAUDE_HIDDEN_COMMANDS)
    const own = inWindow === undefined ? listed : withWindowRoutes(listed)
    return inTerminal === undefined ? own.filter((command) => command.terminal !== true) : own
  }, [slash.commands, inTerminal, inWindow, windowList, skillsOnly])
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
    // The routes are Claude Code's commands by its names; another agent's are its own.
    if (inWindow === undefined || agent !== 'claude' || windowList || attachments.length > 0) return null
    const parts = typedCommand(typed)
    if (parts === null) return null
    const route = windowRouteOf(parts.name, parts.args)
    if (route !== null || inTerminal !== undefined) return route
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
      toast.message(`${agent} is working. Run ${typed} when it finishes.`)
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
        toast.message(`${agent} is working. Run /${command.name} when it finishes.`)
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
      toast.message(`${agent} is working. Run /${command.name} when it finishes.`)
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
        <QueuedMessages agent={agent} queue={queue} onRemove={removeQueued} onEdit={(id) => { editQueued(id); text.current?.focus() }} onSendNow={sendQueuedNow} sendingNow={sendingNow} />
        <div ref={tray} className="mx-question-slot">{question}</div>
        <div className={`mx-box${off ? ' is-locked' : ''}`}>
          {picking && (
            <SlashPicker agent={agent} typed={draft.trim()} matches={matches} active={active} loading={slash.loading} error={slash.error} onPick={run} onHover={(index) => { setCursor({ query, index }) }} />
          )}
          {mention.open && (
            <FilePicker found={mention.found} active={mention.active} onPick={mention.pick} onHover={mention.hover} />
          )}
          <DraftAttachments attachments={attachments} onRemove={attach.remove} />
          <textarea
            ref={text}
            aria-label={`Message ${agent}`}
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
          {(composer.attachable ?? !readOnly) && (
            // aria-disabled, not disabled: a disabled button gets no focus or tooltip, and the reason is the point.
            <button type="button" className="mx-box-attach" aria-label={attachLabel} title={attachLabel} aria-disabled={off} onClick={() => { if (!off) attach.pick() }}>
              <Icon name="plus" size={16} />
            </button>
          )}
          {planning && (
            <p className="mx-plan-strip">
              <span className="mx-plan-strip-name">Plan mode</span>
              <span>Reads and plans. Changes nothing until you approve.</span>
            </p>
          )}
          <div className="mx-box-row">
            {facts.agentChips !== undefined ? (
              conversation !== undefined
                ? <ModelPicker remote={facts.agentChips.remote === true} agent={agent} conversation={conversation} model={facts.model} effort={facts.effort ?? null} live={readOnly ? facts.onCommand : undefined} locked={facts.agentChips.pickerLocked === undefined ? facts.agentChips.locked : facts.agentChips.pickerLocked} />
                : <AgentPicker agent={agent} choice={facts.agentChips.start ?? defaultChoice()} onChange={NO_CHANGE} locked={facts.agentChips.locked ?? undefined} />
            ) : (
              <>
                {conversation !== undefined && (!readOnly || facts.onCommand !== undefined) && <ModelPicker remote={false} agent={agent} conversation={conversation} model={facts.model} effort={facts.effort ?? null} live={readOnly ? facts.onCommand : undefined} locked={null} />}
                {readOnly && facts.onCommand === undefined && <ModelLabel agent={agent} model={facts.model} onOpenMenu={facts.onOpenModelMenu} locked={facts.modelMenuLocked ?? null} />}
              </>
            )}
            <ModeControl facts={facts} />
            <span className="mx-spacer" />
            {facts.usage !== undefined && <UsageMeters usage={facts.usage} always={agent === 'claude' || agent === 'codex'} onOpen={facts.onOpenUsage} />}
            {stopping ? (
              <button type="button" className="mx-send is-stop" aria-label={`Stop ${agent}`} title={`${agent} is working. Stop it (Esc)`} onClick={stop}><span className="mx-stop-square" aria-hidden="true" /></button>
            ) : busy ? (
              // Sent, and not yet a turn to stop: the same square, off until there is one.
              <button type="button" className="mx-send is-stop is-off is-busy" aria-label={`${agent} is working`} aria-busy="true" title={`${agent} is working`} disabled><span className="mx-stop-square" aria-hidden="true" /></button>
            ) : (
              <button type="button" className={`mx-send${off || empty ? ' is-off' : ''}`} aria-label={running ? 'Queue message' : 'Send message'} disabled={off || sending || empty} onClick={send}>
                <Icon name="arrowUp" size={15} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
        {readOnly && abilitiesOf(agent).bangToTerminal && isBangLine(draft) && <p className="mx-composer-note">Runs in the terminal, not as a message. Open the terminal to answer anything it asks.</p>}
        {restoreNote !== null && composer.conversationKey !== undefined && (
          <p className="mx-composer-note">
            Your next message starts with a line telling {agent} the files were restored.{' '}
            <button type="button" className="mx-composer-note-action" onClick={() => { updateComposer(composer.conversationKey ?? NO_CONVERSATION, (state) => ({ ...state, note: null })) }}>Leave it out</button>
          </p>
        )}
        {error !== null && <p role="alert" className="mx-composer-error">{error}. Your message is kept; send it again to retry.</p>}
      </div>
    </div>
  )
}

function modeLockedWhy(facts: Pick<ComposerFacts, 'modeLocked' | 'agentChips'>): string {
  return facts.modeLocked ?? facts.agentChips?.locked ?? 'Not available for this chat'
}

/** The short name a meter wears beside its figure. */
const usageName = (item: { window: string | null }): string => (item.window === null ? 'Ctx' : item.window === 'week' ? 'Wk' : item.window)
/** The meter's ring, square as the window's corners are: a path round a 12px box, starting at the top middle. */
const METER_PATH = 'M6 1H11V11H1V1H6'

/**
 * The meters at the right of the box: how full the session's context is and how much of each of the plan's limits is
 * used, each a short name, a square ring and the figure, in the theme's meter colour for its quarter. For an agent that
 * reports them (`always`) all three are drawn, one not reported yet as "–" (ADR 0009: never a made-up zero); for any
 * other only what it reported, and with nothing reported there is none. A click opens Usage & cost.
 */
function UsageMeters({ usage, always, onOpen }: { usage: SessionUsage; always: boolean; onOpen: (() => void) | undefined }) {
  const items = usageItems(usage, nowSeconds(), always)
  if (items.length === 0) return null
  return (
    <span className="mx-usage" role="group" aria-label="Usage">
      {items.map((item) => {
        const used = item.percent === null
          ? `${item.label}: not reported yet`
          : item.window === null ? `How much of this chat's memory is used: ${String(item.percent)}%` : item.resetsIn === null ? `${item.label}: ${String(item.percent)}% used` : `${item.label}: ${String(item.percent)}% used · resets in ${item.resetsIn}`
        const percent = item.percent ?? 0
        const meter = (
          <>
            <span className="mx-usage-name">{usageName(item)}</span>
            <svg className="mx-usage-ring" role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={PERCENT} {...(item.percent === null ? { 'aria-valuetext': 'not reported yet' } : { 'aria-valuenow': item.percent })} width="12" height="12" viewBox="0 0 12 12">
              <path d={METER_PATH} className="mx-usage-track" />
              <path d={METER_PATH} className="mx-usage-fill" pathLength={PERCENT} strokeDasharray={`${String(percent)} ${String(PERCENT)}`} />
            </svg>
            <span className="mx-usage-figure">{item.percent === null ? '–' : `${String(item.percent)}%`}</span>
          </>
        )
        return onOpen === undefined
          ? <span key={item.key} className={`mx-usage-item is-${item.tone}`} title={used}>{meter}</span>
          : <button key={item.key} type="button" className={`mx-usage-item is-${item.tone}`} title={`${used} · Open Usage & cost`} onClick={onOpen}>{meter}</button>
      })}
    </span>
  )
}

/**
 * The permission mode, as a shield and a chevron in the box's bottom row: the mode's name is in its tooltip, and the
 * shield turns red in a mode that asks about nothing. It opens the agent's modes when they can be picked from here.
 */
function ModeControl({ facts }: { facts: ComposerFacts }) {
  const name = facts.mode ?? 'not reported yet'
  const danger = facts.modeDanger ? ' is-danger' : ''
  if (facts.modeLocked !== undefined || (facts.agentChips !== undefined && (facts.agentChips.locked !== null || facts.onPickMode === undefined))) {
    // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
    return (
      <button type="button" aria-disabled="true" className={`mx-mode-button is-locked${danger}`} title={`Permissions: ${name}. ${modeLockedWhy(facts)}`} aria-label={`Permission mode: ${name}. ${modeLockedWhy(facts)}`}>
        <Icon name="shield" size={13} /><Icon name="chevronDown" size={10} />
      </button>
    )
  }
  if (facts.onPickMode === undefined) {
    return (
      <span className={`mx-mode-button is-static${danger}`} role="img" aria-label={`Permission mode: ${name}`} title={facts.mode === null ? 'Permissions: not reported by the agent yet' : `Permissions: ${name}. Cycle it in the terminal with Shift+Tab.`}>
        <Icon name="shield" size={13} />
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
      bypassOff={facts.bypassAllowed === true ? undefined : { note: 'needs a new session', why: 'Claude only allows this when it starts with Yolo mode on (Settings, General). This session started without it: turn the setting on and start a new session.' }}
    >
      <button type="button" className={`mx-mode-button${danger}`} title={`Permissions: ${name}`} aria-label={`Permission mode: ${name}. Pick another.`}>
        <Icon name="shield" size={13} /><Icon name="chevronDown" size={10} />
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
      <span className="mx-model-name">{name}</span>
    </>
  )
  if (onOpenMenu === undefined) {
    return <span className="mx-model-button is-static" title="The model, from the agent's own file. Change it in the terminal with /model.">{face}</span>
  }
  // aria-disabled, not disabled: a disabled button gets no tooltip, and the reason is the point.
  return (
    <button
      type="button"
      className={`mx-model-button${locked === null ? '' : ' is-locked'}`}
      aria-disabled={locked === null ? undefined : 'true'}
      aria-label={`Model: ${name}. Open its menu.${locked === null ? '' : ` ${locked}`}`}
      title={locked ?? `The model, from the agent's own file. Opens ${agent}'s /model menu here.`}
      onClick={locked === null ? onOpenMenu : undefined}
    >
      {face}
    </button>
  )
}

/** The model and reasoning the next message uses, from the agent picker. */
function ModelPicker({ agent, conversation, model, effort, live, locked, remote }: { agent: ChatAgent; conversation: number; model: string | null; effort: string | null; live?: ((command: string) => void) | undefined; locked: string | null; remote: boolean }) {
  const [stored, change] = useAgentChoice(conversation, agent)
  // A chat that follows the agent's terminal keeps no pick of its own: a pick is typed in as the agent's command, and
  // the button names what the agent says it runs, so it never disagrees with the terminal. A kept pick could, as one
  // made in the terminal or before a restart would not reach it.
  const choice = live === undefined ? stored : FOLLOWS_AGENT
  return <AgentPicker fixedModels={remote} agent={agent} choice={choice} onChange={live === undefined ? change : ignoreChange} currentModel={model} currentEffort={effort} locked={locked ?? undefined} {...(live ? { live } : {})} />
}

const FOLLOWS_AGENT: AgentChoice = defaultChoice()
const ignoreChange = (): void => {}
