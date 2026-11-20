import { describe, expect, it } from 'vitest'
import { placeOf } from './sessionPlace'

const SESSION = { machineName: null, machine: 0, pane: 4, repoName: 'maiker', repoRoot: '/home/a/dev/maiker', cwdLabel: '~/dev/maiker', cwd: '/home/a/dev/maiker', branch: 'dev', worktree: false }

describe('placeOf', () => {
  it('reads the place from what the session list holds', () => {
    expect(placeOf(SESSION)).toEqual({ machine: null, project: 'maiker', branch: 'dev', worktree: false, folder: '/home/a/dev/maiker', machineId: 0, pane: 4, worktreeName: null })
  })

  it('uses the folder for the project outside a repository, and keeps the machine and worktree', () => {
    expect(placeOf({ ...SESSION, repoName: null, branch: null, machineName: 'build-box', worktree: true })).toMatchObject({ machine: 'build-box', project: '~/dev/maiker', branch: null, worktree: true })
  })

  it('names a linked worktree by its folder', () => {
    expect(placeOf({ ...SESSION, worktree: true, repoRoot: 'C:\\dev\\maiker-worktrees\\amber-fox' }).worktreeName).toBe('amber-fox')
  })
})
