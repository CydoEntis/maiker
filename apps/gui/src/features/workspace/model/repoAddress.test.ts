import { describe, expect, it } from 'vitest'
import { carriesCredentials, cloneParentFor, cloneTargetOf, DEFAULT_CLONE_PARENT, explainCloneFailure, parseRepoAddress } from './repoAddress'
import { openViewFor } from './chatView'

describe('reading a pasted repository address', () => {
  it.each([
    ['https://github.com/octo/widgets', 'https://github.com/octo/widgets.git'],
    ['https://github.com/octo/widgets.git', 'https://github.com/octo/widgets.git'],
    ['https://github.com/octo/widgets/tree/main/src?tab=readme#top', 'https://github.com/octo/widgets.git'],
    ['github.com/octo/widgets', 'https://github.com/octo/widgets.git'],
    ['git@github.com:octo/widgets.git', 'git@github.com:octo/widgets.git'],
    ['octo/widgets', 'https://github.com/octo/widgets.git'],
  ])('reads %s and builds the address again from the two names', (pasted, address) => {
    const repo = parseRepoAddress(pasted)
    expect(repo).toMatchObject({ owner: 'octo', name: 'widgets', address })
  })

  it('marks a plain owner/name as bare, so a project search is not taken for a clone', () => {
    expect(parseRepoAddress('octo/widgets')?.bare).toBe(true)
    expect(parseRepoAddress('https://github.com/octo/widgets')?.bare).toBe(false)
  })

  it.each([
    'https://gitlab.com/octo/widgets',
    'file:///etc/passwd',
    'ext::sh -c id',
    '--upload-pack=evil/x',
    'octo/-flag',
    'octo/..',
    '../widgets',
    'a/b/c',
    'https://github.com/octo',
    'https://me:token@github.com/octo/widgets',
    '/home/me/widgets',
    '',
  ])('does not read %s as a GitHub repository', (pasted) => {
    expect(parseRepoAddress(pasted)).toBeNull()
  })

  it('tells an address with a user name or token in it from one without', () => {
    expect(carriesCredentials('https://me:ghp_x@github.com/o/r.git')).toBe(true)
    expect(carriesCredentials('https://token@github.com/o/r.git')).toBe(true)
    expect(carriesCredentials('https://github.com/o/r.git')).toBe(false)
    expect(carriesCredentials('git@github.com:o/r.git')).toBe(false)
  })
})

describe('where a clone goes', () => {
  it('is the last folder used on that machine, else ~/Projects', () => {
    expect(cloneParentFor('/srv/code')).toBe('/srv/code')
    expect(cloneParentFor(null)).toBe(DEFAULT_CLONE_PARENT)
    expect(cloneParentFor('   ')).toBe('~/Projects')
  })

  it('names the folder it would make, whatever the separator on the end', () => {
    expect(cloneTargetOf('~/Projects', 'widgets')).toBe('~/Projects/widgets')
    expect(cloneTargetOf('C:\\code\\', 'widgets')).toBe('C:\\code/widgets')
  })
})

describe('what a failed clone says', () => {
  it('names a folder that is already there, with the folder, so it can be used', () => {
    expect(explainCloneFailure('/home/me/Projects/widgets is already there')).toMatchObject({ kind: 'exists', folder: '/home/me/Projects/widgets', message: 'There is already a folder called widgets there. Use it, or pick another folder.' })
  })

  it.each([
    "fatal: repository 'https://github.com/o/r/' not found",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    'fatal: Authentication failed for https://github.com/o/r.git/',
    'git@github.com: Permission denied (publickey).',
  ])('says a repository that needs a sign-in plainly: %s', (said) => {
    const problem = explainCloneFailure(said)
    expect(problem.kind).toBe('auth')
    expect(problem.message).toContain('cannot sign you in to GitHub yet')
    expect(problem.message).not.toContain('fatal')
  })

  it('says a link that is not a repository, and a server that cannot be reached', () => {
    expect(explainCloneFailure('Use an https://, ssh:// or git:// address, or the git@host:owner/name form').kind).toBe('bad-address')
    expect(explainCloneFailure("fatal: unable to access 'https://x.invalid/o/r.git/': Could not resolve host: x.invalid").kind).toBe('unreachable')
    expect(explainCloneFailure('There is no folder /nope').kind).toBe('no-folder')
  })

  it('shows a reason nothing here knows as it came', () => {
    expect(explainCloneFailure('git is not installed on this machine')).toEqual({ kind: 'other', message: 'git is not installed on this machine' })
    expect(explainCloneFailure('').message).toBe('The repository was not cloned.')
  })
})

describe('the view a new session opens in', () => {
  it('is what Settings says, except Gemini, which always opens in its terminal', () => {
    expect(openViewFor('claude', 'chat')).toBe('chat')
    expect(openViewFor('codex', 'terminal')).toBe('terminal')
    expect(openViewFor('gemini', 'chat')).toBe('terminal')
  })
})
