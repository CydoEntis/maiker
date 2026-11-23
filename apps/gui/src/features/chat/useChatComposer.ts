import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cancelTurn, dequeueMessage, sendQueuedMessageNow, submitMessage } from '@/api/daemon'
import { errorMessage } from '@/lib/error-message'
import { useLatest } from '@/lib/useLatest'
import type { ChatAgent, ChatLink } from '@/features/workspace/model/chatView'
import { abilitiesOf, runsMidTurn, steersIntoTurn } from '@/features/workspace/model/agentAbilities'
import { hasPendingApproval, type ChatFeed } from './chatFeed'
import { buildAttachmentMessage, parseAttachmentMessage } from './attachmentMessage'
import { buildQuoteMessage, MAX_QUOTES, parseQuoteMessage, sameQuote, type MessageSegment } from './quoteMessage'
import { announceOutsideSend, onOutsideSend } from './outsideSends'
import { selectChatEvents } from './projection'
import { countUserMessages } from './workPhase'
import { newQuoteId, peekComposer, updateComposer, useComposerSlice, type ComposerState, type DraftAttachment } from './composerStore'

import { newId, revokePreviews, useAttachmentIntake, type AttachmentIntake } from './useAttachmentIntake'
import { wireChoice } from './agentChoice'
import { paneSendOperation, reserveOperation, STALE_OPERATION, type FailedSend } from './sendOperation'
import { isBangLine, isSlashLine } from './slashCommands'
import { withRestoreNote } from './editFromHere'
import { heldAgain, letGoOf, NO_LET_GO, oneLeft, shownQueued, stillLetGo, type LetGo } from './letGo'

export const PENDING_APPROVAL_NOTE = 'Answer the request above first'
export const READ_ONLY_NOTE = 'Read-only: this chat follows the terminal agent'
export const OFFLINE_NOTE = 'The Maiker service is offline'
/** Sent to the terminal around a message, so a multi-line message is one paste and not several Enters. */
export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/**
 * A message as it is typed into an agent's terminal: one paste and Enter, so a multi-line message is one message. The
 * agent's own command is typed instead, as its picker's commands are: it reads a typed slash as a command.
 */
export function asTyped(text: string): string {
  return isSlashLine(text) ? `${text}\r` : `${PASTE_START}${text}${PASTE_END}\r`
}

/** How long a pasted message is given before its Enter is typed. */
export const PASTE_SUBMIT_GAP_MS = 150

/**
 * How long a typed command is given before its Enter. Sent together, Codex loses the Enter, and Claude Code takes it for
 * the path it is completing (`/export /some/path` stays typed in its box).
 */
export const COMMAND_SUBMIT_GAP_MS = 400

/** Types a message into an agent's terminal with `type`, the way that agent takes it (`asTyped`; a command with a pause before Enter). */
/** How long the agent is given to switch to its shell mode after the `!` before the command is typed. */
export const BANG_MODE_GAP_MS = 150

export async function typeMessage(type: (text: string) => Promise<void>, agent: string | undefined, text: string): Promise<void> {
  if (abilitiesOf(agent).slashCommands?.enterAfterPause === true && isSlashLine(text)) {
    await type(text)
    await new Promise<void>((resolve) => { window.setTimeout(resolve, COMMAND_SUBMIT_GAP_MS) })
    await type('\r')
    return
  }
  // `!command` is typed, never pasted: the agent switches to its shell mode on the typed `!`, runs the command in the
  // terminal it owns and keeps the output in its context. A paste starting with `!` is only text.
  if (abilitiesOf(agent).bangToTerminal && isBangLine(text)) {
    await type('!')
    await new Promise<void>((resolve) => { window.setTimeout(resolve, BANG_MODE_GAP_MS) })
    await type(`${text.slice(1).trim()}\r`)
    return
  }
  // The Enter goes in on its own, after the paste has been taken: sent in the same write, an agent that is busy
  // reads it as part of the paste and the message sits typed in its box, unsent.
  if (!isSlashLine(text)) {
    await type(`${PASTE_START}${text}${PASTE_END}`)
    await new Promise<void>((resolve) => { window.setTimeout(resolve, PASTE_SUBMIT_GAP_MS) })
    await type('\r')
    return
  }
  await type(asTyped(text))
}
/** The key that interrupts the agent's turn. */
export const INTERRUPT_KEY = '\x1b'

