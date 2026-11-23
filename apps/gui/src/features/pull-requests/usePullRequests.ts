import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadPullRequests } from '@/api/pullRequests'
import { onPullRequestOpened } from '@/data/pullRequestNews'
import { useWindowActive } from '@/lib/window-activity'
import { needsYouCount, pullsKey, type ProjectPulls, type PullsProject } from './model'

/** How often every project is asked again while the window is in front: five minutes. */
export const PULLS_POLL_MS = 300_000

/** The window's pull requests: what each opened project's machine last said, and how many need the person. */
export type PullRequests = {
  /** By `pullsKey`. A project that was never asked has no entry. */
  readonly projects: ReadonlyMap<string, ProjectPulls>
  /** Pull requests that need the person, across the opened projects. */
  readonly needsYou: number
  /** Asks `project`'s machine again; `fresh` goes past the list that machine keeps for a minute. */
  readonly refresh: (project: PullsProject, fresh: boolean) => void
}

const NOT_ASKED: ProjectPulls = { answer: null, loading: true }

/**
 * Each opened project's open pull requests, read from the project's own machine. The window asks, never a timer of the
 * daemon's: when it comes to the front, every five minutes while it stays there, when a project is opened, when this
 * window opens a pull request, and when a surface asks (`refresh`). With the window behind another nothing is asked.
 *
 * `machineOf` gives the number of a machine that can be asked now, or null for one that is not connected: its projects
 * keep what they last said until it is back.
 */
export function usePullRequestsState({ projects, machineOf }: { projects: readonly PullsProject[]; machineOf: (machineName: string | null) => number | null }): PullRequests {
  const [known, setKnown] = useState<ReadonlyMap<string, ProjectPulls>>(new Map())
  const active = useWindowActive()
  const asking = useRef(new Set<string>())
  const latest = useRef({ projects, machineOf })
  useEffect(() => { latest.current = { projects, machineOf } }, [projects, machineOf])

  const ask = useCallback((project: PullsProject, fresh: boolean) => {
    const machine = latest.current.machineOf(project.machineName)
    const key = pullsKey(project)
    // One question a project at a time: a second trigger while the first is out would only repeat it.
    if (machine === null || asking.current.has(key)) return
    asking.current.add(key)
    setKnown((current) => new Map(current).set(key, { answer: current.get(key)?.answer ?? null, loading: true }))
    void loadPullRequests(machine, project.folder, fresh).then((answer) => {
      asking.current.delete(key)
      setKnown((current) => new Map(current).set(key, { answer, loading: false }))
    })
  }, [])
  const askAll = useCallback((fresh: boolean) => {
    for (const project of latest.current.projects) ask(project, fresh)
  }, [ask])

  // Which projects can be asked now, as one value: a project opened or a machine back on its line asks again.
  const askable = projects.filter((project) => machineOf(project.machineName) !== null).map(pullsKey).sort().join('\n\n')
  useEffect(() => {
    if (!active) return
    askAll(false)
    const timer = window.setInterval(() => { askAll(false) }, PULLS_POLL_MS)
    return () => { window.clearInterval(timer) }
  }, [active, askable, askAll])
  useEffect(() => onPullRequestOpened(() => { askAll(true) }), [askAll])

  // A project taken off the sidebar is no longer counted, whatever was last heard of it.
  const shown = useMemo(() => {
    const kept = new Map<string, ProjectPulls>()
    for (const project of projects) {
      const key = pullsKey(project)
      const entry = known.get(key)
      if (entry !== undefined) kept.set(key, entry)
    }
    return kept
  }, [projects, known])
  const needsYou = useMemo(() => needsYouCount(shown.values()), [shown])
  return useMemo(() => ({ projects: shown, needsYou, refresh: ask }), [shown, needsYou, ask])
}

/** What is known of `project`'s pull requests; one never asked reads as being asked. */
export function pullsOf(pulls: PullRequests, project: PullsProject): ProjectPulls {
  return pulls.projects.get(pullsKey(project)) ?? NOT_ASKED
}
