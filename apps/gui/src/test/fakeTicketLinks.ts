import type { LinkedProject, ProjectLink, RepoTicketFile, TicketLinksAnswer, TicketMe, TicketPlace } from '@/api/ticketLinks'
import type { KeyedProvider, TicketsResult } from '@/api/tickets'

/**
 * The daemon's ticket links for tests, kept in memory: the same answers `api/ticketLinks.ts` gives, with a worktree
 * folder taken to its repository when `roots` says so. Mock `@/api/ticketLinks` with `fake.api` (and `NO_LINK`).
 */
export function fakeTicketLinks(roots: Readonly<Record<string, string>> = {}) {
  let projects: LinkedProject[] = []
  let me: TicketMe = { plane: '', linear: '' }
  /** A repository file per project root: what it names, filling what is not linked here, as the daemon merges it. */
  const files = new Map<string, { link: Partial<ProjectLink>; notes: string[] }>()
  const resolve = (place: TicketPlace): TicketPlace => ({ machine: place.machine, folder: place.machine === null ? roots[place.folder] ?? place.folder : place.folder })
  const same = (a: TicketPlace, b: TicketPlace) => a.machine === b.machine && a.folder === b.folder
  const empty = (link: ProjectLink) => link.github === null && link.plane === null && link.linear === null
  const answer = (place: TicketPlace | null): Promise<TicketsResult<TicketLinksAnswer>> => {
    let repoFile: RepoTicketFile | null = null
    const project = place === null ? null : (() => {
      const at = resolve(place)
      const local = projects.find((each) => same(each, at))?.link ?? { github: null, plane: null, linear: null }
      const file = at.machine === null ? files.get(at.folder) : undefined
      if (file === undefined) return { ...at, link: local }
      const github = local.github === null && file.link.github != null
      const plane = local.plane === null && file.link.plane != null
      const linear = local.linear === null && file.link.linear != null
      repoFile = { github, plane, linear, notes: [...file.notes] }
      return { ...at, link: { github: github ? file.link.github ?? null : local.github, plane: plane ? file.link.plane ?? null : local.plane, linear: linear ? file.link.linear ?? null : local.linear } }
    })()
    return Promise.resolve({ ok: true, value: { project, projects: [...projects], me: { ...me }, repoFile } })
  }
  const api = {
    loadTicketLinks: (place: TicketPlace | null) => answer(place),
    saveTicketLink: (place: TicketPlace, link: ProjectLink) => {
      const at = resolve(place)
      projects = projects.filter((each) => !same(each, at))
      if (!empty(link)) projects.push({ ...at, link })
      return answer(place)
    },
    unlinkTicketProject: (place: TicketPlace) => {
      const at = resolve(place)
      projects = projects.filter((each) => !same(each, at))
      return answer(place)
    },
    saveTicketName: (provider: KeyedProvider, name: string) => {
      me = provider === 'Plane' ? { ...me, plane: name } : { ...me, linear: name }
      return answer(null)
    },
    importTicketLinks: (incoming: readonly LinkedProject[], names: TicketMe) => {
      for (const project of incoming) {
        const at = resolve(project)
        if (!empty(project.link) && !projects.some((each) => same(each, at))) projects.push({ ...at, link: project.link })
      }
      me = { plane: me.plane || names.plane, linear: me.linear || names.linear }
      return answer(null)
    },
  }
  return {
    api,
    /** The repository at `root` has a `.maitty/tickets.toml` naming `link`. */
    setRepoFile(root: string, link: Partial<ProjectLink>, notes: string[] = []) { files.set(root, { link, notes }) },
    /** Starts from these links, as if set before. */
    set(next: LinkedProject[], names: TicketMe = { plane: '', linear: '' }) { projects = next; me = names },
    get projects(): readonly LinkedProject[] { return projects },
    get me(): TicketMe { return me },
  }
}
