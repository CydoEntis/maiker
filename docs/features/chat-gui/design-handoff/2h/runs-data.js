// Shared mock data for the workflow-run mocks (Run View, Run Sidebar, Workflow Runs).
(function () {
  const W = (name) => ({ name, st: 'waiting' });
  const P = (name, note) => ({ name, st: 'passed', note });
  const RUNS = {
    smooth: { key: 'MAITTY-42', title: 'Add CSV export', link: true, time: '2m ago', session: 'Kitchen · acme-store',
      steps: [P('intake'), P('spec', 'Spec approved.'), { name: 'build', st: 'working', note: 'Writing the exporter and its tests.', helper: 'MAITTY-42 builder' }, W('review code'), W('review security'), W('approve'), W('pull request')] },
    needs: { key: 'MAITTY-51', title: 'Rate limit the public API', link: true, time: 'just now', session: 'Kitchen · acme-store',
      steps: [P('intake'), { name: 'spec', st: 'needs', note: 'Approve the spec before the build starts.', helper: 'MAITTY-51 spec writer' }, W('build'), W('review code'), W('review security'), W('approve'), W('pull request')] },
    loop: { key: 'MAITTY-38', title: 'Retry failed webhooks', link: true, time: '4m ago', session: 'Kitchen · acme-store',
      steps: [P('intake'), P('spec'), { name: 'build', st: 'working', round: 2, note: 'Fix round 2. Running the checks.', helper: 'MAITTY-38 builder' }, { name: 'review code', st: 'sent', round: 1, note: 'Sent back: retries don\u2019t back off, and there is no test for the 5xx case.', helper: 'MAITTY-38 code reviewer' }, W('review security'), W('approve'), W('pull request')] },
    failed: { key: 'MAITTY-33', title: 'Migrate the sessions table', link: true, time: '18m ago', session: 'Kitchen · billing-api',
      steps: [P('intake'), P('spec'), { name: 'build', st: 'failed', round: 2, note: 'Checks still failing after 2 rounds: 3 tests in sessions.spec.ts.', helper: 'MAITTY-33 builder' }, { name: 'review code', st: 'sent', round: 2, note: 'Sent back twice. Stopped at the round limit.', helper: 'MAITTY-33 code reviewer' }, { name: 'review security', st: 'skipped' }, { name: 'approve', st: 'skipped' }, { name: 'pull request', st: 'skipped' }] },
    done: { key: 'MAITTY-29', title: 'Dark mode for Settings', link: true, time: '1h ago', session: 'Kitchen · acme-store', pr: '#418',
      steps: [P('intake'), P('spec'), P('build', 'Passed on the first round.'), P('review code'), P('review security'), P('approve', 'Approved by you.'), P('pull request', 'PR #418 is open and ready for review.')] },
    declined: { key: 'MAITTY-47', title: '', link: true, time: '26m ago', session: 'Kitchen · billing-api',
      steps: [{ name: 'intake', st: 'failed', note: 'Turned down: the ticket has no acceptance criteria. Add them and run it again.', helper: 'MAITTY-47 intake' }, { name: 'spec', st: 'skipped' }, { name: 'build', st: 'skipped' }, { name: 'review code', st: 'skipped' }, { name: 'approve', st: 'skipped' }, { name: 'pull request', st: 'skipped' }] },
    long: { key: 'MAITTY-1207', title: 'Let workspace admins export every audit log event for a date range as CSV, JSON or Parquet, filtered by actor and resource type', link: false, time: '7m ago', session: 'Kitchen · acme-store',
      steps: [P('intake'), P('spec'), { name: 'build', st: 'working', note: 'Fix round 1. The Parquet writer fails on events with nested metadata, so I\u2019m flattening those fields first and adding a fixture with 40k events to check memory stays under the 512 MB limit before the reviewers start.', helper: 'MAITTY-1207 builder with a long helper name' }, W('review code'), W('review security'), W('approve'), W('pull request')] }
  };
  const SQ = 'M1.5 1.5H10.5V10.5H1.5Z', BIG = 'M.75 .75H11.25V11.25H.75Z';
  const MARK = {
    waiting: { label: 'Waiting', c: 'var(--dim)', d1: 'M1.65 1.65H10.35V10.35H1.65Z', s1: 'var(--dim)', w1: '1.3', da: '2.2 1.6', d2: '', f2: 'none', s2: 'none', anim: 'none' },
    working: { label: 'Working', c: 'var(--working)', d1: SQ, s1: 'var(--working)', w1: '1.5', da: 'none', d2: 'M4 4H8V8H4Z', f2: 'var(--working)', s2: 'none', anim: 'wrPulse 1.8s ease-in-out infinite' },
    passed: { label: 'Passed', c: 'var(--ok)', d1: SQ, s1: 'var(--ok)', w1: '1.5', da: 'none', d2: 'M3.8 6.2 5.4 7.8 8.4 4.5', f2: 'none', s2: 'var(--ok)', anim: 'none' },
    failed: { label: 'Failed', c: 'var(--danger)', d1: BIG + 'M6 4.87 7.83 3.03 8.97 4.17 7.13 6 8.97 7.83 7.83 8.97 6 7.13 4.17 8.97 3.03 7.83 4.87 6 3.03 4.17 4.17 3.03Z', f1: 'var(--danger)', s1: 'none', w1: '0', da: 'none', d2: '', f2: 'none', s2: 'none', anim: 'none' },
    sent: { label: 'Sent back', c: 'var(--mag)', d1: SQ, s1: 'var(--mag)', w1: '1.5', da: 'none', d2: 'M7.8 7.6H5.2a1.7 1.7 0 0 1 0-3.4H8M6.5 2.8 5.1 4.2 6.5 5.6', f2: 'none', s2: 'var(--mag)', anim: 'none' },
    needs: { label: 'Needs you', c: 'var(--warn)', d1: BIG + 'M5.25 2.6V6.9H6.75V2.6ZM5.25 7.9V9.4H6.75V7.9Z', f1: 'var(--warn)', s1: 'none', w1: '0', da: 'none', d2: '', f2: 'none', s2: 'none', anim: 'none' },
    skipped: { label: 'Skipped', c: 'var(--dim)', d1: SQ, s1: 'var(--line2)', w1: '1.3', da: 'none', d2: 'M3.4 8.6 8.6 3.4', f2: 'none', s2: 'var(--dim)', anim: 'none' }
  };
  const mark = st => ({ f1: 'none', ...MARK[st] });
  const current = r => {
    const order = ['needs', 'failed', 'working', 'sent'];
    for (const s of order) { const i = r.steps.findIndex(x => x.st === s); if (i >= 0) return i; }
    const w = r.steps.findIndex(x => x.st === 'waiting'); return w >= 0 ? w : r.steps.length - 1;
  };
  const runState = r => { const s = r.steps.map(x => x.st); if (s.includes('needs')) return 'needs'; if (s.includes('failed')) return 'failed'; if (s.every(x => x === 'passed')) return 'passed'; return s.includes('working') ? 'working' : 'waiting'; };
  window.MaittyRuns = { RUNS, mark, current, runState };
})();
