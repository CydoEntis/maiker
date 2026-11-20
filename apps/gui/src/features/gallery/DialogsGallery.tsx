import { useEffect, useState, type ReactNode } from 'react'
import '@/features/chat/chat.css'
import { Composer, type DockOpen } from '@/features/chat/components/Composer'
import { HelpersDock } from '@/features/chat/components/HelpersDock'
import { subagentEvent } from '@/features/chat/eventFixtures'
import { dockHelpers } from '@/features/chat/helpersDock'
import type { ChatComposer } from '@/features/chat/useChatComposer'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DesktopSettings, type DesktopSettingsSection } from '@/features/settings/components/DesktopSettings'
import type { SettingsPreferences } from '@/features/settings/preferences'
import { CommandPalette } from '@/features/workspace/components/CommandPalette'
import { NewChatPage } from '@/features/workspace/components/NewChatPage'
import { PickFolderDialog } from '@/features/workspace/components/PickFolderDialog'
import { RecentSessionsDialog } from '@/features/workspace/components/RecentSessionsDialog'
import { ResumeSavedDialog } from '@/features/workspace/components/ResumeSavedDialog'
import type { PaletteItem } from '@/features/workspace/model/palette'
import { withLook, type Corners } from '@/features/workspace/theme/corners'
import { findTheme, themeStyle } from '@/features/workspace/theme/themes'
import { ErrorsGallery } from './ErrorsGallery'
import { SAMPLE_HEADS, SAMPLE_HOSTS, sampleAdd, sampleHostKey, sampleSessions } from './machinesSample'
import { galleryParams } from './galleryParams'

/*
 * The dialogs with mock data, for checking them against the design: `#dialogs?show=new&theme=Maiker%20Night&corners=folded`.
 * `show` is new, new-long, new-more, new-fail (a start that fails with a long reason), picker, picker-empty, picker-loading, palette, recent or resume; err-… are the error surfaces (ErrorsGallery). The page shows nothing but the dialog.
 */

const MACHINES = [{ machine: 0, label: 'this computer', local: true }, { machine: 1, label: 'devbox', local: false }]
const PROJECTS = [
  { folder: '/home/dev/acme-store', name: 'acme-store', color: 'var(--m-working)' },
  { folder: '/home/dev/AeVoxPlatformWebApplication', name: 'AeVoxPlatformWebApplication', color: 'var(--m-ok)' },
]
const LONG_PROJECTS = [PROJECTS[1] ?? { folder: '', name: '', color: '' }, ...PROJECTS.slice(0, 1)]
const MS_PER_SECOND = 1000
const NOW_SECONDS = Math.floor(Date.now() / MS_PER_SECOND)
const HOUR = 3600
const DAY = 86_400
const COLUMN_WIDTH = 760
const IN_THREE_HOURS = HOUR + HOUR + HOUR
const IN_THREE_DAYS = DAY + DAY + DAY
const NOTHING = (): Promise<void> => Promise.resolve()
const NEVER = <T,>(): Promise<T> => new Promise<T>(() => undefined)
const LISTING = { path: '/home/dev', exists: true, truncated: false, can_create: true, entries: [{ name: 'acme-store', git: 'main', has_children: true }, { name: 'AeVoxPlatformWebApplication', git: 'feat/api-key-rotation-for-the-billing-service', has_children: true }, { name: 'notes', git: null, has_children: false }] }
const ITEMS: PaletteItem[] = [
  { id: 'a1', label: 'New session', kind: 'Action', shortcut: 'Ctrl N', run: () => undefined },
  { id: 'a2', label: 'Open settings', kind: 'Action', shortcut: 'Ctrl ,', run: () => undefined },
  { id: 's1', label: 'Upgrade to React 19', detail: 'acme-store', kind: 'Session', status: 'needs', badge: 'needs you', run: () => undefined },
  { id: 's2', label: 'Move auth from JWT to sessions', detail: 'acme-store', kind: 'Session', status: 'working', run: () => undefined },
  { id: 'p1', label: 'billing-api', kind: 'Project', run: () => undefined },
]

