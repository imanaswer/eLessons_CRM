'use client'
import { useActionState, useState } from 'react'
import { QB_FIELDS, QB_OPS } from '@/lib/leads-query.ts'
import { saveViewAction } from './view-actions.ts'
// WS-3 save the current filters as a named view; WS-4 a small AND/OR builder that writes the `qb` URL parameter.
export function SaveViewBar({ filters, centreId, readOnly }: { filters: Record<string, unknown>; centreId: string | null; readOnly: boolean }) {
  const [state, action, pending] = useActionState(saveViewAction, null)
  const [open, setOpen] = useState(false)
  const [rules, setRules] = useState<{ field: string; op: string; value: string }[]>([{ field: 'city', op: 'eq', value: '' }])
  const [join, setJoin] = useState<'and' | 'or'>('and')
  const active = Object.entries(filters).filter(([k, v]) => v && !['view', 'cursor'].includes(k))
  const apply = () => { const u = new URLSearchParams(Object.entries(filters).filter(([, v]) => v).map(([k, v]) => [k, String(v)])); u.delete('cursor'); u.set('qb', JSON.stringify({ join, rules: rules.filter((r) => r.field) })); window.location.assign(`/leads?${u}`) }
  return <div className="flex flex-wrap items-center gap-2 text-[13px]">
    <button type="button" className="btn btn-ghost h-8" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide advanced filters' : 'Advanced filters'}</button>
    {!readOnly && <form action={action} className="flex items-center gap-1"><input type="hidden" name="filters" value={JSON.stringify(filters)} /><input name="name" className="input h-8 w-40" placeholder="Save as view…" aria-label="View name" required />
      <label className="text-xs text-muted"><input type="checkbox" name="shared" disabled={!centreId} /> share with centre</label><button className="btn btn-quiet h-8" disabled={pending}>Save</button></form>}
    {state?.error && <span className="text-danger">{state.error}</span>}{state?.ok && <span className="text-ok">{state.ok}</span>}
    {active.length > 0 && <span className="text-xs text-muted">{active.map(([k, v]) => `${k}=${String(v).slice(0, 30)}`).join(' · ')}</span>}
    {open && <div className="panel pop-in w-full space-y-2 p-3">
      <div className="flex items-center gap-2">Match <select value={join} onChange={(e) => setJoin(e.target.value as 'and' | 'or')} className="input h-8 w-auto" aria-label="Match"><option value="and">all</option><option value="or">any</option></select> of:</div>
      {rules.map((r, i) => <div key={i} className="flex flex-wrap gap-1"><select value={r.field} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} className="input h-8 w-auto" aria-label="Field">{Object.entries(QB_FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</select>
        <select value={r.op} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, op: e.target.value } : x))} className="input h-8 w-auto" aria-label="Operator">{Object.entries(QB_OPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {!['empty', 'not_empty'].includes(r.op) && <input value={r.value} onChange={(e) => setRules(rules.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} className="input h-8 w-40" placeholder="Value" aria-label="Value" />}
        <button type="button" className="btn btn-quiet h-8" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove rule">×</button></div>)}
      <div className="flex gap-2"><button type="button" className="btn btn-quiet h-8" onClick={() => setRules([...rules, { field: 'city', op: 'eq', value: '' }])}>Add rule</button><button type="button" className="btn btn-primary h-8" onClick={apply}>Apply</button></div>
    </div>}
  </div>
}
