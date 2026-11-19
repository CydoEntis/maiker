import { type ReactNode } from 'react'
import '@/features/chat/chat.css'
import { DraftGuardHost } from '@/features/documents/DraftGuardHost'
import { DocumentView } from '@/features/documents/DocumentView'
import type { DocumentIO } from '@/features/documents/useDocument'
import type { DocumentMode } from '@/features/documents/documentEdit'

/** The pane sizes the samples are drawn at: a window narrower than NARROW_PX stacks its panes. */
const NARROW_PX = 600
const NARROW_HEIGHT = 760
const SAMPLE_HEIGHT = 520

/** The document viewer in each of its states, on a pretend disk (docs/DESIGN.md, "Documents"). */

const README = `# Maiker

Run many coding agents at once and see which ones need you.

## Install

\`\`\`sh
cargo install --path apps/tui
\`\`\`

## What it does

| Part | What it is |
| --- | --- |
| Daemon | Owns every session |
| Desktop app | A chat view of each one |

- Status is working, needs you, done or idle
- Sessions survive the window closing

## Roadmap

- [x] Draw a README
- [x] Edit it and save with a version check
  - [x] Keep the file's line endings
  - [ ] Watch the file for changes
- [ ] Open documents on other machines
- Plain [ ] stays text in a sentence

> **Note** Raw HTML such as <b>this</b> is shown as text and never runs.

See [the setup guide](docs/setup.md) or [the site](https://example.com).
`

/** A disk whose saves are refused as changed when \`conflict\`, so the notice can be seen without a second writer. */
function pretendDisk(text: string, conflict: boolean): DocumentIO {
  return {
    read: () => Promise.resolve({ text, version: 'v1' }),
    save: () => Promise.resolve(conflict ? { kind: 'changed' } : { kind: 'saved', version: 'v2' }),
  }
}

const NOTHING = () => undefined

function Frame({ width, label, children }: { width: number; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2" style={{ width }} data-sample={label}>
      <span className="font-(family-name:--mono) text-[11px] font-medium text-(--dim)">{label}</span>
      <div className="mx-pane is-card is-focused" style={{ height: SAMPLE_HEIGHT, flex: 'none' }}>{children}</div>
    </div>
  )
}

function Doc({ mode, conflict = false, beside = true }: { mode: DocumentMode; conflict?: boolean; beside?: boolean }) {
  return <DocumentView term={1} machine={0} path="README.md" root="/gallery" startMode={mode} io={pretendDisk(README, conflict)} onOpenPath={NOTHING} onOpenBeside={beside ? NOTHING : undefined} />
}

/** The split: the chat's column and a document pane beside it, as the layout draws two panes. */
function Beside({ width }: { width: number }) {
  return (
    <div className="flex flex-col gap-2" style={{ width }} data-sample={`beside ${String(width)}`}>
      <span className="font-(family-name:--mono) text-[11px] font-medium text-(--dim)">Beside the chat, {width}px</span>
      <div className={`mx-panes is-split${width < NARROW_PX ? ' is-narrow-sample' : ''}`} style={{ flex: 'none', height: width < NARROW_PX ? NARROW_HEIGHT : SAMPLE_HEIGHT, flexDirection: width < NARROW_PX ? 'column' : 'row', padding: 0 }}>
        <div className="mx-pane-column"><div className="mx-pane-cell"><section className="mx-pane is-card"><div className="mx-pane-head"><span className="mx-pane-name">Claude · maiker</span></div><p className="m-4 text-[13px] text-(--muted)">The chat sits here.</p></section></div></div>
        <div className="mx-pane-column"><div className="mx-pane-cell"><section className="mx-pane is-doc is-card is-focused"><span className="mx-pane-ring" aria-hidden="true" /><Doc mode="drawn" beside={false} /></section></div></div>
      </div>
    </div>
  )
}

export function DocumentsGallery() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <DraftGuardHost />
      <Frame width={780} label="Drawn, 780px"><Doc mode="drawn" /></Frame>
      <Frame width={360} label="Drawn, 360px"><Doc mode="drawn" /></Frame>
      <Frame width={780} label="Source"><Doc mode="source" /></Frame>
      <Frame width={780} label="Edit with the page beside it"><Doc mode="edit" /></Frame>
      <Frame width={360} label="Edit, narrow"><Doc mode="edit" /></Frame>
      <Frame width={780} label="Edit, changed on disk (press Save)"><Doc mode="edit" conflict /></Frame>
      <Beside width={1000} />
      <Beside width={360} />
    </div>
  )
}
