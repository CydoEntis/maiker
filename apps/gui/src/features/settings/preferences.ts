import { isSpinnerStyle, type SpinnerStyle } from '@/lib/spinner-styles'
import { DEFAULT_FONT_WEIGHT, DEFAULT_FONT_WEIGHT_BOLD, isFontFamily, isFontWeight, type TerminalFontWeight } from '@/lib/terminalFont'
import { readThemePreference, type ThemePreference } from '@/data/themePreference'
import { DEFAULT_LIGHT_THEME, DEFAULT_THEME, THEMES, type ThemeMode } from '@/features/workspace/theme/themes'
import { detectPlatform, NO_OVERRIDES, readKeyOverrides, type KeyOverrides } from '@/features/workspace/model/shortcuts'
import { type ChatAgent, type PaneView } from '@/features/workspace/model/chatView'
import { SIDEBAR_SORTS, type SidebarSort } from '@/features/workspace/model/sidebarTree'
import { skippedConfirmsOf, type SkippedConfirms } from '@/features/confirm/confirm'

export type CursorStyle = 'block' | 'bar' | 'underline'
/** How wide the chat's column of messages may be: sized to the pane, a fixed narrow or wide column, or the whole pane. */
export type ChatWidth = 'auto' | 'narrow' | 'wide' | 'full'
export const CHAT_WIDTHS: readonly ChatWidth[] = ['auto', 'narrow', 'wide', 'full']
/** The sizes the chat's text can be drawn at, as a percentage of its design size. */
const CHAT_TEXT_SMALL = 90
export const CHAT_TEXT_SIZE_DEFAULT = 100
const CHAT_TEXT_LARGE = 110
const CHAT_TEXT_LARGER = 125
const CHAT_TEXT_LARGEST = 140
export const CHAT_TEXT_SIZES: readonly number[] = [CHAT_TEXT_SMALL, CHAT_TEXT_SIZE_DEFAULT, CHAT_TEXT_LARGE, CHAT_TEXT_LARGER, CHAT_TEXT_LARGEST]
/**
 * The sizes the whole window can be drawn at (Settings › Appearance › Interface size), as a percentage of the design
 * size. The default is a step up: at the design size the text and icons read small on a laptop screen.
 */
const INTERFACE_SMALL = 90
const INTERFACE_DESIGN = 100
export const INTERFACE_SIZE_DEFAULT = 110
const INTERFACE_LARGER = 125
const INTERFACE_LARGEST = 140
export const INTERFACE_SIZES: readonly number[] = [INTERFACE_SMALL, INTERFACE_DESIGN, INTERFACE_SIZE_DEFAULT, INTERFACE_LARGER, INTERFACE_LARGEST]
/** The typeface the chat is written in: the app's own (Inter), the system's, a serif or the monospace. */
export type ChatFont = 'inter' | 'system' | 'serif' | 'mono'
export const CHAT_FONTS: readonly ChatFont[] = ['inter', 'system', 'serif', 'mono']
/** Which side of the window the sidebar sits on. */
export type SidebarSide = 'left' | 'right'
/** Where the terminal dock sits beside the chat: under it, on its right, or in its place. */
export type TerminalDock = 'bottom' | 'right' | 'full'

const SCROLLBACK_SHORT = 5000
const SCROLLBACK_DEFAULT = 10000
const SCROLLBACK_LONG = 50000
const SCROLLBACK_LONGEST = 100000
export const SCROLLBACK_CHOICES = [SCROLLBACK_SHORT, SCROLLBACK_DEFAULT, SCROLLBACK_LONG, SCROLLBACK_LONGEST] as const
export type ScrollbackLines = (typeof SCROLLBACK_CHOICES)[number]
/** Lines scrolled per wheel notch, as a multiple of xterm's default (`scrollSensitivity`). */
const SCROLL_NORMAL = 1
const SCROLL_DOUBLE = 2
const SCROLL_TRIPLE = 3
const SCROLL_FASTEST = 5
export const SCROLL_SPEED_CHOICES = [SCROLL_NORMAL, SCROLL_DOUBLE, SCROLL_TRIPLE, SCROLL_FASTEST] as const
export type ScrollSpeed = (typeof SCROLL_SPEED_CHOICES)[number]
/**
 * The terminal's row height as a multiple of the font size. Pixel art drawn in block characters (an agent's banner) joins up at 1
 * to 1.2 and stretches past it. 1.6 was once offered and the default; it is gone, so a saved 1.6 reads as the new default.
 */
