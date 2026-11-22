import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSavedSettings, readSettingsPreferences, writeSettingsPreferences, type SettingsPreferences } from './preferences'

const DEFAULTS: SettingsPreferences = {
  spinner: 'braille',
  restoreLayout: true,
  reduceMotion: false,
  animateSidebarActivity: true,
  compactSidebar: false,
 
  notifyNeedsYou: true,
  notifyFinished: true,
  notifyError: true,
  notificationSound: false,
  terminalFontSize: 13,
  terminalFontFamily: '',
  terminalFontWeight: 400,
  terminalFontWeightBold: 700,
  startFolder: '',
  exportFolder: '',
  themeMode: 'system',
  darkTheme: 'Maiker Dark',
  lightTheme: 'Maiker Day',
  cursorStyle: 'block',
  scrollback: 10000, scrollSpeed: 1, terminalLineHeight: 1.2,
  
  
  defaultAgent: 'claude',
  confirmSkipped: [],
  sidebarWidth: 264, sidebarSide: 'left', terminalDock: 'bottom', terminalScreenReader: false, autoDownloadUpdates: true, restartWhenIdle: true, restartServiceWhenIdle: false, monthlyBudget: null, openSessionsIn: 'chat', hideSuccessfulTools: false, colourFileNames: true, bypassOff: [], updateMachines: true, perfOverlay: false, terminalPlainDrawing: false, cursorBlink: false, chatWidth: 'auto', chatTextSize: 100, keyOverrides: {},
}

