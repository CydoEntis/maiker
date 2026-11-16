import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { linkOf, resetTicketLinksForTest, useTicketLinks } from './ticketLinks'
import { ticketProjects } from './ticketProjects'

const fake = vi.hoisted(() => ({ links: null as ReturnType<typeof import('@/test/fakeTicketLinks').fakeTicketLinks> | null }))
vi.mock('@/api/ticketLinks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/ticketLinks')>()
  const { fakeTicketLinks } = await import('@/test/fakeTicketLinks')
  fake.links = fakeTicketLinks({ '/home/me/shop-wt': '/home/me/shop' })
  return { ...real, ...fake.links.api }
})

const OLD_STORAGE_KEY = 'maitty.gui.ticketLinks.v1'

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

function links() {
  if (fake.links === null) throw new Error('the daemon fake is made when the module is mocked')
  return fake.links
}

beforeEach(() => {
  localStorage.clear()
  resetTicketLinksForTest()
  links().set([])
})

describe('ticket links', () => {
  it('reads what the daemon keeps for the project a worktree is in', async () => {
    links().set([{ machine: null, folder: '/home/me/shop', link: { github: 'me/shop', plane: null, linear: null } }])
    const { result } = renderHook(() => useTicketLinks({ machineName: null, folder: '/home/me/shop-wt' }), { wrapper })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(result.current.data?.project?.folder).toBe('/home/me/shop')
    expect(linkOf(result.current.data).github).toBe('me/shop')
  })

  it("moves this computer's links from the window's storage to the daemon once, then forgets them", async () => {
    localStorage.setItem(OLD_STORAGE_KEY, JSON.stringify({
      projects: {
        '0:/home/me/blog': { github: '', plane: null, linear: { id: 'linear:team.1', name: 'Core' } },
        '2:/srv/other': { github: 'me/other', plane: null, linear: null },
      },
      me: { plane: 'Ada', linear: '' },
    }))
    const { result } = renderHook(() => useTicketLinks({ machineName: null, folder: '/home/me/blog' }), { wrapper })
    await waitFor(() => { expect(result.current.isSuccess).toBe(true) })
    expect(linkOf(result.current.data)).toEqual({ github: '', plane: null, linear: { id: 'linear:team.1', name: 'Core' } })
    expect(links().projects).toHaveLength(1)
    expect(links().me.plane).toBe('Ada')
    expect(localStorage.getItem(OLD_STORAGE_KEY)).toBeNull()
  })

  it('treats a project never linked as linked to nothing', () => {
    expect(linkOf(undefined)).toEqual({ github: null, plane: null, linear: null })
  })
})

describe('the projects Settings can link', () => {
  const session = (change: Partial<{ repoRoot: string | null; cwd: string; repoName: string | null; machine: number; machineName: string | null; title: string; ended: boolean }>) => ({ repoRoot: null, cwd: '/home/me/x', repoName: null, machine: 0, machineName: null, title: '', ended: false, ...change })

  it('lists each open project once, by its repository root and machine, in name order', () => {
    const projects = ticketProjects([
      session({ repoRoot: '/home/me/shop', cwd: '/home/me/shop/web', repoName: 'shop' }),
      session({ repoRoot: '/home/me/shop', cwd: '/home/me/shop/api', repoName: 'shop' }),
      session({ cwd: '/home/me/blog' }),
      session({ cwd: '/home/me/old', ended: true }),
      session({ repoRoot: '/home/me/shop', repoName: 'shop', machine: 2, machineName: 'kingdom' }),
    ])
    expect(projects.map((project) => project.linkKey)).toEqual([':/home/me/blog', ':/home/me/shop', 'kingdom:/home/me/shop'])
    expect(projects[1]).toEqual({ name: 'shop', linkKey: ':/home/me/shop', folder: '/home/me/shop', machine: 0, machineName: null })
  })
})
