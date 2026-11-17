import type { SlashCommand } from './slashCommands'

const only = (name: string, description: string, hint = '', aliases: readonly string[] = []): SlashCommand => ({ name, description, hint, aliases, terminal: true })

/**
 * The Claude Code version `CLAUDE_TERMINAL_COMMANDS` was last checked against: every command below was run in it. It is
 * named here and nowhere else; `cargo test -p maitty-agent-ask -- --ignored` reads it, and fails naming each command the
 * installed Claude Code no longer takes (docs/TESTING.md, *Agent command lists*).
 */
export const CLAUDE_COMMANDS_PINNED_FOR = '2.1.325'

/**
 * Claude Code's commands that only its terminal runs. Asked what it takes (`agent_commands`), Claude Code lists the
 * commands that work without a screen and leaves these out, since each opens a menu or a page of its own. They are
 * written here, by hand, so a command Claude Code adds later is missing until this list is brought up to date (the
 * check above cannot find it: Claude Code does not list it), and one it drops is found by that check and answered
 * by Claude Code itself. The chat offers them only for an agent with a terminal, and shows that terminal when one is run.
 */
export const CLAUDE_TERMINAL_COMMANDS: readonly SlashCommand[] = [
  only('add-dir', 'Add a new working directory', '<path>'),
  only('artifacts', 'Browse your published and shared artifacts'),
  only('background', 'Send this session to the background and free the terminal', '[prompt]', ['bg']),
  only('branch', 'Create a branch of the current conversation at this point', '[name]'),
  only('btw', 'Ask a quick side question without interrupting the main conversation', '[question]'),
  only('cd', 'Move this session to a new working directory', '<path>'),
  only('copy', "Copy Claude's last response to the clipboard"),
  only('desktop', 'Continue the current session in Claude Desktop', '', ['app']),
  only('diff', 'View uncommitted changes'),
  only('exit', 'Exit Claude Code', '', ['quit']),
  only('export', 'Export the current conversation to a file or the clipboard', '[filename]'),
  only('feedback', 'Send feedback to Anthropic or report a bug', '[report]'),
  only('fork', 'Spawn a background agent that inherits the full conversation', '<directive>'),
  only('help', 'Show help and available commands'),
  only('hooks', 'View hook configurations for tool events'),
  only('ide', 'Manage IDE integrations and show status'),
  only('install-github-app', 'Set up Claude GitHub Actions for a repository'),
  only('keybindings', 'Open your keyboard shortcuts file'),
  only('login', 'Sign in with your Anthropic account'),
  only('logout', 'Sign out from your Anthropic account'),
  only('memory', 'Edit CLAUDE.md files and memory settings'),
  only('mobile', 'Show a QR code to download the Claude mobile app', '', ['ios', 'android']),
  only('permissions', 'Manage allow and deny tool permission rules', '', ['allowed-tools']),
  only('plan', 'Enable plan mode or view the current session plan'),
  only('plugin', 'Manage Claude Code plugins', '', ['plugins', 'marketplace']),
  only('privacy-settings', 'View and update your privacy settings'),
  only('release-notes', 'Show what changed in recent versions'),
  only('resume', 'Resume a previous conversation'),
  only('rewind', 'Go back to an earlier point in the conversation', '', ['checkpoint', 'undo']),
  only('sandbox', 'Show and change how commands are sandboxed'),
  only('skills', 'List available skills'),
  only('status', 'Show Claude Code status: version, model, account and connectivity'),
  only('statusline', "Set up Claude Code's status line"),
  only('subtask', 'Send a subagent off with your full context; its result comes back here', '<task>'),
  only('tasks', 'View and manage everything running in the background', '', ['bashes']),
  only('teleport', 'Send this session to the cloud, or resume one from claude.ai'),
  only('terminal-setup', "Set up the terminal's key bindings for new lines"),
  only('upgrade', 'Upgrade your plan for higher rate limits'),
  only('workflows', 'Browse running and completed workflows'),
]

/**
 * Commands Claude Code lists that the chat does not offer: its own internal ones, and ones that only change how its
 * terminal looks (the theme, colour, renderer, scroll speed, focus view and voice input), which a chat has no use for.
 * Each still works typed in the terminal.
 */
export const CLAUDE_HIDDEN_COMMANDS: ReadonlySet<string> = new Set(['__remote-workflow', 'workflow-launch-exec', 'color', 'focus'])
