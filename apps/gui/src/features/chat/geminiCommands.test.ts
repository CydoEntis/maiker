import { describe, expect, it } from 'vitest'
import { GEMINI_COMMANDS, geminiRouteOf, withGeminiRoutes } from './geminiCommands'
import { matchCommands, namedCommand } from './slashCommands'

describe('GEMINI_COMMANDS', () => {

  it('names each command once, with a description, and runs every one in the terminal', () => {
    const names = GEMINI_COMMANDS.flatMap((command) => [command.name, ...command.aliases])
    expect(new Set(names).size).toBe(names.length)
    for (const command of GEMINI_COMMANDS) {
      expect(command.description).not.toBe('')
      expect(command.terminal).toBe(true)
    }
  })

  it('takes a command by an alias Gemini documents', () => {
    expect(namedCommand(GEMINI_COMMANDS, '/exit')?.name).toBe('quit')
    expect(namedCommand(GEMINI_COMMANDS, '/dir add src')?.name).toBe('directory')
    expect(matchCommands(GEMINI_COMMANDS, 'mod')[0]?.name).toBe('model')
  })
})

describe('geminiRouteOf', () => {
  it('lists the commands for /help alone', () => {
    expect(geminiRouteOf('help')).toEqual({ kind: 'commands' })
    expect(geminiRouteOf('help', '  ')).toEqual({ kind: 'commands' })
  })

  it('sends everything else to Gemini as typed', () => {
    expect(geminiRouteOf('help', 'model')).toBeNull()
    expect(geminiRouteOf('model')).toBeNull()
    expect(geminiRouteOf('clear')).toBeNull()
  })
})

describe('withGeminiRoutes', () => {
  it('tags /help and offers it without a terminal, and leaves the rest alone', () => {
    const listed = withGeminiRoutes(GEMINI_COMMANDS)
    const help = namedCommand(listed, '/help')
    expect(help?.opens).toBe('command list')
    expect(help?.terminal).toBeUndefined()
    expect(namedCommand(listed, '/model')).toBe(namedCommand(GEMINI_COMMANDS, '/model'))
  })
})
