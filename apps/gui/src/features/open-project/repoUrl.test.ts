import { describe, expect, it } from 'vitest'
import { readGitUrl } from './repoUrl'

const repoOf = (text: string) => {
  const reading = readGitUrl(text)
  return reading.kind === 'repo' ? reading.repo : null
}

describe('reading a pasted repository URL', () => {
  it('reads an https URL and gives back the https address', () => {
    expect(repoOf('https://github.com/linkables/linkables-web')).toEqual({ host: 'github.com', owner: 'linkables', name: 'linkables-web', address: 'https://github.com/linkables/linkables-web.git' })
    expect(repoOf('https://github.com/o/r.git/')?.address).toBe('https://github.com/o/r.git')
  })

  it('reads the ssh short form and keeps it as ssh', () => {
    expect(repoOf('git@gitlab.com:team/app.git')).toEqual({ host: 'gitlab.com', owner: 'team', name: 'app', address: 'git@gitlab.com:team/app.git' })
  })

  it('reads host/owner/repo as https', () => {
    expect(repoOf('github.com/cstin/maiker')?.address).toBe('https://github.com/cstin/maiker.git')
  })

  it('cuts a GitHub page under the repository, but keeps a group path elsewhere', () => {
    expect(repoOf('https://github.com/o/r/tree/main/src')?.name).toBe('r')
    expect(repoOf('https://gitlab.com/group/sub/app')).toMatchObject({ owner: 'group/sub', name: 'app' })
  })

  it('never carries a pasted user name or password on', () => {
    expect(readGitUrl('https://me:secret@github.com/o/r').kind).toBe('credentials')
  })

  it.each(['owner/repo', 'github.com', 'not a url', 'https://github.com/only-owner', 'C:\\code\\app', 'git@github.com:', 'https://github.com/-bad/repo', 'file:///etc/passwd'])('says %s is not a git URL', (text) => {
    expect(readGitUrl(text).kind).toBe('not-a-url')
  })

  it('reads nothing from empty text', () => {
    expect(readGitUrl('   ').kind).toBe('empty')
  })
})
