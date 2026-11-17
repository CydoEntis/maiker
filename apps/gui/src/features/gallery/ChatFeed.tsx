import { useState, type ReactNode } from 'react'
import '@/features/chat/chat.css'
import type { DiffLine } from '@/features/chat/chatEvents'
import { AgentsCard } from '@/features/chat/components/AgentsCard'
import { Markdown } from '@/features/chat/components/Markdown'
import { PlanCard } from '@/features/chat/components/PlanCard'
import { ApprovalTray, PromptTray } from '@/features/chat/components/QuestionTray'
import { HelpersDock } from '@/features/chat/components/HelpersDock'
import { QueuedMessages } from '@/features/chat/components/QueuedMessages'
import { dockHelpers } from '@/features/chat/helpersDock'
import { toSubagentView } from '@/features/workspace/model/subagents'
import { CommandStep, EditStep } from '@/features/chat/components/StepCards'
import { ThoughtRow } from '@/features/chat/components/ThoughtRow'
import { WorkCard } from '@/features/chat/components/WorkCard'
import { LiveBox } from '@/features/chat/components/LiveBox'
import { ChatItem, type ChatItemContext } from '@/features/chat/components/ChatItems'
import type { ChatRow } from '@/features/chat/chatRows'
import type { TurnEvent } from '@/features/chat/chatEvents'
import { messageEvent } from '@/features/chat/eventFixtures'

/** How long the gallery's live box says it has worked. */
const LIVE_MS = 12_000
/** When the gallery's live box started, fixed at load so a render stays pure. */
const LIVE_SINCE = Date.now() - LIVE_MS
import { approvalEvent, commandEvent, editEvent, subagentEvent, todoEvent, toolEvent } from '@/features/chat/eventFixtures'

/*
 * The chat's cards on made-up steps, so the feed can be checked against the design without an agent running. The
 * events come from the same builders the tests use.
 */

const TEST_OUTPUT = ['> refunds@1.4.0 test', '> vitest run', '', ' ✓ src/refunds/partial.test.ts (6 tests)', ' ✓ src/refunds/limits.test.ts (4 tests)', ' ✓ src/api/refunds.test.ts (9 tests)', '', ' Test Files  3 passed (3)', '      Tests  19 passed (19)'].join('\n')
const FAILED_OUTPUT = ['src/db/migrate.ts:41', '  error: relation "refund_lines" already exists', '  at Migrator.run (node_modules/kysely/migrator.js:212)', 'Migration 0042_partial_refunds failed'].join('\n')

const lines = (kind: DiffLine['kind'], ...texts: string[]): DiffLine[] => texts.map((text) => ({ kind, text }))
const DIFF: DiffLine[] = [
  ...lines('context', 'export function refundable(order: Order): number {'),
  ...lines('remove', '  return order.total'),
  ...lines('add', '  const refunded = order.refunds.reduce((sum, r) => sum + r.amount, 0)', '  return Math.max(0, order.total - refunded)'),
  ...lines('context', '}'),
]

const REPLY = [
  'The partial refunds endpoint is in and its tests pass.',
  '',
  '### What changed',
  '- `refundable()` now subtracts earlier refunds, so a second refund can never exceed what is left.',
  '- `POST /orders/:id/refunds` takes an `amount` and checks it against the limit.',
  '',
  '| Order | Total | Refunded | Left |',
  '| --- | ---: | ---: | ---: |',
  '| 1042 | 120.00 | 40.00 | 80.00 |',
  '| 1043 | 64.50 | 0.00 | 64.50 |',
  '',
  '```ts',
  'const left = refundable(order)',
  'if (amount > left) throw new RefundTooLarge(amount, left)',
  '```',
].join('\n')

const TOOK_MS = 4_200
/** When the gallery opened, so a running helper's clock starts near zero. */
const OPENED_MS = Date.now()
const started = (ms: number) => ({ startedAtMs: ms, completedAtMs: ms + TOOK_MS })

const IDLE = () => Promise.resolve()
const ACTIONS = { answer: () => undefined, answerInput: () => undefined, remember: () => undefined, busy: false }
/** Claude Code 2.1.325's plan menu, as the daemon reads it off the screen. */
const PLAN_MENU = 'Would you like to proceed?\n1. Yes, and use auto mode\n2. Yes, manually approve edits\n3. Tell Claude what to change'
const PLAN = { text: '#### Partial refunds\n1. Subtract earlier refunds in `refundable()`.\n2. Add `POST /orders/:id/refunds`.\n3. Test the limits.', cut: false }