/** How long a message just sent stays on screen before the history shows it; past this it is dropped rather than left as a claim. */
const ECHO_MAX_MS = 20_000
/** How long a message just sent claims the agent is thinking; after this the status itself has to say it. */
const ECHO_THINKING_MS = 4_000
/** A second read soon after a send, because a quiet chat is read only every few seconds. */
const FOLLOW_UP_REFRESH_MS = 700
/**
 * How long a pasted message is given to start a turn before its Enter is typed once more. An agent still closing its
 * last turn can read the Enter as part of the paste; the words then sit in its box, unsent, and the next message is
 * added to them. A second Enter on an empty box does nothing.
 */
export const RESUBMIT_AFTER_MS = 1_500

/** The follow-ups a pane's daemon holds for its working agent, and the ways to add one and to take one back. */
export type PaneQueue = {
  readonly queued: readonly string[]
  /**
   * Leaves a message with the daemon; `first` puts it ahead of the ones already waiting. `operation` names the
   * send, so the daemon takes a retry of it as the same message.
   */
  add: (text: string, first: boolean, operation: number) => Promise<void>
  /** Takes back the one at `index`, while it still reads `text`. */
  drop: (index: number, text: string) => Promise<void>
}

const NO_QUEUED: readonly string[] = []
/** A pane's queued messages are numbered below zero by their place, so they never share a number with a conversation's operations. */
const paneQueuedId = (index: number): number => -(index + 1)
/** Takes one of `text` out of `list`; whether there was one. */
function takeOut(list: string[], text: string): boolean {
  const at = list.indexOf(text)
  if (at < 0) return false
  list.splice(at, 1)
  return true
}
const paneQueuedIndex = (id: number): number => -id - 1


/** What was just sent into the terminal, and how many times those words were already in the history. */
export type SentEcho = { readonly text: string; readonly baseline: number; readonly quiet: boolean; /** Which send drew it, so a timer of an earlier send of the same words leaves it alone. */ readonly id?: number }

/** A message the daemon holds until the running turn ends. `id` is its operation number. */
const NO_PENDING: ReadonlySet<number> = new Set()

export type QueuedItem = { readonly id: number; readonly text: string }

type Input = {
  link: ChatLink
  /** The chat's agent: the model and reasoning picked for it go with each message. */
  agent?: ChatAgent
  feed: ChatFeed
  /** The daemon is connected, so a message can be sent. */
  online: boolean
  /** Reads the conversation again now. */
  refresh: () => void
  /**
   * Types into the terminal the agent runs in (ADR 0003). When given, a chat that only follows the
   * agent (ADR 0003) has a working composer while the agent is idle: the message is pasted into the
   * agent's own prompt, so the chat and the terminal are one session.
   */
  typeInto?: (text: string) => Promise<void>
  /** What the pane's daemon holds for its working agent: a message sent while the agent works joins it. */
  paneQueue?: PaneQueue
  /** The pane itself says its agent is working, which is known before the conversation's next read says so. */
  paneWorking?: boolean
}

