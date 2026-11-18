import { useSyncExternalStore } from 'react'
import type { AttachmentKind } from '@/api/attachments'
import { readComposerDrafts, writeComposerDrafts, type SavedDraft } from '@/data/composerDrafts'
import { forgetOperations } from './sendOperation'
import { MAX_QUOTES, sameQuote, type Quote } from './quoteMessage'

/**
 * What a conversation's composer holds between views: the unsent text and the files attached to it. It lives here, not in the
 * component, so switching to the terminal and back (which closes and reopens the chat) loses
 * nothing. The text is also kept in the window's storage (`data/composerDrafts.ts`), so a restart loses nothing either.
 * Messages sent while an agent works are not kept here: its daemon holds them, for a chat-run agent
 * and for one in a terminal alike, so they go in whether or not this window is open.
 */

/**
 * A file kept for the message being written. `preview` is an object URL for a thumbnail, when the window holds the image's bytes.
 * `size` is null for a file that came back with a message taken out of the queue: the message names its path, not its size.
 */
export type DraftAttachment = {
  readonly id: string
  readonly path: string
  readonly name: string
  readonly size: number | null
  readonly kind: AttachmentKind
  readonly preview: string | null
}

/**
 * `note` is a line the next message sent starts with (after Edit from here restored the files). It goes when the box is
 * emptied of everything typed and attached, as a discarded draft takes it along.
 */
export type ComposerState = { readonly draft: string; readonly attachments: readonly DraftAttachment[]; readonly quotes: readonly DraftQuote[]; readonly note: string | null }

/** A quote waiting in the strip above the box: whose words, which words, and a number that names it for its remove button. */
export type DraftQuote = Quote & { readonly id: string }

const NO_ATTACHMENTS: readonly DraftAttachment[] = []
const NO_QUOTES: readonly DraftQuote[] = []
const EMPTY: ComposerState = { draft: '', attachments: NO_ATTACHMENTS, quotes: NO_QUOTES, note: null }
const stored = new Map<number, ComposerState>()
const listeners = new Set<() => void>()
/** When each box's text last changed, so the oldest drafts are the ones dropped from storage. */
const touched = new Map<number, number>()
/** Writes wait this long after the last letter, so typing does not write storage on every key. */
const SAVE_AFTER_MS = 300
let saveTimer: number | null = null

for (const [conversation, saved] of readComposerDrafts(Date.now())) {
  stored.set(conversation, { draft: saved.text, attachments: NO_ATTACHMENTS, quotes: NO_QUOTES, note: null })
  touched.set(conversation, saved.at)
}

function saveSoon(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    const drafts = new Map<number, SavedDraft>()
    for (const [conversation, state] of stored) {
      if (state.draft.trim() !== '') drafts.set(conversation, { text: state.draft, at: touched.get(conversation) ?? Date.now() })
    }
    writeComposerDrafts(drafts)
  }, SAVE_AFTER_MS)
}

/** The state now, outside React, for code that must see the latest. */
export function peekComposer(conversation: number): ComposerState {
  return read(conversation)
}

function read(conversation: number): ComposerState {
  return stored.get(conversation) ?? EMPTY
}

export function updateComposer(conversation: number, change: (state: ComposerState) => ComposerState): void {
  const before = read(conversation)
  const changed = change(before)
  if (changed === before) return
  const after = isEmptied(before, changed) ? { ...changed, note: null } : changed
  if (after.draft === '' && after.attachments.length === 0 && after.quotes.length === 0 && after.note === null) stored.delete(conversation)
  else stored.set(conversation, after)
  if (after.draft !== before.draft) {
    touched.set(conversation, Date.now())
    saveSoon()
  }
  for (const listener of listeners) listener()
}

const holdsNothing = (state: ComposerState) => state.draft.trim() === '' && state.attachments.length === 0 && state.quotes.length === 0

function isEmptied(before: ComposerState, after: ComposerState): boolean {
  return !holdsNothing(before) && holdsNothing(after)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useComposerState(conversation: number): ComposerState {
  return useSyncExternalStore(subscribe, () => read(conversation))
}

/**
 * One part of a conversation's composer. A view that needs only the files is
 * not drawn again for each letter typed, which matters for the chat around the box.
 */
export function useComposerSlice<T>(conversation: number, pick: (state: ComposerState) => T): T {
  return useSyncExternalStore(subscribe, () => pick(read(conversation)))
}

/** The unsent text: only the box that shows it follows every change. */
export function useComposerDraft(conversation: number): string {
  return useComposerSlice(conversation, (state) => state.draft)
}

let quoteCount = 0

/** A name for a quote in the strip, for its remove button and its place in the list. */
export function newQuoteId(): string {
  quoteCount += 1
  return `quote-${String(quoteCount)}`
}

/** What `addQuote` did: the quote is in the strip, was already there, or the strip is full. */
export type QuoteAdded = 'added' | 'duplicate' | 'full'

/** Puts a quote in the conversation's strip. The same words from the same speaker are ignored, and the strip holds `MAX_QUOTES`. */
export function addQuote(conversation: number, quote: Quote): QuoteAdded {
  const now = read(conversation).quotes
  if (now.some((held) => sameQuote(held, quote))) return 'duplicate'
  if (now.length >= MAX_QUOTES) return 'full'
  updateComposer(conversation, (state) => ({ ...state, quotes: [...state.quotes, { ...quote, id: newQuoteId() }] }))
  return 'added'
}

export function removeQuote(conversation: number, id: string): void {
  updateComposer(conversation, (state) => (state.quotes.some((quote) => quote.id === id) ? { ...state, quotes: state.quotes.filter((quote) => quote.id !== id) } : state))
}

export function clearQuotes(conversation: number): void {
  updateComposer(conversation, (state) => (state.quotes.length === 0 ? state : { ...state, quotes: NO_QUOTES }))
}

/** The conversation each session's chat last had, so what its box holds can follow it to a new one. */
const lastConversation = new Map<string, number>()

/**
 * Says which conversation a session's chat is now. The daemon gives a pane's agent a new conversation
 * number when it stops recognising the agent for a moment and then finds it again, and the box is kept by
 * that number: without this the text being written vanished with the old one. What the box held moves
 * to the new number, unless something was already written there.
 */
export function followComposer(sessionId: string, conversation: number): void {
  const before = lastConversation.get(sessionId)
  lastConversation.set(sessionId, conversation)
  if (before === undefined || before === conversation) return
  const state = stored.get(before)
  if (state === undefined || stored.has(conversation)) return
  stored.delete(before)
  stored.set(conversation, state)
  touched.set(conversation, Date.now())
  saveSoon()
  for (const listener of listeners) listener()
}

/** For tests: the store belongs to the window's lifetime. */
export function forgetComposers(): void {
  stored.clear()
  touched.clear()
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = null
  lastConversation.clear()
  forgetOperations()
}
