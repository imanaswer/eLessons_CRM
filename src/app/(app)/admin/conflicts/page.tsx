import Link from 'next/link'
import { LocalTime } from '@/components/client.tsx'
import { tenant } from '@/lib/session.ts'
import { resolveConflictAction } from '../../leads/actions.ts'

// LT-4 / TR-4: HQ-only. Centres never learn that another centre holds the same parent.
export default async function Conflicts() {
  const d = await tenant(async (db, c) => ({ ro: c.read_only,
    policy: (await db.query<{ p: string }>('select cross_centre_policy as p from orgs')).rows[0]?.p,
    rows: (await db.query<{ id: string; status: string; resolution: string | null; created_at: Date; first_id: string; new_id: string; name: string | null; phone: string | null; first_centre: string | null; new_centre: string | null; first_at: Date; first_stage: string; new_stage: string }>(
      `select k.id, k.status, k.resolution, k.created_at, f.id as first_id, n.id as new_id, coalesce(n.name, f.name) as name, n.primary_phone as phone,
              fc.code as first_centre, nc.code as new_centre, f.created_at as first_at, f.lifecycle as first_stage, n.lifecycle as new_stage
       from conflicts k join lead_list f on f.id = k.first_lead_id join lead_list n on n.id = k.new_lead_id
       left join centres fc on fc.id = f.current_centre_id left join centres nc on nc.id = n.current_centre_id
       order by (k.status = 'open') desc, k.created_at desc limit 100`)).rows }))
  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-semibold">Cross-centre conflicts</h1>
        <p className="text-sm text-muted">The same parent enquired at two centres. Each centre keeps its own lead and cannot see the other. Current policy: <span className="font-medium text-ink">{d.policy === 'first_touch_wins' ? 'first touch wins (credit goes to the centre that captured the parent first)' : 'HQ decides each case'}</span>.</p></div>
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">Parent</th><th className="th">First touch</th><th className="th">Second centre</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-line">
            {d.rows.map((k) => <tr key={k.id} className="align-top">
              <td className="td"><span className="font-medium">{k.name ?? 'Unnamed'}</span><div className="text-xs text-muted tabular-nums">{k.phone}</div></td>
              <td className="td"><Link className="hover:underline" href={`/leads?view=${['DEAD', 'ENROLLED'].includes(k.first_stage) ? 'worked' : 'active'}&lead=${k.first_id}`}>{k.first_centre ?? 'HQ pool'}</Link><div className="text-xs text-muted"><LocalTime iso={k.first_at.toISOString()} /> · {k.first_stage}</div></td>
              <td className="td"><Link className="hover:underline" href={`/leads?view=${['DEAD', 'ENROLLED'].includes(k.new_stage) ? 'worked' : 'active'}&lead=${k.new_id}`}>{k.new_centre ?? 'HQ pool'}</Link><div className="text-xs text-muted"><LocalTime iso={k.created_at.toISOString()} /> · {k.new_stage}</div></td>
              <td className="td"><span className={`chip ${k.status === 'open' ? 'text-warn' : 'text-muted'}`}>{k.status.replace('_', ' ')}</span>{k.resolution && <div className="mt-1 text-xs text-muted">{k.resolution.replaceAll('_', ' ')}</div>}</td>
              <td className="td">{!d.ro && <form action={resolveConflictAction} className="flex justify-end gap-1.5">
                <input type="hidden" name="conflict_id" value={k.id} />
                <select name="resolution" className="input h-8 w-auto" aria-label="Resolution" defaultValue={k.resolution ?? 'keep_first'}><option value="keep_first">Credit first centre</option><option value="move_to_second">Credit second centre</option><option value="share_credit">Share credit</option></select>
                <button className="btn btn-quiet h-8">{k.status === 'resolved' ? 'Change' : 'Resolve'}</button></form>}</td>
            </tr>)}
            {d.rows.length === 0 && <tr><td colSpan={5} className="td text-muted">No cross-centre conflicts.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}