export type ChatComposer = {
  /** The conversation whose stored draft this is; the box reads the text itself with `useComposerDraft`, so typing does not redraw the chat. */
  conversationKey?: number
  /** A draft the view holds itself, for a chat that has no conversation yet; it wins over the stored one. */
  draft?: string
  setDraft: (text: string) => void
  /** The files attached to the draft, in the order they were added. */
  attachments: readonly DraftAttachment[]
  /** Adding and removing them. */
  attach: AttachmentIntake
  /** The chat only follows an agent running in the terminal (ADR 0003): there is nothing to attach to. */
  readOnly: boolean
  /** Whether files can be attached; when absent, they can unless the chat is read-only. */
  attachable?: boolean
  /** What the daemon holds for the running turn, oldest first. */
  queue: readonly QueuedItem[]
  removeQueued: (id: number) => void
  /** Takes a queued message back into the message box, ahead of anything typed there, so it can be changed and sent again. */
  editQueued: (id: number) => void
  /** Puts a queued message one place nearer the front: the sends after it are queued again behind it, in the new order. */
  moveQueuedUp: (id: number) => void
  /** Removes every queued message. */
  clearQueued: () => void
  /**
   * Types a queued message into the agent now, in the turn that is running, as typing in its terminal does: the agent
   * reads it at its next step instead of when the turn ends. For a chat the daemon runs, the daemon sends it now
   * (steered into the turn, or the turn stopped for it) and a refusal leaves it queued; absent while a request waits for an answer.
   */
  sendQueuedNow?: ((id: number) => void) | undefined
  /** Send now goes into the running turn instead of stopping it, as the daemon reports for this chat. */
  sendNowSteers?: boolean | undefined
  /** The queued messages whose Send now the daemon has not answered yet, so a second click cannot send it twice. */
  sendingNow?: ReadonlySet<number> | undefined
  /** Sends the draft; while the agent works the daemon holds it and sends it when the turn ends. */
  submit: () => void
  /** Interrupts the running turn. */
  stop: () => void
  running: boolean
  sending: boolean
  /** Why the composer is off, or `null` when it takes input. */
  disabledReason: string | null
  /** The box takes typing, even if it cannot send now (the daemon is offline). */
  draftable: boolean
  /** The agent can take a message this moment: the box is on and nothing is running (a held message waits for this). */
  ready: boolean
  /** The last send that failed, or `null`. Cleared by the next send. */
  error: string | null
  /** Sends this text now, as `submit` would send the draft; true when it went. For a message held while the agent started. */
  sendText: (text: string) => Promise<boolean>
  /** Sends a message built elsewhere through the box's own send path, leaving the box's text and files alone; true when it went or was queued. */
  sendReply: (message: string) => Promise<boolean>
  /** The message just sent, until the history shows it; null otherwise. */
  echo: SentEcho | null
}

/**
 * A message put back in the box, ahead of anything written there: its files come back as attachments, as they were
 * when it was written, not as the lines that name them.
 */
export function messageIntoDraft(text: string): (state: ComposerState) => ComposerState {
  const parsed = parseAttachmentMessage(text)
  const said = parsed?.text ?? text
  // Its quotes come back to the strip, and what was said to the box.
  const segments = parseQuoteMessage(said)
  const words = segments === null ? said : segments.flatMap((segment) => (segment.kind === 'words' ? [segment.text] : [])).join('\n\n')
  const quotes = (segments ?? []).flatMap((segment) => (segment.kind === 'quote' ? [{ who: segment.who, text: segment.text, id: newQuoteId() }] : []))
  const files = (parsed?.files ?? []).map((file) => ({ id: newId(), path: file.path, name: file.name, size: null, kind: file.kind, preview: null }))
  return (state) => ({
    ...state,
    draft: state.draft.trim() === '' ? words : words === '' ? state.draft : `${words}\n\n${state.draft}`,
    attachments: [...files, ...state.attachments],
    quotes: [...quotes, ...state.quotes.filter((held) => !quotes.some((back) => sameQuote(back, held)))].slice(0, MAX_QUOTES),
  })
}

/**
 * The composer's behaviour. A message goes to the daemon through the conversation's own send, with
 * an operation number the daemon uses to tell a retry from a new message. While a turn runs the
 * daemon holds the message and delivers it when the turn ends, in order and once each, whether or
 * not this window stays open; what it holds comes back with every read (`feed.queued`) and is shown
 * until it is sent. While an approval waits, nothing is sent.
 */
