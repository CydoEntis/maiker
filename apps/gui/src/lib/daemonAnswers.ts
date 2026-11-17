import type { IParser } from '@xterm/xterm'

/** The slots of a program's colour query (`ESC ] 11 ; ? ST` asks for the background). */
const OSC_FOREGROUND = 10
const OSC_BACKGROUND = 11
const OSC_QUERY = '?'
/** `ESC [ 5 n` asks "are you there", `ESC [ 6 n` "where is the cursor". */
const DSR_STATUS = 5
const DSR_CURSOR = 6
const DA_DEFAULT = 0

type Parser = Pick<IParser, 'registerCsiHandler' | 'registerOscHandler'>

/**
 * Keeps xterm from answering the terminal queries the daemon answers (`process_answering_queries` in
 * `daemon/term.rs`): the colours, the cursor's place, the status and the device attributes. The daemon is
 * the terminal as far as the program is concerned, and answers at once. A second answer from the window
 * reaches the program late, after it stopped reading, so the shell prints it as text
 * (`11;rgb:2222/2525/3838`, `^[[2;1R`). Every other query is still xterm's to answer.
 */
export function leaveQueriesToDaemon(parser: Parser): () => void {
  const params = (values: readonly (number | number[])[]) => values.map((value) => (Array.isArray(value) ? value[0] ?? DA_DEFAULT : value))
  const firstIs = (values: readonly (number | number[])[], ...wanted: number[]) => wanted.includes(params(values)[0] ?? DA_DEFAULT)
  const handlers = [
    parser.registerOscHandler(OSC_FOREGROUND, (data) => data === OSC_QUERY),
    parser.registerOscHandler(OSC_BACKGROUND, (data) => data === OSC_QUERY),
    parser.registerCsiHandler({ final: 'n' }, (values) => firstIs(values, DSR_STATUS, DSR_CURSOR)),
    parser.registerCsiHandler({ final: 'c' }, (values) => firstIs(values, DA_DEFAULT)),
    parser.registerCsiHandler({ prefix: '>', final: 'c' }, (values) => firstIs(values, DA_DEFAULT)),
  ]
  return () => { for (const handler of handlers) handler.dispose() }
}
