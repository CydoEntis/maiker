import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { octetsOf } from '../model/ipAddress'

const PARTS = 4
const MAX_DIGITS = 3
type Props = {
  octets: readonly string[]
  onChange: (octets: string[]) => void
  /** Text pasted that is not an IP address on its own (`user@host`, a name): the form decides what it means. */
  onPasteOther: (text: string) => void
  invalid: boolean
  readOnly: boolean
}

/**
 * An IPv4 address as four boxes with the dots already between them: digits only, the cursor moves on after three digits or
 * a typed dot, Backspace in an empty box goes back, and a pasted address fills all four.
 */
export function IpAddressInput({ octets, onChange, onPasteOther, invalid, readOnly }: Props) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  const focusBox = (index: number) => { boxes.current[index]?.focus(); boxes.current[index]?.select() }
  const set = (index: number, value: string) => { onChange(octets.map((part, at) => (at === index ? value : part))) }

  const typed = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS)
    set(index, digits)
    // A dot typed after digits means "next box", as when writing the address out.
    if ((raw.includes('.') && digits !== '') || digits.length === MAX_DIGITS) { if (index < PARTS - 1) focusBox(index + 1) }
  }
  const keyed = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && octets[index] === '' && index > 0) { event.preventDefault(); focusBox(index - 1) }
    if (event.key === 'ArrowLeft' && event.currentTarget.selectionStart === 0 && index > 0) { event.preventDefault(); focusBox(index - 1) }
    if (event.key === 'ArrowRight' && event.currentTarget.selectionEnd === event.currentTarget.value.length && index < PARTS - 1) { event.preventDefault(); focusBox(index + 1) }
  }
  const pasted = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text').trim()
    if (text === '') return
    event.preventDefault()
    const whole = octetsOf(text)
    if (whole !== null) { onChange(whole); focusBox(PARTS - 1) } else onPasteOther(text)
  }

  return (
    <span className="mx-rm-ip" role="group" aria-label="IP address" data-invalid={invalid ? 'true' : undefined}>
      {octets.map((part, index) => (
        <span key={index} className="mx-rm-ip-cell">
          {index > 0 && <span className="mx-rm-ip-dot mono" aria-hidden="true">.</span>}
          <input
            ref={(element) => { boxes.current[index] = element }}
            className="mono"
            inputMode="numeric"
            aria-label={`Address, part ${String(index + 1)} of ${String(PARTS)}`}
            aria-invalid={invalid}
            value={part}
            placeholder="0"
            autoComplete="off"
            readOnly={readOnly}
            onChange={(event) => { typed(index, event.target.value) }}
            onKeyDown={(event) => { keyed(index, event) }}
            onPaste={pasted}
            onFocus={(event) => { event.currentTarget.select() }}
          />
        </span>
      ))}
    </span>
  )
}
