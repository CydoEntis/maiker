(function () {

const C = { fg: 'var(--fg)', fg2: 'var(--fg2)', mu: 'var(--muted)', dim: 'var(--dim)', work: 'var(--working)', ok: 'var(--ok)', bad: 'var(--danger)', warn: 'var(--warn)', blue: 'var(--blue)', br: 'var(--branch)', line: 'var(--line)', line2: 'var(--line2)' };
const MK = {
  waiting: ['·', 'waiting', C.dim], working: ['', 'working', C.work, 1], passed: ['✓', 'passed', C.ok], failed: ['✕', 'failed', C.bad],
  'sent back': ['↺', 'sent back', C.mu], needs: ['●', 'needs you', C.warn], skipped: ['–', 'skipped', C.dim], unknown: ['?', 'unknown', C.dim],
  ready: ['✓', 'ready', C.ok], merged: ['✓', 'merged', C.ok], rejected: ['✕', 'rejected at intake', C.bad], closed: ['–', 'closed by you', C.dim]
};
const mk = s => { const m = MK[s] || MK.unknown; return { g: m[0], word: m[1], c: m[2], spin: !!m[3] }; };
const S = (n, s, note, helper) => ({ n, s, note: note || '', helper: helper || '' });
const ALLPASS = (k) => [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written.', k + ' planner'), S('build', 'passed', 'Opened the PR. Checks pass.', k + ' builder'), S('review code', 'passed', 'No problems found.', k + ' code reviewer'), S('approve', 'passed', 'Approved.')];
const RUNS = {
  42: { key: 'MAITTY-42', title: 'Add CSV export to the activity page', upd: '2m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear. Acceptance criteria listed.'), S('spec', 'passed', 'Plan written. 4 files, 1 new endpoint.', 'MAITTY-42 spec'), S('build', 'working', 'Writing the export endpoint.', 'MAITTY-42 build'), S('review code', 'waiting'), S('review ui', 'waiting'), S('approve', 'waiting')] },
  38: { key: 'MAITTY-38', title: 'Retry failed webhooks with backoff', upd: 'just now', link: 1, steps: [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written. Retry queue with exponential backoff.', 'MAITTY-38 spec'), S('build', 'working', 'Fix round 2. Running the checks.', 'MAITTY-38 build'), S('review code', 'passed', 'No problems found.', 'MAITTY-38 review code'), S('review security', 'sent back', 'Found problems in round 1', 'MAITTY-38 review security'), S('approve', 'waiting')] },
  51: { key: 'MAITTY-51', title: 'Rate limit the public API', upd: '1m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear. Marked risky: touches the API gateway.'), S('spec', 'needs', 'Approve the spec before the build starts', 'MAITTY-51 spec'), S('build', 'waiting'), S('review code', 'waiting'), S('review security', 'waiting'), S('approve', 'waiting')] },
  1207: { key: 'MAITTY-1207', title: 'Let workspace admins export audit logs as Parquet files with per-tenant retention windows and signed download links', upd: '4m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written. 9 files, 1 migration.', 'MAITTY-1207 spec'), S('build', 'passed', 'Opened PR #214. Checks pass.', 'MAITTY-1207 build'), S('review code', 'working', 'Reading the diff. 2 of 9 files.', 'MAITTY-1207 review code'), S('review security', 'working', 'Checking the signed download links.', 'MAITTY-1207 review security'), S('review ui', 'passed', 'No problems found.', 'MAITTY-1207 review ui'), S('approve', 'waiting')] },
  7: { key: '', name: 'kitchen 007', upd: '30s ago', steps: [S('intake', 'passed', 'No ticket. Using the task from the chat.'), S('spec', 'working', 'Writing the plan.', 'kitchen 007 spec'), S('build', 'waiting'), S('review code', 'waiting'), S('approve', 'waiting')] },
  61: { key: 'MAITTY-61', title: 'Move nightly cron jobs onto the queue', upd: '3m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written.', 'MAITTY-61 spec'), S('build', 'working', 'Running the checks.', 'MAITTY-61 build'), S('review code', 'waiting'), S('approve', 'waiting')] },
  47: { key: 'MAITTY-47', title: 'Improve the billing emails', upd: '22m ago', link: 1, steps: [S('intake', 'failed', 'Kitchen did not take this ticket', 'MAITTY-47 intake'), S('spec', 'skipped'), S('build', 'skipped'), S('review code', 'skipped'), S('approve', 'skipped')], end: 'rejected' },
  33: { key: 'MAITTY-33', title: 'Show refunds on the invoice page', upd: '15m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written.', 'MAITTY-33 spec'), S('build', 'passed', 'Opened PR #208. Checks pass.', 'MAITTY-33 build'), S('review code', 'skipped', 'Closed by you.'), S('review ui', 'skipped', 'Closed by you.'), S('approve', 'skipped', 'Closed by you.')], end: 'closed' },
  64: { key: 'MAITTY-64', title: 'Upgrade the payments SDK to v5', upd: '6m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear.'), S('spec', 'passed', 'Plan written.', 'MAITTY-64 spec'), S('build', 'needs', 'Out of fix rounds. 2 checks still fail.', 'MAITTY-64 build'), S('review code', 'sent back', 'Found problems in round 1', 'MAITTY-64 review code'), S('approve', 'waiting')] },
  58: { key: 'MAITTY-58', title: 'Drop the legacy invoices table', upd: '1m ago', link: 1, steps: [S('intake', 'passed', 'Ticket is clear. Marked risky: deletes data.'), S('spec', 'passed', 'Plan approved by you.', 'MAITTY-58 spec'), S('build', 'passed', 'Opened PR #219. Checks pass.', 'MAITTY-58 build'), S('review code', 'passed', 'No problems found.', 'MAITTY-58 review code'), S('review security', 'passed', 'No problems found.', 'MAITTY-58 review security'), S('approve', 'needs', 'High risk, so the merge is your call', 'MAITTY-58 approve')] },
  29: { key: 'MAITTY-29', title: 'Add pagination to the orders list', upd: '1h ago', link: 1, steps: ALLPASS('MAITTY-29'), end: 'ready' },
  30: { key: 'MAITTY-30', title: 'Fix the empty cart message', upd: '1h ago', link: 1, steps: ALLPASS('MAITTY-30'), end: 'merged' },
  31: { key: 'MAITTY-31', title: 'Remember the last used currency', upd: '50m ago', link: 1, steps: ALLPASS('MAITTY-31'), end: 'ready' }
};
const H = {
  'MAITTY-1207 review security': ["Review the security of MAITTY-1207","Opus 4.5 · High","working","Reading src/export/signedUrl.ts",""],
  'MAITTY-1207 review ui': ["Review the UI of MAITTY-1207","Sonnet 5 · Medium","done","No problems found","The export dialog matches the settings page patterns."],
  'MAITTY-64 spec': ["Write the plan for MAITTY-64","Opus 4.5 · High","done","Wrote spec.md","Bump the SDK, update 3 call sites, and replace the removed refund helper."],
  'MAITTY-64 build': ["Build MAITTY-64 from the spec and open the PR","Sonnet 5 · Medium","stopped","Stopped after fix round 2","2 checks still fail: payments.test.ts and refunds.test.ts."],
  'MAITTY-64 review code': ["Review the code of MAITTY-64","Opus 4.5 · High","done","Found problems in round 1","The new SDK changes the error type; two catch blocks no longer match."],
  'MAITTY-58 spec': ["Write the plan for MAITTY-58","Opus 4.5 · High","done","Wrote spec.md","Back up the table, drop it, and remove the 4 places that still read it."],
  'MAITTY-58 build': ["Build MAITTY-58 from the spec and open the PR","Sonnet 5 · Medium","done","Opened PR #219","All checks pass."],
  'MAITTY-58 review code': ["Review the code of MAITTY-58","Opus 4.5 · High","done","No problems found",""],
  'MAITTY-58 review security': ["Review the security of MAITTY-58","Opus 4.5 · High","done","No problems found",""],
  'MAITTY-58 approve': ["Decide whether MAITTY-58 can be merged","Opus 4.5 · High","done","Left the merge to you","The ticket is high risk, so auto-merge does not apply."],
  'MAITTY-42 spec': ['Write the plan for MAITTY-42', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'Four changes: an export route, a CSV writer, a button on the activity page, and tests for each.'],
  'MAITTY-42 build': ['Build MAITTY-42 from the spec and open the PR', 'Sonnet 5 · Medium', 'working', 'Editing src/routes/export.ts', ''],
  'MAITTY-38 spec': ['Write the plan for MAITTY-38', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'Failed deliveries go on a retry queue with exponential backoff, up to 6 tries over 12 hours.'],
  'MAITTY-38 build': ['Fix the security review findings for MAITTY-38', 'Sonnet 5 · Medium', 'working', 'Running pnpm test (fix round 2)', ''],
  'MAITTY-38 review code': ['Review the code for MAITTY-38', 'Sonnet 5 · High', 'done', 'Finished the review', 'No problems found.'],
  'MAITTY-38 review security': ['Review MAITTY-38 for security problems', 'Opus 4.5 · High', 'done', 'Finished the review', 'Two problems. The webhook signature is compared with ===, so use a constant-time compare. The retry URL is logged with its token.'],
  'MAITTY-51 spec': ['Write the plan for MAITTY-51', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'A token bucket per API key, 100 requests a minute, returning 429 with Retry-After. It changes the gateway middleware that every request goes through.'],
  'MAITTY-1207 spec': ['Write the plan for MAITTY-1207', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'Parquet writer, a retention migration and a signed download route.'],
  'MAITTY-1207 build': ['Build MAITTY-1207 from the spec and open the PR', 'Sonnet 5 · Medium', 'done', 'Opened PR #214', 'Opened PR #214. All checks pass.'],
  'MAITTY-1207 review code': ['Review the code for MAITTY-1207', 'Sonnet 5 · High', 'working', 'Reading src/export/parquet.ts', ''],
  'kitchen 007 spec': ['Write a plan for: move the feature flags into the settings table', 'Opus 4.5 · High', 'working', 'Reading src/flags', ''],
  'MAITTY-61 spec': ['Write the plan for MAITTY-61', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'Each cron job becomes a scheduled queue job, so a failed run retries instead of waiting a day.'],
  'MAITTY-61 build': ['Build MAITTY-61 from the spec and open the PR', 'Sonnet 5 · Medium', 'working', 'Running the checks', ''],
  'MAITTY-47 intake': ['Check that MAITTY-47 can be worked on', 'Haiku 4.5 · Low', 'failed', 'Finished the check', 'The ticket has no acceptance criteria, so there is nothing to test the work against.'],
  'MAITTY-33 spec': ['Write the plan for MAITTY-33', 'Opus 4.5 · High', 'done', 'Wrote spec.md', 'A refunds section on the invoice page, reading the refunds table.'],
  'MAITTY-33 build': ['Build MAITTY-33 from the spec and open the PR', 'Sonnet 5 · Medium', 'done', 'Opened PR #208', 'Opened PR #208. All checks pass.']
};