const HELPERS = dockHelpers([
  subagentEvent('d1', { title: 'review the diff', agentType: 'Explore', status: 'running', prompt: 'Review the diff.' }),
  subagentEvent('d2', { title: 'Check the limits', report: 'The limit is checked in two places, both before the write.' }),
  subagentEvent('d4', { title: 'Update the OpenAPI spec', status: 'failed', prompt: 'Add the refunds route to the spec.', report: 'The spec file has a syntax error on line 214.' }),
], [])
const LONG_TEXT = 'I read through the refunds work so far, and before you go further I want to change the plan a bit.\n\n1. Partial refunds: allow more than one refund per charge, but the total can never go over the original amount.\n2. Idempotency: accept an Idempotency-Key header and store it for 24 hours.\n\nDo not touch the payments routes, and keep every change behind the existing feature flag.'
const QUEUE = [{ id: 1, text: 'Once the build is green, bump the version to 3.0.0 and write the changelog entry.' }, { id: 2, text: 'Then add the refunds route to the OpenAPI spec.' }, { id: 3, text: 'And run the full test suite before you stop.' }]
const SAME = (): void => undefined
const fakeComposer = (draft: string, queue: typeof QUEUE): ChatComposer => ({
  draft, setDraft: SAME, attachments: [], attach: { pick: SAME, addPaths: SAME, addImage: SAME, remove: SAME }, readOnly: false, queue, removeQueued: SAME, editQueued: SAME, moveQueuedUp: SAME, clearQueued: SAME,
  submit: SAME, stop: SAME, running: false, sending: false, disabledReason: null, draftable: true, ready: true, error: null, sendText: () => Promise.resolve(true), sendReply: () => Promise.resolve(true), echo: null,
})
const FACTS = { mode: 'default', modeDanger: false, model: 'claude-sonnet-5-5', usage: { context: 18, limits: [{ name: '5h', used: 82, resetsAt: NOW_SECONDS + IN_THREE_HOURS }, { name: 'week', used: 41, resetsAt: NOW_SECONDS + IN_THREE_DAYS }] } }

