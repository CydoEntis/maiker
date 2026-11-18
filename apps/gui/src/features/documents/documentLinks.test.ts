import { describe, expect, it } from 'vitest'
import { documentTargetOf, routeDocumentLinks } from './documentLinks'

describe('document links', () => {
  it('turns a link to a neighbouring markdown file into a document address and back', () => {
    const routed = routeDocumentLinks('See [the setup](docs/setup.md#top) and [web](https://example.com/a.md).')
    expect(routed).toContain('https://example.com/a.md')
    const address = /\((https:\/\/document\.invalid[^)]*)\)/.exec(routed)?.[1] ?? ''
    expect(documentTargetOf(new URL(address).href)).toBe('docs/setup.md#top')
  })

  it('keeps ../ in the target, which an address would have folded away', () => {
    const routed = routeDocumentLinks('[up](../x.md)')
    const address = /\((https:\/\/document\.invalid[^)]*)\)/.exec(routed)?.[1] ?? ''
    expect(documentTargetOf(new URL(address).href)).toBe('../x.md')
  })

  it('leaves code, other links and plain text as written', () => {
    const source = ['```', '[a](docs/a.md)', '```', 'inline `[b](docs/b.md)` code', '[img](pic.png) [js](javascript:alert(1)) [anchor](#x)'].join('\n')
    expect(routeDocumentLinks(source)).toBe(source)
  })

  it('does not take any other address for a document', () => {
    expect(documentTargetOf('https://example.com/?to=a.md')).toBeNull()
    expect(documentTargetOf('javascript:alert(1)')).toBeNull()
  })
})