const LINE_TIGHT = 1
const LINE_SNUG = 1.2
const LINE_EASY = 1.4
export const LINE_HEIGHT_CHOICES = [LINE_TIGHT, LINE_SNUG, LINE_EASY] as const
export type TerminalLineHeight = (typeof LINE_HEIGHT_CHOICES)[number]
export const DEFAULT_LINE_HEIGHT: TerminalLineHeight = LINE_SNUG

export type SettingsPreferences = {
  spinner: SpinnerStyle
  /** Reopen the panes and splits of last time at launch. Saved as `restoreTabs` before fleets; that name is still read. */
  restoreLayout: boolean
  /** The line at the foot of the window: version, update, usage and the Commands and Shortcuts keys. */
  statusBar: boolean
  reduceMotion: boolean
  /** File names in a chat's messages are drawn in the colour of their type. */
  colourFileNames: boolean
  /** The desktop sidebar is collapsed to its rail. */
  compactSidebar: boolean
  notifyNeedsYou: boolean
  notifyFinished: boolean
  notificationSound: boolean
  terminalFontSize: number
  /** One family name for the terminal text; empty uses the bundled Geist Mono. */
  terminalFontFamily: string
  terminalFontWeight: TerminalFontWeight
  terminalFontWeightBold: TerminalFontWeight
  /** Where a new session starts. Empty: your home folder. */
  startFolder: string
  /** Where a block saved from a chat goes; empty is the Downloads folder. */
  exportFolder: string
  /** Which theme is in use: your dark one, your light one, or whichever the system asks for. */
  themeMode: ThemeMode
  /** The theme names used in dark and in light (Settings › Appearance). */
  darkTheme: string
  lightTheme: string
  cursorStyle: CursorStyle
  /** Lines each pane keeps; the daemon keeps the full history. */
  scrollback: ScrollbackLines
  scrollSpeed: ScrollSpeed
  terminalLineHeight: TerminalLineHeight
  /** Mirror the terminal's text into the page for screen readers. It makes every pane much heavier to draw. */
  terminalScreenReader: boolean
  /** The docked sidebar's width in px; dragged with the mouse. */
  sidebarWidth: number
  sidebarSide: SidebarSide
  /** How the sidebar orders its projects, picked in its filter menu. */
  sidebarSort: SidebarSort
  terminalDock: TerminalDock
  /** The keys chosen in Settings › Hotkeys, in place of the actions' own. */
  keyOverrides: KeyOverrides
  /** How wide the chat's messages run; `auto` grows with the pane, so a large screen is used. */
  chatWidth: ChatWidth
  /** The size of everything in the chat, as a percentage (`CHAT_TEXT_SIZES`). */
  chatTextSize: number
  /** The typeface of the chat's messages; code stays in the monospace. */
  chatFont: ChatFont
  /** The size of the whole window, as a percentage (`INTERFACE_SIZES`): the webview's own zoom. */
  interfaceSize: number
  /** Which view a Claude or Codex session opens in. Terminal until you change it. */
  /** The view a new session opens in; the other is one click away on its pane. */
  openSessionsIn: PaneView
  /** The agent a new session starts. */
  defaultAgent: ChatAgent
  /** The confirms the person ticked "Don't ask again" on: their actions run straight away. */
  confirmSkipped: SkippedConfirms
  /** The chat leaves out runs of reads and searches that succeeded (`isQuietRun`). Off until you turn it on. */
  hideSuccessfulTools: boolean
  /**
   * The agents switched off in Settings › Permissions › Bypass Permissions. Every other agent starts without permission
   * prompts (its own flag; a chat with its skip-permissions mode). Shared with the terminal app (`[permissions.bypass]`).
   */
  bypassOff: readonly ChatAgent[]
  /** Remote machines update themselves after this computer does, once their agents are idle. Shared with the terminal app (`[updates] machines`). */
  updateMachines: boolean
  /** The terminal cursor blinks while its pane is focused. xterm drives it, so it is off by default. */
  cursorBlink: boolean
  /** Fetch a new release in the background. Installing still waits for a restart. */
  autoDownloadUpdates: boolean
  /** Restart into a downloaded update when no session is working or waiting on you. */
  /** Install a downloaded update while the app is idle. Kept under its old key so a stored choice carries over. */
  restartWhenIdle: boolean
  /** Restart an older service by itself once no agent is working, waiting on you or starting. Off by default: the restart stops running shells. */
  restartServiceWhenIdle: boolean
  /** Monthly spend in US dollars the Usage page's ring measures against; null is no budget (the default). Kept here because the daemon serves none. */
  monthlyBudget: number | null
}

