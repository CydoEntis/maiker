import { z } from 'zod'

const CheckStateSchema = z.enum(['Checking', 'Passed', 'Failed', 'Overridden', 'CouldNotRun', 'Pending', 'NeedsApproval', 'Stale', 'Never'])

/** One of a pane's checks as the daemon reports it (`CheckInfo` in the protocol); absent fields read as their defaults. */
export const CheckSchema = z.object({
  command: z.string().default(''),
  state: CheckStateSchema.default('CouldNotRun'),
  exit_code: z.number().int().nullable().default(null),
  started_at: z.number().default(0),
  duration_ms: z.number().default(0),
  first_failing_line: z.string().default(''),
  rerun_queued: z.boolean().default(false),
  override_reason: z.string().default(''),
  overridden_by: z.string().default(''),
  name: z.string().default(''),
  turn: z.number().default(0),
  line_count: z.number().default(0),
  changed_files: z.array(z.object({ kind: z.string(), path: z.string() })).default([]),
  // `"User"` for a command you set, or `{ Repo: { file, … } }` for one the repository brought.
  source: z.union([z.literal('User'), z.object({ Repo: z.object({ file: z.string(), uncommitted: z.boolean().default(false) }) })]).default('User'),
  previous_command: z.string().nullable().default(null),
})

export type Check = z.infer<typeof CheckSchema>
