import { useId, useState } from 'react'

const MOST_PORT_DIGITS = 5

type Props = {
  port: string
  onPort: (port: string) => void
  readOnly: boolean
}

/**
 * "Port and key" under the address, closed until asked for. Only the port is here: a key file needs the host to pass
 * `-i` to ssh, which it does not yet.
 */
export function AddressOptions({ port, onPort, readOnly }: Props) {
  const [open, setOpen] = useState(port !== '')
  const id = useId()
  return (
    <div className="mx-rm-options">
      <button type="button" className="mx-rm-text" aria-expanded={open} aria-controls={id} onClick={() => { setOpen(!open) }}>Port and key</button>
      {open && (
        <div id={id} className="mx-rm-option">
          <label htmlFor={`${id}-port`}>Port</label>
          <input
            id={`${id}-port`}
            className="mono"
            inputMode="numeric"
            value={port}
            placeholder="22"
            autoComplete="off"
            readOnly={readOnly}
            onChange={(event) => { onPort(event.target.value.replace(/\D/g, '').slice(0, MOST_PORT_DIGITS)) }}
          />
        </div>
      )}
    </div>
  )
}