/** Large enough for any real budget; a typo of extra digits is refused rather than stored. */
export const MONTHLY_BUDGET_MAX = 1_000_000

/** A budget from storage or the page: a positive amount in range, else none. */
export function validBudget(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value > 0 && value <= MONTHLY_BUDGET_MAX ? value : null
}

export const TERMINAL_FONT_SIZE_MIN = 11
export const TERMINAL_FONT_SIZE_MAX = 16
export const SIDEBAR_WIDTH_MIN = 208
export const SIDEBAR_WIDTH_MAX = 440
export const SIDEBAR_WIDTH_DEFAULT = 264

const STORAGE_KEY = 'maiker.gui.settings.v1'

// The theme was stored on its own before the desktop theme browser; carry that choice over.
const THEME_FROM_PREFERENCE: Record<ThemePreference, string> = { night: DEFAULT_THEME, abyss: DEFAULT_THEME, day: DEFAULT_LIGHT_THEME }

function defaults(): SettingsPreferences {
  const legacy = THEME_FROM_PREFERENCE[readThemePreference()]
  return {
    spinner: 'braille',
    restoreLayout: true,
    statusBar: true,
    reduceMotion: false,
    compactSidebar: false,
    notifyNeedsYou: true,
    notifyFinished: true,
    notificationSound: false,
    terminalFontSize: 13,
    terminalFontFamily: '',
    terminalFontWeight: DEFAULT_FONT_WEIGHT,
    terminalFontWeightBold: DEFAULT_FONT_WEIGHT_BOLD,
    startFolder: '',
    exportFolder: '',
    // The theme chosen before there were two slots keeps its look; otherwise follow the system.
    themeMode: legacy === DEFAULT_LIGHT_THEME ? 'light' : 'system',
    darkTheme: DEFAULT_THEME,
    lightTheme: DEFAULT_LIGHT_THEME,
    cursorStyle: 'block',
    scrollback: SCROLLBACK_DEFAULT,
    scrollSpeed: SCROLL_NORMAL,
    terminalLineHeight: DEFAULT_LINE_HEIGHT,
    terminalScreenReader: false,
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    sidebarSide: 'left',
    sidebarSort: 'recent',
    terminalDock: 'bottom',
    keyOverrides: NO_OVERRIDES,
    chatWidth: 'auto',
    chatTextSize: CHAT_TEXT_SIZE_DEFAULT,
    chatFont: 'inter',
    interfaceSize: INTERFACE_SIZE_DEFAULT,
    openSessionsIn: 'chat',
    defaultAgent: 'claude',
    confirmSkipped: [],
    hideSuccessfulTools: false,
    colourFileNames: true,
    bypassOff: [],
    updateMachines: true,
    cursorBlink: false,
    autoDownloadUpdates: true,
    restartWhenIdle: true,
    restartServiceWhenIdle: false,
    monthlyBudget: null,
  }
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

/** Whether any settings were ever saved: a window with none has never been used. */
export function hasSavedSettings(): boolean {
  return readStored() !== null
}

/** Browser storage can be blocked; that reads as nothing saved, and the app still starts. */
function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * The redesign made the Chat view the default, after Terminal had been saved as a plain default. A blob saved before
 * that has no era marker, so its Terminal is an old default, not a choice: it reads as the new default. From the marker
 * on, a saved choice wins. The marker keeps the name it was first saved under.
 */
const CORNERS_ERA_KEY = 'cornersEra'
const CORNERS_ERA = 2

/** The agents a Bypass Permissions switch can name. */
export const BYPASS_AGENTS: readonly ChatAgent[] = ['claude', 'codex', 'gemini']

/** The agents named, when this is a list of them; null otherwise. */
export function bypassOffOf(value: unknown): ChatAgent[] | null {
  if (!Array.isArray(value)) return null
  return BYPASS_AGENTS.filter((agent) => value.includes(agent))
}

/** Whether `agent` starts without permission prompts: on unless switched off. */
export function bypasses(preferences: Pick<SettingsPreferences, 'bypassOff'>, agent: ChatAgent): boolean {
  return !preferences.bypassOff.includes(agent)
}

export function readSettingsPreferences(): SettingsPreferences {
  const fresh = defaults()
  const stored = readStored()
  if (stored === null) return fresh
  try {
    const value: unknown = JSON.parse(stored)
    if (typeof value !== 'object' || value === null) return fresh
    const preferences = value as Partial<Record<keyof SettingsPreferences, unknown>>
    const fallback = fresh
    const saved = value as { restoreTabs?: unknown }
    return {
      spinner: isSpinnerStyle(preferences.spinner) ? preferences.spinner : fallback.spinner,
      restoreLayout: bool(preferences.restoreLayout ?? saved.restoreTabs, fallback.restoreLayout),
      statusBar: bool(preferences.statusBar, fallback.statusBar),
      reduceMotion: bool(preferences.reduceMotion, fallback.reduceMotion),
      compactSidebar: bool(preferences.compactSidebar, fallback.compactSidebar),
      notifyNeedsYou: bool(preferences.notifyNeedsYou, fallback.notifyNeedsYou),
      notifyFinished: bool(preferences.notifyFinished, fallback.notifyFinished),
      notificationSound: bool(preferences.notificationSound, fallback.notificationSound),
      terminalFontSize: terminalFontSize(preferences.terminalFontSize, fallback.terminalFontSize),
      terminalFontFamily: isFontFamily(preferences.terminalFontFamily) ? preferences.terminalFontFamily.trim() : fallback.terminalFontFamily,
      terminalFontWeight: isFontWeight(preferences.terminalFontWeight) ? preferences.terminalFontWeight : fallback.terminalFontWeight,
      terminalFontWeightBold: isFontWeight(preferences.terminalFontWeightBold) ? preferences.terminalFontWeightBold : fallback.terminalFontWeightBold,
      startFolder: typeof preferences.startFolder === 'string' ? preferences.startFolder.trim() : fallback.startFolder,
      exportFolder: typeof preferences.exportFolder === 'string' ? preferences.exportFolder.trim() : fallback.exportFolder,
      ...themeChoice(preferences, fallback),
      cursorStyle: isCursorStyle(preferences.cursorStyle) ? preferences.cursorStyle : fallback.cursorStyle,
      scrollback: isScrollback(preferences.scrollback) ? preferences.scrollback : fallback.scrollback,
      scrollSpeed: isScrollSpeed(preferences.scrollSpeed) ? preferences.scrollSpeed : fallback.scrollSpeed,
      terminalLineHeight: LINE_HEIGHT_CHOICES.find((choice) => choice === preferences.terminalLineHeight) ?? fallback.terminalLineHeight,
      terminalScreenReader: bool(preferences.terminalScreenReader, fallback.terminalScreenReader),
      sidebarWidth: clampNumber(preferences.sidebarWidth, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, fallback.sidebarWidth),
      sidebarSide: preferences.sidebarSide === 'left' || preferences.sidebarSide === 'right' ? preferences.sidebarSide : fallback.sidebarSide,
      sidebarSort: SIDEBAR_SORTS.find((sort) => sort === preferences.sidebarSort) ?? fallback.sidebarSort,
      terminalDock: terminalDockOf(preferences.terminalDock) ?? fallback.terminalDock,
      chatWidth: CHAT_WIDTHS.find((width) => width === preferences.chatWidth) ?? fallback.chatWidth,
      chatTextSize: CHAT_TEXT_SIZES.find((size) => size === preferences.chatTextSize) ?? fallback.chatTextSize,
      chatFont: CHAT_FONTS.find((font) => font === preferences.chatFont) ?? fallback.chatFont,
      interfaceSize: INTERFACE_SIZES.find((size) => size === preferences.interfaceSize) ?? fallback.interfaceSize,
      // Before one setting there was one per agent: what was chosen for Claude carries over.
      openSessionsIn: paneView(preferences.openSessionsIn, (value as Record<string, unknown>)[CORNERS_ERA_KEY] === CORNERS_ERA ? paneView(((value as Record<string, unknown>).chatViewDefault as { claude?: unknown } | null | undefined)?.claude, fallback.openSessionsIn) : fallback.openSessionsIn),
      defaultAgent: preferences.defaultAgent === 'claude' || preferences.defaultAgent === 'codex' ? preferences.defaultAgent : fallback.defaultAgent,
      confirmSkipped: skippedConfirmsOf(preferences.confirmSkipped) ?? fallback.confirmSkipped,
      hideSuccessfulTools: bool(preferences.hideSuccessfulTools, fallback.hideSuccessfulTools),
      colourFileNames: bool(preferences.colourFileNames, fallback.colourFileNames),
      // The old Yolo and Full access switches are not read: they were off by default, not a choice to keep.
      bypassOff: bypassOffOf(preferences.bypassOff) ?? fallback.bypassOff,
      updateMachines: bool(preferences.updateMachines, fallback.updateMachines),
      cursorBlink: bool(preferences.cursorBlink, fallback.cursorBlink),
      autoDownloadUpdates: bool(preferences.autoDownloadUpdates, fallback.autoDownloadUpdates),
      restartWhenIdle: bool(preferences.restartWhenIdle, fallback.restartWhenIdle),
      restartServiceWhenIdle: bool(preferences.restartServiceWhenIdle, fallback.restartServiceWhenIdle),
      monthlyBudget: validBudget(preferences.monthlyBudget),
      // The keys were pressed on this computer, so they are checked against this platform's table.
      keyOverrides: readKeyOverrides(preferences.keyOverrides, detectPlatform(navigator.userAgent)),
    }
  } catch {
    console.warn('Ignoring invalid Maiker settings')
    return fresh
  }
}

export function writeSettingsPreferences(preferences: SettingsPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...preferences, [CORNERS_ERA_KEY]: CORNERS_ERA }))
}