/** The dock above the message box and the box itself, in the chat column's width, as the chat draws them. */
function DockBox({ what }: { what: string }) {
  const [open, setOpen] = useState<DockOpen>(what === 'dock-helpers' ? 'helpers' : what === 'dock-queue' ? 'queue' : null)
  const [width] = useState(() => Number(new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?') + 1)).get('w') ?? COLUMN_WIDTH))
  const long = what === 'box-long'
  const queue = what === 'box' || what === 'box-focus' || long ? [] : what === 'dock-one' ? QUEUE.slice(0, 1) : QUEUE
  const helpers = what.startsWith('dock') && what !== 'dock-one' && what !== 'dock-stack' ? <HelpersDock helpers={HELPERS} open={open === 'helpers'} onOpenChange={(next) => { setOpen(next ? 'helpers' : null) }} /> : null
  return (
    <div className="mx-chat" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', padding: 16, background: 'var(--main)' }}>
      <div style={{ width }}>
        <Composer agent="claude" composer={fakeComposer(long ? LONG_TEXT : '', queue)} facts={FACTS} helpers={helpers} dock={{ open, set: setOpen }} />
      </div>
    </div>
  )
}

const PREFS = { exportFolder: '', accent: 'teal', spinner: 'braille', restoreLayout: true, reduceMotion: false, animateSidebarActivity: true, compactSidebar: false, notifyNeedsYou: true, notifyFinished: true, notifyError: true, notificationSound: false, terminalFontSize: 13, terminalFontFamily: '', terminalFontWeight: 400, terminalFontWeightBold: 700, startFolder: '', themeMode: 'dark', darkTheme: 'Maiker Dark', lightTheme: 'Maiker Light', cursorStyle: 'block', scrollback: 10000, scrollSpeed: 1, terminalLineHeight: 1.2, density: 'comfortable', sidebarTextSize: 13.5, tabTextSize: 13.5, sidebarWidth: 264, sidebarSide: 'left', sidebarOrder: 'creation', sidebarGroup: 'status', terminalDock: 'bottom', terminalScreenReader: false, autoDownloadUpdates: true, restartWhenIdle: false, restartServiceWhenIdle: false, monthlyBudget: null, iconSize: 'medium', iconColor: 'color', openSessionsIn: 'terminal', defaultAgent: 'claude', hideSuccessfulTools: false, colourFileNames: true, bypassOff: [], updateMachines: true, perfOverlay: false, terminalPlainDrawing: false, cursorBlink: false, corners: 'folded', chatWidth: 'auto', chatTextSize: 100, keyOverrides: {} } as unknown as SettingsPreferences
const CLIENT = new QueryClient()
const SETTINGS_MACHINES = { known: true, list: SAMPLE_HEADS, sessionsOn: sampleSessions, onRetry: SAME, onRemove: SAME, onGrant: SAME, onUpdate: () => Promise.resolve(), onCheckActivity: () => Promise.resolve({ sessions: 3, busy: 1, current: false }), onCopyCommand: SAME, onOpenLogin: SAME, onRename: SAME, hostKey: { inspect: sampleHostKey, trust: () => Promise.resolve() }, add: { loadHosts: () => Promise.resolve(SAMPLE_HOSTS), onAdd: sampleAdd, onCancel: SAME } }

function Settings({ section }: { section: DesktopSettingsSection }) {
  const [prefs, setPrefs] = useState(PREFS)
  return (
    <QueryClientProvider client={CLIENT}>
      <DesktopSettings section={section} onSection={SAME} preferences={prefs} onChange={setPrefs} systemReducedMotion={false} systemDark onPreviewTheme={SAME} onShowWelcome={SAME} platform="linux" daemon={{ online: true, sessionCount: 3 }}
        machines={SETTINGS_MACHINES} appVersion="0.80.0" usage={{ budget: null, onBudget: SAME, sessionForTerm: () => null, onOpenSession: SAME }} onClose={SAME} />
    </QueryClientProvider>
  )
}

/** How long the scripted picker waits for the dialog to read its folder, and then for the field to open. */
const PICKER_READ_MS = 400
const FIELD_OPEN_MS = 150

/** Sets the value of a React-controlled input the way typing does. */
function typeInto(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** For the new-folder states: opens the field, and types a bad name or a good one, once the page has read its folder. */
function ScriptedPicker({ what, children }: { what: string; children: ReactNode }) {
  useEffect(() => {
    if (!what.startsWith('picker-new') && what !== 'picker-denied') return undefined
    const timer = window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>('.mx-fp-new-button')?.click()
      window.setTimeout(() => {
        const field = document.querySelector<HTMLInputElement>('.mx-fp-new input')
        if (field === null) return
        if (what === 'picker-new-bad') { typeInto(field, 'my/folder'); field.form?.requestSubmit() }
        if (what === 'picker-new-exists') { typeInto(field, 'NOTES'); field.form?.requestSubmit() }
        if (what === 'picker-denied') { typeInto(field, 'fresh'); field.form?.requestSubmit() }
        if (what === 'picker-new-typed') typeInto(field, 'my-new-project')
      }, FIELD_OPEN_MS)
    }, PICKER_READ_MS)
    return () => { window.clearTimeout(timer) }
  }, [what])
  return children
}

const FAILED_START = 'The agent could not be started in that worktree: the branch name is already taken by another worktree on this computer, so nothing was created and your checkout was left as it was.'
const STATE_READ_MS = 500

/** For the New session states: More options open, or a message typed and a start that fails, once the page has read its folder. */
function ScriptedNew({ what, children }: { what: string; children: ReactNode }) {
  useEffect(() => {
    if (what !== 'new-more' && what !== 'new-fail') return undefined
    const timer = window.setTimeout(() => {
      if (what === 'new-more') {
        document.querySelector<HTMLElement>('.mx-nsd-more-toggle')?.click()
        return
      }
      const box = document.querySelector<HTMLTextAreaElement>('.mx-newchat .mx-box-text')
      if (box === null) return
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, 'Fix the failing test')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      window.setTimeout(() => { document.querySelector<HTMLButtonElement>('.mx-newchat .mx-send')?.click() }, FIELD_OPEN_MS)
    }, STATE_READ_MS)
    return () => { window.clearTimeout(timer) }
  }, [what])
  return children
}