function info(id) {
    const r = RUNS[id]; const name = r.key || r.name; const needs = r.steps.find(s => s.s === 'needs');
    let st, cur;
    if (r.end) { st = r.end; cur = r.end === 'rejected' ? r.steps[0] : r.end === 'closed' ? (r.steps.find(s => s.note.startsWith('Closed by you')) || r.steps.find(s => s.s === 'skipped') || r.steps[r.steps.length - 1]) : r.steps[r.steps.length - 1]; }
    else if (needs) { st = 'needs'; cur = needs; }
    else { st = 'working'; cur = r.steps.find(s => s.s === 'working') || r.steps.find(s => s.s === 'waiting') || r.steps[0]; }
    const rm = r.steps.map(s => (s.note.match(/Fix round (\d)/) || [])[1]).find(Boolean);
    const nWork = r.steps.filter(s => s.s === 'working').length;
    const tag = st === 'needs' ? 'needs you' : r.end ? MK[r.end][1] : rm ? 'round ' + rm : '';
    const tagC = st === 'needs' ? C.warn : r.end === 'rejected' ? C.bad : r.end ? (r.end === 'closed' ? C.dim : C.ok) : C.mu;
    const step = r.end ? MK[r.end][1] : nWork > 1 ? nWork + ' reviews' : cur.n;
    return { id, r, name, title: r.title || '', st, cur, tag, tagC, step, note: (st === 'working' && nWork > 1) ? r.steps.filter(s => s.s === 'working').map(s => s.n).join(' and ') + ' are working.' : cur.note };
  }
