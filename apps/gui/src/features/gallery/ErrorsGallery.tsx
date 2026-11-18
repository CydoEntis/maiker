import { useEffect, useState, type ReactNode } from 'react'
import { FieldError, fieldErrorProps, InlineNote, CopyDetails, FeedbackButton } from '@/components/ui/feedback'
import { Toaster } from '@/components/ui/toaster'
import { Composer } from '@/features/chat/components/Composer'
import { useChatProblem } from '@/features/chat/components/ChatProblem'
import type { ChatProblem } from '@/features/chat/problem'
import type { ChatComposer } from '@/features/chat/useChatComposer'
import { ServiceChip, ServiceStatus } from '@/features/workspace/components/ServiceStatus'
import type { ServiceStage } from '@/features/workspace/model/serviceState'
import { toast } from '@/lib/toast'

/*
 * Every error surface with mock data, for checking against the design (docs/DESIGN.md, Errors):
 * `#dialogs?show=err-chat`, err-line, err-context, err-offline, err-chip, err-blip, err-found, err-update, err-toasts,
 * err-field or err-note. Each draws a stand-in window (title bar, a chat column) so the scope of each surface shows.
 */

const SAME = (): void => undefined
const COLUMN_WIDTH = 720
// The chat column narrows with the window, as the app's does.
const COLUMN = `min(${String(COLUMN_WIDTH)}px, calc(100% - 32px))`
const MS_PER_MINUTE = 60_000
const TWO_MINUTES_AGO = Date.now() - MS_PER_MINUTE - MS_PER_MINUTE
const CONTEXT_PERCENT = 96
const RETRY_IN_MS = 6000
const NOT_NOW_AFTER_MS = 200
const RETRY_AT = Date.now() + RETRY_IN_MS
const OFFLINE_DETAIL = 'connect: no such file or directory (os error 2)'

const composer: ChatComposer = {
  draft: '', setDraft: SAME, attachments: [], attach: { pick: SAME, addPaths: SAME, addImage: SAME, remove: SAME }, readOnly: false, queue: [], removeQueued: SAME, editQueued: SAME, moveQueuedUp: SAME, clearQueued: SAME,
  submit: SAME, stop: SAME, running: false, sending: false, disabledReason: null, draftable: true, ready: true, error: null, sendText: () => Promise.resolve(true), sendReply: () => Promise.resolve(true), echo: null,
}
const FACTS = { mode: 'default', modeDanger: false, model: 'claude-sonnet-5-5', usage: { context: 18, limits: [] } }

const PROBLEMS: Record<string, ChatProblem> = {
  'err-chat': { kind: 'machine', machine: 'devbox', since: TWO_MINUTES_AGO, onRetry: SAME },
  'err-line': { kind: 'machine', machine: 'devbox', since: TWO_MINUTES_AGO, onRetry: SAME },
  'err-stopped': { kind: 'stopped', agent: 'Claude', code: 1, onRestart: SAME, onViewLog: SAME },
  'err-context': { kind: 'context', agent: 'Claude', percent: CONTEXT_PERCENT, onCompact: SAME, onNewWithSummary: SAME },
}

/** A title bar with the service chip where the app draws it. */
function TitleBar({ chip }: { chip?: ReactNode }) {
  return (
    <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px', borderBottom: '1px solid var(--line)', background: 'var(--bg)' }}>
      <b style={{ fontSize: 13 }}>Maiker</b>
      {chip}
    </div>
  )
}

/** A chat column: two messages and the dock, with the problem over it or in the dock. */
function Chat({ problem }: { problem: ChatProblem | null }) {
  const view = useChatProblem(problem, () => 'A summary of the chat so far.')
  useEffect(() => {
    if (problem !== PROBLEMS['err-line']) return undefined
    // The line is a problem put off with Not now.
    const timer = window.setTimeout(() => {
      const notNow = Array.from(document.querySelectorAll<HTMLButtonElement>('.mx-alert button')).find((button) => button.textContent === 'Not now')
      notNow?.click()
    }, NOT_NOW_AFTER_MS)
    return () => { window.clearTimeout(timer) }
  }, [problem])
  return (
    <div className="mx-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--main)' }}>
      <div style={{ width: COLUMN, flex: 1, padding: '32px 0', display: 'flex', flexDirection: 'column', gap: 16, color: 'var(--fg2)', fontSize: 14 }}>
        <p style={{ alignSelf: 'flex-end', margin: 0, padding: '8px 12px', background: 'var(--raise)', color: 'var(--fg)' }}>Write tests for the cart reducer.</p>
        <p style={{ margin: 0 }}>Running the cart tests on devbox…</p>
      </div>
      <div style={{ width: COLUMN, paddingBottom: 16 }}>
        <Composer agent="claude" composer={composer} facts={FACTS} problem={view.line} />
      </div>
      {view.alert}
    </div>
  )
}

