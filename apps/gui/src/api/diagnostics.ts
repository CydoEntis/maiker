import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

const PreviewSchema = z.object({
  parts: z.array(z.object({ title: z.string(), included: z.boolean(), note: z.string() })),
  summary: z.string(),
  text: z.string(),
})
export type DiagnosticsPreview = z.infer<typeof PreviewSchema>

/** Reads what an export would hold, from disk, and keeps that text for `saveDiagnostics`. */
export async function prepareDiagnostics(): Promise<DiagnosticsPreview> {
  if (!isTauri()) throw new Error('Exporting logs is available in the desktop app')
  return PreviewSchema.parse(await invoke<unknown>('prepare_diagnostics'))
}

/** Asks where to save the prepared text in the system's save dialog. Resolves to the place, or null when the dialog was closed. */
export async function saveDiagnostics(): Promise<string | null> {
  if (!isTauri()) throw new Error('Exporting logs is available in the desktop app')
  return z.string().nullable().parse(await invoke<unknown>('save_diagnostics'))
}
