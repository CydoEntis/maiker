import { describe, expect, it } from 'vitest'
import { agentGroups, backFrom, continueFrom, detectProjectsFolder, installableAgent, keyStep, projectTags, settingsFromSetup, skipFrom, stepTheme } from './setup'

describe('the stages of the first run', () => {
  it('continues from the drawing to setup, to style, and then ends by applying', () => {
    expect(continueFrom('intro')).toEqual({ stage: 'setup' })
    expect(continueFrom('setup')).toEqual({ stage: 'style' })
    expect(continueFrom('style')).toEqual({ end: 'finish' })
  })

  it('goes back from style only', () => {
    expect(backFrom('style')).toBe('setup')
    expect(backFrom('setup')).toBe('setup')
  })

  it('skips the drawing to the window, and the window to the end that applies nothing', () => {
    expect(skipFrom('intro')).toEqual({ stage: 'setup' })
    expect(skipFrom('setup')).toEqual({ end: 'skip' })
    expect(skipFrom('style')).toEqual({ end: 'skip' })
  })
})

describe('keys in the window', () => {
  it('continues on Enter, except on a button or in a field', () => {
    expect(keyStep('setup', 'Enter', 'other')).toEqual({ kind: 'continue' })
    expect(keyStep('style', 'Enter', 'choice')).toEqual({ kind: 'continue' })
    expect(keyStep('setup', 'Enter', 'action')).toBeNull()
    expect(keyStep('setup', 'Enter', 'field')).toBeNull()
  })

  it('slides the theme with the arrows on the style screen only, and leaves a choice group its own arrows', () => {
    expect(keyStep('style', 'ArrowRight', 'other')).toEqual({ kind: 'theme', by: 1 })
    expect(keyStep('style', 'ArrowLeft', 'action')).toEqual({ kind: 'theme', by: -1 })
    expect(keyStep('style', 'ArrowRight', 'choice')).toBeNull()
    expect(keyStep('setup', 'ArrowRight', 'other')).toBeNull()
  })

  it('goes round at both ends of the themes', () => {
    const names = ['a', 'b', 'c']
    expect(stepTheme(names, 'c', 1)).toBe('a')
    expect(stepTheme(names, 'a', -1)).toBe('c')
    expect(stepTheme(names, 'a', 1)).toBe('b')
  })
})

describe('the projects folder offered', () => {
  const found = [{ path: '/home/ada/code', projects: ['api', 'web'] }, { path: '/home/ada/dev', projects: ['one'] }, { path: '/home/ada/src', projects: [] }]

  it('is the saved folder when there is one', () => {
    expect(detectProjectsFolder('/work', '/home/ada', found)).toEqual({ path: '/work', origin: 'saved' })
  })

  it('is the folder with the most git projects, and home when none holds any', () => {
    expect(detectProjectsFolder('', '/home/ada', found)).toEqual({ path: '/home/ada/code', origin: 'detected' })
    expect(detectProjectsFolder('', '/home/ada', [{ path: '/home/ada/src', projects: [] }])).toEqual({ path: '/home/ada', origin: 'home' })
  })

  it('names the first projects and counts the rest', () => {
    expect(projectTags(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toEqual({ shown: ['a', 'b', 'c', 'd', 'e'], more: 2 })
  })
})

describe('the agent list', () => {
  const programs = (rows: ReadonlyArray<{ agent: { program: string } }>) => rows.map((row) => row.agent.program)

  it('is unknown until the scan answers', () => {
    expect(agentGroups(null, {})).toBeNull()
  })

  it('lists the installed agents first, and moves one up when it is installed from here', () => {
    const before = agentGroups(['claude'], {})
    expect(programs(before?.installed ?? [])).toEqual(['claude'])
    expect(programs(before?.missing ?? [])).toContain('gemini')
    const after = agentGroups(['claude'], { gemini: '0.6.1' })
    expect(after?.installed.find((row) => row.agent.program === 'gemini')?.version).toBe('0.6.1')
    expect(programs(after?.missing ?? [])).not.toContain('gemini')
  })

  it('offers an install only for the agents the desktop shell can install', () => {
    expect(installableAgent('codex')).toBe('codex')
    expect(installableAgent('cursor-agent')).toBeNull()
  })
})

describe('what the last button saves', () => {
  it('saves the folder and the view, and leaves the theme alone when none was slid to', () => {
    expect(settingsFromSetup({ folder: '/home/ada/code', home: '/home/ada', view: 'terminal', theme: null })).toEqual({ startFolder: '/home/ada/code', openSessionsIn: 'terminal' })
  })

  it('saves the home folder as no folder set', () => {
    expect(settingsFromSetup({ folder: '/home/ada', home: '/home/ada', view: 'chat', theme: null }).startFolder).toBe('')
  })

  it('saves a theme slid to in the mode that shows it', () => {
    expect(settingsFromSetup({ folder: '', home: '/home/ada', view: 'chat', theme: { name: 'Paper', light: true } })).toMatchObject({ themeMode: 'light', lightTheme: 'Paper' })
    expect(settingsFromSetup({ folder: '', home: '/home/ada', view: 'chat', theme: { name: 'Midnight', light: false } })).toMatchObject({ themeMode: 'dark', darkTheme: 'Midnight' })
  })
})
