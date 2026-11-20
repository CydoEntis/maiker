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

/** Written after the command by the line that is typed, so the dialog knows the command ended and how, without trusting anything else. */
const EXIT_MARK = 'MAIKER-KEY-EXIT:'

/**
 * The line that is typed into the key terminal and run: the command, then a line that writes its exit status after a marker. The
 * shell stays open, so what the command printed stays on screen to be read. What the person reads and copies is the command alone.
 */
export function keyRunLine(command: string, windows = false): string {
  return windows ? `${command}; [Console]::WriteLine('${EXIT_MARK}' + [int]$LASTEXITCODE)` : `${command}; echo "${EXIT_MARK}$?"`
}

const PENALTY = /connection closed|not allowed at this time/i
const DENIED = /permission denied/i
/** ssh asking for the password or a passphrase: never kept, even as "the last line". */
const ASKING = /password|passphrase/i
const ESC = '\u001b'
const BEL = '\u0007'
/** Colour, cursor and mode sequences, and titles: the daemon's screen text is the terminal's own formatted state, not plain text. */
const ANSI = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_]`, 'g')
const KEPT_CONTROLS = new Set(['\n', '\r', '\t'])
const DELETE = '\u007f'
const EXIT_LINE = new RegExp(`${EXIT_MARK}(\\d+)`)

/** Text with its terminal escape sequences and other control characters taken out, fit to show. */
export function stripAnsi(text: string): string {
  return Array.from(text.replace(ANSI, '')).filter((char) => KEPT_CONTROLS.has(char) || (char >= ' ' && char !== DELETE)).join('')
}

/** What the key terminal's screen says: the command's exit status once the marker line has printed, and the last line it said before that. */
export type KeyScreen = { exit: number | null; lastLine: string | null }

/**
 * Reads the key terminal's screen text. The typed line echoes the marker too, but not followed by digits, so only the line the
 * shell printed after the command ended counts. The last line is the last one the command itself printed, after the echo of the
 * typed line, and never ssh's question for the password.
 */
export function readKeyScreen(screen: string): KeyScreen {
  const lines = stripAnsi(screen).split(/\r\n|\r|\n/).map((line) => line.trim())
  const echoEnd = lines.findIndex((line) => line.includes(EXIT_MARK))
  const doneAt = lines.findIndex((line) => EXIT_LINE.test(line))
  const exit = doneAt === -1 ? null : Number(EXIT_LINE.exec(lines[doneAt] ?? '')?.[1])
  const said = lines.slice(echoEnd + 1, doneAt === -1 ? undefined : doneAt).filter((line) => line !== '' && !ASKING.test(line))
  return { exit, lastLine: said.at(-1) ?? null }
}

/** Why the key did not go on, in plain words, from the last line the terminal showed. */
export function explainKeyFailure(lastLine: string | null): string {
  if (lastLine !== null && PENALTY.test(lastLine)) return 'This computer is refusing connections for a few minutes because of earlier failed sign-ins. Wait and try again.'
  if (lastLine !== null && DENIED.test(lastLine)) return 'The password was not accepted, so the key was not added. Try again and type it carefully.'
  return 'The key was not added, or Maiker could not sign in with it yet. Try again.'
}