function Service({ stage, putOff, mismatch }: { stage: ServiceStage; putOff: boolean; mismatch: boolean }) {
  const restart = { label: 'Restart and restore 3 sessions', sessions: 3, working: 1, canRestart: true, pending: false, from: 115, to: 117, onRestart: SAME }
  return (
    <>
      <TitleBar chip={<ServiceChip stage={stage} putOff={putOff} mismatch={mismatch} appBehind={false} onReopen={SAME} />} />
      <Chat problem={null} />
      <ServiceStatus stage={stage} putOff={putOff} onPutOff={SAME} mismatch={mismatch} retryAt={RETRY_AT} detail={OFFLINE_DETAIL} restart={restart} appBehind={null} sessions={3} onStart={() => new Promise(() => undefined)} />
    </>
  )
}

/** Raises one of each toast once, newest last so the stack reads as the design shows it. */
function Toasts() {
  useEffect(() => {
    toast.success('Copied the branch name')
    toast.progress('Sending screenshot.png to devbox', { description: '42%' })
    toast.needs('Parser fix needs you', { description: 'Wants to run npm test', action: { label: 'Allow', onClick: SAME }, secondary: { label: 'Open session', onClick: SAME } })
    toast.warning('Back online, but 2 chats were interrupted', { action: { label: 'Restart both', onClick: SAME } })
    toast.failed('Could not open the link', new Error('xdg-open exited with code 3'))
    toast.failed('Could not open the link', new Error('xdg-open exited with code 3'))
  }, [])
  return (
    <>
      <TitleBar />
      <div className="mx-chat" style={{ flex: 1, background: 'var(--main)' }} />
      <Toaster />
    </>
  )
}

/** A branch field left with a name git refuses, and a start that failed, as the dialogs draw them. */
function Fields({ note }: { note: boolean }) {
  const [value, setValue] = useState('feat new login')
  const error = 'Branch names can’t contain spaces. Try feat-new-login.'
  return (
    <>
      <TitleBar />
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: 48, background: 'var(--main)' }}>
        <div className="mx-rename mx-worktree" style={{ width: 420, position: 'static', alignSelf: 'flex-start' }} data-float="">
          <h2>New worktree</h2>
          {note
            ? <InlineNote title="Could not start “Fix the failing test”" reason="The agent could not be started in that worktree: the branch name is already taken by another worktree on this computer." actions={<><FeedbackButton kind="primary">Put back</FeedbackButton><FeedbackButton kind="text">Dismiss</FeedbackButton><CopyDetails text="details" copy={() => Promise.resolve()} /></>} />
            : (
              <>
                <input aria-label="Branch name" value={value} onChange={(event) => { setValue(event.target.value) }} {...fieldErrorProps('gallery-branch', error)} />
                <FieldError id="gallery-branch">{error}</FieldError>
              </>
            )}
        </div>
      </div>
    </>
  )
}

/** One error surface in a stand-in window. */
export function ErrorsGallery({ what }: { what: string }): ReactNode {
  const body = (() => {
    const problem = PROBLEMS[what]
    if (problem) return <><TitleBar /><Chat problem={problem} /></>
    if (what === 'err-offline') return <Service stage="offline" putOff={false} mismatch={false} />
    if (what === 'err-chip') return <Service stage="offline" putOff mismatch={false} />
    if (what === 'err-blip') return <Service stage="blip" putOff={false} mismatch={false} />
    if (what === 'err-found') return <Service stage="found" putOff={false} mismatch={false} />
    if (what === 'err-update') return <Service stage="ok" putOff={false} mismatch />
    if (what === 'err-toasts') return <Toasts />
    if (what === 'err-field') return <Fields note={false} />
    if (what === 'err-note') return <Fields note />
    return null
  })()
  return <div className="mx-window" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>{body}</div>
}
