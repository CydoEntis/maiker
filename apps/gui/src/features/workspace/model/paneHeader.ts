/** The shell a plain terminal runs, as its header says it (`zsh`): the program's own name, else "shell". */
export function shellProgram(session: { conversation: { process?: string | undefined } }): string {
  const name = (session.conversation.process ?? '').trim().split(/[\\/]/).at(-1)?.replace(/\.exe$/i, '').replace(/^-/, '') ?? ''
  return name === '' ? 'shell' : name
}
