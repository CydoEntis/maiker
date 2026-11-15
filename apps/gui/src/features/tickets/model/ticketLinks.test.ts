import { beforeEach, describe, expect, it } from 'vitest'
import { linkOf, NO_LINK, projectLinkKey, resetTicketLinksForTest, setMyName, setProjectLink } from './ticketLinks'
import { ticketProjects } from './ticketProjects'

const STORAGE_KEY = 'maitty.gui.ticketLinks.v1'

function stored(): unknown {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
}

beforeEach(() => {
  localStorage.clear()
  resetTicketLinksForTest()
})

describe('ticket links', () => {
  it('keeps each project by its machine and folder, changing only the field given', () => {
    const key = projectLinkKey(0, '/home/me/shop')
    setProjectLink(key, { github: 'me/shop' })
    setProjectLink(key, { plane: { id: 'plane:p1', name: 'Shop' } })
    expect(stored()).toEqual({ projects: { [key]: { github: 'me/shop', plane: { id: 'plane:p1', name: 'Shop' }, linear: null } }, me: { plane: '', linear: '' } })
  })

  it('keeps names trimmed', () => {
    setMyName('linear', '  Cydo ')
    expect(stored()).toMatchObject({ me: { linear: 'Cydo' } })
  })

  it('starts from nothing when what is stored is not a store', () => {
    localStorage.setItem(STORAGE_KEY, '{"projects": {"0:/x": {"github": 7}}}')
    resetTicketLinksForTest()
    setMyName('plane', 'Cydo')
    expect(stored()).toEqual({ projects: {}, me: { plane: 'Cydo', linear: '' } })
  })

  it('treats a project never linked as linked to nothing', () => {
    expect(linkOf({ projects: {}, me: { plane: '', linear: '' } }, '0:/x')).toEqual(NO_LINK)
  })
})

describe('the projects Settings can link', () => {
  const session = (change: Partial<{ repoRoot: string | null; cwd: string; repoName: string | null; machine: number; title: string; ended: boolean }>) => ({ repoRoot: null, cwd: '/home/me/x', repoName: null, machine: 0, title: '', ended: false, ...change })

  it('lists each open project once, by its repository root, in name order', () => {
    const projects = ticketProjects([
      session({ repoRoot: '/home/me/shop', cwd: '/home/me/shop/web', repoName: 'shop' }),
      session({ repoRoot: '/home/me/shop', cwd: '/home/me/shop/api', repoName: 'shop' }),
      session({ cwd: '/home/me/blog' }),
      session({ cwd: '/home/me/old', ended: true }),
      session({ repoRoot: '/home/me/shop', repoName: 'shop', machine: 2 }),
    ])
    expect(projects.map((project) => project.linkKey)).toEqual(['0:/home/me/blog', '0:/home/me/shop', '2:/home/me/shop'])
    expect(projects[1]).toEqual({ name: 'shop', linkKey: '0:/home/me/shop', folder: '/home/me/shop', machine: 0 })
  })
})