const SUBS = {
  x: [
    { label: 'map every JWT check', model: 'Sonnet 5 · Medium', s: 'working', act: 'Searching src/ for verifyJwt', asked: 'Find every place that reads or checks a JWT and list them with file and line.', ran: ['rg verifyJwt src', 'rg "Bearer " src'], answer: '' },
    { label: 'write the session store', model: 'Sonnet 5 · Medium', s: 'working', act: 'Editing src/auth/sessionStore.ts', asked: 'Write a Redis-backed session store with create, read, touch and destroy.', ran: ['pnpm test auth/sessionStore'], answer: '' },
    { label: 'update the login tests', model: 'Haiku 4.5 · Low', s: 'working', act: 'Running pnpm test auth', asked: 'Change the login tests to expect a session cookie instead of a token.', ran: ['pnpm test auth'], answer: '' },
    { label: 'check cookie settings', model: 'Opus 4.5 · High', s: 'done', act: '', asked: 'Check which cookie flags we need for the session cookie behind our proxy.', ran: ['rg "trust proxy" src'], answer: 'Use HttpOnly, Secure and SameSite=Lax. The proxy already sets X-Forwarded-Proto, so trust proxy must stay on.' },
    { label: 'read the auth docs', model: 'Haiku 4.5 · Low', s: 'done', act: '', asked: 'Summarise docs/auth.md and list anything that mentions tokens.', ran: [], answer: 'Three sections mention tokens: Login, API keys and Logout. API keys are separate and should stay as they are.' }
  ],
  b: [
    { label: 'check migration order', model: 'Sonnet 5 · Medium', s: 'done', act: '', asked: 'Check that the refunds migration runs after the payments one.', ran: ['pnpm db:status'], answer: 'Order is correct. 0041 payments runs before 0042 refunds.' },
    { label: 'write refund tests', model: 'Sonnet 5 · Medium', s: 'working', act: 'Writing tests/refunds.test.ts', asked: 'Write tests for full and partial refunds, including the over-refund error.', ran: ['pnpm test refunds'], answer: '' },
    { label: 'try the old webhook', model: 'Haiku 4.5 · Low', s: 'failed', act: '', asked: 'Replay the old refund webhook against the new endpoint.', ran: ['curl -X POST localhost:4000/webhooks/refund'], answer: 'Could not reach localhost:4000. The dev server is not running.' }
  ],
  k1: [
    { label: 'check bundle size', model: 'Haiku 4.5 · Low', s: 'done', act: '', asked: 'Check whether the CSV export adds more than 20 KB to the activity page bundle.', ran: ['pnpm build --stats'], answer: 'It adds 6 KB. The CSV writer is loaded only when you click Export.' }
  ]
};
window.KitchenData = { C, MK, mk, RUNS, H, info, SUBS };
})();
