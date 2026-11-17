import { describe, expect, it } from 'vitest'
import { toRepositoryIndex } from './repositorySource'

describe('toRepositoryIndex', () => {
  it('turns the daemon\'s 0 for "not known" into null', () => {
    const index = toRepositoryIndex({
      repos: [
        { path: '/a', branch: 'main', lastUsed: 0 },
        { path: '/b', branch: null, lastUsed: 1700000000 },
      ],
      indexedAt: 0,
      more: false,
    })
    expect(index.indexedAt).toBeNull()
    expect(index.repos.map((repo) => repo.lastUsed)).toEqual([null, 1700000000])
  })
})
