/** Characters of a user@host (or an SSH config alias) that are safe to type into any shell unquoted. */
const PLAIN_TARGET = /^[A-Za-z0-9_][A-Za-z0-9_.@:%[\]-]*$/
const LAST_PORT = 65_535
const DEFAULT_PORT = 22

/**
 * The one line that puts this computer's key on a machine, as it is typed into a terminal. Where there is `ssh-copy-id`: that,
 * the port when it is not 22, then the target. On Windows, which has none: PowerShell makes a key if there is none, then
 * sends it to the machine's authorized_keys through ssh, so the password is asked by that ssh and nowhere else. Null when the target holds anything a shell
 * could read as more than a word, so a line that is typed without being run is never one the person has to read for traps.
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
