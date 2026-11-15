/** How Claude Code's `/compact` begins what it prints: "Compacted (ctrl+o to see full summary)". */
const COMPACTED = /^Compacted\b/

/** The hook events Claude Code runs around a compaction, whose output it prints after its own line. */
const COMPACT_HOOKS = /\b(PreCompact|PostCompact|SessionStart)\b/g

/** What a `/compact` printed: the hooks that ran with it, by event name, each once. */
export type Compaction = { readonly hooks: readonly string[] }

/**
 * The compaction a command's output reports, or null when it reports something else. Claude Code's own line names a
 * terminal key (ctrl+o), and a hook's output is its raw command line, so neither is shown as written.
 */
export function compactionOf(text: string): Compaction | null {
  if (!COMPACTED.test(text.trimStart())) return null
  return { hooks: [...new Set(text.match(COMPACT_HOOKS) ?? [])] }
}
