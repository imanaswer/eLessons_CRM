import Link from 'next/link'
import { tenant } from '@/lib/session.ts'

const PAGE = 50
// Keyset pagination on the identity PK: constant cost at any depth.
export default async function Audit({ searchParams }: { searchParams: Promise<{ before?: string; action?: string }> }) {
  const sp = await searchParams
  const before = /^\d+$/.test(sp.before ?? '') ? sp.before! : null
  const action = sp.action?.slice(0, 60) || null
  const rows = await tenant(async (db) => (await db.query<{ id: string; created_at: Date; action: string; actor: string | null; centre: string | null; target_type: string | null; impersonating: boolean; metadata: unknown }>(
    `select a.id, a.created_at, a.action, u.display_name as actor, c.code as centre, a.target_type, a.impersonating, a.metadata
     from audit_log a left join users u on u.id = a.actor_user_id left join centres c on c.id = a.centre_id
     where ($1::bigint is null or a.id < $1) and ($2::text is null or a.action like $2 || '%')
     order by a.id desc limit ${PAGE}`, [before, action])).rows)
  const last = rows.at(-1)
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[22px] font-semibold leading-tight">Audit log</h1>
        <form className="flex gap-2"><input name="action" defaultValue={action ?? ''} className="input w-56" placeholder="Filter by action, e.g. auth." aria-label="Filter by action" /><button className="btn btn-quiet">Filter</button></form>
      </div>
      <section className="panel overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-line"><tr><th className="th">When (UTC)</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Centre</th><th className="th">Details</th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <td className="td whitespace-nowrap tabular-nums text-muted">{r.created_at.toISOString().slice(0, 19).replace('T', ' ')}</td>
                <td className="td">{r.actor ?? 'System'}{r.impersonating && <span className="chip ml-1 text-warn">viewing as</span>}</td>
                <td className="td font-medium">{r.action}</td>
                <td className="td">{r.centre ?? '—'}</td>
                <td className="td"><details><summary className="cursor-pointer text-xs text-muted">View</summary><pre className="mt-1 max-w-md overflow-x-auto text-xs">{JSON.stringify(r.metadata, null, 2)}</pre></details></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-muted" colSpan={5}>No audit entries match.</td></tr>}
          </tbody>
        </table>
      </section>
      {rows.length === PAGE && last && <Link className="btn btn-quiet" href={`?before=${last.id}${action ? `&action=${encodeURIComponent(action)}` : ''}`}>Older</Link>}
    </div>
  )
}
