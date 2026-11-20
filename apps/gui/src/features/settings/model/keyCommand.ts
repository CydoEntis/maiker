/** Characters of a user@host (or an SSH config alias) that are safe to type into any shell unquoted. */
const PLAIN_TARGET = /^[A-Za-z0-9_][A-Za-z0-9_.@:%[\]-]*$/
const LAST_PORT = 65_535
const DEFAULT_PORT = 22

/**
 * The one line that puts this computer's key on a machine, as it is typed into a terminal. Where there is `ssh-copy-id`: that,
 * the port when it is not 22, then the target. On Windows, which has none: PowerShell makes a key if there is none, then
 * sends it to the machine's authorized_keys through ssh, so the password is asked by that ssh and nowhere else. Null when the target holds anything a shell
 * could read as more than a word, so a line that is run for the person is never one they have to read for traps.
 */
export function keySetupCommand(target: string, port: number | null, windows = false): string | null {
  if (!PLAIN_TARGET.test(target)) return null
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > LAST_PORT)) return null
  const portFlag = port === null || port === DEFAULT_PORT ? '' : ` -p ${String(port)}`
  if (!windows) return `ssh-copy-id${portFlag} ${target}`
  // Short on purpose: it is read before it is run. The key is made if there is none, then sent through ssh to the machine's file.
  const file = '$HOME/.ssh/id_ed25519.pub'
  return `$p="${file}"; if(!(Test-Path $p)){ssh-keygen -t ed25519}; Get-Content $p | ssh${portFlag} ${target} "mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys"`
}

/**
 * The line that is typed into the key terminal and run: the command, then an exit, so the shell ends when the command does and
 * the dialog knows to check the key. What the person reads and copies is the command alone.
 */
export function keyRunLine(command: string, windows = false): string {
  return `${command}; exit ${windows ? '$LASTEXITCODE' : '$?'}`
}

const PENALTY = /connection closed|not allowed at this time/i
const DENIED = /permission denied/i
/** ssh asking for the password or a passphrase: never kept, even as "the last line". */
const ASKING = /password|passphrase/i

/** The last line of what the terminal showed that is worth saying back: not blank, and never ssh's question for the password. */
export function lastKeyLine(screen: string): string | null {
  const lines = screen.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !ASKING.test(line))
  return lines.at(-1) ?? null
}

/** Why the key did not go on, in plain words, from the last line the terminal showed. */
export function explainKeyFailure(lastLine: string | null): string {
  if (lastLine !== null && PENALTY.test(lastLine)) return 'This computer is refusing connections for a few minutes because of earlier failed sign-ins. Wait and try again.'
  if (lastLine !== null && DENIED.test(lastLine)) return 'The password was not accepted, so the key was not added. Try again and type it carefully.'
  return 'The key was not added, or Maiker could not sign in with it yet. Try again.'
}