export function useChatComposer({ link, agent, feed, online, refresh, typeInto, paneQueue, paneWorking = false }: Input): ChatComposer {
  const attachments = useComposerSlice(link.conversation, (state) => state.attachments)
  const paneQueued = paneQueue?.queued ?? NO_QUEUED
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sendingNow, setSendingNow] = useState<ReadonlySet<number>>(NO_PENDING)
  const [echo, setEcho] = useState<SentEcho | null>(null)
  // A send that failed is tried again with the same operation number, so the daemon can tell it is the same message.
  const retry = useRef<{ text: string; operation: number } | null>(null)
  // The same for a message left with the pane's daemon: one that timed out may have been queued all the same. Set only
  // once the attempt has failed, so a send still pending is never mistaken for its own retry.
  const paneRetry = useRef<FailedSend | null>(null)

  const readOnly = link.readOnly === true
  // A chat that follows a terminal agent talks to it by typing, when it has a terminal to type in.
  const typeText = readOnly ? typeInto : undefined
  const typing = typeText !== undefined
  // Without that it cannot interrupt or queue, so it never offers Stop or "queue" wording.
  const busy = feed.status === 'Working' || paneWorking
  const running = busy && (!readOnly || typing)
  const awaitingAnswer = hasPendingApproval(feed)
  // Typed text answers a prompt the agent is showing, and the chat cannot tell the difference, so
  // it types only while the agent is known to be waiting for a message.
  const waitingForMessage = feed.status === 'Idle' || feed.status === 'Done'
  // A terminal agent that is working, or has not said what it is doing yet, still takes a message: its daemon holds it and
  // types it in once the turn is over, so nothing reaches a prompt the agent might be showing meanwhile and nobody waits to type.
  const holding = typing && paneQueue !== undefined && (busy || !waitingForMessage)
  const disabledReason = typing
    ? (!online ? OFFLINE_NOTE : awaitingAnswer || feed.status === 'Blocked' ? PENDING_APPROVAL_NOTE : null)
    : readOnly ? READ_ONLY_NOTE : !online ? OFFLINE_NOTE : awaitingAnswer ? PENDING_APPROVAL_NOTE : null
  const conversation = link.conversation
  const attach = useAttachmentIntake({ conversation, blocked: disabledReason, machine: link.machine ?? null })
  // Queued messages this box let go of (removed, taken back, sent now): they leave the list at once, before the pane's
  // list catches up, and come back only if the daemon refuses.
  const [letGo, setLetGo] = useState<readonly LetGo[]>(NO_LET_GO)
  const caughtUp = stillLetGo(letGo, paneQueued)
  if (caughtUp !== letGo) setLetGo(caughtUp)
  const queue = useMemo<readonly QueuedItem[]>(() => [
    ...feed.queued.map((message) => ({ id: message.operation, text: message.text })),
    ...shownQueued(paneQueued, letGo).map(({ index, text }) => ({ id: paneQueuedId(index), text })),
  ], [feed.queued, paneQueued, letGo])

  const setDraft = useCallback((text: string) => {
    // Editing the box means the next send is a new message, not the retry of a failed one.
    if (peekComposer(conversation).draft !== text) paneRetry.current = null
    updateComposer(conversation, (state) => (state.draft === text ? state : { ...state, draft: text }))
  }, [conversation])

  // A comment sent from the diff is drawn in the chat at once, like a message typed here.
  const eventsNow = useLatest(() => selectChatEvents(feed.projection))
  // At rest, not asking anything: only then can an Enter be nothing but the send of words left in the box.
  const restingNow = useLatest(() => !paneWorking && (feed.status === 'Idle' || feed.status === 'Done'))
  // Each drawn message has its own number: the same words sent twice in a row keep their full time each.
  const echoes = useRef(0)
  const showEcho = useCallback((text: string, baseline: number, quiet: boolean) => {
    echoes.current += 1
    const id = echoes.current
    setEcho({ text, baseline, quiet, id })
    // The "thinking" line it brings is only a stand-in until the agent's own status says so: it stops after a few seconds, the message stays.
    if (!quiet) window.setTimeout(() => { setEcho((current) => (current?.id === id ? { ...current, quiet: true } : current)) }, ECHO_THINKING_MS)
    window.setTimeout(() => { setEcho((current) => (current?.id === id ? null : current)) }, ECHO_MAX_MS)
    return id
  }, [])
  useEffect(() => onOutsideSend(link.conversation, (text) => {
    showEcho(text, countUserMessages(eventsNow(), text), false)
    refresh()
  }), [link.conversation, eventsNow, refresh, showEcho])

  const send = useCallback(async (text: string): Promise<boolean> => {
    setSending(true)
    setError(null)
    if (typeText !== undefined) {
      try {
        await typeMessage(typeText, agent, text)
        const baseline = countUserMessages(selectChatEvents(feed.projection), text)
        if (!isSlashLine(text) && !isBangLine(text)) {
          window.setTimeout(() => {
            if (countUserMessages(eventsNow(), text) > baseline || !restingNow()) return
            typeText('\r').catch((failure: unknown) => { setError(errorMessage(failure, 'Could not type into the terminal')) })
          }, RESUBMIT_AFTER_MS)
        }
        // Drawn at once: the history only has it when the agent next writes its file.
        showEcho(text, baseline, false)
        refresh()
        window.setTimeout(refresh, FOLLOW_UP_REFRESH_MS)
        return true
      } catch (failure) {
        setError(errorMessage(failure, 'Could not type into the terminal'))
        return false
      } finally {
        setSending(false)
      }
    }
    const operation = retry.current?.text === text ? retry.current.operation : reserveOperation(conversation, feed)
    retry.current = { text, operation }
    // Drawn at once, as the agent's own history only has it once the turn has begun. A message that
    // is queued behind a running turn shows in the queue instead, so it is not drawn twice.
    const drawn = running ? null : showEcho(text, countUserMessages(selectChatEvents(feed.projection), text), true)
    try {
      const picked = agent === undefined ? null : wireChoice(conversation, agent)
      const target = { id: String(conversation), generation: link.generation }
      await (picked === null ? submitMessage(target, operation, text) : submitMessage(target, operation, text, picked))
      retry.current = null
      refresh()
      return true
    } catch (failure) {
      const message = errorMessage(failure, 'Could not send the message')
      setError(message)
      if (drawn !== null) setEcho((current) => (current?.id === drawn ? null : current))
      // A number the daemon has passed (another window sent in between) is not tried again; read, then pick a new one.
      if (STALE_OPERATION.test(message)) {
        retry.current = null
        refresh()
      }
      return false
    } finally {
      setSending(false)
    }
  }, [conversation, link.generation, agent, feed, refresh, typeText, running, eventsNow, restingNow, showEcho])

  /**
   * Sends a finished message by the one path every send takes: queued with the pane's daemon while it is not ready, typed
   * into the agent, or sent to the conversation. `settle` hears whether it went.
   */
  const dispatch = useCallback((text: string, files: readonly DraftAttachment[], note: string | null, typedAsCommand: boolean, settle: (delivered: boolean) => void) => {
    // An agent's own command that runs beside a working turn is typed in now; with files attached the message is a paste, not a command.
    const typedNow = typedAsCommand && busy && files.length === 0 && runsMidTurn(agent, text)
    if (holding && !typedNow) {
      // Left with the pane's daemon until the agent is ready for a message; shown in the queue meanwhile.
      setError(null)
      const message = withRestoreNote(note, buildAttachmentMessage(text, files))
      const operation = paneSendOperation(paneRetry.current, message, Date.now())
      paneRetry.current = null
      paneQueue.add(message, false, operation).then(
        () => { settle(true) },
        (failure: unknown) => {
          paneRetry.current = { text: message, operation, at: Date.now() }
          setError(errorMessage(failure, 'Could not queue the message'))
          settle(false)
        },
      )
      return
    }
    void send(withRestoreNote(note, buildAttachmentMessage(text, files))).then(settle)
  }, [send, holding, paneQueue, agent, busy])

  const submit = useCallback(() => {
    const { draft, attachments, quotes, note: boxNote } = peekComposer(conversation)
    const words = draft.trim()
    // A message may be only attachments; the block naming them is then the whole text. Quotes alone are not a message.
    if ((words === '' && attachments.length === 0) || disabledReason !== null || sending) return
    const files = attachments
    // Quotes make it a message to the agent, never one of its commands.
    const text = quotes.length === 0 ? words : buildQuoteMessage([...quotes.map((quote): MessageSegment => ({ kind: 'quote', who: quote.who, text: quote.text })), { kind: 'words', text: words }])
    const command = quotes.length === 0 && (isSlashLine(words) || isBangLine(words))
    // The agent's own command is not a message to it, so the note waits for the next one that is.
    const note = command ? null : boxNote
    updateComposer(conversation, (state) => ({ ...state, draft: '', attachments: [], quotes: [] }))
    if (note === null && boxNote !== null) updateComposer(conversation, (state) => ({ ...state, note: boxNote }))
    dispatch(text, files, note, quotes.length === 0, (delivered) => {
      if (delivered) {
        revokePreviews(files)
        return
      }
      // A message that did not go is given back, ahead of anything typed or attached meanwhile.
      updateComposer(conversation, (state) => ({
        ...state,
        draft: state.draft.trim() === '' ? words : words === '' ? state.draft : `${words}\n\n${state.draft}`,
        attachments: [...files, ...state.attachments],
        quotes: [...quotes, ...state.quotes.filter((held) => !quotes.some((back) => sameQuote(back, held)))].slice(0, MAX_QUOTES),
        note: note ?? state.note,
      }))
    })
  }, [disabledReason, sending, conversation, dispatch])

  /**
   * Sends a message built elsewhere (a quick reply to several questions) by the same path as the box: queued behind a
   * running turn, held for a starting agent, retried the same way. The box's own text and files are left as they are.
   */
  const sendReply = useCallback((message: string): Promise<boolean> => {
    if (disabledReason !== null || sending || message.trim() === '') return Promise.resolve(false)
    return new Promise((resolve) => { dispatch(message.trim(), [], null, false, resolve) })
  }, [disabledReason, sending, dispatch])

  // The ones this box took back, so their leaving the queue is not read as the daemon having sent them.
  const taken = useRef<string[]>([])
  const takeBack = useCallback((operation: number): { text: string; gone: Promise<void> } | null => {
    const index = paneQueuedIndex(operation)
    const text = paneQueued[index]
    if (text === undefined || paneQueue === undefined) return null
    taken.current.push(text)
    setLetGo((current) => letGoOf(current, paneQueued, text))
    return { text, gone: paneQueue.drop(index, text) }
  }, [paneQueued, paneQueue])

  /**
   * A queued message the daemon would not let go of goes back on the list with the reason. If it went to the agent a
   * moment ago, the pane's next list leaves it out; if not, it is still waiting, so it must not look gone.
   */
  const notLetGo = useCallback((text: string, failure: unknown, fallback: string) => {
    takeOut(taken.current, text)
    setLetGo((current) => heldAgain(current, text))
    setError(errorMessage(failure, fallback))
  }, [])

  // The daemon typed the oldest queued message into the agent: it is drawn in the chat at once, like one sent from here.
  const queuedBefore = useRef(paneQueued)
  useEffect(() => {
    const before = queuedBefore.current
    queuedBefore.current = paneQueued
    const left = oneLeft(before, paneQueued)
    if (left === null) return
    // One this box took back is not the daemon having sent it, wherever it was in the queue.
    if (takeOut(taken.current, left.text) || !left.first) return
    announceOutsideSend(link.conversation, left.text)
  }, [paneQueued, link.conversation])

  const sendQueuedNow = useCallback((operation: number) => {
    // Typed text answers a prompt the agent is showing, so nothing is pushed in while it asks something.
    if (disabledReason !== null || sending) return
    if (operation >= 0) {
      // The daemon holds it: it answers only once the message was taken, and refuses with a reason (the turn ended, an
      // approval waits) otherwise, so the message is still in its queue then and the next read shows it.
      if (sendingNow.has(operation)) return
      const settled = () => { setSendingNow((current) => new Set([...current].filter((pending) => pending !== operation))) }
      setSendingNow((current) => new Set([...current, operation]))
      sendQueuedMessageNow({ id: String(conversation), generation: link.generation }, operation)
        .then(() => {
          setError(null)
          settled()
          refresh()
        })
        .catch((failure: unknown) => {
          setError(errorMessage(failure, 'Could not send the queued message now'))
          settled()
          refresh()
        })
      return
    }
    const taking = takeBack(operation)
    if (taking === null) return
    // Typed in only once the daemon has let go of it, or it would go in twice.
    taking.gone.then(
      () => send(taking.text).then((delivered) => {
        // The daemon has let go of it, so a message that did not reach the agent goes back in the box, not nowhere,
        // with its files as attachments rather than the lines that name them.
        if (delivered) return
        updateComposer(conversation, messageIntoDraft(taking.text))
      }),
      (failure: unknown) => { notLetGo(taking.text, failure, 'Could not send the queued message now') },
    )
  }, [disabledReason, sending, sendingNow, send, takeBack, notLetGo, conversation, link.generation, refresh])

  const removeQueued = useCallback((operation: number) => {
    if (operation < 0) {
      const taking = takeBack(operation)
      if (taking === null) return
      taking.gone.catch((failure: unknown) => { notLetGo(taking.text, failure, 'Could not remove the queued message') })
      return
    }
    dequeueMessage({ id: String(conversation), generation: link.generation }, operation)
      .then(refresh)
      .catch((failure: unknown) => {
        setError(errorMessage(failure, 'Could not remove the queued message'))
        // Most often it was sent a moment ago: show what the daemon has now.
        refresh()
      })
  }, [conversation, link.generation, refresh, takeBack, notLetGo])

  const editQueued = useCallback((operation: number) => {
    const message = queue.find((item) => item.id === operation)
    if (message === undefined) return
    const intoDraft = messageIntoDraft(message.text)
    if (operation < 0) {
      const taking = takeBack(operation)
      if (taking === null) return
      // The words go back in the box only once the daemon has let go of them, or a message sent a moment ago would be sent twice.
      taking.gone.then(
        () => { updateComposer(conversation, intoDraft) },
        (failure: unknown) => { notLetGo(taking.text, failure, 'Could not take the queued message back') },
      )
      return
    }
    // The words go back in the box only once the daemon has let go of them, or a message sent a moment ago would be sent twice.
    dequeueMessage({ id: String(conversation), generation: link.generation }, operation)
      .then(() => {
        updateComposer(conversation, intoDraft)
        refresh()
      })
      .catch((failure: unknown) => {
        setError(errorMessage(failure, 'Could not take the queued message back'))
        refresh()
      })
  }, [queue, conversation, link.generation, refresh, takeBack, notLetGo])

  /**
   * The daemon's queue only takes a message at its end, so a message moves up by taking it and everything after the
   * one above it out and queueing them again in the new order. A message the daemon will not let go of (it was just
   * sent) stops the move, and what was already taken out goes back as it was. One that cannot be queued again goes
   * back in the box, so no words are lost.
   */
  const moveQueuedUp = useCallback((operation: number) => {
    const at = queue.findIndex((item) => item.id === operation)
    const above = queue[at - 1]
    const moved = queue[at]
    if (at < 1 || above === undefined || moved === undefined || disabledReason !== null || sending) return
    const tail = queue.slice(at - 1)
    const target = { id: String(conversation), generation: link.generation }
    const takeOutOf = (item: QueuedItem): Promise<void> => {
      if (item.id >= 0) return dequeueMessage(target, item.id)
      const taking = takeBack(item.id)
      return taking === null ? Promise.reject(new Error('That message is no longer waiting; it may already have been sent')) : taking.gone
    }
    const queueAgain = async (item: QueuedItem): Promise<boolean> => {
      if (item.id < 0 && paneQueue !== undefined) {
        try {
          await paneQueue.add(item.text, false, paneSendOperation(null, item.text, Date.now()))
          return true
        } catch {
          return false
        } finally {
          takeOut(taken.current, item.text)
        }
      }
      return send(item.text)
    }
    void (async () => {
      const removed: QueuedItem[] = []
      let refused: unknown = null
      // From the back, so the places of the ones still to be taken out do not move.
      for (const item of [...tail].reverse()) {
        try {
          await takeOutOf(item)
          removed.unshift(item)
        } catch (failure) {
          refused = failure
          break
        }
      }
      const again = refused === null ? [moved, above, ...queue.slice(at + 1)] : removed
      for (const item of again) {
        if (!(await queueAgain(item))) updateComposer(conversation, messageIntoDraft(item.text))
      }
      if (refused !== null) setError(errorMessage(refused, 'Could not move the queued message'))
      refresh()
    })()
  }, [queue, disabledReason, sending, conversation, link.generation, takeBack, paneQueue, send, refresh])

  const clearQueued = useCallback(() => {
    // The pane's queue is named by place: the last place first, so the places still to go do not move.
    const ids = queue.map((item) => item.id)
    const byPlaceFromBack = ids.filter((id) => id < 0).sort((a, b) => a - b)
    for (const id of [...byPlaceFromBack, ...ids.filter((id) => id >= 0)]) removeQueued(id)
  }, [queue, removeQueued])

  const stop = useCallback(() => {
    if (!running || feed.cancelling) return
    if (typeText !== undefined) {
      typeText(INTERRUPT_KEY).catch((failure: unknown) => { setError(errorMessage(failure, 'Could not interrupt the agent')) })
      return
    }
    cancelTurn({ id: String(conversation), generation: link.generation })
      .then(refresh)
      .catch((failure: unknown) => { setError(errorMessage(failure, 'Could not interrupt the turn')) })
  }, [running, feed.cancelling, conversation, link.generation, refresh, typeText])

  return { conversationKey: link.conversation, setDraft, attachments, attach, readOnly, attachable: !readOnly || typing, queue, removeQueued, editQueued, moveQueuedUp, clearQueued, sendQueuedNow: disabledReason === null ? sendQueuedNow : undefined, sendNowSteers: steersIntoTurn(link.steers), sendingNow, submit, stop, running, sending, disabledReason,
    // Offline, the message cannot go but the person can still write it: a reconnect a few seconds later should not
    // cost them what they were typing, nor the box its focus.
    draftable: disabledReason === null || disabledReason === OFFLINE_NOTE,
    ready: disabledReason === null && !holding, error, sendText: send, sendReply, echo }
}
