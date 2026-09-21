'use client'
import { useActionState, useState } from 'react'
import { bulkAction } from './actions.ts'

type Opt = { id: string; display_name?: string; code?: string; name?: string; scope?: string | null }
export function BulkBar({ children, perms, readOnly, owners, centres, lists, filters }: {
  children: React.ReactNode; readOnly: boolean; filters: string
  perms: { assign: boolean; transfer: boolean; exp: boolean }; owners: Opt[]; centres: Opt[]; lists: Opt[]
}) {
  const [state, action, pending] = useActionState(bulkAction, null)
  const [op, setOp] = useState('')
  return (
    <form action={action} className="space-y-2" onSubmit={(e) => {
      if (op === 'transfer' && !window.confirm('Transfer the selected leads? The current centre will lose access to them.')) e.preventDefault()
    }}>
      <input type="hidden" name="filters" value={filters} />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <select name="op" value={op} onChange={(e) => setOp(e.target.value)} className="input w-auto" aria-label="Bulk action">
            <option value="">Bulk action…</option>
            {perms.assign && <option value="assign">Assign to</option>}
            {perms.transfer && <option value="transfer">Transfer to centre</option>}
            <option value="tag">Add tag</option>
            {lists.length > 0 && <option value="list">Add to list</option>}
            {perms.exp && <option value="export">Export (selected, or all matching)</option>}
          </select>
          {op === 'assign' && <select name="owner" className="input w-auto" aria-label="New owner" required>{owners.map((o) => <option key={o.id} value={o.id}>{o.display_name}{o.scope ? ` (${o.scope})` : ''}</option>)}</select>}
          {op === 'transfer' && <>
            <select name="centre" className="input w-auto" aria-label="Target centre" required>{centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}</select>
            <input name="reason" className="input w-56" placeholder="Reason (required)" aria-label="Reason" required />
          </>}
          {op === 'tag' && <input name="tag" className="input w-40" placeholder="tag" aria-label="Tag" required maxLength={40} />}
          {op === 'list' && <select name="list" className="input w-auto" aria-label="List" required>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
          {op && <button className="btn btn-primary" disabled={pending}>{pending ? 'Working…' : 'Apply'}</button>}
          {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
          {state?.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
        </div>
      )}
      {children}
    </form>
  )
}