// Sizes saved outside the 11–16 range are kept as the nearest size in it.
function terminalFontSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, value))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}


const isThemeMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'dark' || value === 'light'

/** A saved theme name, if it is a known theme of the wanted kind. */
/** The app was called Maitty: a theme saved under that name ("Maitty Night") is the same theme under the new one. */
const RENAMED_THEME = /^Maitty /

const themeOfKind = (saved: unknown, light: boolean): string | null => {
  const value = typeof saved === 'string' ? saved.replace(RENAMED_THEME, 'Maiker ') : saved
  return typeof value === 'string' && THEMES.some((theme) => theme.name === value && theme.light === light) ? value : null
}

/** The mode and both slots. Settings saved with one theme keep it: it fills its own slot and the mode pins to it. */
function themeChoice(saved: Partial<Record<string, unknown>>, fallback: SettingsPreferences): Pick<SettingsPreferences, 'themeMode' | 'darkTheme' | 'lightTheme'> {
  const old = typeof saved.theme === 'string' ? THEMES.find((theme) => theme.name === saved.theme) : undefined
  const migrating = old !== undefined && !('themeMode' in saved)
  return {
    themeMode: isThemeMode(saved.themeMode) ? saved.themeMode : migrating ? (old.light ? 'light' : 'dark') : fallback.themeMode,
    darkTheme: themeOfKind(saved.darkTheme, false) ?? (migrating && !old.light ? old.name : fallback.darkTheme),
    lightTheme: themeOfKind(saved.lightTheme, true) ?? (migrating && old.light ? old.name : fallback.lightTheme),
  }
}

const paneView = (value: unknown, fallback: PaneView): PaneView => (value === 'chat' || value === 'terminal' ? value : fallback)

function isCursorStyle(value: unknown): value is CursorStyle {
  return value === 'block' || value === 'bar' || value === 'underline'
}

function isScrollSpeed(value: unknown): value is ScrollSpeed {
  return SCROLL_SPEED_CHOICES.some((choice) => choice === value)
}

function isScrollback(value: unknown): value is ScrollbackLines {
  return SCROLLBACK_CHOICES.some((choice) => choice === value)
}

/**
 * A stored dock. Before the window-wide dock (layout 2h) terminals were a side panel tab or a drawer under the chat:
 * those carry over to the right and to the bottom.
 */
function terminalDockOf(value: unknown): TerminalDock | null {
  if (value === 'bottom' || value === 'right' || value === 'full') return value
  if (value === 'panel') return 'right'
  if (value === 'under') return 'bottom'
  return null
}
