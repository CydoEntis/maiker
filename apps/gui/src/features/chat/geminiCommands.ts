import type { SlashCommand } from './slashCommands'
import type { WindowRoute } from './windowCommands'

/** A command Gemini CLI draws in its own terminal: a dialog, a list or a notice that never reaches the conversation, so it is run there with the terminal shown. */
const shown = (name: string, description: string, hint = '', aliases: readonly string[] = []): SlashCommand => ({ name, description, hint, aliases, terminal: true })

/**
 * The Gemini CLI release `GEMINI_COMMANDS` was written from: the latest release when the list was written, against the
 * reference at github.com/google-gemini/gemini-cli (docs/reference/commands.md). It is named here and nowhere else;
 * `cargo test -p maitty-agent-ask -- --ignored` fails when the installed Gemini is newer (docs/TESTING.md, *Agent command
 * lists*). The list was read from that reference, not from a running Gemini CLI: none was installed to run.
 */
export const GEMINI_COMMANDS_PINNED_FOR = '0.68.0'

/**
 * Gemini CLI's own commands, by name (a command with subcommands is one entry; its subcommands are typed after it). Gemini
 * has no way to be asked what it takes without a model call, so they are written here by hand, and a command it adds
 * later is missing until this list is brought up to date. Its custom commands (`.toml` files), skills and extensions'
 * commands are not here: typed in full, they still go to Gemini.
 *
 * Every one is `shown`. Nothing here could be run to see where a command writes its answer, so none is assumed to reach
 * the conversation the chat reads; the terminal shows what Gemini drew.
 */
export const GEMINI_COMMANDS: readonly SlashCommand[] = [
  shown('about', 'Show version info for filing issues'),
  shown('agents', 'List, reload, enable, disable or configure subagents', '[list|reload|enable|disable|config]'),
  shown('auth', 'Change the authentication method'),
  shown('bug', 'File a GitHub issue; the text after the command becomes the headline', '[title]'),
  shown('chat', 'Save, resume, list, delete or share checkpoints of the conversation', '[save|resume|list|delete|share] [tag]'),
  shown('clear', 'Clear the conversation context, start a new session and clear the screen'),
  shown('commands', 'List or reload custom command files', '[list|reload]'),
  shown('compress', 'Replace the chat context with a summary'),
  shown('copy', 'Copy the last output to the clipboard'),
  shown('directory', 'Add or show workspace directories', '[add <path>|show]', ['dir']),
  shown('docs', 'Open the documentation in a browser'),
  shown('editor', 'Select a supported editor'),
  shown('extensions', 'Manage extensions', '[list|install|update|enable|disable|...]'),
  shown('help', 'Show help and available commands', '', ['?']),
  shown('hooks', 'View and manage hooks', '[list|enable|disable|enable-all|disable-all]'),
  shown('ide', 'Manage the IDE integration', '[status|enable|disable|install]'),
  shown('init', 'Analyze the folder and create a GEMINI.md context file'),
  shown('mcp', 'List and manage MCP servers and tools', '[list|desc|schema|auth|enable|disable|reload]'),
  shown('memory', 'Show, list or refresh the GEMINI.md memory', '[show|list|refresh]'),
  shown('model', 'Choose the model, or set it with /model set <name>', '[manage|set <name>]'),
  shown('permissions', 'Manage folder trust settings', '[trust [path]]'),
  shown('plan', 'Switch to read-only Plan Mode and show the current plan', '[copy]'),
  shown('policies', 'List active policies', '[list]'),
  shown('privacy', 'Show the privacy notice and data collection options'),
  shown('quit', 'Exit Gemini CLI', '', ['exit']),
  shown('restore', 'Restore project files to their state before a tool ran', '[tool_call_id]'),
  shown('resume', 'Browse and resume saved sessions or tagged checkpoints'),
  shown('rewind', 'Go back through the conversation and revert chat state, file changes, or both'),
  shown('settings', 'Open the settings editor'),
  shown('setup-github', 'Set up GitHub Actions to triage issues and review pull requests'),
  shown('shells', 'Toggle the background shells view', '', ['bashes']),
  shown('skills', 'List, enable, disable or reload skills', '[list|enable|disable|reload]'),
  shown('stats', 'Show session, model, tool or token usage statistics', '[session|model|tools|heatmap]'),
  shown('terminal-setup', 'Configure terminal keybindings for multiline input'),
  shown('theme', 'Choose a theme'),
  shown('tools', 'List the available tools', '[desc|nodesc]'),
  shown('upgrade', 'Open the upgrade page in a browser'),
  shown('vim', 'Toggle vim mode'),
]

/** The picker's tag for the one command the window answers itself. */
const COMMAND_LIST = 'command list'
const HELP = 'help'

/**
 * Where the window answers a Gemini command itself: `/help` alone lists the commands the box offers, as `/` does. Every
 * other command, and `/help` with something after it, goes to Gemini as typed.
 */
export function geminiRouteOf(name: string, args = ''): WindowRoute | null {
  return name === HELP && args.trim() === '' ? { kind: 'commands' } : null
}

/** The list as the picker offers it: `/help` is tagged with where it goes, and, answered by the window, is offered where there is no terminal too. */
export function withGeminiRoutes(commands: readonly SlashCommand[]): SlashCommand[] {
  return commands.map((command) => {
    if (command.name !== HELP) return command
    const answered: { -readonly [K in keyof SlashCommand]: SlashCommand[K] } = { ...command, opens: COMMAND_LIST }
    delete answered.terminal
    return answered
  })
}