/** When the gallery opened, in unix seconds; the helpers started a little before. */
const MS_PER_SECOND = 1_000
const FIRST_RAN_SECONDS = 42
const SECOND_RAN_SECONDS = 95
const NOW_SECONDS = Math.floor(Date.now() / MS_PER_SECOND)
const STARTED = { first: NOW_SECONDS - FIRST_RAN_SECONDS, second: NOW_SECONDS - SECOND_RAN_SECONDS }
const SUBAGENTS = [
  toSubagentView({ id: 's1', name: 'Explore', state: 'Working', task: 'Find every caller of refundable()', startedAt: STARTED.first, updatedAt: 0, latest: 'Grep "refundable(" in src/', result: null }),
  toSubagentView({ id: 's2', name: 'code-reviewer', state: 'Working', task: 'Review the refunds migration', startedAt: STARTED.second, updatedAt: 0, latest: 'Read db/migrations/0042_refunds.sql', result: null }),
  toSubagentView({ id: 's3', name: 'Explore', state: 'AwaitingApproval', task: 'Run the load test', startedAt: null, updatedAt: 0, latest: null, result: null }),
]

const DOCK_HELPERS = dockHelpers([
  subagentEvent('d1', { title: 'Find every caller of refundable()', agentType: 'Explore', status: 'running', prompt: 'Find every caller of refundable() and list the files.' }),
  subagentEvent('d2', { title: 'Review the refunds migration', agentType: 'code-reviewer', status: 'running', prompt: 'Review the refunds migration for order problems.' }),
  subagentEvent('d3', { title: 'Check the limits', report: 'The limit is checked in two places, both before the write.' }),
  subagentEvent('d4', { title: 'Update the OpenAPI spec', status: 'failed', prompt: 'Add the refunds route to the spec.', report: 'The spec file has a syntax error on line 214, so I could not add the route.' }),
], SUBAGENTS)
const LONG_QUEUED = 'I read through the refunds work so far, and before you go further I want to change the plan a bit.\n\n1. Partial refunds: allow more than one refund per charge, but the total can never go over the original amount.\n2. Idempotency: accept an Idempotency-Key header and store it for 24 hours.\n\nDo not touch the payments routes.'
const QUEUE_ONE = [{ id: 1, text: 'Once the build is green, bump the version to 3.0.0 and write the changelog entry.' }]
const QUEUE_MANY = [{ id: 1, text: LONG_QUEUED }, { id: 2, text: 'Then add the refunds route to the OpenAPI spec.' }, { id: 3, text: 'And run the full test suite before you stop.' }]
const NOTHING = () => undefined

function DockQueue({ queue, startOpen = false, note = null }: { queue: typeof QUEUE_MANY; startOpen?: boolean; note?: string | null }) {
  const [open, setOpen] = useState(startOpen)
  return <QueuedMessages agent="claude" queue={queue} open={open} onOpenChange={setOpen} onRead={NOTHING} helpersOpen={false} onRemove={NOTHING} onEdit={NOTHING} onSendNow={NOTHING} onMoveUp={NOTHING} onClear={NOTHING} note={note} />
}

