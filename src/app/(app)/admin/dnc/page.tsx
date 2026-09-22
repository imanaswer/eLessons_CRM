import { LocalTime } from '@/components/client.tsx'
import { ActionForm } from '@/components/form.tsx'
import { tenant } from '@/lib/session.ts'
import { dncAddAction } from '../../leads/actions.ts'

export default async function Dnc() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only, rows: (await db.query<{ phone_e164: string; reason: string; created_at: Date; by: string | null }>(
    'select d.phone_e164, d.reason, d.created_at, u.display_name as by from dnc d left join users u on u.id = d.added_by order by d.created_at desc limit 200')).rows }))
  return (
    <div className="space-y-5">
      <div><h1 className="text-[22px] font-semibold leading-tight">Do Not Contact</h1><p className="text-[13px] text-muted">Numbers here are rejected at ingestion from every source, for every centre.</p></div>
      {!d.ro && <ActionForm action={dncAddAction} submit="Add number" className="panel grid gap-3 p-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
        <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" type="tel" className="input" required /></div>
        <div><label className="label" htmlFor="reason">Reason</label><input id="reason" name="reason" className="input" placeholder="Parent asked not to be contacted" /></div>
      </ActionForm>}
      <section className="panel overflow-x-auto"><table className="w-full">
        <thead className="border-b border-line"><tr><th className="th">Phone</th><th className="th">Reason</th><th className="th">Added</th></tr></thead>
        <tbody className="divide-y divide-line">{d.rows.map((r) => <tr key={r.phone_e164}><td className="td font-medium tabular-nums">{r.phone_e164}</td><td className="td">{r.reason}</td><td className="td text-muted">{r.by} · <LocalTime iso={r.created_at.toISOString()} /></td></tr>)}
          {d.rows.length === 0 && <tr><td colSpan={3} className="td text-muted">The registry is empty.</td></tr>}</tbody>
      </table></section>
    </div>
  )
}
