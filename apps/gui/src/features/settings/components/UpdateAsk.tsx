import { installNote, updateVerb, updateWarning } from '@/features/workspace/model/machines'
import { StatusBlock } from './StatusBlock'
import type { UpdateFlow } from './useUpdateFlow'

/**
 * The question before an install or update runs, so it says what it will interrupt first (ADR 0007).
 * An update can wait until nothing is open on the machine.
 */
export function UpdateAsk({ flow, plain = false }: { flow: UpdateFlow; plain?: boolean }) {
  const { asking } = flow
  if (asking === null) return null
  const { name, action, activity } = asking
  const verb = updateVerb(action, activity)
  return (
    <StatusBlock tone="needs" plain={plain} lead={action === 'install' ? installNote(name) : updateWarning(name, activity)}>
      {action === 'install'
        ? <button type="button" className="mx-rm-primary" onClick={() => { flow.run(false) }}>Install on {name} now</button>
        : (
          <>
            <button type="button" className="mx-rm-primary" onClick={() => { flow.run(false) }}>{verb} {name} now</button>
            <button type="button" className="mx-rm-text" onClick={() => { flow.run(true) }}>{verb} {name} when idle</button>
          </>
        )}
      <button type="button" className="mx-rm-text" onClick={flow.cancel}>Cancel</button>
    </StatusBlock>
  )
}