function DockLine({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return <HelpersDock helpers={DOCK_HELPERS} open={open} onOpenChange={setOpen} />
}

/** The dock above the message box, in each of its states: the helpers line closed and open, the queue as one, a stack and a list, and the record. */
export function SubagentsBars() {
  const frame = (children: ReactNode, tall = false, column = 'mx-composer-column') => (
    <div className={`mx-chat relative overflow-visible border border-(--line) bg-(--bg) p-4 ${tall ? 'pt-[360px]' : ''}`} style={{ zoom: 1 }}>
      <div className={column}>{children}</div>
    </div>
  )
  return (
    <div className="flex flex-col gap-4">
      {frame(<DockLine />)}
      {frame(<DockLine startOpen />, true)}
      {frame(<DockQueue queue={QUEUE_ONE} />)}
      {frame(<DockQueue queue={QUEUE_MANY} />)}
      {frame(<DockQueue queue={QUEUE_MANY} startOpen />)}
      {frame(<DockQueue queue={QUEUE_ONE} note="This session failed. Your queued messages are kept and go out when it runs again." />)}
      {frame(<AgentsCard agents={[subagentEvent('r1', { title: 'Find call sites', report: 'Six callers, all in src/refunds.' }), subagentEvent('r2', { title: 'Review the migration', agentType: 'Plan', report: 'It is safe to rerun.' }), subagentEvent('r3', { title: 'Update the spec', status: 'failed', prompt: 'Add the route.', report: 'The spec has a syntax error on line 214.' })]} />, false, 'mx-chat-column')}
    </div>
  )
}

/** The waiting cards over a stand-in for the message box, one of each kind. */
export function WaitingCards() {
  const box = <div className="border border-(--line2) bg-(--card) px-3.5 pt-3 pb-8 text-sm text-(--dim)">Message claude</div>
  return (
    <div className="mx-chat" style={{ zoom: 1 }}>
      <div className="mx-chat-column">
        <div><ApprovalTray event={approvalEvent('r1', { command: 'pnpm db:migrate --env staging', canRemember: true })} actions={ACTIONS} agent="Claude" />{box}</div>
        <div><ApprovalTray event={approvalEvent('r2', { approvalKind: 'FileChange', command: null, changes: ['src/refunds/partial.ts', 'src/api/refunds.ts', 'docs/refunds.md'].map((path) => ({ path, kind: 'update', diff: { status: 'unavailable' as const } })) })} actions={ACTIONS} agent="Codex" />{box}</div>
        <div><PromptTray agent="claude" online ask={{ tool: 'ExitPlanMode', detail: '', answerable: true }} answer={IDLE} sendKeys={IDLE} plan={PLAN} asking={PLAN_MENU} />{box}</div>
        <div><PromptTray agent="claude" online ask={{ tool: 'AskUserQuestion', detail: 'Which database should refunds use?', answerable: false, choices: ['Postgres', 'SQLite', 'Keep the current one'] }} answer={IDLE} pick={IDLE} />{box}</div>
        <div><PromptTray agent="claude" online ask={{ tool: 'AskUserQuestion', detail: '', answerable: false, choices: [], questions: [{ question: 'Which database?', choices: ['Postgres', 'SQLite'] }, { question: 'Which language?', choices: ['Rust', 'Go'] }] }} answer={IDLE} pickAll={IDLE} />{box}</div>
      </div>
    </div>
  )
}

export function ChatFeed() {
  const run = [
    toolEvent('r1', { target: 'src/refunds/partial.ts' }),
    toolEvent('r2', { name: 'Grep', target: 'refundable' }),
    editEvent('r3', { file: 'src/refunds/partial.ts', diff: { status: 'available', hunks: [{ header: '@@ -12,2 +12,3 @@', lines: DIFF }], added: 2, removed: 1, truncated: false } }),
    commandEvent('r4', { command: 'pnpm test', output: TEST_OUTPUT, exitCode: 0, durationMs: TOOK_MS }),
    toolEvent('r5', { name: 'Read', target: 'src/api/refunds.ts' }),
  ]
  return (
    <div className="mx-chat" style={{ zoom: 1 }}>
      <div className="mx-chat-column">
        <LiveBox phrase="reading src/refunds/partial.ts" since={LIVE_SINCE} />
        <WorkCard steps={run} root={null} openDiff={null} waitingStep={null} />
        <CommandStep event={commandEvent('c1', { command: 'pnpm test --filter refunds', output: TEST_OUTPUT, exitCode: 0, timing: started(0) })} alone />
        <CommandStep event={commandEvent('c2', { command: 'pnpm db:migrate --env staging', output: FAILED_OUTPUT, exitCode: 1, status: 'failed', timing: started(0) })} alone />
        <EditStep event={editEvent('e1', { file: 'src/refunds/partial.ts', diff: { status: 'available', hunks: [{ header: '@@ -12,2 +12,3 @@', lines: DIFF }], added: 2, removed: 1, truncated: false } })} root={null} onOpen={() => undefined} alone />
        <EditStep event={editEvent('e2', { file: '.env.local', diff: { status: 'omitted' } })} root={null} onOpen={null} alone />
        <EditStep event={editEvent('e3', { tool: 'Write', file: 'docs/refunds.md', change: 'add', diff: { status: 'available', hunks: [{ header: '', lines: lines('add', '# Partial refunds', '', 'A refund can be any amount up to what is left on the order.', '## Limits', '- Never more than the order total.') }], added: 5, removed: 0, truncated: false } })} root={null} onOpen={null} />
        <PlanCard event={todoEvent('p1', [{ text: 'Read the refunds module', state: 'done' }, { text: 'Subtract earlier refunds', state: 'done' }, { text: 'Add the endpoint', state: 'current' }, { text: 'Write the tests', state: 'pending' }])} />
        <AgentsCard agents={[subagentEvent('a1', { title: 'Find call sites', status: 'running', prompt: 'Find every caller of refundable()', timing: { startedAtMs: OPENED_MS, completedAtMs: null } }), subagentEvent('a2', { title: 'Check the limits', report: 'The limit is checked in two places.' }), subagentEvent('a3', { title: 'Review the migration', agentType: 'Plan', report: 'It is safe to rerun.' })]} />
        <ThoughtRow texts={['The second refund must not exceed what is left, so subtract the earlier ones first.']} />
        <div className="mx-msg-agent"><Markdown text={REPLY} /></div>
      </div>
    </div>
  )
}

const NOTHING_OPEN = () => undefined
const ITEM_CONTEXT: ChatItemContext = { agent: 'claude', workingSince: LIVE_SINCE, approval: null, root: null, openDiff: NOTHING_OPEN, goToStep: null, waitingStep: null }
const TURN: TurnEvent = { kind: 'turn', id: 'turn1', turnId: 't1', outcome: 'completed', startedAtMs: 0, endedAtMs: 124_000, timed: true }
const CLEAN_OUTPUT = ['Reading schema from src/db/schema.ts', '1 table added: sessions', 'Migration written: drizzle/0043_add_sessions.sql'].join('\n')
const TSC_OUTPUT = ["src/routes/logout.ts:14:22 - error TS2339: Property 'token' does not exist on type 'Session'.", "src/routes/me.ts:9:31 - error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.", '', 'Found 2 errors in 2 files.'].join('\n')
const LONG_COMMAND = 'pnpm exec vitest run --coverage --reporter=verbose --config vitest.integration.config.ts src/features/billing/refunds src/features/billing/invoices'
const PROSE = [
  'Flags now come from the settings table.',
  '',
  'Here is what moved:',
  '',
  '| Flag | Before | After |',
  '| --- | --- | --- |',
  '| newCheckout | Hard-coded on | Settings table |',
  '| exportCsv | Hard-coded off | Settings table |',
  '',
  '- **Reads:** still go through `isEnabled()`, so none of the 23 call sites changed.',
  '- **Writes:** setFlag() saves to the table and clears the cache.',
  '',
  '```ts',
  "import { isEnabled, setFlag } from './flags';",
  "await setFlag('exportCsv', true);",
  '```',
  '',
  '> **Heads up** Existing environments need the migration before deploying: pnpm db:migrate.',
].join('\n')

/** The feed as the Maiker prototype draws it (Move auth from JWT to sessions), built from the real rows. */
export function ChatParity() {
  const rows: ChatRow[] = [
    { kind: 'user', key: 'u1', event: messageEvent('u1', 'user', 'Move auth from JWT to server sessions. Keep existing logins working during the switch, and add tests.') },
    { kind: 'agent', key: 'a1', turnId: 't1', status: 'completed', paragraphs: ["I'll start by finding everywhere the JWT is issued, read and checked.", 'Then I will plan the switch so both kinds of login work until old tokens expire.'] },
    { kind: 'work', key: 'w1', events: [toolEvent('t1', { name: 'Grep', target: 'jwt' }), toolEvent('t2', { target: 'src/auth/token.ts' }), toolEvent('t3', { target: 'src/auth/middleware.ts' })] },
    { kind: 'step', key: 's1', event: commandEvent('c1', { command: 'pnpm drizzle-kit generate --name add_sessions', output: CLEAN_OUTPUT, exitCode: 0, durationMs: 1_400 }) },
    { kind: 'work', key: 'w2', events: [editEvent('e1', { file: 'src/auth/session.ts', diff: { status: 'available', hunks: [{ header: '@@ -12,2 +12,3 @@', lines: DIFF }], added: 2, removed: 1, truncated: false } }), commandEvent('c2', { command: 'pnpm tsc --noEmit', output: TSC_OUTPUT, exitCode: 2, status: 'failed', durationMs: 2_900 })] },
    { kind: 'step', key: 's2', event: commandEvent('c3', { command: 'pnpm tsc --noEmit', output: TSC_OUTPUT, exitCode: 2, status: 'failed', durationMs: 2_900 }) },
    { kind: 'step', key: 's3', event: commandEvent('c4', { command: 'pnpm tsc --noEmit', output: 'No errors.', exitCode: 0, durationMs: 3_800 }) },
    { kind: 'step', key: 's4', event: commandEvent('c5', { command: LONG_COMMAND, output: 'Tests: 12 passed, 12 total', durationMs: 4_200 }) },
    { kind: 'step', key: 's5', event: editEvent('e2', { file: 'src/flags/settings.ts', diff: { status: 'available', hunks: [{ header: '@@ -12,2 +12,3 @@', lines: DIFF }], added: 2, removed: 1, truncated: false } }) },
    { kind: 'divider', key: 'd1', event: TURN },
    { kind: 'user', key: 'u2', event: messageEvent('u2', 'user', 'Should sessions be stored in Redis instead of Postgres? And does that change how logout reads the session?') },
    { kind: 'working', key: 'wk', phrase: 'running the full test suite' },
    { kind: 'agent', key: 'a2', turnId: 't2', status: 'completed', paragraphs: PROSE.split('\n\n') },
    { kind: 'changes', key: 'ch', files: ['src/flags/settings.ts', 'src/flags/index.ts', 'drizzle/0043_flags.sql', 'src/flags/settings.test.ts'], lines: { added: 186, removed: 41 }, turn: null },
  ]
  return (
    <div className="mx-chat" style={{ zoom: 1 }}>
      <div className="mx-chat-scroller flex flex-col">
        {rows.map((row) => <ChatItem key={row.key} row={row} {...ITEM_CONTEXT} />)}
      </div>
    </div>
  )
}
