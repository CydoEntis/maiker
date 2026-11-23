import { useState } from 'react'
import { PaletteBody } from './PaletteBody'
import { sourceRows } from './openPalette'
import { usePaletteShell } from './paletteShell'

/** The first level: where a project can come from. Typing filters the rows. */
export function SourcesLevel() {
  const shell = usePaletteShell()
  const [query, setQuery] = useState('')
  const rows = sourceRows({ mode: shell.mode, recent: shell.recent, machines: shell.machines, query, canAddMachine: shell.canAddMachine })
  const nothing = rows.length === 0
    ? { tone: 'plain' as const, title: `Nothing matches “${query.trim()}”`, detail: shell.mode === 'open' ? 'Try a machine name, Git URL or GitHub.' : 'Try a machine name.' }
    : null
  return (
    <PaletteBody
      level="sources"
      mode={shell.mode}
      placeholder={shell.mode === 'open' ? 'Open a project…' : 'Choose a folder…'}
      query={query}
      onQuery={(text) => { shell.forget(); setQuery(text) }}
      onBack={null}
      rows={rows}
      status={shell.taking ?? nothing}
      locked={shell.locked}
      onAct={shell.act}
    />
  )
}
