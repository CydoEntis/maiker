import { describe, expect, it } from 'vitest'
import { isMarkdownPath, readmeOf, resolveDocumentLink } from './documentPaths'

describe('document paths', () => {
  it('knows markdown files by extension, in any case', () => {
    expect(['a.md', 'docs/B.MD', 'x.markdown', 'y.mdx'].every(isMarkdownPath)).toBe(true)
    expect(['a.txt', 'md', 'a.md.bak', 'notes'].some(isMarkdownPath)).toBe(false)
  })

  it('picks a project README, a markdown one first', () => {
    expect(readmeOf(['LICENSE', 'Readme.md', 'src'])).toBe('Readme.md')
    expect(readmeOf(['README', 'a.md'])).toBeNull()
    expect(readmeOf([])).toBeNull()
  })

  it('resolves a link against the document it is written in', () => {
    expect(resolveDocumentLink('README.md', 'docs/setup.md')).toBe('docs/setup.md')
    expect(resolveDocumentLink('docs/setup.md', './more.md#top')).toBe('docs/more.md')
    expect(resolveDocumentLink('docs/setup.md', '../README.md?x=1')).toBe('README.md')
    expect(resolveDocumentLink('a/b/c.md', 'd%20e.md')).toBe('a/b/d e.md')
  })

  it('refuses everything that leaves the project or is not a markdown file', () => {
    for (const target of ['../outside.md', '../../x.md', '/etc/passwd.md', 'C:\\x.md', '\\\\host\\share.md', 'https://x.test/a.md', 'javascript:alert(1)', '#top', '', 'image.png', '.git/config.md', 'a\\..\\b.md', '%2e%2e/%2e%2e/x.md', 'a%00.md']) {
      expect(resolveDocumentLink('README.md', target), target).toBeNull()
    }
    expect(resolveDocumentLink('docs/a.md', '../../x.md')).toBeNull()
  })
})
