import type { HostKeyReport } from '@/api/machines'

const DEFAULT_SSH_PORT = 22

/** How ssh names a key type in its own fingerprint line. */
export function keyTypeName(keyType: string): string {
  switch (keyType) {
    case 'ssh-ed25519': return 'ED25519'
    case 'ssh-rsa': return 'RSA'
    default: return keyType.startsWith('ecdsa-') ? 'ECDSA' : keyType
  }
}

/** The key as the trust card shows it: `ED25519 · SHA256:…`. */
export function shownKey(report: HostKeyReport): string {
  return `${keyTypeName(report.key_type)} · ${report.fingerprint}`
}

/** The command that makes this computer forget a host's old key, for the one case a changed key is the person's own doing. */
export function forgetKeyCommand(report: HostKeyReport): string {
  return `ssh-keygen -R ${report.host}${report.port === DEFAULT_SSH_PORT ? '' : `:${String(report.port)}`}`
}