describe('settings preferences', () => {
  beforeEach(() => { localStorage.clear() })

  it('opens a new session as a chat with Claude until told otherwise, and ignores a value it does not know', () => {
    expect(readSettingsPreferences()).toMatchObject({ defaultAgent: 'claude' })
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ defaultAgent: 'codex' }))
    expect(readSettingsPreferences()).toMatchObject({ defaultAgent: 'codex' })
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ defaultAgent: 'gemini' }))
    expect(readSettingsPreferences()).toMatchObject({ defaultAgent: 'claude' })
  })

  it('starts with a flat ground and a steady cursor, and keeps a stored choice', () => {
    expect(readSettingsPreferences()).toMatchObject({ cursorBlink: false })
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ cursorBlink: true }))
    expect(readSettingsPreferences()).toMatchObject({ cursorBlink: true })
  })

  it('installs updates when idle by default, and a stored off stays off', () => {
    expect(readSettingsPreferences().restartWhenIdle).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({}))
    expect(readSettingsPreferences().restartWhenIdle).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restartWhenIdle: false }))
    expect(readSettingsPreferences().restartWhenIdle).toBe(false)
  })

  it('restarts an older service by itself only when asked, and reads an old store without the key as off', () => {
    expect(readSettingsPreferences().restartServiceWhenIdle).toBe(false)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restartWhenIdle: true }))
    expect(readSettingsPreferences().restartServiceWhenIdle).toBe(false)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restartServiceWhenIdle: true }))
    expect(readSettingsPreferences().restartServiceWhenIdle).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restartServiceWhenIdle: 'yes' }))
    expect(readSettingsPreferences().restartServiceWhenIdle).toBe(false)
  })

  it('uses the defaults until preferences are saved', () => {
    expect(readSettingsPreferences()).toEqual(DEFAULTS)
  })

  it('restores every saved choice', () => {
    const saved: SettingsPreferences = { ...DEFAULTS, spinner: 'snake', restoreLayout: false, reduceMotion: true, notifyNeedsYou: false, notificationSound: true, terminalFontSize: 15, themeMode: 'dark', darkTheme: 'Tokyo Night', cursorStyle: 'underline', scrollback: 50000, }
    writeSettingsPreferences(saved)

    expect(readSettingsPreferences()).toEqual(saved)
  })

  it('keeps the choice to draw terminals without the GPU, and ignores a value that is not a switch', () => {
    writeSettingsPreferences({ ...DEFAULTS, terminalPlainDrawing: true })
    expect(readSettingsPreferences().terminalPlainDrawing).toBe(true)

    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalPlainDrawing: 'yes' }))
    expect(readSettingsPreferences().terminalPlainDrawing).toBe(false)
  })

  it('falls back safely when saved preferences are malformed', () => {
    localStorage.setItem('maiker.gui.settings.v1', '{')

    expect(readSettingsPreferences()).toEqual(DEFAULTS)
  })

  it('starts with the defaults when browser storage is blocked', () => {
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    try {
      expect(readSettingsPreferences()).toEqual(DEFAULTS)
      expect(hasSavedSettings()).toBe(false)
    } finally {
      blocked.mockRestore()
    }
  })

  it('reads preferences saved before the terminal settings existed', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ spinner: 'bars', restoreLayout: true, reduceMotion: false, animateSidebarActivity: true, compactSidebar: true, notifyNeedsYou: true, notifyFinished: false, notificationSound: false, terminalFontSize: 10, startFolder: '~/code' }))

    expect(readSettingsPreferences()).toEqual({ ...DEFAULTS, spinner: 'bars', compactSidebar: true, notifyFinished: false, terminalFontSize: 11, startFolder: '~/code', })
  })

  it('reads a saved line height of 1.6, the old default, as the new default, and keeps one that is still offered', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalLineHeight: 1.2 }))
    expect(readSettingsPreferences().terminalLineHeight).toBe(DEFAULTS.terminalLineHeight)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalLineHeight: 1 }))
    expect(readSettingsPreferences().terminalLineHeight).toBe(1)
  })

  it('reads the layout choice saved as restoreTabs before fleets, and prefers the new name', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restoreTabs: false }))
    expect(readSettingsPreferences().restoreLayout).toBe(false)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ restoreTabs: false, restoreLayout: true }))
    expect(readSettingsPreferences().restoreLayout).toBe(true)
  })

  it('reads the Claude view saved before there was one setting as the one setting, and a pre-redesign Terminal as Chat', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ chatViewDefault: { claude: 'terminal', codex: 'terminal', gemini: 'terminal' } }))
    expect(readSettingsPreferences().openSessionsIn).toBe('chat')
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ cornersEra: 2, chatViewDefault: { claude: 'terminal', codex: 'chat', gemini: 'chat' } }))
    expect(readSettingsPreferences().openSessionsIn).toBe('terminal')
  })

  it('colours file names unless that was turned off, as settings saved before it read', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({}))
    expect(readSettingsPreferences().colourFileNames).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ colourFileNames: false }))
    expect(readSettingsPreferences().colourFileNames).toBe(false)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ colourFileNames: 'yes' }))
    expect(readSettingsPreferences().colourFileNames).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ colourFileNames: false }))
    expect(readSettingsPreferences().colourFileNames).toBe(false)
  })

  it('shows every tool call unless hiding the successful ones was turned on, as settings saved before it read', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({}))
    expect(readSettingsPreferences().hideSuccessfulTools).toBe(false)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ hideSuccessfulTools: true }))
    expect(readSettingsPreferences().hideSuccessfulTools).toBe(true)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ hideSuccessfulTools: 'yes' }))
    expect(readSettingsPreferences().hideSuccessfulTools).toBe(false)
  })

  it('loads settings saved with the removed sidebar grouping and order, keeps the rest, and drops them on the next save', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ sidebarGroup: 'machine', sidebarOrder: 'priority', sidebarSide: 'right' }))
    const read = readSettingsPreferences()
    expect(read.sidebarSide).toBe('right')
    expect(read).not.toHaveProperty('sidebarGroup')
    expect(read).not.toHaveProperty('sidebarOrder')
    writeSettingsPreferences(read)
    const saved: unknown = JSON.parse(localStorage.getItem('maiker.gui.settings.v1') ?? '{}')
    expect(saved).not.toHaveProperty('sidebarGroup')
    expect(saved).not.toHaveProperty('sidebarOrder')
  })

  it('opens sessions in the chat unless a view was chosen, and ignores nonsense', () => {
    expect(readSettingsPreferences().openSessionsIn).toBe('chat')
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ openSessionsIn: 'terminal' }))
    expect(readSettingsPreferences().openSessionsIn).toBe('terminal')
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ openSessionsIn: 'sideways' }))
    expect(readSettingsPreferences().openSessionsIn).toBe('chat')
  })

  it('keeps the sidebar width in range', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ sidebarWidth: 5 }))
    expect(readSettingsPreferences().sidebarWidth).toBe(208)
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ sidebarWidth: 9999 }))
    expect(readSettingsPreferences().sidebarWidth).toBe(440)
  })

  it('loads settings saved with the removed look options, keeps the rest, and drops them on the next save', () => {
    const removed = { accent: 'violet', corners: 'square', cornersEra: 2, style: 'pixel', density: 'spacious', iconSize: 'large', iconColor: 'grayscale', sidebarTextSize: 17, tabTextSize: 12, toastPosition: 'top' }
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ ...removed, sidebarSide: 'right', chatTextSize: 125 }))

    const read = readSettingsPreferences()

    expect(read).toEqual({ ...DEFAULTS, sidebarSide: 'right', chatTextSize: 125 })
    writeSettingsPreferences(read)
    const saved = JSON.parse(localStorage.getItem('maiker.gui.settings.v1') ?? '{}') as Record<string, unknown>
    expect(Object.keys(removed).filter((key) => key !== 'cornersEra' && key in saved)).toEqual([])
  })

  it('keeps a valid terminal font and falls back to the defaults for nonsense', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalFontFamily: ' Fira Code ', terminalFontWeight: 500, terminalFontWeightBold: 800 }))
    expect(readSettingsPreferences()).toMatchObject({ terminalFontFamily: 'Fira Code', terminalFontWeight: 500, terminalFontWeightBold: 800 })
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalFontFamily: 'x"; background: red', terminalFontWeight: 450, terminalFontWeightBold: 'bold' }))
    expect(readSettingsPreferences()).toMatchObject({ terminalFontFamily: '', terminalFontWeight: 400, terminalFontWeightBold: 700 })
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ terminalFontFamily: 7, terminalFontWeight: null }))
    expect(readSettingsPreferences()).toMatchObject({ terminalFontFamily: '', terminalFontWeight: 400 })
  })

  it('ignores per-project colours saved by an older version, without an error', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ sidebarSide: 'right', projectColors: { '/code/maiker': 'violet' } }))

    const read = readSettingsPreferences()

    expect(read.sidebarSide).toBe('right')
    expect(read).not.toHaveProperty('projectColors')
  })

  it('keeps a theme saved under the old name Maitty', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ themeMode: 'light', darkTheme: 'Maitty Dark', lightTheme: 'Maitty Day' }))

    expect(readSettingsPreferences()).toMatchObject({ darkTheme: 'Maiker Dark', lightTheme: 'Maiker Day' })
  })

  it('carries over the theme chosen before the theme browser', () => {
    localStorage.setItem('maiker.gui.theme.v1', 'day')

    expect(readSettingsPreferences()).toMatchObject({ themeMode: 'light', lightTheme: 'Maiker Day', darkTheme: 'Maiker Dark' })
  })

  it('moves a single saved theme into its dark or light slot and keeps using it', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ theme: 'Tokyo Night' }))
    expect(readSettingsPreferences()).toMatchObject({ themeMode: 'dark', darkTheme: 'Tokyo Night', lightTheme: 'Maiker Day' })

    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ theme: 'Gruvbox Light' }))
    expect(readSettingsPreferences()).toMatchObject({ themeMode: 'light', lightTheme: 'Gruvbox Light', darkTheme: 'Maiker Dark' })
  })

  it('keeps each slot to its own kind of theme and the mode to its three values', () => {
    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ themeMode: 'dark', darkTheme: 'Maiker Day', lightTheme: 'Tokyo Night' }))
    expect(readSettingsPreferences()).toMatchObject({ themeMode: 'dark', darkTheme: 'Maiker Dark', lightTheme: 'Maiker Day' })

    localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ themeMode: 'auto', darkTheme: 'Maiker Dark' }))
    expect(readSettingsPreferences()).toMatchObject({ themeMode: 'system', darkTheme: 'Maiker Dark' })
  })

  it('has no monthly budget by default and keeps only a positive amount in range', () => {
    expect(readSettingsPreferences().monthlyBudget).toBeNull()
    for (const [stored, expected] of [[50, 50], [12.5, 12.5], [0, null], [-5, null], ['50', null], [2_000_000, null], [null, null]] as const) {
      localStorage.setItem('maiker.gui.settings.v1', JSON.stringify({ monthlyBudget: stored }))
      expect(readSettingsPreferences().monthlyBudget).toBe(expected)
    }
  })
})
