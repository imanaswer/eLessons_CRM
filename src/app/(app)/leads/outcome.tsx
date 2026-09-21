'use client'
import { useActionState, useEffect, useState } from 'react'
import type { FormState } from '../actions.ts'

type D = { id: string; name: string; sentiment: string; followup: string; note_required: boolean }
const TONE: Record<string, string> = { positive: 'peer-checked:bg-ok peer-checked:text-white', neutral: 'peer-checked:bg-ink peer-checked:text-white', negative: 'peer-checked:bg-danger peer-checked:text-white', junk: 'peer-checked:bg-danger peer-checked:text-white' }

// WS-9: tap an outcome, (optional note / time), tap Save. The follow-up defaults to the system cadence.
export function OutcomeForm({ leadId, timezone, dispositions, action }: { leadId: string; timezone: string; dispositions: D[]; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, run, pending] = useActionState(action, null)
  const [picked, setPicked] = useState<D | null>(null)
  useEffect(() => { if (state?.ok) setPicked(null) }, [state])     // React resets the fields after a successful action; collapse the form too
  const closes = picked && (picked.sentiment === 'negative' || picked.sentiment === 'junk')
  return (
    <form action={run} className="panel space-y-3 p-3">
      <input type="hidden" name="lead_id" value={leadId} />
      <fieldset>
        <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Log call outcome</legend>
        <div className="flex flex-wrap gap-1.5">
          {dispositions.map((d) => (
            <label key={d.id} className="cursor-pointer">
              <input type="radio" name="disposition_id" value={d.id} className="peer sr-only" required onChange={() => setPicked(d)} />
              <span className={`inline-flex min-h-9 items-center rounded-full border border-line bg-surface px-3 text-sm peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${TONE[d.sentiment]}`}>{d.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {picked && <>
        <textarea name="note" rows={2} className="input h-auto py-2" placeholder={picked.note_required ? 'Note (required for this outcome)' : 'Note (optional)'} aria-label="Note" required={picked.note_required} />
        {!closes && picked.followup !== 'none' && (
          <label className="block text-sm">
            <span className="label">{picked.followup === 'user' ? `Call back at (required, ${timezone})` : `Next follow-up (${timezone}) — leave empty to use the system schedule`}</span>
            <input type="datetime-local" name="followup" className="input sm:w-64" required={picked.followup === 'user'} />
          </label>
        )}
        {closes && <p className="text-sm text-muted">This closes the lead as Dead with reason “{picked.name}”.</p>}
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save outcome'}</button>
      </>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && !picked && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  )
}
