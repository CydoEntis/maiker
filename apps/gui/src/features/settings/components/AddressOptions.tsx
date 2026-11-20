import { useId, useState } from 'react'

const MOST_PORT_DIGITS = 5

type Props = {
  port: string
  keyFile: string
  onPort: (port: string) => void
  onKeyFile: (path: string) => void
}

/**
 * "Port and key" under the address, closed until asked for: the SSH port, and a private key file for ssh to sign in with. The path
 * is only checked to exist by the host and never read; a path it cannot use is answered in its own words.
 */
export function AddressOptions({ port, keyFile, onPort, onKeyFile }: Props) {
  const [open, setOpen] = useState(port !== '' || keyFile !== '')
  const id = useId()
  return (
    <div className="mx-rm-options">
      <button type="button" className="mx-rm-advanced" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open) }}><span aria-hidden="true">{open ? '▾' : '▸'} </span>Port and key</button>
      {open && (
        <div id={id} className="mx-rm-option-list">
          <div className="mx-rm-option">
            <label htmlFor={`${id}-port`}>Port</label>
            <input
              id={`${id}-port`}
              className="mono"
              inputMode="numeric"
              value={port}
              placeholder="22"
              autoComplete="off"
              onChange={(event) => { onPort(event.target.value.replace(/\D/g, '').slice(0, MOST_PORT_DIGITS)) }}
            />
          </div>
          <div className="mx-rm-option">
            <label htmlFor={`${id}-key`}>Key file</label>
            <input
              id={`${id}-key`}
              className="mono"
              value={keyFile}
              placeholder="~/.ssh/id_ed25519"
              spellCheck={false}
              autoCapitalize="none"
              autoComplete="off"
              onChange={(event) => { onKeyFile(event.target.value) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