function Show({ what }: { what: string }): ReactNode {
  if (what.startsWith('err-')) return <ErrorsGallery what={what} />
  const long = what === 'new-long'
  if (what === 'new' || what.startsWith('new-')) {
    const start = what === 'new-fail' ? () => Promise.reject(new Error(FAILED_START)) : NOTHING
    return <ScriptedNew what={what}><div style={{ position: 'relative', height: '100vh' }}><NewChatPage machines={MACHINES} machine={0} projects={long ? LONG_PROJECTS : PROJECTS} defaultAgent="claude" pickFolder={() => NEVER()} onStart={start} onOtherMachine={() => undefined} onCancel={() => undefined} /></div></ScriptedNew>
  }
  if (what.startsWith('picker')) {
    const listing = what === 'picker-old' ? { ...LISTING, can_create: false } : what === 'picker-empty' ? { ...LISTING, entries: [] } : LISTING
    const list = what === 'picker-loading' ? () => NEVER<typeof LISTING>() : () => Promise.resolve(listing)
    const create = what === 'picker-denied' ? () => Promise.resolve({ kind: 'failed' as const, reason: 'You do not have permission to make a folder here.' }) : () => Promise.resolve({ kind: 'created' as const, path: '/home/dev/new' })
    return <ScriptedPicker what={what}><PickFolderDialog machines={[{ machine: 0, label: 'this computer', ready: true, word: null }, { machine: 1, label: 'devbox', ready: true, word: null }, { machine: 2, label: 'build-01', ready: false, word: 'asleep' }]} machine={1} list={list} create={create} onPick={() => undefined} onCancel={() => undefined} /></ScriptedPicker>
  }
  if (what.startsWith('dock') || what.startsWith('box')) return <DockBox what={what} />
  if (what.startsWith('settings')) return <Settings section={(what.split('-')[1] ?? 'appearance') as DesktopSettingsSection} />
  if (what === 'palette') return <CommandPalette items={ITEMS} outputItem={() => null} onClose={() => undefined} />
  if (what === 'recent') return <RecentSessionsDialog home="/home/dev" onPick={() => undefined} onReopened={() => undefined} onCancel={() => undefined} />
  if (what === 'resume') return <ResumeSavedDialog projects={PROJECTS} defaultAgent="claude" locked={false} onPick={() => undefined} onCancel={() => undefined} />
  return null
}

/** One dialog over an empty window, in the theme and corners the hash asks for. */
export function DialogsGallery() {
  const { theme: themeName, corners } = galleryParams(window.location.hash)
  const what = new URLSearchParams(window.location.hash.slice(window.location.hash.indexOf('?') + 1)).get('show') ?? 'new'
  const theme = withLook(findTheme(themeName))
  const style = themeStyle(theme)
  // The dialogs mount once the themed root exists, since they read it for their portal.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.corners = corners satisfies Corners
    for (const [name, value] of Object.entries(style)) if (name.startsWith('--')) root.style.setProperty(name, value)
    root.style.colorScheme = theme.light ? 'light' : 'dark'
  }, [corners, style, theme.light])
  return (
    <div ref={setRoot} className="mx-app" data-theme-kind={theme.light ? 'light' : 'dark'} style={{ ...style, position: 'fixed', inset: 0, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--ui)' }}>
      {root !== null && <Show what={what} />}
    </div>
  )
}
