'use client'
import { useActionState, useEffect, useState } from 'react'
import type { FormState } from '../actions.ts'

type D = { id: string; name: string; sentiment: string; followup: string; note_required: boolean }
const TONE: Record<string, string> = { positive: 'peer-checked:bg-ok peer-checked:border-ok peer-checked:text-white', neutral: 'peer-checked:bg-ink peer-checked:border-ink peer-checked:text-white', negative: 'peer-checked:bg-danger peer-checked:border-danger peer-checked:text-white', junk: 'peer-checked:bg-danger peer-checked:border-danger peer-checked:text-white' }
const DOT: Record<string, string> = { positive: 'bg-ok', neutral: 'bg-warn', negative: 'bg-danger', junk: 'bg-danger' }

// WS-9: tap an outcome, (optional note / time), tap Save. The follow-up defaults to the system cadence.
export function OutcomeForm({ leadId, timezone, dispositions, action }: { leadId: string; timezone: string; dispositions: D[]; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, run, pending] = useActionState(action, null)
  const [picked, setPicked] = useState<D | null>(null)
  useEffect(() => { if (state?.ok) setPicked(null) }, [state])     // React resets the fields after a successful action; collapse the form too
  const closes = picked && (picked.sentiment === 'negative' || picked.sentiment === 'junk')
  return (
    <form action={run} className="panel space-y-3 p-3.5">
      <input type="hidden" name="lead_id" value={leadId} />
      <fieldset>
        <legend className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold">Log call outcome <span className="font-normal text-faint">· pick one, then save</span></legend>
        <div className="flex flex-wrap gap-1.5">
          {dispositions.map((d) => (
            <label key={d.id} className="cursor-pointer">
              <input type="radio" name="disposition_id" value={d.id} className="peer sr-only" required onChange={() => setPicked(d)} />
              <span className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-2 transition-[background-color,color,border-color,transform] duration-150 hover:border-line-strong hover:bg-sunken active:scale-[0.97] peer-focus-visible:ring-2 peer-focus-visible:ring-brand-ring ${TONE[d.sentiment]}`}><span className={`h-1.5 w-1.5 rounded-full ${DOT[d.sentiment]} peer-checked:bg-white`} />{d.name}</span>
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
        {closes && <p className="rounded-[var(--radius-control)] bg-danger-soft px-3 py-2 text-[13px] text-danger">This closes the lead as Dead with reason “{picked.name}”.</p>}
        <button className="btn btn-primary" disabled={pending}>{pending ? 'Saving…' : 'Save outcome'}</button>
      </>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.ok && !picked && <p role="status" className="text-sm text-ok">{state.ok}</p>}
    </form>
  )
}
